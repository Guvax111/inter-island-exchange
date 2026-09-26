import { describe, expect, it } from 'vitest';
import { normaliseHsCode, parseRate, parseTariffTable, readCsv, type CountryRef } from './tariff-parser';

// Illustrative rows for testing the parser only; not real tariff data.
const LC: CountryRef = { id: 'lc', isoAlpha2: 'LC', isoAlpha3: 'LCA', iieCode: 'SLU', name: 'St. Lucia', slug: 'stlucia' };
const VC: CountryRef = { id: 'vc', isoAlpha2: 'VC', isoAlpha3: 'VCT', iieCode: 'SVG', name: 'St. Vincent and the Grenadines', slug: 'stvincent' };
const known = [LC, VC];

describe('rates', () => {
  it('reads percentages, free, compound and non-numeric rates', () => {
    expect(parseRate('20')).toEqual({ bps: 2000, text: null });
    expect(parseRate('20%')).toEqual({ bps: 2000, text: null });
    expect(parseRate(' 12.5 % ')).toEqual({ bps: 1250, text: null });
    expect(parseRate('Free')).toEqual({ bps: 0, text: null });
    expect(parseRate(0)).toEqual({ bps: 0, text: null });
    expect(parseRate('5% or $1.00/kg')).toEqual({ bps: 500, text: '5% or $1.00/kg' });
    expect(parseRate('A')).toEqual({ bps: null, text: 'A' });
    expect(parseRate('')).toEqual({ bps: null, text: null });
    expect(parseRate('-')).toEqual({ bps: null, text: null });
  });

  it('normalises HS codes as printed', () => {
    expect(normaliseHsCode('9619.00.10')).toBe('96190010');
    expect(normaliseHsCode('9619 00')).toBe('961900');
    expect(normaliseHsCode('96')).toBeNull();
    expect(normaliseHsCode('Chapter 96')).toBeNull();
  });
});

describe('CSV', () => {
  it('handles quotes, embedded commas and newlines, BOM and semicolons', () => {
    expect(readCsv('﻿a,b\r\n"x, y","say ""hi"""\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
    expect(readCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(readCsv('a,b\n"multi\nline",2')).toEqual([
      ['a', 'b'],
      ['multi\nline', '2'],
    ]);
  });
});

describe('tables', () => {
  it('single rate column applied to chosen countries, with title rows, headings and duplicates', () => {
    const rows = [
      ['CARICOM COMMON EXTERNAL TARIFF (test fixture)'],
      [],
      ['HS Code', 'Description of Goods', 'CET Rate of Duty %', 'Remarks'],
      ['Chapter 96', 'Miscellaneous manufactured articles', '', ''],
      ['96.19', 'Sanitary towels, tampons, napkins and similar articles', '', ''],
      ['9619.00.10', 'Of paper pulp', '20', 'test'],
      ['9619.00.10', 'Duplicate row', '5', ''],
      ['9301.10', 'Artillery weapons', 'Prohibited', ''],
    ];
    const r = parseTariffTable(rows, { countries: [VC], knownCountries: known, caricomDefaultBps: 0 });
    expect(r.headerRow).toBe(3);
    expect(r.countryColumns).toEqual([]);
    const vc = r.lines.get('vc')!;
    expect(vc.map((l) => l.hsCode)).toEqual(['9619', '96190010', '930110']);
    expect(vc[0]).toMatchObject({ dutyBps: null, caricomDutyBps: null, description: expect.stringMatching(/^Sanitary/) });
    expect(vc[1]).toMatchObject({ dutyBps: 2000, caricomDutyBps: 0, notes: 'test' });
    expect(vc[2]).toMatchObject({ dutyBps: null, rateText: 'Prohibited' });
    expect(r.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/Not an HS code/), expect.stringMatching(/Duplicate HS code 96190010/)]);
  });

  it('one rate column per country, with CARICOM, VAT and restriction columns', () => {
    const rows = [
      ['Tariff No.', 'Commodity', 'St. Lucia', 'SVG', 'CARICOM rate', 'VAT', 'Prohibited'],
      ['3304.99', 'Beauty or make-up preparations', '20%', '25', '0', '12.5', ''],
      ['9301.90', 'Military weapons', '', '', '', '', 'Yes'],
    ];
    const r = parseTariffTable(rows, { countries: [], knownCountries: known, caricomDefaultBps: 0 });
    expect(r.countryColumns).toEqual(['LC', 'VC']);
    expect(r.lines.get('lc')![0]).toMatchObject({ hsCode: '330499', dutyBps: 2000, caricomDutyBps: 0, vatBps: 1250, restriction: 'NONE' });
    expect(r.lines.get('vc')![0]).toMatchObject({ dutyBps: 2500 });
    expect(r.lines.get('vc')![1]).toMatchObject({ hsCode: '930190', restriction: 'PROHIBITED' });
  });

  it('explains what is missing', () => {
    expect(() => parseTariffTable([['Name', 'Price']], { countries: [VC], knownCountries: known, caricomDefaultBps: 0 })).toThrow(/HS code column/);
    expect(() => parseTariffTable([['HS', 'Description']], { countries: [VC], knownCountries: known, caricomDefaultBps: 0 })).toThrow(/rate column/);
    expect(() => parseTariffTable([['HS', 'Description', 'Rate']], { countries: [], knownCountries: known, caricomDefaultBps: 0 })).toThrow(/choose the countries/);
  });
});
