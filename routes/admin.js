// ============================================================================
// routes/admin.js  –  Panel administratora i moderacji (WF-15..WF-18)
//
// RBAC egzekwowany PO STRONIE SERWERA: tożsamość z tokenu JWT Supabase, rola
// z tabeli profiles. Operacje panelu na danych wykonuje klucz service_role (omija RLS)
// dopiero PO sprawdzeniu uprawnień w middleware; wyjątkiem jest sweep wygasłych kar,
// który działa przed RBAC (zob. niżej). Zmiany statusu i roli idą tokenem moderatora
// (RPC), a hierarchię ról (kogo wolno ukarać) wymusza baza w set_account_status /
// set_user_role (obrona w głąb).
// ============================================================================

import { Router } from 'express';
import {
  SB_SERVICE,
  verifyAuthToken, bearerToken, sbAdmin, sbRpcAsUser, setAuthBan,
} from '../lib/supabaseRest.js';
import { maybeSweepSanctions } from '../lib/sanctionSweep.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = Router();

const TOKEN_INVALID    = { error: 'Nieprawidłowy lub wygasły token', code: 'token_invalid' };
const ACCOUNT_STATUSES = ['active', 'muted', 'blocked'];
const ROLES            = ['user', 'moderator', 'admin'];
const PERMANENT_BAN    = '876000h';   // ~100 lat — blokada „na stałe"
const UUID             = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Pomocniki ───────────────────────────────────────────────────────────────

// Parametr zapytania jako tekst. Parser qs zamienia ?x=a&x=b w tablicę, a ?x[k]=v
// w obiekt — takie wartości traktujemy jak brak parametru.
function queryText(value) {
  return typeof value === 'string' ? value : '';
}

// ?limit=… → dodatnia liczba całkowita ograniczona do `max`; brak lub błędna wartość → domyślna.
function limitParam(raw, fallback, max) {
  const n = Math.trunc(Number(queryText(raw)));
  return n > 0 ? Math.min(n, max) : fallback;
}

// Data w formacie, który rozumie zarówno JS, jak i PostgreSQL (np. ISO 8601).
function isDateString(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function logModeration(entry) {
  return sbAdmin('POST', 'moderation_log', entry);
}

// Czas blokady logowania (format Go) dla nowego statusu; null = warstwa auth bez zmian.
// `until` musi być wcześniej zwalidowane (isDateString).
function authBanFor(status, until) {
  if (status === 'active') return 'none';
  if (status !== 'blocked') return null;
  if (!until) return PERMANENT_BAN;
  return `${Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 1000))}s`;
}

// RPC tokenem moderatora. Błąd sieci → { ok: false, status: 502 } — trasa odpowiada
// wtedy jak przy awarii bazy, zamiast przerywać obsługę żądania.
async function moderatorRpc(req, fn, args) {
  try {
    return await sbRpcAsUser(req.authToken, fn, args);
  } catch (err) {
    console.error(`[admin] RPC ${fn} — brak odpowiedzi bazy:`, err?.message || err);
    return { ok: false, status: 502, body: null };
  }
}

// Błąd RPC wykonanego tokenem użytkownika → odpowiedź HTTP. PostgREST zwraca 401
// („JWT expired"), gdy token wygaśnie między middleware a RPC — klient wtedy
// odświeża sesję i ponawia żądanie. Awaria bazy lub bramy (5xx) → 502.
function sendRpcError(res, rpc, fallback) {
  if (rpc.status === 401) return res.status(401).json(TOKEN_INVALID);
  if (rpc.status >= 500)  return res.status(502).json({ error: fallback });
  return res.status(rpc.status === 403 ? 403 : 400).json({ error: rpc.body?.message || fallback });
}

// Błąd zapytania service_role → status z Supabase (lub 500) + komunikat trasy.
function sendAdminError(res, err, message) {
  return res.status(err.status || 500).json({ error: message });
}

// Rola z tabeli profiles (brak wiersza → 'user'); null = błąd zapytania.
async function fetchRole(userId) {
  try {
    const rows = await sbAdmin('GET', `profiles?id=eq.${userId}&select=role,account_status`);
    return rows?.[0]?.role || 'user';
  } catch {
    return null;
  }
}

// Usunięcie treści (recenzja / komentarz): 404 gdy nie istnieje, wpis w dzienniku moderacji.
function removeContentRoute({ table, notFoundMessage, failureMessage, logEntry }) {
  return asyncHandler(async (req, res) => {
    try {
      const rows = await sbAdmin('GET', `${table}?id=eq.${req.params.id}&select=user_id`);
      if (!rows.length) return res.status(404).json({ error: notFoundMessage });

      await sbAdmin('DELETE', `${table}?id=eq.${req.params.id}`);
      await logModeration(logEntry(req, rows[0].user_id));
      res.json({ ok: true });
    } catch (err) {
      sendAdminError(res, err, failureMessage);
    }
  });
}

// ── Middleware RBAC ─────────────────────────────────────────────────────────

// Bez klucza service_role panel jest niedostępny.
function requireServiceKey(_req, res, next) {
  if (!SB_SERVICE) {
    return res.status(503).json({ error: 'Panel administracyjny nie jest skonfigurowany (brak SUPABASE_SERVICE_ROLE_KEY).' });
  }
  next();
}

// Middleware dopuszczające wyłącznie wskazane role.
function requireRole(allowedRoles) {
  return asyncHandler(async (req, res, next) => {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'Brak tokenu autoryzacji', code: 'token_missing' });

    // Odrzucony token → 401 (klient odświeża sesję i ponawia); błąd konfiguracji
    // lub sieci serwera → 503 — to NIE jest wina sesji użytkownika.
    const { user, reason } = await verifyAuthToken(token);
    if (!user?.id && reason === 'invalid') return res.status(401).json(TOKEN_INVALID);
    if (!user?.id) {
      return res.status(503).json({
        error: 'Serwer nie może zweryfikować sesji (sprawdź SUPABASE_URL i SUPABASE_ANON_KEY na serwerze).',
        code:  'auth_unavailable',
      });
    }

    const role = await fetchRole(user.id);
    if (role === null) return res.status(500).json({ error: 'Błąd weryfikacji uprawnień' });
    if (!allowedRoles.includes(role)) return res.status(403).json({ error: 'Brak wymaganych uprawnień' });

    req.authUser  = user;
    req.authToken = token;
    req.authRole  = role;
    next();
  });
}

