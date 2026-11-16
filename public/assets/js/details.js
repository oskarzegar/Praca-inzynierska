'use strict';

import { imgBaseURL, fetchData } from "./api.js";
import { sidebar }               from "./sidebar.js";
import { createMovieCard }       from "./movie-card.js";
import { search }                from "./search.js";
import { initListButtons }       from "./lists.js";
import { initReviews }           from "./reviews.js";
import { initMovieRadar }        from "./movieRadar.js";
import { loadMovieCommunityRating, buildCommunityBadgeLg } from "./communityRatings.js";
import { pickCertification, minAgeFor, AGE_LEVELS } from "./ageRatings.js";
import { getViewer, isAllowed, blockReason, onViewerChange } from "./ageGate.js";
import { escapeHtml, escapeAttr } from "./utils.js";
search();
sidebar();
// ID wybranego filmu odczytywane z URL: /film/tytul-rok-id → ostatni segment numeryczny
const movieId     = (window.location.pathname.match(/-(\d+)$/) || [])[1] || null;
const pageContent = document.querySelector("[page-content]");

// Zamienia tablicę obiektów gatunków na czytelny ciąg, np. [{name:"Akcja"},{name:"Dramat"}] → "Akcja, Dramat"
const getGenres = function (list) {
  const newGenreList = [];
  for (const { name } of list) newGenreList.push(name);
  return newGenreList.join(", ");
};

// Zwraca maks. 10 aktorów — TMDB dostarcza obsadę posortowaną wg kolejności na napisach końcowych
const getCasts = function (list) {
  const newCastsList = [];
  for (let i = 0; i < list.length && i < 10; i++) {
    const { name } = list[i];
    newCastsList.push(name);
  }
  return newCastsList.join(", ");
};

// Filtruje crew żeby wyodrębnić tylko reżyserów — inni członkowie ekipy (job) są pomijani
const getDirectors = function (list) {
  const directors     = list.filter(({ job }) => job === "Director");
  const directorsList = [];
  for (const { name } of directors) directorsList.push(name);
  return directorsList.join(", ");
};

// Zostawia tylko Trailery i Teasery z YouTube — Behind the Scenes, Featurettes itp. są pomijane
const filterVideos = function (list) {
  return list.filter(({ type, site }) => (type === "Trailer" || type === "Teaser") && site === "YouTube");
};

// Pobiera dostępność streamingową z TMDB (dane JustWatch) i renderuje sekcję "Gdzie obejrzeć"
const addWatchProviders = function (movieDetail) {
  fetchData(`/api/tmdb/movie/${movieId}/watch/providers`, function (data) {
    // Dane ograniczone do Polski (PL); brak tego klucza = film niedostępny w polskich serwisach
    const providers = data.results && data.results.PL;
    if (!providers) return;

    // Grupy z odpowiedzi TMDB/JustWatch. API NIE zwraca bezpośrednich linków do platform
    // (deep links) — jedynie `link` do strony TMDB z pełną listą opcji dla tytułu.
    const groups = [
      ["flatrate", "Subskrypcja"],
      ["free",     "Za darmo"],
      ["ads",      "Z reklamami"],
      ["rent",     "Wypożyczenie"],
      ["buy",      "Zakup"],
    ].filter(([key]) => Array.isArray(providers[key]) && providers[key].length > 0);
    if (!groups.length) return;

    const streamingItem = document.createElement("div");
    streamingItem.classList.add("list-item", "streaming-section");

    // Każde logo prowadzi do strony z opcjami dla tego tytułu (brak deep linków w API)
    const link = typeof providers.link === "string" && /^https:\/\//.test(providers.link) ? providers.link : null;
    const buildProviderLogos = function (list) {
      return [...list]
        .sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99))
        .map(p => {
          const name = escapeAttr(p.provider_name);
          const img  = `<img src="${imgBaseURL}w45${escapeAttr(p.logo_path)}" alt="${name}" loading="lazy" />`;
          return link
            ? `<a href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" class="provider-logo" title="${name}">${img}</a>`
            : `<span class="provider-logo" title="${name}">${img}</span>`;
        }).join('');
    };

    let html = `<p class="list-name">Gdzie obejrzeć</p><div class="streaming-providers">`;
    for (const [key, label] of groups) {
      html += `<div class="provider-group">
        <p class="provider-group-label">${label}</p>
        <div class="providers-list">${buildProviderLogos(providers[key])}</div>
      </div>`;
    }
    html += `</div>`;

    if (link) {
      html += `<a href="${escapeAttr(link)}" target="_blank" rel="noopener noreferrer" class="justwatch-link">
        Sprawdź wszystkie opcje (TMDB / JustWatch) →
      </a>`;
    }

    streamingItem.innerHTML = html;
    const detailList = movieDetail.querySelector(".detail-list");
    if (detailList) detailList.appendChild(streamingItem);
  });
};

