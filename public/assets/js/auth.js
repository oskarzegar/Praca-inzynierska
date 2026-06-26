'use strict';

import { supabase } from './supabase.js';
import { escapeAttr } from './utils.js';
import { initSanctionNotice } from './sanctionNotice.js';

// ─── HTML modalu ──────────────────────────────────────────────────────────────

const MODAL_HTML = `
<div class="auth-modal-backdrop"></div>
<div class="auth-modal-content" role="dialog" aria-modal="true" aria-label="Konto użytkownika">

  <button class="auth-modal-close" id="auth-modal-close" aria-label="Zamknij">
    <img src="./assets/imgs/close.svg" width="20" height="20" alt="Zamknij" />
  </button>

  <!-- ── Widok: logowanie / rejestracja ───────────────────────── -->
  <div class="auth-view" id="auth-view-forms">
    <div class="auth-tabs" role="tablist">
      <button class="auth-tab auth-tab--active" role="tab" data-tab="login">Logowanie</button>
      <button class="auth-tab"                  role="tab" data-tab="register">Rejestracja</button>
    </div>

    <form class="auth-form" id="auth-form-login" novalidate>
      <div class="auth-field">
        <label class="auth-label" for="auth-login-email">Adres e-mail</label>
        <input type="email" id="auth-login-email" class="auth-input"
               placeholder="twoj@email.com" required autocomplete="email" />
      </div>
      <div class="auth-field">
        <label class="auth-label" for="auth-login-password">Hasło</label>
        <div class="auth-password-wrapper">
          <input type="password" id="auth-login-password" class="auth-input"
                 placeholder="••••••••" required autocomplete="current-password" />
          <button type="button" class="auth-password-toggle" aria-label="Pokaż hasło"></button>
        </div>
      </div>
      <div class="auth-forgot-row">
        <button type="button" class="auth-link-btn" id="auth-forgot-link">Nie pamiętam hasła</button>
      </div>
      <p class="auth-message" id="auth-msg-login" aria-live="polite"></p>
      <button type="submit" class="btn auth-submit-btn" id="auth-btn-login">Zaloguj się</button>
    </form>

    <form class="auth-form auth-form--hidden" id="auth-form-register" novalidate>
      <div class="auth-field">
        <label class="auth-label" for="auth-reg-email">Adres e-mail</label>
        <input type="email" id="auth-reg-email" class="auth-input"
               placeholder="twoj@email.com" required autocomplete="email" />
      </div>
      <div class="auth-field">
        <label class="auth-label" for="auth-reg-password">Hasło</label>
        <div class="auth-password-wrapper">
          <input type="password" id="auth-reg-password" class="auth-input"
                 placeholder="Min. 6 znaków" required autocomplete="new-password" minlength="6" />
          <button type="button" class="auth-password-toggle" aria-label="Pokaż hasło"></button>
        </div>
      </div>
      <div class="auth-field">
        <label class="auth-label" for="auth-reg-confirm">Potwierdź hasło</label>
        <div class="auth-password-wrapper">
          <input type="password" id="auth-reg-confirm" class="auth-input"
                 placeholder="Powtórz hasło" required autocomplete="new-password" />
          <button type="button" class="auth-password-toggle" aria-label="Pokaż hasło"></button>
        </div>
      </div>
      <p class="auth-message" id="auth-msg-register" aria-live="polite"></p>
      <button type="submit" class="btn auth-submit-btn" id="auth-btn-register">Zarejestruj się</button>
    </form>
    <div class="auth-menu-divider"></div>
    <button type="button" class="auth-menu-item" id="auth-guest-settings-btn">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Ustawienia
    </button>
  </div>

  <!-- ── Widok: reset hasła (WF-03) ────────────────────────────── -->
  <div class="auth-view auth-view--hidden" id="auth-view-reset">
    <div class="edit-profile-header">
      <button type="button" id="auth-back-from-reset" class="auth-back-btn" aria-label="Wróć">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <h2 class="auth-edit-title">Reset hasła</h2>
    </div>
    <p class="auth-confirm-body">
      Podaj adres e-mail powiązany z kontem. Wyślemy na niego link do ustawienia nowego hasła.
    </p>
    <form class="auth-form" id="auth-form-reset" novalidate>
      <div class="auth-field">
        <label class="auth-label" for="auth-reset-email">Adres e-mail</label>
        <input type="email" id="auth-reset-email" class="auth-input"
               placeholder="twoj@email.com" required autocomplete="email" />
      </div>
      <p class="auth-message" id="auth-msg-reset" aria-live="polite"></p>
      <button type="submit" class="btn auth-submit-btn" id="auth-btn-reset">Wyślij link resetujący</button>
    </form>
  </div>

  <!-- ── Widok: oczekiwanie na potwierdzenie e-mail ────────────── -->
  <div class="auth-view auth-view--hidden" id="auth-view-confirm">
    <div class="auth-confirm-icon" aria-hidden="true">✉</div>
    <h2 class="auth-confirm-title">Sprawdź swoją skrzynkę</h2>
    <p class="auth-confirm-body">
      Wysłaliśmy link aktywacyjny na podany adres e-mail.<br />
      Kliknij w link, aby dokończyć rejestrację.
    </p>
    <button class="btn auth-submit-btn" id="auth-back-to-login">Powrót do logowania</button>
  </div>

  <!-- ── Widok: zalogowany użytkownik ─────────────────────────── -->
  <div class="auth-view auth-view--hidden" id="auth-view-user">
    <div class="auth-user-header">
      <div class="auth-avatar-lg" id="auth-avatar-lg" aria-hidden="true"></div>
      <div>
        <p class="auth-user-name"   id="auth-user-name"></p>
        <p class="auth-user-email"  id="auth-user-email"></p>
        <p class="auth-user-status">Zalogowany</p>
      </div>
    </div>
    <nav class="auth-user-menu">
      <button class="auth-menu-item" id="auth-profile-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Mój profil
      </button>
      <button class="auth-menu-item" id="auth-edit-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Ustawienia
      </button>
      <a class="auth-menu-item auth-menu-item--mod" id="auth-admin-link" href="/admin" style="display:none">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 2l8 3v6c0 5-3.4 9-8 11-4.6-2-8-6-8-11V5l8-3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Panel moderacji
      </a>
      <div class="auth-menu-divider"></div>
      <button class="auth-menu-item auth-menu-item--danger" id="auth-logout-btn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Wyloguj się
      </button>
    </nav>
  </div>

  <!-- ── Widok: potwierdzenie usunięcia konta ──────────────────── -->
  <div class="auth-view auth-view--hidden" id="auth-view-delete">
    <h2 class="auth-confirm-title">Usuń konto</h2>
    <p class="auth-confirm-body">
      Ta operacja jest nieodwracalna. Aby potwierdzić, wpisz hasło do swojego konta.
    </p>
    <form class="auth-form" id="auth-form-delete" novalidate>
      <div class="auth-field">
        <label class="auth-label" for="auth-delete-password">Hasło</label>
        <input type="password" id="auth-delete-password" class="auth-input"
               placeholder="Wpisz swoje hasło" required autocomplete="current-password" />
      </div>
      <p class="auth-message" id="auth-msg-delete" aria-live="polite"></p>
      <div class="auth-user-actions">
        <button type="submit" class="btn auth-delete-btn" id="auth-confirm-delete-btn">Usuń konto</button>
        <button type="button" class="btn auth-logout-btn" id="auth-cancel-delete-btn">Anuluj</button>
      </div>
    </form>
  </div>

  <!-- ── Widok: ustawienia gościa (niezalogowany) ────────────── -->
  <div class="auth-view auth-view--hidden" id="auth-view-guest-settings">
    <div class="edit-profile-header">
      <button type="button" id="auth-back-from-guest-settings" class="auth-back-btn" aria-label="Wróć">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <h2 class="auth-edit-title">Ustawienia</h2>
    </div>
    <p class="settings-section-label">Preferencje</p>
    <div class="edit-section">
      <p class="edit-section-label">Motyw</p>
      <div class="theme-switcher">
        <button type="button" class="theme-btn" data-theme-val="system">System</button>
        <button type="button" class="theme-btn" data-theme-val="light">Jasny</button>
        <button type="button" class="theme-btn" data-theme-val="dark">Ciemny</button>
      </div>
    </div>
  </div>

  <!-- ── Widok: ustawienia ─────────────────────────────────────── -->
  <div class="auth-view auth-view--hidden" id="auth-view-edit">
    <div class="edit-profile-header">
      <button type="button" id="auth-back-from-edit" class="auth-back-btn" aria-label="Wróć">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M19 12H5M5 12l7 7M5 12l7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <h2 class="auth-edit-title">Ustawienia</h2>
    </div>

    <p class="settings-section-label">Profil</p>

    <!-- Awatar -->
    <div class="edit-section edit-avatar-section">
      <div class="edit-avatar-clickable" id="edit-avatar-clickable" role="button" tabindex="0" aria-label="Zmień zdjęcie profilowe">
        <div class="edit-avatar-preview" id="edit-avatar-preview"></div>
        <div class="edit-avatar-overlay" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="2"/>
          </svg>
          Zmień
        </div>
      </div>
      <input type="file" id="edit-avatar-input" accept=".jpg,.jpeg,.png,.webp" style="display:none" />
      <p class="auth-message" id="auth-msg-avatar" aria-live="polite"></p>
    </div>

    <!-- Nazwa wyświetlana -->
    <form class="edit-section" id="edit-form-name" novalidate>
      <p class="edit-section-label">Nazwa wyświetlana</p>
      <div class="auth-field">
        <input type="text" id="edit-display-name" class="auth-input"
               placeholder="Twoja nazwa" maxlength="50" autocomplete="nickname" />
      </div>
      <p class="auth-message" id="auth-msg-name" aria-live="polite"></p>
      <button type="submit" class="btn auth-submit-btn edit-save-btn" id="edit-btn-name">Zapisz</button>
    </form>

    <!-- Adres e-mail -->
    <form class="edit-section" id="edit-form-email" novalidate>
      <p class="edit-section-label">Adres e-mail</p>
      <div class="auth-field">
        <input type="email" id="edit-email" class="auth-input"
               placeholder="nowy@email.com" autocomplete="email" />
      </div>
      <p class="auth-message" id="auth-msg-email-edit" aria-live="polite"></p>
      <button type="submit" class="btn auth-submit-btn edit-save-btn" id="edit-btn-email">Zmień e-mail</button>
    </form>

    <!-- Hasło -->
    <form class="edit-section" id="edit-form-password" novalidate>
      <p class="edit-section-label">Hasło</p>
      <div class="auth-field">
        <label class="auth-label" for="edit-new-password">Nowe hasło</label>
        <div class="auth-password-wrapper">
          <input type="password" id="edit-new-password" class="auth-input"
                 placeholder="Min. 6 znaków" autocomplete="new-password" minlength="6" />
          <button type="button" class="auth-password-toggle" aria-label="Pokaż hasło"></button>
        </div>
      </div>
      <div class="auth-field">
        <label class="auth-label" for="edit-confirm-password">Potwierdź nowe hasło</label>
        <div class="auth-password-wrapper">
          <input type="password" id="edit-confirm-password" class="auth-input"
                 placeholder="Powtórz hasło" autocomplete="new-password" />
          <button type="button" class="auth-password-toggle" aria-label="Pokaż hasło"></button>
        </div>
      </div>
      <p class="auth-message" id="auth-msg-password-edit" aria-live="polite"></p>
      <button type="submit" class="btn auth-submit-btn edit-save-btn" id="edit-btn-password">Zmień hasło</button>
    </form>

    <p class="settings-section-label">Preferencje</p>

    <!-- Motyw -->
    <div class="edit-section">
      <p class="edit-section-label">Motyw</p>
      <div class="theme-switcher" id="theme-switcher">
        <button type="button" class="theme-btn" data-theme-val="system">System</button>
        <button type="button" class="theme-btn" data-theme-val="light">Jasny</button>
        <button type="button" class="theme-btn" data-theme-val="dark">Ciemny</button>
      </div>
    </div>

    <p class="settings-section-label">Widoczność list</p>

    <!-- Listy -->
    <div class="edit-section">
      <div class="privacy-toggle-row">
        <label for="toggle-watchlist-public">Lista do obejrzenia publiczna</label>
        <label class="privacy-toggle">
          <input type="checkbox" id="toggle-watchlist-public" class="privacy-toggle-input" />
          <span class="privacy-toggle-switch"></span>
        </label>
      </div>
      <div class="privacy-toggle-row">
        <label for="toggle-watched-public">Lista obejrzanych publiczna</label>
        <label class="privacy-toggle">
          <input type="checkbox" id="toggle-watched-public" class="privacy-toggle-input" />
          <span class="privacy-toggle-switch"></span>
        </label>
      </div>
      <p class="auth-message" id="auth-msg-privacy" aria-live="polite"></p>
    </div>

    <p class="settings-section-label settings-section-label--danger">Konto</p>

    <!-- Usuń konto -->
    <div class="edit-section">
      <button type="button" class="btn auth-delete-btn" id="auth-delete-btn">Usuń konto</button>
    </div>
  </div>

</div>
`;

