'use strict';

// ============================================================================
// admin.js  –  Panel administratora i moderatora (WF-15, WF-16, WF-17, WF-18)
//
// Agreguje ostatnio dodane recenzje i komentarze z natychmiastowymi akcjami
// moderacyjnymi oraz (dla Admina) zarządzanie kontami i rolami. Wszystkie
// operacje przechodzą przez chronione API /api/admin/* (RBAC po stronie serwera).
// ============================================================================

import { supabase }                  from './supabase.js';
import { getCurrentRole, adminFetch } from './rbac.js';
import { sidebar }                   from './sidebar.js';
import { search }                    from './search.js';
import { movieUrl }                  from './api.js';
import { promptReason }              from './dialog.js';
import { sanctionSuffix, effectiveStatus } from './moderation.js';
import { escapeHtml, escapeAttr }    from './utils.js';

sidebar();
search();

const pageContent = document.querySelector('[page-content]');

const STATUS_LABEL = { active: 'Aktywne', muted: 'Wyciszone', blocked: 'Zablokowane' };
const ROLE_LABEL   = { user: 'Użytkownik', moderator: 'Moderator', admin: 'Administrator' };

function fmtDate(iso) {
  return new Date(iso).toLocaleString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

let myRole = null;
let myId   = null;

// ── Inicjalizacja + guard dostępu ───────────────────────────────────────────
async function init() {
  pageContent.innerHTML = '<p class="results-loading">Sprawdzanie uprawnień…</p>';

  const { data: { session } } = await supabase.auth.getSession();
  myId   = session?.user?.id ?? null;
  myRole = await getCurrentRole();

  if (myRole !== 'moderator' && myRole !== 'admin') {
    const loggedIn = !!myId;
    pageContent.innerHTML = `
      <div class="admin-denied">
        <h1 class="heading">Panel niedostępny</h1>
        <p class="no-results">${loggedIn
          ? 'Twoje konto nie ma uprawnień Moderatora ani Administratora.'
          : 'Zaloguj się kontem z rolą Moderator lub Administrator, aby uzyskać dostęp do panelu.'}</p>
        ${loggedIn ? '' : '<button class="btn auth-submit-btn admin-login-btn" id="admin-login-btn">Zaloguj się</button>'}
      </div>`;
    // Otwiera modal konta (przycisk dodaje auth.js do nagłówka)
    pageContent.querySelector('#admin-login-btn')?.addEventListener('click', () => {
      document.querySelector('.auth-btn')?.click();
    });
    return;
  }

  renderShell();
  loadFeed();
}

function renderShell() {
  pageContent.innerHTML = `
    <div class="admin-page">
      <div class="title-wrapper">
        <h1 class="heading">Panel ${myRole === 'admin' ? 'administratora' : 'moderatora'}</h1>
      </div>
      <div class="admin-tabs" role="tablist">
        <button class="admin-tab admin-tab--active" data-tab="feed" role="tab">Treści do moderacji</button>
        <button class="admin-tab" data-tab="users" role="tab">Użytkownicy</button>
        <button class="admin-tab" data-tab="log" role="tab">Dziennik</button>
      </div>
      <section id="admin-feed"  class="admin-section"></section>
      <section id="admin-users" class="admin-section" hidden></section>
      <section id="admin-log"   class="admin-section" hidden></section>
    </div>`;

  const sections = {
    feed:  pageContent.querySelector('#admin-feed'),
    users: pageContent.querySelector('#admin-users'),
    log:   pageContent.querySelector('#admin-log'),
  };
  const loaded = { feed: true, users: false, log: false };   // feed ładowany w init()

  for (const tab of pageContent.querySelectorAll('.admin-tab')) {
    tab.addEventListener('click', () => {
      pageContent.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('admin-tab--active'));
      tab.classList.add('admin-tab--active');
      const key = tab.dataset.tab;
      for (const [k, el] of Object.entries(sections)) el.hidden = k !== key;
      if (!loaded[key]) {
        loaded[key] = true;
        if (key === 'users') renderUsersPanel();
        if (key === 'log')   loadLog();
      }
    });
  }
}

