/**
 * Money is always an integer number of minor units plus an ISO 4217 code.
 * Never use floating point for amounts.
 */
export interface Money {
  amountMinor: bigint;
  currency: string;
}

export function money(amountMinor: bigint | number, currency: string): Money {
  const amount = typeof amountMinor === 'number' ? BigInt(amountMinor) : amountMinor;
  if (typeof amountMinor === 'number' && !Number.isSafeInteger(amountMinor)) {
    throw new RangeError('amountMinor must be a safe integer');
  }
  if (!/^[A-Z]{3}$/.test(currency)) throw new RangeError(`Invalid currency code: ${currency}`);
  return { amountMinor: amount, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

/** Parses a decimal string such as "12.50" into minor units without floating point. */
export function parseDecimalToMinor(value: string, minorUnit: number): bigint {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new RangeError(`Invalid decimal amount: ${value}`);
  const [, sign, whole, fraction = ''] = match;
  if (fraction.length > minorUnit) throw new RangeError(`Too many decimal places for minor unit ${minorUnit}: ${value}`);
  const minor = BigInt(whole! + fraction.padEnd(minorUnit, '0'));
  return sign ? -minor : minor;
}

export function formatMinor(amountMinor: bigint, minorUnit: number): string {
  const negative = amountMinor < 0n;
  const digits = (negative ? -amountMinor : amountMinor).toString().padStart(minorUnit + 1, '0');
  const whole = digits.slice(0, digits.length - minorUnit);
  const fraction = minorUnit > 0 ? `.${digits.slice(-minorUnit)}` : '';
  return `${negative ? '-' : ''}${whole}${fraction}`;
}
