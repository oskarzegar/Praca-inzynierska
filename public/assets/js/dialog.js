'use strict';

// ============================================================================
// dialog.js  –  Modale w obrębie strony (zamiast natywnych prompt/confirm)
//
// promptReason() – pyta o powód (textarea) oraz – opcjonalnie – o czas trwania
// kary (na stałe / liczba + jednostka). Zwraca Promise<{reason, until}|null>
// (null = anulowano; until = ISO string lub null dla kary permanentnej).
// Treści wstawiane przez textContent/setAttribute → bez ryzyka XSS.
// ============================================================================

// Wylicza znacznik czasu wygaśnięcia kary na podstawie liczby i jednostki
function computeUntil(amount, unit) {
  const n = Math.max(1, Math.floor(Number(amount) || 1));
  const d = new Date();
  switch (unit) {
    case 'seconds': d.setSeconds(d.getSeconds() + n); break;
    case 'minutes': d.setMinutes(d.getMinutes() + n); break;
    case 'days':    d.setDate(d.getDate() + n);       break;
    case 'months':  d.setMonth(d.getMonth() + n);     break;
    case 'years':   d.setFullYear(d.getFullYear() + n); break;
    default:        return null;
  }
  return d.toISOString();
}

export function promptReason({
  title,
  message      = 'Możesz podać powód (opcjonalnie):',
  placeholder  = 'Powód…',
  confirmLabel = 'Potwierdź',
  cancelLabel  = 'Anuluj',
  danger       = false,
  withDuration = false,
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'app-dialog-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'app-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const h = document.createElement('h3');
    h.className = 'app-dialog-title';
    h.textContent = title || 'Potwierdzenie';

    const p = document.createElement('p');
    p.className = 'app-dialog-msg';
    p.textContent = message;

    dialog.append(h, p);

    // ── Czas trwania kary (opcjonalny) ───────────────────────────────────────
    let perm = null, amount = null, unit = null;
    if (withDuration) {
      const durBlock = document.createElement('div');
      durBlock.className = 'app-dialog-duration';
      durBlock.innerHTML = `
        <span class="app-dialog-label">Czas trwania kary</span>
        <label class="app-dialog-perm">
          <input type="checkbox" class="app-dialog-perm-input" checked />
          Na stałe (do ręcznego zdjęcia)
        </label>
        <div class="app-dialog-dur-row">
          <input type="number" class="filter-input filter-input-sm app-dialog-dur-amount" min="1" value="1" disabled />
          <select class="filter-input filter-select app-dialog-dur-unit" disabled>
            <option value="seconds">sekund</option>
            <option value="minutes">minut</option>
            <option value="days" selected>dni</option>
            <option value="months">miesięcy</option>
            <option value="years">lat</option>
          </select>
        </div>`;
      perm   = durBlock.querySelector('.app-dialog-perm-input');
      amount = durBlock.querySelector('.app-dialog-dur-amount');
      unit   = durBlock.querySelector('.app-dialog-dur-unit');
      perm.addEventListener('change', () => {
        amount.disabled = unit.disabled = perm.checked;
        if (!perm.checked) amount.focus();
      });
      dialog.appendChild(durBlock);
    }

    const ta = document.createElement('textarea');
    ta.className = 'app-dialog-input';
    ta.rows = 3;
    ta.setAttribute('placeholder', placeholder);
    ta.setAttribute('maxlength', '300');

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn app-dialog-cancel';
    cancelBtn.textContent = cancelLabel;

    const confirmBtn = document.createElement('button');
    confirmBtn.className = `btn app-dialog-confirm${danger ? ' app-dialog-confirm--danger' : ''}`;
    confirmBtn.textContent = confirmLabel;

    actions.append(cancelBtn, confirmBtn);
    dialog.append(ta, actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    requestAnimationFrame(() => backdrop.classList.add('app-dialog-backdrop--active'));
    ta.focus();

    const cleanup = (value) => {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      resolve(value);
    };
    const confirm = () => {
      const until = (withDuration && perm && !perm.checked) ? computeUntil(amount.value, unit.value) : null;
      cleanup({ reason: ta.value.trim(), until });
    };
    const onKey = (e) => {
      if (e.key === 'Escape') cleanup(null);
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) confirm();
    };

    cancelBtn.addEventListener('click', () => cleanup(null));
    confirmBtn.addEventListener('click', confirm);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) cleanup(null); });
    document.addEventListener('keydown', onKey);
  });
}
