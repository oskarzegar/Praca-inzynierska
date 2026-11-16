'use strict';

// ============================================================================
// routes/cron.js  –  Zadania cykliczne wywoływane przez Vercel Cron
//
// Vercel Cron wysyła GET na ścieżkę z vercel.json i — gdy w projekcie ustawiono
// zmienną CRON_SECRET — dokleja nagłówek „Authorization: Bearer <CRON_SECRET>".
// Bez skonfigurowanego sekretu endpoint odmawia (nie da się go wyzwolić z zewnątrz).
// Endpoint jest celowo POZA /api/admin (tam obowiązuje JWT użytkownika + RBAC).
// ============================================================================

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { cleanEnv, bearerToken } from '../lib/supabaseRest.js';
import { sweepExpiredSanctions } from '../lib/sanctionSweep.js';

const router = Router();

// Vercel wysyła w nagłówku DOKŁADNIE wartość zmiennej CRON_SECRET (np. z cudzysłowami,
// jeśli ktoś je wkleił). Akceptujemy więc wartość surową (po trim) i oczyszczoną.
function secretCandidates(raw) {
  return [...new Set([typeof raw === 'string' ? raw.trim() : undefined, cleanEnv(raw)].filter(Boolean))];
}

export function isAuthorizedCron(req, rawSecret = process.env.CRON_SECRET) {
  const candidates = secretCandidates(rawSecret);
  if (!candidates.length) return false;
  const given = bearerToken(req);
  if (!given) return false;
  const a = Buffer.from(given);
  return candidates.some((secret) => {
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

function requireCronSecret(req, res, next) {
  if (!cleanEnv(process.env.CRON_SECRET)) {
    return res.status(503).json({ error: 'CRON_SECRET nie jest skonfigurowany na serwerze' });
  }
  if (!isAuthorizedCron(req)) return res.status(401).json({ error: 'Brak autoryzacji crona' });
  next();
}

// GET /api/cron/sweep-sanctions — zdejmuje wygasłe kary (account_status → active, muted_until → NULL)
router.get('/sweep-sanctions', requireCronSecret, async (_req, res) => {
  const result = await sweepExpiredSanctions();
  res.set('Cache-Control', 'no-store').status(result.ok ? 200 : 500).json(result);
});

export default router;
