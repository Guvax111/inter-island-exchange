import { describe, expect, it } from 'vitest';
import { addMoney, formatMinor, money, parseDecimalToMinor } from './money';

describe('money', () => {
  it('parses decimals into minor units without floating point error', () => {
    expect(parseDecimalToMinor('0.1', 2) + parseDecimalToMinor('0.2', 2)).toBe(30n);
    expect(parseDecimalToMinor('12.5', 2)).toBe(1250n);
    expect(parseDecimalToMinor('-3', 2)).toBe(-300n);
  });
  it('rejects too many decimal places and garbage', () => {
    expect(() => parseDecimalToMinor('1.234', 2)).toThrow();
    expect(() => parseDecimalToMinor('1e3', 2)).toThrow();
  });
  it('formats minor units', () => {
    expect(formatMinor(5n, 2)).toBe('0.05');
    expect(formatMinor(123456n, 2)).toBe('1234.56');
    expect(formatMinor(-150n, 2)).toBe('-1.50');
  });
  it('refuses to add different currencies', () => {
    expect(() => addMoney(money(100, 'XCD'), money(100, 'USD'))).toThrow(/mismatch/);
    expect(addMoney(money(100, 'XCD'), money(50, 'XCD')).amountMinor).toBe(150n);
  });
});
