import type { TariffRestriction } from '@iie/shared';

/** A country the parser can recognise in column headers. */
export interface CountryRef {
  id: string;
  isoAlpha2: string;
  isoAlpha3: string;
  iieCode: string;
  name: string;
  slug: string;
}

export interface ParsedLine {
  hsCode: string;
  description: string;
  dutyBps: number | null;
  caricomDutyBps: number | null;
  vatBps: number | null;
  rateText: string | null;
  restriction: TariffRestriction;
  notes: string | null;
}

export interface ParseResult {
  /** Lines per country id. */
  lines: Map<string, ParsedLine[]>;
  rowsRead: number;
  headerRow: number;
  columns: Record<string, string>;
  /** Countries recognised as rate columns (one rate column per country), if any. */
  countryColumns: string[];
  skipped: { row: number; reason: string }[];
}

export interface ParseOptions {
  /** Countries a single-rate file applies to (ignored when the file has one rate column per country). */
  countries: CountryRef[];
  /** Every country that may appear as a column header. */
  knownCountries: CountryRef[];
  /** Duty on CARICOM-origin goods when the file has no CARICOM column. */
  caricomDefaultBps: number;
}

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]/g, '');

const HS_HEADERS = ['hs', 'hscode', 'hsno', 'hsnumber', 'heading', 'headingno', 'subheading', 'tariffheading', 'tariffno', 'tariffnumber', 'tariffcode', 'tariffitem', 'code', 'commoditycode', 'cetcode', 'hsheading'];
const RATE_HEADERS = ['cet', 'cetrate', 'duty', 'dutyrate', 'rate', 'rateofduty', 'generalrate', 'generalduty', 'importduty', 'mfn', 'mfnrate', 'cetduty', 'dutypercent', 'ratepercent', 'rateofdutypercent', 'cetrateofduty'];

/** Finds which column holds what, from the header row. */
function classifyHeader(header: string[], known: CountryRef[]) {
  const cols: { hs?: number; description?: number; rate?: number; caricom?: number; vat?: number; restriction?: number; prohibited?: number; licence?: number; notes?: number } = {};
  const countryCols: { index: number; country: CountryRef }[] = [];
  header.forEach((raw, i) => {
    const h = norm(raw);
    if (!h) return;
    if (cols.hs === undefined && (HS_HEADERS.includes(h) || /^hs(code|no|number|heading)?\d{0,4}$/.test(h))) cols.hs = i;
    else if (cols.description === undefined && (h.includes('description') || h.includes('commodity') || ['goods', 'article', 'item', 'product'].includes(h))) cols.description = i;
    else if (cols.caricom === undefined && (h.includes('caricom') || h.includes('regional') || h.includes('commonmarket'))) cols.caricom = i;
    else if (cols.vat === undefined && h.startsWith('vat')) cols.vat = i;
    else if (cols.prohibited === undefined && h.includes('prohibit')) cols.prohibited = i;
    else if (cols.licence === undefined && (h.includes('licen') || h.includes('permit'))) cols.licence = i;
    else if (cols.restriction === undefined && h.includes('restrict')) cols.restriction = i;
    else if (cols.notes === undefined && (h.includes('note') || h.includes('remark'))) cols.notes = i;
    else if (cols.rate === undefined && (RATE_HEADERS.includes(h) || h.startsWith('rateofduty') || h.startsWith('cetrate'))) cols.rate = i;
    else {
      const country = known.find(
        (c) =>
          h === norm(c.isoAlpha2) ||
          h === norm(c.isoAlpha3) ||
          h === norm(c.iieCode) ||
          h === norm(c.slug) ||
          h === norm(c.name) ||
          (h.length >= 6 && norm(c.name).startsWith(h)) ||
          (h.length >= 6 && h.startsWith(norm(c.name))),
      );
      if (country && !countryCols.some((c) => c.country.id === country.id)) countryCols.push({ index: i, country });
    }
  });
  return { cols, countryCols };
}

/**
 * A rate as printed: "20", "20%", "20.5 %", "Free", "0", or compound ("5% or $1.00/kg"). Returns basis points when a
 * percentage can be read (the leading one for compound rates) and keeps the original text when it is not a plain
 * percentage. Cells formatted as percentages in Excel arrive as fractions and are converted by the reader.
 */
export function parseRate(value: unknown): { bps: number | null; text: string | null } {
  if (value === null || value === undefined) return { bps: null, text: null };
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1000 ? { bps: Math.round(value * 100), text: null } : { bps: null, text: String(value) };
  const s = String(value).trim();
  if (!s || s === '-' || s === '—') return { bps: null, text: null };
  if (/^(free|exempt|nil|duty[- ]?free)$/i.test(s)) return { bps: 0, text: null };
  const plain = /^(\d{1,4}(?:\.\d{1,4})?)\s*%?$/.exec(s);
  if (plain) return { bps: Math.round(Number(plain[1]) * 100), text: null };
  const leading = /^(\d{1,4}(?:\.\d{1,4})?)\s*%/.exec(s);
  if (leading) return { bps: Math.round(Number(leading[1]) * 100), text: s.slice(0, 100) };
  return { bps: null, text: s.slice(0, 100) };
}

