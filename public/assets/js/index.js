'use strict';

import { sidebar } from "./sidebar.js";
import { imgBaseURL, fetchData, movieUrl } from "./api.js";
import { createMovieCard } from "./movie-card.js";
import { search } from "./search.js";
import { supabase } from "./supabase.js";
import { loadCommunityRatings } from "./communityRatings.js";
search();
loadCommunityRatings();
const pageContent = document.querySelector("[page-content]");

sidebar();

// Sekcje wyświetlane na stronie głównej — każda to poziomy slider z filmami pobieranymi z osobnego endpointu
const homePageSections = [
  {
    title: "Nadchodzące filmy",
    path: "/movie/upcoming",
  },
  {
    title: "Najpopularniejsze w tym tygodniu",
    path: "/trending/movie/week",
  },
  {
    title: "Najwyżej oceniane",
    path: "/movie/top_rated",
  },
];

// Słownik ID→nazwa z metodą asString — zamienia tablicę ID gatunków na czytelny ciąg, np. "Akcja, Dramat"
const genreList = {
  asString(genreIdList) {
    let newGenreList = [];
    for (const genreId of genreIdList) {
      this[genreId] && newGenreList.push(this[genreId]);
    }
    return newGenreList.join(", ");
  },
};

// Placeholder rekomendacji tworzony przez heroBanner; null dopóki banner nie zostanie wyrenderowany
let recSection = null;

