'use strict';

// Testy poprawek: walidacja zakresu lat, klasyfikacje wiekowe, konfiguracja env,
// adres strony, weryfikacja tokenu, sweeper kar i autoryzacja crona.
// Uruchomienie: npm test  (node --test)

import { test } from 'node:test';
import assert from 'node:assert/strict';

// Zmienne środowiskowe ustawiane PRZED importem modułów, które czytają je przy starcie
// (celowo „brudne" — tak jak bywają wklejane do panelu Vercel).
process.env.SUPABASE_URL      = '  https://abcdefgh.supabase.co/ \n';
process.env.SUPABASE_ANON_KEY = '"anon-key"';
process.env.CRON_SECRET       = 'top-secret';

const { validateYearRange, MIN_YEAR, maxYear } = await import('../public/assets/js/yearRange.js');
const {
  pickCertification, describeCertification, minAgeFor, ageFromBirthDate, isAllowed, ageLabel,
} = await import('../public/assets/js/ageRatings.js');
const { cleanEnv, cleanUrl, SB_URL, SB_ANON, verifyAuthToken, bearerToken, projectRefFromUrl } =
  await import('../lib/supabaseRest.js');
const { normalizeSiteUrl, resolveSiteUrl } = await import('../lib/siteUrl.js');
const { parseIds } = await import('../lib/ageRatingsService.js');
const { expiredSanctionsPath } = await import('../lib/sanctionSweep.js');
const { isAuthorizedCron } = await import('../routes/cron.js');

// ── Zakres lat (wyszukiwarka) ───────────────────────────────────────────────
test('rok: 1234–1235 → pusty stan bez zapytania (TMDB ignorowałby taki filtr)', () => {
  const r = validateYearRange('1234', '1235');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'out_of_range');
});

test('rok: zakres odwrócony → błąd', () => {
  assert.equal(validateYearRange('2010', '2000').reason, 'reversed');
});

test('rok: wartości niebędące liczbą całkowitą → błąd', () => {
  assert.equal(validateYearRange('20.5', '').reason, 'invalid');
  assert.equal(validateYearRange('abc', '').reason, 'invalid');
});

test('rok: zakres częściowo poza bazą jest przycinany', () => {
  const r = validateYearRange('1700', '1900');
  assert.deepEqual(r, { ok: true, from: MIN_YEAR, to: 1900 });
  const r2 = validateYearRange('2000', '9999');
  assert.deepEqual(r2, { ok: true, from: 2000, to: maxYear() });
});

test('rok: puste pola i poprawny zakres', () => {
  assert.deepEqual(validateYearRange('', ''), { ok: true, from: null, to: null });
  assert.deepEqual(validateYearRange(' 1990 ', '1995'), { ok: true, from: 1990, to: 1995 });
  assert.equal(validateYearRange('99999', '').reason, 'out_of_range');
});

// ── Klasyfikacje wiekowe ────────────────────────────────────────────────────
const releaseDates = (entries) => ({ results: entries });

test('klasyfikacja: priorytet PL przed US', () => {
  const c = pickCertification(releaseDates([
    { iso_3166_1: 'US', release_dates: [{ certification: 'R', type: 3 }] },
    { iso_3166_1: 'PL', release_dates: [{ certification: '18', type: 3 }] },
  ]));
  assert.equal(c.country, 'PL');
  assert.equal(c.minAge, 18);
});

test('klasyfikacja: pusty kod PL → fallback na US, nieznane kody pomijane', () => {
  const c = pickCertification(releaseDates([
    { iso_3166_1: 'PL', release_dates: [{ certification: '', type: 3 }] },
    { iso_3166_1: 'US', release_dates: [{ certification: 'XYZ', type: 1 }, { certification: 'PG-13', type: 3 }] },
  ]));
  assert.equal(c.code, 'PG-13');
  assert.equal(c.minAge, 13);
});

test('klasyfikacja: brak danych → null; adult → 18', () => {
  assert.equal(pickCertification(null), null);
  assert.equal(minAgeFor({ certification: null }), null);
  assert.equal(minAgeFor({ certification: null, adult: true }), 18);
  assert.equal(describeCertification('PL', 'AL').minAge, 0);
});

test('wiek z daty urodzenia (z uwzględnieniem dnia urodzin)', () => {
  const today = new Date(2026, 10, 16);   // 16.11.2026
  assert.equal(ageFromBirthDate('2008-11-16', today), 18);
  assert.equal(ageFromBirthDate('2008-11-17', today), 17);
  assert.equal(ageFromBirthDate('2010-02-30', today), null);
  assert.equal(ageFromBirthDate('', today), null);
});

test('filtr: bezpieczny domyślny wariant przy nieznanym wieku', () => {
  assert.equal(isAllowed(18, null), false);   // gość / brak daty → bez 18+
  assert.equal(isAllowed(17, null), true);
  assert.equal(isAllowed(null, null), true);  // film bez klasyfikacji
  assert.equal(isAllowed(16, 15), false);
  assert.equal(isAllowed(16, 16), true);
  assert.equal(ageLabel(0), 'b.o.');
  assert.equal(ageLabel(16), '16+');
});