// ── Zakładka 1: feed recenzji i komentarzy ──────────────────────────────────
async function loadFeed() {
  const section = pageContent.querySelector('#admin-feed');
  section.innerHTML = '<p class="results-loading">Ładowanie treści…</p>';

  const { ok, data } = await adminFetch('/feed?limit=25');
  if (!ok) {
    section.innerHTML = `<p class="no-results">${escapeHtml(data?.error || 'Błąd ładowania treści.')}</p>`;
    return;
  }

  section.innerHTML = `
    <div class="admin-feed-col">
      <h3 class="title-large">Ostatnie recenzje</h3>
      <div id="admin-reviews"></div>
    </div>
    <div class="admin-feed-col">
      <h3 class="title-large">Ostatnie komentarze</h3>
      <div id="admin-comments"></div>
    </div>`;

  renderReviews(data.reviews || [], section.querySelector('#admin-reviews'));
  renderComments(data.comments || [], section.querySelector('#admin-comments'));
}

function renderReviews(reviews, container) {
  if (!reviews.length) { container.innerHTML = '<p class="no-results">Brak recenzji.</p>'; return; }
  container.innerHTML = '';

  for (const r of reviews) {
    const author = r.profiles?.display_name || 'Użytkownik';
    const card = document.createElement('div');
    card.className = 'admin-item';
    card.innerHTML = `
      <div class="admin-item-head">
        <a class="admin-item-title" href="${movieUrl(r.movie_id, r.movie_title)}">${escapeHtml(r.movie_title)}</a>
        ${r.is_spoiler ? '<span class="admin-flag">spoiler</span>' : ''}
      </div>
      <p class="admin-item-meta">
        <a class="admin-item-author" href="./profile.html?id=${r.user_id}">${escapeHtml(author)}</a> · ${fmtDate(r.created_at)}
      </p>
      ${r.review_text ? `<p class="admin-item-body">${escapeHtml(r.review_text)}</p>` : '<p class="admin-item-body admin-item-body--empty">(sama ocena, bez treści)</p>'}
      <div class="admin-item-actions">
        <button class="btn mod-btn mod-spoiler-btn">${r.is_spoiler ? 'Odkryj spoiler' : 'Oznacz spoiler'}</button>
        <button class="btn mod-btn mod-btn--danger mod-delete-btn">Usuń recenzję</button>
      </div>`;

    card.querySelector('.mod-spoiler-btn').addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      const res = await adminFetch(`/reviews/${r.id}/spoiler`, { method: 'PATCH', body: { is_spoiler: !r.is_spoiler } });
      if (res.ok) loadFeed(); else { e.currentTarget.disabled = false; alert(res.data?.error || 'Błąd.'); }
    });
    card.querySelector('.mod-delete-btn').addEventListener('click', async (e) => {
      if (!confirm('Usunąć tę recenzję?')) return;
      e.currentTarget.disabled = true;
      const res = await adminFetch(`/reviews/${r.id}`, { method: 'DELETE' });
      if (res.ok) card.remove(); else { e.currentTarget.disabled = false; alert(res.data?.error || 'Błąd.'); }
    });

    container.appendChild(card);
  }
}

function renderComments(comments, container) {
  if (!comments.length) { container.innerHTML = '<p class="no-results">Brak komentarzy.</p>'; return; }
  container.innerHTML = '';

  for (const c of comments) {
    const author = c.profiles?.display_name || 'Użytkownik';
    const card = document.createElement('div');
    card.className = 'admin-item';
    card.innerHTML = `
      <p class="admin-item-meta">
        <a class="admin-item-author" href="./profile.html?id=${c.user_id}">${escapeHtml(author)}</a> · ${fmtDate(c.created_at)}
      </p>
      <p class="admin-item-body">${escapeHtml(c.body)}</p>
      <div class="admin-item-actions">
        <button class="btn mod-btn mod-btn--danger mod-delete-btn">Usuń komentarz</button>
      </div>`;

    card.querySelector('.mod-delete-btn').addEventListener('click', async (e) => {
      if (!confirm('Usunąć ten komentarz?')) return;
      e.currentTarget.disabled = true;
      const res = await adminFetch(`/comments/${c.id}`, { method: 'DELETE' });
      if (res.ok) card.remove(); else { e.currentTarget.disabled = false; alert(res.data?.error || 'Błąd.'); }
    });

    container.appendChild(card);
  }
}

