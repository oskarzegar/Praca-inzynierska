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

const SB_URL     = process.env.SUPABASE_URL;
const SB_ANON    = process.env.SUPABASE_ANON_KEY;
const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

// Weryfikuje token JWT i zwraca obiekt użytkownika auth (lub null).
async function getAuthUser(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
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

export {
  SB_URL, SB_ANON, SB_SERVICE,
  sbFetch, sbFetchAsUser, getAuthUser, sbAdmin, sbRpcAsUser,
};
