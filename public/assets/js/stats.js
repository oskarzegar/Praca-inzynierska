'use strict';

// ============================================================================
// stats.js  –  Rozbudowane statystyki profilu (WF-14)
//
// Pobiera zagregowane dane z /api/profiles/:id/stats (czas oglądania, gatunki,
// dekady) i renderuje: kafelki podsumowania, radar preferencji gatunkowych
// oraz wykres bąbelkowy rozkładu dekad. Rysowanie deleguje do charts.js.
// ============================================================================

import { supabase } from './supabase.js';
import { renderRadarChart, renderBubbleChart } from './charts.js';

// Formatuje minuty na czytelny czas: "2 dni 3 godz." / "128 godz. 30 min"
function formatRuntime(totalMin) {
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 48) {
    const days = Math.floor(h / 24);
    const remH = h % 24;
    return `${days} ${days === 1 ? 'dzień' : 'dni'}${remH ? ` ${remH} godz.` : ''}`;
  }
  return `${h} godz.${m ? ` ${m} min` : ''}`;
}

// Renderuje sekcję statystyk do podanego kontenera. Cicho się ukrywa, gdy brak
// dostępu (lista prywatna) lub brak obejrzanych filmów.
export async function initStats(profileId, mountEl) {
  if (!mountEl) return;

  const { data: { session } } = await supabase.auth.getSession();
  const headers = session ? { Authorization: `Bearer ${session.access_token}` } : {};

  let stats;
  try {
    const res = await fetch(`/api/profiles/${profileId}/stats`, { headers });
    if (!res.ok) { mountEl.innerHTML = ''; return; }   // 403 (prywatne) / 404 — chowamy sekcję
    stats = await res.json();
  } catch {
    mountEl.innerHTML = '';
    return;
  }

  if (!stats || stats.watchedCount === 0) { mountEl.innerHTML = ''; return; }

  const avgLen = stats.watchedCount ? Math.round(stats.totalRuntimeMinutes / stats.watchedCount) : 0;
  const topGenres = stats.genres.slice(0, 8);
  const hasRadar  = topGenres.length >= 3;
  const hasBubble = stats.decades.length >= 1;

  mountEl.innerHTML = `
    <div class="title-wrapper"><h3 class="title-large">Statystyki oglądania</h3></div>
    <div class="stats-summary">
      <div class="stats-card">
        <span class="stats-card-value">${formatRuntime(stats.totalRuntimeMinutes)}</span>
        <span class="stats-card-label">Łączny czas oglądania</span>
      </div>
      <div class="stats-card">
        <span class="stats-card-value">${stats.watchedCount}</span>
        <span class="stats-card-label">Obejrzane filmy</span>
      </div>
      <div class="stats-card">
        <span class="stats-card-value">${avgLen} min</span>
        <span class="stats-card-label">Średnia długość</span>
      </div>
      <div class="stats-card">
        <span class="stats-card-value">${topGenres[0]?.name ?? '—'}</span>
        <span class="stats-card-label">Ulubiony gatunek</span>
      </div>
    </div>
    <div class="stats-charts">
      <div class="stats-chart-card" id="stats-genre-card">
        <h4 class="stats-chart-title">Preferencje gatunkowe</h4>
        <div class="stats-canvas-wrap"><canvas id="stats-genre-radar"></canvas></div>
      </div>
      <div class="stats-chart-card" id="stats-decade-card">
        <h4 class="stats-chart-title">Z jakich dekad pochodzą filmy</h4>
        <div class="stats-canvas-wrap"><canvas id="stats-decade-bubble"></canvas></div>
      </div>
    </div>
    ${stats.incomplete ? `<p class="stats-note">Część danych z TMDB była niedostępna — policzono ${stats.moviesCounted} z ${stats.watchedCount} filmów, więc statystyki mogą być zaniżone.</p>` : ''}`;

  if (hasRadar) {
    const values = topGenres.map(g => g.count);
    renderRadarChart(mountEl.querySelector('#stats-genre-radar'), {
      labels: topGenres.map(g => g.name),
      values,
      label: 'Obejrzane filmy',
      max: Math.max(...values),
    });
  } else {
    mountEl.querySelector('#stats-genre-card').innerHTML =
      '<h4 class="stats-chart-title">Preferencje gatunkowe</h4><p class="no-results">Za mało danych — obejrzyj filmy z różnych gatunków.</p>';
  }

  if (hasBubble) {
    renderBubbleChart(mountEl.querySelector('#stats-decade-bubble'), { points: stats.decades });
  } else {
    mountEl.querySelector('#stats-decade-card').innerHTML =
      '<h4 class="stats-chart-title">Z jakich dekad pochodzą filmy</h4><p class="no-results">Za mało danych.</p>';
  }
}
