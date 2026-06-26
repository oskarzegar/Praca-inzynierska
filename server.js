import 'dotenv/config';
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import swaggerUi from 'swagger-ui-express';
import tmdbRouter  from './routes/tmdb.js';
import apiRouter   from './routes/api.js';
import adminRouter from './routes/admin.js';
import { swaggerSpec } from './swagger.js';
import { startSanctionSweep } from './lib/sanctionSweep.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Za reverse-proxy (Render/Heroku itp.) req.ip ma być realnym adresem klienta
// z X-Forwarded-For, a nie adresem proxy — ważne dla rate limitera proxy TMDB.
app.set('trust proxy', 1);

// ── Nagłówki bezpieczeństwa ─────────────────────────────────────────────────
// Lekki zestaw bez dodatkowych zależności (helmet wymagałby konfiguracji CSP pod
// CDN-y: esm.sh, fonts, image.tmdb.org, YouTube). Te nagłówki są bezpieczne dla
// architektury aplikacji i nie psują żadnej funkcjonalności.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  next();
});

app.use(express.json());

// Proxy do TMDB API – klucz API nigdy nie trafia do przeglądarki
app.use('/api/tmdb', tmdbRouter);

// Dokumentacja Swagger UI
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Projekt Filmy – API Docs',
}));

// Specyfikacja OpenAPI jako JSON (dla Postman/narzędzi zewnętrznych)
app.get('/api/openapi.json', (_req, res) => res.json(swaggerSpec));

// Panel administratora / moderacji – RBAC egzekwowane po stronie serwera
app.use('/api/admin', adminRouter);

// REST API
app.use('/api', apiRouter);

// Strona szczegółów filmu: /film/tytul-rok-id
app.get('/film/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'details.html'));
});

// Lista filmów według gatunku: /category/thriller-53
app.get('/category/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'movieList.html'));
});

// Panel administratora / moderacji
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serwowanie plików frontendu
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serwer działa na http://localhost:${PORT}`);
  console.log(`Dokumentacja API: http://localhost:${PORT}/api/docs`);
  // Cykliczne czyszczenie wygasłych kar (account_status → 'active' w bazie)
  startSanctionSweep();
});
