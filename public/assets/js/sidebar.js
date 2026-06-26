'use strict';

import { fetchData, slugify } from "./api.js";

export function sidebar() {
  // Słownik mapujący ID gatunku na jego nazwę, wypełniany po pobraniu listy gatunków z TMDB
  const genreList = {};

  // Pobiera listę wszystkich gatunków filmowych z TMDB po polsku
  fetchData(`/api/tmdb/genre/movie/list?language=pl`, function ({ genres }) {
    for (const { id, name } of genres) {
      genreList[id] = name;
    }
    // Tworzy linki do gatunków dopiero po załadowaniu słownika
    genreLink();
  });

  const sidebarInner = document.createElement("div");
  sidebarInner.classList.add("sidebar-inner");
  sidebarInner.innerHTML = ` <div class="sidebar-list">
      <p class="title">Gatunek</p>
    </div>
    <div class="sidebar-footer">
      <a href="https://www.themoviedb.org/" target="_blank"><img src="./assets/imgs/tmdb_logo.svg" height="17" width="130" alt="TMDB - movies database" /></a>
    </div>`;

  // Generuje linki do każdego gatunku i wstawia je do sidebar
  const genreLink = function () {
    for (const [genreId, genreName] of Object.entries(genreList)) {
      const link = document.createElement("a");
      link.classList.add("sidebar-link");
      link.setAttribute("href", `/category/${slugify(genreName)}-${genreId}`);
      link.setAttribute("menu-close", "");
      link.textContent = genreName;

      sidebarInner.querySelectorAll(".sidebar-list")[0].appendChild(link);
    }
    const sidebar = document.querySelector("[sidebar]");
    sidebar.appendChild(sidebarInner);
    toggleSidebar(sidebar);
  };

  // Obsługuje otwieranie i zamykanie sidebaru przez przyciski menu
  const toggleSidebar = function (sidebar) {
    const sidebarBtn      = document.querySelector("[menu-btn]");
    const sidebarTogglers = document.querySelectorAll("[menu-toggler]");
    const sidebarClose    = document.querySelectorAll("[menu-close]");
    const overlay         = document.querySelector("[overlay]");

    // Każdy element z menu-toggler przełącza sidebar i overlay (ciemne tło)
    addEventOnElements(sidebarTogglers, "click", function () {
      sidebar.classList.toggle("active");
      sidebarBtn.classList.toggle("active");
      overlay.classList.toggle("active");
    });

    // Elementy z menu-close (np. linki do gatunków) zamykają sidebar po kliknięciu
    addEventOnElements(sidebarClose, "click", function () {
      sidebar.classList.remove("active");
      sidebarBtn.classList.remove("active");
      overlay.classList.remove("active");
    });
  };
}
