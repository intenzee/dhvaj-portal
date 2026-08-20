/**
 * Typed API client. The browser talks to the NestJS API directly (CORS is
 * enabled for the portal origin); the bearer token is attached from the auth
 * store. All backend rules — authorisation, RLS, validation — remain
 * authoritative; this layer only carries requests and surfaces errors.
 */

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:3001/api/v1';

const TOKEN_KEY = 'hsdg.token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}
export function setToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skip the bearer token (for the public dev-token endpoint). */
  anonymous?: boolean;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!options.anonymous) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (data && typeof data === 'object' && 'message' in data) {
      const m = (data as { message?: unknown }).message;
      if (typeof m === 'string' && m.length > 0) message = m;
    }
    throw new ApiError(res.status, message);
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Fetch a binary payload from an authenticated endpoint (for inline preview). */
export async function fetchBlob(
  path: string,
): Promise<{ blob: Blob; contentType: string; filename: string }> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, `Could not load the file (${res.status}).`);
  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] ?? 'file';
  const blob = await res.blob();
  const contentType = blob.type || res.headers.get('content-type') || 'application/octet-stream';
  return { blob, contentType, filename };
}

/**
 * Download a file from an authenticated endpoint and save it in the browser.
 * The API needs a bearer token, so we fetch the blob (not a plain <a href>) and
 * trigger a save via an object URL.
 */
export async function downloadFile(path: string, fallbackName = 'download'): Promise<void> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  });
  if (!res.ok) throw new ApiError(res.status, `Download failed (${res.status})`);

  const disposition = res.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const name = match?.[1] ?? fallbackName;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
