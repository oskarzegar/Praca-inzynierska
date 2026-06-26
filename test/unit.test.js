'use strict';

// Testy jednostkowe czystych funkcji (node:test, bez dodatkowych zależności).
// Uruchomienie: npm test  (node --test)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slugify, movieUrl } from '../public/assets/js/api.js';
import { escapeHtml, escapeAttr } from '../public/assets/js/utils.js';
import { isAllowedTmdbPath } from '../lib/tmdb.js';

// ── slugify ─────────────────────────────────────────────────────────────────
test('slugify: tytuł z dwukropkiem i spacją', () => {
  assert.equal(slugify('Avengers: Endgame'), 'avengers-endgame');
});

test('slugify: polskie ł/Ł (edge case nieobsługiwany przez NFD)', () => {
  assert.equal(slugify('Mały Wielki Człowiek'), 'maly-wielki-czlowiek');
  assert.equal(slugify('ŁÓDŹ'), 'lodz');
});

test('slugify: znaki diakrytyczne i interpunkcja kolapsują do jednego myślnika', () => {
  assert.equal(slugify('Pójdź, kąśliwość'), 'pojdz-kasliwosc');
});

test('slugify: przycina myślniki z brzegów', () => {
  assert.equal(slugify('!!! Cześć !!!'), 'czesc');
});

// ── movieUrl ────────────────────────────────────────────────────────────────
test('movieUrl: z datą premiery zawiera rok', () => {
  assert.equal(movieUrl(299534, 'Avengers: Endgame', '2019-04-24'), '/film/avengers-endgame-2019-299534');
});

test('movieUrl: bez daty pomija rok', () => {
  assert.equal(movieUrl(42, 'Tytuł', null), '/film/tytul-42');
});

// ── escapeHtml / escapeAttr (ochrona przed XSS) ──────────────────────────────
test('escapeHtml: neutralizuje wstrzyknięcie znacznika', () => {
  assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
});

test('escapeHtml: escapuje komplet znaków specjalnych', () => {
  assert.equal(escapeHtml(`"'&<>`), '&quot;&#039;&amp;&lt;&gt;');
});

test('escapeAttr: escapuje cudzysłów (wyłom z atrybutu src/title)', () => {
  assert.equal(escapeAttr('x" onerror="alert(1)'), 'x&quot; onerror=&quot;alert(1)');
});

test('escapeHtml: null/undefined → pusty ciąg', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

// ── isAllowedTmdbPath (whitelist proxy = logika bezpieczeństwa) ───────────────
test('isAllowedTmdbPath: przepuszcza zasoby używane przez aplikację', () => {
  for (const p of [
    '/movie/popular', '/movie/27205', '/movie/27205/recommendations',
    '/movie/27205/watch/providers', '/discover/movie', '/search/movie',
    '/trending/movie/week', '/genre/movie/list',
  ]) {
    assert.equal(isAllowedTmdbPath(p), true, `powinno przejść: ${p}`);
  }
});

test('isAllowedTmdbPath: blokuje resztę TMDB (m.in. auth/konto)', () => {
  for (const p of [
    '/authentication/token/new', '/account', '/configuration',
    '', '/', '/movies', '/moviex', '/genrex',
  ]) {
    assert.equal(isAllowedTmdbPath(p), false, `powinno zostać zablokowane: ${p}`);
  }
});
