import { formatMinor } from '@iie/shared';

export interface CurrencyInfo {
  code: string;
  symbol: string;
  minorUnit: number;
}

/** Money as sent to clients. amountMinor is a string because JSON numbers cannot hold every bigint. */
export interface MoneyDto {
  amountMinor: string;
  currency: string;
  formatted: string;
}

export function toMoneyDto(amountMinor: bigint, currency: CurrencyInfo): MoneyDto {
  return { amountMinor: amountMinor.toString(), currency: currency.code, formatted: `${currency.symbol}${formatMinor(amountMinor, currency.minorUnit)}` };
}
