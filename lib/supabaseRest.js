'use strict';

// ============================================================================
// lib/supabaseRest.js  –  Wspólne wywołania REST/Auth Supabase (warstwa serwera)
//
// Eliminuje duplikację helperów między routes/api.js i routes/admin.js (DRY).
//   • anon  – respektuje RLS roli anonimowej,
//   • token użytkownika – respektuje RLS zalogowanego,
//   • service_role – omija RLS (wyłącznie po autoryzacji RBAC w warstwie tras).
// Zmienne środowiskowe są czytane przy starcie (server.js ładuje dotenv wcześniej).
// ============================================================================

// Wartości wklejane do panelu Vercel często mają spację/nową linię na końcu,
// cudzysłowy albo końcowy „/" w URL. Klient supabase-js w przeglądarce to toleruje,
// ale tutaj sklejamy URL-e ręcznie — `https://x.supabase.co/` + `/auth/v1/user`
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

const SB_URL     = cleanUrl(process.env.SUPABASE_URL);
const SB_ANON    = cleanEnv(process.env.SUPABASE_ANON_KEY);
const SB_SERVICE = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);

function anonHeaders() {
  return {
    apikey:         SB_ANON,
    Authorization:  `Bearer ${SB_ANON}`,
    'Content-Type': 'application/json',
  };
}

// Odczyt PostgREST kluczem anon (RLS roli anon).
async function sbFetch(table, params = {}) {
  const p = new URLSearchParams(params);
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${p}`, { headers: anonHeaders() });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// Odczyt PostgREST tokenem użytkownika (RLS zalogowanego użytkownika).
async function sbFetchAsUser(userToken, table, params = {}) {
  const p = new URLSearchParams(params);
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${p}`, {
    headers: {
      apikey:         SB_ANON,
      Authorization:  `Bearer ${userToken}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}`);
  return res.json();
}

// Weryfikuje token JWT w Supabase Auth i ROZRÓŻNIA przyczyny niepowodzenia:
//   { user }                          – token poprawny,
//   { reason: 'missing' }             – brak tokenu w żądaniu,
//   { reason: 'invalid',     status } – Supabase odrzucił token (401/403: wygasły, z innego projektu),
//   { reason: 'misconfigured'}        – brak SUPABASE_URL / SUPABASE_ANON_KEY na serwerze,
//   { reason: 'unreachable', status } – inny błąd HTTP (np. 404 przez zły URL) lub błąd sieci.
// Wcześniej wszystkie te przypadki dawały ten sam komunikat o „wygasłym tokenie",
// co uniemożliwiało diagnozę na produkcji.
async function verifyAuthToken(token) {
  if (!token) return { user: null, reason: 'missing' };
  if (!SB_URL || !SB_ANON) {
    console.error('[auth] Brak SUPABASE_URL lub SUPABASE_ANON_KEY w zmiennych środowiskowych serwera.');
    return { user: null, reason: 'misconfigured' };
  }
  try {
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

// Zgodność wsteczna: zwraca obiekt użytkownika auth (lub null).
async function getAuthUser(token) {
  return (await verifyAuthToken(token)).user;
}

// Wyciąga token z nagłówka „Authorization: Bearer <jwt>" (wielkość liter i spacje bez znaczenia).
function bearerToken(req) {
  const h = req.headers?.authorization;
  if (typeof h !== 'string') return null;
  const m = h.match(/^\s*Bearer\s+(.+?)\s*$/i);
  return m ? m[1] : null;
}

// Zapytanie PostgREST kluczem service_role (omija RLS) – tylko po autoryzacji RBAC.
async function sbAdmin(method, pathAndQuery, body) {
  const res = await fetch(`${SB_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey:         SB_SERVICE,
      Authorization:  `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
      Prefer:         'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw Object.assign(new Error('Supabase admin error'), { status: res.status, data });
  return data;
}

// Wywołanie RPC w kontekście użytkownika (auth.uid() = wołający) – zachowuje reguły bazy.
async function sbRpcAsUser(token, fn, args) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey:         SB_ANON,
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, body: text ? JSON.parse(text) : null };
}

// Wywołanie RPC kluczem service_role (omija RLS) — tylko dla zadań serwera (np. cron).
async function sbRpcAdmin(fn, args = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey:         SB_SERVICE,
      Authorization:  `Bearer ${SB_SERVICE}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

// Odczytuje claim `ref` (identyfikator projektu) z klasycznych kluczy JWT Supabase.
// Służy wyłącznie diagnostyce: klucze z różnych projektów = gwarantowane błędy tokenów.
function projectRefFromKey(key) {
  try {
    const payload = key?.split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))?.ref || null;
  } catch {
    return null;
  }
}

function projectRefFromUrl(url) {
  const m = url?.match(/^https:\/\/([a-z0-9]+)\.supabase\.(co|in)$/i);
  return m ? m[1] : null;
}

export {
  SB_URL, SB_ANON, SB_SERVICE,
  sbFetch, sbFetchAsUser, getAuthUser, verifyAuthToken, bearerToken,
  sbAdmin, sbRpcAsUser, sbRpcAdmin, projectRefFromKey, projectRefFromUrl,
};
