'use strict';

// ============================================================================
// ageRatings.js  –  Klasyfikacje wiekowe filmów (czyste funkcje, bez DOM)
//
// Współdzielone przez frontend (opisy, tooltipy, filtr treści) i backend
// (endpoint /api/movies/age-ratings). Kody i znaczenia oparte na oficjalnej
// liście TMDB: GET /certification/movie/list (PL, US, GB, DE, FR).
//
// minAge = minimalny wiek, od którego film jest dozwolony bez opiekuna.
// Kolejność krajów: najpierw Polska (aplikacja jest polskojęzyczna), potem
// najczęściej uzupełniane w TMDB klasyfikacje zagraniczne.
// ============================================================================

export const COUNTRY_PRIORITY = ['PL', 'US', 'GB', 'DE', 'FR'];

export const COUNTRY_NAMES = {
  PL: 'Polska', US: 'USA', GB: 'Wielka Brytania', DE: 'Niemcy', FR: 'Francja',
};

// Wiek dorosłości używany przez filtr (treści 18+ blokowane, gdy wiek nieznany).
export const ADULT_AGE = 18;

export const CERTIFICATIONS = {
  PL: {
    AL:   { minAge: 0,  label: 'b.o.', description: 'Bez ograniczeń wiekowych — odpowiedni dla wszystkich widzów.' },
    7:    { minAge: 7,  label: '7+',   description: 'Dla widzów od 7 lat. Może zawierać sceny niepokojące dla najmłodszych dzieci.' },
    12:   { minAge: 12, label: '12+',  description: 'Dla widzów od 12 lat. Może zawierać przemoc, wulgaryzmy lub treści wymagające dojrzałości.' },
    16:   { minAge: 16, label: '16+',  description: 'Dla widzów od 16 lat. Może zawierać wyraźną przemoc, seks, używki lub mocne słownictwo.' },
    18:   { minAge: 18, label: '18+',  description: 'Wyłącznie dla dorosłych (od 18 lat). Treści drastyczne lub o charakterze erotycznym.' },
  },
  US: {
    G:       { minAge: 0,  label: 'G',     description: 'G (USA) — dla wszystkich widzów; brak treści budzących zastrzeżenia rodziców.' },
    PG:      { minAge: 0,  label: 'PG',    description: 'PG (USA) — zalecany nadzór rodzicielski; część scen może nie być odpowiednia dla dzieci poniżej 10 lat.' },
    'PG-13': { minAge: 13, label: 'PG-13', description: 'PG-13 (USA) — od 13 lat; może zawierać przemoc, krótką nagość lub mocniejszy język.' },
    R:       { minAge: 17, label: 'R',     description: 'R (USA) — poniżej 17 lat tylko z rodzicem lub opiekunem; treści dla dorosłych.' },
    'NC-17': { minAge: 18, label: 'NC-17', description: 'NC-17 (USA) — wyłącznie dla dorosłych; drastyczna przemoc lub treści o wyraźnie seksualnym charakterze.' },
  },
  GB: {
    U:     { minAge: 0,  label: 'U',   description: 'U (Wielka Brytania) — dla wszystkich widzów.' },
    PG:    { minAge: 0,  label: 'PG',  description: 'PG (Wielka Brytania) — dla wszystkich, ale niektóre sceny mogą nie być odpowiednie dla małych dzieci.' },
    '12A': { minAge: 12, label: '12A', description: '12A (Wielka Brytania) — od 12 lat; młodsi wyłącznie pod opieką dorosłego.' },
    12:    { minAge: 12, label: '12',  description: '12 (Wielka Brytania) — od 12 lat.' },
    15:    { minAge: 15, label: '15',  description: '15 (Wielka Brytania) — od 15 lat.' },
    18:    { minAge: 18, label: '18',  description: '18 (Wielka Brytania) — wyłącznie dla dorosłych.' },
    R18:   { minAge: 18, label: 'R18', description: 'R18 (Wielka Brytania) — wyłącznie dla dorosłych, treści erotyczne.' },
  },
  DE: {
    0:  { minAge: 0,  label: 'FSK 0',  description: 'FSK 0 (Niemcy) — bez ograniczeń wiekowych.' },
    6:  { minAge: 6,  label: 'FSK 6',  description: 'FSK 6 (Niemcy) — od 6 lat.' },
    12: { minAge: 12, label: 'FSK 12', description: 'FSK 12 (Niemcy) — od 12 lat (od 6 lat pod opieką rodzica).' },
    16: { minAge: 16, label: 'FSK 16', description: 'FSK 16 (Niemcy) — od 16 lat.' },
    18: { minAge: 18, label: 'FSK 18', description: 'FSK 18 (Niemcy) — wyłącznie dla dorosłych.' },
  },
  FR: {
    TP: { minAge: 0,  label: 'TP',  description: 'TP (Francja) — dla wszystkich widzów.' },
    12: { minAge: 12, label: '-12', description: '-12 (Francja) — od 12 lat.' },
    16: { minAge: 16, label: '-16', description: '-16 (Francja) — od 16 lat.' },
    18: { minAge: 18, label: '-18', description: '-18 (Francja) — wyłącznie dla dorosłych.' },
  },
};

