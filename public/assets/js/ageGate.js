'use strict';

// ============================================================================
// ageGate.js  –  Filtr treści wg wieku zalogowanego użytkownika
//
// • Wiek widza: data urodzenia z profilu (RPC get_my_birth_date — kolumna nie jest
//   publicznie czytelna). Gość lub brak daty → wiek nieznany.
// • Bezpieczny domyślny wariant (ageRatings.isAllowed): wiek nieznany → blokowane
//   tylko treści 18+; filmy bez klasyfikacji są dozwolone (chyba że TMDB `adult`).
// • Karty filmów (.movie-card[data-movie-id]) są obserwowane globalnie — klasyfikacje
//   pobierane paczkami z /api/movies/age-ratings, a niedozwolone karty blokowane.
// To filtr wygody/ochrony rodzicielskiej po stronie klienta (dane TMDB są publiczne);
// filmy „adult" dodatkowo odfiltrowuje serwer (include_adult=false w proxy TMDB).
// ============================================================================

import { supabase } from './supabase.js';
import { isAllowed, ageFromBirthDate, ageLabel, ADULT_AGE } from './ageRatings.js';

// ── Wiek widza ──────────────────────────────────────────────────────────────

let viewerPromise = null;

async function loadViewer() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { loggedIn: false, birthDate: null, age: null };
  const { data, error } = await supabase.rpc('get_my_birth_date');
  // Brak funkcji (migracja 80 nieuruchomiona) lub błąd → wiek nieznany (bezpieczny domyślny)
  const birthDate = !error && typeof data === 'string' ? data : null;
  return { loggedIn: true, birthDate, age: ageFromBirthDate(birthDate) };
}

// { loggedIn, birthDate, age } — wynik buforowany do zmiany stanu logowania/daty.
export function getViewer() {
  if (!viewerPromise) viewerPromise = loadViewer().catch(() => ({ loggedIn: false, birthDate: null, age: null }));
  return viewerPromise;
}

const listeners = new Set();
export function onViewerChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

// Wywoływane po zapisaniu daty urodzenia lub zmianie sesji — przelicza blokady.
export function refreshViewer() {
  viewerPromise = null;
  getViewer().then((v) => {
    for (const cb of listeners) { try { cb(v); } catch { /* ignoruj */ } }
    reapplyAll();
  });
}

// WAŻNE: bez await metod auth wewnątrz callbacku (blokada auth w supabase-js) — odraczamy.
supabase.auth.onAuthStateChange((event) => {
  if (event === 'TOKEN_REFRESHED') return;
  setTimeout(refreshViewer, 0);
});

// Tekst wyjaśniający blokadę dla danego widza.
export function blockReason(minAge, viewer) {
  if (viewer?.age === null || viewer?.age === undefined) {
    return viewer?.loggedIn
      ? `Treść ${ageLabel(minAge)}. Podaj datę urodzenia w ustawieniach konta, aby ją odblokować.`
      : `Treść ${ageLabel(minAge)}. Zaloguj się i podaj datę urodzenia, aby ją zobaczyć.`;
  }
  return `Treść ${ageLabel(minAge)} — niedostępna dla Twojego wieku.`;
}

export { isAllowed, ADULT_AGE };

// ── Klasyfikacje wiekowe (paczki do API) ─────────────────────────────────────

const ratingCache = new Map();   // id → { minAge, label, ... }  (tylko udane sprawdzenia)
const pending     = new Map();   // id → Promise
const BATCH_MAX   = 50;

