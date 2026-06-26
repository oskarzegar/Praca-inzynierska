'use strict';

import { imgBaseURL, fetchData } from "./api.js";
import { sidebar }               from "./sidebar.js";
import { createMovieCard }       from "./movie-card.js";
import { search }                from "./search.js";
import { initListButtons }       from "./lists.js";
import { initReviews }           from "./reviews.js";
import { initMovieRadar }        from "./movieRadar.js";
import { loadMovieCommunityRating, buildCommunityBadgeLg } from "./communityRatings.js";
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

    const hasAny = (providers.flatrate && providers.flatrate.length > 0) ||
                   (providers.rent && providers.rent.length > 0) ||
                   (providers.buy && providers.buy.length > 0);
    if (!hasAny) return;

    const streamingItem = document.createElement("div");
    streamingItem.classList.add("list-item", "streaming-section");

    // Każde logo linkuje do strony JustWatch z pełną listą opcji dla tego tytułu
    const buildProviderLogos = function (list) {
      return list.map(p => `
        <a href="${providers.link}" target="_blank" rel="noopener noreferrer" class="provider-logo" title="${p.provider_name}">
          <img src="${imgBaseURL}w45${p.logo_path}" alt="${p.provider_name}" loading="lazy" />
        </a>
      `).join('');
    };

    let html = `<p class="list-name">Gdzie obejrzeć</p><div class="streaming-providers">`;

    if (providers.flatrate && providers.flatrate.length > 0) {
      html += `<div class="provider-group">
        <p class="provider-group-label">Subskrypcja</p>
        <div class="providers-list">${buildProviderLogos(providers.flatrate)}</div>
      </div>`;
    }

    if (providers.rent && providers.rent.length > 0) {
      html += `<div class="provider-group">
        <p class="provider-group-label">Wypożyczenie</p>
        <div class="providers-list">${buildProviderLogos(providers.rent)}</div>
      </div>`;
    }

    if (providers.buy && providers.buy.length > 0) {
      html += `<div class="provider-group">
        <p class="provider-group-label">Zakup</p>
        <div class="providers-list">${buildProviderLogos(providers.buy)}</div>
      </div>`;
    }

    html += `</div>`;

    if (providers.link) {
      html += `<a href="${providers.link}" target="_blank" rel="noopener noreferrer" class="justwatch-link">
        Sprawdź wszystkie opcje na JustWatch →
      </a>`;
    }

    streamingItem.innerHTML = html;
    const detailList = movieDetail.querySelector(".detail-list");
    if (detailList) detailList.appendChild(streamingItem);
  });
};

// append_to_response łączy 4 żądania w jedno — oszczędza 3 dodatkowe rundki sieciowe
fetchData(`/api/tmdb/movie/${movieId}?language=pl&append_to_response=credits,videos,images,releases`, function (movie) {
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

  // releases.countries[0].certification = klasyfikacja wiekowa (np. "PG-13"); może być pustym stringiem
  const certification = movie.releases?.countries?.[0]?.certification || '';
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
                <span class="span">${vote_average.toFixed(1)}</span>
              </div>
              <div class="separator"></div>
              <div class="meta-item">${runtime}m</div>
              <div class="separator"></div>
              <div class="meta-item">${release_date ? release_date.split("-")[0] : ''}</div>
              ${certification ? `<div class="meta-item card-badge">${certification}</div>` : ''}
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