// Opisy pomocnicze progów wieku (legenda / tekst pomocniczy w UI).
export const AGE_LEVELS = [
  { minAge: 0,  label: 'b.o.', description: 'Bez ograniczeń wiekowych.' },
  { minAge: 7,  label: '7+',   description: 'Od 7 lat.' },
  { minAge: 12, label: '12+',  description: 'Od 12 lat.' },
  { minAge: 16, label: '16+',  description: 'Od 16 lat.' },
  { minAge: 18, label: '18+',  description: 'Tylko dla dorosłych.' },
];

// Informacja o klasyfikacji dla kodu w danym kraju (lub null, gdy kod nieznany/pusty).
export function describeCertification(country, code) {
  const c = String(code ?? '').trim();
  if (!c) return null;
  const entry = CERTIFICATIONS[country]?.[c.toUpperCase()] ?? CERTIFICATIONS[country]?.[c];
  if (!entry) return null;
  return { country, code: c, ...entry, countryName: COUNTRY_NAMES[country] || country };
}

// Z odpowiedzi TMDB /movie/{id}/release_dates (lub pola release_dates z append_to_response)
// wybiera najbardziej wiarygodną klasyfikację wg COUNTRY_PRIORITY. Zwraca null, gdy brak.
export function pickCertification(releaseDates) {
  const results = Array.isArray(releaseDates?.results) ? releaseDates.results : [];
  for (const country of COUNTRY_PRIORITY) {
    const entry = results.find((r) => r?.iso_3166_1 === country);
    if (!entry) continue;
    // Preferuj premierę kinową (type 3), potem pozostałe wydania
    const dates = [...(entry.release_dates || [])].sort((a, b) => (a.type === 3 ? -1 : 0) - (b.type === 3 ? -1 : 0));
    for (const d of dates) {
      const info = describeCertification(country, d?.certification);
      if (info) return info;
    }
  }
  return null;
}

// Minimalny wiek dla filmu: z klasyfikacji, a gdy jej brak — z flagi TMDB `adult`.
// null = brak danych (film nieklasyfikowany).
export function minAgeFor({ certification = null, adult = false } = {}) {
  if (adult) return ADULT_AGE;
  return certification ? certification.minAge : null;
}

// Wiek w pełnych latach na dzień `today` z daty w formacie YYYY-MM-DD (lub null).
export function ageFromBirthDate(birthDate, today = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const born = new Date(Date.UTC(y, mo - 1, d));
  if (born.getUTCFullYear() !== y || born.getUTCMonth() !== mo - 1 || born.getUTCDate() !== d) return null;
  let age = today.getFullYear() - y;
  const beforeBirthday = today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 150 ? age : null;
}

// Czy widz o wieku `viewerAge` może zobaczyć treść z progiem `minAge`?
// Bezpieczny domyślny wariant: wiek nieznany (gość / brak daty urodzenia) → blokowane
// wyłącznie treści 18+. Filmy bez klasyfikacji (minAge null) są dozwolone.
export function isAllowed(minAge, viewerAge) {
  if (minAge === null || minAge === undefined) return true;
  if (viewerAge === null || viewerAge === undefined) return minAge < ADULT_AGE;
  return viewerAge >= minAge;
}

// Etykieta progu do plakietki („16+", „18+").
export function ageLabel(minAge) {
  if (minAge === null || minAge === undefined) return '';
  return minAge === 0 ? 'b.o.' : `${minAge}+`;
}
