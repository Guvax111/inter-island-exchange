import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import type { TariffRestriction } from '@iie/shared';
import { Database, DB } from '../db/db';
import { countries, dutyEstimates, tariffImports, tariffLines, tariffSchedules } from '../db/schema';
import { Errors } from '../common/errors';
import type { RequestMeta } from '../common/request';
import { AuditService } from '../audit/audit.service';
import type { Principal } from '../rbac/principal';
import { parseTariffTable, readCsv, type CountryRef, type ParsedLine } from './tariff-parser';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const INSERT_BATCH = 1000;

type CountryRow = typeof countries.$inferSelect;

/** What applies to one HS code imported into one country. */
export interface TariffResolution {
  country: { code: string; name: string };
  hsCode: string;
  matchedHsCode: string;
  description: string;
  /** Duty on goods from outside CARICOM (percent). */
  generalDutyPercent: number | null;
  /** Duty on goods of CARICOM origin (percent). */
  caricomDutyPercent: number | null;
  /** The duty for this product's origin, when the origin is known. */
  applicableDutyPercent: number | null;
  vatPercent: number | null;
  vatFrom: 'TARIFF' | 'COUNTRY' | null;
  rateText: string | null;
  restriction: TariffRestriction;
  notes: string | null;
  /** True when the code covers sub-headings with different rates; the highest is shown. */
  varies: boolean;
  source: { kind: 'TARIFF_SCHEDULE'; name: string; publisher: string; effectiveFrom: Date } | { kind: 'IIE_ESTIMATE'; name: string; isPlaceholder: boolean };
}

/**
 * HS tariff schedules per country: import (CSV or Excel), activation, and lookups used when sellers list products,
 * on product pages, at checkout and on customs documents. Data comes only from files IIE imports; nothing is
 * invented. Without an active schedule, IIE's configured estimates (Admin → Checkout settings) apply.
 */
