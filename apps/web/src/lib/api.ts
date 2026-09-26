'use client';

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: { path: string; message: string }[];
  requestId?: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(body.message);
  }

  /** Field errors keyed by dotted path, for showing next to form inputs. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.body.details ?? []).map((d) => [d.path, d.message]));
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|; )iie_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]!) : '';
}

/** Browser-side API call through the same-origin /api/v1 proxy. Adds the CSRF header to state-changing requests. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = { accept: 'application/json' };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers['x-csrf-token'] = csrfToken();
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? { code: 'NETWORK_ERROR', message: 'Could not reach the server. Check your connection.' });
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.body.message;
  return 'Something went wrong. Please try again.';
}

/** Multipart upload through the same proxy, with the CSRF header. */
export async function apiUpload<T = unknown>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`/api/v1${path}`, { method: 'POST', body: form, credentials: 'same-origin', headers: { 'x-csrf-token': csrfToken() } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? { code: 'UPLOAD_FAILED', message: 'Upload failed. Try a smaller JPEG, PNG or WebP image.' });
  return data as T;
}