async function loadRecommendations(session) {
  if (!recSection) return;
  if (!session) {
    recSection.style.display = 'none';
    recSection.innerHTML = '';
    return;
  }
  try {
    const resp = await fetch(`/api/recommendations`, {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    if (!resp.ok) return;
    const { results } = await resp.json();
    if (!results || results.length === 0) { recSection.style.display = 'none'; return; }
    recSection.innerHTML = `
      <div class="title-wrapper">
        <h3 class="title-large">Polecane dla ciebie</h3>
      </div>
      <div class="slider-list"><div class="slider-inner"></div></div>`;
    for (const movie of results) {
      recSection.querySelector('.slider-inner').appendChild(createMovieCard(movie));
    }
    recSection.style.display = '';
  } catch {}
}

// Reaguje na logowanie/wylogowanie bez przeładowania strony
supabase.auth.onAuthStateChange((_event, session) => loadRecommendations(session));

// Najpierw pobiera gatunki (wypełnia genreList), dopiero potem pobiera popularne filmy do banera
// Kolejność jest konieczna — heroBanner używa genreList.asString do wypisania gatunków na slajdzie
fetchData(`/api/tmdb/genre/movie/list?language=pl`, function ({ genres }) {
  for (const { id, name } of genres) {
    genreList[id] = name;
  }
  fetchData(`/api/tmdb/movie/popular?language=pl`, heroBanner);
});

const heroBanner = function ({ results: movieList }) {
  const banner = document.createElement("section");
  banner.classList.add("banner");
  banner.ariaLabel = "Popular Movies";

  banner.innerHTML = ` <div class="banner-slider"></div>
    <div class="slider-control">
      <div class="control-inner"></div>
    </div>
    <div class="banner-progress">
      <div class="banner-progress-bar"></div>
    </div>`;

  let controlIndex = 0;
  for (const [index, movie] of movieList.entries()) {
    const { backdrop_path, title, release_date, genre_ids, overview, poster_path, vote_average, id } = movie;
    const sliderItem = document.createElement("div");
    sliderItem.classList.add("slider-item");
    sliderItem.setAttribute("slider-item", "");
    // Pierwszy slajd ładowany eagerly, pozostałe lazy — skraca czas do pierwszego malowania strony
    sliderItem.innerHTML = ` <img src="${imgBaseURL}w1280${backdrop_path}" alt="${title}" class="img-cover" loading=${index === 0 ? "eager" : "lazy"} />
      <div class="banner-content">
        <h2 class="heading">${title}</h2>
        <div class="meta-list">
          <div class="meta-item">${release_date.split("-")[0]}</div>
          <div class="meta-item card-badge">${vote_average.toFixed(1)}</div>
        </div>
        <p class="genre">${genreList.asString(genre_ids)}</p>
        <p class="banner-text">${overview}</p>
        <a href="${movieUrl(id, title, release_date)}" class="btn">
          <img src="./assets/imgs/play_circle.svg" width="24" height="24" aria-hidden="true" alt="play" />
          <span class="span">Oglądnij teraz</span>
        </a>
      </div>`;
    banner.querySelector(".banner-slider").appendChild(sliderItem);
    // Miniaturka plakatu w panelu kontrolnym — kliknięcie przełącza na odpowiadający slajd
    const controlItem = document.createElement("button");
    controlItem.classList.add("poster-box", "slider-item");
    controlItem.setAttribute("slider-control", `${controlIndex}`);
    controlIndex++;

    controlItem.innerHTML = ` <img src="${imgBaseURL}w154${poster_path}" alt="Przesuń ${title}" loading="lazy" draggable="false" class="img-cover" />`;
    banner.querySelector(".control-inner").appendChild(controlItem);
  }
  pageContent.appendChild(banner);
  // Inicjalizuje obsługę kliknięć w miniaturki dopiero po dodaniu całego banera do DOM
  addHeroSlide();

  // Placeholder rekomendacji tuż po hero — wypełniany przez loadRecommendations
  recSection = document.createElement('section');
  recSection.classList.add('movie-list');
  recSection.style.display = 'none';
  pageContent.appendChild(recSection);

  // Pobiera filmy dla każdej sekcji; wywołania są niezależne, więc trafiają do sieci równolegle
  for (const { title, path } of homePageSections) {
    fetchData(`/api/tmdb${path}?language=pl&page=1`, createMovieList, title);
  }

  // Pierwsze załadowanie rekomendacji (onAuthStateChange mógł odpalić zanim banner był gotowy)
  supabase.auth.getSession().then(({ data: { session } }) => loadRecommendations(session));
};

const addHeroSlide = function () {
  const sliderItems = document.querySelectorAll("[slider-item]");
  const sliderControls = document.querySelectorAll("[slider-control]");
  const progressBar = document.querySelector(".banner-progress-bar");
  const INTERVAL_MS = 10000;

  let currentIndex = 0;

  // Wymusza restart animacji CSS — bez reflow przeglądarka ignoruje ponowne dodanie tej samej klasy
  const restartProgress = () => {
    progressBar.style.animationName = "none";
    void progressBar.offsetWidth;
    progressBar.style.animationName = "";
  };

  const goToSlide = (index) => {
    sliderItems[currentIndex].classList.remove("active");
    sliderControls[currentIndex].classList.remove("active");
    currentIndex = index;
    sliderItems[currentIndex].classList.add("active");
    sliderControls[currentIndex].classList.add("active");
    restartProgress();
  };

  sliderItems[0].classList.add("active");
  sliderControls[0].classList.add("active");

  // Automatyczne przejście co 10 sekund
  let timer = setInterval(() => {
    goToSlide((currentIndex + 1) % sliderItems.length);
  }, INTERVAL_MS);

  // Kliknięcie w miniaturkę: przeskocz do wybranego slajdu i zresetuj timer
  for (const control of sliderControls) {
    control.addEventListener("click", function () {
      const index = Number(this.getAttribute("slider-control"));
      if (index === currentIndex) return;
      clearInterval(timer);
      goToSlide(index);
      timer = setInterval(() => {
        goToSlide((currentIndex + 1) % sliderItems.length);
      }, INTERVAL_MS);
    });
  }
};

// Tworzy sekcję z poziomym sliderem kart filmowych i dołącza ją do strony
const createMovieList = function ({ results: movieList }, title) {
  const movieListElem = document.createElement("section");
  movieListElem.classList.add("movie-list");
  movieListElem.ariaLabel = `${title}`;

  movieListElem.innerHTML = ` <div class="title-wrapper">
      <h3 class="title-large">${title}</h3>
    </div>
    <div class="slider-list">
      <div class="slider-inner"></div>
    </div>`;

  for (const movie of movieList) {
    const movieCard = createMovieCard(movie);
    movieListElem.querySelector(".slider-inner").appendChild(movieCard);
  }
  pageContent.appendChild(movieListElem);
};