// ── Zakładka 2: zarządzanie kontami ─────────────────────────────────────────
function renderUsersPanel() {
  const section = pageContent.querySelector('#admin-users');
  section.innerHTML = `
    <div class="admin-user-search">
      <input type="text" id="admin-user-query" class="filter-input filter-input-text" placeholder="Szukaj po nazwie lub e-mailu…" autocomplete="off" />
      <button class="btn search-submit-btn" id="admin-user-search-btn">Szukaj</button>
    </div>
    <div id="admin-user-list"></div>`;

  const input  = section.querySelector('#admin-user-query');
  const runSearch = () => loadUsers(input.value.trim());
  section.querySelector('#admin-user-search-btn').addEventListener('click', runSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });

  loadUsers('');
}

async function loadUsers(query) {
  const list = pageContent.querySelector('#admin-user-list');
  list.innerHTML = '<p class="results-loading">Ładowanie…</p>';

  const { ok, data } = await adminFetch(`/users?limit=50${query ? `&query=${encodeURIComponent(query)}` : ''}`);
  if (!ok) { list.innerHTML = `<p class="no-results">${escapeHtml(data?.error || 'Błąd.')}</p>`; return; }
  if (!data.length) { list.innerHTML = '<p class="no-results">Brak użytkowników.</p>'; return; }

  list.innerHTML = '';
  for (const u of data) list.appendChild(buildUserRow(u));
}

