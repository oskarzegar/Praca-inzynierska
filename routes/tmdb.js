// ============================================================================
// routes/tmdb.js  –  Proxy do TMDB (klucz API doklejany po stronie serwera)
//
//   • whitelist ścieżek – tylko zasoby używane przez aplikację,
//   • rate limit per-IP  – ochrona klucza przed nadużyciem,
//   • cache + timeout    – w lib/tmdb.js.
// ============================================================================

import { Router } from 'express';
import { tmdbProxy, isAllowedTmdbPath, tmdbFailure } from '../lib/tmdb.js';
import { createRateLimiter } from '../lib/rateLimit.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

// Próg jest hojny (600 żądań / 60 s), by nie blokować „wybuchów" żądań przy ładowaniu
// stron, a jednocześnie zatrzymać zautomatyzowane nadużycie klucza. 429 bez Retry-After.
const rateLimit = createRateLimiter({
  limit:      600,
  message:    'Zbyt wiele zapytań do TMDB. Spróbuj za chwilę.',
  retryAfter: false,
});

router.get('*', rateLimit, asyncHandler(async (req, res) => {
  if (!isAllowedTmdbPath(req.path)) {
    return res.status(403).json({ error: 'Niedozwolona ścieżka TMDB' });
  }
  try {
    const { status, data } = await tmdbProxy(req.path, req.query);
    res.status(status).json(data);
  } catch (err) {
    const { status, error } = tmdbFailure(err, 'Błąd komunikacji z TMDB');
    res.status(status).json({ error });
  }
}));

export default router;