test('parseIds: tylko unikalne dodatnie liczby całkowite', () => {
  assert.deepEqual(parseIds('550, abc,550,-1,0,1.5,603'), [550, 603]);
  assert.deepEqual(parseIds(undefined), []);
});

// ── Konfiguracja środowiska ─────────────────────────────────────────────────
test('env: spacje, cudzysłowy i końcowy „/" są usuwane', () => {
  assert.equal(SB_URL, 'https://abcdefgh.supabase.co');
  assert.equal(SB_ANON, 'anon-key');
  assert.equal(cleanEnv('   '), undefined);
  assert.equal(cleanUrl("'https://x.supabase.co///'"), 'https://x.supabase.co');
  assert.equal(projectRefFromUrl(SB_URL), 'abcdefgh');
});

test('site URL: jawna konfiguracja, domena Vercel tylko w produkcji, inaczej null', () => {
  assert.equal(normalizeSiteUrl(' moja-app.vercel.app/ '), 'https://moja-app.vercel.app');
  assert.equal(resolveSiteUrl({ SITE_URL: 'https://filmy.pl/sciezka' }), 'https://filmy.pl');
  assert.equal(resolveSiteUrl({ VERCEL_ENV: 'production', VERCEL_PROJECT_PRODUCTION_URL: 'filmy.vercel.app' }), 'https://filmy.vercel.app');
  assert.equal(resolveSiteUrl({ VERCEL_ENV: 'preview', VERCEL_PROJECT_PRODUCTION_URL: 'filmy.vercel.app' }), null);
  assert.equal(resolveSiteUrl({}), null);
});

test('bearerToken: wielkość liter i spacje bez znaczenia', () => {
  assert.equal(bearerToken({ headers: { authorization: 'bearer  abc.def ' } }), 'abc.def');
  assert.equal(bearerToken({ headers: {} }), null);
  assert.equal(bearerToken({ headers: { authorization: 'Basic xyz' } }), null);
});

// ── Weryfikacja tokenu: rozróżnienie przyczyn ───────────────────────────────
async function withFetch(impl, fn) {
  const original = globalThis.fetch;
  const origError = console.error, origWarn = console.warn;
  globalThis.fetch = impl;
  console.error = console.warn = () => {};
  try { return await fn(); } finally {
    globalThis.fetch = original;
    console.error = origError; console.warn = origWarn;
  }
}

test('token: poprawny → user; URL bez podwójnego „/"', async () => {
  let calledUrl;
  const r = await withFetch(async (url) => { calledUrl = url; return new Response(JSON.stringify({ id: 'u1' }), { status: 200 }); },
    () => verifyAuthToken('t'));
  assert.equal(r.user.id, 'u1');
  assert.equal(calledUrl, 'https://abcdefgh.supabase.co/auth/v1/user');
});

test('token: 401 → invalid; 404/5xx → unreachable; błąd sieci → unreachable; brak → missing', async () => {
  assert.equal((await withFetch(async () => new Response('{}', { status: 401 }), () => verifyAuthToken('t'))).reason, 'invalid');
  assert.equal((await withFetch(async () => new Response('nf', { status: 404 }), () => verifyAuthToken('t'))).reason, 'unreachable');
  assert.equal((await withFetch(async () => { throw new Error('ECONNRESET'); }, () => verifyAuthToken('t'))).reason, 'unreachable');
  assert.equal((await verifyAuthToken(null)).reason, 'missing');
});

// ── Sweeper kar i cron ──────────────────────────────────────────────────────
test('sweeper: zapytanie pomija kary permanentne i porównuje z czasem UTC', () => {
  const p = expiredSanctionsPath(new Date('2026-11-16T10:00:00Z'));
  assert.match(p, /account_status=in\.\(muted,blocked\)/);
  assert.match(p, /muted_until=not\.is\.null/);
  assert.match(p, /muted_until=lte\.2026-11-16T10%3A00%3A00\.000Z/);
});

test('cron: wymaga dokładnie CRON_SECRET w nagłówku Bearer', () => {
  assert.equal(isAuthorizedCron({ headers: { authorization: 'Bearer top-secret' } }), true);
  assert.equal(isAuthorizedCron({ headers: { authorization: 'Bearer wrong' } }), false);
  assert.equal(isAuthorizedCron({ headers: {} }), false);
  assert.equal(isAuthorizedCron({ headers: { authorization: 'Bearer x' } }, undefined), false);
  // Sekret wklejony z cudzysłowami: Vercel wysyła wartość surową — obie formy akceptowane
  assert.equal(isAuthorizedCron({ headers: { authorization: 'Bearer "q"' } }, '"q"'), true);
  assert.equal(isAuthorizedCron({ headers: { authorization: 'Bearer q' } }, '"q"'), true);
  assert.equal(isAuthorizedCron({ headers: {} }, ''), false);
});