async function fetchBatch(ids) {
  try {
    const res = await fetch(`/api/movies/age-ratings?ids=${ids.join(',')}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { ratings } = await res.json();
    // null od serwera = błąd sprawdzenia (nie „brak klasyfikacji") — nie zapisujemy,
    // żeby kolejne skanowanie ponowiło próbę zamiast trwale przepuszczać kartę.
    for (const id of ids) if (ratings?.[id]) ratingCache.set(id, ratings[id]);
  } catch (err) {
    console.warn('ageGate: nie udało się pobrać klasyfikacji wiekowych:', err.message);
  }
}

// Zwraca Map(id → rating|null) dla podanych ID; brakujące pobiera paczkami.
export async function getRatings(ids) {
  const unique  = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const missing = unique.filter((id) => !ratingCache.has(id) && !pending.has(id));
  for (let i = 0; i < missing.length; i += BATCH_MAX) {
    const chunk = missing.slice(i, i + BATCH_MAX);
    const p = fetchBatch(chunk).finally(() => chunk.forEach((id) => pending.delete(id)));
    chunk.forEach((id) => pending.set(id, p));
  }
  await Promise.all(unique.map((id) => pending.get(id)).filter(Boolean));
  return new Map(unique.map((id) => [id, ratingCache.get(id) ?? null]));
}

// Minimalny wiek filmu z klasyfikacji lub flagi adult (null = brak danych).
export function movieMinAge(rating, adult = false) {
  if (adult) return ADULT_AGE;
  return rating?.minAge ?? null;
}

// Filtruje listę filmów TMDB (np. slajdy banera) do dozwolonych dla bieżącego widza.
export async function filterAllowedMovies(movies) {
  const list = Array.isArray(movies) ? movies : [];
  const [viewer, ratings] = await Promise.all([getViewer(), getRatings(list.map((m) => m.id))]);
  return list.filter((m) => isAllowed(movieMinAge(ratings.get(m.id), m.adult), viewer.age));
}

// ── Blokowanie kart filmów w DOM ─────────────────────────────────────────────

// Karty filmów (listy, wyszukiwarka) oraz pozycje list na profilach użytkowników
const CARD_SELECTOR = '.movie-card[data-movie-id], .profile-movie-item[data-movie-id]';

function applyToCard(card, viewer) {
  const id      = Number(card.dataset.movieId);
  const adult   = card.dataset.adult === 'true';
  const minAge  = movieMinAge(ratingCache.get(id), adult);
  const blocked = !isAllowed(minAge, viewer.age);

  card.classList.toggle('movie-card--restricted', blocked);
  let badge = card.querySelector('.age-lock');
  if (blocked) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'age-lock';
      (card.querySelector('.card-banner') || card).appendChild(badge);
    }
    badge.textContent = ageLabel(minAge);
    badge.title = blockReason(minAge, viewer);
    card.setAttribute('aria-label', `${card.querySelector('.title, p')?.textContent || 'Film'} — ${blockReason(minAge, viewer)}`);
  } else {
    badge?.remove();
    card.removeAttribute('aria-label');
  }
}

async function processCards(cards) {
  if (!cards.length) return;
  const viewer = await getViewer();
  // Karty adult blokujemy od razu (bez czekania na sieć)
  for (const c of cards) if (c.dataset.adult === 'true') applyToCard(c, viewer);
  await getRatings(cards.map((c) => c.dataset.movieId));
  for (const c of cards) if (c.isConnected) applyToCard(c, viewer);

  // Karty, których klasyfikacji nie udało się sprawdzić — JEDNA ponowna próba po chwili
  // (flaga na karcie zapobiega pętli ponowień, gdy TMDB jest dłużej niedostępne)
  const unresolved = cards.filter((c) =>
    c.isConnected && !c.dataset.ageRetried && !ratingCache.has(Number(c.dataset.movieId)));
  if (unresolved.length) {
    unresolved.forEach((c) => { c.dataset.ageRetried = '1'; });
    setTimeout(() => processCards(unresolved.filter((c) => c.isConnected)), 5000);
  }
}

function reapplyAll() {
  processCards([...document.querySelectorAll(CARD_SELECTOR)]);
}

// Zbiera nowo dodane karty i przetwarza je w jednej paczce (debounce).
let queued = new Set();
let timer  = null;
function enqueue(card) {
  queued.add(card);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const cards = [...queued];
    queued = new Set();
    processCards(cards);
  }, 60);
}

function scan(node) {
  if (!(node instanceof Element)) return;
  if (node.matches(CARD_SELECTOR)) enqueue(node);
  for (const c of node.querySelectorAll(CARD_SELECTOR)) enqueue(c);
}

// Kliknięcie zablokowanej karty: zamiast przejścia — komunikat (strona szczegółów
// i tak blokuje treść, ale tu oszczędzamy przeładowania).
document.addEventListener('click', async (e) => {
  const card = e.target.closest?.('.movie-card--restricted[data-movie-id]');
  if (!card) return;
  e.preventDefault();
  const viewer = await getViewer();
  const minAge = movieMinAge(ratingCache.get(Number(card.dataset.movieId)), card.dataset.adult === 'true');
  showToast(blockReason(minAge, viewer));
}, true);

let toastEl = null;
let toastTimer = null;
function showToast(text) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'age-toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = text;
  toastEl.classList.add('age-toast--visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('age-toast--visible'), 3500);
}

let started = false;
export function initAgeGate() {
  if (started) return;
  started = true;
  new MutationObserver((mutations) => {
    for (const m of mutations) for (const n of m.addedNodes) scan(n);
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
}