@Injectable()
export class TariffsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ import

  async importFile(
    principal: Principal,
    input: { name: string; source: string; effectiveFrom: string; countryCodes: string[]; caricomDefaultPercent: number },
    file: { buffer: Buffer; size: number; originalname?: string } | undefined,
    meta: RequestMeta,
  ) {
    if (!file) throw Errors.badRequest('FILE_REQUIRED', 'Choose a CSV or Excel (.xlsx) file');
    if (file.size > MAX_FILE_BYTES) throw Errors.badRequest('FILE_TOO_LARGE', 'Tariff files must be 25 MB or smaller');
    const all = await this.db.select().from(countries);
    const refs: CountryRef[] = all.map((c) => ({ id: c.id, isoAlpha2: c.isoAlpha2, isoAlpha3: c.isoAlpha3, iieCode: c.iieCode, name: c.name, slug: c.slug }));
    const chosen = input.countryCodes.map((code) => {
      const c = refs.find((r) => r.isoAlpha2 === code);
      if (!c) throw Errors.badRequest('UNKNOWN_COUNTRY', `Unknown country ${code}`);
      return c;
    });
    const rows = await this.readRows(file);
    let parsed;
    try {
      parsed = parseTariffTable(rows, { countries: chosen, knownCountries: refs, caricomDefaultBps: Math.round(input.caricomDefaultPercent * 100) });
    } catch (err) {
      throw Errors.badRequest('UNREADABLE_TARIFF', (err as Error).message);
    }
    const totalLines = [...parsed.lines.values()].reduce((n, l) => n + l.length, 0);
    if (!totalLines) throw Errors.badRequest('EMPTY_TARIFF', 'No HS lines were found in the file');

    const summary = {
      rowsRead: parsed.rowsRead,
      headerRow: parsed.headerRow,
      columns: parsed.columns,
      layout: parsed.countryColumns.length ? 'ONE_RATE_COLUMN_PER_COUNTRY' : 'SINGLE_RATE_COLUMN',
      linesByCountry: Object.fromEntries([...parsed.lines.entries()].map(([id, l]) => [refs.find((r) => r.id === id)!.isoAlpha2, l.length])),
      withoutRate: Object.fromEntries([...parsed.lines.entries()].map(([id, l]) => [refs.find((r) => r.id === id)!.isoAlpha2, l.filter((x) => x.dutyBps === null).length])),
      skippedCount: parsed.skipped.length,
      skipped: parsed.skipped.slice(0, 50),
      caricomDefaultPercent: parsed.columns.caricom ? null : input.caricomDefaultPercent,
    };
    const created = await this.db.transaction(async (tx) => {
      const [imp] = await tx
        .insert(tariffImports)
        .values({ name: input.name, source: input.source, fileName: (file.originalname ?? 'tariff').slice(0, 200), effectiveFrom: new Date(input.effectiveFrom), summary, importedBy: principal.userId })
        .returning();
      for (const [countryId, lines] of parsed.lines) {
        const [schedule] = await tx.insert(tariffSchedules).values({ importId: imp!.id, countryId, lineCount: lines.length }).returning();
        for (let i = 0; i < lines.length; i += INSERT_BATCH) {
          await tx.insert(tariffLines).values(lines.slice(i, i + INSERT_BATCH).map((l: ParsedLine) => ({ scheduleId: schedule!.id, ...l })));
        }
      }
      await this.audit.record(tx, meta, { action: 'tariff.imported', entityType: 'tariff_import', entityId: imp!.id, after: { name: input.name, source: input.source, ...summary, skipped: undefined } });
      return imp!;
    });
    return this.getImport(created.id);
  }

  /** Makes a draft import live: each of its schedules replaces the country's current one. */
  async activate(principal: Principal, importId: string, meta: RequestMeta) {
    const [imp] = await this.db.select().from(tariffImports).where(eq(tariffImports.id, importId));
    if (!imp) throw Errors.notFound('Tariff import');
    if (imp.status !== 'DRAFT') throw Errors.conflict('NOT_DRAFT', 'Only a draft import can be activated');
    await this.db.transaction(async (tx) => {
      const schedules = await tx.select().from(tariffSchedules).where(eq(tariffSchedules.importId, importId));
      const countryIds = schedules.map((s) => s.countryId);
      await tx.update(tariffSchedules).set({ status: 'RETIRED' }).where(and(inArray(tariffSchedules.countryId, countryIds), eq(tariffSchedules.status, 'ACTIVE')));
      await tx.update(tariffSchedules).set({ status: 'ACTIVE' }).where(eq(tariffSchedules.importId, importId));
      await tx.update(tariffImports).set({ status: 'ACTIVE', activatedBy: principal.userId, activatedAt: new Date() }).where(eq(tariffImports.id, importId));
      await this.audit.record(tx, meta, { action: 'tariff.activated', entityType: 'tariff_import', entityId: importId, after: { countries: countryIds.length } });
    });
    return this.getImport(importId);
  }

  /** Drops a draft import and its lines. Active and retired imports are kept for the record. */
  async discard(importId: string, meta: RequestMeta) {
    const [imp] = await this.db.select().from(tariffImports).where(eq(tariffImports.id, importId));
    if (!imp) throw Errors.notFound('Tariff import');
    if (imp.status !== 'DRAFT') throw Errors.conflict('NOT_DRAFT', 'Only a draft import can be discarded');
    await this.db.transaction(async (tx) => {
      const schedules = await tx.select({ id: tariffSchedules.id }).from(tariffSchedules).where(eq(tariffSchedules.importId, importId));
      if (schedules.length) await tx.delete(tariffLines).where(inArray(tariffLines.scheduleId, schedules.map((s) => s.id)));
      await tx.delete(tariffSchedules).where(eq(tariffSchedules.importId, importId));
      await tx.update(tariffImports).set({ status: 'DISCARDED' }).where(eq(tariffImports.id, importId));
      await this.audit.record(tx, meta, { action: 'tariff.discarded', entityType: 'tariff_import', entityId: importId });
    });
  }

  async listImports() {
    const rows = await this.db.select().from(tariffImports).orderBy(desc(tariffImports.createdAt)).limit(50);
    return { items: await Promise.all(rows.map((r) => this.getImport(r.id))) };
  }

  async getImport(id: string) {
    const [imp] = await this.db.select().from(tariffImports).where(eq(tariffImports.id, id));
    if (!imp) throw Errors.notFound('Tariff import');
    const schedules = await this.db
      .select({ s: tariffSchedules, country: countries.isoAlpha2, countryName: countries.name })
      .from(tariffSchedules)
      .innerJoin(countries, eq(countries.id, tariffSchedules.countryId))
      .where(eq(tariffSchedules.importId, id));
    const sample = schedules[0]
      ? await this.db.select().from(tariffLines).where(eq(tariffLines.scheduleId, schedules[0].s.id)).orderBy(tariffLines.hsCode).limit(10)
      : [];
    return {
      id: imp.id,
      name: imp.name,
      source: imp.source,
      fileName: imp.fileName,
      effectiveFrom: imp.effectiveFrom,
      status: imp.status,
      summary: imp.summary,
      createdAt: imp.createdAt,
      activatedAt: imp.activatedAt,
      schedules: schedules.map((r) => ({ country: r.country, countryName: r.countryName, status: r.s.status, lines: r.s.lineCount })),
      sample: sample.map((l) => this.lineView(l)),
    };
  }

  /** Countries with an active schedule, for the public tariff page. */
  async coverage() {
    const rows = await this.db
      .select({ country: countries.isoAlpha2, name: countries.name, lines: tariffSchedules.lineCount, schedule: tariffImports.name, publisher: tariffImports.source, effectiveFrom: tariffImports.effectiveFrom })
      .from(tariffSchedules)
      .innerJoin(countries, eq(countries.id, tariffSchedules.countryId))
      .innerJoin(tariffImports, eq(tariffImports.id, tariffSchedules.importId))
      .where(eq(tariffSchedules.status, 'ACTIVE'))
      .orderBy(countries.name);
    return { items: rows };
  }

  // ------------------------------------------------------------------ lookups

  /** Search a country's active tariff by code prefix or by words in the description. */
  async search(countryCode: string, q: string) {
    const country = await this.country(countryCode);
    const digits = q.replace(/[\s.]/g, '');
    const byCode = /^\d{2,12}$/.test(digits);
    const rows = await this.db
      .select({ l: tariffLines })
      .from(tariffLines)
      .innerJoin(tariffSchedules, eq(tariffSchedules.id, tariffLines.scheduleId))
      .where(
        and(
          eq(tariffSchedules.countryId, country.id),
          eq(tariffSchedules.status, 'ACTIVE'),
          byCode ? sql`${tariffLines.hsCode} like ${digits + '%'}` : sql`to_tsvector('english', ${tariffLines.description}) @@ plainto_tsquery('english', ${q})`,
        ),
      )
      .orderBy(tariffLines.hsCode)
      .limit(30);
    return { country: { code: country.isoAlpha2, name: country.name }, items: rows.map((r) => this.lineView(r.l)) };
  }

  /** What applies to one HS code in one country, for goods from `originCode` (when known). */
  async lookup(countryCode: string, hsCode: string, originCode?: string): Promise<TariffResolution | null> {
    const country = await this.country(countryCode);
    const origin = originCode ? await this.country(originCode) : null;
    return this.resolve(country, hsCode, origin ? origin.regionalBloc === 'CARICOM' : null);
  }

  /** For checkout: per HS code, the rule to price with and what to show; null when neither a tariff nor an estimate applies. */
  async resolveForDestination(destinationCountryId: string, lines: { hsCode: string | null; originIsCaricom: boolean }[]) {
    const [country] = await this.db.select().from(countries).where(eq(countries.id, destinationCountryId));
    const out = new Map<string, TariffResolution | null>();
    for (const l of lines) {
      if (!l.hsCode) continue;
      const key = `${l.hsCode}|${l.originIsCaricom}`;
      if (!out.has(key)) out.set(key, await this.resolve(country!, l.hsCode, l.originIsCaricom));
    }
    return out;
  }

  private async resolve(country: CountryRow, hsCode: string, originIsCaricom: boolean | null): Promise<TariffResolution | null> {
    const code = hsCode.replace(/[\s.]/g, '');
    const countryVat = await this.countryVat(country.id, code);
    // 1. The code itself or its parent headings, most specific first.
    const ancestors = await this.activeLines(country.id, sql`${code} like ${tariffLines.hsCode} || '%'`, sql`length(${tariffLines.hsCode}) desc`);
    let rateLine = ancestors.find((a) => a.l.dutyBps !== null || a.l.rateText !== null);
    const descriptionLine = ancestors[0];
    // A restriction on a heading covers everything under it: the strictest one along the way applies.
    const restriction = strictest(ancestors.map((a) => a.l.restriction as TariffRestriction));
    let varies = false;
    // 2. A general code (e.g. 6 digits) against a national tariff with finer sub-headings: use them.
    if (!rateLine) {
      const children = (await this.activeLines(country.id, sql`${tariffLines.hsCode} like ${code + '%'}`, sql`${tariffLines.hsCode}`)).filter((c) => c.l.dutyBps !== null);
      if (children.length) {
        const rates = new Set(children.map((c) => `${c.l.dutyBps}|${c.l.caricomDutyBps}`));
        varies = rates.size > 1;
        rateLine = children.reduce((max, c) => ((c.l.dutyBps ?? 0) > (max.l.dutyBps ?? 0) ? c : max));
      }
    }
    if (rateLine) {
      const l = rateLine.l;
      const general = l.dutyBps;
      const caricom = l.caricomDutyBps ?? general;
      const vatBps = l.vatBps ?? countryVat?.vatBps ?? null;
      return {
        country: { code: country.isoAlpha2, name: country.name },
        hsCode: code,
        matchedHsCode: l.hsCode,
        description: (descriptionLine ?? rateLine).l.description,
        generalDutyPercent: pct(general),
        caricomDutyPercent: pct(caricom),
        applicableDutyPercent: originIsCaricom === null ? null : pct(originIsCaricom ? caricom : general),
        vatPercent: pct(vatBps),
        vatFrom: l.vatBps !== null ? 'TARIFF' : countryVat ? 'COUNTRY' : null,
        rateText: l.rateText,
        restriction: strictest([restriction, l.restriction as TariffRestriction]),
        notes: l.notes,
        varies,
        source: { kind: 'TARIFF_SCHEDULE', name: rateLine.importName, publisher: rateLine.publisher, effectiveFrom: rateLine.effectiveFrom },
      };
    }
    // The schedule lists the code (description, restriction) but gives no rate for it.
    if (descriptionLine) {
      return {
        country: { code: country.isoAlpha2, name: country.name },
        hsCode: code,
        matchedHsCode: descriptionLine.l.hsCode,
        description: descriptionLine.l.description,
        generalDutyPercent: null,
        caricomDutyPercent: null,
        applicableDutyPercent: null,
        vatPercent: pct(countryVat?.vatBps),
        vatFrom: countryVat ? 'COUNTRY' : null,
        rateText: null,
        restriction,
        notes: descriptionLine.l.notes,
        varies: false,
        source: { kind: 'TARIFF_SCHEDULE', name: descriptionLine.importName, publisher: descriptionLine.publisher, effectiveFrom: descriptionLine.effectiveFrom },
      };
    }
    // 3. No tariff: IIE's own estimate rules, clearly labelled as estimates.
    if (!countryVat) return null;
    return {
      country: { code: country.isoAlpha2, name: country.name },
      hsCode: code,
      matchedHsCode: countryVat.hsPrefix,
      description: '',
      generalDutyPercent: pct(countryVat.otherOriginDutyBps),
      caricomDutyPercent: pct(countryVat.caricomOriginDutyBps),
      applicableDutyPercent: originIsCaricom === null ? null : pct(originIsCaricom ? countryVat.caricomOriginDutyBps : countryVat.otherOriginDutyBps),
      vatPercent: pct(countryVat.vatBps),
      vatFrom: 'COUNTRY',
      rateText: null,
      restriction: 'NONE',
      notes: countryVat.notes || null,
      varies: false,
      source: { kind: 'IIE_ESTIMATE', name: 'IIE duty estimate', isPlaceholder: countryVat.isPlaceholder },
    };
  }

  private activeLines(countryId: string, match: ReturnType<typeof sql>, order: ReturnType<typeof sql>) {
    return this.db
      .select({ l: tariffLines, importName: tariffImports.name, publisher: tariffImports.source, effectiveFrom: tariffImports.effectiveFrom })
      .from(tariffLines)
      .innerJoin(tariffSchedules, eq(tariffSchedules.id, tariffLines.scheduleId))
      .innerJoin(tariffImports, eq(tariffImports.id, tariffSchedules.importId))
      .where(and(eq(tariffSchedules.countryId, countryId), eq(tariffSchedules.status, 'ACTIVE'), match))
      .orderBy(order)
      .limit(500);
  }

  /** IIE's estimate rule for the country (most specific HS prefix); also the source of the national VAT rate. */
  private async countryVat(countryId: string, code: string) {
    const rules = await this.db.select().from(dutyEstimates).where(eq(dutyEstimates.destinationCountryId, countryId));
    return rules.filter((r) => code.startsWith(r.hsPrefix)).sort((a, b) => b.hsPrefix.length - a.hsPrefix.length)[0] ?? null;
  }

  private async country(code: string) {
    const [c] = await this.db.select().from(countries).where(eq(countries.isoAlpha2, code.toUpperCase()));
    if (!c) throw Errors.badRequest('UNKNOWN_COUNTRY', `Unknown country ${code}`);
    return c;
  }

  private lineView(l: typeof tariffLines.$inferSelect) {
    return {
      hsCode: l.hsCode,
      description: l.description,
      generalDutyPercent: pct(l.dutyBps),
      caricomDutyPercent: pct(l.caricomDutyBps),
      vatPercent: pct(l.vatBps),
      rateText: l.rateText,
      restriction: l.restriction,
      notes: l.notes,
    };
  }

  private async readRows(file: { buffer: Buffer; originalname?: string }): Promise<unknown[][]> {
    const isXlsx = file.buffer.subarray(0, 2).toString('latin1') === 'PK';
    if (!isXlsx) {
      const text = file.buffer.toString('utf8');
      if (text.includes('\u0000')) throw Errors.badRequest('UNSUPPORTED_FILE', 'Upload a CSV or an Excel .xlsx file (older .xls files: save as .xlsx first)');
      return readCsv(text);
    }
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
    } catch {
      throw Errors.badRequest('UNSUPPORTED_FILE', 'The Excel file could not be read');
    }
    // Tariff workbooks often start with a cover or notes sheet: read the sheet with the most rows.
    const rows: unknown[][] = [];
    const sheet = [...workbook.worksheets].sort((a, b) => b.rowCount - a.rowCount)[0];
    if (!sheet) throw Errors.badRequest('UNSUPPORTED_FILE', 'The Excel file has no sheets');
    sheet.eachRow({ includeEmpty: true }, (row) => {
      const cells: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        let v: unknown = cell.value;
        if (v && typeof v === 'object') {
          const o = v as { result?: unknown; text?: string; richText?: { text: string }[] };
          v = o.result ?? o.text ?? (o.richText ? o.richText.map((t) => t.text).join('') : String(v));
        }
        // Cells formatted as percentages hold fractions (0.2 = 20%).
        if (typeof v === 'number' && cell.numFmt?.includes('%')) v = v * 100;
        cells[col - 1] = v;
      });
      rows.push(cells);
    });
    return rows;
  }
}

const RESTRICTION_ORDER: TariffRestriction[] = ['NONE', 'LICENCE_REQUIRED', 'PROHIBITED'];
const strictest = (all: TariffRestriction[]) => all.reduce<TariffRestriction>((a, b) => (RESTRICTION_ORDER.indexOf(b) > RESTRICTION_ORDER.indexOf(a) ? b : a), 'NONE');

const pct = (bps: number | null | undefined) => (bps === null || bps === undefined ? null : bps / 100);
