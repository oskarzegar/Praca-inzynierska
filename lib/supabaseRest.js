// ============================================================================
// lib/supabaseRest.js  –  Warstwa dostępu do Supabase (PostgREST + Auth)
//
// Jedyny moduł serwera, który wykonuje zapytania do Supabase (adres i klucze z env,
// oczyszczone). Trzy konteksty uprawnień:
//   • anon              – RLS roli anonimowej,
//   • token użytkownika – RLS zalogowanego (auth.uid() = wołający),
//   • service_role      – omija RLS: operacje panelu admina (po RBAC), odczyt roli
//                         w samym RBAC oraz sweep wygasłych kar (cron, timer i sweep
//                         leniwy — ten ostatni działa przed RBAC).
// Eksportuje też pomocniki: cleanEnv/cleanUrl (normalizacja wartości env), bearerToken
// (token z nagłówka żądania) i projectRefFromKey/projectRefFromUrl (diagnostyka /api/health).
// Zmienne środowiskowe są czytane przy imporcie (server.js ładuje dotenv wcześniej).
// ============================================================================

// Wartości wklejane do panelu Vercel często mają spację/nową linię na końcu,
// cudzysłowy albo końcowy „/" w URL. Klient supabase-js w przeglądarce to toleruje,
// ale tutaj URL-e są sklejane ręcznie — `https://x.supabase.co/` + `/auth/v1/user`
// dawało `//auth/v1/user` (404) i fałszywy komunikat „Nieprawidłowy lub wygasły token".
export function cleanEnv(value) {
  if (typeof value !== 'string') return undefined;
  const v = value.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  return v || undefined;
}

export function cleanUrl(value) {
  const v = cleanEnv(value);
  return v ? v.replace(/\/+$/, '') : undefined;
}

export const SB_URL     = cleanUrl(process.env.SUPABASE_URL);
export const SB_ANON    = cleanEnv(process.env.SUPABASE_ANON_KEY);
export const SB_SERVICE = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

// ── Pomocniki HTTP ──────────────────────────────────────────────────────────

// apikey = klucz projektu; Bearer = rola żądania (ten sam klucz albo JWT użytkownika).
function authHeaders(apiKey, bearer) {
  return { apikey: apiKey, Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' };
}

// Puste body → null; niepoprawny JSON → wyjątek (SyntaxError).
function parseJson(text) {
  return text ? JSON.parse(text) : null;
}

// Jak parseJson, ale treść, która nie jest JSON-em, zwraca jako tekst (bez wyjątku).
function parseJsonOrText(text) {
  try {
    return parseJson(text);
  } catch {
    return text;
  }
}

// Żądania PostgREST: GET tabeli (klucz anon + Bearer roli) i POST funkcji RPC.
// Celowo bez `async`: zwracają obietnicę fetch, a każde `await` i odczyt treści
// zostają w funkcji eksportowanej. Liczba taktów kolejki mikrozadań i ramki stosu
// są więc takie same jak przy fetch wołanym bezpośrednio w tej funkcji.
function restRequest(table, params, bearer) {
  const query = new URLSearchParams(params);
  return fetch(`${SB_URL}/rest/v1/${table}?${query}`, { headers: authHeaders(SB_ANON, bearer) });
}

function rpcRequest(fn, args, apiKey, bearer) {
  return fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method:  'POST',
    headers: authHeaders(apiKey, bearer),
    body:    JSON.stringify(args),
  });
}

// Wiersze z odpowiedzi GET (obietnica res.json()); błąd HTTP → wyjątek „Supabase <status>".
function rowsFrom(res) {
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// ── PostgREST ───────────────────────────────────────────────────────────────

// Odczyt kluczem anon (RLS roli anon).
export async function sbFetch(table, params = {}) {
  const res = await restRequest(table, params, SB_ANON);
  return rowsFrom(res);
}

// Odczyt tokenem użytkownika (RLS zalogowanego użytkownika).
export async function sbFetchAsUser(userToken, table, params = {}) {
  const res = await restRequest(table, params, userToken);
  return rowsFrom(res);
}

// Zapytanie kluczem service_role (omija RLS) — operacje panelu po RBAC, odczyt roli
// w RBAC i sweep kar. Błąd HTTP → wyjątek z polami .status i .data (treść błędu Supabase).
export async function sbAdmin(method, pathAndQuery, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: { ...authHeaders(SB_SERVICE, SB_SERVICE), Prefer: 'return=representation' },
    body:    body ? JSON.stringify(body) : undefined,
  });
  const data = parseJson(await res.text());
  if (!res.ok) throw Object.assign(new Error('Supabase admin error'), { status: res.status, data });
  return data;
}

