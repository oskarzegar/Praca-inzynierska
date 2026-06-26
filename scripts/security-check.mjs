'use strict';

// ============================================================================
// scripts/security-check.mjs  –  Test napastniczy RLS / uprawnień kolumnowych
//
// Tworzy konto testowe, loguje się jako zwykły user i próbuje:
//   • eskalacji roli (PATCH profiles {role:'admin'}),
//   • zmiany własnego statusu kary (PATCH profiles {account_status}),
//   • wycieku e-maili (GET profiles?select=email jako anon).
// Po migracji db/70 każda z tych prób MUSI zostać odrzucona. Na końcu sprząta.
//
// Wymaga sieci i klucza service_role — celowo POZA katalogiem test/, by NIE był
// wykonywany przez domyślny `npm test`. Uruchom jawnie:  npm run test:security
// ============================================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function loadEnv() {
  const env = {};
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* brak .env */ }
  return env;
}

test('RLS: zwykły user nie eskaluje roli, nie zmienia swojego statusu, nie czyta cudzych e-maili', async () => {
  const env = loadEnv();
  const URL = env.SUPABASE_URL, ANON = env.SUPABASE_ANON_KEY, SVC = env.SUPABASE_SERVICE_ROLE_KEY;
  assert.ok(URL && ANON && SVC, 'brak konfiguracji w .env (URL/ANON/SERVICE_ROLE)');

  const svcH  = { apikey: SVC,  Authorization: `Bearer ${SVC}`,  'Content-Type': 'application/json' };
  const anonH = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
  const email = `sectest_${Date.now()}@example.com`;
  const password = 'Test1234!sec';
  let id = null;

  try {
    const created = await (await fetch(`${URL}/auth/v1/admin/users`, {
      method: 'POST', headers: svcH, body: JSON.stringify({ email, password, email_confirm: true }),
    })).json();
    id = created.id;
    assert.ok(id, 'nie udało się utworzyć konta testowego');
    await new Promise(s => setTimeout(s, 800));

    const token = (await (await fetch(`${URL}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: anonH, body: JSON.stringify({ email, password }),
    })).json()).access_token;
    assert.ok(token, 'nie udało się zalogować konta testowego');
    const userH = { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 1. eskalacja roli — MUSI zostać zablokowana
    await fetch(`${URL}/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: userH, body: JSON.stringify({ role: 'admin' }) });
    const afterRole = (await (await fetch(`${URL}/rest/v1/profiles?id=eq.${id}&select=role`, { headers: svcH })).json())[0]?.role;
    assert.notEqual(afterRole, 'admin', 'ESKALACJA UPRAWNIEŃ: user ustawił sobie role=admin');

    // 2. zmiana własnego statusu kary — MUSI zostać zablokowana
    const before = (await (await fetch(`${URL}/rest/v1/profiles?id=eq.${id}&select=account_status`, { headers: svcH })).json())[0]?.account_status;
    await fetch(`${URL}/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: userH, body: JSON.stringify({ account_status: 'blocked' }) });
    const after = (await (await fetch(`${URL}/rest/v1/profiles?id=eq.${id}&select=account_status`, { headers: svcH })).json())[0]?.account_status;
    assert.equal(after, before, 'OBEJŚCIE KAR: user zmienił własny account_status');

    // 3. wyciek e-maili przez anon — MUSI zostać zablokowany
    const rows = await (await fetch(`${URL}/rest/v1/profiles?select=email&limit=3`, { headers: anonH })).json();
    const leaked = Array.isArray(rows) && rows.some(x => x.email);
    assert.ok(!leaked, 'WYCIEK E-MAILI: anon odczytał kolumnę email z profiles');

    // 4. nadpisanie CUDZEGO awatara — MUSI zostać zablokowane
    const foreign = '00000000-0000-0000-0000-000000000000';
    const up = await fetch(`${URL}/storage/v1/object/avatars/${foreign}/avatar`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'image/png' },
      body: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    if (up.ok) await fetch(`${URL}/storage/v1/object/avatars/${foreign}/avatar`, { method: 'DELETE', headers: svcH });
    assert.ok(!up.ok, `STORAGE: user nadpisał awatar w cudzym folderze (HTTP ${up.status})`);

    // 5. ASERCJA POZYTYWNA — dozwolony zapis (własny display_name) MUSI nadal działać,
    //    inaczej zbyt agresywny REVOKE po cichu psułby aplikację, a test świeciłby na zielono.
    const newName = `pentest-${Date.now()}`;
    await fetch(`${URL}/rest/v1/profiles?id=eq.${id}`, { method: 'PATCH', headers: userH, body: JSON.stringify({ display_name: newName }) });
    const dn = (await (await fetch(`${URL}/rest/v1/profiles?id=eq.${id}&select=display_name`, { headers: svcH })).json())[0]?.display_name;
    assert.equal(dn, newName, 'REGRESJA: user NIE może zmienić własnego display_name (grant zbyt restrykcyjny)');
  } finally {
    if (id) await fetch(`${URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: svcH });
  }
});
