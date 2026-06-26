'use strict';

// ============================================================================
// sanctionNotice.js  –  Informowanie ukaranego użytkownika o jego karze
//
// Konto wyciszone/zablokowane nie może publikować (egzekwuje RLS), ale użytkownik
// musi wiedzieć, że ma karę, dlaczego i do kiedy. Ten moduł:
//   • getMySanction()      – zwraca aktywną karę zalogowanego użytkownika lub null,
//   • initSanctionNotice() – renderuje/zdejmuje globalny baner u góry strony.
// Powód pochodzi z moderation_log (wymaga polityki z db/60_self_sanction_visibility.sql).
// ============================================================================

import { supabase } from './supabase.js';
import { escapeHtml } from './utils.js';

const STATUS_LABEL = { muted: 'wyciszone', blocked: 'zablokowane' };
const BANNER_ID = 'sanction-banner';

// Czytelny termin wygaśnięcia kary
function formatUntil(until) {
  if (!until) return 'do odwołania (na stałe)';
  const d = new Date(until);
  return `do ${d.toLocaleString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

// Zwraca { status, until, reason } aktywnej kary lub null (konto aktywne / kara wygasła).
// Można przekazać znaną sesję, by uniknąć dodatkowego getSession (np. z callbacku auth).
export async function getMySanction(session) {
  if (session === undefined) {
    ({ data: { session } } = await supabase.auth.getSession());
  }
  if (!session) return null;

  const uid = session.user.id;
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_status, muted_until')
    .eq('id', uid)
    .maybeSingle();

  if (!profile || profile.account_status === 'active') return null;
  // Kara czasowa, która już minęła — traktujemy jak brak kary (spójne z can_post()).
  if (profile.muted_until && new Date(profile.muted_until) <= new Date()) return null;

  // Powód z najnowszego wpisu dziennika pasującego do bieżącego statusu.
  let reason = null;
  const { data: logs } = await supabase
    .from('moderation_log')
    .select('action, reason, created_at')
    .eq('target_user_id', uid)
    .order('created_at', { ascending: false })
    .limit(10);
  reason = (logs || []).find((l) => l.action === `status:${profile.account_status}`)?.reason || null;

  return { status: profile.account_status, until: profile.muted_until, reason };
}

// Zwięzły tekst kary (bezpieczny jako textContent) — używany też w formularzach.
export function sanctionShortText(s) {
  const base = `Twoje konto jest ${STATUS_LABEL[s.status]} ${formatUntil(s.until)}.`;
  return s.reason ? `${base} Powód: ${s.reason}` : base;
}

// Renderuje (lub zdejmuje, gdy brak kary) globalny baner u góry strony.
export async function initSanctionNotice(session) {
  const s = await getMySanction(session);
  const existing = document.getElementById(BANNER_ID);

  if (!s) { existing?.remove(); return; }

  const inner = `
    <div class="sanction-banner-inner">
      <span class="sanction-banner-icon" aria-hidden="true">⚠</span>
      <div class="sanction-banner-text">
        <strong>Twoje konto jest ${STATUS_LABEL[s.status]} ${formatUntil(s.until)}.</strong>
        ${s.reason ? `<span class="sanction-banner-reason">Powód: ${escapeHtml(s.reason)}</span>` : ''}
        <span class="sanction-banner-hint">${s.status === 'blocked'
          ? 'Dodawanie treści jest zablokowane.'
          : 'W tym czasie nie możesz dodawać recenzji ani komentarzy.'}</span>
      </div>
    </div>`;

  if (existing) {
    existing.className = `sanction-banner sanction-banner--${s.status}`;
    existing.innerHTML = inner;
    return;
  }

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.className = `sanction-banner sanction-banner--${s.status}`;
  banner.setAttribute('role', 'alert');
  banner.innerHTML = inner;
  document.body.insertBefore(banner, document.body.firstChild);
}