// RPC w kontekście użytkownika (auth.uid() = wołający) — zachowuje reguły bazy.
// Treść, która nie jest JSON-em → wyjątek. JSON.parse celowo wprost, nie przez parseJson:
// trasy nie obsługują tego wyjątku (kończy on proces), a ślad stosu awarii ma pozostać bez zmian.
export async function sbRpcAsUser(token, fn, args) {
  const res  = await rpcRequest(fn, args, SB_ANON, token);
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

// RPC kluczem service_role — tylko dla zadań serwera (np. cron). Treść, która nie jest
// JSON-em, zwracana jest jako tekst.
export async function sbRpcAdmin(fn, args = {}) {
  const res  = await rpcRequest(fn, args, SB_SERVICE, SB_SERVICE);
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: parseJsonOrText(text) };
}

// ── Supabase Auth ───────────────────────────────────────────────────────────

// Weryfikuje token JWT w Supabase Auth i ROZRÓŻNIA przyczyny niepowodzenia:
//   { user }                          – token poprawny,
//   { reason: 'missing' }             – brak tokenu w żądaniu,
//   { reason: 'invalid',     status } – Supabase odrzucił token (401/403: wygasły, z innego projektu),
//   { reason: 'misconfigured' }       – brak SUPABASE_URL / SUPABASE_ANON_KEY na serwerze,
//   { reason: 'unreachable', status } – inny błąd HTTP (np. 404 przez zły URL) lub błąd sieci.
// Nigdy nie rzuca wyjątku.
export async function verifyAuthToken(token) {
  if (!token) return { user: null, reason: 'missing' };
  if (!SB_URL || !SB_ANON) {
    console.error('[auth] Brak SUPABASE_URL lub SUPABASE_ANON_KEY w zmiennych środowiskowych serwera.');
    return { user: null, reason: 'misconfigured' };
  }
  try {
    // Celowo bez authHeaders(): to żądanie nie wysyła nagłówka Content-Type.
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const user = await res.json();
      return user?.id ? { user } : { user: null, reason: 'invalid', status: res.status };
    }
    // Treść błędu Supabase (bez tokenu) — trafia do logów funkcji na Vercel
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      console.warn(`[auth] Supabase odrzucił token (HTTP ${res.status}): ${detail}`);
      return { user: null, reason: 'invalid', status: res.status };
    }
    console.error(`[auth] Nieoczekiwana odpowiedź ${SB_URL}/auth/v1/user (HTTP ${res.status}): ${detail}`);
    return { user: null, reason: 'unreachable', status: res.status };
  } catch (err) {
    console.error('[auth] Błąd połączenia z Supabase Auth:', err?.message || err);
    return { user: null, reason: 'unreachable' };
  }
}

// Obiekt użytkownika auth albo null (skrót dla tras, którym wystarczy tożsamość).
export async function getAuthUser(token) {
  return (await verifyAuthToken(token)).user;
}

// Blokada logowania w Supabase Auth (Admin API). banDuration: czas w formacie Go
// (np. '300s', '876000h') lub 'none' (odblokowanie). Status HTTP odpowiedzi nie jest
// sprawdzany — wyjątek pojawia się wyłącznie przy błędzie sieci.
export async function setAuthBan(userId, banDuration) {
  await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, {
    method:  'PUT',
    headers: authHeaders(SB_SERVICE, SB_SERVICE),
    body:    JSON.stringify({ ban_duration: banDuration }),
  });
}

// ── Pomocniki żądań i diagnostyki ───────────────────────────────────────────

// Token z nagłówka „Authorization: Bearer <jwt>" (wielkość liter i spacje bez znaczenia).
export function bearerToken(req) {
  const header = req.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = header.match(/^\s*Bearer\s+(.+?)\s*$/i);
  return match ? match[1] : null;
}

// Claim `ref` (identyfikator projektu) z klasycznych kluczy JWT Supabase — wyłącznie
// do diagnostyki: klucze z różnych projektów = gwarantowane błędy tokenów.
export function projectRefFromKey(key) {
  try {
    const payload = key?.split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.ref || null;
  } catch {
    return null;
  }
}

export function projectRefFromUrl(url) {
  const match = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.(co|in)$/i);
  return match ? match[1] : null;
}
