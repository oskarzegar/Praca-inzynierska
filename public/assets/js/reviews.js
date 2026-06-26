'use strict';

import { supabase } from './supabase.js';
import { buildReviewModActions, buildCommentModButton } from './moderation.js';
import { escapeHtml, escapeAttr } from './utils.js';
import { getMySanction, sanctionShortText } from './sanctionNotice.js';

// Zwraca tytuł rangi na podstawie sumy pomocnych głosów otrzymanych przez użytkownika
export function getRank(helpfulVotes) {
  if (helpfulVotes >= 50) return 'Filmoznawca';
  if (helpfulVotes >= 20) return 'Ekspert';
  if (helpfulVotes >= 10) return 'Krytyk';
  if (helpfulVotes >= 3)  return 'Recenzent';
  return 'Widz';
}

// Etykiety rang uprawnień (rola); zwykły user nie dostaje odznaki roli
const ROLE_BADGE_LABEL = { admin: 'Administrator', moderator: 'Moderator' };

// Progi rang z recenzji (pomocne głosy) — używane w podpowiedziach
const RANK_LADDER = [
  ['Recenzent', 3], ['Krytyk', 10], ['Ekspert', 20], ['Filmoznawca', 50],
];

// Buduje treść podpowiedzi: aktualna ranga, ile brakuje do następnej i pełna drabinka progów
function rankTooltip(helpfulVotes) {
  const rank = getRank(helpfulVotes);
  const next = RANK_LADDER.find(([, min]) => helpfulVotes < min);
  const nextLine = next
    ? `Do rangi „${next[0]}" brakuje ${next[1] - helpfulVotes} pomocnych głosów.`
    : 'Osiągnięto najwyższą rangę.';
  const ladder = 'Progi (pomocne głosy): Widz 0 · Recenzent 3 · Krytyk 10 · Ekspert 20 · Filmoznawca 50.';
  return `Ranga „${rank}" — ${helpfulVotes} pomocnych głosów.\n` +
         `Zdobywasz ją, gdy inni oznaczą Twoje recenzje jako pomocne.\n` +
         `${nextLine}\n${ladder}`;
}

// Buduje HTML odznak użytkownika: ranga uprawnień (Admin/Mod, jeśli dotyczy)
// oraz ranga zdobyta z recenzji (WF-24). Dla zwykłego usera tylko ranga z recenzji.
// Odznaki mają podpowiedź (title) z kryteriami widoczną po najechaniu.
export function buildRankBadges(role, helpfulVotes) {
  const hv = Number(helpfulVotes) || 0;
  const parts = [];
  if (ROLE_BADGE_LABEL[role]) {
    const roleTip = `Ranga uprawnień: ${ROLE_BADGE_LABEL[role]} (nadawana przez administratora).`;
    parts.push(`<span class="user-badge user-badge--role user-badge--${role}" title="${escapeAttr(roleTip)}">${ROLE_BADGE_LABEL[role]}</span>`);
  }
  parts.push(`<span class="user-badge user-badge--rank" title="${escapeAttr(rankTooltip(hv))}">${getRank(hv)}</span>`);
  return parts.join('');
}

// Pobiera role i sumy pomocnych głosów dla zbioru autorów (jedno zapytanie RPC)
export async function fetchRankMap(supabaseClient, userIds) {
  const map = new Map();
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length) return map;
  const { data } = await supabaseClient.rpc('user_rank_info', { p_user_ids: ids });
  for (const u of data || []) map.set(u.user_id, { role: u.role, helpful: Number(u.helpful_votes) || 0 });
  return map;
}

const RATING_FIELDS = [
  { name: 'rating_plot',    label: 'Fabuła'    },
  { name: 'rating_acting',  label: 'Aktorstwo' },
  { name: 'rating_music',   label: 'Muzyka'    },
  { name: 'rating_effects', label: 'Efekty'    },
];

// Generuje HTML z 5 gwiazdkami do wyświetlenia (tylko odczyt) — pełne do wartości val, puste powyżej
function ratingStarsHtml(val) {
  return Array.from({ length: 5 }, (_, i) =>
    `<span class="dstar${i < val ? ' dstar--full' : ''}">★</span>`
  ).join('');
}