// append_to_response łączy 4 żądania w jedno (szczegóły, obsada, wideo, klasyfikacje wiekowe)
fetchData(`/api/tmdb/movie/${movieId}?language=pl&append_to_response=credits,videos,release_dates`, async function (movie) {
  const {
    backdrop_path,
    poster_path,
    title,
    release_date,
    runtime,
    vote_average,
    genres,
    overview,
  } = movie;

  // Klasyfikacja wiekowa wg priorytetu krajów (PL → US → GB → DE → FR), z opisem.
  // Wcześniej brano releases.countries[0] — przypadkowy kraj, bez wyjaśnienia znaczenia.
  const certInfo = pickCertification(movie.release_dates);
  const minAge   = minAgeFor({ certification: certInfo, adult: movie.adult });

  // Filtr treści: film powyżej wieku widza → zamiast szczegółów komunikat o blokadzie
  const viewer = await getViewer();
  if (!isAllowed(minAge, viewer.age)) {
    renderAgeBlock(minAge, viewer);
    return;
  }

  // Zmiana widza (np. wylogowanie dorosłego) może sprawić, że treść przestaje być dozwolona
  onViewerChange((v) => { if (!isAllowed(minAge, v.age)) window.location.reload(); });

  const certBadge = certInfo ? buildCertBadge(certInfo) : '';
  const cast          = movie.credits?.cast  || [];
  const crew          = movie.credits?.crew  || [];
  const videos        = movie.videos?.results || [];

  document.title = `${title} - Filmy`;
  const movieDetail = document.createElement("div");
  movieDetail.classList.add("movie-detail");
  movieDetail.innerHTML = `
  <div class="backdrop-img" style="background-image: url('${imgBaseURL}w1280${backdrop_path || poster_path}')"></div>
        <figure class="poster-box movie-poster">
          <img src="${imgBaseURL}w342${poster_path}" alt="${title}" class="img-cover" />
        </figure>
        <div class="detail-box">
          <div class="detail-content">
            <h1 class="heading">${title}</h1>
            <div class="meta-list">
              <div class="meta-item">
                <img src="./assets/imgs/star.svg" width="20" height="20" alt="rating" />
                <span class="span">${Number(vote_average || 0).toFixed(1)}</span>
              </div>
              <div class="separator"></div>
              <div class="meta-item">${runtime}m</div>
              <div class="separator"></div>
              <div class="meta-item">${release_date ? release_date.split("-")[0] : ''}</div>
              ${certBadge}
            </div>
            <p class="genre">${getGenres(genres)}</p>
            <p class="overview">
              ${overview}
            </p>
            <ul class="detail-list">
              <div class="list-item">
                <p class="list-name">W rolach głównych</p>
                <p>${getCasts(cast)}</p>
              </div>
              <div class="list-item">
                <p class="list-name">Reżyseria</p>
                <p>${getDirectors(crew)}</p>
              </div>
            </ul>
          </div>
          <div class="title-wrapper">
            <h3 class="title-large">Zwiastuny i klipy</h3>
          </div>
          <div class="slider-list">
            <div class="slider-inner">
            </div>
          </div>
        </div>`;
  for (const { key, name } of filterVideos(videos)) {
    const videoCard = document.createElement("div");
    videoCard.classList.add("video-card");
    videoCard.innerHTML = `
    <iframe width="500" height="294" src="https://www.youtube.com/embed/${key}?theme=dark&color=white&rel=0" frameborder="0" allowfullscreen="1" title="${name}" class="img-cover" loading="lazy"></iframe>
    `;
    movieDetail.querySelector(".slider-inner").appendChild(videoCard);
  }
  pageContent.appendChild(movieDetail);

  // Sekcja radaru ocen społeczności (WF-07) — między szczegółami a propozycjami
  const radarSection = document.createElement('section');
  radarSection.className = 'movie-community';
  pageContent.appendChild(radarSection);
  initMovieRadar(movieId, radarSection);

  loadMovieCommunityRating(movieId).then(data => {
    if (!data) return;
    const metaList = movieDetail.querySelector('.meta-list');
    if (!metaList) return;
    const firstSeparator = metaList.querySelector('.separator');
    const html = buildCommunityBadgeLg(data);
    if (firstSeparator) {
      firstSeparator.insertAdjacentHTML('beforebegin', html + '<div class="separator"></div>');
    } else {
      metaList.insertAdjacentHTML('afterbegin', html);
    }
  });

  initCertBadge(movieDetail);
  addWatchProviders(movieDetail);
  initListButtons(movieId, title, poster_path);
  fetchData(`/api/tmdb/movie/${movieId}/recommendations?page=1`, function (data) {
    addSuggestedMovies(data);
    initReviews(movieId, title);
  });
});

