'use strict';

import { Router } from 'express';
import {
  SB_URL, SB_ANON, SB_SERVICE, cleanEnv,
  sbFetch, sbFetchAsUser, getAuthUser, bearerToken,
  projectRefFromKey, projectRefFromUrl,
} from '../lib/supabaseRest.js';
import { tmdbFetch } from '../lib/tmdb.js';
import { resolveSiteUrl } from '../lib/siteUrl.js';
import { getAgeRatings, parseIds, MAX_IDS } from '../lib/ageRatingsService.js';
import { createRateLimiter } from '../lib/rateLimit.js';

// Każde ID w /movies/age-ratings to potencjalne zapytanie do TMDB — limit liczony w ID.
// Strona główna to ~100 ID, więc 1500/min nie przeszkadza w normalnym przeglądaniu.
const ageRatingsLimiter = createRateLimiter({
  limit:   1500,
  cost:    (req) => parseIds(req.query.ids).length,
  message: 'Zbyt wiele zapytań o klasyfikacje wiekowe. Spróbuj za chwilę.',
});

const router = Router();

// Zwraca UUID właściciela tokenu JWT (lub null) — bramka prywatności statystyk
async function authUserId(token) {
  return (await getAuthUser(token))?.id || null;
}

// Spójna obsługa błędów TMDB: rozróżnia 404, timeout (504) i błąd bramy (502); loguje.
function sendTmdbError(res, err, message) {
  if (err?.status === 404) return res.status(404).json({ error: 'Nie znaleziono zasobu w TMDB' });
  console.error(`${message}:`, err?.message || err);
  const aborted = err?.name === 'AbortError';
  return res.status(aborted ? 504 : 502).json({ error: aborted ? 'TMDB nie odpowiada (timeout)' : message });
}

// Wyciąga z TMDB metadane potrzebne do statystyk (runtime/gatunki/rok).
// Buforowanie obsługuje tmdbFetch (lib/tmdb.js: cache z TTL i limitem) — bez własnej,
// nieograniczonej mapy, która przy długim uptime byłaby wyciekiem pamięci.
async function getMovieMeta(movieId) {
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

// ── 0. GET /api/config ───────────────────────────────────────────────────────
// siteUrl: publiczny adres aplikacji dla linków w e-mailach auth (null → frontend
// użyje window.location.origin). Wartości env są oczyszczone (spacje, cudzysłowy, „/").
router.get('/config', (_req, res) => {
  res.json({
    supabaseUrl:     SB_URL,
    supabaseAnonKey: SB_ANON,
    siteUrl:         resolveSiteUrl(),
  });
});

// ── 0b. GET /api/health ──────────────────────────────────────────────────────
// Diagnostyka konfiguracji wdrożenia (np. Vercel) — WYŁĄCZNIE wartości logiczne,
// żadnych sekretów. keysMatchProject=false oznacza klucze z innego projektu Supabase
// niż SUPABASE_URL (typowa przyczyna „Nieprawidłowy lub wygasły token" na produkcji).
router.get('/health', (_req, res) => {
  const urlRef     = projectRefFromUrl(SB_URL);
  const anonRef    = projectRefFromKey(SB_ANON);
  const serviceRef = projectRefFromKey(SB_SERVICE);
  const refs       = [anonRef, serviceRef].filter(Boolean);
  res.set('Cache-Control', 'no-store').json({
    ok: Boolean(SB_URL && SB_ANON && process.env.TMDB_API_KEY),
    runtime:            process.env.VERCEL ? `vercel:${process.env.VERCEL_ENV || 'unknown'}` : 'node',
    supabaseUrlSet:     Boolean(SB_URL),
    supabaseUrlValid:   /^https:\/\/[^/\s]+$/.test(SB_URL || ''),
    anonKeySet:         Boolean(SB_ANON),
    serviceKeySet:      Boolean(SB_SERVICE),
    keysMatchProject:   urlRef && refs.length ? refs.every((r) => r === urlRef) : null,
    // true = surowa wartość w env miała spacje/nową linię/cudzysłowy/końcowy „/" (teraz
    // normalizowane). Przed poprawką taki SUPABASE_URL dawał „Nieprawidłowy lub wygasły token".
    envNeededCleanup: {
      supabaseUrl: Boolean(process.env.SUPABASE_URL) && process.env.SUPABASE_URL !== SB_URL,
      anonKey:     Boolean(process.env.SUPABASE_ANON_KEY) && process.env.SUPABASE_ANON_KEY !== SB_ANON,
      serviceKey:  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) && process.env.SUPABASE_SERVICE_ROLE_KEY !== SB_SERVICE,
    },
    siteUrlConfigured:  Boolean(resolveSiteUrl()),
    cronSecretSet:      Boolean(cleanEnv(process.env.CRON_SECRET)),
    tmdbKeySet:         Boolean(process.env.TMDB_API_KEY),
  });
});

