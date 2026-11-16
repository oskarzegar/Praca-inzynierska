'use strict';

// ============================================================================
// lib/rateLimit.js  –  Prosty limiter w pamięci (per-IP, okno przesuwne, z wagą)
//
// `cost(req)` pozwala liczyć żądanie jako wiele jednostek — np. endpoint
// klasyfikacji wiekowych kosztuje tyle, ile ID filmów (każde to zapytanie do TMDB).
// Stan jest per instancja procesu (na Vercel: per instancja funkcji) — to ochrona
// przed prostym nadużyciem klucza TMDB, nie twardy limit globalny.
// ============================================================================

export function createRateLimiter({ limit, windowMs = 60 * 1000, cost = () => 1, message }) {
  const hits = new Map();   // ip → [{ t, n }]
  let lastPrune = Date.now();

  return function rateLimit(req, res, next) {
    const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    // Okresowe sprzątanie wpisów nieaktywnych IP (brak wycieku pamięci przy długim uptime)
    if (now - lastPrune > windowMs) {
      for (const [key, list] of hits) if (!list.some((h) => now - h.t < windowMs)) hits.delete(key);
      lastPrune = now;
    }

    const recent = (hits.get(ip) || []).filter((h) => now - h.t < windowMs);
    const used   = recent.reduce((sum, h) => sum + h.n, 0);
    const n      = Math.max(1, Number(cost(req)) || 1);
    if (used + n > limit) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: message || 'Zbyt wiele zapytań. Spróbuj za chwilę.' });
    }
    recent.push({ t: now, n });
    hits.set(ip, recent);
    next();
  };
}
