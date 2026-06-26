'use strict';

// ============================================================================
// routes/admin.js  –  Panel administratora i moderacji (WF-15..WF-18)
//
// Egzekwuje kontrolę dostępu opartą na rolach PO STRONIE SERWERA (wymaganie
// niefunkcjonalne: RBAC nie może opierać się wyłącznie na interfejsie).
//
// Tożsamość żądającego jest weryfikowana na podstawie tokenu JWT Supabase,
// a jego rola odczytywana z tabeli profiles. Operacje na danych wykonuje klucz
// service_role (omija RLS), ale dopiero PO sprawdzeniu uprawnień w middleware.
// Reguły hierarchii ról (kogo wolno ukarać) wymusza dodatkowo baza w funkcjach
// set_account_status / set_user_role (obrona w głąb).
// ============================================================================

import { Router } from 'express';
import {
  SB_URL, SB_SERVICE,
  getAuthUser, sbAdmin, sbRpcAsUser,
} from '../lib/supabaseRest.js';

const router = Router();

// ── Operacje specyficzne dla panelu (reszta helperów w lib/supabaseRest.js) ──

// Ustawia czas blokady logowania w warstwie auth (Supabase Admin API).
// banDuration: czas trwania Go (np. '300s', '876000h') lub 'none' (odblokowanie).
async function setAuthBan(userId, banDuration) {
  await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, {
    method: 'PUT',
    headers: {
      apikey:        SB_SERVICE,
      Authorization: `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ban_duration: banDuration }),
  });
}

// ── Middleware RBAC ─────────────────────────────────────────────────────────

// Wymaga konfiguracji klucza service_role – bez niego panel jest niedostępny.
function requireServiceKey(_req, res, next) {
  if (!SB_SERVICE) {
    return res.status(503).json({ error: 'Panel administracyjny nie jest skonfigurowany (brak SUPABASE_SERVICE_ROLE_KEY).' });
  }
  next();
}

// Zwraca middleware dopuszczające wyłącznie wskazane role.
function requireRole(allowedRoles) {
  return async (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Brak tokenu autoryzacji' });

    const user = await getAuthUser(token);
    if (!user?.id) return res.status(401).json({ error: 'Nieprawidłowy lub wygasły token' });

    let rows;
    try {
      rows = await sbAdmin('GET', `profiles?id=eq.${user.id}&select=role,account_status`);
    } catch {
      return res.status(500).json({ error: 'Błąd weryfikacji uprawnień' });
    }
    const role = rows?.[0]?.role || 'user';
    if (!allowedRoles.includes(role)) {
      return res.status(403).json({ error: 'Brak wymaganych uprawnień' });
    }

    req.authUser  = user;
    req.authToken = token;
    req.authRole  = role;
    next();
  };
}

router.use(requireServiceKey);

const requireModerator = requireRole(['moderator', 'admin']);
const requireAdmin     = requireRole(['admin']);

// ── 1. GET /api/admin/me – rola i status zalogowanego (guard panelu) ─────────
router.get('/me', requireModerator, (req, res) => {
  res.json({ id: req.authUser.id, role: req.authRole });
});

// ── 2. GET /api/admin/feed – ostatnio dodane recenzje i komentarze ───────────
router.get('/feed', requireModerator, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  try {
    const [reviews, comments] = await Promise.all([
      sbAdmin('GET', `reviews?select=id,movie_id,movie_title,review_text,is_spoiler,created_at,user_id,profiles(display_name,avatar_url,role,account_status)&order=created_at.desc&limit=${limit}`),
      sbAdmin('GET', `review_comments?select=id,body,created_at,user_id,review_id,profiles(display_name,avatar_url)&order=created_at.desc&limit=${limit}`),
    ]);
    res.json({ reviews, comments });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Błąd pobierania treści do moderacji' });
  }
});

// ── 2b. GET /api/admin/log – dziennik działań moderacji ──────────────────────
router.get('/log', requireModerator, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 80, 200);
  try {
    const rows = await sbAdmin('GET',
      'moderation_log?select=id,action,reason,created_at,target_review_id,' +
      'moderator:profiles!moderator_id(id,display_name),' +
      'target:profiles!target_user_id(id,display_name)' +
      `&order=created_at.desc&limit=${limit}`);
    res.json(rows);
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Błąd pobierania dziennika moderacji' });
  }
});

// ── 3. GET /api/admin/users – lista/wyszukiwanie kont ────────────────────────
router.get('/users', requireModerator, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const q     = (req.query.query || '').trim();
  let path = `profiles?select=id,display_name,email,avatar_url,role,account_status,muted_until,created_at&order=created_at.desc&limit=${limit}`;
  // Usuń znaki strukturalne PostgREST, których encodeURIComponent NIE koduje — bez tego
  // nawiasy/gwiazdki z wejścia mogłyby zmienić składnię filtra or=(...).
  const safe = q.replace(/[(),*]/g, ' ').trim();
  if (safe) {
    const enc = encodeURIComponent(`*${safe}*`);
    path += `&or=(display_name.ilike.${enc},email.ilike.${enc})`;
  }
  try {
    res.json(await sbAdmin('GET', path));
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Błąd pobierania użytkowników' });
  }
});

// ── 4. DELETE /api/admin/reviews/:id – usunięcie cudzej recenzji ─────────────
router.delete('/reviews/:id', requireModerator, async (req, res) => {
  try {
    const deleted = await sbAdmin('GET', `reviews?id=eq.${req.params.id}&select=user_id`);
    if (!deleted.length) return res.status(404).json({ error: 'Recenzja nie istnieje' });

    await sbAdmin('DELETE', `reviews?id=eq.${req.params.id}`);
    await sbAdmin('POST', 'moderation_log', {
      moderator_id:     req.authUser.id,
      target_user_id:   deleted[0].user_id,
      target_review_id: req.params.id,
      action:           'review:delete',
      reason:           req.body?.reason || null,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Błąd usuwania recenzji' });
  }
});

// ── 5. PATCH /api/admin/reviews/:id/spoiler – wymuszenie/zdjęcie flagi ───────
router.patch('/reviews/:id/spoiler', requireModerator, async (req, res) => {
  const isSpoiler = req.body?.is_spoiler === true;
  try {
    const updated = await sbAdmin('PATCH', `reviews?id=eq.${req.params.id}`, { is_spoiler: isSpoiler });
    if (!updated.length) return res.status(404).json({ error: 'Recenzja nie istnieje' });

    await sbAdmin('POST', 'moderation_log', {
      moderator_id:     req.authUser.id,
      target_user_id:   updated[0].user_id,
      target_review_id: req.params.id,
      action:           isSpoiler ? 'review:hide_spoiler' : 'review:unhide_spoiler',
    });
    res.json({ ok: true, is_spoiler: isSpoiler });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Błąd zmiany flagi spoilera' });
  }
});

// ── 6. DELETE /api/admin/comments/:id – usunięcie cudzego komentarza ─────────
router.delete('/comments/:id', requireModerator, async (req, res) => {
  try {
    const found = await sbAdmin('GET', `review_comments?id=eq.${req.params.id}&select=user_id`);
    if (!found.length) return res.status(404).json({ error: 'Komentarz nie istnieje' });

    await sbAdmin('DELETE', `review_comments?id=eq.${req.params.id}`);
    await sbAdmin('POST', 'moderation_log', {
      moderator_id:   req.authUser.id,
      target_user_id: found[0].user_id,
      action:         'comment:delete',
      reason:         req.body?.reason || null,
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: 'Błąd usuwania komentarza' });
  }
});

// ── 7. PATCH /api/admin/users/:id/status – wycisz / zablokuj / przywróć ──────
// Reguły hierarchii ról egzekwuje RPC set_account_status (auth.uid() = moderator).
router.patch('/users/:id/status', requireModerator, async (req, res) => {
  const { status, reason, until } = req.body || {};   // until: ISO string lub null (permanentnie)
  if (!['active', 'muted', 'blocked'].includes(status)) {
    return res.status(400).json({ error: 'Nieprawidłowy status konta' });
  }

  const rpc = await sbRpcAsUser(req.authToken, 'set_account_status', {
    p_target:      req.params.id,
    p_status:      status,
    p_reason:      reason || null,
    p_muted_until: until || null,
  });

  if (!rpc.ok) {
    return res.status(rpc.status === 403 ? 403 : 400)
      .json({ error: rpc.body?.message || 'Nie udało się zmienić statusu konta' });
  }

  // Blokada logowania w warstwie auth – z czasem trwania (lub permanentnie / odblokowanie).
  try {
    if (status === 'blocked') {
      const banDuration = until
        ? `${Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 1000))}s`
        : '876000h';
      await setAuthBan(req.params.id, banDuration);
    }
    if (status === 'active') await setAuthBan(req.params.id, 'none');
  } catch {
    return res.status(500).json({ error: 'Status zapisany, ale blokada logowania nie powiodła się' });
  }

  res.json({ ok: true, status });
});

// ── 8. PATCH /api/admin/users/:id/role – zmiana roli (tylko Admin) ───────────
router.patch('/users/:id/role', requireAdmin, async (req, res) => {
  const { role } = req.body || {};
  if (!['user', 'moderator', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Nieprawidłowa rola' });
  }

  const rpc = await sbRpcAsUser(req.authToken, 'set_user_role', {
    p_target: req.params.id,
    p_role:   role,
  });

  if (!rpc.ok) {
    return res.status(rpc.status === 403 ? 403 : 400)
      .json({ error: rpc.body?.message || 'Nie udało się zmienić roli' });
  }
  res.json({ ok: true, role });
});

export default router;
