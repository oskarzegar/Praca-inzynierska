'use strict';

// ============================================================================
// resetPassword.js  –  Obsługa linku resetującego hasło (WF-03)
//
// Po kliknięciu w link z e-maila Supabase ustawia w URL token odzyskiwania.
// Klient (supabase.js, detectSessionInUrl: true) wymienia go na sesję i emituje
// zdarzenie PASSWORD_RECOVERY. Strona pozwala wtedy ustawić nowe hasło.
// ============================================================================

import { supabase } from './supabase.js';

const form        = document.getElementById('reset-form');
const newPassEl    = document.getElementById('reset-new-password');
const confirmEl    = document.getElementById('reset-confirm-password');
const msg          = document.getElementById('reset-msg');
const submitBtn    = document.getElementById('reset-submit');
const doneBox      = document.getElementById('reset-done');

function setMsg(text, isError = true) {
  msg.textContent = text;
  msg.className = `auth-message ${isError ? 'auth-message--error' : 'auth-message--success'}`;
}

// Token odzyskiwania jest przetwarzany asynchronicznie — śledzimy zdarzenie i sesję
let recoveryReady = false;
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
    recoveryReady = true;
    setMsg('Wprowadź nowe hasło, aby dokończyć reset.', false);
  }
});

const { data: { session } } = await supabase.auth.getSession();
if (session) recoveryReady = true;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setMsg('', false);
  msg.textContent = '';

  const newPass = newPassEl.value;
  const confirm = confirmEl.value;

  if (newPass.length < 6)      { setMsg('Hasło musi mieć co najmniej 6 znaków.'); return; }
  if (newPass !== confirm)      { setMsg('Hasła nie są identyczne.'); return; }

  // Bez aktywnej sesji odzyskiwania updateUser nie ma czego zaktualizować
  const { data: { session: s } } = await supabase.auth.getSession();
  if (!s && !recoveryReady) {
    setMsg('Link wygasł lub jest nieprawidłowy. Poproś o nowy link do resetu hasła.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Zapisywanie…';
  const { error } = await supabase.auth.updateUser({ password: newPass });
  submitBtn.disabled = false;
  submitBtn.textContent = 'Zapisz nowe hasło';

  if (error) {
    const m = error.message || '';
    if (m.includes('different from the old') || m.includes('should be different')) {
      setMsg('Nowe hasło musi różnić się od poprzedniego.');
    } else if (m.includes('at least') || m.includes('Password should be')) {
      setMsg('Hasło musi mieć co najmniej 6 znaków.');
    } else if (m.includes('same') ) {
      setMsg('Nowe hasło musi różnić się od poprzedniego.');
    } else {
      setMsg('Nie udało się zmienić hasła. Link mógł wygasnąć — poproś o nowy.');
    }
    return;
  }

  // Po zmianie hasła wylogowujemy sesję odzyskiwania — użytkownik loguje się świadomie nowym hasłem
  await supabase.auth.signOut();

  form.hidden = true;
  doneBox.hidden = false;
});