function parseRestriction(generic: unknown, prohibited: unknown, licence: unknown): TariffRestriction {
  const yes = (v: unknown) => /^(y|yes|x|true|1|✓)$/i.test(String(v ?? '').trim());
  if (yes(prohibited) || /prohib/i.test(String(prohibited ?? ''))) return 'PROHIBITED';
  if (yes(licence) || /licen|permit/i.test(String(licence ?? ''))) return 'LICENCE_REQUIRED';
  const g = String(generic ?? '');
  if (/prohib/i.test(g)) return 'PROHIBITED';
  if (/licen|permit/i.test(g)) return 'LICENCE_REQUIRED';
  return 'NONE';
}

/** Digits of an HS code as printed ("9619.00.10", "9619 00", "961900"), or null when it is not one. */
export function normaliseHsCode(value: unknown): string | null {
  const digits = String(value ?? '').replace(/[\s.\-]/g, '');
  return /^\d{4,12}$/.test(digits) ? digits : null;
}

/**
 * Turns a table (rows of cells) into tariff lines per country. The header row is the first row, within the first 30,
 * that has an HS code column and a description column. Rows that are not HS lines (chapter titles, blanks, notes) are
 * skipped and reported.
 */
export function parseTariffTable(rows: unknown[][], opts: ParseOptions): ParseResult {
  let headerRow = -1;
  let layout: ReturnType<typeof classifyHeader> | null = null;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const candidate = classifyHeader((rows[i] ?? []).map((c) => String(c ?? '')), opts.knownCountries);
    if (candidate.cols.hs !== undefined && candidate.cols.description !== undefined) {
      headerRow = i;
      layout = candidate;
      break;
    }
  }
  if (!layout) throw new Error('No header row found: the file needs an HS code column and a description column');
  const { cols, countryCols } = layout;
  const perCountry = countryCols.length > 0;
  if (!perCountry && cols.rate === undefined) throw new Error('No duty rate column found (e.g. "CET rate", "Rate of duty", or one column per country)');
  if (!perCountry && !opts.countries.length) throw new Error('This file has a single rate column: choose the countries it applies to');

  const header = rows[headerRow]!.map((c) => String(c ?? ''));
  const columns: Record<string, string> = {};
  for (const [k, v] of Object.entries(cols)) if (v !== undefined) columns[k] = header[v]!;
  for (const c of countryCols) columns[`rate:${c.country.isoAlpha2}`] = header[c.index]!;

  const targets = perCountry ? countryCols.map((c) => ({ country: c.country, index: c.index })) : opts.countries.map((country) => ({ country, index: cols.rate! }));
  const lines = new Map<string, ParsedLine[]>(targets.map((t) => [t.country.id, []]));
  const seen = new Map<string, Set<string>>(targets.map((t) => [t.country.id, new Set()]));
  const skipped: ParseResult['skipped'] = [];
  let rowsRead = 0;

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (row.every((c) => String(c ?? '').trim() === '')) continue;
    rowsRead++;
    const hsCode = normaliseHsCode(row[cols.hs!]);
    const description = String(row[cols.description!] ?? '').trim().replace(/\s+/g, ' ');
    if (!hsCode) {
      if (skipped.length < 200) skipped.push({ row: r + 1, reason: `Not an HS code: "${String(row[cols.hs!] ?? '').slice(0, 30)}"` });
      continue;
    }
    if (!description) {
      if (skipped.length < 200) skipped.push({ row: r + 1, reason: `No description for ${hsCode}` });
      continue;
    }
    const caricom = cols.caricom !== undefined ? parseRate(row[cols.caricom]) : { bps: opts.caricomDefaultBps, text: null };
    const vat = cols.vat !== undefined ? parseRate(row[cols.vat]) : { bps: null, text: null };
    const restriction = parseRestriction(cols.restriction !== undefined ? row[cols.restriction] : null, cols.prohibited !== undefined ? row[cols.prohibited] : null, cols.licence !== undefined ? row[cols.licence] : null);
    const notes = cols.notes !== undefined ? String(row[cols.notes] ?? '').trim() || null : null;
    for (const t of targets) {
      const duty = parseRate(row[t.index]);
      if (seen.get(t.country.id)!.has(hsCode)) {
        if (skipped.length < 200) skipped.push({ row: r + 1, reason: `Duplicate HS code ${hsCode} for ${t.country.isoAlpha2}; the first one is kept` });
        continue;
      }
      seen.get(t.country.id)!.add(hsCode);
      lines.get(t.country.id)!.push({
        hsCode,
        description: description.slice(0, 2000),
        dutyBps: duty.bps,
        // A rate-less heading carries no CARICOM rate either.
        caricomDutyBps: duty.bps === null && duty.text === null ? null : caricom.bps,
        vatBps: vat.bps,
        rateText: duty.text,
        restriction,
        notes,
      });
    }
  }
  return { lines, rowsRead, headerRow: headerRow + 1, columns, countryColumns: countryCols.map((c) => c.country.isoAlpha2), skipped };
}

/** Minimal RFC 4180 CSV reader (quoted fields, escaped quotes, CRLF, BOM); detects comma, semicolon or tab. */
export function readCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const firstLine = src.slice(0, src.indexOf('\n') === -1 ? undefined : src.indexOf('\n'));
  const delimiter = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0]!.d;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
