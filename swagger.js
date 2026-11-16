export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Projekt Filmy – REST API',
    version: '1.1.0',
    description:
      'API serwisu filmowego: dane o filmach (TMDB), recenzje, profile użytkowników i ich listy, ' +
      'statystyki oglądania, rekomendacje, klasyfikacje wiekowe oraz panel moderacji. ' +
      'Każdy błąd jest zwracany jako JSON `{ "error": "…" }` (w panelu admina czasem także pole `code`); ' +
      'serwer nie ujawnia śladów stosu ani ścieżek plików. Błędny JSON w treści żądania → 400.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Lokalny serwer deweloperski' }],
  tags: [
    { name: 'Filmy',           description: 'Dane filmowe pobierane z TMDB' },
    { name: 'Profile',         description: 'Profile użytkowników i ich listy' },
    { name: 'Konfiguracja',    description: 'Publiczna konfiguracja klienta i diagnostyka wdrożenia' },
    { name: 'Administracja',   description: 'Panel moderacji i administracji (RBAC, wymaga roli Moderator/Admin)' },
    { name: 'Proxy TMDB',      description: 'Pośrednik do TMDB — klucz API doklejany po stronie serwera' },
    { name: 'Zadania serwera', description: 'Zadania cykliczne wywoływane przez Vercel Cron' },
  ],
  paths: {
    '/api/config': {
      get: {
        tags: ['Konfiguracja'],
        summary: 'Konfiguracja publiczna',
        description:
          'Zwraca URL i klucz anonimowy Supabase potrzebne do inicjalizacji klienta w przeglądarce ' +
          'oraz publiczny adres aplikacji dla linków w e-mailach auth.',
        responses: {
          200: {
            description: 'Dane konfiguracyjne',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Config' },
              },
            },
          },
        },
      },
    },

    '/api/health': {
      get: {
        tags: ['Konfiguracja'],
        summary: 'Diagnostyka konfiguracji wdrożenia',
        description:
          'Sprawdza konfigurację serwera bez ujawniania sekretów: czy ustawiono zmienne środowiskowe, ' +
          'czy SUPABASE_URL ma poprawny format, czy klucze należą do tego samego projektu Supabase ' +
          'i czy wartości wymagały oczyszczenia (spacje, cudzysłowy, końcowy „/").',
        responses: {
          200: {
            description: 'Stan konfiguracji (odpowiedź z nagłówkiem Cache-Control: no-store)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Health' },
              },
            },
          },
        },
      },
    },

    '/api/movies/age-ratings': {
      get: {
        tags: ['Filmy'],
        summary: 'Klasyfikacje wiekowe wielu filmów',
        description:
          'Zwraca klasyfikację wiekową (PL, a gdy jej brak — US, GB, DE, FR) dla maks. 50 filmów naraz. ' +
          'Wyniki są buforowane na serwerze (24 h; „film nie istnieje" — 1 h). Limit: 1500 ID na minutę na adres IP. ' +
          'Wartość null przy ID oznacza, że nie udało się sprawdzić klasyfikacji (można ponowić).',
        parameters: [
          {
            name: 'ids',
            in: 'query',
            required: true,
            description: 'Identyfikatory TMDB oddzielone przecinkami (maks. 50; duplikaty i niepoprawne wartości są pomijane)',
            schema: { type: 'string', example: '550,27205,603' },
          },
        ],
        responses: {
          200: {
            description:
              'Klasyfikacje. Cache-Control: public, max-age=3600 — albo no-store, gdy dla części ID sprawdzenie się nie powiodło.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ratings: {
                      type: 'object',
                      additionalProperties: { allOf: [{ $ref: '#/components/schemas/AgeRating' }], nullable: true },
                    },
                  },
                },
              },
            },
          },
          400: {
            description: 'Brak poprawnych ID',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'Parametr ids jest wymagany (maks. 50 liczb oddzielonych przecinkami)' },
              },
            },
          },
          429: { $ref: '#/components/responses/TooManyRequests' },
          502: {
            description: 'TMDB nie odpowiada dla żadnego z filmów',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'TMDB nie odpowiada — nie udało się sprawdzić klasyfikacji' },
              },
            },
          },
        },
      },
    },

    '/api/movies/popular': {
      get: {
        tags: ['Filmy'],
        summary: 'Popularne filmy',
        description: 'Zwraca stronę popularnych filmów posortowanych malejąco według popularności.',
        parameters: [
          {
            name: 'page',
            in: 'query',
            description: 'Numer strony (domyślnie 1)',
            schema: { type: 'integer', default: 1, minimum: 1 },
          },
        ],
        responses: {
          200: {
            description: 'Lista popularnych filmów',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MoviePage' },
              },
            },
          },
          404: { $ref: '#/components/responses/TmdbNotFound' },
          502: { $ref: '#/components/responses/TmdbError' },
          504: { $ref: '#/components/responses/TmdbTimeout' },
        },
      },
    },

    '/api/movies/search': {
      get: {
        tags: ['Filmy'],
        summary: 'Wyszukiwanie filmów',
        description: 'Wyszukuje filmy po tytule przy użyciu silnika TMDB.',
        parameters: [
          {
            name: 'query',
            in: 'query',
            required: true,
            description: 'Fraza do wyszukania',
            schema: { type: 'string', example: 'Inception' },
          },
          {
            name: 'page',
            in: 'query',
            description: 'Numer strony (domyślnie 1)',
            schema: { type: 'integer', default: 1 },
          },
        ],
        responses: {
          200: {
            description: 'Wyniki wyszukiwania',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MoviePage' },
              },
            },
          },
          400: {
            description: 'Brak wymaganego parametru query',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'Parametr query jest wymagany' },
              },
            },
          },
          404: { $ref: '#/components/responses/TmdbNotFound' },
          502: { $ref: '#/components/responses/TmdbError' },
          504: { $ref: '#/components/responses/TmdbTimeout' },
        },
      },
    },

    '/api/movies/{id}': {
      get: {
        tags: ['Filmy'],
        summary: 'Szczegóły filmu',
        description: 'Zwraca pełne informacje o filmie: opis, obsada i ekipa (credits), zwiastuny (videos), gatunki.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Identyfikator TMDB',
            schema: { type: 'integer', example: 27205 },
          },
        ],
        responses: {
          200: {
            description: 'Szczegóły filmu',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/MovieDetail' },
              },
            },
          },
          404: { $ref: '#/components/responses/TmdbNotFound' },
          502: { $ref: '#/components/responses/TmdbError' },
          504: { $ref: '#/components/responses/TmdbTimeout' },
        },
      },
    },

    '/api/movies/{id}/reviews': {
      get: {
        tags: ['Filmy'],
        summary: 'Recenzje filmu',
        description: 'Zwraca wszystkie recenzje napisane przez użytkowników serwisu dla danego filmu.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'Identyfikator TMDB filmu',
            schema: { type: 'integer', example: 27205 },
          },
        ],
        responses: {
          200: {
            description: 'Lista recenzji',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/Review' },
                },
              },
            },
          },
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },

    '/api/recommendations': {
      get: {
        tags: ['Filmy'],
        summary: 'Rekomendacje dla użytkownika',
        description:
          'Agregacja rekomendacji TMDB z personalizowanym doborem filmów źródłowych ' +
          '(na podstawie ocen i historii oglądania) oraz własnym rankingiem. Wyklucza filmy ' +
          'ostatnio obejrzane (30 najnowszych) i zapisane na liście do obejrzenia; maks. 20 wyników. ' +
          'Tożsamość użytkownika wynika z tokenu JWT (nie z parametru). Niedostępne pojedyncze źródło ' +
          'TMDB nie przerywa odpowiedzi (jest pomijane i logowane).',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Lista rekomendowanych filmów',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    results: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/MovieSummary' },
                    },
                  },
                },
              },
            },
          },
          401: {
            description: 'Brak tokenu („Brak tokenu autoryzacji") albo token nieprawidłowy lub wygasły („Nieprawidłowy lub wygasły token")',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'Brak tokenu autoryzacji' },
              },
            },
          },
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },

    '/api/profiles/{id}': {
      get: {
        tags: ['Profile'],
        summary: 'Profil użytkownika',
        description: 'Zwraca publiczne dane profilu: nazwa, awatar, ustawienia widoczności list.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'UUID użytkownika',
            schema: { type: 'string', format: 'uuid', example: '00000000-0000-0000-0000-000000000000' },
          },
        ],
        responses: {
          200: {
            description: 'Dane profilu',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Profile' },
              },
            },
          },
          404: {
            description: 'Profil nie znaleziony',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'Profil nie znaleziony' },
              },
            },
          },
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },

    '/api/profiles/{id}/stats': {
      get: {
        tags: ['Profile'],
        summary: 'Statystyki oglądania (WF-14)',
        description:
          'Liczy w locie czas oglądania, rozkład gatunków i dekad na podstawie listy obejrzanych ' +
          'i danych TMDB. Własne statystyki widzi właściciel (token JWT); cudze tylko gdy lista ' +
          'obejrzanych jest publiczna. Liczonych jest maks. 250 filmów; film, którego danych nie udało ' +
          'się pobrać z TMDB, jest pomijany (wtedy incomplete = true).',
        security: [{}, { BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'Zagregowane statystyki (przy pustej liście: tylko watchedCount, totalRuntimeMinutes, genres, decades)',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    watchedCount:        { type: 'integer', description: 'Liczba filmów na liście obejrzanych' },
                    moviesCounted:       { type: 'integer', description: 'Ile filmów faktycznie policzono' },
                    incomplete:          { type: 'boolean', description: 'true, gdy części danych TMDB nie udało się pobrać' },
                    totalRuntimeMinutes: { type: 'integer' },
                    genres:  { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, count: { type: 'integer' } } } },
                    decades: { type: 'array', items: { type: 'object', properties: { decade: { type: 'integer' }, count: { type: 'integer' } } } },
                  },
                },
              },
            },
          },
          403: {
            description: 'Statystyki są prywatne',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Statystyki są prywatne' } } },
          },
          404: {
            description: 'Profil nie znaleziony',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Profil nie znaleziony' } } },
          },
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },

    '/api/admin/feed': {
      get: {
        tags: ['Administracja'],
        summary: 'Ostatnie treści do moderacji',
        description: 'Zwraca ostatnio dodane recenzje i komentarze. Wymaga roli Moderator lub Admin.',
        security: [{ BearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/FeedLimit' }],
        responses: {
          200: { description: '{ reviews, comments } — po `limit` najnowszych pozycji' },
          401: { $ref: '#/components/responses/AdminUnauthorized' },
          403: { $ref: '#/components/responses/AdminForbidden' },
          500: { $ref: '#/components/responses/AdminServerError' },
          503: { $ref: '#/components/responses/AdminUnavailable' },
        },
      },
    },

    '/api/admin/me': {
      get: {
        tags: ['Administracja'],
        summary: 'Rola zalogowanego (guard panelu)',
        description: 'Zwraca id i rolę zalogowanego. Wymaga roli Moderator lub Admin.',
        security: [{ BearerAuth: [] }],
        responses: {
          200: { description: '{ id, role }' },
          401: { $ref: '#/components/responses/AdminUnauthorized' },
          403: { $ref: '#/components/responses/AdminForbidden' },
          500: { $ref: '#/components/responses/AdminServerError' },
          503: { $ref: '#/components/responses/AdminUnavailable' },
        },
      },
    },

    '/api/admin/log': {
      get: {
        tags: ['Administracja'],
        summary: 'Dziennik działań moderacji',
        description: 'Ostatnie wpisy z moderation_log (kto, kogo, jaka akcja, powód). Wymaga Moderator/Admin.',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'limit', in: 'query',
            description: 'Liczba wpisów: dodatnia liczba całkowita, maks. 200; brak lub inna wartość → 80',
            schema: { type: 'integer', default: 80, minimum: 1, maximum: 200 },
          },
        ],
        responses: {
          200: { description: 'Lista wpisów dziennika' },
          401: { $ref: '#/components/responses/AdminUnauthorized' },
          403: { $ref: '#/components/responses/AdminForbidden' },
          500: { $ref: '#/components/responses/AdminServerError' },
          503: { $ref: '#/components/responses/AdminUnavailable' },
        },
      },
    },

    '/api/admin/users': {
      get: {
        tags: ['Administracja'],
        summary: 'Lista / wyszukiwanie kont',
        description: 'Konta wraz z rolą i statusem. Opcjonalne wyszukiwanie po nazwie lub e-mailu.',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'query', in: 'query',
            description:
              'Fraza (nazwa lub e-mail, bez rozróżniania wielkości liter). Znaki ( ) , * są zamieniane na spacje; ' +
              'powtórzony parametr lub wartość w formie obiektu są ignorowane.',
            schema: { type: 'string' },
          },
          {
            name: 'limit', in: 'query',
            description: 'Liczba kont: dodatnia liczba całkowita, maks. 100; brak lub inna wartość → 30',
            schema: { type: 'integer', default: 30, minimum: 1, maximum: 100 },
          },
        ],
        responses: {
          200: { description: 'Lista kont' },
          401: { $ref: '#/components/responses/AdminUnauthorized' },
          403: { $ref: '#/components/responses/AdminForbidden' },
          500: { $ref: '#/components/responses/AdminServerError' },
          503: { $ref: '#/components/responses/AdminUnavailable' },
        },
      },
    },

    '/api/admin/reviews/{id}': {
      delete: {
        tags: ['Administracja'],
        summary: 'Usunięcie cudzej recenzji (WF-17)',
        description: 'Usuwa recenzję i zapisuje akcję w dzienniku moderacji (opcjonalny powód w treści żądania).',
        security: [{ BearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/AdminId' }],
        requestBody: { $ref: '#/components/requestBodies/ModerationReason' },
        responses: {
          200: { description: '{ ok: true }' },
          400: { $ref: '#/components/responses/AdminBadRequest' },
          401: { $ref: '#/components/responses/AdminUnauthorized' },
          403: { $ref: '#/components/responses/AdminForbidden' },
          404: { description: 'Recenzja nie istnieje' },
          500: { $ref: '#/components/responses/AdminServerError' },
          503: { $ref: '#/components/responses/AdminUnavailable' },
        },
      },
    },

    '/api/admin/reviews/{id}/spoiler': {
      patch: {
        tags: ['Administracja'],
        summary: 'Wymuszenie / zdjęcie flagi spoilera (WF-11, WF-17)',
        description: 'Flaga jest ustawiana tylko dla wartości dokładnie `true`; każda inna wartość ją zdejmuje.',
        security: [{ BearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/AdminId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { is_spoiler: { type: 'boolean' } }, required: ['is_spoiler'] },
            },
          },
        },
        responses: {
          200: { description: '{ ok: true, is_spoiler }' },
          400: { $ref: '#/components/responses/AdminBadRequest' },
          401: { $ref: '#/components/responses/AdminUnauthorized' },
          403: { $ref: '#/components/responses/AdminForbidden' },
          404: { description: 'Recenzja nie istnieje' },
          500: { $ref: '#/components/responses/AdminServerError' },
          503: { $ref: '#/components/responses/AdminUnavailable' },
        },
      },
    },

    '/api/admin/comments/{id}': {
      delete: {
        tags: ['Administracja'],
        summary: 'Usunięcie cudzego komentarza (WF-16)',
        description: 'Usuwa komentarz i zapisuje akcję w dzienniku moderacji (opcjonalny powód w treści żądania).',
        security: [{ BearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/AdminId' }],
        requestBody: { $ref: '#/components/requestBodies/ModerationReason' },
        responses: {
          200: { description: '{ ok: true }' },
          400: { $ref: '#/components/responses/AdminBadRequest' },
          401: { $ref: '#/components/responses/AdminUnauthorized' },
          403: { $ref: '#/components/responses/AdminForbidden' },
          404: { description: 'Komentarz nie istnieje' },
          500: { $ref: '#/components/responses/AdminServerError' },
          503: { $ref: '#/components/responses/AdminUnavailable' },
        },
      },
    },

    '/api/admin/users/{id}/status': {
      patch: {
        tags: ['Administracja'],
        summary: 'Wyciszenie / blokada / przywrócenie konta — z czasem trwania (WF-16, WF-17)',
        description:
          'Zmienia status konta. Moderator nie może moderować konta o randze Moderator/Admin. ' +
          'Status "blocked" dodatkowo blokuje logowanie w warstwie auth (na czas trwania kary). ' +
          'Pole "until" wyznacza termin wygaśnięcia kary; jego brak/null oznacza karę na stałe. ' +
          'Zmianę wykonuje funkcja bazy set_account_status tokenem moderatora (hierarchię ról egzekwuje baza); ' +
          'wygasłe kary czasowe zdejmuje automatycznie /api/cron/sweep-sanctions.',
        security: [{ BearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/AdminId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  status: { type: 'string', enum: ['active', 'muted', 'blocked'] },
                  reason: { type: 'string', nullable: true, description: 'Powód kary (zapisywany w dzienniku moderacji)' },
                  until:  { type: 'string', format: 'date-time', nullable: true, description: 'Termin wygaśnięcia kary (ISO 8601); null = na stałe' },
                },
                required: ['status'],
              },
            },
          },
        },
        responses: {
          200: { description: '{ ok: true, status }' },
          400: {
            description:
              'Nieprawidłowy status, nieprawidłowa data `until` („Nieprawidłowa data zakończenia kary"), ' +
              'nieprawidłowy identyfikator, błędny JSON albo odrzucenie zmiany przez bazę (komunikat z bazy)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Nieprawidłowy status konta' } } },
          },
          401: { $ref: '#/components/responses/AdminUnauthorized' },
          403: { description: 'Brak uprawnień (rola) albo do moderacji tego konta (hierarchia ról w bazie)' },
          500: {
            description: 'Błąd weryfikacji uprawnień albo status zapisany, ale blokada logowania w Supabase Auth nie powiodła się',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'Status zapisany, ale blokada logowania nie powiodła się' },
              },
            },
          },
          502: { $ref: '#/components/responses/DatabaseUnavailable' },
          503: { $ref: '#/components/responses/AdminUnavailable' },
        },
      },
    },

    '/api/admin/users/{id}/role': {
      patch: {
        tags: ['Administracja'],
        summary: 'Zmiana roli użytkownika (WF-18, tylko Admin)',
        description: 'Zmianę wykonuje funkcja bazy set_user_role tokenem administratora.',
        security: [{ BearerAuth: [] }],
        parameters: [{ $ref: '#/components/parameters/AdminId' }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { role: { type: 'string', enum: ['user', 'moderator', 'admin'] } },
                required: ['role'],
              },
            },
          },
        },
        responses: {
          200: { description: '{ ok: true, role }' },
          400: {
            description: 'Nieprawidłowa rola, nieprawidłowy identyfikator, błędny JSON albo odrzucenie zmiany przez bazę',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Nieprawidłowa rola' } } },
          },
          401: { $ref: '#/components/responses/AdminUnauthorized' },
          403: { description: 'Wymagana rola Admin (lub odmowa bazy)' },
          500: { $ref: '#/components/responses/AdminServerError' },
          502: { $ref: '#/components/responses/DatabaseUnavailable' },
          503: { $ref: '#/components/responses/AdminUnavailable' },
        },
      },
    },

    '/api/profiles/{id}/watchlist': {
      get: {
        tags: ['Profile'],
        summary: 'Lista do obejrzenia',
        description: 'Zwraca listę filmów oznaczonych "do obejrzenia". Wymaga, by użytkownik ustawił listę jako publiczną.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'UUID użytkownika',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Lista filmów do obejrzenia',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/ListItem' } },
              },
            },
          },
          403: {
            description: 'Lista jest prywatna',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'Lista jest prywatna' },
              },
            },
          },
          404: { description: 'Profil nie znaleziony' },
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },

    '/api/profiles/{id}/watched': {
      get: {
        tags: ['Profile'],
        summary: 'Obejrzane filmy',
        description: 'Zwraca listę filmów oznaczonych jako obejrzane. Wymaga, by użytkownik ustawił listę jako publiczną.',
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'UUID użytkownika',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'Lista obejrzanych filmów',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/WatchedItem' } },
              },
            },
          },
          403: {
            description: 'Lista jest prywatna',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'Lista jest prywatna' },
              },
            },
          },
          404: { description: 'Profil nie znaleziony' },
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },

    '/api/tmdb/{path}': {
      get: {
        tags: ['Proxy TMDB'],
        summary: 'Proxy do TMDB API',
        description:
          'Przekazuje zapytanie GET do https://api.themoviedb.org/3/{path} z kluczem API doklejonym po stronie serwera ' +
          '(parametry zapytania są przekazywane dalej). Dozwolone są wyłącznie ścieżki zaczynające się od ' +
          '/movie, /discover, /search, /trending i /genre. Dla /search i /discover serwer wymusza include_adult=false. ' +
          'Odpowiedzi OK są buforowane 10 min. Limit: 600 żądań na minutę na adres IP (liczony także dla ścieżek odrzuconych).',
        parameters: [
          {
            name: 'path', in: 'path', required: true,
            description: 'Ścieżka zasobu TMDB, np. movie/550/credits lub discover/movie',
            schema: { type: 'string', example: 'discover/movie' },
          },
        ],
        responses: {
          '2XX': { description: 'Odpowiedź TMDB (status i treść przekazywane bez zmian)' },
          403: {
            description: 'Ścieżka spoza listy dozwolonych',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Niedozwolona ścieżka TMDB' } } },
          },
          429: {
            description: 'Przekroczony limit żądań (bez nagłówka Retry-After)',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'Zbyt wiele zapytań do TMDB. Spróbuj za chwilę.' },
              },
            },
          },
          502: {
            description: 'Błąd komunikacji z TMDB',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Błąd komunikacji z TMDB' } } },
          },
          504: { $ref: '#/components/responses/TmdbTimeout' },
        },
      },
    },

    '/api/cron/sweep-sanctions': {
      get: {
        tags: ['Zadania serwera'],
        summary: 'Zdjęcie wygasłych kar czasowych',
        description:
          'Wywoływane przez Vercel Cron (vercel.json). Przywraca status „active" kontom, których kara czasowa minęła ' +
          '(kary permanentne są pomijane). Preferowana jest funkcja bazy sweep_expired_sanctions(); gdy jej brak, ' +
          'serwer wykonuje równoważny PATCH. Wymaga nagłówka Authorization: Bearer <CRON_SECRET>.',
        security: [{ CronSecret: [] }],
        responses: {
          200: {
            description: 'Czyszczenie wykonane (Cache-Control: no-store)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SweepResult' } } },
          },
          401: {
            description: 'Brak lub zły sekret',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Brak autoryzacji crona' } } },
          },
          500: {
            description: 'Czyszczenie nie powiodło się (szczegóły w polu error)',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/SweepResult' } } },
          },
          503: {
            description: 'CRON_SECRET nie jest skonfigurowany na serwerze',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: { error: 'CRON_SECRET nie jest skonfigurowany na serwerze' },
              },
            },
          },
        },
      },
    },
  },

  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT sesji Supabase (supabase.auth.getSession().data.session.access_token)',
      },
      CronSecret: {
        type: 'http',
        scheme: 'bearer',
        description: 'Wartość zmiennej CRON_SECRET (Vercel Cron wysyła ją automatycznie)',
      },
    },
    parameters: {
      AdminId: {
        name: 'id', in: 'path', required: true,
        description: 'UUID rekordu (recenzji, komentarza lub profilu). Inna wartość → 400 „Nieprawidłowy identyfikator".',
        schema: { type: 'string', format: 'uuid' },
      },
      FeedLimit: {
        name: 'limit', in: 'query',
        description: 'Liczba pozycji każdego rodzaju: dodatnia liczba całkowita, maks. 50; brak lub inna wartość → 20',
        schema: { type: 'integer', default: 20, minimum: 1, maximum: 50 },
      },
    },
    requestBodies: {
      ModerationReason: {
        required: false,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { reason: { type: 'string', nullable: true, description: 'Powód (zapisywany w dzienniku moderacji)' } },
            },
          },
        },
      },
    },
    schemas: {
      Config: {
        type: 'object',
        properties: {
          supabaseUrl:     { type: 'string', format: 'uri', description: 'URL projektu Supabase' },
          supabaseAnonKey: { type: 'string', description: 'Klucz anonimowy Supabase (publiczny)' },
          siteUrl:         { type: 'string', format: 'uri', nullable: true, description: 'Publiczny adres aplikacji dla linków w e-mailach auth; null → adres bieżącej strony' },
        },
      },
      Health: {
        type: 'object',
        properties: {
          ok:                { type: 'boolean', description: 'Ustawione SUPABASE_URL, SUPABASE_ANON_KEY i TMDB_API_KEY' },
          runtime:           { type: 'string', example: 'vercel:production', description: '"node" albo "vercel:<VERCEL_ENV>"' },
          supabaseUrlSet:    { type: 'boolean' },
          supabaseUrlValid:  { type: 'boolean', description: 'Format https://<host> bez ścieżki' },
          anonKeySet:        { type: 'boolean' },
          serviceKeySet:     { type: 'boolean' },
          keysMatchProject:  { type: 'boolean', nullable: true, description: 'false: klucze z innego projektu Supabase; null: nie da się sprawdzić' },
          envNeededCleanup: {
            type: 'object',
            description: 'true, gdy wartość w env zawierała spacje, cudzysłowy lub końcowy „/"',
            properties: {
              supabaseUrl: { type: 'boolean' },
              anonKey:     { type: 'boolean' },
              serviceKey:  { type: 'boolean' },
            },
          },
          siteUrlConfigured: { type: 'boolean' },
          cronSecretSet:     { type: 'boolean' },
          tmdbKeySet:        { type: 'boolean' },
        },
      },
      AgeRating: {
        type: 'object',
        properties: {
          minAge:        { type: 'integer', nullable: true, description: 'Minimalny wiek bez opiekuna; null — brak klasyfikacji' },
          certification: { type: 'string', nullable: true, example: '16' },
          country:       { type: 'string', nullable: true, example: 'PL' },
          label:         { type: 'string', nullable: true, example: '16+' },
        },
      },
      SweepResult: {
        type: 'object',
        properties: {
          ok:      { type: 'boolean' },
          cleared: { type: 'integer', description: 'Liczba przywróconych kont' },
          via:     { type: 'string', enum: ['rpc', 'patch'] },
          error:   { type: 'string', description: 'Tylko przy ok = false' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'Opis błędu' },
        },
      },
      AdminError: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'Opis błędu' },
          code:  { type: 'string', enum: ['token_missing', 'token_invalid', 'auth_unavailable'], description: 'Kod dla błędów sesji' },
        },
      },
      MovieSummary: {
        type: 'object',
        properties: {
          id:            { type: 'integer' },
          title:         { type: 'string' },
          original_title:{ type: 'string' },
          overview:      { type: 'string' },
          release_date:  { type: 'string', format: 'date' },
          vote_average:  { type: 'number' },
          vote_count:    { type: 'integer' },
          popularity:    { type: 'number' },
          poster_path:   { type: 'string', nullable: true },
          backdrop_path: { type: 'string', nullable: true },
        },
      },
      MoviePage: {
        type: 'object',
        properties: {
          page:          { type: 'integer' },
          total_pages:   { type: 'integer' },
          total_results: { type: 'integer' },
          results: {
            type: 'array',
            items: { $ref: '#/components/schemas/MovieSummary' },
          },
        },
      },
      MovieDetail: {
        allOf: [
          { $ref: '#/components/schemas/MovieSummary' },
          {
            type: 'object',
            properties: {
              runtime:   { type: 'integer', description: 'Czas trwania w minutach' },
              genres: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id:   { type: 'integer' },
                    name: { type: 'string' },
                  },
                },
              },
              credits: {
                type: 'object',
                properties: {
                  cast: { type: 'array', items: { type: 'object' } },
                  crew: { type: 'array', items: { type: 'object' } },
                },
              },
              videos: {
                type: 'object',
                properties: {
                  results: { type: 'array', items: { type: 'object' } },
                },
              },
            },
          },
        ],
      },
      Review: {
        type: 'object',
        properties: {
          id:              { type: 'string', format: 'uuid' },
          movie_title:     { type: 'string' },
          rating_plot:     { type: 'integer', minimum: 1, maximum: 5 },
          rating_acting:   { type: 'integer', minimum: 1, maximum: 5 },
          rating_music:    { type: 'integer', minimum: 1, maximum: 5 },
          rating_effects:  { type: 'integer', minimum: 1, maximum: 5 },
          review_text:     { type: 'string', nullable: true },
          is_spoiler:      { type: 'boolean' },
          created_at:      { type: 'string', format: 'date-time' },
          profiles: {
            type: 'object',
            properties: {
              id:           { type: 'string', format: 'uuid' },
              display_name: { type: 'string' },
              avatar_url:   { type: 'string', nullable: true },
            },
          },
        },
      },
      Profile: {
        type: 'object',
        properties: {
          id:               { type: 'string', format: 'uuid' },
          display_name:     { type: 'string' },
          avatar_url:       { type: 'string', nullable: true },
          watchlist_public: { type: 'boolean' },
          watched_public:   { type: 'boolean' },
          created_at:       { type: 'string', format: 'date-time' },
        },
      },
      ListItem: {
        type: 'object',
        properties: {
          movie_id:    { type: 'integer' },
          movie_title: { type: 'string' },
          poster_path: { type: 'string', nullable: true },
          added_at:    { type: 'string', format: 'date-time' },
        },
      },
      WatchedItem: {
        type: 'object',
        properties: {
          movie_id:    { type: 'integer' },
          movie_title: { type: 'string' },
          poster_path: { type: 'string', nullable: true },
          watched_at:  { type: 'string', format: 'date-time' },
        },
      },
    },
    responses: {
      ServerError: {
        description: 'Wewnętrzny błąd serwera (komunikat zależy od trasy; szczegóły tylko w logu serwera)',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { error: 'Wewnętrzny błąd serwera' },
          },
        },
      },
      TmdbNotFound: {
        description: 'TMDB nie zna zasobu',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Nie znaleziono zasobu w TMDB' } } },
      },
      TmdbError: {
        description: 'Błąd komunikacji z TMDB (komunikat zależy od trasy)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Błąd pobierania szczegółów filmu' } } },
      },
      TmdbTimeout: {
        description: 'TMDB nie odpowiedział w ciągu 8 s (dotyczy także zawieszonego przesyłania treści)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'TMDB nie odpowiada (timeout)' } } },
      },
      TooManyRequests: {
        description: 'Przekroczony limit zapytań na adres IP (nagłówek Retry-After: 60)',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { error: 'Zbyt wiele zapytań o klasyfikacje wiekowe. Spróbuj za chwilę.' },
          },
        },
      },
      AdminUnauthorized: {
        description: 'Brak tokenu (code: token_missing) albo token nieprawidłowy lub wygasły (code: token_invalid) — klient odświeża sesję i ponawia żądanie',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AdminError' },
            example: { error: 'Nieprawidłowy lub wygasły token', code: 'token_invalid' },
          },
        },
      },
      AdminForbidden: {
        description: 'Brak wymaganej roli',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Brak wymaganych uprawnień' } } },
      },
      AdminBadRequest: {
        description: 'Identyfikator nie jest UUID albo treść żądania nie jest poprawnym JSON-em',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Nieprawidłowy identyfikator' } } },
      },
      AdminServerError: {
        description: 'Błąd weryfikacji uprawnień albo zapytania do bazy (status błędu z Supabase lub 500)',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Błąd weryfikacji uprawnień' } } },
      },
      AdminUnavailable: {
        description:
          'Panel nieskonfigurowany (brak SUPABASE_SERVICE_ROLE_KEY) albo serwer nie może zweryfikować sesji ' +
          '(code: auth_unavailable — błąd konfiguracji lub sieci po stronie serwera, nie sesji użytkownika)',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AdminError' },
            example: { error: 'Panel administracyjny nie jest skonfigurowany (brak SUPABASE_SERVICE_ROLE_KEY).' },
          },
        },
      },
      DatabaseUnavailable: {
        description: 'Baza nie odpowiedziała albo zwróciła błąd serwera (5xx) — zmiana nie została zapisana',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { error: 'Nie udało się zmienić statusu konta' } } },
      },
    },
  },
};