function buildUserRow(u) {
  const isSelf      = u.id === myId;
  const canSanction = !isSelf && (myRole === 'admin' ? u.role !== 'admin' : u.role === 'user');
  const canSetRole  = !isSelf && myRole === 'admin';
  // Status efektywny — wygasła kara czasowa pokazywana jako „Aktywne" (spójnie z can_post)
  const status      = effectiveStatus(u.account_status, u.muted_until);

  const initial    = (u.display_name || u.email || '?')[0].toUpperCase();
  const avatarHtml = u.avatar_url ? `<img src="${escapeAttr(u.avatar_url)}" alt="" />` : `<span>${escapeHtml(initial)}</span>`;

  const row = document.createElement('div');
  row.className = 'admin-user-row';
  row.innerHTML = `
    <a class="admin-user-id" href="./profile.html?id=${u.id}">
      <span class="admin-user-avatar">${avatarHtml}</span>
      <span class="admin-user-meta">
        <span class="admin-user-name">${escapeHtml(u.display_name || 'Użytkownik')}</span>
        <span class="admin-user-email">${escapeHtml(u.email || '')}</span>
      </span>
    </a>
    <span class="mod-role-badge">${ROLE_LABEL[u.role] || u.role}</span>
    <span class="mod-status-badge mod-status--${status}">${STATUS_LABEL[status] || status}${sanctionSuffix(status, u.muted_until)}</span>
    <div class="admin-user-actions"></div>
    <p class="admin-user-msg" aria-live="polite"></p>`;

  const actions = row.querySelector('.admin-user-actions');
  const msg     = row.querySelector('.admin-user-msg');
  const setMsg  = (t, ok = false) => { msg.textContent = t; msg.className = `admin-user-msg ${ok ? 'mod-panel-msg--ok' : 'mod-panel-msg--err'}`; };

  if (canSanction) {
    if (status !== 'muted')   actions.appendChild(statusBtn(u, 'muted',   'Wycisz', false, setMsg));
    if (status !== 'blocked') actions.appendChild(statusBtn(u, 'blocked', 'Zablokuj', true, setMsg));
    if (status !== 'active')  actions.appendChild(statusBtn(u, 'active',  'Przywróć', false, setMsg));
  } else if (!isSelf) {
    const note = document.createElement('span');
    note.className = 'admin-user-note';
    note.textContent = 'Brak uprawnień do moderacji';
    actions.appendChild(note);
  }

  if (canSetRole) {
    const wrap = document.createElement('div');
    wrap.className = 'admin-role-control';
    wrap.innerHTML = `
      <select class="filter-input filter-select admin-role-select">
        ${['user', 'moderator', 'admin'].map(r => `<option value="${r}"${r === u.role ? ' selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}
      </select>
      <button class="btn mod-btn admin-role-save">Zapisz rolę</button>`;
    wrap.querySelector('.admin-role-save').addEventListener('click', async (e) => {
      const role = wrap.querySelector('.admin-role-select').value;
      e.currentTarget.disabled = true;
      const res = await adminFetch(`/users/${u.id}/role`, { method: 'PATCH', body: { role } });
      e.currentTarget.disabled = false;
      if (res.ok) { setMsg(`Rola zmieniona na: ${ROLE_LABEL[role]}.`, true); u.role = role; }
      else setMsg(res.data?.error || 'Błąd zmiany roli.');
    });
    actions.appendChild(wrap);
  }

  return row;
}

function statusBtn(u, status, label, danger, setMsg) {
  const btn = document.createElement('button');
  btn.className = `btn mod-btn${danger ? ' mod-btn--danger' : ''}`;
  btn.textContent = label;
  btn.addEventListener('click', async () => {
    let reason = null, until = null;
    if (status !== 'active') {
      const dlg = await promptReason({
        title:        status === 'muted' ? 'Wyciszenie konta' : 'Blokada konta',
        message:      `Konto: ${u.display_name || u.email}. Podaj powód (opcjonalnie):`,
        confirmLabel: label,
        danger:       status === 'blocked',
        withDuration: true,
      });
      if (dlg === null) return;
      reason = dlg.reason;
      until  = dlg.until;
    }
    btn.disabled = true;
    const res = await adminFetch(`/users/${u.id}/status`, { method: 'PATCH', body: { status, reason, until } });
    if (res.ok) { setMsg(`Status: ${STATUS_LABEL[status]}.`, true); loadUsers(pageContent.querySelector('#admin-user-query')?.value.trim() || ''); }
    else { btn.disabled = false; setMsg(res.data?.error || 'Błąd zmiany statusu.'); }
  });
  return btn;
}

// ── Zakładka 3: dziennik moderacji ──────────────────────────────────────────
const ACTION_LABEL = {
  'status:muted':          'wyciszył(a) konto',
  'status:blocked':        'zablokował(a) konto',
  'status:active':         'przywrócił(a) konto',
  'role:user':             'ustawił(a) rolę: Użytkownik',
  'role:moderator':        'ustawił(a) rolę: Moderator',
  'role:admin':            'ustawił(a) rolę: Administrator',
  'review:delete':         'usunął(ęła) recenzję',
  'review:hide_spoiler':   'oznaczył(a) recenzję jako spoiler',
  'review:unhide_spoiler': 'odkrył(a) spoiler recenzji',
  'comment:delete':        'usunął(ęła) komentarz',
};

async function loadLog() {
  const section = pageContent.querySelector('#admin-log');
  section.innerHTML = '<p class="results-loading">Ładowanie dziennika…</p>';

  const { ok, data } = await adminFetch('/log?limit=120');
  if (!ok) { section.innerHTML = `<p class="no-results">${escapeHtml(data?.error || 'Błąd.')}</p>`; return; }
  if (!data.length) { section.innerHTML = '<p class="no-results">Dziennik moderacji jest pusty.</p>'; return; }

  const list = document.createElement('div');
  list.className = 'admin-log-list';
  for (const e of data) list.appendChild(buildLogRow(e));
  section.innerHTML = '';
  section.appendChild(list);
}

function buildLogRow(e) {
  const modName    = e.moderator?.display_name || 'Moderacja';
  const targetName = e.target?.display_name || 'użytkownik';
  const action     = ACTION_LABEL[e.action] || escapeHtml(e.action);

  const modLink    = e.moderator
    ? `<a href="./profile.html?id=${e.moderator.id}">${escapeHtml(modName)}</a>`
    : escapeHtml(modName);
  const targetLink = e.target
    ? ` → <a href="./profile.html?id=${e.target.id}">${escapeHtml(targetName)}</a>`
    : '';

  const row = document.createElement('div');
  row.className = 'admin-log-row';
  row.innerHTML = `
    <span class="admin-log-time">${fmtDate(e.created_at)}</span>
    <span class="admin-log-text">${modLink} ${action}${targetLink}</span>
    ${e.reason ? `<span class="admin-log-reason">„${escapeHtml(e.reason)}"</span>` : ''}`;
  return row;
}

// Pierwsze uruchomienie + reakcja na zmianę stanu logowania
init();
// WAŻNE: nie wywołujemy metod auth (getSession) bezpośrednio w callbacku onAuthStateChange —
// Supabase trzyma wtedy blokadę auth i await getSession() zakleszcza cały podsystem logowania.
// setTimeout(…,0) odracza init poza kontekst blokady (callback zwraca natychmiast).
supabase.auth.onAuthStateChange(() => setTimeout(init, 0));
