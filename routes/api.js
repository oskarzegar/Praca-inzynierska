// ============================================================================
// routes/api.js  –  Publiczne REST API: konfiguracja, filmy (TMDB), profile,
// statystyki oglądania i rekomendacje.
// ============================================================================

import { Router } from 'express';
import {
  SB_URL, SB_ANON, SB_SERVICE, cleanEnv,
  sbFetch, sbFetchAsUser, getAuthUser, bearerToken,
  projectRefFromKey, projectRefFromUrl,
} from '../lib/supabaseRest.js';
import { tmdbFetch, tmdbFailure } from '../lib/tmdb.js';
import { resolveSiteUrl } from '../lib/siteUrl.js';
import { getAgeRatings, parseIds, MAX_IDS } from '../lib/ageRatingsService.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { getMovieMeta, aggregateWatchStats, MAX_STATS_MOVIES } from '../lib/watchStats.js';
import {
  excludedMovieIds, pickSourceMovies, rankRecommendations, REC_HISTORY_LIMIT,
} from '../lib/recommendations.js';

const router = Router();

const PROFILE_NOT_FOUND = { error: 'Profil nie znaleziony' };

// Każde ID w /movies/age-ratings to potencjalne zapytanie do TMDB — limit liczony w ID.
// Strona główna to ~100 ID, więc 1500/min nie przeszkadza w normalnym przeglądaniu.
const ageRatingsLimiter = createRateLimiter({
  limit:   1500,
  cost:    (req) => parseIds(req.query.ids).length,
  message: 'Zbyt wiele zapytań o klasyfikacje wiekowe. Spróbuj za chwilę.',
});

// ── Pomocniki ───────────────────────────────────────────────────────────────

// UUID właściciela tokenu JWT (lub null) — bramka prywatności statystyk i rekomendacji.
async function tokenOwnerId(token) {
  return (await getAuthUser(token))?.id || null;
}

// Błąd TMDB: 404 → „nie znaleziono"; pozostałe są logowane i mapowane na 502/504.
function sendTmdbError(res, err, message) {
  if (err?.status === 404) return res.status(404).json({ error: 'Nie znaleziono zasobu w TMDB' });
  console.error(`${message}:`, err?.message || err);
  const { status, error } = tmdbFailure(err, message);
  return res.status(status).json({ error });
}

// Błąd Supabase lub obliczeń → wpis w logu + 500 z komunikatem trasy.
function sendServerError(res, err, logLabel, message) {
  console.error(`${logLabel}:`, err.message);
  return res.status(500).json({ error: message });
}

// true, gdy surowa wartość env różni się od oczyszczonej (spacje, cudzysłowy, końcowy „/").
function neededCleanup(raw, cleaned) {
  return Boolean(raw) && raw !== cleaned;
}

