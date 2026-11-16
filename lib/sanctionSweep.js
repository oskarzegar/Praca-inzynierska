// ============================================================================
// lib/sanctionSweep.js  –  Automatyczne czyszczenie wygasłych kar w bazie
//
// Wygasła kara czasowa: account_status → 'active' ORAZ muted_until → NULL.
// Kary permanentne (muted_until = NULL) są pomijane. Trzy wyzwalacze:
//   1. Vercel Cron  → GET /api/cron/sweep-sanctions (chroniony CRON_SECRET),
//   2. „leniwie"    → przed obsługą żądań panelu admina (maks. raz na ~minutę, próg 50 s),
//   3. setInterval  → tylko przy klasycznym, długo działającym serwerze (lokalnie).
// Najpewniejszy wariant to harmonogram pg_cron w samej bazie (db/90_sanction_sweep.sql).
//
// Preferowana jest funkcja SQL sweep_expired_sanctions() (porównuje z now() bazy).
// Gdy jej brak (migracja 90 nieuruchomiona) — na stałe PATCH porównujący z czasem
// UTC serwera (ISO 8601 z „Z" — jednoznaczne dla timestamptz).
// ============================================================================

import { sbAdmin, sbRpcAdmin, SB_URL, SB_SERVICE } from './supabaseRest.js';

const SWEEP_INTERVAL_MS = 60 * 1000;   // co minutę
const MIN_GAP_MS        = 50 * 1000;   // próg throttlingu (< interwał, by jitter timera nie pomijał cykli)
let lastSweepAt  = 0;
let inFlight     = null;
let rpcAvailable = true;               // false po wykryciu braku funkcji SQL

// Ścieżka PostgREST dla wariantu PATCH — wydzielona dla testów jednostkowych.
export function expiredSanctionsPath(now = new Date()) {
  const iso = now.toISOString();
  return 'profiles'
    + '?account_status=in.(muted,blocked)'
    + '&muted_until=not.is.null'
    + `&muted_until=lte.${encodeURIComponent(iso)}`
    + '&select=id';
}

// Wynik wariantu SQL. null = funkcja nie istnieje (404 / PGRST202) → przejście na PATCH na stałe.
function resultFromRpc(rpc) {
  if (rpc.ok) return { ok: true, cleared: Number(rpc.body) || 0, via: 'rpc' };
  if (rpc.status !== 404 && rpc.body?.code !== 'PGRST202') {
    throw new Error(`RPC HTTP ${rpc.status}: ${JSON.stringify(rpc.body)?.slice(0, 200)}`);
  }
  rpcAvailable = false;
  console.warn('[sanctions] Brak funkcji sweep_expired_sanctions() — uruchom db/90_sanction_sweep.sql. Używam PATCH.');
  return null;
}

// Wynik wariantu PATCH: liczba zresetowanych kont.
function resultFromPatch(updated) {
  return { ok: true, cleared: Array.isArray(updated) ? updated.length : 0, via: 'patch' };
}

// Wykonuje jedno czyszczenie. Zwraca { ok, cleared, via } lub { ok:false, error }. Nie rzuca.
// Zapytania (await) są tylko tutaj, pomocniki wyżej jedynie interpretują odpowiedzi —
// dodatkowa funkcja async opóźniałaby zapytania i logi względem równoległych żądań.
export async function sweepExpiredSanctions() {
  if (!SB_URL || !SB_SERVICE) {
    return { ok: false, error: 'Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY' };
  }
  try {
    const viaRpc = rpcAvailable
      ? resultFromRpc(await sbRpcAdmin('sweep_expired_sanctions'))
      : null;   // null = funkcja SQL niedostępna
    const result = viaRpc
      ?? resultFromPatch(await sbAdmin('PATCH', expiredSanctionsPath(), { account_status: 'active', muted_until: null }));
    if (result.cleared) {
      console.log(`[sanctions] Zresetowano ${result.cleared} konto/a po wygaśnięciu kary (${result.via === 'rpc' ? 'SQL' : 'PATCH'}).`);
    }
    return result;
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
