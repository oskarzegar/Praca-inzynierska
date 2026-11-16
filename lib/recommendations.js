// ============================================================================
// lib/recommendations.js  –  Logika rekomendacji: wykluczenia, wybór filmów
// źródłowych i ranking kandydatów z TMDB. Same czyste funkcje — zapytania do
// Supabase i TMDB wykonuje trasa (routes/api.js).
// ============================================================================

export const REC_HISTORY_LIMIT = 30;   // ostatnio obejrzane filmy brane pod uwagę
const MAX_RATED_SOURCES = 3;           // źródła z własnych ocen…
const MIN_SOURCE_RATING = 3.0;         // …o średniej ocen ≥ 3/5
const MAX_REC_SOURCES   = 5;           // źródła łącznie (oceny + ostatnio obejrzane)
const MAX_REC_RESULTS   = 20;

// Filmy, których nie polecamy: ostatnio obejrzane (maks. REC_HISTORY_LIMIT — tyle
// pobiera trasa) i zapisane na liście do obejrzenia.
export function excludedMovieIds(watchedData, watchlistData) {
  return new Set(watchedData.map(m => m.movie_id).concat(watchlistData.map(m => m.movie_id)));
}

// Filmy źródłowe rekomendacji: najwyżej ocenione (średnia ≥ MIN_SOURCE_RATING,
// maks. MAX_RATED_SOURCES), uzupełnione ostatnio obejrzanymi bez powtórzeń —
// łącznie maks. MAX_REC_SOURCES.
export function pickSourceMovies(reviewsData, watchedData) {
  const sources = reviewsData
    .map(r => ({ movieId: r.movie_id, avg: (r.rating_plot + r.rating_acting + r.rating_music + r.rating_effects) / 4 }))
    .filter(r => r.avg >= MIN_SOURCE_RATING)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, MAX_RATED_SOURCES)
    .map(r => r.movieId);
  for (const { movie_id } of watchedData) {
    if (sources.length >= MAX_REC_SOURCES) break;
    if (!sources.includes(movie_id)) sources.push(movie_id);
  }
  return sources;
}

// Ranking rekomendacji: ocena TMDB ważona logarytmem liczby głosów.
const weightedRating = (movie) => movie.vote_average * Math.log10(movie.vote_count + 10);

// Scalenie list rekomendacji z deduplikacją (pierwsze wystąpienie wygrywa), bez filmów
// wykluczonych i bez plakatu; ranking wg weightedRating, maks. MAX_REC_RESULTS.
export function rankRecommendations(recommendationLists, excluded) {
  const candidates = new Map();
  for (const { results = [] } of recommendationLists) {
    for (const movie of results) {
      if (candidates.has(movie.id) || excluded.has(movie.id) || !movie.poster_path) continue;
      candidates.set(movie.id, movie);
    }
  }
  return [...candidates.values()]
    .sort((a, b) => weightedRating(b) - weightedRating(a))
    .slice(0, MAX_REC_RESULTS);
}
