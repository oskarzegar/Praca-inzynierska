'use strict';

// ============================================================================
// lib/sanctionSweep.js  –  Automatyczne czyszczenie wygasłych kar w bazie
//
// Po upływie kary czasowej egzekwowanie i tak ustaje (can_post() patrzy na
// muted_until), ale account_status w bazie zostawał 'muted'/'blocked'. Ten moduł
// resetuje wygasłe kary: account_status → 'active' ORAZ muted_until → NULL.
//
// Dlaczego nie działało na Vercel: setInterval uruchamiany w app.listen wymaga
// stale działającego procesu. Funkcje serverless są zamrażane między żądaniami,
// więc timer praktycznie nigdy się nie wykonywał. Teraz sweep ma trzy wyzwalacze:
//   1. Vercel Cron  → GET /api/cron/sweep-sanctions (chroniony CRON_SECRET),
//   2. „leniwie"    → przed obsługą żądań panelu admina (maks. raz na minutę),
//   3. setInterval  → tylko przy klasycznym, długo działającym serwerze (lokalnie).
// Najpewniejszy wariant to harmonogram pg_cron w samej bazie (db/90_sanction_sweep.sql).
//
// Porównanie dat: preferowana jest funkcja SQL sweep_expired_sanctions(), która
// używa now() bazy (brak rozjazdu zegara/strefy czasowej serwera). Fallback PATCH
// porównuje z czasem UTC serwera (ISO 8601 z „Z" — jednoznaczne dla timestamptz).
// Permanentne kary (muted_until = NULL) są pomijane.
// ============================================================================

import { sbAdmin, sbRpcAdmin, SB_URL, SB_SERVICE } from './supabaseRest.js';

const SWEEP_INTERVAL_MS = 60 * 1000;   // co minutę
const MIN_GAP_MS        = 50 * 1000;   // próg throttlingu (< interwał, by jitter timera nie pomijał cykli)
let lastSweepAt   = 0;
let inFlight      = null;
let rpcAvailable  = true;              // false po wykryciu braku funkcji SQL (migracja 90 nieuruchomiona)

// Ścieżka PostgREST dla fallbacku — wydzielona dla testów jednostkowych.
export function expiredSanctionsPath(now = new Date()) {
  const iso = now.toISOString();
  return 'profiles'
    + '?account_status=in.(muted,blocked)'
    + '&muted_until=not.is.null'
    + `&muted_until=lte.${encodeURIComponent(iso)}`
    + '&select=id';
}

// Wykonuje jedno czyszczenie. Zwraca { ok, cleared, via } lub { ok:false, error }.
export async function sweepExpiredSanctions() {
  if (!SB_URL || !SB_SERVICE) {
    return { ok: false, error: 'Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY' };
  }
  try {
    if (rpcAvailable) {
      const rpc = await sbRpcAdmin('sweep_expired_sanctions');
      if (rpc.ok) {
        const cleared = Number(rpc.body) || 0;
        if (cleared) console.log(`[sanctions] Zresetowano ${cleared} konto/a po wygaśnięciu kary (SQL).`);
        return { ok: true, cleared, via: 'rpc' };
      }
      // PGRST202 / 404 = funkcja nie istnieje → przechodzimy na PATCH i nie pytamy ponownie
      if (rpc.status === 404 || rpc.body?.code === 'PGRST202') {
        rpcAvailable = false;
        console.warn('[sanctions] Brak funkcji sweep_expired_sanctions() — uruchom db/90_sanction_sweep.sql. Używam PATCH.');
      } else {
        throw new Error(`RPC HTTP ${rpc.status}: ${JSON.stringify(rpc.body)?.slice(0, 200)}`);
      }
    }

    const updated = await sbAdmin('PATCH', expiredSanctionsPath(), { account_status: 'active', muted_until: null });
    const cleared = Array.isArray(updated) ? updated.length : 0;
    if (cleared) console.log(`[sanctions] Zresetowano ${cleared} konto/a po wygaśnięciu kary (PATCH).`);
    return { ok: true, cleared, via: 'patch' };
  } catch (err) {
    console.error('[sanctions] Błąd czyszczenia wygasłych kar:', err?.message || err, err?.data || '');
    return { ok: false, error: err?.message || String(err) };
  }
}

// Sweep z ograniczeniem częstotliwości (maks. raz na ~minutę na instancję).
// Współbieżne wywołania czekają na to samo zadanie. Nigdy nie rzuca wyjątku.
export async function maybeSweepSanctions() {
  if (!SB_SERVICE) return null;
  if (inFlight) return inFlight;
  if (Date.now() - lastSweepAt < MIN_GAP_MS) return null;
  lastSweepAt = Date.now();
  inFlight = sweepExpiredSanctions().finally(() => { inFlight = null; });
  return inFlight;
}

// Cykliczny sweep dla długo działającego serwera (lokalnie / VPS). Na Vercel pomijany —
// tam rolę timera przejmuje Vercel Cron + sweep leniwy + (zalecany) pg_cron w bazie.
export function startSanctionSweep() {
  if (!SB_SERVICE) {
    console.warn('[sanctions] Brak SUPABASE_SERVICE_ROLE_KEY — automatyczne czyszczenie wygasłych kar wyłączone.');
    return;
  }
  if (process.env.VERCEL) return;
  maybeSweepSanctions();
  setInterval(maybeSweepSanctions, SWEEP_INTERVAL_MS).unref();
}