// Publiczna lista użytkownika (watchlist / watched): 404 bez profilu, 403 gdy prywatna.
function publicListRoute({ visibilityColumn, table, select, order, logLabel, errorMessage }) {
  return asyncHandler(async (req, res) => {
    try {
      const profiles = await sbFetch('profiles', { id: `eq.${req.params.id}`, select: visibilityColumn });
      if (!profiles.length)               return res.status(404).json(PROFILE_NOT_FOUND);
      if (!profiles[0][visibilityColumn]) return res.status(403).json({ error: 'Lista jest prywatna' });

      res.json(await sbFetch(table, { user_id: `eq.${req.params.id}`, select, order }));
    } catch (err) {
      sendServerError(res, err, logLabel, errorMessage);
    }
  });
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
// Diagnostyka konfiguracji wdrożenia — flagi (true/false/null) i nazwa środowiska
// (runtime); żadnych sekretów. keysMatchProject=false: klucze z innego projektu
// Supabase niż SUPABASE_URL.
router.get('/health', (_req, res) => {
  const urlRef = projectRefFromUrl(SB_URL);
  const refs   = [projectRefFromKey(SB_ANON), projectRefFromKey(SB_SERVICE)].filter(Boolean);
  res.set('Cache-Control', 'no-store').json({
    ok: Boolean(SB_URL && SB_ANON && process.env.TMDB_API_KEY),
    runtime:            process.env.VERCEL ? `vercel:${process.env.VERCEL_ENV || 'unknown'}` : 'node',
    supabaseUrlSet:     Boolean(SB_URL),
    supabaseUrlValid:   /^https:\/\/[^/\s]+$/.test(SB_URL || ''),
    anonKeySet:         Boolean(SB_ANON),
    serviceKeySet:      Boolean(SB_SERVICE),
    keysMatchProject:   urlRef && refs.length ? refs.every((r) => r === urlRef) : null,
    envNeededCleanup: {
      supabaseUrl: neededCleanup(process.env.SUPABASE_URL, SB_URL),
      anonKey:     neededCleanup(process.env.SUPABASE_ANON_KEY, SB_ANON),
      serviceKey:  neededCleanup(process.env.SUPABASE_SERVICE_ROLE_KEY, SB_SERVICE),
    },
    siteUrlConfigured:  Boolean(resolveSiteUrl()),
    cronSecretSet:      Boolean(cleanEnv(process.env.CRON_SECRET)),
    tmdbKeySet:         Boolean(process.env.TMDB_API_KEY),
  });
});

// ── 0c. GET /api/movies/age-ratings?ids=1,2,3 ────────────────────────────────
// Musi być zarejestrowane PRZED /movies/:id, inaczej „age-ratings" byłoby traktowane jak ID.
router.get('/movies/age-ratings', ageRatingsLimiter, asyncHandler(async (req, res) => {
  const ids = parseIds(req.query.ids);
  if (!ids.length) {
    return res.status(400).json({ error: `Parametr ids jest wymagany (maks. ${MAX_IDS} liczb oddzielonych przecinkami)` });
  }
  try {
    const ratings = await getAgeRatings(ids);
    const failed  = ids.filter((id) => ratings[id] === null).length;
    if (failed === ids.length) {
      return res.status(502).json({ error: 'TMDB nie odpowiada — nie udało się sprawdzić klasyfikacji' });
    }
    // Wynik częściowy (część ID z błędem) nie może trafić do cache przeglądarki/CDN
    res.set('Cache-Control', failed ? 'no-store' : 'public, max-age=3600').json({ ratings });
  } catch (err) {
    console.error('Age ratings error:', err?.message || err);
    res.status(502).json({ error: 'Błąd pobierania klasyfikacji wiekowych' });
  }
}));

// ── 1. GET /api/movies/popular ────────────────────────────────────────────────
router.get('/movies/popular', asyncHandler(async (req, res) => {
  try {
    res.json(await tmdbFetch('/discover/movie', { sort_by: 'popularity.desc', page: req.query.page || 1 }));
  } catch (err) {
    sendTmdbError(res, err, 'Błąd pobierania popularnych filmów');
  }
}));

// ── 2. GET /api/movies/search ─────────────────────────────────────────────────
router.get('/movies/search', asyncHandler(async (req, res) => {
  const { query, page = 1 } = req.query;
  if (!query) return res.status(400).json({ error: 'Parametr query jest wymagany' });
  try {
    res.json(await tmdbFetch('/search/movie', { query, page }));
  } catch (err) {
    sendTmdbError(res, err, 'Błąd wyszukiwania filmów');
  }
}));

// ── 3. GET /api/movies/:id ────────────────────────────────────────────────────
router.get('/movies/:id', asyncHandler(async (req, res) => {
  try {
    // 'credits' to udokumentowany klucz TMDB (zamiast reliktu 'casts')
    res.json(await tmdbFetch(`/movie/${req.params.id}`, { append_to_response: 'credits,videos' }));
  } catch (err) {
    sendTmdbError(res, err, 'Błąd pobierania szczegółów filmu');
  }
}));

// ── 4. GET /api/movies/:id/reviews ───────────────────────────────────────────
router.get('/movies/:id/reviews', asyncHandler(async (req, res) => {
  try {
    res.json(await sbFetch('reviews', {
      movie_id: `eq.${req.params.id}`,
      select:   'id,movie_title,rating_plot,rating_acting,rating_music,rating_effects,review_text,is_spoiler,created_at,profiles(id,display_name,avatar_url)',
      order:    'created_at.desc',
    }));
  } catch (err) {
    sendServerError(res, err, 'Reviews fetch', 'Błąd pobierania recenzji');
  }
}));

// ── 5. GET /api/profiles/:id ──────────────────────────────────────────────────
router.get('/profiles/:id', asyncHandler(async (req, res) => {
  try {
    const profiles = await sbFetch('profiles', {
      id:     `eq.${req.params.id}`,
      select: 'id,display_name,avatar_url,watchlist_public,watched_public,created_at',
    });
    if (!profiles.length) return res.status(404).json(PROFILE_NOT_FOUND);
    res.json(profiles[0]);
  } catch (err) {
    sendServerError(res, err, 'Profile fetch', 'Błąd pobierania profilu');
  }
}));

// ── 6–7. GET /api/profiles/:id/watchlist | /watched ──────────────────────────
router.get('/profiles/:id/watchlist', publicListRoute({
  visibilityColumn: 'watchlist_public',
  table:            'watchlist',
  select:           'movie_id,movie_title,poster_path,added_at',
  order:            'added_at.desc',
  logLabel:         'Watchlist fetch',
  errorMessage:     'Błąd pobierania listy do obejrzenia',
}));

router.get('/profiles/:id/watched', publicListRoute({
  visibilityColumn: 'watched_public',
  table:            'watched',
  select:           'movie_id,movie_title,poster_path,watched_at',
  order:            'watched_at.desc',
  logLabel:         'Watched fetch',
  errorMessage:     'Błąd pobierania listy obejrzanych',
}));

// ── 7b. GET /api/profiles/:id/stats ──────────────────────────────────────────
// Statystyki (WF-14) liczone w locie z listy `watched` + danych TMDB.
// Własne widzi właściciel (token); cudze tylko gdy watched_public=true.
router.get('/profiles/:id/stats', asyncHandler(async (req, res) => {
  const profileId = req.params.id;
  const token     = bearerToken(req);

  try {
    const profiles = await sbFetch('profiles', { id: `eq.${profileId}`, select: 'watched_public' });
    if (!profiles.length) return res.status(404).json(PROFILE_NOT_FOUND);

    const isPublic = profiles[0].watched_public;
    const isOwner  = (await tokenOwnerId(token)) === profileId;
    if (!isPublic && !isOwner) return res.status(403).json({ error: 'Statystyki są prywatne' });

    // Właściciel czyta własną listę swoim tokenem (RLS); publiczne listy — kluczem anon
    const query   = { user_id: `eq.${profileId}`, select: 'movie_id' };
    const watched = isOwner ? await sbFetchAsUser(token, 'watched', query) : await sbFetch('watched', query);
    if (!watched.length) {
      return res.json({ watchedCount: 0, totalRuntimeMinutes: 0, genres: [], decades: [] });
    }

    const ids   = watched.map(w => w.movie_id).slice(0, MAX_STATS_MOVIES);
    const metas = (await Promise.all(ids.map(getMovieMeta))).filter(Boolean);
    const { totalRuntime, genres, decades } = aggregateWatchStats(metas);

    res.json({
      watchedCount:        watched.length,
      moviesCounted:       metas.length,                  // ile filmów faktycznie policzono
      incomplete:          metas.length < ids.length,     // część danych TMDB mogła się nie pobrać
      totalRuntimeMinutes: totalRuntime,
      genres,
      decades,
    });
  } catch (err) {
    sendServerError(res, err, 'Stats error', 'Błąd obliczania statystyk');
  }
}));

// ── 8. GET /api/recommendations ──────────────────────────────────────────────
// Rekomendacje TMDB dla filmów źródłowych (oceny + historia) z własnym rankingiem.
// Tożsamość wynika z tokenu JWT, nie z parametru — bezpieczeństwo nie zależy od query.
router.get('/recommendations', asyncHandler(async (req, res) => {
  const userToken = bearerToken(req);
  if (!userToken) return res.status(401).json({ error: 'Brak tokenu autoryzacji' });

  const userId = await tokenOwnerId(userToken);
  if (!userId) return res.status(401).json({ error: 'Nieprawidłowy lub wygasły token' });

  try {
    const [watchedData, reviewsData, watchlistData] = await Promise.all([
      sbFetchAsUser(userToken, 'watched',   { user_id: `eq.${userId}`, select: 'movie_id', order: 'watched_at.desc', limit: REC_HISTORY_LIMIT }),
      sbFetchAsUser(userToken, 'reviews',   { user_id: `eq.${userId}`, select: 'movie_id,rating_plot,rating_acting,rating_music,rating_effects' }),
      sbFetchAsUser(userToken, 'watchlist', { user_id: `eq.${userId}`, select: 'movie_id' }),
    ]);

    // Wykluczenia i źródła liczone przed zapytaniami do TMDB: błędne dane z Supabase
    // przerywają trasę, zanim cokolwiek trafi do TMDB.
    const excluded = excludedMovieIds(watchedData, watchlistData);
    const sources  = pickSourceMovies(reviewsData, watchedData);
    if (!sources.length) return res.json({ results: [] });

    // Pojedyncze źródło może paść — degradujemy łagodnie (pusta lista), ale logujemy
    const recommendationLists = await Promise.all(sources.map(id =>
      tmdbFetch(`/movie/${id}/recommendations`, { page: 1 })
        .catch(err => { console.error(`recommendations source ${id}:`, err?.message || err); return { results: [] }; })));

    res.json({ results: rankRecommendations(recommendationLists, excluded) });
  } catch (err) {
    sendServerError(res, err, 'Recommendations error', 'Błąd pobierania rekomendacji');
  }
}));

export default router;
