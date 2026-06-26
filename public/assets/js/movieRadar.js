'use strict';

// ============================================================================
// movieRadar.js  –  Wykres radarowy ocen społeczności na stronie filmu (WF-07)
//
// Pobiera średnie ocen w podkategoriach (fabuła/aktorstwo/muzyka/efekty) przez
// RPC movie_community_rating i renderuje radar wraz z wypisaną średnią ogólną.
// ============================================================================

import { supabase } from './supabase.js';
import { renderRadarChart, chartTheme } from './charts.js';

const SUBCATS = [
  { key: 'avg_plot',    label: 'Fabuła'    },
  { key: 'avg_acting',  label: 'Aktorstwo' },
  { key: 'avg_music',   label: 'Muzyka'    },
  { key: 'avg_effects', label: 'Efekty'    },
];

function fmt(v) {
  return v == null ? '–' : Number(v).toFixed(1);
}

export async function initMovieRadar(movieId, mountEl) {
  if (!mountEl) return;

  const { data, error } = await supabase.rpc('movie_community_rating', { p_movie_id: Number(movieId) });
  const row = Array.isArray(data) ? data[0] : data;

  // Brak recenzji → agregat zwraca wiersz z review_count = 0; sekcja się nie pokazuje
  if (error || !row || Number(row.review_count) === 0) { mountEl.innerHTML = ''; return; }

  const count   = Number(row.review_count);
  const overall = fmt(row.avg_overall);

  mountEl.innerHTML = `
    <div class="title-wrapper"><h3 class="title-large">Oceny społeczności</h3></div>
    <div class="movie-radar-wrap">
      <div class="movie-radar-canvas"><canvas id="movie-radar"></canvas></div>
      <div class="movie-radar-summary">
        <div class="radar-overall">
          <span class="radar-overall-value">${overall}</span><span class="radar-overall-scale">/5</span>
        </div>
        <p class="radar-overall-label">Średnia ogólna z ${count} ${count === 1 ? 'recenzji' : 'recenzji'}</p>
        <ul class="radar-breakdown">
          ${SUBCATS.map(s => `
            <li class="radar-breakdown-item">
              <span class="radar-cat-label">${s.label}</span>
              <span class="radar-cat-value">${fmt(row[s.key])}</span>
            </li>`).join('')}
        </ul>
      </div>
    </div>`;

  renderRadarChart(mountEl.querySelector('#movie-radar'), {
    labels: SUBCATS.map(s => s.label),
    values: SUBCATS.map(s => Number(row[s.key]) || 0),
    label: 'Średnia ocena',
    max: 5,
    color: chartTheme().community,
  });
}
