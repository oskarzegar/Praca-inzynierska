// ============================================================================
// lib/watchStats.js  –  Statystyki oglądania (WF-14): metadane filmów z TMDB
// oraz łączny czas i rozkład gatunków i dekad. Listę filmów pobiera trasa
// (routes/api.js) — tu jest wyłącznie logika liczenia.
// ============================================================================

import { tmdbFetch } from './tmdb.js';

export const MAX_STATS_MOVIES = 250;   // limit filmów w statystykach — chroni TMDB przed lawiną zapytań

// Metadane filmu potrzebne do statystyk (cache zapewnia tmdbFetch). null = błąd TMDB.
export async function getMovieMeta(movieId) {
  try {
    const d = await tmdbFetch(`/movie/${movieId}`);
    return {
      runtime: d.runtime || 0,
      genres:  (d.genres || []).map(g => g.name),
      year:    d.release_date ? Number(d.release_date.slice(0, 4)) : null,
    };
  } catch (err) {
    console.error(`getMovieMeta(${movieId}):`, err?.message || err);
    return null;
  }
}

// Łączny czas oraz rozkład gatunków i dekad. Remisy w sortowaniu zachowują
// kolejność pierwszego wystąpienia (Map + stabilny sort).
export function aggregateWatchStats(metas) {
  let totalRuntime = 0;
  const genres  = new Map();
  const decades = new Map();
  const bump = (counts, key) => counts.set(key, (counts.get(key) || 0) + 1);

  for (const meta of metas) {
    totalRuntime += meta.runtime;
    for (const name of meta.genres) bump(genres, name);
    if (meta.year) bump(decades, Math.floor(meta.year / 10) * 10);
  }
  return {
    totalRuntime,
    genres:  Array.from(genres, ([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    decades: Array.from(decades, ([decade, count]) => ({ decade, count })).sort((a, b) => a.decade - b.decade),
  };
}