// ── 0c. GET /api/movies/age-ratings?ids=1,2,3 ────────────────────────────────
// Klasyfikacje wiekowe dla paczki filmów (filtr treści na kartach). Musi być
// zarejestrowane PRZED /movies/:id, inaczej „age-ratings" zostałoby potraktowane jak ID.
router.get('/movies/age-ratings', ageRatingsLimiter, async (req, res) => {
  const ids = parseIds(req.query.ids);
  if (!ids.length) return res.status(400).json({ error: `Parametr ids jest wymagany (maks. ${MAX_IDS} liczb oddzielonych przecinkami)` });
  try {
    const ratings = await getAgeRatings(ids);
    const failed  = ids.filter((id) => ratings[id] === null).length;
    if (failed === ids.length) return res.status(502).json({ error: 'TMDB nie odpowiada — nie udało się sprawdzić klasyfikacji' });
    // Wynik częściowy (część ID z błędem) nie może trafić do cache przeglądarki/CDN
    res.set('Cache-Control', failed ? 'no-store' : 'public, max-age=3600').json({ ratings });
  } catch (err) {
    console.error('Age ratings error:', err?.message || err);
    res.status(502).json({ error: 'Błąd pobierania klasyfikacji wiekowych' });
  }
});

// ── 1. GET /api/movies/popular ────────────────────────────────────────────────
router.get('/movies/popular', async (req, res) => {
  try {
    const data = await tmdbFetch('/discover/movie', {
      sort_by: 'popularity.desc',
      page: req.query.page || 1,
    });
    res.json(data);
  } catch (err) {
    sendTmdbError(res, err, 'Błąd pobierania popularnych filmów');
  }
});

// ── 2. GET /api/movies/search ─────────────────────────────────────────────────
router.get('/movies/search', async (req, res) => {
  const { query, page = 1 } = req.query;
  if (!query) return res.status(400).json({ error: 'Parametr query jest wymagany' });
  try {
    const data = await tmdbFetch('/search/movie', { query, page });
    res.json(data);
  } catch (err) {
    sendTmdbError(res, err, 'Błąd wyszukiwania filmów');
  }
});

// ── 3. GET /api/movies/:id ────────────────────────────────────────────────────
router.get('/movies/:id', async (req, res) => {
  try {
    const data = await tmdbFetch(`/movie/${req.params.id}`, {
      append_to_response: 'credits,videos',   // 'credits' to udokumentowany klucz TMDB (zamiast reliktu 'casts')
    });
    res.json(data);
  } catch (err) {
    sendTmdbError(res, err, 'Błąd pobierania szczegółów filmu');
  }
});

// ── 4. GET /api/movies/:id/reviews ───────────────────────────────────────────
router.get('/movies/:id/reviews', async (req, res) => {
  try {
    const data = await sbFetch('reviews', {
      movie_id: `eq.${req.params.id}`,
      select: 'id,movie_title,rating_plot,rating_acting,rating_music,rating_effects,review_text,is_spoiler,created_at,profiles(id,display_name,avatar_url)',
      order: 'created_at.desc',
    });
    res.json(data);
  } catch (err) {
    console.error('Reviews fetch:', err.message);
    res.status(500).json({ error: 'Błąd pobierania recenzji' });
  }
});

// ── 5. GET /api/profiles/:id ──────────────────────────────────────────────────
router.get('/profiles/:id', async (req, res) => {
  try {
    const data = await sbFetch('profiles', {
      id: `eq.${req.params.id}`,
      select: 'id,display_name,avatar_url,watchlist_public,watched_public,created_at',
    });
    if (!data.length) return res.status(404).json({ error: 'Profil nie znaleziony' });
    res.json(data[0]);
  } catch (err) {
    console.error('Profile fetch:', err.message);
    res.status(500).json({ error: 'Błąd pobierania profilu' });
  }
});