// ─── Star rating builder ─────────────────────────────────────────────────────
// Tworzy interaktywny widget 5 gwiazdek (skala 1–5) z ukrytym polem input dla formularza
// Hover podświetla gwiazdki, kliknięcie zatwierdza wartość i zapisuje ją do hidden input
function buildStarRating(fieldName, labelText, initialValue = 3) {
  let current = initialValue;

  const wrapper = document.createElement('div');
  wrapper.className = 'review-rating-field';

  const lbl = document.createElement('label');
  lbl.className = 'review-rating-label';
  lbl.textContent = labelText;
  wrapper.appendChild(lbl);

  const row = document.createElement('div');
  row.className = 'star-rating-row';
  wrapper.appendChild(row);

  const starsEl = document.createElement('span');
  starsEl.className = 'star-rating';
  row.appendChild(starsEl);

  const valEl = document.createElement('span');
  valEl.className = 'star-rating-value';
  valEl.textContent = initialValue;
  row.appendChild(valEl);

  const hidden = document.createElement('input');
  hidden.type  = 'hidden';
  hidden.name  = fieldName;
  hidden.value = initialValue;
  wrapper.appendChild(hidden);

  const starEls = [];
  for (let i = 1; i <= 5; i++) {
    const s = document.createElement('span');
    s.className  = 'star-item';
    s.dataset.val = i;
    s.innerHTML  = `<span class="star-back">★</span><span class="star-front">★</span>`;
    starsEl.appendChild(s);
    starEls.push(s);
  }

  function paint(val) {
    valEl.textContent = val;
    for (let i = 0; i < 5; i++) {
      starEls[i].classList.toggle('star-full', val > i);
    }
  }

  paint(current);

  for (const star of starEls) {
    const v = Number(star.dataset.val);
    star.addEventListener('mouseenter', () => paint(v));
    star.addEventListener('click',      () => { current = v; hidden.value = v; paint(v); });
  }
  starsEl.addEventListener('mouseleave', () => paint(current));

  return wrapper;
}

