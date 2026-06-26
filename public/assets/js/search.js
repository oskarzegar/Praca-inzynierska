'use strict';

import { fetchData } from "./api.js";
import { createMovieCard } from "./movie-card.js";
import { supabase } from "./supabase.js";
import { loadCommunityRatings, updateCardsInDOM } from "./communityRatings.js";

export function search() {
  loadCommunityRatings();
  const headerSearchField = document.querySelector("[search-field]");
  const searchBox         = document.querySelector("[search-box]");

  // ─── Przycisk filtrów w nagłówku (otwiera modal z rozwiniętymi filtrami) ──────

  const filterBtn = document.createElement("button");
  filterBtn.className = "filter-open-btn";
  filterBtn.setAttribute("aria-label", "Filtry zaawansowane");
  filterBtn.setAttribute("title", "Filtry zaawansowane");
  filterBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
         xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="4" y1="6"  x2="20" y2="6"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="15" cy="6"  r="2.5" fill="var(--background)" stroke="currentColor" stroke-width="2"/>
      <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="9"  cy="12" r="2.5" fill="var(--background)" stroke="currentColor" stroke-width="2"/>
      <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      <circle cx="14" cy="18" r="2.5" fill="var(--background)" stroke="currentColor" stroke-width="2"/>
    </svg>
  `;
  searchBox.querySelector("[search-wrapper]").appendChild(filterBtn);

  // ─── Modal wyszukiwania ────────────────────────────────────────────────────────

  const searchModal = document.createElement("div");
  searchModal.classList.add("search-modal");
  document.querySelector("main").appendChild(searchModal);

  searchModal.innerHTML = `
    <div class="adv-search-header">
      <div class="adv-search-input-wrapper">
        <img src="./assets/imgs/search.svg" width="20" height="20" alt="" class="adv-search-icon" />
        <input
          type="text"
          id="adv-query-field"
          class="adv-query-field"
          placeholder="Wyszukaj filmy..."
          autocomplete="off"
        />
      </div>
      <button class="adv-filters-toggle" id="adv-filters-toggle"
              aria-label="Pokaż filtry" aria-expanded="false">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
             xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <line x1="4" y1="6"  x2="20" y2="6"  stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="15" cy="6"  r="2.5" fill="currentColor" stroke="currentColor" stroke-width="2"/>
          <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="9"  cy="12" r="2.5" fill="currentColor" stroke="currentColor" stroke-width="2"/>
          <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <circle cx="14" cy="18" r="2.5" fill="currentColor" stroke="currentColor" stroke-width="2"/>
        </svg>
        Filtry
      </button>
      <button class="adv-close-btn" id="adv-close-btn" aria-label="Zamknij wyszukiwanie">
        <img src="./assets/imgs/close.svg" width="20" height="20" alt="Zamknij" />
      </button>
    </div>

    <div class="adv-filters-panel" id="adv-filters-panel" hidden>
      <div class="filter-row">
        <div class="filter-field">
          <label class="filter-label">Rok (od – do)</label>
          <div class="filter-range">
            <input type="number" id="adv-year-from" class="filter-input filter-input-sm" placeholder="np. 2000" min="1888" max="2026" />
            <span class="filter-sep">–</span>
            <input type="number" id="adv-year-to" class="filter-input filter-input-sm" placeholder="2026" min="1888" max="2026" />
          </div>
        </div>

        <div class="filter-field">
          <label class="filter-label">Ocena TMDB (od – do)</label>
          <div class="filter-range">
            <input type="number" id="adv-rating-from" class="filter-input filter-input-sm" placeholder="0" min="0" max="10" step="0.1" />
            <span class="filter-sep">–</span>
            <input type="number" id="adv-rating-to" class="filter-input filter-input-sm" placeholder="10" min="0" max="10" step="0.1" />
          </div>
        </div>

        <div class="filter-field">
          <label class="filter-label">Długość (min. od – do)</label>
          <div class="filter-range">
            <input type="number" id="adv-runtime-from" class="filter-input filter-input-sm" placeholder="60" min="1" max="600" />
            <span class="filter-sep">–</span>
            <input type="number" id="adv-runtime-to" class="filter-input filter-input-sm" placeholder="180" min="1" max="600" />
          </div>
        </div>

        <div class="filter-field">
          <label class="filter-label">Sortowanie</label>
          <select id="adv-sort-by" class="filter-input filter-select">
            <option value="popularity.desc">Popularność ↓</option>
            <option value="popularity.asc">Popularność ↑</option>
            <option value="vote_average.desc">Ocena ↓</option>
            <option value="vote_average.asc">Ocena ↑</option>
            <option value="primary_release_date.desc">Najnowsze</option>
            <option value="primary_release_date.asc">Najstarsze</option>
            <option value="title.asc">Tytuł A–Z</option>
            <option value="title.desc">Tytuł Z–A</option>
          </select>
        </div>
      </div>

      <div class="community-filter">
        <label class="filter-label">Oceny społeczności (minimum, skala 1–5)</label>
        <div class="community-criteria">
          <div class="criterion">
            <span class="criterion-label">Ogólna</span>
            <input type="number" id="adv-community-rating-min" class="filter-input filter-input-sm" placeholder="—" min="1" max="5" step="0.1" />
          </div>
          <div class="criterion">
            <span class="criterion-label">Fabuła</span>
            <input type="number" id="adv-community-plot-min" class="filter-input filter-input-sm" placeholder="—" min="1" max="5" step="0.1" />
          </div>
          <div class="criterion">
            <span class="criterion-label">Aktorstwo</span>
            <input type="number" id="adv-community-acting-min" class="filter-input filter-input-sm" placeholder="—" min="1" max="5" step="0.1" />
          </div>
          <div class="criterion">
            <span class="criterion-label">Muzyka</span>
            <input type="number" id="adv-community-music-min" class="filter-input filter-input-sm" placeholder="—" min="1" max="5" step="0.1" />
          </div>
          <div class="criterion">
            <span class="criterion-label">Efekty</span>
            <input type="number" id="adv-community-effects-min" class="filter-input filter-input-sm" placeholder="—" min="1" max="5" step="0.1" />
          </div>
          <div class="criterion">
            <span class="criterion-label">Sortuj oceny wg</span>
            <select id="adv-community-sort" class="filter-input filter-select filter-input-sm">
              <option value="overall">Ogólnej</option>
              <option value="plot">Fabuły</option>
              <option value="acting">Aktorstwa</option>
              <option value="music">Muzyki</option>
              <option value="effects">Efektów</option>
              <option value="count">Liczby recenzji</option>
            </select>
          </div>
        </div>
        <p class="community-filter-hint">Ustawienie dowolnej oceny przeszukuje bazę recenzji serwisu (filtry TMDB i tytuł są pomijane).</p>
      </div>

      <div class="filter-actions">
        <button id="adv-search-btn" class="btn search-submit-btn">
          <img src="./assets/imgs/search.svg" width="16" height="16" alt="" />
          Szukaj
        </button>
        <button id="adv-reset-btn" class="btn search-reset-btn">Resetuj</button>
      </div>
    </div>

    <div class="adv-popular-section" id="adv-popular-section">
      <p class="adv-section-label">Popularne teraz</p>
      <div class="slider-list adv-popular-slider">
        <div class="slider-inner" id="adv-popular-grid"></div>
      </div>
    </div>

    <div class="adv-results-panel" id="adv-results-panel">
      <p id="adv-results-info" class="results-info"></p>
      <div class="grid-list" id="adv-results-grid"></div>
      <button class="btn load-more" id="adv-load-more" style="display:none">Więcej</button>
    </div>
  `;

  const advQueryField    = searchModal.querySelector("#adv-query-field");
  const resultsGrid      = searchModal.querySelector("#adv-results-grid");
  const loadMoreBtn      = searchModal.querySelector("#adv-load-more");
  const resultsInfo      = searchModal.querySelector("#adv-results-info");
  const popularSection   = searchModal.querySelector("#adv-popular-section");
  const resultsPanel     = searchModal.querySelector("#adv-results-panel");
  const popularGrid      = searchModal.querySelector("#adv-popular-grid");
  const filtersPanel     = searchModal.querySelector("#adv-filters-panel");
  const filtersToggleBtn = searchModal.querySelector("#adv-filters-toggle");

  const getVal            = (id) => searchModal.querySelector(`#${id}`).value.trim();
  const hasNumericFilters = () =>
    getVal("adv-year-from") || getVal("adv-year-to") ||
    getVal("adv-rating-from") || getVal("adv-rating-to") ||
    getVal("adv-runtime-from") || getVal("adv-runtime-to");

  // Filtr ocen społeczności (WF-09): aktywny, gdy ustawiono dowolne minimum
  const hasCommunityFilters = () =>
    getVal("adv-community-rating-min") || getVal("adv-community-plot-min") ||
    getVal("adv-community-acting-min")  || getVal("adv-community-music-min") ||
    getVal("adv-community-effects-min");
  const num = (v) => (v ? Number(v) : 0);
  const COMMUNITY_PAGE_SIZE = 20;
  let communityCache = [];

  // ── Pokaż / ukryj panel filtrów ─────────────────────────────────────────────

  function showFilters() {
    filtersPanel.hidden = false;
    filtersToggleBtn.classList.add("active");
    filtersToggleBtn.setAttribute("aria-expanded", "true");
  }

  function hideFilters() {
    filtersPanel.hidden = true;
    filtersToggleBtn.classList.remove("active");
    filtersToggleBtn.setAttribute("aria-expanded", "false");
  }

  filtersToggleBtn.addEventListener("click", () => {
    filtersPanel.hidden ? showFilters() : hideFilters();
  });

  // ── Compact / expanded ──────────────────────────────────────────────────────

  function showCompact() {
    popularSection.hidden = false;
    resultsPanel.hidden   = true;
    searchModal.classList.remove("search-modal--expanded");
  }

  function showExpanded() {
    popularSection.hidden = true;
    resultsPanel.hidden   = false;
    searchModal.classList.add("search-modal--expanded");
  }

  showCompact();

  // ── Popularne (z cache) ─────────────────────────────────────────────────────

  let popularLoaded = false;

  function loadPopular() {
    if (popularLoaded) return;
    fetchData(
      `/api/tmdb/movie/popular?language=pl&page=1`,
      function ({ results }) {
        popularLoaded = true;
        for (const movie of results) {
          if (!movie.release_date || !movie.title || !movie.poster_path || !movie.vote_average) continue;
          popularGrid.appendChild(createMovieCard(movie));
        }
      }
    );
  }

  // ── Otwieranie / zamykanie modalu ───────────────────────────────────────────

  const openModal = (withFilters = false) => {
    searchModal.classList.add("active");
    searchModal.style.visibility = "visible";
    if (withFilters) showFilters();
    advQueryField.focus();
    searchBox.style.display = "none";
    loadPopular();
  };

  const closeModal = () => {
    searchModal.classList.remove("active");
    searchModal.style.visibility = "";
    searchBox.classList.remove("active");
    searchBox.style.display = "";
    headerSearchField.value = "";
  };

  // Pisanie w nagłówkowym polu otwiera modal i przenosi zapytanie
  headerSearchField.addEventListener("input", function () {
    const q = this.value.trim();
    if (!q) return;
    openModal();
    advQueryField.value = q;
    scheduleSearch();
  });

  // Przycisk filtrów w nagłówku otwiera modal z rozwiniętym panelem filtrów
  filterBtn.addEventListener("click", () => openModal(true));

  // Lupa w nagłówku otwiera JEDEN zaawansowany system wyszukiwania z wszystkimi filtrami
  for (const lupa of document.querySelectorAll(".header .search-btn[menu-close]")) {
    lupa.addEventListener("click", () => openModal(true));
  }

  searchModal.querySelector("#adv-close-btn").addEventListener("click", closeModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && searchModal.classList.contains("active")) closeModal();
  });

  // ── Logika wyszukiwania ────────────────────────────────────────────────────

  let searchTimeout;
  const scheduleSearch = () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      if (advQueryField.value.trim() || hasNumericFilters()) {
        currentPage = 1;
        doSearch(1, false);
      } else {
        showCompact();
      }
    }, 380);
  };

  advQueryField.addEventListener("input", scheduleSearch);

  let currentPage = 1;
  let totalPages  = 0;
  let currentMode = null;

  function buildDiscoverUrl(page = 1) {
    const sortBy = getVal("adv-sort-by") || "popularity.desc";
    let url = `/api/tmdb/discover/movie?language=pl&page=${page}&sort_by=${sortBy}&vote_count.gte=10`;
    const yf = getVal("adv-year-from"), yt = getVal("adv-year-to");
    const rf = getVal("adv-rating-from"), rt = getVal("adv-rating-to");
    const nf = getVal("adv-runtime-from"), nt = getVal("adv-runtime-to");
    if (yf) url += `&primary_release_date.gte=${yf}-01-01`;
    if (yt) url += `&primary_release_date.lte=${yt}-12-31`;
    if (rf) url += `&vote_average.gte=${rf}`;
    if (rt) url += `&vote_average.lte=${rt}`;
    if (nf) url += `&with_runtime.gte=${nf}`;
    if (nt) url += `&with_runtime.lte=${nt}`;
    return url;
  }

  function buildSearchUrl(query, page = 1) {
    return `/api/tmdb/search/movie?language=pl&query=${encodeURIComponent(query)}&page=${page}`;
  }

  function safeMovies(list) {
    return list.filter((m) => m.release_date && m.title && m.poster_path && m.vote_average > 0);
  }

  function applyClientFilters(list) {
    const yf = getVal("adv-year-from"),   yt = getVal("adv-year-to");
    const rf = getVal("adv-rating-from"), rt = getVal("adv-rating-to");
    return list.filter(m => {
      const year   = m.release_date ? +m.release_date.slice(0, 4) : null;
      const rating = m.vote_average ?? null;
      if (yf && (year   === null || year   < +yf)) return false;
      if (yt && (year   === null || year   > +yt)) return false;
      if (rf && (rating === null || rating < +rf)) return false;
      if (rt && (rating === null || rating > +rt)) return false;
      return true;
    });
  }

  async function applyRuntimeFilter(movies) {
    const rf = getVal("adv-runtime-from"), rt = getVal("adv-runtime-to");
    const detailed = await Promise.all(
      movies.map(async m => {
        try {
          const res = await fetch(`/api/tmdb/movie/${m.id}?language=pl`);
          if (!res.ok) return null;
          const d = await res.json();
          return { ...m, runtime: d.runtime || 0 };
        } catch { return null; }
      })
    );
    return detailed.filter(m => {
      if (!m) return false;
      if (!m.runtime && (rf || rt)) return false;
      if (rf && m.runtime < +rf) return false;
      if (rt && m.runtime > +rt) return false;
      return true;
    });
  }

  function sortClientSide(list) {
    const s = getVal("adv-sort-by") || "popularity.desc";
    return [...list].sort((a, b) => {
      switch (s) {
        case "popularity.asc":            return (a.popularity   || 0) - (b.popularity   || 0);
        case "vote_average.desc":         return (b.vote_average || 0) - (a.vote_average || 0);
        case "vote_average.asc":          return (a.vote_average || 0) - (b.vote_average || 0);
        case "primary_release_date.desc": return (b.release_date || "").localeCompare(a.release_date || "");
        case "primary_release_date.asc":  return (a.release_date || "").localeCompare(b.release_date || "");
        case "title.asc":                 return (a.title        || "").localeCompare(b.title        || "");
        case "title.desc":                return (b.title        || "").localeCompare(a.title        || "");
        default:                          return (b.popularity   || 0) - (a.popularity   || 0);
      }
    });
  }

  function renderMovies(movieList, append = false) {
    if (!append) resultsGrid.innerHTML = "";
    const movies = safeMovies(movieList);
    if (!append && movies.length === 0) {
      resultsGrid.innerHTML = '<p class="no-results">Brak wyników. Spróbuj innych filtrów.</p>';
      return;
    }
    for (const movie of movies) resultsGrid.appendChild(createMovieCard(movie));
    updateCardsInDOM();
  }

  // Wielokryterialny filtr ocen społeczności (WF-09) — RPC movies_by_community_rating_multi
  async function doCommunitySearch(page = 1, append = false) {
    if (!append || communityCache.length === 0) {
      const { data, error } = await supabase.rpc("movies_by_community_rating_multi", {
        min_overall: num(getVal("adv-community-rating-min")),
        min_plot:    num(getVal("adv-community-plot-min")),
        min_acting:  num(getVal("adv-community-acting-min")),
        min_music:   num(getVal("adv-community-music-min")),
        min_effects: num(getVal("adv-community-effects-min")),
        sort_by:     getVal("adv-community-sort") || "overall",
      });
      if (error || !data || data.length === 0) {
        resultsGrid.innerHTML = '<p class="no-results">Brak filmów spełniających kryteria ocen społeczności.</p>';
        loadMoreBtn.style.display = "none";
        return;
      }
      communityCache = data;
      totalPages = Math.ceil(data.length / COMMUNITY_PAGE_SIZE);
      resultsInfo.textContent = `Znaleziono ${data.length} ${data.length === 1 ? "film" : "filmów"} wg ocen społeczności.`;
    }

    const startIdx  = (page - 1) * COMMUNITY_PAGE_SIZE;
    const pageItems = communityCache.slice(startIdx, startIdx + COMMUNITY_PAGE_SIZE);
    if (!append) resultsGrid.innerHTML = "";

    // Dane filmów (plakat, tytuł) dociągamy z TMDB po ID z bazy ocen
    const results = await Promise.all(
      pageItems.map(async (item) => {
        try {
          const res = await fetch(`/api/tmdb/movie/${item.movie_id}?language=pl`);
          const d   = await res.json();
          return d.title ? d : null;
        } catch { return null; }
      })
    );
    for (const movie of results.filter(Boolean)) {
      if (!movie.release_date) continue;
      resultsGrid.appendChild(createMovieCard(movie));
    }
    updateCardsInDOM();
    loadMoreBtn.style.display = page < totalPages ? "block" : "none";
  }

  function doSearch(page = 1, append = false) {
    const query          = advQueryField.value.trim();
    const numericFilters = hasNumericFilters();
    showExpanded();
    if (!append) {
      currentPage = 1;
      resultsGrid.innerHTML = '<p class="results-loading">Ładowanie...</p>';
      loadMoreBtn.style.display = "none";
      resultsInfo.textContent = "";
      advQueryField.focus();
    }
    if (hasCommunityFilters()) {
      currentMode = "community";
      if (!append) communityCache = [];
      doCommunitySearch(page, append);
      return;
    }
    if (numericFilters && !query) {
      currentMode = "discover";
      fetchData(buildDiscoverUrl(page), ({ results, total_pages }) => {
        totalPages = total_pages || 1;
        renderMovies(results, append);
        loadMoreBtn.style.display = currentPage < totalPages ? "block" : "none";
      });
    } else if (query) {
      currentMode = "search";
      fetch(buildSearchUrl(query, page))
        .then(r => r.json())
        .then(async ({ results, total_pages }) => {
          totalPages = total_pages || 1;
          let movies = safeMovies(results);
          if (getVal("adv-runtime-from") || getVal("adv-runtime-to")) movies = await applyRuntimeFilter(movies);
          if (getVal("adv-year-from") || getVal("adv-year-to") || getVal("adv-rating-from") || getVal("adv-rating-to")) movies = applyClientFilters(movies);
          renderMovies(sortClientSide(movies), append);
          loadMoreBtn.style.display = currentPage < totalPages ? "block" : "none";
        });
    }
  }

  searchModal.querySelector("#adv-search-btn").addEventListener("click", () => {
    currentPage = 1;
    doSearch(1, false);
  });

  searchModal.querySelector("#adv-reset-btn").addEventListener("click", () => {
    searchModal.querySelectorAll(".filter-input").forEach((el) => {
      el.value = el.tagName === "SELECT" ? "popularity.desc" : "";
    });
    searchModal.querySelector("#adv-community-sort").value = "overall";
    advQueryField.value = "";
    headerSearchField.value = "";
    communityCache = [];
    resultsGrid.innerHTML = "";
    loadMoreBtn.style.display = "none";
    resultsInfo.textContent = "";
    showCompact();
  });

  searchModal.querySelectorAll(".filter-input, #adv-query-field").forEach((el) => {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { currentPage = 1; doSearch(1, false); }
    });
  });

  searchModal.querySelector("#adv-sort-by").addEventListener("change", () => {
    if (advQueryField.value.trim() || hasNumericFilters()) {
      currentPage = 1;
      doSearch(1, false);
    }
  });

  searchModal.querySelector("#adv-community-sort").addEventListener("change", () => {
    if (hasCommunityFilters()) { currentPage = 1; doSearch(1, false); }
  });

  loadMoreBtn.addEventListener("click", function () {
    if (currentPage >= totalPages) { this.style.display = "none"; return; }
    currentPage++;
    this.classList.add("loading");
    const query = advQueryField.value.trim();
    if (currentMode === "community") {
      doCommunitySearch(currentPage, true).then(() => this.classList.remove("loading"));
      return;
    }
    if (currentMode === "search") {
      fetch(buildSearchUrl(query, currentPage))
        .then(r => r.json())
        .then(async ({ results, total_pages }) => {
          this.classList.remove("loading");
          totalPages = total_pages || totalPages;
          let movies = safeMovies(results);
          if (getVal("adv-runtime-from") || getVal("adv-runtime-to")) movies = await applyRuntimeFilter(movies);
          if (getVal("adv-year-from") || getVal("adv-year-to") || getVal("adv-rating-from") || getVal("adv-rating-to")) movies = applyClientFilters(movies);
          renderMovies(sortClientSide(movies), true);
          this.style.display = currentPage < totalPages ? "block" : "none";
        });
    } else {
      fetchData(buildDiscoverUrl(currentPage), ({ results, total_pages }) => {
        this.classList.remove("loading");
        totalPages = total_pages || totalPages;
        renderMovies(results, true);
        this.style.display = currentPage < totalPages ? "block" : "none";
      });
    }
  });
}
