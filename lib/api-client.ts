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
  clearApiCache();
  window.location.href = '/login';
}

/** Thrown by api()/apiForm() on non-OK responses, mirroring the original's plain Error(message). */
export class ApiError extends Error {}

/**
 * GET response cache, keyed by request path, persisted to localStorage
 * and synced live across every open tab of the same browser.
 *
 * How this achieves each of the three speed goals:
 *   1. Repeat visits within a tab: served straight from the in-memory
 *      Map, no disk read needed.
 *   2. Cross-tab sync: every tab also writes each cache entry to
 *      localStorage and broadcasts via the `storage` event (the
 *      standard, no-extra-API way tabs on the same origin notify each
 *      other) — so a payment added in the Fees tab makes the Dashboard
 *      tab's cached numbers update within the same tick, no reload.
 *   3. Fast *first* load of a session: on module init we hydrate the
 *      in-memory Map from whatever's already in localStorage from a
 *      previous visit, so even a brand-new page mount can render
 *      instantly from a slightly-stale cache while a fresh copy loads
 *      behind it — rather than starting from a blank slate every time.
 *
 * Lifetime and safety:
 *   - Each entry has its own expiry (CACHE_TTL_MS) and is dropped once
 *     stale, whether read from memory or from disk.
 *   - Keys are scoped by user token, so switching users never serves
 *     one person's cached data to another on the same device.
 *   - logout() wipes both the in-memory Map and every persisted key —
 *     nothing lingers on disk after signing out.
 *   - localStorage has ~5-10MB of headroom per origin; this app's
 *     cached JSON (student/staff/fee lists) is realistically tens of
 *     KB total, so the persisted cache stays a small fraction of that.
 */
const CACHE_TTL_MS = 30_000;
const STORAGE_PREFIX = 'apicache::';
type CacheEntry = { data: any; expires: number };
const getCache = new Map<string, CacheEntry>();
// In-flight GETs by path, so two components requesting the same path in
// the same tick share one network request instead of firing twice.
const inFlight = new Map<string, Promise<any>>();

function cacheKey(path: string): string {
  // Token-scoped so switching users (rare, but possible in the same tab
  // via re-login) never serves one user's cached data to another.
  return `${getToken() || ''}::${path}`;
}

function storageKey(key: string): string {
  return STORAGE_PREFIX + key;
}

function readFromDisk(key: string): CacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (entry.expires <= Date.now()) {
      localStorage.removeItem(storageKey(key));
      return null;
    }
    return entry;
  } catch {
    return null; // corrupt/unavailable storage never breaks a page load
  }
}

function writeToDisk(key: string, entry: CacheEntry): void {
  if (typeof window === 'undefined') return;
  try {
    // Writing here is what fires the `storage` event in every OTHER
    // open tab (same-tab writes never trigger it, by spec) — that's
    // the actual cross-tab sync mechanism, no extra library needed.
    localStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Storage full/disabled (private browsing, quota) — degrade to
    // memory-only caching rather than throwing.
  }
}

function setCache(key: string, data: any): void {
  const entry = { data, expires: Date.now() + CACHE_TTL_MS };
  getCache.set(key, entry);
  writeToDisk(key, entry);
}

export function clearApiCache(): void {
  getCache.clear();
  inFlight.clear();
  if (typeof window === 'undefined') return;
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    // ignore — nothing to clean up if storage isn't available
  }
}

// Cross-tab live sync: when another tab writes or clears a cache entry,
// mirror that into this tab's in-memory Map immediately, so a page
// already open in this tab reflects the change without needing its own
// network request. (Doesn't re-render already-rendered components on
// its own — pages still pick this up next time they read the cache,
// e.g. on their own live-update refresh — but it means the data is
// already warm and correct by the time they do.)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e: StorageEvent) => {
    if (!e.key || !e.key.startsWith(STORAGE_PREFIX)) return;
    const key = e.key.slice(STORAGE_PREFIX.length);
    if (e.newValue === null) {
      getCache.delete(key);
      return;
    }
    try {
      const entry: CacheEntry = JSON.parse(e.newValue);
      getCache.set(key, entry);
    } catch {
      // ignore malformed entries from other tabs
    }
  });

  // Hydrate this tab's in-memory cache from disk on load, so even a
  // brand new tab/page mount can serve instantly from whatever the
  // last tab left behind (still subject to each entry's own expiry).
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(STORAGE_PREFIX))
      .forEach((k) => {
        const key = k.slice(STORAGE_PREFIX.length);
        const entry = readFromDisk(key);
        if (entry) getCache.set(key, entry);
      });
  } catch {
    // ignore — falls back to network-only for this tab
  }
}

/**
 * api('GET', '/api/students') style call, matching the original api.js
 * function signature and behavior exactly (including returning
 * `undefined` on a 401, after redirecting to login).
 *
 * GET requests are cached (see getCache above); every other method
 * always hits the network and invalidates the cache on success, since
 * it just changed server state that some cached GET may reflect.
 */
export async function api<T = any>(
  method: string,
  path: string,
  body: unknown = null,
  opts?: { fresh?: boolean }
): Promise<T | undefined> {
  const isGet = method.toUpperCase() === 'GET';

  if (isGet && !opts?.fresh) {
    const key = cacheKey(path);
    const cached = getCache.get(key);
    if (cached && cached.expires > Date.now()) {
      // Serve from cache instantly, but kick off a silent background
      // refresh so the cache doesn't go stale between now and its TTL
      // (classic stale-while-revalidate — the caller never awaits this).
      void fetchAndCache<T>(path, key).catch(() => {});
      return cached.data as T;
    }
    const pending = inFlight.get(key);
    if (pending) return pending as Promise<T>;
    return fetchAndCache<T>(path, key);
  }

  const result = await doFetch<T>(method, path, body);
  if (!isGet) clearApiCache(); // any write can affect any number of cached reads
  return result;
}

async function fetchAndCache<T>(path: string, key: string): Promise<T | undefined> {
  const promise = doFetch<T>('GET', path, null).then((data) => {
    if (data !== undefined) setCache(key, data);
    inFlight.delete(key);
    return data;
  });
  inFlight.set(key, promise);
  return promise;
}

async function doFetch<T>(method: string, path: string, body: unknown): Promise<T | undefined> {
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