// ─── initReviews ─────────────────────────────────────────────────────────────
// Główna funkcja sekcji recenzji: tworzy DOM, ładuje recenzje i formularz,
// a następnie reaguje na zmiany sesji (login/logout) bez przeładowania strony
export async function initReviews(movieId, movieTitle) {
  const pageContent = document.querySelector('[page-content]');
  if (!pageContent) return;

  const section = document.createElement('section');
  section.className = 'reviews-section';
  section.innerHTML = `
    <div class="title-wrapper reviews-header">
      <h3 class="title-large">Recenzje</h3>
      <div class="reviews-sort">
        <label for="reviews-sort-select">Sortuj:</label>
        <select id="reviews-sort-select" class="filter-input filter-select">
          <option value="newest">Od najnowszych</option>
          <option value="helpful">Najbardziej pomocne</option>
          <option value="rating_desc">Od najwyższych ocen</option>
          <option value="rating_asc">Od najniższych ocen</option>
        </select>
      </div>
    </div>
    <div id="review-form-container"></div>
    <div id="review-list"></div>`;
  pageContent.appendChild(section);

  const formContainer = section.querySelector('#review-form-container');
  const reviewList    = section.querySelector('#review-list');
  const sortSelect    = section.querySelector('#reviews-sort-select');

  // Zmiana kryterium sortowania (data / liczba pomocnych głosów) odświeża listę (WF-12)
  sortSelect.addEventListener('change', loadReviews);

  // ── Lista recenzji ─────────────────────────────────────────────────────────
  // Pobiera wszystkie recenzje dla danego filmu wraz z profilami, głosami i liczbą komentarzy
  // Oblicza średnią ocenę z 4 kategorii i wyświetla karty z przyciskami głosowania

  async function loadReviews() {
    const { data: reviews } = await supabase
      .from('reviews')
      .select(`
        id, user_id, rating_plot, rating_acting, rating_music, rating_effects,
        review_text, is_spoiler, created_at,
        profiles(id, display_name, avatar_url),
        review_votes(user_id, is_helpful),
        review_comments(id)
      `)
      .eq('movie_id', Number(movieId))
      .order('created_at', { ascending: false });

    const { data: { session } } = await supabase.auth.getSession();
    const currentUserId = session?.user?.id;

    // Mapa rang autorów (rola + ranga z recenzji) do odznak (WF-24)
    const rankMap = await fetchRankMap(supabase, (reviews || []).map(r => r.user_id));

    if (!reviews || reviews.length === 0) {
      reviewList.innerHTML = '<p class="no-results review-empty">Bądź pierwszym recenzentem!</p>';
      return;
    }

    // Sortowanie wg wybranego kryterium (WF-12): data, pomocne głosy lub ocena ogólna
    const sortMode = sortSelect.value;
    const avgOf = (r) => (r.rating_plot + r.rating_acting + r.rating_music + r.rating_effects) / 4;
    const ordered = [...reviews].sort((a, b) => {
      if (sortMode === 'helpful') {
        const ha = (a.review_votes || []).filter(v => v.is_helpful).length;
        const hb = (b.review_votes || []).filter(v => v.is_helpful).length;
        if (hb !== ha) return hb - ha;
      } else if (sortMode === 'rating_desc') {
        if (avgOf(b) !== avgOf(a)) return avgOf(b) - avgOf(a);
      } else if (sortMode === 'rating_asc') {
        if (avgOf(a) !== avgOf(b)) return avgOf(a) - avgOf(b);
      }
      return new Date(b.created_at) - new Date(a.created_at);
    });

    reviewList.innerHTML = '';

    for (const review of ordered) {
      const avg     = ((review.rating_plot + review.rating_acting + review.rating_music + review.rating_effects) / 4).toFixed(1);
      const profile = review.profiles;
      const votes   = review.review_votes || [];

      const helpfulCount    = votes.filter(v =>  v.is_helpful).length;
      const notHelpfulCount = votes.filter(v => !v.is_helpful).length;
      const myVote          = currentUserId ? votes.find(v => v.user_id === currentUserId) : null;
      const isOwn           = !!(currentUserId && review.user_id === currentUserId);

      const initial    = escapeHtml((profile?.display_name || '?')[0].toUpperCase());
      const avatarHtml = profile?.avatar_url
        ? `<img src="${escapeAttr(profile.avatar_url)}" alt="Avatar" />`
        : `<span class="review-avatar-initial">${initial}</span>`;

      const dateStr     = new Date(review.created_at).toLocaleDateString('pl-PL', {
        day: 'numeric', month: 'long', year: 'numeric',
      });
      const profileHref = `./profile.html?id=${profile?.id || review.user_id}`;

      const card = document.createElement('div');
      card.className = 'review-card';
      card.innerHTML = `
        <div class="review-header">
          <a class="review-avatar" href="${profileHref}">${avatarHtml}</a>
          <div class="review-meta">
            <a class="review-author" href="${profileHref}">${escapeHtml(profile?.display_name || 'Użytkownik')}</a>
            <span class="review-badges">${buildRankBadges(rankMap.get(review.user_id)?.role, rankMap.get(review.user_id)?.helpful ?? 0)}</span>
            <span class="review-date">${dateStr}</span>
          </div>
          <div class="review-avg-badge">${avg}/5</div>
        </div>
        <div class="review-ratings">
          ${RATING_FIELDS.map(f => `
            <div class="review-rating-item">
              <span class="rating-label">${f.label}</span>
              <span class="rating-stars">${ratingStarsHtml(review[f.name])}</span>
              <span class="rating-value">${review[f.name]}</span>
            </div>`).join('')}
        </div>
        ${review.review_text ? `
          <div class="review-text-wrapper${review.is_spoiler ? ' review-spoiler' : ''}">
            ${review.is_spoiler ? `<div class="spoiler-overlay"><button class="btn spoiler-reveal-btn">Pokaż spoiler</button></div>` : ''}
            <p class="review-text">${escapeHtml(review.review_text)}</p>
          </div>` : ''}
        <div class="review-footer">
          <div class="review-votes">
            <span class="votes-label">Pomocna?</span>
            <button class="btn vote-btn${myVote?.is_helpful === true  ? ' vote-btn--active' : ''}" data-vote="true"
              ${!currentUserId || isOwn ? 'disabled' : ''}>👍 ${helpfulCount}</button>
            <button class="btn vote-btn${myVote?.is_helpful === false ? ' vote-btn--active' : ''}" data-vote="false"
              ${!currentUserId || isOwn ? 'disabled' : ''}>👎 ${notHelpfulCount}</button>
          </div>
          <button class="btn review-comments-btn">Komentarze (${(review.review_comments || []).length})</button>
          ${isOwn ? `<button class="btn review-delete-btn">Usuń</button>` : ''}
        </div>`;

      const spoilerBtn = card.querySelector('.spoiler-reveal-btn');
      if (spoilerBtn) {
        spoilerBtn.addEventListener('click', () => {
          card.querySelector('.review-text-wrapper').classList.remove('review-spoiler');
          card.querySelector('.spoiler-overlay').remove();
        });
      }

      for (const btn of card.querySelectorAll('.vote-btn')) {
        btn.addEventListener('click', async () => {
          const { data: { session: s } } = await supabase.auth.getSession();
          if (!s) return;
          const isHelpful = btn.dataset.vote === 'true';
          const existing  = votes.find(v => v.user_id === s.user.id);

          if (existing) {
            if (existing.is_helpful === isHelpful) {
              await supabase.from('review_votes').delete()
                .eq('review_id', review.id).eq('user_id', s.user.id);
            } else {
              await supabase.from('review_votes').upsert({
                review_id: review.id, user_id: s.user.id, is_helpful: isHelpful,
              });
            }
          } else {
            await supabase.from('review_votes').insert({
              review_id: review.id, user_id: s.user.id, is_helpful: isHelpful,
            });
          }
          loadReviews();
        });
      }

      const deleteBtn = card.querySelector('.review-delete-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
          await supabase.from('reviews').delete().eq('id', review.id);
          loadReviews();
          renderForm();
        });
      }

      // Akcje moderacyjne (Mod/Admin): usuń cudzą recenzję / wymuś flagę spoilera (WF-17)
      buildReviewModActions(review, loadReviews).then((modEl) => {
        if (modEl) card.querySelector('.review-footer').appendChild(modEl);
      });

      // ── Przełącznik sekcji komentarzy ────────────────────────────────────
      const commentsBtn     = card.querySelector('.review-comments-btn');
      const commentsSection = document.createElement('div');
      commentsSection.className = 'review-comments-section';
      commentsSection.hidden    = true;
      card.appendChild(commentsSection);

      let commentsOpen = false;
      commentsBtn.addEventListener('click', async () => {
        commentsOpen = !commentsOpen;
        commentsSection.hidden = !commentsOpen;
        if (!commentsOpen) return;
        commentsSection.innerHTML = '<p class="results-loading">Ładowanie…</p>';
        const count = await renderComments(review.id, commentsSection, commentsBtn);
        commentsBtn.textContent = `Komentarze (${count})`;
      });

      reviewList.appendChild(card);
    }
  }

  // ── Komentarze ─────────────────────────────────────────────────────────────
  // Pobiera i renderuje komentarze do konkretnej recenzji; dołącza formularz dla zalogowanych
  // Zwraca aktualną liczbę komentarzy, żeby zaktualizować etykietę przycisku

  async function renderComments(reviewId, section, toggleBtn) {
    const { data: { session } } = await supabase.auth.getSession();

    const { data: comments } = await supabase
      .from('review_comments')
      .select('id, user_id, body, created_at, profiles(id, display_name, avatar_url)')
      .eq('review_id', reviewId)
      .order('created_at', { ascending: true });

    section.innerHTML = '';

    if (!comments || comments.length === 0) {
      section.innerHTML = '<p class="no-comments">Brak komentarzy. Bądź pierwszy!</p>';
    } else {
      for (const c of comments) {
        const isOwnC  = session?.user?.id === c.user_id;
        const initial = escapeHtml((c.profiles?.display_name || '?')[0].toUpperCase());
        const avHtml  = c.profiles?.avatar_url
          ? `<img src="${escapeAttr(c.profiles.avatar_url)}" alt="" />`
          : `<span class="comment-avatar-initial">${initial}</span>`;
        const dateStr = new Date(c.created_at).toLocaleDateString('pl-PL', {
          day: 'numeric', month: 'short', year: 'numeric',
        });

        const el = document.createElement('div');
        el.className = 'comment-item';
        el.innerHTML = `
          <div class="comment-header">
            <span class="comment-avatar">${avHtml}</span>
            <span class="comment-author">${escapeHtml(c.profiles?.display_name || 'Użytkownik')}</span>
            <span class="comment-date">${dateStr}</span>
            ${isOwnC ? `<button class="btn comment-delete-btn" data-id="${c.id}">Usuń</button>` : ''}
          </div>
          <p class="comment-body">${escapeHtml(c.body)}</p>`;

        if (isOwnC) {
          el.querySelector('.comment-delete-btn').addEventListener('click', async () => {
            await supabase.from('review_comments').delete().eq('id', c.id);
            const newCount = await renderComments(reviewId, section, toggleBtn);
            toggleBtn.textContent = `Komentarze (${newCount})`;
          });
        } else {
          // Moderator/Admin może usunąć cudzy komentarz (WF-16)
          buildCommentModButton(c, async () => {
            const newCount = await renderComments(reviewId, section, toggleBtn);
            toggleBtn.textContent = `Komentarze (${newCount})`;
          }).then((btn) => {
            if (btn) el.querySelector('.comment-header').appendChild(btn);
          });
        }

        section.appendChild(el);
      }
    }

    // Formularz dodawania komentarza, komunikat o karze lub zachęta do logowania
    const sanction = session ? await getMySanction(session) : null;
    if (session && sanction) {
      const p = document.createElement('p');
      p.className = 'comment-login-prompt review-sanction-notice';
      p.textContent = `${sanctionShortText(sanction)} Nie możesz teraz dodawać komentarzy.`;
      section.appendChild(p);
    } else if (session) {
      const form = document.createElement('form');
      form.className = 'comment-form';
      form.innerHTML = `
        <textarea class="comment-textarea" placeholder="Napisz komentarz..." maxlength="500"></textarea>
        <button type="submit" class="btn comment-submit-btn">Dodaj</button>`;

      const ta = form.querySelector('textarea');
      ta.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = this.scrollHeight + 'px';
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = ta.value.trim();
        if (!body) return;
        const submitBtn = form.querySelector('.comment-submit-btn');
        submitBtn.disabled = true;
        await supabase.from('review_comments').insert({
          review_id: reviewId,
          user_id:   session.user.id,
          body,
        });
        const newCount = await renderComments(reviewId, section, toggleBtn);
        toggleBtn.textContent = `Komentarze (${newCount})`;
      });

      section.appendChild(form);
    } else {
      const p = document.createElement('p');
      p.className   = 'comment-login-prompt';
      p.textContent = 'Zaloguj się, aby skomentować.';
      section.appendChild(p);
    }

    return comments?.length || 0;
  }

  // ── Formularz recenzji ─────────────────────────────────────────────────────
  // Wyświetla formularz lub komunikat zależnie od stanu: niezalogowany / już recenzował / może pisać

  async function renderForm() {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    if (!userId) {
      formContainer.innerHTML = `<p class="review-login-prompt">Zaloguj się, aby napisać recenzję.</p>`;
      return;
    }

    // Konto ukarane (wyciszone/zablokowane) — zamiast formularza pokaż jasny powód i termin
    const sanction = await getMySanction(session);
    if (sanction) {
      formContainer.innerHTML = '';
      const notice = document.createElement('p');
      notice.className = 'review-login-prompt review-sanction-notice';
      notice.textContent = `${sanctionShortText(sanction)} Nie możesz teraz dodawać recenzji.`;
      formContainer.appendChild(notice);
      return;
    }

    const { data: existing } = await supabase
      .from('reviews')
      .select('id')
      .eq('user_id', userId)
      .eq('movie_id', Number(movieId))
      .maybeSingle();

    if (existing) {
      formContainer.innerHTML = `<p class="review-already-submitted">Już dodałeś recenzję tego filmu.</p>`;
      return;
    }

    formContainer.innerHTML = '';
    const form = document.createElement('form');
    form.className = 'review-form';
    form.id        = 'review-form';
    form.setAttribute('novalidate', '');

    // Wiersz nagłówka: tytuł formularza i checkbox spoilera w tej samej linii
    const header = document.createElement('div');
    header.className = 'review-form-header';
    header.innerHTML = `
      <h4 class="review-form-title">Napisz recenzję</h4>
      <label class="review-spoiler-label">
        <input type="checkbox" name="is_spoiler" class="review-spoiler-check" />
        Zawiera spoilery
      </label>`;
    form.appendChild(header);

    // Siatka gwiazdkowych ocen kategorii
    const ratingsGrid = document.createElement('div');
    ratingsGrid.className = 'review-form-ratings';
    for (const f of RATING_FIELDS) {
      ratingsGrid.appendChild(buildStarRating(f.name, f.label, 5));
    }
    form.appendChild(ratingsGrid);

    // Pole tekstowe z automatyczną wysokością
    const textField = document.createElement('div');
    textField.className = 'review-text-field';
    textField.innerHTML = `
      <label class="review-rating-label" for="review-text-input">Treść recenzji (opcjonalnie)</label>
      <textarea id="review-text-input" class="review-textarea"
        placeholder="Podziel się swoją opinią..." maxlength="2000"></textarea>`;
    form.appendChild(textField);

    const textarea = form.querySelector('#review-text-input');
    textarea.addEventListener('input', function () {
      this.style.height = 'auto';
      this.style.height = this.scrollHeight + 'px';
    });

    // Komunikat o błędzie/sukcesie i przycisk wysłania
    const msgEl = document.createElement('p');
    msgEl.className = 'auth-message';
    msgEl.id        = 'review-msg';
    msgEl.setAttribute('aria-live', 'polite');
    form.appendChild(msgEl);

    const submitBtn = document.createElement('button');
    submitBtn.type      = 'submit';
    submitBtn.className = 'btn review-submit-btn';
    submitBtn.textContent = 'Opublikuj recenzję';
    form.appendChild(submitBtn);

    formContainer.appendChild(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msgEl.textContent = '';
      msgEl.className   = 'auth-message';

      const { data: { session: s } } = await supabase.auth.getSession();
      if (!s) return;

      submitBtn.disabled    = true;
      submitBtn.textContent = 'Publikowanie…';

      const { error } = await supabase.from('reviews').insert({
        user_id:        s.user.id,
        movie_id:       Number(movieId),
        movie_title:    movieTitle,
        rating_plot:    Number(form.rating_plot.value),
        rating_acting:  Number(form.rating_acting.value),
        rating_music:   Number(form.rating_music.value),
        rating_effects: Number(form.rating_effects.value),
        review_text:    textarea.value.trim() || null,
        is_spoiler:     form.is_spoiler.checked,
      });

      submitBtn.disabled    = false;
      submitBtn.textContent = 'Opublikuj recenzję';

      if (error) {
        msgEl.textContent = 'Błąd podczas zapisywania recenzji. Spróbuj ponownie.';
        msgEl.className   = 'auth-message auth-message--error';
      } else {
        renderForm();
        loadReviews();
      }
    });
  }

  const { data: { session: initSession } } = await supabase.auth.getSession();
  let previousUserId = initSession?.user?.id ?? null;

  renderForm();
  loadReviews();

  supabase.auth.onAuthStateChange((_event, session) => {
    const newUserId = session?.user?.id ?? null;
    if (newUserId !== previousUserId) {
      previousUserId = newUserId;
      renderForm();
      loadReviews();
    }
  });
}
