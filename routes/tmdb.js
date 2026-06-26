'use strict';

// ============================================================================
// routes/tmdb.js  –  Proxy do TMDB (klucz API doklejany po stronie serwera)
//
// Zabezpieczenia (wcześniej był to otwarty proxy do całego TMDB):
//   • whitelist ścieżek – tylko zasoby używane przez aplikację,
//   • rate limit per-IP  – ochrona klucza przed nadużyciem,
//   • cache + timeout    – w lib/tmdb.js.
// ============================================================================

import { Router } from 'express';
import { tmdbProxy, isAllowedTmdbPath } from '../lib/tmdb.js';

const router = Router();

// ── Prosty limiter w pamięci (per-IP, okno przesuwne) ───────────────────────
// Próg jest hojny, by nie blokować normalnych „wybuchów" żądań przy ładowaniu stron,
// a jednocześnie zatrzymać zautomatyzowane nadużycie klucza.
const RATE_LIMIT     = 600;          // maks. żądań
const RATE_WINDOW_MS = 60 * 1000;    // w oknie 60 s
const hits = new Map();              // ip → number[] (znaczniki czasu żądań)

function rateLimit(req, res, next) {
  const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    return res.status(429).json({ error: 'Zbyt wiele zapytań do TMDB. Spróbuj za chwilę.' });
  }
  recent.push(now);
  hits.set(ip, recent);
  next();
}

router.get('*', rateLimit, async (req, res) => {
  if (!isAllowedTmdbPath(req.path)) {
    return res.status(403).json({ error: 'Niedozwolona ścieżka TMDB' });
  }
  try {
    const { status, data } = await tmdbProxy(req.path, req.query);
    res.status(status).json(data);
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    res
      .status(aborted ? 504 : 502)
      .json({ error: aborted ? 'TMDB nie odpowiada (timeout)' : 'Błąd komunikacji z TMDB' });
  }
});

export default router;
