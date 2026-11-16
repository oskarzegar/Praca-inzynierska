'use strict';

import { supabase }         from './supabase.js';
import { imgBaseURL, movieUrl } from './api.js';
import { sidebar }          from './sidebar.js';
import { search }           from './search.js';
import { buildRankBadges }  from './reviews.js';
import { initStats }        from './stats.js';
import { initProfileModeration } from './moderation.js';
import { escapeHtml, escapeAttr } from './utils.js';

sidebar();
search();

const params      = new URLSearchParams(window.location.search);
const profileId   = params.get('id');
const pageContent = document.querySelector('[page-content]');

if (!profileId) {
  pageContent.innerHTML = '<p class="no-results">Nie podano ID użytkownika.</p>';
} else {
  loadProfile();
}

// Ładuje profil użytkownika, oblicza statystyki i renderuje całą stronę
// Listy (watchlist/watched) pokazywane tylko właścicielowi lub gdy ustawione jako publiczne
async function loadProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  const currentUserId = session?.user?.id;
  const isOwn         = currentUserId === profileId;

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, watchlist_public, watched_public, role')
    .eq('id', profileId)
    .maybeSingle();

  if (!profile) {
    pageContent.innerHTML = '<p class="no-results">Nie znaleziono użytkownika.</p>';
    return;
  }

  const { data: reviews } = await supabase
    .from('reviews')
    .select('id, movie_id, movie_title, rating_plot, rating_acting, rating_music, rating_effects, review_text, is_spoiler, created_at, review_votes(is_helpful)')
    .eq('user_id', profileId)
    .order('created_at', { ascending: false });

  let totalHelpful = 0;
  for (const r of reviews || []) {
    totalHelpful += (r.review_votes || []).filter(v => v.is_helpful).length;
  }

  const { count: watchedCount } = await supabase
    .from('watched')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profileId);

  const displayName = profile.display_name || 'Użytkownik';
  const initial     = escapeHtml(displayName[0].toUpperCase());
  const avatarHtml  = profile.avatar_url
    ? `<img src="${escapeAttr(profile.avatar_url)}" alt="Avatar" />`
    : `<span class="profile-avatar-initial">${initial}</span>`;

  document.title = `${displayName} – Filmy`;

  pageContent.innerHTML = `
    <div class="profile-page">
      <div class="profile-header">
        <div class="profile-avatar-wrap">${avatarHtml}</div>
        <div class="profile-info">
          <h1 class="profile-name">${escapeHtml(displayName)}</h1>
          <div class="profile-badges">${buildRankBadges(profile.role, totalHelpful)}</div>
          <div class="profile-stats">
            <div class="profile-stat">
              <span class="stat-value">${watchedCount || 0}</span>
              <span class="stat-label">Obejrzane</span>
            </div>
            <div class="profile-stat">
              <span class="stat-value">${reviews?.length || 0}</span>
              <span class="stat-label">Recenzje</span>
            </div>
            <div class="profile-stat">
              <span class="stat-value">${totalHelpful}</span>
              <span class="stat-label">Pomocne głosy</span>
            </div>
          </div>
        </div>
        <div class="profile-mod-actions" id="profile-mod-actions"></div>
      </div>
      <div id="profile-stats-section" class="profile-stats-section"></div>
      <div id="profile-reviews-section"></div>
      <div id="profile-watchlist-section"></div>
      <div id="profile-watched-section"></div>
    </div>`;

  // Statystyki (WF-14) — własne zawsze, cudze gdy lista obejrzanych publiczna
  initStats(profileId, document.getElementById('profile-stats-section'));

  // Akcje moderacyjne na profilu (wycisz/blokuj/rola) — widoczne tylko dla Mod/Admin
  initProfileModeration(profileId, displayName, document.getElementById('profile-mod-actions'));

  renderReviews(reviews || []);

  if (isOwn || profile.watchlist_public) {
    const { data: watchlist } = await supabase
      .from('watchlist')
      .select('movie_id, movie_title, poster_path')
      .eq('user_id', profileId)
      .order('added_at', { ascending: false });
    renderMovieList('profile-watchlist-section', 'Lista do obejrzenia', watchlist || []);
  }

  if (isOwn || profile.watched_public) {
    const { data: watched } = await supabase
      .from('watched')
      .select('movie_id, movie_title, poster_path')
      .eq('user_id', profileId)
      .order('watched_at', { ascending: false });
    renderMovieList('profile-watched-section', 'Obejrzane filmy', watched || []);
  }
}

// Wyświetla ostatnie 5 recenzji użytkownika z obsługą spoilerów
function renderReviews(reviews) {
  const container = document.getElementById('profile-reviews-section');
  container.innerHTML = `<div class="title-wrapper"><h3 class="title-large">Ostatnie recenzje</h3></div>`;

  if (reviews.length === 0) {
    container.innerHTML += '<p class="no-results">Brak recenzji.</p>';
    return;
  }

  const list = document.createElement('div');
  list.className = 'profile-review-list';

  for (const r of reviews.slice(0, 5)) {
    const avg     = ((r.rating_plot + r.rating_acting + r.rating_music + r.rating_effects) / 4).toFixed(1);
    const dateStr = new Date(r.created_at).toLocaleDateString('pl-PL', {
      day: 'numeric', month: 'long', year: 'numeric',
    });

    const card = document.createElement('div');
    card.className = 'profile-review-card';
    card.innerHTML = `
      <div class="profile-review-header">
        <a class="profile-review-title" href="${movieUrl(r.movie_id, r.movie_title)}">${escapeHtml(r.movie_title)}</a>
        <span class="profile-review-avg">${avg}/5</span>
        <span class="profile-review-date">${dateStr}</span>
      </div>
      ${r.review_text ? `
        <div class="review-text-wrapper${r.is_spoiler ? ' review-spoiler' : ''}">
          ${r.is_spoiler ? `<div class="spoiler-overlay"><button class="btn spoiler-reveal-btn">Pokaż spoiler</button></div>` : ''}
          <p class="review-text">${escapeHtml(r.review_text)}</p>
        </div>` : ''}`;

    const spoilerBtn = card.querySelector('.spoiler-reveal-btn');
    if (spoilerBtn) {
      spoilerBtn.addEventListener('click', () => {
        card.querySelector('.review-text-wrapper').classList.remove('review-spoiler');
        card.querySelector('.spoiler-overlay').remove();
      });
    }

    list.appendChild(card);
  }

  container.appendChild(list);
}

// Renderuje siatkę filmów z plakatami; brak plakata zastępuje SVG placeholder
function renderMovieList(containerId, title, items) {
  const container = document.getElementById(containerId);
  container.innerHTML = `<div class="title-wrapper"><h3 class="title-large">${title}</h3></div>`;

  if (items.length === 0) {
    container.innerHTML += '<p class="no-results">Lista jest pusta.</p>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'profile-movie-grid';

  for (const item of items) {
    const posterSrc = item.poster_path
      ? `${imgBaseURL}w185${item.poster_path}`
      : './assets/imgs/no-poster.svg';

    const el = document.createElement('a');
    el.className = 'profile-movie-item';
    el.dataset.movieId = item.movie_id;   // filtr wiekowy (ageGate.js) obejmuje też listy profili
    el.href = movieUrl(item.movie_id, item.movie_title);
    el.innerHTML = `
      <img src="${posterSrc}" alt="${escapeAttr(item.movie_title)}" loading="lazy" />
      <p>${escapeHtml(item.movie_title)}</p>`;
    grid.appendChild(el);
  }

  container.appendChild(grid);
}