// ─── Funkcje pomocnicze ───────────────────────────────────────────────────────

function setMsg(el, text, isError = true) {
  el.textContent = text;
  el.className   = `auth-message ${isError ? 'auth-message--error' : 'auth-message--success'}`;
}

function clearMsg(el) {
  el.textContent = '';
  el.className   = 'auth-message';
}

// Blokuje przycisk i wyświetla etykietę "w toku"; po zakończeniu przywraca etykietę z dataset.label
function setLoading(btn, label, loading) {
  btn.disabled    = loading;
  btn.textContent = loading ? label : btn.dataset.label;
}

// Skaluje obraz do max 400×400 px zachowując proporcje; nie powiększa mniejszych zdjęć
function resizeImage(file, maxSize = 400) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale  = Math.min(maxSize / img.naturalWidth, maxSize / img.naturalHeight, 1);
      const w      = Math.round(img.naturalWidth  * scale);
      const h      = Math.round(img.naturalHeight * scale);
      const canvas = document.createElement('canvas');
      canvas.width  = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))),
        file.type,
        0.92
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')); };
    img.src = url;
  });
}

// ─── Inicjalizacja ────────────────────────────────────────────────────────────

async function initAuth() {
  // ── Wstaw przycisk konta do nagłówka ─────────────────────────────────────────
  const header = document.querySelector('.header');
  if (!header) return;

  const authBtn = document.createElement('button');
  authBtn.className = 'auth-btn';
  authBtn.setAttribute('aria-label', 'Konto użytkownika');
  authBtn.innerHTML = `
    <svg class="auth-btn-icon" width="22" height="22" viewBox="0 0 24 24"
         fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="2"/>
      <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"
            stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <span class="auth-btn-avatar" aria-hidden="true"></span>
  `;

  const menuBtn = header.querySelector('[menu-btn]');
  header.insertBefore(authBtn, menuBtn);

  const avatarSpan = authBtn.querySelector('.auth-btn-avatar');
  const iconSvg    = authBtn.querySelector('.auth-btn-icon');

  // ── Utwórz modal ─────────────────────────────────────────────────────────────
  const modal = document.createElement('div');
  modal.className = 'auth-modal';
  modal.innerHTML = MODAL_HTML;
  document.body.appendChild(modal);

  // ── Referencje do elementów DOM ──────────────────────────────────────────────
  const backdrop    = modal.querySelector('.auth-modal-backdrop');
  const closeBtn    = modal.querySelector('#auth-modal-close');

  const viewForms          = modal.querySelector('#auth-view-forms');
  const viewReset          = modal.querySelector('#auth-view-reset');
  const viewConfirm        = modal.querySelector('#auth-view-confirm');
  const viewUser           = modal.querySelector('#auth-view-user');
  const viewDelete         = modal.querySelector('#auth-view-delete');
  const viewEdit           = modal.querySelector('#auth-view-edit');
  const viewGuestSettings  = modal.querySelector('#auth-view-guest-settings');

  const tabs         = modal.querySelectorAll('.auth-tab');
  const formLogin    = modal.querySelector('#auth-form-login');
  const formRegister = modal.querySelector('#auth-form-register');
  const formDelete   = modal.querySelector('#auth-form-delete');
  const formReset    = modal.querySelector('#auth-form-reset');
  const formEditName     = modal.querySelector('#edit-form-name');
  const formEditEmail    = modal.querySelector('#edit-form-email');
  const formEditPassword = modal.querySelector('#edit-form-password');

  const msgLogin        = modal.querySelector('#auth-msg-login');
  const msgRegister     = modal.querySelector('#auth-msg-register');
  const msgReset        = modal.querySelector('#auth-msg-reset');
  const msgDelete       = modal.querySelector('#auth-msg-delete');
  const msgAvatar       = modal.querySelector('#auth-msg-avatar');
  const msgName         = modal.querySelector('#auth-msg-name');
  const msgEmailEdit    = modal.querySelector('#auth-msg-email-edit');
  const msgPasswordEdit = modal.querySelector('#auth-msg-password-edit');

  const btnLogin    = modal.querySelector('#auth-btn-login');
  const btnRegister = modal.querySelector('#auth-btn-register');
  const btnReset    = modal.querySelector('#auth-btn-reset');
  const btnConfirmDelete = modal.querySelector('#auth-confirm-delete-btn');
  const btnEditName      = modal.querySelector('#edit-btn-name');
  const btnEditEmail     = modal.querySelector('#edit-btn-email');
  const btnEditPassword  = modal.querySelector('#edit-btn-password');

  const avatarLg    = modal.querySelector('#auth-avatar-lg');
  const userNameEl  = modal.querySelector('#auth-user-name');
  const userEmailEl = modal.querySelector('#auth-user-email');
  const adminLink   = modal.querySelector('#auth-admin-link');

  const editAvatarClickable = modal.querySelector('#edit-avatar-clickable');
  const editAvatarInput     = modal.querySelector('#edit-avatar-input');
  const editAvatarPreview   = modal.querySelector('#edit-avatar-preview');

  const profileBtn          = modal.querySelector('#auth-profile-btn');
  const toggleWatchlist     = modal.querySelector('#toggle-watchlist-public');
  const toggleWatched       = modal.querySelector('#toggle-watched-public');
  const msgPrivacy          = modal.querySelector('#auth-msg-privacy');

  // Przechowuje oryginalne etykiety — setLoading przywraca je po zakończeniu operacji
  btnLogin.dataset.label         = btnLogin.textContent;
  btnRegister.dataset.label      = btnRegister.textContent;
  btnReset.dataset.label         = btnReset.textContent;
  btnConfirmDelete.dataset.label = btnConfirmDelete.textContent;
  btnEditName.dataset.label      = btnEditName.textContent;
  btnEditEmail.dataset.label     = btnEditEmail.textContent;
  btnEditPassword.dataset.label  = btnEditPassword.textContent;

  // ── Przełączniki widoczności hasła ───────────────────────────────────────────

  const eyeOpen   = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/></svg>`;
  const eyeClosed = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  // Obsługuje wszystkie pola hasła w modalu (logowanie, rejestracja, edycja profilu)
  modal.querySelectorAll('.auth-password-toggle').forEach((btn) => {
    const input = btn.closest('.auth-password-wrapper').querySelector('input');
    btn.innerHTML = eyeOpen;
    btn.addEventListener('click', () => {
      const show    = input.type === 'password';
      input.type    = show ? 'text' : 'password';
      btn.innerHTML = show ? eyeClosed : eyeOpen;
      btn.setAttribute('aria-label', show ? 'Ukryj hasło' : 'Pokaż hasło');
    });
  });

  // ── Otwieranie / zamykanie modalu ────────────────────────────────────────────
  const openModal = () => {
    if (!viewEdit.classList.contains('auth-view--hidden')) {
      viewEdit.classList.add('auth-view--hidden');
      viewUser.classList.remove('auth-view--hidden');
    }
    if (!viewGuestSettings.classList.contains('auth-view--hidden')) {
      viewGuestSettings.classList.add('auth-view--hidden');
      viewForms.classList.remove('auth-view--hidden');
    }
    updateThemeButtons();
    modal.classList.add('auth-modal--active');
  };
  const closeModal = () => modal.classList.remove('auth-modal--active');

  authBtn.addEventListener('click', openModal);
  backdrop.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('auth-modal--active')) closeModal();
  });

  // ── Zakładki (logowanie / rejestracja) ───────────────────────────────────────
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => t.classList.remove('auth-tab--active'));
      tab.classList.add('auth-tab--active');
      clearMsg(msgLogin);
      clearMsg(msgRegister);
      if (tab.dataset.tab === 'login') {
        formLogin.classList.remove('auth-form--hidden');
        formRegister.classList.add('auth-form--hidden');
      } else {
        formRegister.classList.remove('auth-form--hidden');
        formLogin.classList.add('auth-form--hidden');
      }
    });
  });

  // ── Aktualizuj przycisk nagłówka i widok modalu na podstawie sesji ───────────
  // Wywoływana przy inicjalizacji i przy każdej zmianie stanu auth (login, logout, refresh tokenu)
  async function updateUI(session) {
    if (!session) {
      iconSvg.style.display    = '';
      avatarSpan.style.display = 'none';
      avatarSpan.innerHTML     = '';
      adminLink.style.display  = 'none';
      // Nie wymuszaj powrotu do logowania, gdy gość jest w trakcie resetu hasła
      if (viewReset.classList.contains('auth-view--hidden')) {
        viewForms.classList.remove('auth-view--hidden');
      }
      viewConfirm.classList.add('auth-view--hidden');
      viewUser.classList.add('auth-view--hidden');
      viewDelete.classList.add('auth-view--hidden');
      viewEdit.classList.add('auth-view--hidden');
      viewGuestSettings.classList.add('auth-view--hidden');
      initSanctionNotice(null);   // zdejmij baner kary po wylogowaniu
      return;
    }

    // Globalny baner informujący o aktywnej karze konta (status + termin + powód)
    initSanctionNotice(session);

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, avatar_url, role')
      .eq('id', session.user.id)
      .maybeSingle();

    const email       = session.user.email;
    const displayName = profile?.display_name || '';
    const avatarUrl   = profile?.avatar_url   || null;
    const initial     = (displayName[0] || email[0]).toUpperCase();

    // Link do panelu widoczny tylko dla ról moderacyjnych (WF-15)
    adminLink.style.display = (profile?.role === 'moderator' || profile?.role === 'admin') ? 'flex' : 'none';

    // Przycisk w nagłówku: ikona → inicjał lub awatar
    iconSvg.style.display    = 'none';
    avatarSpan.style.display = 'flex';
    if (avatarUrl) {
      avatarSpan.innerHTML = `<img src="${escapeAttr(avatarUrl)}" alt="Avatar" />`;
    } else {
      avatarSpan.innerHTML  = '';
      avatarSpan.textContent = initial;
    }

    // Modal: widok zalogowanego użytkownika (chyba że jesteśmy w edycji)
    viewForms.classList.add('auth-view--hidden');
    viewReset.classList.add('auth-view--hidden');
    viewConfirm.classList.add('auth-view--hidden');
    viewDelete.classList.add('auth-view--hidden');
    if (viewEdit.classList.contains('auth-view--hidden')) {
      viewUser.classList.remove('auth-view--hidden');
    }

    if (avatarUrl) {
      avatarLg.innerHTML = `<img src="${escapeAttr(avatarUrl)}" alt="Avatar" />`;
    } else {
      avatarLg.innerHTML  = '';
      avatarLg.textContent = initial;
    }
    userNameEl.textContent  = displayName || email.split('@')[0];
    userEmailEl.textContent = email;

  }

  // ── Inicjalna sesja ───────────────────────────────────────────────────────────
  const { data: { session } } = await supabase.auth.getSession();
  updateUI(session);

  supabase.auth.onAuthStateChange((_event, newSession) => {
    updateUI(newSession);
  });

  // ── Logowanie ─────────────────────────────────────────────────────────────────
  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgLogin);
    const email    = modal.querySelector('#auth-login-email').value.trim();
    const password = modal.querySelector('#auth-login-password').value;
    setLoading(btnLogin, 'Logowanie…', true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(btnLogin, '', false);
    if (error) {
      setMsg(msgLogin, mapLoginError(error.message));
    } else {
      formLogin.reset();
      closeModal();
    }
  });

  // ── Rejestracja ───────────────────────────────────────────────────────────────
  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgRegister);
    const email    = modal.querySelector('#auth-reg-email').value.trim();
    const password = modal.querySelector('#auth-reg-password').value;
    const confirm  = modal.querySelector('#auth-reg-confirm').value;
    if (password !== confirm) { setMsg(msgRegister, 'Hasła nie są identyczne.'); return; }
    setLoading(btnRegister, 'Rejestracja…', true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.href },
    });
    setLoading(btnRegister, '', false);
    if (error) {
      setMsg(msgRegister, mapRegisterError(error.message));
    } else {
      formRegister.reset();
      viewForms.classList.add('auth-view--hidden');
      viewConfirm.classList.remove('auth-view--hidden');
    }
  });

  // ── Powrót do logowania ───────────────────────────────────────────────────────
  modal.querySelector('#auth-back-to-login').addEventListener('click', () => {
    viewConfirm.classList.add('auth-view--hidden');
    viewForms.classList.remove('auth-view--hidden');
    tabs[0].click();
  });

  // ── Reset hasła (WF-03) ───────────────────────────────────────────────────────
  modal.querySelector('#auth-forgot-link').addEventListener('click', () => {
    clearMsg(msgReset);
    modal.querySelector('#auth-reset-email').value = modal.querySelector('#auth-login-email').value.trim();
    viewForms.classList.add('auth-view--hidden');
    viewReset.classList.remove('auth-view--hidden');
    modal.querySelector('#auth-reset-email').focus();
  });

  modal.querySelector('#auth-back-from-reset').addEventListener('click', () => {
    viewReset.classList.add('auth-view--hidden');
    viewForms.classList.remove('auth-view--hidden');
    tabs[0].click();
  });

  formReset.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgReset);
    const email = modal.querySelector('#auth-reset-email').value.trim();
    if (!email) { setMsg(msgReset, 'Podaj adres e-mail.'); return; }

    setLoading(btnReset, 'Wysyłanie…', true);
    // redirectTo prowadzi do dedykowanej strony, która wykryje sesję odzyskiwania i pozwoli ustawić nowe hasło
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password.html`,
    });
    setLoading(btnReset, '', false);

    // Komunikat neutralny (nie zdradza, czy konto istnieje) — dobra praktyka bezpieczeństwa
    if (error && error.message.includes('Too many requests')) {
      setMsg(msgReset, 'Zbyt wiele prób. Spróbuj za chwilę.');
    } else {
      formReset.reset();
      setMsg(msgReset, 'Jeśli konto istnieje, wysłaliśmy link do resetu hasła. Sprawdź skrzynkę e-mail.', false);
    }
  });

  // ── Ustawienia gościa (niezalogowany) ────────────────────────────────────────
  modal.querySelector('#auth-guest-settings-btn').addEventListener('click', () => {
    viewForms.classList.add('auth-view--hidden');
    viewGuestSettings.classList.remove('auth-view--hidden');
    updateThemeButtons();
  });

  modal.querySelector('#auth-back-from-guest-settings').addEventListener('click', () => {
    viewGuestSettings.classList.add('auth-view--hidden');
    viewForms.classList.remove('auth-view--hidden');
  });

  // ── Wylogowanie ───────────────────────────────────────────────────────────────
  modal.querySelector('#auth-logout-btn').addEventListener('click', async () => {
    await supabase.auth.signOut();
    closeModal();
  });

  // ── Usunięcie konta ───────────────────────────────────────────────────────────
  modal.querySelector('#auth-delete-btn').addEventListener('click', () => {
    viewEdit.classList.add('auth-view--hidden');
    viewDelete.classList.remove('auth-view--hidden');
    formDelete.reset();
    clearMsg(msgDelete);
    modal.querySelector('#auth-delete-password').focus();
  });

  modal.querySelector('#auth-cancel-delete-btn').addEventListener('click', () => {
    viewDelete.classList.add('auth-view--hidden');
    viewEdit.classList.remove('auth-view--hidden');
    formDelete.reset();
    clearMsg(msgDelete);
  });

  formDelete.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgDelete);
    const password = modal.querySelector('#auth-delete-password').value;
    const { data: { user } } = await supabase.auth.getUser();
    setLoading(btnConfirmDelete, 'Weryfikacja…', true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password });
    if (authError) {
      setLoading(btnConfirmDelete, '', false);
      setMsg(msgDelete, 'Nieprawidłowe hasło.');
      return;
    }
    setLoading(btnConfirmDelete, 'Usuwanie…', true);
    // delete_user to funkcja PostgreSQL z SECURITY DEFINER — klient nie może usunąć auth.users bezpośrednio
    const { error: deleteError } = await supabase.rpc('delete_user');
    if (deleteError) {
      setLoading(btnConfirmDelete, '', false);
      setMsg(msgDelete, 'Błąd podczas usuwania konta. Spróbuj ponownie później.');
      return;
    }
    await supabase.auth.signOut();
    closeModal();
  });

  // ── Mój profil ────────────────────────────────────────────────────────────────
  profileBtn.addEventListener('click', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      closeModal();
      window.location.href = `./profile.html?id=${user.id}`;
    }
  });

  // ── Edycja profilu — otwieranie ───────────────────────────────────────────────
  modal.querySelector('#auth-edit-btn').addEventListener('click', async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: profile }  = await supabase
      .from('profiles')
      .select('display_name, avatar_url, watchlist_public, watched_public')
      .eq('id', user.id)
      .maybeSingle();

    modal.querySelector('#edit-display-name').value = profile?.display_name || '';
    modal.querySelector('#edit-email').value = '';
    formEditPassword.reset();
    clearMsg(msgAvatar);
    clearMsg(msgName);
    clearMsg(msgEmailEdit);
    clearMsg(msgPasswordEdit);
    clearMsg(msgPrivacy);
    toggleWatchlist.checked = profile?.watchlist_public ?? false;
    toggleWatched.checked   = profile?.watched_public   ?? false;

    // Podgląd awatara w widoku edycji
    const avatarUrl = profile?.avatar_url;
    const initial   = ((profile?.display_name || user.email)[0]).toUpperCase();
    if (avatarUrl) {
      editAvatarPreview.innerHTML = `<img src="${escapeAttr(avatarUrl)}" alt="Avatar" />`;
    } else {
      editAvatarPreview.innerHTML  = '';
      editAvatarPreview.textContent = initial;
    }

    viewUser.classList.add('auth-view--hidden');
    viewEdit.classList.remove('auth-view--hidden');
  });

  // ── Edycja profilu — powrót ───────────────────────────────────────────────────
  modal.querySelector('#auth-back-from-edit').addEventListener('click', () => {
    viewEdit.classList.add('auth-view--hidden');
    viewUser.classList.remove('auth-view--hidden');
  });

  // ── Przełącznik motywu ────────────────────────────────────────────────────────
  function applyTheme(val) {
    if (val === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  function updateThemeButtons() {
    const stored = localStorage.getItem('theme') || 'system';
    for (const btn of modal.querySelectorAll('.theme-btn')) {
      btn.classList.toggle('theme-btn--active', btn.dataset.themeVal === stored);
    }
  }

  for (const btn of modal.querySelectorAll('.theme-btn')) {
    btn.addEventListener('click', () => {
      const val = btn.dataset.themeVal;
      localStorage.setItem('theme', val);
      if (val === 'system') {
        applyTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      } else {
        applyTheme(val);
      }
      updateThemeButtons();
    });
  }

  // ── Przełączniki prywatności list ─────────────────────────────────────────────
  async function savePrivacy() {
    clearMsg(msgPrivacy);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('profiles').update({
      watchlist_public: toggleWatchlist.checked,
      watched_public:   toggleWatched.checked,
    }).eq('id', user.id);
    if (error) {
      setMsg(msgPrivacy, 'Błąd zapisu ustawień prywatności.');
    } else {
      setMsg(msgPrivacy, 'Ustawienia prywatności zapisane.', false);
    }
  }
  toggleWatchlist.addEventListener('change', savePrivacy);
  toggleWatched.addEventListener('change',   savePrivacy);

  // ── Edycja profilu — przesyłanie awatara ─────────────────────────────────────
  editAvatarClickable.addEventListener('click',   () => editAvatarInput.click());
  editAvatarClickable.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); editAvatarInput.click(); }
  });

  editAvatarInput.addEventListener('change', async () => {
    const file = editAvatarInput.files[0];
    if (!file) return;

    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setMsg(msgAvatar, 'Dozwolone formaty: JPG, PNG, WebP.');
      editAvatarInput.value = '';
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMsg(msgAvatar, 'Plik jest za duży. Maksymalny rozmiar to 2 MB.');
      editAvatarInput.value = '';
      return;
    }

    clearMsg(msgAvatar);

    // Natychmiastowy podgląd przed uploadem
    const previewUrl = URL.createObjectURL(file);
    editAvatarPreview.innerHTML = `<img src="${previewUrl}" alt="Podgląd" />`;

    let blob;
    try {
      // Skaluje do max 400×400 przed wysłaniem
      blob = await resizeImage(file);
    } catch {
      setMsg(msgAvatar, 'Nie udało się przetworzyć zdjęcia.');
      URL.revokeObjectURL(previewUrl);
      return;
    }
    URL.revokeObjectURL(previewUrl);

    const { data: { user } } = await supabase.auth.getUser();
    const path = `${user.id}/avatar`;

    // Usuń stary plik przed wysłaniem nowego — zwykły INSERT nie wymaga obsługi ON CONFLICT UPDATE
    await supabase.storage.from('avatars').remove([path]);

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, blob, { contentType: blob.type });

    if (uploadError) {
      setMsg(msgAvatar, 'Błąd przesyłania. Spróbuj ponownie.');
      return;
    }

    const { data: { publicUrl } } = supabase.storage.from('avatars').getPublicUrl(path);
    // Cache-busting — URL jest ten sam po nadpisaniu, więc dodajemy parametr wersji
    const freshUrl = `${publicUrl}?v=${Date.now()}`;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ avatar_url: freshUrl })
      .eq('id', user.id);

    if (profileError) {
      setMsg(msgAvatar, 'Błąd aktualizacji profilu. Spróbuj ponownie.');
      return;
    }

    // Aktualizuje awatar wszędzie: nagłówek, widok użytkownika, widok edycji
    const imgHtml = `<img src="${freshUrl}" alt="Avatar" />`;
    avatarSpan.innerHTML         = imgHtml;
    avatarSpan.style.display     = 'flex';
    iconSvg.style.display        = 'none';
    avatarLg.innerHTML           = imgHtml;
    editAvatarPreview.innerHTML  = imgHtml;

    setMsg(msgAvatar, 'Zdjęcie profilowe zostało zmienione.', false);
    editAvatarInput.value = '';
  });

  // ── Edycja profilu — nazwa wyświetlana ───────────────────────────────────────
  formEditName.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgName);
    const name = modal.querySelector('#edit-display-name').value.trim();
    if (!name) { setMsg(msgName, 'Podaj nazwę wyświetlaną.'); return; }

    setLoading(btnEditName, 'Zapisywanie…', true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: name })
      .eq('id', user.id);
    setLoading(btnEditName, '', false);

    if (error) {
      setMsg(msgName, 'Błąd zapisu. Spróbuj ponownie.');
    } else {
      userNameEl.textContent = name;
      // Aktualizuje inicjał w nagłówku jeśli użytkownik nie ma awatara
      if (!avatarSpan.querySelector('img')) {
        const initial = name[0].toUpperCase();
        avatarSpan.textContent = initial;
        avatarLg.textContent   = initial;
        editAvatarPreview.textContent = initial;
      }
      setMsg(msgName, 'Nazwa została zmieniona.', false);
    }
  });

  // ── Edycja profilu — adres e-mail ────────────────────────────────────────────
  formEditEmail.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgEmailEdit);
    const email = modal.querySelector('#edit-email').value.trim();
    if (!email) { setMsg(msgEmailEdit, 'Podaj adres e-mail.'); return; }

    setLoading(btnEditEmail, 'Wysyłanie…', true);
    const { error } = await supabase.auth.updateUser({ email });
    setLoading(btnEditEmail, '', false);

    if (error) {
      setMsg(msgEmailEdit, mapEmailChangeError(error.message));
    } else {
      modal.querySelector('#edit-email').value = '';
      // Zmiana e-maila wymaga kliknięcia linku potwierdzającego wysłanego na nowy adres
      setMsg(msgEmailEdit, 'Link potwierdzający wysłany na nowy adres e-mail.', false);
    }
  });

  // ── Edycja profilu — hasło ────────────────────────────────────────────────────
  formEditPassword.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearMsg(msgPasswordEdit);
    const newPass     = modal.querySelector('#edit-new-password').value;
    const confirmPass = modal.querySelector('#edit-confirm-password').value;

    if (newPass.length < 6) { setMsg(msgPasswordEdit, 'Hasło musi mieć co najmniej 6 znaków.'); return; }
    if (newPass !== confirmPass) { setMsg(msgPasswordEdit, 'Hasła nie są identyczne.'); return; }

    setLoading(btnEditPassword, 'Zmiana…', true);
    const { error } = await supabase.auth.updateUser({ password: newPass });
    setLoading(btnEditPassword, '', false);

    if (error) {
      setMsg(msgPasswordEdit, 'Błąd zmiany hasła. Spróbuj ponownie.');
    } else {
      formEditPassword.reset();
      setMsg(msgPasswordEdit, 'Hasło zostało zmienione.', false);
    }
  });
}