// ── 6. GET /api/profiles/:id/watchlist ───────────────────────────────────────
router.get('/profiles/:id/watchlist', async (req, res) => {
  try {
    const profiles = await sbFetch('profiles', {
      id: `eq.${req.params.id}`,
      select: 'watchlist_public',
    });
    if (!profiles.length)         return res.status(404).json({ error: 'Profil nie znaleziony' });
    if (!profiles[0].watchlist_public) return res.status(403).json({ error: 'Lista jest prywatna' });

    const data = await sbFetch('watchlist', {
      user_id: `eq.${req.params.id}`,
      select: 'movie_id,movie_title,poster_path,added_at',
      order: 'added_at.desc',
    });
    res.json(data);
  } catch (err) {
    console.error('Watchlist fetch:', err.message);
    res.status(500).json({ error: 'Błąd pobierania listy do obejrzenia' });
  }
});

// ── 7. GET /api/profiles/:id/watched ─────────────────────────────────────────
router.get('/profiles/:id/watched', async (req, res) => {
  try {
    const profiles = await sbFetch('profiles', {
      id: `eq.${req.params.id}`,
      select: 'watched_public',
    });
    if (!profiles.length)       return res.status(404).json({ error: 'Profil nie znaleziony' });
    if (!profiles[0].watched_public) return res.status(403).json({ error: 'Lista jest prywatna' });

    const data = await sbFetch('watched', {
      user_id: `eq.${req.params.id}`,
      select: 'movie_id,movie_title,poster_path,watched_at',
      order: 'watched_at.desc',
    });
    res.json(data);
  } catch (err) {
    console.error('Watched fetch:', err.message);
    res.status(500).json({ error: 'Błąd pobierania listy obejrzanych' });
  }
});

// ── 7b. GET /api/profiles/:id/stats ──────────────────────────────────────────
// Rozbudowane statystyki (WF-14): czas oglądania, rozkład gatunków i dekad.
// Statistics to model logiczny — liczony w locie z listy `watched` + danych TMDB.
// Własne statystyki widzi właściciel (token); cudze tylko gdy watched_public=true.
router.get('/profiles/:id/stats', async (req, res) => {
  const profileId = req.params.id;
  const token     = bearerToken(req);

  try {
    const profiles = await sbFetch('profiles', { id: `eq.${profileId}`, select: 'watched_public' });
    if (!profiles.length) return res.status(404).json({ error: 'Profil nie znaleziony' });

    const isPublic = profiles[0].watched_public;
    const isOwner  = (await authUserId(token)) === profileId;
    if (!isPublic && !isOwner) return res.status(403).json({ error: 'Statystyki są prywatne' });

    // Właściciel czyta własną listę swoim tokenem (RLS); publiczne listy — kluczem anon
    const watched = isOwner
      ? await sbFetchAsUser(token, 'watched', { user_id: `eq.${profileId}`, select: 'movie_id' })
      : await sbFetch('watched',              { user_id: `eq.${profileId}`, select: 'movie_id' });

    if (!watched.length) {
      return res.json({ watchedCount: 0, totalRuntimeMinutes: 0, genres: [], decades: [] });
    }

    // Limit 250 filmów — chroni proxy TMDB przed lawiną zapytań
    const ids   = watched.map(w => w.movie_id).slice(0, 250);
    const metas = (await Promise.all(ids.map(getMovieMeta))).filter(Boolean);

    let totalRuntime = 0;
    const genreCount  = new Map();
    const decadeCount = new Map();

    for (const m of metas) {
      totalRuntime += m.runtime;
      for (const g of m.genres) genreCount.set(g, (genreCount.get(g) || 0) + 1);
      if (m.year) {
        const decade = Math.floor(m.year / 10) * 10;
        decadeCount.set(decade, (decadeCount.get(decade) || 0) + 1);
      }
    }

    res.json({
      watchedCount:        watched.length,
      moviesCounted:       metas.length,                  // ile filmów faktycznie policzono
      incomplete:          metas.length < ids.length,     // część danych TMDB mogła się nie pobrać
      totalRuntimeMinutes: totalRuntime,
      genres:  [...genreCount].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      decades: [...decadeCount].map(([decade, count]) => ({ decade, count })).sort((a, b) => a.decade - b.decade),
    });
  } catch (err) {
    console.error('Stats error:', err.message);
    res.status(500).json({ error: 'Błąd obliczania statystyk' });
  }
});

