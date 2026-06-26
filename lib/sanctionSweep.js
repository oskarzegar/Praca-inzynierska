'use strict';

// ============================================================================
// lib/sanctionSweep.js  –  Automatyczne czyszczenie wygasłych kar w bazie
//
// Po upływie kary czasowej egzekwowanie i tak ustaje (can_post() patrzy na
// muted_until), ale account_status w bazie zostawał 'muted'/'blocked'. Ten moduł
// cyklicznie (co minutę) resetuje wygasłe kary na 'active', dzięki czemu pole
// w bazie jest prawidłowe — a nie tylko „efektywnie aktywne" w interfejsie.
//
// Permanentne kary (muted_until = NULL) są pomijane (filtr lte. nie łapie NULL).
// Wymaga klucza service_role; bez niego sweep jest pomijany (z ostrzeżeniem).
// ============================================================================

import { sbAdmin, SB_SERVICE } from './supabaseRest.js';

const SWEEP_INTERVAL_MS = 60 * 1000;   // co minutę

async function sweep() {
  const nowIso = new Date().toISOString();
  const path = `profiles?account_status=in.(muted,blocked)&muted_until=lte.${encodeURIComponent(nowIso)}`;
  try {
    const updated = await sbAdmin('PATCH', path, { account_status: 'active', muted_until: null });
    if (Array.isArray(updated) && updated.length) {
      console.log(`[sanctions] Zresetowano ${updated.length} konto/a po wygaśnięciu kary.`);
    }
  } catch (err) {
    console.error('[sanctions] Błąd czyszczenia wygasłych kar:', err.message);
  }
}

// Uruchamia czyszczenie: raz na starcie + cyklicznie. unref() pozwala procesowi
// zakończyć się normalnie (timer nie blokuje wyłączenia serwera).
export function startSanctionSweep() {
  if (!SB_SERVICE) {
    console.warn('[sanctions] Brak SUPABASE_SERVICE_ROLE_KEY — automatyczne czyszczenie wygasłych kar wyłączone.');
    return;
  }
  sweep();
  setInterval(sweep, SWEEP_INTERVAL_MS).unref();
}