router.use(requireServiceKey);

// Na Vercel (serverless) nie ma stałego procesu z setInterval — wygasłe kary czyścimy
// „przy okazji" ruchu w panelu (maks. raz na ~minutę na instancję), zanim panel
// odczyta statusy kont. Błąd sweepa nigdy nie blokuje żądania.
router.use(asyncHandler(async (_req, _res, next) => {
  await maybeSweepSanctions();
  next();
}));

// Każdy :id w panelu to UUID (recenzja, komentarz, profil). Inna wartość nie może trafić
// do ścieżki PostgREST — np. „r1&select=id" dopisałby parametry do zapytania.
router.param('id', (_req, res, next, id) => {
  if (!UUID.test(id)) return res.status(400).json({ error: 'Nieprawidłowy identyfikator' });
  next();
});

const requireModerator = requireRole(['moderator', 'admin']);
const requireAdmin     = requireRole(['admin']);

// ── 1. GET /api/admin/me – rola zalogowanego (guard panelu) ──────────────────
router.get('/me', requireModerator, (req, res) => {
  res.json({ id: req.authUser.id, role: req.authRole });
});

// ── 2. GET /api/admin/feed – ostatnio dodane recenzje i komentarze ───────────
const FEED_REVIEW_COLUMNS  = 'id,movie_id,movie_title,review_text,is_spoiler,created_at,user_id,profiles(display_name,avatar_url,role,account_status)';
const FEED_COMMENT_COLUMNS = 'id,body,created_at,user_id,review_id,profiles(display_name,avatar_url)';

router.get('/feed', requireModerator, asyncHandler(async (req, res) => {
  const limit = limitParam(req.query.limit, 20, 50);
  try {
    const [reviews, comments] = await Promise.all([
      sbAdmin('GET', `reviews?select=${FEED_REVIEW_COLUMNS}&order=created_at.desc&limit=${limit}`),
      sbAdmin('GET', `review_comments?select=${FEED_COMMENT_COLUMNS}&order=created_at.desc&limit=${limit}`),
    ]);
    res.json({ reviews, comments });
  } catch (err) {
    sendAdminError(res, err, 'Błąd pobierania treści do moderacji');
  }
}));

// ── 2b. GET /api/admin/log – dziennik działań moderacji ──────────────────────
const LOG_COLUMNS = 'id,action,reason,created_at,target_review_id,'
  + 'moderator:profiles!moderator_id(id,display_name),'
  + 'target:profiles!target_user_id(id,display_name)';

router.get('/log', requireModerator, asyncHandler(async (req, res) => {
  const limit = limitParam(req.query.limit, 80, 200);
  try {
    res.json(await sbAdmin('GET', `moderation_log?select=${LOG_COLUMNS}&order=created_at.desc&limit=${limit}`));
  } catch (err) {
    sendAdminError(res, err, 'Błąd pobierania dziennika moderacji');
  }
}));

// ── 3. GET /api/admin/users – lista/wyszukiwanie kont ────────────────────────
const USER_COLUMNS = 'id,display_name,email,avatar_url,role,account_status,muted_until,created_at';