// ── 8. GET /api/recommendations ──────────────────────────────────────────────
// Agregacja rekomendacji TMDB z personalizowanym doborem filmów źródłowych
// (na podstawie ocen i historii oglądania) oraz własnym rankingiem.
// Tożsamość wynika z tokenu JWT, nie z parametru — bezpieczeństwo nie zależy od query.
router.get('/recommendations', async (req, res) => {
  const userToken = bearerToken(req);
  if (!userToken) return res.status(401).json({ error: 'Brak tokenu autoryzacji' });

  const userId = await authUserId(userToken);
  if (!userId) return res.status(401).json({ error: 'Nieprawidłowy lub wygasły token' });

  try {
    const [watchedData, reviewsData, watchlistData] = await Promise.all([
      sbFetchAsUser(userToken, 'watched',   { user_id: `eq.${userId}`, select: 'movie_id', order: 'watched_at.desc', limit: 30 }),
      sbFetchAsUser(userToken, 'reviews',   { user_id: `eq.${userId}`, select: 'movie_id,rating_plot,rating_acting,rating_music,rating_effects' }),
      sbFetchAsUser(userToken, 'watchlist', { user_id: `eq.${userId}`, select: 'movie_id' }),
    ]);

    const watchedIds   = new Set(watchedData.map(m => m.movie_id));
    const watchlistIds = new Set(watchlistData.map(m => m.movie_id));
    const excludeIds   = new Set([...watchedIds, ...watchlistIds]);

    // Filmy z dobrymi recenzjami (avg >= 3/5) sortowane malejąco
    const ratedMovies = reviewsData
      .map(r => ({ movieId: r.movie_id, avg: (r.rating_plot + r.rating_acting + r.rating_music + r.rating_effects) / 4 }))
      .filter(r => r.avg >= 3.0)
      .sort((a, b) => b.avg - a.avg);

    // Źródła: max 3 z dobrych recenzji + uzupełnienie ostatnio obejrzanymi, max 5 łącznie
    const sourceSeen   = new Set();
    const sourceMovies = [];
    for (const { movieId } of ratedMovies.slice(0, 3)) {
      sourceSeen.add(movieId); sourceMovies.push(movieId);
    }
    for (const { movie_id } of watchedData) {
      if (sourceMovies.length >= 5) break;
      if (!sourceSeen.has(movie_id)) { sourceSeen.add(movie_id); sourceMovies.push(movie_id); }
    }

    if (sourceMovies.length === 0) return res.json({ results: [] });

    // Pobierz rekomendacje TMDB dla każdego źródła równolegle.
    // Pojedyncze źródło może paść — degradujemy łagodnie (pusta lista), ale logujemy.
    const tmdbResults = await Promise.all(
      sourceMovies.map(id => tmdbFetch(`/movie/${id}/recommendations`, { page: 1 })
        .catch(err => { console.error(`recommendations source ${id}:`, err?.message || err); return { results: [] }; }))
    );

    // Scalenie, deduplikacja i odfiltrowanie już obejrzanych/na liście
    const seen       = new Set();
    const candidates = [];
    for (const { results = [] } of tmdbResults) {
      for (const movie of results) {
        if (!seen.has(movie.id) && !excludeIds.has(movie.id) && movie.poster_path) {
          seen.add(movie.id);
          candidates.push(movie);
        }
      }
    }

    // Ranking: ocena TMDB ważona logarytmem liczby głosów
    candidates.sort((a, b) =>
      b.vote_average * Math.log10(b.vote_count + 10) -
      a.vote_average * Math.log10(a.vote_count + 10)
    );

    res.json({ results: candidates.slice(0, 20) });
  } catch (err) {
    console.error('Recommendations error:', err.message);
    res.status(500).json({ error: 'Błąd pobierania rekomendacji' });
  }
});

export default router;
