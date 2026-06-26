'use strict';

// ============================================================================
// rbac.js  –  Klient kontroli dostępu opartej na rolach (frontend)
//
// Pojedyncze źródło prawdy o roli zalogowanego użytkownika oraz wygodny wrapper
// na wywołania chronionego API panelu (/api/admin/*). Interfejs ukrywa/pokazuje
// akcje moderacyjne na podstawie roli, ale realną decyzję podejmuje serwer (RBAC)
// i RLS — frontend traktujemy jako wygodę, nie zabezpieczenie.
// ============================================================================

import { supabase } from './supabase.js';

// Cache roli per użytkownik — unieważniany przy zmianie stanu autentykacji
let roleCache = { userId: null, role: null };

supabase.auth.onAuthStateChange(() => { roleCache = { userId: null, role: null }; });

// Zwraca rolę zalogowanego użytkownika ('user' | 'moderator' | 'admin') lub null dla gościa
export async function getCurrentRole() {
  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id ?? null;

  if (!uid) { roleCache = { userId: null, role: null }; return null; }
  if (roleCache.userId === uid && roleCache.role) return roleCache.role;

  const { data } = await supabase.from('profiles').select('role').eq('id', uid).maybeSingle();
  const role = data?.role || 'user';
  roleCache = { userId: uid, role };
  return role;
}

export async function isModerator() {
  const r = await getCurrentRole();
  return r === 'moderator' || r === 'admin';
}

export async function isAdmin() {
  return (await getCurrentRole()) === 'admin';
}

// Wywołanie chronionego endpointu panelu z dołączonym tokenem JWT.
// Zwraca { ok, status, data } — wołający decyduje, jak obsłużyć błąd.
export async function adminFetch(path, { method = 'GET', body } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* puste body (np. 204) */ }
  return { ok: res.ok, status: res.status, data };
}