router.get('/users', requireModerator, asyncHandler(async (req, res) => {
  const limit = limitParam(req.query.limit, 30, 100);
  // Znaki składni filtra PostgREST or=(…) — nawiasy, przecinek i gwiazdka (wildcard
  // ilike) — są zamieniane na spacje, by wejście nie zmieniło struktury filtra.
  const search = queryText(req.query.query).replace(/[(),*]/g, ' ').trim();
  let path = `profiles?select=${USER_COLUMNS}&order=created_at.desc&limit=${limit}`;
  if (search) {
    const pattern = encodeURIComponent(`*${search}*`);
    path += `&or=(display_name.ilike.${pattern},email.ilike.${pattern})`;
  }
  try {
    res.json(await sbAdmin('GET', path));
  } catch (err) {
    sendAdminError(res, err, 'Błąd pobierania użytkowników');
  }
}));

// ── 4. DELETE /api/admin/reviews/:id – usunięcie cudzej recenzji ─────────────
router.delete('/reviews/:id', requireModerator, removeContentRoute({
  table:           'reviews',
  notFoundMessage: 'Recenzja nie istnieje',
  failureMessage:  'Błąd usuwania recenzji',
  logEntry: (req, targetUserId) => ({
    moderator_id:     req.authUser.id,
    target_user_id:   targetUserId,
    target_review_id: req.params.id,
    action:           'review:delete',
    reason:           req.body?.reason || null,
  }),
}));

// ── 5. PATCH /api/admin/reviews/:id/spoiler – wymuszenie/zdjęcie flagi ───────
router.patch('/reviews/:id/spoiler', requireModerator, asyncHandler(async (req, res) => {
  const isSpoiler = req.body?.is_spoiler === true;
  try {
    const updated = await sbAdmin('PATCH', `reviews?id=eq.${req.params.id}`, { is_spoiler: isSpoiler });
    if (!updated.length) return res.status(404).json({ error: 'Recenzja nie istnieje' });

    await logModeration({
      moderator_id:     req.authUser.id,
      target_user_id:   updated[0].user_id,
      target_review_id: req.params.id,
      action:           isSpoiler ? 'review:hide_spoiler' : 'review:unhide_spoiler',
    });
    res.json({ ok: true, is_spoiler: isSpoiler });
  } catch (err) {
    sendAdminError(res, err, 'Błąd zmiany flagi spoilera');
  }
}));

// ── 6. DELETE /api/admin/comments/:id – usunięcie cudzego komentarza ─────────
router.delete('/comments/:id', requireModerator, removeContentRoute({
  table:           'review_comments',
  notFoundMessage: 'Komentarz nie istnieje',
  failureMessage:  'Błąd usuwania komentarza',
  logEntry: (req, targetUserId) => ({
    moderator_id:   req.authUser.id,
    target_user_id: targetUserId,
    action:         'comment:delete',
    reason:         req.body?.reason || null,
  }),
}));

// ── 7. PATCH /api/admin/users/:id/status – wycisz / zablokuj / przywróć ──────
// Hierarchię ról egzekwuje RPC set_account_status (auth.uid() = moderator).
router.patch('/users/:id/status', requireModerator, asyncHandler(async (req, res) => {
  const { status, reason, until } = req.body || {};   // until: ISO string lub null (permanentnie)
  if (!ACCOUNT_STATUSES.includes(status)) return res.status(400).json({ error: 'Nieprawidłowy status konta' });
  if (until && !isDateString(until)) return res.status(400).json({ error: 'Nieprawidłowa data zakończenia kary' });

  const rpc = await moderatorRpc(req, 'set_account_status', {
    p_target:      req.params.id,
    p_status:      status,
    p_reason:      reason || null,
    p_muted_until: until || null,
  });
  if (!rpc.ok) return sendRpcError(res, rpc, 'Nie udało się zmienić statusu konta');

  // Blokada logowania w warstwie auth: czasowa, permanentna albo zdjęcie blokady
  const banDuration = authBanFor(status, until);
  try {
    if (banDuration) await setAuthBan(req.params.id, banDuration);
  } catch (err) {
    console.error('[admin] Blokada logowania nie powiodła się:', err?.message || err);
    return res.status(500).json({ error: 'Status zapisany, ale blokada logowania nie powiodła się' });
  }
  res.json({ ok: true, status });
}));

// ── 8. PATCH /api/admin/users/:id/role – zmiana roli (tylko Admin) ───────────
router.patch('/users/:id/role', requireAdmin, asyncHandler(async (req, res) => {
  const { role } = req.body || {};
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Nieprawidłowa rola' });

  const rpc = await moderatorRpc(req, 'set_user_role', { p_target: req.params.id, p_role: role });
  if (!rpc.ok) return sendRpcError(res, rpc, 'Nie udało się zmienić roli');
  res.json({ ok: true, role });
}));

export default router;
