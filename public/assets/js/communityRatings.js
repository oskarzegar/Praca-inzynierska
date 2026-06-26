'use strict';

import { supabase } from "./supabase.js";

// Mapa movieId → {avg, count} przechowująca załadowane oceny
const cache = new Map();
let batchPromise = null;

const THUMB_SVG_SM = `<svg class="community-icon" width="13" height="13" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7 22H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h4V22Zm2 0V11l3.5-8c.83 0 1.5.67 1.5 1.5v.5l-1 5h5.5a2 2 0 0 1 2 2.22l-1 7A2 2 0 0 1 21.5 21H9Z"/></svg>`;
const THUMB_SVG_LG = `<svg class="community-icon" width="17" height="17" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M7 22H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h4V22Zm2 0V11l3.5-8c.83 0 1.5.67 1.5 1.5v.5l-1 5h5.5a2 2 0 0 1 2 2.22l-1 7A2 2 0 0 1 21.5 21H9Z"/></svg>`;

// Wsadowo ładuje oceny wszystkich filmów przez RPC; kolejne wywołania zwracają tę samą obietnicę
export function loadCommunityRatings() {
  if (batchPromise) return batchPromise;
  batchPromise = supabase
    .rpc('movies_by_community_rating', { min_rating: 0 })
    .then(({ data, error }) => {
      if (!error && data) {
        for (const { movie_id, avg_rating, review_count } of data) {
          cache.set(Number(movie_id), {
            avg: Math.round(parseFloat(avg_rating) * 10) / 10,
            count: Number(review_count),
          });
        }
      }
      updateCardsInDOM();
    });
  return batchPromise;
}

// Pobiera ocenę społeczności dla pojedynczego filmu (strona szczegółów); najpierw sprawdza cache
export async function loadMovieCommunityRating(movieId) {
  const id = Number(movieId);
  if (cache.has(id)) return cache.get(id);

  const { data, error } = await supabase
    .from('reviews')
    .select('rating_plot, rating_acting, rating_music, rating_effects')
    .eq('movie_id', id);

  if (error || !data || data.length === 0) return null;

  const avg = data.reduce(
    (sum, r) => sum + (r.rating_plot + r.rating_acting + r.rating_music + r.rating_effects) / 4,
    0
  ) / data.length;

  const result = { avg: Math.round(avg * 10) / 10, count: data.length };
  cache.set(id, result);
  return result;
}

// Synchroniczne odczytanie z cache — zwraca null jeśli dane jeszcze nie załadowane
export function getCommunityRating(movieId) {
  return cache.get(Number(movieId)) ?? null;
}

// Buduje HTML badge z oceną społeczności używany w kartach filmów
export function buildCommunityBadge(data) {
  return `<div class="meta-item community-rating-badge">
    ${THUMB_SVG_SM}
    <span class="community-avg">${data.avg.toFixed(1)}</span>
    <span class="community-count">(${data.count})</span>
  </div>`;
}

// Buduje większy badge z oceną dla strony szczegółów filmu
export function buildCommunityBadgeLg(data) {
  return `<div class="meta-item community-rating-detail">
    ${THUMB_SVG_LG}
    <span class="community-avg">${data.avg.toFixed(1)}<span class="community-scale">/5</span></span>
    <span class="community-count">${data.count} ${data.count === 1 ? 'ocena' : data.count < 5 ? 'oceny' : 'ocen'}</span>
  </div>`;
}

// Wstecznie wstrzykuje badge do kart, które powstały zanim cache był gotowy
export function updateCardsInDOM() {
  for (const card of document.querySelectorAll('.movie-card[data-movie-id]')) {
    if (card.querySelector('.community-rating-badge')) continue;
    const data = cache.get(Number(card.dataset.movieId));
    if (!data) continue;
    const yearBadge = card.querySelector('.meta-list .card-badge');
    if (yearBadge) {
      yearBadge.insertAdjacentHTML('beforebegin', buildCommunityBadge(data));
    } else {
      card.querySelector('.meta-list')?.insertAdjacentHTML('beforeend', buildCommunityBadge(data));
    }
  }
}