// ─── Pomocniki komunikatów błędów ─────────────────────────────────────────────

function mapLoginError(msg) {
  if (msg.includes('banned') || msg.includes('user_banned'))
    return 'Twoje konto zostało zablokowane przez moderację. Skontaktuj się z administracją.';
  if (msg.includes('Invalid login credentials')) return 'Nieprawidłowy e-mail lub hasło.';
  if (msg.includes('Email not confirmed'))        return 'Konto nie zostało jeszcze potwierdzone. Sprawdź skrzynkę e-mail.';
  if (msg.includes('Too many requests'))          return 'Zbyt wiele prób. Spróbuj za chwilę.';
  return 'Błąd logowania. Spróbuj ponownie.';
}

function mapRegisterError(msg) {
  if (msg.includes('already registered') || msg.includes('User already registered'))
    return 'Ten adres e-mail jest już zarejestrowany.';
  if (msg.includes('Password should be'))
    return 'Hasło musi mieć co najmniej 6 znaków.';
  if (msg.includes('Unable to validate email'))
    return 'Podaj poprawny adres e-mail.';
  return 'Błąd rejestracji. Spróbuj ponownie.';
}

function mapEmailChangeError(msg) {
  if (msg.includes('already registered') || msg.includes('already been registered'))
    return 'Ten adres e-mail jest już zarejestrowany.';
  if (msg.includes('Unable to validate email'))
    return 'Podaj poprawny adres e-mail.';
  if (msg.includes('Too many requests'))
    return 'Zbyt wiele prób. Spróbuj za chwilę.';
  return 'Błąd zmiany e-maila. Spróbuj ponownie.';
}

// ─── Automatyczna inicjalizacja ───────────────────────────────────────────────
initAuth();
