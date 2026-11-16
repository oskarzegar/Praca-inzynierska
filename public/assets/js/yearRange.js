'use strict';

// ============================================================================
// yearRange.js  –  Walidacja zakresu lat w wyszukiwarce (czysta funkcja)
//
// TMDB ignoruje filtr dat spoza zakresu, który obsługuje (sprawdzone: rok < 1800
// lub >= ~2100) i wtedy zwraca WSZYSTKIE filmy — np. zakres 1234–1235 dawał ~20 000
// aktualnych tytułów zamiast pustego wyniku. Dlatego walidujemy po stronie klienta:
//   • najstarszy film w TMDB pochodzi z 1874 r. — wcześniejsze lata = pusty wynik,
//   • zakres częściowo wychodzący poza [MIN, MAX] jest przycinany,
//   • od > do lub wartości niebędące rokiem = komunikat i pusty wynik (bez zapytania).
// ============================================================================

export const MIN_YEAR = 1874;

export function maxYear(now = new Date()) {
  return now.getFullYear() + 5;   // zapowiedzi premier
}

function parseYear(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { empty: true };
  if (!/^-?\d+$/.test(v)) return { invalid: true };
  return { value: Number(v) };
}

// Zwraca:
//   { ok: true,  from, to }                 – można szukać (from/to mogą być null),
//   { ok: false, reason, message }          – pokaż pusty stan z komunikatem, nie odpytuj API.
export function validateYearRange(fromRaw, toRaw, { min = MIN_YEAR, max = maxYear() } = {}) {
  const f = parseYear(fromRaw);
  const t = parseYear(toRaw);

  if (f.invalid || t.invalid) {
    return { ok: false, reason: 'invalid', message: 'Rok musi być liczbą całkowitą (np. 1999).' };
  }
  const from = f.empty ? null : f.value;
  const to   = t.empty ? null : t.value;

  if (from !== null && to !== null && from > to) {
    return { ok: false, reason: 'reversed', message: `Rok początkowy (${from}) jest późniejszy niż końcowy (${to}).` };
  }
  if ((to !== null && to < min) || (from !== null && from > max)) {
    const label = from !== null && to !== null ? `${from}–${to}` : String(from ?? to);
    return {
      ok: false,
      reason: 'out_of_range',
      message: `Brak filmów z okresu ${label}. Baza obejmuje lata ${min}–${max}.`,
    };
  }
  return {
    ok:   true,
    from: from === null ? null : Math.max(from, min),
    to:   to   === null ? null : Math.min(to, max),
  };
}
