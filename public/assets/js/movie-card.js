'use strict';

import { imgBaseURL, movieUrl } from "./api.js";
import { getCommunityRating, buildCommunityBadge } from "./communityRatings.js";
import { escapeHtml, escapeAttr } from "./utils.js";

// Tworzy element karty filmowej z posterem, tytułem, oceną TMDB i (jeśli dostępna) oceną społeczności
// Karta jest linkiem do strony szczegółów; poster ładowany leniwie dla wydajności
export function createMovieCard(movie) {
  const { poster_path, title, vote_average, release_date, id } = movie;
  // Odczyt synchroniczny z cache — null jeśli oceny społeczności jeszcze nie załadowane
  const communityData = getCommunityRating(id);
  const communityHtml = communityData ? buildCommunityBadge(communityData) : '';
  const safeTitle     = escapeHtml(title);
  const safeTitleAttr = escapeAttr(title);

  const card = document.createElement("div");
  card.classList.add("movie-card");
  card.dataset.movieId = id;
  // Flaga TMDB „adult" — filtr wiekowy (ageGate.js) blokuje taką kartę natychmiast
  if (movie.adult) card.dataset.adult = 'true';

  card.innerHTML = `<figure class="poster-box card-banner">
      <img src="${imgBaseURL}w342${poster_path}" alt="${safeTitleAttr}" class="img-cover" loading="lazy" />
    </figure>
    <h4 class="title">${safeTitle}</h4>
    <div class="meta-list">
      <div class="meta-item">
        <img src="./assets/imgs/star.svg" alt="rating" width="20" height="20" loading="lazy" />
        <span class="span">${Number(vote_average || 0).toFixed(1)}</span>
      </div>
      ${communityHtml}
      <div class="card-badge">${(release_date || "").split("-")[0] || "—"}</div>
    </div>
    <a href="${movieUrl(id, title, release_date)}" class="card-btn" title="${safeTitleAttr}"></a>`;

  return card;
}
