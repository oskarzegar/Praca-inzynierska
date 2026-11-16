'use strict';

// ============================================================================
// moderation.js  –  Komponenty akcji moderacyjnych (WF-16, WF-17)
//
// Współdzielone przez kartę profilu, listę recenzji i panel administratora.
// Każda akcja trafia do chronionego API (/api/admin/*); widoczność kontrolek
// zależy od roli, ale właściwą decyzję podejmuje serwer + RLS.
// ============================================================================

import { supabase }            from './supabase.js';
import { getCurrentRole, isModerator, adminFetch } from './rbac.js';
import { promptReason }        from './dialog.js';

// Komunikat po przeładowaniu strony (zmiana roli na profilu) — odczytywany raz
const STARTED_AT    = Date.now();
const STARTUP_FLASH = (() => {
  try {
    const raw = sessionStorage.getItem('profileModFlash');
    sessionStorage.removeItem('profileModFlash');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
})();

const STATUS_LABEL = { active: 'Aktywne', muted: 'Wyciszone', blocked: 'Zablokowane' };
const ROLE_LABEL   = { user: 'Użytkownik', moderator: 'Moderator', admin: 'Administrator' };

// Status efektywny: kara czasowa, której termin minął, liczy się jak „aktywne"
// (spójnie z can_post() w bazie). account_status w bazie pozostaje 'muted'/'blocked',
// ale interfejs nie powinien straszyć nieaktualną plakietką.
export function effectiveStatus(status, mutedUntil) {
  if ((status === 'muted' || status === 'blocked') && mutedUntil && new Date(mutedUntil) <= new Date()) {
    return 'active';
  }
  return status;
}

// Dopisek do etykiety statusu: termin wygaśnięcia kary lub „(na stałe)"
export function sanctionSuffix(status, mutedUntil) {
  if (status !== 'muted' && status !== 'blocked') return '';
  if (!mutedUntil) return ' (na stałe)';
  const d = new Date(mutedUntil);
  if (d <= new Date()) return '';   // kara już wygasła
  return ` do ${d.toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

// ── Akcje moderacyjne pod recenzją (usuń / wymuś flagę spoiler) ──────────────
// Zwraca element do dołączenia w stopce karty recenzji lub null (brak uprawnień).
export async function buildReviewModActions(review, onChange) {
  if (!(await isModerator())) return null;

  const el = document.createElement('div');
  el.className = 'review-mod-actions';
  el.innerHTML = `
    <span class="mod-tag">Moderacja</span>
    <button class="btn mod-btn mod-spoiler-btn">${review.is_spoiler ? 'Odkryj spoiler' : 'Oznacz spoiler'}</button>
    <button class="btn mod-btn mod-btn--danger mod-delete-btn">Usuń</button>`;

  el.querySelector('.mod-spoiler-btn').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const { ok, data } = await adminFetch(`/reviews/${review.id}/spoiler`, {
      method: 'PATCH', body: { is_spoiler: !review.is_spoiler },
    });
    if (ok) onChange?.();
    else { e.currentTarget.disabled = false; alert(data?.error || 'Nie udało się zmienić flagi.'); }
  });

  el.querySelector('.mod-delete-btn').addEventListener('click', async (e) => {
    if (!confirm('Usunąć tę recenzję jako moderator? Operacji nie można cofnąć.')) return;
    e.currentTarget.disabled = true;
    const { ok, data } = await adminFetch(`/reviews/${review.id}`, { method: 'DELETE' });
    if (ok) onChange?.();
    else { e.currentTarget.disabled = false; alert(data?.error || 'Nie udało się usunąć recenzji.'); }
  });

  return el;
}

// ── Akcja moderacyjna pod komentarzem (usuń cudzy) ───────────────────────────
export async function buildCommentModButton(comment, onChange) {
  if (!(await isModerator())) return null;

  const btn = document.createElement('button');
  btn.className = 'btn comment-delete-btn mod-comment-delete';
  btn.textContent = 'Usuń (mod)';
  btn.addEventListener('click', async () => {
    if (!confirm('Usunąć komentarz jako moderator?')) return;
    btn.disabled = true;
    const { ok, data } = await adminFetch(`/comments/${comment.id}`, { method: 'DELETE' });
    if (ok) onChange?.();
    else { btn.disabled = false; alert(data?.error || 'Nie udało się usunąć komentarza.'); }
  });
  return btn;
}

// ── Panel moderacji na karcie profilu (wycisz / blokuj / przywróć / rola) ────
export async function initProfileModeration(profileId, displayName, mountEl) {
  if (!mountEl) return;
  mountEl.innerHTML = '';

  const role = await getCurrentRole();
  const isMod = role === 'moderator' || role === 'admin';
  if (!isMod) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.id === profileId) return;     // nie moderujemy własnego konta z tego panelu

  // Aktualny stan konta docelowego (best-effort — akcje i tak waliduje serwer)
  const { data: target } = await supabase
    .from('profiles').select('role, account_status, muted_until').eq('id', profileId).maybeSingle();
  const targetRole   = target?.role || 'user';
  const targetUntil  = target?.muted_until || null;
  // Status efektywny — wygasła kara czasowa traktowana jak aktywne konto
  const targetStatus = effectiveStatus(target?.account_status || 'active', targetUntil);

  // Moderator działa tylko na zwykłych userach; admin na wszystkich poza adminami
  const canSanction = role === 'admin' ? targetRole !== 'admin' : targetRole === 'user';
  const canSetRole  = role === 'admin';

  const statusButtons = canSanction ? `
    <div class="mod-panel-row">
      ${targetStatus !== 'muted'   ? '<button class="btn mod-btn" data-act="muted">Wycisz konto</button>' : ''}
      ${targetStatus !== 'blocked' ? '<button class="btn mod-btn mod-btn--danger" data-act="blocked">Zablokuj konto</button>' : ''}
      ${targetStatus !== 'active'  ? '<button class="btn mod-btn mod-btn--ok" data-act="active">Przywróć konto</button>' : ''}
    </div>` : '<p class="mod-panel-note">Brak uprawnień do moderacji tego konta.</p>';

  const roleControl = canSetRole ? `
    <div class="mod-panel-row mod-role-row">
      <label class="mod-role-label">Rola:</label>
      <select class="filter-input filter-select mod-role-select">
        ${['user', 'moderator', 'admin'].map(r =>
          `<option value="${r}"${r === targetRole ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
      </select>
      <button class="btn mod-btn mod-role-save">Zapisz rolę</button>
    </div>` : '';

  mountEl.innerHTML = `
    <div class="mod-panel">
      <div class="mod-panel-head">
        <span class="mod-panel-title">Panel moderacji</span>
        <span class="mod-status-badge mod-status--${targetStatus}">${STATUS_LABEL[targetStatus]}${sanctionSuffix(targetStatus, targetUntil)}</span>
        <span class="mod-role-badge">${ROLE_LABEL[targetRole]}</span>
      </div>
      ${statusButtons}
      ${roleControl}
      <p class="mod-panel-msg" aria-live="polite"></p>
    </div>`;

  const msg = mountEl.querySelector('.mod-panel-msg');
  const setMsg = (text, ok = false) => {
    msg.textContent = text;
    msg.className = `mod-panel-msg ${ok ? 'mod-panel-msg--ok' : 'mod-panel-msg--err'}`;
  };

  // Komunikat zapisany przed przeładowaniem strony (zmiana roli) — ważny przez kilka
  // pierwszych sekund (panel może się wyrenderować kilka razy przy starcie strony)
  if (STARTUP_FLASH?.profileId === profileId && Date.now() - STARTED_AT < 8000) setMsg(STARTUP_FLASH.msg, true);

  // Zmiana statusu konta
  for (const btn of mountEl.querySelectorAll('[data-act]')) {
    btn.addEventListener('click', async () => {
      const status = btn.dataset.act;
      let reason = null, until = null;
      if (status !== 'active') {
        const res = await promptReason({
          title:        status === 'muted' ? 'Wyciszenie konta' : 'Blokada konta',
          message:      `Konto: ${displayName}. Podaj powód (opcjonalnie):`,
          confirmLabel: status === 'muted' ? 'Wycisz konto' : 'Zablokuj konto',
          danger:       status === 'blocked',
          withDuration: true,
        });
        if (res === null) return;     // anulowano
        reason = res.reason;
        until  = res.until;
      }
      btn.disabled = true;
      const { ok, data } = await adminFetch(`/users/${profileId}/status`, {
        method: 'PATCH', body: { status, reason, until },
      });
      if (ok) {
        setMsg(`Status konta zmieniony na: ${STATUS_LABEL[status]}.`, true);
        initProfileModeration(profileId, displayName, mountEl);   // odśwież panel
      } else {
        btn.disabled = false;
        setMsg(data?.error || 'Nie udało się zmienić statusu konta.');
      }
    });
  }

  // Zmiana roli (Admin)
  const roleSaveBtn = mountEl.querySelector('.mod-role-save');
  if (roleSaveBtn) {
    roleSaveBtn.addEventListener('click', async () => {
      const newRole = mountEl.querySelector('.mod-role-select').value;
      roleSaveBtn.disabled = true;
      const { ok, data } = await adminFetch(`/users/${profileId}/role`, {
        method: 'PATCH', body: { role: newRole },
      });
      if (ok) {
        // Przeładowanie odświeża całą stronę profilu (plakietka rangi, panel, uprawnienia)
        setMsg(`Rola zmieniona na: ${ROLE_LABEL[newRole]}. Odświeżanie…`, true);
        try {
          sessionStorage.setItem('profileModFlash', JSON.stringify({ profileId, msg: `Rola zmieniona na: ${ROLE_LABEL[newRole]}.` }));
        } catch { /* brak storage — sam reload */ }
        window.location.reload();
      } else {
        roleSaveBtn.disabled = false;
        setMsg(data?.error || 'Nie udało się zmienić roli.');
      }
    });
  }
}

export { STATUS_LABEL, ROLE_LABEL };
