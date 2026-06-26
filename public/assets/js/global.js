'use strict';

// Elementy nagłówka odpowiedzialne za otwieranie/zamykanie pola wyszukiwania
const searchBox = document.querySelector("[search-box]");
const searchTogglers = document.querySelectorAll("[search-toggler]");

// Rejestruje ten sam event listener na wszystkich elementach z podanej listy
const addEventOnElements = function (elements, eventType, callback) {
  for (const elem of elements) elem.addEventListener(eventType, callback);
};

// Każdy przycisk z atrybutem search-toggler przełącza widoczność pola wyszukiwania
addEventOnElements(searchTogglers, "click", function () {
  searchBox.classList.toggle("active");
});
