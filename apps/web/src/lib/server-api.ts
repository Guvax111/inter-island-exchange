import 'server-only';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://127.0.0.1:4000';

export interface PublicCountry {
  code: string;
  isoAlpha3: string;
  iieCode: string;
  name: string;
  slug: string;
  regionalBloc: string;
  marketplaceEnabled: boolean;
  currency: { code: string; name: string; symbol: string; minorUnit: number };
  info: Record<string, unknown>;
  lanes?: { origin: string; originName: string; destination: string; destinationName: string; enabled: boolean }[];
}

/** Server-side read of public API data. Returns null on 404 so pages can call notFound(). */
export async function serverGet<T>(path: string, revalidateSeconds = 60): Promise<T | null> {
  const res = await fetch(`${API_ORIGIN}/api/v1${path}`, { next: { revalidate: revalidateSeconds } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`API ${path} returned ${res.status}`);
  return (await res.json()) as T;
}
