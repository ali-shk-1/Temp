/**
 * lib/api-client.ts
 *
 * Direct TypeScript port of frontend/api.js from the original vanilla-JS
 * app. Same contract: Bearer token from sessionStorage, same error
 * shape (`data.error || data.message || 'Request failed'`), same 401
 * handling (clear session + redirect to /login).
 *
 * Usage is intentionally close to the original `api('GET', '/api/x')`
 * call shape so porting page logic 1:1 stays easy to verify against the
 * original HTML files.
 */

'use client';

export interface SessionUser {
  user_id: number;
  username: string;
  role: string;
  staff_id: number | null;
}

const BASE_URL = typeof window !== 'undefined' ? window.location.origin : '';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem('token');
}

export function getUser(): SessionUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function logout(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('token');
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('myPermissions');
  sessionStorage.removeItem('myPageVisibility');
  window.location.href = '/login';
}

/** Thrown by api()/apiForm() on non-OK responses, mirroring the original's plain Error(message). */
export class ApiError extends Error {}

/**
 * api('GET', '/api/students') style call, matching the original api.js
 * function signature and behavior exactly (including returning
 * `undefined` on a 401, after redirecting to login).
 */
export async function api<T = any>(
  method: string,
  path: string,
  body: unknown = null
): Promise<T | undefined> {
  const opts: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(BASE_URL + path, opts);

  if (res.status === 401) {
    logout();
    return undefined;
  }

  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || data.message || 'Request failed');
  return data as T;
}

/** apiForm(path, formData) — same as api() but for multipart/form-data uploads (no Content-Type header, browser sets the boundary). */
export async function apiForm<T = any>(path: string, formData: FormData): Promise<T | undefined> {
  const opts: RequestInit = {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
    body: formData,
  };

  const res = await fetch(BASE_URL + path, opts);
  if (res.status === 401) {
    logout();
    return undefined;
  }

  const data = await res.json();
  if (!res.ok) throw new ApiError(data.error || data.message || 'Request failed');
  return data as T;
}

/** formatDate(d) — ported verbatim, including the UTC-midnight-rollback fix for pure date strings. */
export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const [, y, mo, day] = m;
    return `${day}/${mo}/${y}`;
  }
  return new Date(d).toLocaleDateString('en-GB');
}

/** formatMoney(n) — 'Rs. 12,345' */
export function formatMoney(n: number | string | null | undefined): string {
  return 'Rs. ' + Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0 });
}

/** formatMoneyHtml(n) — same as formatMoney but with "Rs." wrapped in a smaller span, for stat cards. Returns raw HTML string for dangerouslySetInnerHTML, matching the original's usage. */
export function formatMoneyHtml(n: number | string | null | undefined): string {
  const amount = Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 0 });
  return `<span class="currency">Rs.</span> ${amount}`;
}

/** normalizeList(res, hints) — ported verbatim: finds the first array in the response, preferring the hinted key names. */
export function normalizeList<T = any>(res: any, hints: string[] = []): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  for (const key of hints) {
    if (Array.isArray(res[key])) return res[key];
  }
  for (const key of Object.keys(res)) {
    if (Array.isArray(res[key])) return res[key];
  }
  return [];
}

/**
 * bindPanelKeyboardNavigation(root) — ported verbatim. Enter/ArrowDown/ArrowUp
 * move focus between visible inputs/selects/textareas in `root`.
 * Call from a useEffect after the relevant form/panel mounts.
 */
export function bindPanelKeyboardNavigation(root: Document | HTMLElement = document): () => void {
  const fields = Array.from(root.querySelectorAll<HTMLElement>('input, select, textarea')).filter(
    (el) => !(el as HTMLInputElement).disabled && (el as HTMLInputElement).type !== 'hidden' && el.tabIndex !== -1
  );
  if (!fields.length) return () => {};

  const isNavField = (el: HTMLElement) =>
    el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'checkbox' && (el as HTMLInputElement).type !== 'radio';

  const listeners: Array<[HTMLElement, (e: KeyboardEvent) => void]> = [];

  fields.forEach((field, index) => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key;
      if (key === 'Enter' && field.tagName !== 'TEXTAREA') {
        e.preventDefault();
        const next = fields[index + 1];
        if (next) next.focus();
        return;
      }
      if (key === 'ArrowDown' && isNavField(field)) {
        e.preventDefault();
        const next = fields[index + 1];
        if (next) next.focus();
        return;
      }
      if (key === 'ArrowUp' && isNavField(field)) {
        e.preventDefault();
        const prev = fields[index - 1];
        if (prev) prev.focus();
      }
    };
    field.addEventListener('keydown', handler);
    listeners.push([field, handler]);
  });

  return () => {
    listeners.forEach(([field, handler]) => field.removeEventListener('keydown', handler));
  };
}

export function dbg(label: string, val: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`[DBG] ${label}:`, JSON.stringify(val)?.slice(0, 300));
}
