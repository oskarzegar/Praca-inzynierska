'use strict';

// ============================================================================
// lib/tmdb.js  –  Dostęp do TMDB API (proxy + wywołania serwerowe)
//
// Centralizuje komunikację z TMDB i wprowadza zabezpieczenia/optymalizacje,
// których brakowało w otwartym proxy:
//   • whitelist ścieżek  – proxy obsługuje tylko potrzebne zasoby (nie cały TMDB),
//   • cache TTL w pamięci – TMDB zmienia się wolno; ogranicza liczbę zapytań (NFR),
//   • timeout (AbortController) – padnięcie TMDB nie wiesza żądania.
// Klucz API doklejany wyłącznie tutaj — nigdy nie trafia do przeglądarki.
// ============================================================================

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;   // 10 min — popularne/szczegóły zmieniają się wolno
const CACHE_MAX = 500;

// Dozwolone prefiksy ścieżek (wszystko, czego używa frontend). Reszta → 403.
const ALLOWED_PREFIXES = ['/movie', '/discover', '/search', '/trending', '/genre'];

export function isAllowedTmdbPath(path) {
  return ALLOWED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`)
  );
}

// ── Cache TTL z prostą eliminacją najstarszych wpisów ───────────────────────
const cache = new Map();   // url → { status, data, exp }

function cacheGet(url) {
  const hit = cache.get(url);
  if (!hit) return null;
  if (hit.exp <= Date.now()) { cache.delete(url); return null; }
  return hit;
}

function cacheSet(url, value) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
  cache.set(url, value);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Proxy: zwraca { status, data } (zachowuje kod statusu TMDB). Cache tylko odpowiedzi OK.
export async function tmdbProxy(path, searchParams = {}) {
  const params = new URLSearchParams(searchParams);
  // Filtr treści: aplikacja nigdy nie pokazuje filmów oznaczonych w TMDB jako „adult"
  // (pornografia). Wymuszone po stronie serwera — parametr z przeglądarki jest nadpisywany.
  if (path.startsWith('/search') || path.startsWith('/discover')) params.set('include_adult', 'false');
  params.set('api_key', process.env.TMDB_API_KEY);
  const url = `${TMDB_BASE}${path}?${params}`;

  const hit = cacheGet(url);
  if (hit) return { status: hit.status, data: hit.data, cached: true };

  const res = await fetchWithTimeout(url);
  const data = await res.json();
  if (res.ok) cacheSet(url, { status: res.status, data, exp: Date.now() + CACHE_TTL_MS });
  return { status: res.status, data, cached: false };
}

// Wywołanie serwerowe: rzuca błąd z polem .status przy !ok (do mapowania 404 itp.).
// { cache: false } — pomija wspólny cache (np. klasyfikacje wiekowe mają własny,
// większy cache i nie powinny wypłukiwać z tego list i szczegółów filmów).
export async function tmdbFetch(path, params = {}, { cache = true } = {}) {
  const p = new URLSearchParams({ language: 'pl', ...params, api_key: process.env.TMDB_API_KEY });
  const url = `${TMDB_BASE}${path}?${p}`;

  if (cache) {
    const hit = cacheGet(url);
    if (hit) return hit.data;
  }

  const res = await fetchWithTimeout(url);
  if (!res.ok) throw Object.assign(new Error(`TMDB ${res.status}`), { status: res.status });
  const data = await res.json();
  if (cache) cacheSet(url, { status: res.status, data, exp: Date.now() + CACHE_TTL_MS });
  return data;
}
