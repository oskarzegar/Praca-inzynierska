import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import tmdbRouter  from './routes/tmdb.js';
import apiRouter   from './routes/api.js';
import adminRouter from './routes/admin.js';
import cronRouter  from './routes/cron.js';
import { swaggerSpec } from './swagger.js';
import { startSanctionSweep } from './lib/sanctionSweep.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');

// Lekki zestaw nagłówków bezpieczeństwa bez dodatkowych zależności (helmet wymagałby
// konfiguracji CSP pod CDN-y: esm.sh, fonts, image.tmdb.org, YouTube).
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options':        'SAMEORIGIN',
  'Referrer-Policy':        'strict-origin-when-cross-origin',
  'X-DNS-Prefetch-Control': 'off',
};

// „Ładne" adresy podstron → pliki HTML z public/
const PAGES = {
  '/film/:slug':     'details.html',     // szczegóły filmu: /film/tytul-rok-id
  '/category/:slug': 'movieList.html',   // lista gatunku: /category/thriller-53
  '/admin':          'admin.html',       // panel administratora / moderacji
};

const app = express();

// Za reverse-proxy req.ip ma być realnym adresem klienta z X-Forwarded-For,
// a nie adresem proxy — ważne dla limiterów zapytań.
app.set('trust proxy', 1);

app.use((_req, res, next) => {
  res.set(SECURITY_HEADERS);
  next();
});

app.use(express.json());

// Proxy do TMDB API – klucz API nigdy nie trafia do przeglądarki
app.use('/api/tmdb', tmdbRouter);

// Dokumentacja Swagger UI + specyfikacja OpenAPI jako JSON (Postman/narzędzia zewnętrzne)
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Projekt Filmy – API Docs',
}));
app.get('/api/openapi.json', (_req, res) => res.json(swaggerSpec));

// Panel administratora / moderacji – RBAC egzekwowane po stronie serwera
app.use('/api/admin', adminRouter);

// Zadania cykliczne (Vercel Cron, chronione CRON_SECRET) – np. zdejmowanie wygasłych kar
app.use('/api/cron', cronRouter);

// REST API
app.use('/api', apiRouter);

for (const [route, file] of Object.entries(PAGES)) {
  app.get(route, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, file)));
}

// Pozostałe pliki frontendu
app.use(express.static(PUBLIC_DIR));

// Błędy przekazane do next(err): błędny JSON w body, błędne kodowanie „%" w ścieżce,
// nieobsłużony wyjątek trasy. Klient dostaje JSON bez śladu stosu i ścieżek plików;
// szczegóły błędów serwera (5xx) trafiają tylko do logu.
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[server] Nieobsłużony błąd:', err);
  res.status(status).json({ error: status >= 500 ? 'Wewnętrzny błąd serwera' : 'Nieprawidłowe żądanie' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
  console.log(`Dokumentacja API: http://localhost:${PORT}/api/docs`);
  // Cykliczne czyszczenie wygasłych kar (account_status → 'active', muted_until → NULL).
  // Na Vercel pomijane — tam działa Vercel Cron (/api/cron/sweep-sanctions) i sweep leniwy.
  startSanctionSweep();
});
