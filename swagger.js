export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'Projekt Filmy – REST API',
    version: '1.0.0',
    description:
      'Publiczne API serwisu filmowego. Umożliwia pobieranie danych o filmach (TMDB), ' +
      'recenzjach, profilach użytkowników oraz ich listach filmowych.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Lokalny serwer deweloperski' }],
  tags: [
    { name: 'Filmy',         description: 'Dane filmowe pobierane z TMDB' },
    { name: 'Profile',       description: 'Profile użytkowników i ich listy' },
    { name: 'Konfiguracja',  description: 'Publiczna konfiguracja klienta' },
    { name: 'Administracja', description: 'Panel moderacji i administracji (RBAC, wymaga roli Moderator/Admin)' },
  ],
  paths: {
    '/api/config': {
      get: {
        tags: ['Konfiguracja'],
        summary: 'Konfiguracja publiczna',
        description: 'Zwraca URL i klucz anonimowy Supabase potrzebne do inicjalizacji klienta w przeglądarce.',
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
          500: { $ref: '#/components/responses/ServerError' },
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
          500: { $ref: '#/components/responses/ServerError' },
        },
      },
    },

    '/api/movies/{id}': {
      get: {
        tags: ['Filmy'],
        summary: 'Szczegóły filmu',
        description: 'Zwraca pełne informacje o filmie: opis, obsada, zwiastuny, gatunki.',
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
          500: { $ref: '#/components/responses/ServerError' },
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
          'już obejrzane/na watchliście. Tożsamość użytkownika wynika z tokenu JWT (nie z parametru).',
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
            description: 'Brak tokenu autoryzacji',
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
          'obejrzanych jest publiczna.',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: {
            description: 'Zagregowane statystyki',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    watchedCount:        { type: 'integer' },
                    totalRuntimeMinutes: { type: 'integer' },
                    genres:  { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, count: { type: 'integer' } } } },
                    decades: { type: 'array', items: { type: 'object', properties: { decade: { type: 'integer' }, count: { type: 'integer' } } } },
                  },
                },
              },
            },
          },
          403: { description: 'Statystyki są prywatne' },
          404: { description: 'Profil nie znaleziony' },
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
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 50 } },
        ],
        responses: {
          200: { description: 'Recenzje i komentarze' },
          401: { description: 'Brak/nieprawidłowy token' },
          403: { description: 'Brak wymaganych uprawnień' },
          503: { description: 'Panel nieskonfigurowany (brak service role key)' },
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
          401: { description: 'Brak/nieprawidłowy token' },
          403: { description: 'Brak wymaganych uprawnień' },
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
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 80, maximum: 200 } },
        ],
        responses: {
          200: { description: 'Lista wpisów dziennika' },
          401: { description: 'Brak/nieprawidłowy token' },
          403: { description: 'Brak wymaganych uprawnień' },
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
          { name: 'query', in: 'query', description: 'Fraza (nazwa lub e-mail)', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 30, maximum: 100 } },
        ],
        responses: {
          200: { description: 'Lista kont' },
          401: { description: 'Brak/nieprawidłowy token' },
          403: { description: 'Brak wymaganych uprawnień' },
        },
      },
    },

    '/api/admin/reviews/{id}': {
      delete: {
        tags: ['Administracja'],
        summary: 'Usunięcie cudzej recenzji (WF-17)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Recenzja usunięta' },
          403: { description: 'Brak wymaganych uprawnień' },
          404: { description: 'Recenzja nie istnieje' },
        },
      },
    },

    '/api/admin/reviews/{id}/spoiler': {
      patch: {
        tags: ['Administracja'],
        summary: 'Wymuszenie / zdjęcie flagi spoilera (WF-11, WF-17)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', properties: { is_spoiler: { type: 'boolean' } }, required: ['is_spoiler'] },
            },
          },
        },
        responses: {
          200: { description: 'Flaga zmieniona' },
          403: { description: 'Brak wymaganych uprawnień' },
          404: { description: 'Recenzja nie istnieje' },
        },
      },
    },

    '/api/admin/comments/{id}': {
      delete: {
        tags: ['Administracja'],
        summary: 'Usunięcie cudzego komentarza (WF-16)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          200: { description: 'Komentarz usunięty' },
          403: { description: 'Brak wymaganych uprawnień' },
          404: { description: 'Komentarz nie istnieje' },
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
          'Pole "until" wyznacza termin wygaśnięcia kary; jego brak/null oznacza karę na stałe.',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
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
          200: { description: 'Status zmieniony' },
          400: { description: 'Nieprawidłowy status' },
          403: { description: 'Brak uprawnień do moderacji tego konta' },
        },
      },
    },

    '/api/admin/users/{id}/role': {
      patch: {
        tags: ['Administracja'],
        summary: 'Zmiana roli użytkownika (WF-18, tylko Admin)',
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
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
          200: { description: 'Rola zmieniona' },
          403: { description: 'Wymagana rola Admin' },
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
  },

  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT sesji Supabase (supabase.auth.getSession().data.session.access_token)',
      },
    },
    schemas: {
      Config: {
        type: 'object',
        properties: {
          supabaseUrl:     { type: 'string', format: 'uri', description: 'URL projektu Supabase' },
          supabaseAnonKey: { type: 'string', description: 'Klucz anonimowy Supabase (publiczny)' },
        },
      },
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', description: 'Opis błędu' },
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
              casts: {
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
        description: 'Wewnętrzny błąd serwera',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
            example: { error: 'Wewnętrzny błąd serwera' },
          },
        },
      },
    },
  },
};
