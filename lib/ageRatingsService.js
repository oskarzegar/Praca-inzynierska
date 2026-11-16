// ============================================================================
// lib/ageRatingsService.js  –  Klasyfikacje wiekowe wielu filmów naraz
//
// Listy TMDB nie zawierają klasyfikacji wiekowej (tylko flagę `adult`), więc
// frontend pyta o paczkę ID, a serwer pobiera /movie/{id}/release_dates:
//   • osobny cache (24 h, do 5000 wpisów) — klasyfikacje zmieniają się rzadko,
//     a wspólny cache tmdbFetch (500 wpisów) byłby wypłukiwany przez listy,
//   • ograniczona współbieżność — ochrona limitu zapytań TMDB.
// ============================================================================

import { tmdbFetch } from './tmdb.js';
import { createTtlCache } from './ttlCache.js';
import { pickCertification, minAgeFor } from '../public/assets/js/ageRatings.js';

const TTL_MS         = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 60 * 60 * 1000;   // „film nie istnieje" (404) — krócej
const MAX_ENTRIES    = 5000;
const CONCURRENCY    = 6;
export const MAX_IDS = 50;               // = BATCH_MAX po stronie klienta (ageGate.js)

const cache = createTtlCache({ ttlMs: TTL_MS, maxEntries: MAX_ENTRIES });   // id → klasyfikacja

// Parsuje „1,2,3" → unikalne dodatnie liczby całkowite (maks. MAX_IDS). Powtórzony
// parametr (?ids=1&ids=2) to tablica tekstów; inna wartość z parsera qs
// (np. obiekt z ?ids[toString]=1) daje pustą listę zamiast wyjątku.
export function parseIds(raw) {
  const text = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string').join(',') : raw;
  if (typeof text !== 'string') return [];
  const out = [];
  for (const part of text.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0 && n < 1e9 && !out.includes(n)) out.push(n);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

// Klasyfikacja w formacie odpowiedzi API; null → „brak klasyfikacji" (same null-e).
function toRating(certification) {
  return {
    minAge:        minAgeFor({ certification }),
    certification: certification ? certification.code : null,
    country:       certification ? certification.country : null,
    label:         certification ? certification.label : null,
  };
}

// Klasyfikacja jednego filmu albo null = „nie udało się sprawdzić" (timeout, 429, 5xx) —
// taki wynik NIE trafia do cache, więc klient może ponowić próbę.
async function fetchOne(id) {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  try {
    const releaseDates = await tmdbFetch(`/movie/${id}/release_dates`, {}, { cache: false });
    const rating = toRating(pickCertification(releaseDates));
    cache.set(id, rating);
    return rating;
  } catch (err) {
    if (err?.status !== 404) return null;
    const rating = toRating(null);   // film nie istnieje → „brak danych" (krótszy TTL)
    cache.set(id, rating, MISSING_TTL_MS);
    return rating;
  }
}

// Zwraca { [id]: { minAge, certification, country, label } | null }  (null = błąd sprawdzenia).
// Maks. CONCURRENCY równoległych zapytań; każdy „pracownik" bierze kolejne ID z kolejki.
export async function getAgeRatings(ids) {
  const queue   = [...ids];   // kopia: dowolny iterowalny argument, odporna na późniejsze zmiany
  const ratings = {};
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const id = queue[next++];
      ratings[id] = await fetchOne(id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  return ratings;
}
