'use strict';

// ============================================================================
// lib/ageRatingsService.js  –  Klasyfikacje wiekowe wielu filmów naraz
//
// Listy TMDB (popularne, wyszukiwanie, discover) nie zawierają klasyfikacji
// wiekowej — tylko flagę `adult`. Żeby filtr wiekowy działał na kartach filmów,
// frontend pyta o paczkę ID, a serwer pobiera /movie/{id}/release_dates.
//   • osobny cache (24 h, do 5000 wpisów) — klasyfikacje zmieniają się rzadko,
//     a wspólny cache tmdbFetch (500 wpisów) byłby wypłukiwany przez listy,
//   • ograniczona współbieżność — ochrona limitu zapytań TMDB.
// ============================================================================

import { tmdbFetch } from './tmdb.js';
import { pickCertification, minAgeFor } from '../public/assets/js/ageRatings.js';

const TTL_MS        = 24 * 60 * 60 * 1000;
const MISSING_TTL_MS = 60 * 60 * 1000;   // „film nie istnieje" (404) — krócej
const MAX_ENTRIES   = 5000;
const CONCURRENCY   = 6;
export const MAX_IDS = 50;               // = BATCH_MAX po stronie klienta (ageGate.js)

const cache = new Map();   // id → { value, exp }

function cacheGet(id) {
  const hit = cache.get(id);
  if (!hit) return undefined;
  if (hit.exp <= Date.now()) { cache.delete(id); return undefined; }
  return hit.value;
}

function cacheSet(id, value, ttl = TTL_MS) {
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(id, { value, exp: Date.now() + ttl });
}

// Parsuje „1,2,3" → unikalne dodatnie liczby całkowite (maks. MAX_IDS).
export function parseIds(raw) {
  const out = [];
  for (const part of String(raw ?? '').split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0 && n < 1e9 && !out.includes(n)) out.push(n);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

async function fetchOne(id) {
  const cached = cacheGet(id);
  if (cached !== undefined) return cached;
  try {
    const data = await tmdbFetch(`/movie/${id}/release_dates`, {}, { cache: false });
    const certification = pickCertification(data);
    const value = {
      minAge:        minAgeFor({ certification }),
      certification: certification ? certification.code : null,
      country:       certification ? certification.country : null,
      label:         certification ? certification.label : null,
    };
    cacheSet(id, value);
    return value;
  } catch (err) {
    // 404 = film nie istnieje → „brak danych" (krótszy TTL). Inne błędy (timeout, 429, 5xx)
    // zwracają null = „nie udało się sprawdzić" — NIE jest to „brak klasyfikacji";
    // nie trafia do cache i klient ponowi próbę.
    if (err?.status === 404) {
      const value = { minAge: null, certification: null, country: null, label: null };
      cacheSet(id, value, MISSING_TTL_MS);
      return value;
    }
    return null;
  }
}

// Zwraca { [id]: { minAge, certification, country, label } | null }  (null = błąd sprawdzenia).
export async function getAgeRatings(ids) {
  const result = {};
  const queue = [...ids];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const id = queue.shift();
      result[id] = await fetchOne(id);
    }
  });
  await Promise.all(workers);
  return result;
}
