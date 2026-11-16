// ============================================================================
// lib/tmdb.js  –  Dostęp do TMDB API (proxy + wywołania serwerowe)
//
//   • whitelist ścieżek   – proxy obsługuje tylko zasoby używane przez frontend,
//   • cache TTL w pamięci – TMDB zmienia się wolno; ogranicza liczbę zapytań (NFR),
//   • timeout (AbortController, 8 s) – obejmuje połączenie, nagłówki i odczyt treści.
// Klucz API doklejany wyłącznie tutaj — nigdy nie trafia do przeglądarki.
// ============================================================================

import { createTtlCache } from './ttlCache.js';

const TMDB_BASE    = 'https://api.themoviedb.org/3';
const TIMEOUT_MS   = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;   // 10 min — popularne/szczegóły zmieniają się wolno
const CACHE_MAX    = 500;

// Dozwolone prefiksy ścieżek (wszystko, czego używa frontend). Reszta → 403.
const ALLOWED_PREFIXES = ['/movie', '/discover', '/search', '/trending', '/genre'];

export function isAllowedTmdbPath(path) {
  return ALLOWED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

// Wspólny cache odpowiedzi OK dla proxy i wywołań serwerowych: URL → { status, data }.
const cache = createTtlCache({ ttlMs: CACHE_TTL_MS, maxEntries: CACHE_MAX });

function tmdbUrl(path, params) {
  return `${TMDB_BASE}${path}?${params}`;
}

// Zapytanie z limitem czasu na całość: `read(res)` (np. odczyt JSON) działa jeszcze pod
// licznikiem, więc zawieszona treść odpowiedzi też kończy się AbortError (→ 504).
async function fetchWithTimeout(url, read) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await read(await fetch(url, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

// Wyjątek komunikacji z TMDB → { status, error }: timeout → 504, pozostałe → 502.
export function tmdbFailure(err, message) {
  const timedOut = err?.name === 'AbortError';
  return { status: timedOut ? 504 : 502, error: timedOut ? 'TMDB nie odpowiada (timeout)' : message };
}

// Proxy: zwraca { status, data, cached } (zachowuje kod statusu TMDB). Cache tylko odpowiedzi OK.
export async function tmdbProxy(path, searchParams = {}) {
  const params = new URLSearchParams(searchParams);
  // Filtr treści list /search i /discover: include_adult=false wymuszane po stronie
  // serwera (parametr z przeglądarki jest nadpisywany).
  if (path.startsWith('/search') || path.startsWith('/discover')) params.set('include_adult', 'false');
  params.set('api_key', process.env.TMDB_API_KEY);
  const url = tmdbUrl(path, params);

  const hit = cache.get(url);
  if (hit) return { status: hit.status, data: hit.data, cached: true };

  const { ok, status, data } = await fetchWithTimeout(url, async (res) => ({
    ok: res.ok, status: res.status, data: await res.json(),
  }));
  if (ok) cache.set(url, { status, data });
  return { status, data, cached: false };
}

// Wywołanie serwerowe: rzuca błąd z polem .status przy !ok (do mapowania 404 itp.).
// { cache: false } — pomija wspólny cache (np. klasyfikacje wiekowe mają własny).
export async function tmdbFetch(path, params = {}, { cache: useCache = true } = {}) {
  const url = tmdbUrl(path, new URLSearchParams({ language: 'pl', ...params, api_key: process.env.TMDB_API_KEY }));

  const hit = useCache ? cache.get(url) : undefined;
  if (hit) return hit.data;

  const { status, data } = await fetchWithTimeout(url, async (res) => {
    if (!res.ok) throw Object.assign(new Error(`TMDB ${res.status}`), { status: res.status });
    return { status: res.status, data: await res.json() };
  });
  if (useCache) cache.set(url, { status, data });
  return data;
}
