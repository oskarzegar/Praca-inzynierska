# Projekt_Filmy

Serwis internetowy do przeglądania filmów, **wielowymiarowego oceniania**, pisania recenzji,
prowadzenia list „Obejrzane / Do obejrzenia", **wizualizacji statystyk oglądania** oraz
**moderacji opartej na rolach**. Dane o filmach pochodzą z TMDB; warstwa społecznościowa
i analityczna działa na Supabase.

> Pełna specyfikacja, analiza problemu i diagramy UML (przypadków użycia, klas, sekwencji,
> stanów, aktywności): [`Dokumentacja_Projekt_Filmy.md`](./Dokumentacja_Projekt_Filmy.md).

---

## Spis treści
1. [Kontekst i nisza](#kontekst-i-nisza)
2. [Najważniejsze funkcje](#najważniejsze-funkcje)
3. [Stos technologiczny](#stos-technologiczny)
4. [Architektura](#architektura)
5. [Wymagania](#wymagania)
6. [Konfiguracja i uruchomienie](#konfiguracja-i-uruchomienie)
7. [Struktura projektu — opis plików](#struktura-projektu--opis-plików)
8. [Baza danych](#baza-danych)
9. [Bezpieczeństwo](#bezpieczeństwo)
10. [Testy](#testy)
11. [Słownik pojęć](#słownik-pojęć)

---

## Kontekst i nisza

Problemy, które rozwiązuje serwis (za dokumentacją):
- **rozproszenie** notatek o obejrzanych filmach po wielu narzędziach,
- problem **„czy ja to już widziałem?"** przy dużej liczbie tytułów,
- **spłaszczona ocena** — większość serwisów daje jedną liczbę, gubiąc niuanse,
- **spoilery** w recenzjach psujące seans,
- **brak wglądu** we własne nawyki oglądania,
- **brak narzędzi moderacyjnych** w mniejszych społecznościach.

Nisza względem IMDb / Filmweb / Letterboxd:
- **wielowymiarowa ocena** — 4 podkategorie w skali 1–5 (fabuła, aktorstwo, muzyka, efekty);
  ocena ogólna to ich średnia (liczona w bazie, nie wpisywana),
- **bezpłatne, bogate statystyki** — radar preferencji gatunkowych, rozkład dekad, czas oglądania,
- wbudowany mechanizm **oznaczania i ukrywania spoilerów**,
- brak własnej bazy filmów — referencje do TMDB (`movie_id`, `movie_title`, `poster_path`).

## Najważniejsze funkcje

| Obszar | Funkcje (wymagania WF) |
|---|---|
| Konto / auth | rejestracja (z prywatną datą urodzenia), logowanie (modal), **reset hasła** (WF-03), usunięcie konta (WF-20), awatar (WF-22), prywatność list (WF-23) |
| Przeglądanie | przeglądanie i wyszukiwanie TMDB (WF-04), **jeden zaawansowany filtr** (rok, ocena TMDB, długość, sortowanie) (WF-05/21), **ukrywanie obejrzanych** w kategorii (WF-06), karta filmu z **radarem ocen** (WF-07), **filtr treści wg wieku** — klasyfikacje PL/US/GB/DE/FR (WF-25) |
| Oceny / recenzje | ocena w 4 podkategoriach (WF-08), **filtr po ocenach społeczności** (4 kryteria + ogólna) (WF-09), recenzje/komentarze (WF-10), **spoilery** (WF-11), **sortowanie recenzji** data / pomocne / ocena (WF-12) |
| Profil | listy Obejrzane/Do obejrzenia (WF-13), **statystyki** czas + radar gatunków + bubble dekad (WF-14), **rangi** z pomocnych głosów (WF-24) |
| Moderacja / admin | role Gość/User/Moderator/Admin (WF-15), usuwanie treści i blokady (WF-16/17), panel administratora (WF-18); **kary czasowe** (wyciszenie/blokada na czas) z **automatycznym zdejmowaniem po wygaśnięciu**, dziennik moderacji, informowanie ukaranego o karze |

## Stos technologiczny

| Warstwa | Technologia | Rola |
|---|---|---|
| Serwer | Node.js 22, **Express 4** (ES Modules) | serwowanie frontendu, proxy TMDB, REST API, panel admina |
| Konfiguracja / docs | `dotenv`, `swagger-ui-express` | zmienne `.env`; dokumentacja API pod `/api/docs` |
| Frontend | statyczny **HTML + Vanilla JS** (moduły ES, bez frameworka) | interfejs; motyw jasny/ciemny w `localStorage` |
| Wykresy | **Chart.js v4** (ładowany przez ESM z `esm.sh`) | radar, wykres bąbelkowy |
| Auth | **Supabase Auth** | e-mail + hasło, weryfikacja, reset hasła, blokada logowania (ban) |
| Baza | **Supabase PostgreSQL** | 7 tabel + funkcje RPC + Row Level Security + granty kolumnowe |
| Hosting | **Vercel** (funkcja serverless + Vercel Cron) lub dowolny serwer Node.js | Cron zdejmuje wygasłe kary (`vercel.json`) |
| Magazyn plików | **Supabase Storage** (bucket `avatars`) | awatary (2 MB, JPG/PNG/WebP) |
| Klient bazy | `@supabase/supabase-js` v2 (ESM) | komunikacja frontendu z Supabase |
| Dane o filmach | **TMDB API** | katalog, metadane, plakaty, gatunki |

## Architektura

Architektura klient–serwer z chmurowym zapleczem (BaaS). **Dwie warstwy dostępu do danych:**

1. **Bezpośrednio z frontendu przez `@supabase/supabase-js`** — **wszystkie zapisy** użytkownika
   (dodanie/edycja/usunięcie recenzji, komentarzy, głosów, list, awatara, ustawień profilu) oraz
   większość odczytów. **Nie przechodzą przez Express** — ich poprawność i bezpieczeństwo
   gwarantuje wyłącznie **RLS** w bazie.
2. **Przez REST API w Express** — wąski zakres, wyłącznie tam, gdzie potrzeba sekretu lub agregacji:
   proxy TMDB (ukrycie klucza), `GET /stats`, `GET /recommendations`, klasyfikacje wiekowe
   (`GET /api/movies/age-ratings`, buforowane na serwerze), panel administratora (operacje na
   `service_role` po RBAC), konfiguracja klienta (`/api/config`), diagnostyka wdrożenia
   (`/api/health`) i zadanie cykliczne zdejmowania wygasłych kar (`/api/cron/sweep-sanctions`).
   **Udokumentowane endpointy użytkownika są wyłącznie odczytem (GET)** — żaden zapis treści nie
   idzie przez to API.

Wzorzec „gruby klient + RLS, cienki BFF do operacji uprzywilejowanych" jest świadomy i zgodny
z rekomendacjami Supabase. Dostęp do danych egzekwują **dwie warstwy w bazie**: **RLS** (które
*wiersze* widzi/zmienia klient) oraz **granty kolumnowe** (które *kolumny* — patrz `db/70`, bo samo
RLS nie ogranicza kolumn). Serwer dokłada tylko to, czego nie wolno robić w przeglądarce (klucz
TMDB, klucz `service_role`, blokada logowania, agregacja serwerowa).

> **Rekomendacje** (`/api/recommendations`) to **agregacja i re-ranking rekomendacji TMDB**
> sterowane historią użytkownika — nie „content-based filtering" liczone samodzielnie. Wkład
> autorski: personalizowany dobór filmów-źródeł (oceny ≥ 3/5 + ostatnio obejrzane), deduplikacja,
> wykluczenie znanych tytułów i re-ranking ważony liczbą głosów (`vote_average · log10(vote_count+10)`);
> generowanie kandydatów deleguje do silnika TMDB `/movie/{id}/recommendations`.

## Wymagania

- **Node.js ≥ 18** (rozwijane na 22),
- konto **Supabase** (URL + klucz `anon` + klucz `service_role`),
- klucz **TMDB API** — [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).

## Konfiguracja i uruchomienie

**1. Zmienne środowiskowe** — skopiuj `.env.example` → `.env`:

```
TMDB_API_KEY=...
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # TYLKO serwer (panel admina, blokada logowania, czyszczenie kar)
SITE_URL=https://twoja-app.vercel.app   # linki w e-mailach auth (opcjonalne; domyślnie bieżący adres)
CRON_SECRET=...                 # Vercel Cron → /api/cron/sweep-sanctions
PORT=3000
```

Diagnostyka konfiguracji (bez sekretów): `GET /api/health` — m.in. czy `SUPABASE_URL` jest
poprawny i czy klucze należą do tego samego projektu Supabase.

**2. Baza danych** — w Supabase → SQL Editor uruchom **w kolejności**:

| Kolejność | Plik | Zawartość |
|---|---|---|
| 1 | [`db/supabase_setup.sql`](./db/supabase_setup.sql) | 6 tabel, RLS, trigger profilu, `delete_user`, bucket `avatars`, `movies_by_community_rating` |
| 2–7 | [`db/10_rbac.sql`](./db/10_rbac.sql) → [`db/60_self_sanction_visibility.sql`](./db/60_self_sanction_visibility.sql) | role/RBAC, polityki moderacji, RPC ocen i rang, kary czasowe — szczegóły w [`db/README.md`](./db/README.md) |
| 8 | [`db/70_security_fixes.sql`](./db/70_security_fixes.sql) | **KRYTYCZNE** — granty kolumnowe blokujące eskalację uprawnień, wyciek e-maili i nadpisywanie cudzych awatarów. Bez tego pliku RLS nie wystarcza (granty domyślne Supabase dają klientowi zapis/odczyt wszystkich kolumn). |
| 9 | [`db/80_age_restrictions.sql`](./db/80_age_restrictions.sql) | prywatna data urodzenia (RPC tylko dla własnego konta) — filtr treści wg wieku |
| 10 | [`db/90_sanction_sweep.sql`](./db/90_sanction_sweep.sql) | automatyczne zdejmowanie wygasłych kar (funkcja SQL + opcjonalnie pg_cron co minutę) |

> ⚠️ **`db/70` jest obowiązkowy.** Samo RLS ogranicza tylko wiersze — bez grantów kolumnowych
> dowolny zalogowany user jednym żądaniem ustawia sobie `role=admin`, zdejmuje własną karę i czyta
> wszystkie e-maile. Weryfikacja po zastosowaniu: `npm run test:security`.

**2b. Supabase → Authentication → URL Configuration** (wymagane, by linki z e-maili nie prowadziły na localhost):

- **Site URL**: adres produkcyjny, np. `https://twoja-app.vercel.app`
- **Redirect URLs**: `https://twoja-app.vercel.app/**`, `http://localhost:3000/**` (opcjonalnie deploymenty preview: `https://*-twoj-zespol.vercel.app/**`)

Adres spoza tej listy Supabase zastępuje swoim Site URL. Szablony e-maili powinny używać `{{ .ConfirmationURL }}` (nie `{{ .SiteURL }}`).

**3. Pierwszy administrator:**

```sql
update public.profiles set role = 'admin' where email = 'twoj@email.com';
```

**4. Start:**

```bash
npm install
npm start        # http://localhost:3000   (npm run dev — tryb watch)
npm test         # testy jednostkowe (node:test)
```

- Aplikacja: `http://localhost:3000`
- Dokumentacja API (Swagger UI): `http://localhost:3000/api/docs`
- Panel moderacji/admina: `http://localhost:3000/admin` (rola Moderator/Admin)

---

## Struktura projektu — opis plików

### Backend (root)

- **`server.js`** — punkt wejścia Express:
  - nagłówki bezpieczeństwa (`X-Frame-Options`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-DNS-Prefetch-Control`),
  - montaż routerów: `/api/tmdb` (proxy), `/api/admin` (panel), `/api/cron` (zadania cykliczne), `/api` (REST),
  - Swagger UI pod `/api/docs` + `/api/openapi.json`,
  - „ładne" trasy stron: `/film/:slug`, `/category/:slug`, `/admin`,
  - serwowanie statyki z `public/`,
  - **handler błędów**: błędny JSON w treści żądania, błędne kodowanie `%` w ścieżce i każdy nieobsłużony wyjątek trasy kończą się odpowiedzią JSON (`400` / `500`) bez śladu stosu — szczegóły trafiają tylko do logu serwera,
  - start cyklicznego czyszczenia wygasłych kar (`startSanctionSweep`; na Vercel pomijany).
- **`swagger.js`** — specyfikacja **OpenAPI 3** (obiekt JS) wszystkich endpointów: filmy, klasyfikacje wiekowe, profile, statystyki, rekomendacje, panel administracyjny, proxy TMDB, cron, diagnostyka; renderowana przez `swagger-ui-express`.
- **`package.json`** — zależności (`express`, `dotenv`, `swagger-ui-express`) i skrypty `start` / `dev` / `test` / `lint` / `check` (lint + testy) / `test:security`. `"type": "module"` → cały projekt na ES Modules.
- **`vercel.json`** — harmonogram **Vercel Cron**: codzienne wywołanie `/api/cron/sweep-sanctions` (zabezpieczone `CRON_SECRET`).
- **`.env.example`** — wzór zmiennych środowiskowych (opis w sekcji „Konfiguracja i uruchomienie").

### `lib/` — współdzielona warstwa serwera

Podział warstw: **`routes/`** obsługuje wyłącznie przepływ HTTP (walidacja → zapytania → odpowiedź),
**logika biznesowa** jest w modułach `lib/`, a **jedynymi modułami wysyłającymi zapytania** do Supabase
i TMDB są `supabaseRest.js` i `tmdb.js`.

*Dostęp do danych*
- **`supabaseRest.js`** — jedyne miejsce zapytań do Supabase (PostgREST + Auth); adres i klucze z env, oczyszczone ze spacji, cudzysłowów i końcowego „/":
  - `sbFetch` — odczyt kluczem `anon` (RLS roli anonimowej),
  - `sbFetchAsUser` — odczyt tokenem użytkownika (RLS zalogowanego),
  - `sbAdmin` — zapytania kluczem `service_role` (omija RLS; operacje panelu po RBAC, odczyt roli w RBAC, czyszczenie kar),
  - `sbRpcAsUser` / `sbRpcAdmin` — wywołanie RPC tokenem użytkownika (reguły bazy egzekwowane) / kluczem `service_role`; treść odpowiedzi, która nie jest JSON-em, wraca jako tekst,
  - `verifyAuthToken` — weryfikacja tokenu JWT z **rozróżnieniem przyczyny** (brak / nieprawidłowy / błąd konfiguracji / Supabase nieosiągalny); `getAuthUser` — skrót zwracający użytkownika,
  - `setAuthBan` — blokada logowania w Supabase Auth (Admin API); odrzucenie przez Supabase zgłasza błąd,
  - pomocniki `cleanEnv` / `cleanUrl`, `bearerToken`, `projectRefFromKey` / `projectRefFromUrl` (diagnostyka `/api/health`).
- **`tmdb.js`** — dostęp do TMDB z zabezpieczeniami:
  - `isAllowedTmdbPath` — **whitelist** ścieżek (`/movie`, `/discover`, `/search`, `/trending`, `/genre`),
  - wspólny cache **TTL** w pamięci (10 min, maks. 500 wpisów) dla proxy i wywołań serwerowych,
  - **limit czasu 8 s** (`AbortController`) na całe zapytanie — także na odczyt treści odpowiedzi,
  - `tmdbProxy` (dla proxy, zwraca status TMDB), `tmdbFetch` (dla API, rzuca błąd z `.status`) i `tmdbFailure` (mapowanie błędu na `504` timeout / `502`).

*Logika biznesowa*
- **`watchStats.js`** — statystyki oglądania (WF-14): metadane filmów z TMDB, łączny czas, rozkład gatunków i dekad (limit 250 filmów).
- **`recommendations.js`** — rekomendacje: wykluczenia (ostatnio obejrzane i lista do obejrzenia), dobór filmów źródłowych (najwyżej ocenione + ostatnio obejrzane, maks. 5), scalanie i ranking `vote_average · log10(vote_count + 10)`, maks. 20 wyników.
- **`ageRatingsService.js`** — klasyfikacje wiekowe wielu filmów naraz (z TMDB `release_dates`): własny cache 24 h (do 5000 wpisów, „film nie istnieje" — 1 h), maks. 6 równoległych zapytań, maks. 50 ID w żądaniu.
- **`sanctionSweep.js`** — zdejmowanie **wygasłych kar czasowych** (`account_status → 'active'`, `muted_until → NULL`; kary permanentne pomijane). Preferuje funkcję bazy `sweep_expired_sanctions()`, a gdy jej brak — równoważny PATCH kluczem `service_role`. Trzy wyzwalacze: Vercel Cron (`/api/cron/sweep-sanctions`), sweep „leniwy" przed żądaniami panelu admina (maks. raz na ~minutę) oraz timer co 60 s przy klasycznym serwerze.

*Pomocniki*
- **`ttlCache.js`** — cache w pamięci z czasem życia wpisów i limitem rozmiaru (wspólny dla TMDB i klasyfikacji wiekowych).
- **`rateLimit.js`** — limiter per-IP z oknem przesuwnym i wagą żądania (`cost`), okresowo usuwa nieaktywne adresy IP.
- **`siteUrl.js`** — publiczny adres aplikacji dla linków w e-mailach auth (`SITE_URL` → domena produkcyjna Vercel → `null`).
- **`asyncHandler.js`** — przekazuje błędy handlerów `async` do obsługi błędów Express (Express 4 sam tego nie robi — nieobsłużony wyjątek kończyłby proces).

### `routes/` — REST API

Pełny opis endpointów (parametry, odpowiedzi, kody błędów): Swagger UI pod `/api/docs`.

- **`tmdb.js`** — proxy TMDB: rate limit per-IP (600/min, `429` bez `Retry-After`), whitelist + cache + timeout (z `lib/tmdb.js`). Klucz API doklejany po stronie serwera.
- **`api.js`** — główne API:
  - `GET /api/config` — URL + klucz `anon` + publiczny adres aplikacji dla klienta,
  - `GET /api/health` — diagnostyka konfiguracji wdrożenia (flagi, bez sekretów),
  - `GET /api/movies/popular | /search | /:id | /:id/reviews`,
  - `GET /api/movies/age-ratings?ids=…` — klasyfikacje wiekowe do 50 filmów naraz (limit 1500 ID/min na IP),
  - `GET /api/profiles/:id` + `/watchlist` + `/watched` (respektują prywatność),
  - `GET /api/profiles/:id/stats` — **statystyki WF-14** (czas oglądania, gatunki, dekady) liczone z `watched` + TMDB,
  - `GET /api/recommendations` — agregacja rekomendacji TMDB z personalizowanym doborem źródeł (tożsamość z tokenu JWT),
  - spójna obsługa błędów: `404` z TMDB, `502` / `504` przy awarii lub timeoucie TMDB, `500` przy błędzie bazy (z wpisem w logu).
- **`admin.js`** — panel moderacji/admina, **RBAC po stronie serwera**:
  - middleware `requireRole(['moderator','admin'])` / `requireAdmin`; odrzucony token → `401` (klient odświeża sesję i ponawia), błąd konfiguracji lub sieci serwera → `503`,
  - `GET /me`, `/feed` (ostatnie treści), `/log` (dziennik), `/users` (lista/szukanie),
  - `DELETE /reviews/:id`, `/comments/:id`; `PATCH /reviews/:id/spoiler`,
  - `PATCH /users/:id/status` (wycisz/blokuj/przywróć + czas trwania, blokada logowania w Supabase Auth) i `/users/:id/role`,
  - **walidacja wejścia**: `:id` musi być UUID (inaczej `400` — nic nie trafia do bazy), `limit` to dodatnia liczba całkowita (inaczej wartość domyślna), parametry zapytania inne niż tekst są ignorowane, `until` musi być poprawną datą,
  - awaria bazy przy zmianie statusu lub roli → `502`; status zapisany, ale blokada logowania odrzucona → `500` z komunikatem,
  - operacje przez `service_role` **dopiero po** weryfikacji uprawnień (wyjątek: sweep wygasłych kar przed RBAC); zmiany statusu i roli idą tokenem moderatora, a hierarchię ról egzekwuje dodatkowo baza.
- **`cron.js`** — `GET /api/cron/sweep-sanctions` dla Vercel Cron: wymaga nagłówka `Authorization: Bearer <CRON_SECRET>` (bez skonfigurowanego sekretu — `503`), zwraca `{ ok, cleared, via }`.

### Baza danych (`db/`)

- **`supabase_setup.sql`** — schemat bazowy: 6 tabel (`profiles`, `watchlist`, `watched`, `reviews`, `review_votes`, `review_comments`), RLS, trigger `handle_new_user`, `delete_user`, bucket `avatars`, `movies_by_community_rating`.
- **`10_rbac.sql`** — kolumny `role` / `account_status` / `muted_until`; tabela `moderation_log`; funkcje `current_user_role`, `is_admin`, `is_moderator`, `can_post`.
- **`20_rls_moderation.sql`** — polityki RLS moderacji (Mod/Admin usuwa/edytuje cudze treści), **restrykcyjna blokada publikowania** dla kont ukaranych, funkcje `set_account_status` i `set_user_role` (RBAC w bazie).
- **`30_rpc_ratings.sql`** — `movie_community_rating` (średnie podkategorii 1 filmu, WF-07) i `movies_by_community_rating_multi` (filtr 4 kryteria + ogólna, WF-09).
- **`40_user_ranks.sql`** — `user_rank_info` (rola + suma pomocnych głosów → rangi, WF-24).
- **`50_sanction_duration.sql`** — kary czasowe: `muted_until` także dla `blocked`; `can_post()` auto-wygasa karę.
- **`60_self_sanction_visibility.sql`** — polityka RLS: użytkownik czyta **własne** wpisy `moderation_log` (powód kary w banerze).
- **`70_security_fixes.sql`** — **krytyczne** granty kolumnowe: `role` / `account_status` / `muted_until` niezapisywalne z przeglądarki, `email` nieczytelny dla klienta, awatary tylko we własnym folderze Storage.
- **`80_age_restrictions.sql`** — prywatna kolumna `profiles.birth_date` (bez grantów dla klienta), RPC `get_my_birth_date` / `set_my_birth_date`, zapis daty z rejestracji w triggerze `handle_new_user` (WF-25).
- **`90_sanction_sweep.sql`** — funkcja `sweep_expired_sanctions()` (zdejmuje wygasłe kary wg zegara bazy, wpis w dzienniku) + opcjonalny harmonogram `pg_cron` co minutę.
- **`README.md`** — kolejność migracji i model uprawnień.

### Frontend — strony HTML (`public/`)

Każda strona ma wspólny nagłówek (logo, wyszukiwarka-lupa, menu) i ładuje `global.js` + swój moduł + `auth.js`.

- **`index.html`** — strona główna (banner, sekcje TMDB, rekomendacje) → `index.js`.
- **`details.html`** — szczegóły filmu (`/film/:slug`) → `details.js`.
- **`movieList.html`** — lista filmów w kategorii (`/category/:slug`) → `movieList.js`.
- **`profile.html`** — profil użytkownika (statystyki, recenzje, listy) → `profile.js`.
- **`admin.html`** — panel moderacji/admina (`/admin`) → `admin.js`.
- **`reset-password.html`** — ustawienie nowego hasła z linku e-mail → `resetPassword.js`.

### Frontend — moduły JS (`public/assets/js/`)

**Rdzeń / współdzielone**
- **`supabase.js`** — tworzy klienta Supabase (config z `/api/config`, obsługa błędu).
- **`utils.js`** — `escapeHtml` / `escapeAttr` (ochrona przed XSS — jedno źródło prawdy).
- **`api.js`** — helpery: `imgBaseURL`, `fetchData` (fetch z obsługą błędów), `slugify`, `movieUrl`.
- **`global.js`** — przełączanie pola wyszukiwania w nagłówku.
- **`sidebar.js`** — menu boczne z linkami gatunków (z TMDB).
- **`search.js`** — **jeden zaawansowany system wyszukiwania** w modalu otwieranym lupą: tytuł + rok + ocena TMDB + długość + sortowanie + **4 kryteria ocen społeczności**.
- **`movie-card.js`** — komponent karty filmu (poster, tytuł, ocena TMDB + społeczności).
- **`communityRatings.js`** — wsadowe ładowanie i cache średnich ocen społeczności (badge na kartach).
- **`yearRange.js`** — walidacja zakresu lat w wyszukiwarce (TMDB ignoruje lata spoza obsługiwanego zakresu i zwraca wtedy wszystkie filmy).
- **`ageRatings.js`** — klasyfikacje wiekowe (czyste funkcje, współdzielone z serwerem): wybór klasyfikacji (PL, potem US/GB/DE/FR), minimalny wiek, etykiety i opisy.
- **`ageGate.js`** — filtr treści wg wieku (WF-25): wiek z prywatnej daty urodzenia, klasyfikacje pobierane paczkami z `/api/movies/age-ratings`, blokowanie niedozwolonych kart filmów; przy nieznanym wieku blokowane są tylko treści 18+.

**Konto i moderacja**
- **`auth.js`** — modal konta: logowanie, rejestracja, reset hasła, edycja profilu, awatar, prywatność list, usunięcie konta, link do panelu (dla Mod/Admin), wpięcie banera kary.
- **`rbac.js`** — rola zalogowanego (cache), `isModerator`/`isAdmin`, `adminFetch` (wywołania `/api/admin/*` z tokenem).
- **`moderation.js`** — akcje moderacyjne: usuń/ukryj-spoiler recenzji, usuń komentarz, panel na profilu (wycisz/blokuj/rola), helpery `effectiveStatus` / `sanctionSuffix` (status efektywny po wygaśnięciu kary).
- **`dialog.js`** — modal w-stronie (zamiast `prompt`/`confirm`): powód kary + **czas trwania** (na stałe / liczba + jednostka).
- **`sanctionNotice.js`** — informowanie ukaranego: `getMySanction`, globalny **baner kary** (status + termin + powód), tekst do formularzy.
- **`admin.js`** — logika panelu: zakładki **Treści do moderacji / Użytkownicy / Dziennik**, akcje moderacyjne, zarządzanie kontami i rolami.

**Treści i widoki**
- **`index.js`** — strona główna: hero-banner z autoodtwarzaniem, sekcje TMDB, „Polecane dla ciebie".
- **`details.js`** — szczegóły filmu: dane TMDB, „Gdzie obejrzeć" (JustWatch), radar ocen, listy, recenzje, podobne filmy.
- **`movieList.js`** — kategoria: paginacja + przełącznik **„Ukryj obejrzane"** (WF-06).
- **`profile.js`** — profil: nagłówek z rangami, statystyki, ostatnie recenzje, listy; panel moderacji dla uprawnionych.
- **`reviews.js`** — sekcja recenzji: formularz (gwiazdki 1–5, spoiler), lista z głosowaniem, komentarze, **sortowanie** (data/pomocne/ocena), **rangi**, akcje moderacyjne, komunikat o karze.
- **`lists.js`** — przyciski „Do obejrzenia / Obejrzane" na karcie filmu (z blokadą podwójnego kliknięcia).
- **`stats.js`** — statystyki profilu (WF-14): kafelki czasu + radar gatunków + bubble dekad.
- **`charts.js`** — cienka warstwa nad Chart.js: `renderRadarChart`, `renderBubbleChart`, kolory z motywu.
- **`movieRadar.js`** — radar ocen społeczności na stronie filmu (WF-07) + średnia ogólna.
- **`resetPassword.js`** — obsługa linku resetu hasła (ustawienie + wylogowanie).

### Pozostałe
- **`public/assets/css/style.css`** — pełny styl aplikacji (motyw jasny/ciemny przez zmienne CSS, responsywność, komponenty: karty, modale, wykresy, panele, banery).
- **`test/unit.test.js`** — testy jednostkowe (`node:test`): `slugify` (w tym edge case ł/Ł), `movieUrl`, `escapeHtml`/`escapeAttr`, whitelist proxy `isAllowedTmdbPath`.
- **`test/fixes.test.js`** — testy poprawek (`node:test`): walidacja zakresu lat, klasyfikacje wiekowe, `parseIds`, oczyszczanie zmiennych env, adres witryny, weryfikacja tokenu, sweeper kar, autoryzacja crona oraz odporność na awarie (RPC z treścią nie-JSON, odrzucona blokada logowania, `asyncHandler`).
- **`scripts/check-syntax.mjs`** — kontrola składni wszystkich plików JS (`npm run lint`); **`scripts/security-check.mjs`** — test napastniczy RLS i uprawnień (`npm run test:security`).

---

## Baza danych

7 tabel w schemacie `public`, na każdej włączony **RLS**. Dane o filmach nie mają własnej tabeli —
utrwalane są referencje do TMDB (`movie_id`, `movie_title`, `poster_path`).

| Tabela | Rola |
|---|---|
| `profiles` | profil 1:1 z `auth.users`; `role`, `account_status`, `muted_until`, prywatność list, awatar, prywatna `birth_date` |
| `watchlist` / `watched` | listy „Do obejrzenia" / „Obejrzane" (`UNIQUE(user_id, movie_id)`) |
| `reviews` | recenzje z 4 ocenami 1–5 + `is_spoiler` (`UNIQUE(user_id, movie_id)`) |
| `review_votes` | głosy „pomocne" (podstawa rang) |
| `review_comments` | komentarze pod recenzjami |
| `moderation_log` | dziennik działań moderacji (kto, kogo, co, powód) |

**Kluczowe funkcje RPC:** `movies_by_community_rating`, `movie_community_rating`,
`movies_by_community_rating_multi`, `user_rank_info`, `set_account_status`, `set_user_role`,
`can_post`, `is_admin`/`is_moderator`/`current_user_role`, `handle_new_user`, `delete_user`,
`get_my_birth_date`/`set_my_birth_date`, `sweep_expired_sanctions`.

## Bezpieczeństwo

- **RLS (wiersze) + granty kolumnowe (kolumny)** — RLS ogranicza, które *wiersze* widzi/zmienia
  klient, ale to za mało: domyślne granty Supabase dają rolom `anon`/`authenticated` dostęp do
  *wszystkich kolumn*. Dlatego [`db/70_security_fixes.sql`](./db/70_security_fixes.sql) odbiera te
  uprawnienia kolumnowo:
  - `role` / `account_status` / `muted_until` w `profiles` **niezapisywalne z przeglądarki** —
    zmienia je wyłącznie SECURITY DEFINER (`set_user_role` / `set_account_status`); blokuje to
    eskalację do admina i samodzielne zdejmowanie kar,
  - `email` **nieczytelny dla klienta** (`anon`/`authenticated`) — panel admina czyta go `service_role`,
  - awatary w Storage zapisywane/usuwane **tylko we własnym folderze** `{user_id}/...`.

  Polityki i granty są w repo (`db/`), a regresję pilnuje test napastniczy `npm run test:security`
  (próbuje eskalacji/ wycieku i oczekuje odmowy).
- Prywatność list: odczyt `watchlist`/`watched` tylko właściciel lub gdy `*_public = true` (RLS).
- **RBAC** (User / Moderator / Admin) egzekwowane **dwuwarstwowo**: RLS **i** serwer
  (`routes/admin.js` + funkcje `set_account_status` / `set_user_role`).
- **XSS** — wszystkie dane od użytkownika (nazwy, tytuły, recenzje, komentarze, `avatar_url`)
  escapowane (`utils.js`) przed wstawieniem do `innerHTML`. `avatar_url` trafia wyłącznie do
  atrybutu `src` obrazka przez `escapeAttr` (nie do `href`), więc wektor `javascript:` nie wchodzi.
- **Klucz TMDB** ukryty za proxy: whitelist ścieżek, rate limit per-IP, cache, timeout.
- **Klucz `service_role`** używany wyłącznie po stronie serwera: w panelu po sprawdzeniu uprawnień,
  a poza panelem tylko w zadaniu zdejmowania wygasłych kar (cron chroniony `CRON_SECRET`, timer, sweep leniwy).
- **Walidacja wejścia panelu**: identyfikatory w ścieżce muszą być UUID (nie da się dopisać parametrów
  do zapytania PostgREST), parametry zapytania inne niż tekst są ignorowane, termin kary musi być poprawną datą.
- **Odporność serwera**: wyjątek w trasie nie kończy procesu (`asyncHandler` + handler błędów), awaria bazy
  lub TMDB daje odpowiedź `502` / `504`, a zapytania do TMDB mają limit czasu 8 s.
- **Brak wycieku szczegółów**: błędy są zwracane jako JSON bez śladu stosu i ścieżek plików.
- Nagłówki bezpieczeństwa ustawiane w `server.js` (`trust proxy` włączony dla poprawnego `req.ip`).

**Świadome ograniczenia** (do uczciwego omówienia na obronie):
- Brak **CSP** — obrona przed XSS opiera się w 100% na scentralizowanym, przetestowanym escapowaniu;
  CSP byłaby tanią drugą linią obrony, ale wymagałaby konfiguracji pod CDN-y (esm.sh, fonts,
  `image.tmdb.org`, YouTube) i nonce dla inline'owego skryptu motywu.
- **Rate limiter** proxy TMDB jest **w pamięci procesu** (stan znika po restarcie, nie współdzieli się
  między instancjami) — wystarczający dla pojedynczej instancji/demo, do skalowania wymagałby np. Redisa.
- **Usunięcie treści przez moderatora i wpis w dzienniku** to dwa osobne zapytania, a nie jedna transakcja —
  przy awarii między nimi treść zniknie bez wpisu. Pełna atomowość wymagałaby funkcji RPC w bazie.

## Testy

```bash
npm run lint        # kontrola składni wszystkich plików JS (node --check)
npm test            # testy jednostkowe (offline, bez zależności)
npm run test:security   # test napastniczy RLS/uprawnień (wymaga .env + sieci)
```

- **Jednostkowe** (`node:test`) — czyste funkcje: `slugify` (edge case polskich ł/Ł), `movieUrl`,
  escapowanie `escapeHtml`/`escapeAttr` oraz whitelist proxy `isAllowedTmdbPath` (`test/unit.test.js`);
  poprawki i odporność serwera — zakres lat, klasyfikacje wiekowe, konfiguracja env, weryfikacja tokenu
  (z atrapą `fetch`), sweeper kar, cron, obsługa awarii RPC i blokady logowania (`test/fixes.test.js`).
- **Napastniczy** ([`scripts/security-check.mjs`](./scripts/security-check.mjs)) — tworzy konto
  testowe i próbuje eskalacji roli, zmiany własnej kary oraz wycieku e-maili; po `db/70` wszystkie
  próby muszą zostać odrzucone (na końcu sprząta konto). Pozostaje poza `npm test`, bo wymaga sieci.

---

## Słownik pojęć

| Pojęcie | Wyjaśnienie (w kontekście projektu) |
|---|---|
| **RLS** (Row Level Security) | Mechanizm PostgreSQL egzekwujący dostęp **na poziomie pojedynczych wierszy** — polityki decydują, kto czyta/zmienia dany rekord. **Nie ogranicza kolumn** — dlatego uzupełniają go granty kolumnowe (`db/70`). |
| **Granty kolumnowe** | Uprawnienia GRANT/REVOKE na poziomie *kolumn* tabeli. W projekcie blokują klientowi zapis `role`/`account_status` i odczyt `email` w `profiles` — tego RLS sam nie potrafi. |
| **RBAC** (Role-Based Access Control) | Kontrola dostępu oparta na **rolach** (Gość / User / Moderator / Admin). W projekcie egzekwowana dwuwarstwowo: w bazie (RLS + funkcje) i na serwerze (`routes/admin.js`). |
| **XSS** (Cross-Site Scripting) | Atak polegający na wstrzyknięciu kodu (np. `<script>`) przez dane użytkownika. Obrona: **escapowanie** treści (`utils.js`) przed wstawieniem do `innerHTML`. |
| **JWT** (JSON Web Token) | Podpisany token sesji wydawany przez Supabase Auth po zalogowaniu. Backend weryfikuje nim tożsamość; RLS odczytuje z niego `auth.uid()`. |
| **RPC** (Remote Procedure Call) | Tu: funkcja PostgreSQL wołana przez API Supabase (`supabase.rpc(...)` lub `/rest/v1/rpc/...`), np. `movies_by_community_rating_multi`, `set_account_status`. |
| **BaaS** (Backend as a Service) | Gotowe zaplecze w chmurze (Supabase: baza, auth, storage) — zamiast pisać własny serwer bazodanowy. |
| **PostgREST** | Warstwa Supabase wystawiająca tabele i funkcje PostgreSQL jako **REST API** (`/rest/v1/...`), respektujące RLS. |
| **`anon` / `service_role`** | Dwa klucze API Supabase: `anon` (publiczny, RLS aktywne — używany w przeglądarce) i `service_role` (**omija RLS**, tylko serwer, po autoryzacji RBAC). |
| **SECURITY DEFINER / INVOKER** | Tryb wykonania funkcji SQL: *Definer* działa z uprawnieniami właściciela (omija RLS — np. `set_account_status`), *Invoker* z uprawnieniami wołającego. |
| **Trigger** | Funkcja uruchamiana automatycznie przy zdarzeniu w bazie — np. `handle_new_user` tworzy profil po rejestracji konta. |
| **ESM / ES Modules** | Natywny system modułów JavaScript (`import` / `export`) — używany i na froncie, i na backendzie (`"type": "module"`). |
| **TMDB** (The Movie Database) | Zewnętrzne API z danymi o filmach (katalog, plakaty, gatunki). Źródło danych filmowych — własna baza filmów nie istnieje. |
| **Proxy** | Pośrednik: serwer przekazuje zapytania do TMDB, **doklejając klucz API po swojej stronie**, by nie trafił do przeglądarki. |
| **Whitelist** | Lista dozwolonych ścieżek TMDB — proxy obsługuje tylko zasoby używane przez aplikację, resztę odrzuca (403). |
| **Rate limiting** | Ograniczenie liczby żądań na IP w oknie czasu — chroni klucz TMDB przed nadużyciem. |
| **TTL** (Time To Live) | Czas życia wpisu w cache (tu 10 min) — po nim dane są pobierane z TMDB ponownie. |
| **CDN** | Sieć dostarczania treści — z niej ładowane są `@supabase/supabase-js` i Chart.js (przez `esm.sh`). |
| **Slug** | Przyjazny fragment URL z tytułu, np. `avengers-endgame-2019-299534` (funkcja `slugify`). |
| **Spoiler** | Recenzja zdradzająca fabułę — oznaczana flagą `is_spoiler` i ukrywana z ostrzeżeniem (WF-11). |
| **Ranga** | Tytuł nadawany z liczby **pomocnych głosów** (Widz → Recenzent → Krytyk → Ekspert → Filmoznawca, WF-24). |
| **Kara czasowa** | Wyciszenie (blokada publikowania) lub blokada (także logowania) na czas określony lub na stałe; po wygaśnięciu konto wraca do `active`. |
| **Cron / Vercel Cron** | Zadanie uruchamiane cyklicznie według harmonogramu. Tu: Vercel wywołuje `/api/cron/sweep-sanctions` (z sekretem `CRON_SECRET`), a ten zdejmuje wygasłe kary czasowe. |
| **Klasyfikacja wiekowa** | Oznaczenie minimalnego wieku widza (np. PL `16`, US `PG-13`) z TMDB; podstawa filtra treści wg wieku (WF-25). |
| **UUID** | Losowy, 128-bitowy identyfikator rekordów w bazie (np. recenzji, profilu). Panel admina przyjmuje w ścieżce wyłącznie poprawne UUID. |
| **Hashowanie hasła** | Przechowywanie hasła wyłącznie jako nieodwracalny skrót (po stronie Supabase Auth) — nigdy jako tekst jawny. |