// Tworzy poziomy slider filmów powiązanych tematycznie i gatunkowo z bieżącym filmem
const addSuggestedMovies = function ({ results: movieList }) {
  const movieListElem = document.createElement("section");
  movieListElem.classList.add("movie-list");
  movieListElem.ariaLabel = "Może Ci się również spodobać";
  movieListElem.innerHTML = `
    <div class="title-wrapper">
        <h3 class="title-large">Może Ci się również spodobać</h3>
    </div>
    <div class="slider-list">
        <div class="slider-inner"></div>
    </div>
    `;
  for (const movie of movieList) {
    const movieCard = createMovieCard(movie);
    movieListElem.querySelector(".slider-inner").appendChild(movieCard);
  }
  pageContent.appendChild(movieListElem);
};

// Plakietka klasyfikacji wiekowej z opisem (tooltip na hover/focus + tekst dla czytników ekranu)
function buildCertBadge(info) {
  const text = `${info.description} (klasyfikacja: ${info.countryName}).`;
  return `
    <button type="button" class="meta-item card-badge age-badge" aria-describedby="age-badge-tip">
      ${escapeHtml(info.label)}
      <span class="age-badge-tip" id="age-badge-tip" role="tooltip">${escapeHtml(text)}</span>
    </button>`;
}

// Ekran blokady treści nieodpowiedniej dla wieku widza
function renderAgeBlock(minAge, viewer) {
  document.title = "Treść z ograniczeniem wiekowym - Filmy";
  const legend = AGE_LEVELS.map(l => `<li><strong>${escapeHtml(l.label)}</strong> — ${escapeHtml(l.description)}</li>`).join("");
  const unknownAge = viewer.age === null || viewer.age === undefined;
  const action = !unknownAge ? "" : viewer.loggedIn
    ? '<button type="button" class="btn auth-submit-btn age-block-action" data-age-action="settings">Ustaw datę urodzenia</button>'
    : '<button type="button" class="btn auth-submit-btn age-block-action" data-age-action="login">Zaloguj się</button>';
  pageContent.innerHTML = `
    <section class="age-block" aria-labelledby="age-block-title">
      <div class="age-block-badge" aria-hidden="true">${minAge}+</div>
      <h1 class="heading age-block-title" id="age-block-title">Treść z ograniczeniem wiekowym</h1>
      <p class="age-block-text">${escapeHtml(blockReason(minAge, viewer))}</p>
      ${action}
      <details class="age-block-legend">
        <summary>Co oznaczają kategorie wiekowe?</summary>
        <ul>${legend}</ul>
      </details>
      <a class="justwatch-link" href="/">← Wróć na stronę główną</a>
    </section>`;
  pageContent.querySelector("[data-age-action]")?.addEventListener("click", (e) => {
    const goSettings = e.currentTarget.dataset.ageAction === "settings";
    document.querySelector(".auth-btn")?.click();
    if (goSettings) setTimeout(() => document.querySelector("#auth-edit-btn")?.click(), 0);
  });
  // Po zalogowaniu / zapisaniu daty urodzenia — przeładuj, gdy treść jest już dozwolona
  // albo zmienił się stan logowania (inny komunikat i akcja na ekranie blokady)
  onViewerChange((v) => {
    if (isAllowed(minAge, v.age) || v.loggedIn !== viewer.loggedIn) window.location.reload();
  });
}

// Tooltip klasyfikacji: hover/focus (desktop) + kliknięcie/dotknięcie (mobile — brak hovera).
// Zamykany ponownym kliknięciem, kliknięciem poza plakietką lub klawiszem Escape.
function initCertBadge(root) {
  const badge = root.querySelector('.age-badge');
  if (!badge) return;
  badge.setAttribute('aria-expanded', 'false');
  // --dismissed: tooltip zamknięty ręcznie (Escape / ponowne kliknięcie) pozostaje ukryty
  // mimo hover/focus, dopóki kursor lub fokus nie opuści plakietki
  const setOpen = (open) => {
    const wasOpen = badge.classList.contains('age-badge--open');
    badge.classList.toggle('age-badge--open', open);
    badge.classList.toggle('age-badge--dismissed', !open && (wasOpen || badge.matches(':hover, :focus-visible')));
    badge.setAttribute('aria-expanded', String(open));
  };
  const resetDismissed = () => badge.classList.remove('age-badge--dismissed');
  badge.addEventListener('mouseleave', resetDismissed);
  badge.addEventListener('blur', resetDismissed);
  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!badge.classList.contains('age-badge--open'));
  });
  document.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
}
