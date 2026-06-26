'use strict';

import { fetchData } from "./api.js";
import { sidebar } from "./sidebar.js";
import { createMovieCard } from "./movie-card.js";
import { search } from "./search.js";
import { supabase } from "./supabase.js";
import { loadCommunityRatings, updateCardsInDOM } from "./communityRatings.js";
sidebar();
loadCommunityRatings();
const pageContent = document.querySelector("[page-content]");

// ── Ukrywanie obejrzanych (WF-06) ────────────────────────────────────────────
// Zbiór ID filmów z listy `watched` użytkownika; przełącznik chowa je w wynikach.
const watchedSet = new Set();
let hideWatched  = localStorage.getItem("hideWatched") === "1";

// Wczytuje listę obejrzanych zalogowanego użytkownika; zwraca false dla gościa
async function loadWatchedSet() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return false;
  const { data } = await supabase.from("watched").select("movie_id").eq("user_id", session.user.id);
  for (const w of data || []) watchedSet.add(Number(w.movie_id));
  return true;
}

// Pokazuje/ukrywa karty według stanu przełącznika i zawartości listy obejrzanych
function applyHideWatched() {
  for (const card of pageContent.querySelectorAll(".movie-card[data-movie-id]")) {
    const id = Number(card.dataset.movieId);
    card.style.display = hideWatched && watchedSet.has(id) ? "none" : "";
  }
}

// Ekstrahuje ID gatunku z końca URL: /category/thriller-53 → "53"
const slug    = window.location.pathname.split('/').pop();
const genreId = (slug.match(/-(\d+)$/) || [])[1] || null;

let currentPage = 1;
let totalPages  = 0;

// Pobiera listę gatunków by znaleźć polską nazwę dla danego ID
fetchData(`/api/tmdb/genre/movie/list?language=pl`, function ({ genres }) {
  const genre     = genres.find(g => String(g.id) === genreId);
  const genreName = genre ? genre.name : slug.replace(/-\d+$/, '').replace(/-/g, ' ');

  fetchData(`/api/tmdb/discover/movie?sort_by=popularity.desc&language=pl&page=${currentPage}&with_genres=${genreId}`, function ({ results: movieList, total_pages }) {
    totalPages = total_pages || 1;
    document.title = `${genreName} - Filmy`;
    const movieListElem = document.createElement("section");
    movieListElem.classList.add("movie-list", "genre-list");
    movieListElem.ariaLabel = `Film ${genreName}`;

    movieListElem.innerHTML = `
    <div class="title-wrapper genre-header">
        <h1 class="heading">Wszystkie filmy w kategorii: ${genreName}</h1>
        <div class="hide-watched-row" id="hide-watched-row" hidden>
          <label class="hide-watched-label" for="hide-watched-toggle">Ukryj obejrzane</label>
          <label class="privacy-toggle">
            <input type="checkbox" id="hide-watched-toggle" class="privacy-toggle-input" />
            <span class="privacy-toggle-switch"></span>
          </label>
        </div>
    </div>
    <div class="grid-list"></div>
    <button class="btn load-more" load-more>Więcej</button>
  `;
    for (const movie of movieList) {
      const movieCard = createMovieCard(movie);
      movieListElem.querySelector(".grid-list").appendChild(movieCard);
    }
    pageContent.appendChild(movieListElem);

    // Przełącznik widoczny tylko dla zalogowanych (Gość nie ma listy „Obejrzane")
    loadWatchedSet().then((isLoggedIn) => {
      if (!isLoggedIn) return;
      const row    = movieListElem.querySelector("#hide-watched-row");
      const toggle = movieListElem.querySelector("#hide-watched-toggle");
      row.hidden     = false;
      toggle.checked = hideWatched;
      applyHideWatched();
      toggle.addEventListener("change", () => {
        hideWatched = toggle.checked;
        localStorage.setItem("hideWatched", hideWatched ? "1" : "0");
        applyHideWatched();
      });
    });

    document.querySelector("[load-more]").addEventListener("click", function () {
      if (currentPage >= totalPages) {
        this.style.display = "none";
        return;
      }
      currentPage++;
      this.classList.add("loading");
      fetchData(`/api/tmdb/discover/movie?sort_by=popularity.desc&language=pl&page=${currentPage}&with_genres=${genreId}`, ({ results: movieList }) => {
        this.classList.remove("loading");
        for (const movie of movieList) {
          const movieCard = createMovieCard(movie);
          movieListElem.querySelector(".grid-list").appendChild(movieCard);
        }
        updateCardsInDOM();
        applyHideWatched();
      });
    });
  });
});

search();
