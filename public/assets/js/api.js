'use strict';

// Bazowy URL do pobierania obrazków z TMDB
const imgBaseURL = `https://image.tmdb.org/t/p/`;

// Pobiera dane z podanego URL, parsuje JSON i przekazuje wynik do funkcji callback.
// Opcjonalny argument args jest przekazywany jako drugi parametr do callback.
// Sprawdza response.ok i przechwytuje błędy sieci — bez tego padnięcie żądania
// cicho psuło stronę (nierozwiązana obietnica).
const fetchData = function (url, callback, args) {
  fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status} dla ${url}`);
      return response.json();
    })
    .then((data) => callback(data, args))
    .catch((err) => console.error('fetchData:', err.message));
};

// Zamienia tytuł na slug URL: "Avengers: Endgame" → "avengers-endgame"
// ł/Ł nie rozkłada się przez NFD więc mapujemy je ręcznie przed normalizacją
function slugify(text) {
  return text.toString()
    .replace(/[łŁ]/g, c => c === 'ł' ? 'l' : 'L')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Buduje URL strony szczegółów w stylu Filmweb: /film/avengers-endgame-2019-299534
// releaseDate jest opcjonalny — gdy niedostępny, rok jest pomijany
function movieUrl(id, title, releaseDate) {
  const year = releaseDate ? releaseDate.split('-')[0] : null;
  const slug = year ? `${slugify(title)}-${year}-${id}` : `${slugify(title)}-${id}`;
  return `/film/${slug}`;
}

export { imgBaseURL, fetchData, movieUrl, slugify };
