'use strict';

// ============================================================================
// charts.js  –  Cienka warstwa nad Chart.js (ładowana przez ESM)
//
// Centralizuje konfigurację wykresów: motyw (kolory z CSS custom properties),
// budowę wykresu radarowego i bąbelkowego. Reszta aplikacji nie importuje
// Chart.js bezpośrednio — korzysta z renderRadarChart / renderBubbleChart.
// (Separation of Concerns: logika danych w stats.js / movieRadar.js,
//  logika rysowania tutaj.)
// ============================================================================

import Chart from 'https://esm.sh/chart.js@4/auto';

// Odczytuje kolor z aktywnego motywu (zmienne CSS reagują na data-theme)
function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Paleta pochodna od motywu — spójna z resztą interfejsu i reagująca na jasny/ciemny
export function chartTheme() {
  return {
    primary:   cssVar('--primary', '#db0028'),
    community: cssVar('--community-color', '#38bdf8'),
    rating:    cssVar('--rating-color', '#fab700'),
    text:      cssVar('--on-surface-variant', '#6f6f71'),
    grid:      cssVar('--white-20', 'rgba(255,255,255,0.2)'),
    surface:   cssVar('--surface', '#111111'),
  };
}

// Konwersja HEX → rgba (Chart.js potrzebuje półprzezroczystych wypełnień)
function withAlpha(color, alpha) {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Przechowuje instancje wykresów per-canvas, by przy ponownym renderze
// (np. przełączenie motywu) niszczyć poprzedni i nie nakładać ich na siebie
const instances = new WeakMap();

function mount(canvas, config) {
  const prev = instances.get(canvas);
  if (prev) prev.destroy();
  const chart = new Chart(canvas, config);
  instances.set(canvas, chart);
  return chart;
}

// ── Wykres radarowy ──────────────────────────────────────────────────────────
// Używany dla preferencji gatunkowych (WF-14) oraz ocen podkategorii filmu (WF-07).
export function renderRadarChart(canvas, { labels, values, label, max = 5, color }) {
  const t    = chartTheme();
  const main = color || t.community;

  return mount(canvas, {
    type: 'radar',
    data: {
      labels,
      datasets: [{
        label,
        data: values,
        backgroundColor: withAlpha(main, 0.2),
        borderColor: main,
        borderWidth: 2,
        pointBackgroundColor: main,
        pointBorderColor: t.surface,
        pointRadius: 4,
        pointHoverRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${c.formattedValue}` } },
      },
      scales: {
        r: {
          min: 0,
          max,
          ticks: { stepSize: max <= 5 ? 1 : undefined, color: t.text, backdropColor: 'transparent', font: { size: 11 } },
          grid: { color: t.grid },
          angleLines: { color: t.grid },
          pointLabels: { color: t.text, font: { size: 13, family: 'Plus Jakarta Sans' } },
        },
      },
    },
  });
}

// ── Wykres bąbelkowy ─────────────────────────────────────────────────────────
// Rozkład dekad (WF-14): oś X = dekada, rozmiar i wysokość bąbla = liczba filmów.
export function renderBubbleChart(canvas, { points, xLabel = 'Dekada' }) {
  const t = chartTheme();
  const maxCount = Math.max(1, ...points.map(p => p.count));

  const data = points.map(p => ({
    x: p.decade,
    y: p.count,
    r: 8 + (p.count / maxCount) * 26,        // promień skalowany do najliczniejszej dekady
  }));

  return mount(canvas, {
    type: 'bubble',
    data: {
      datasets: [{
        label: 'Filmy',
        data,
        backgroundColor: withAlpha(t.primary, 0.45),
        borderColor: t.primary,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => `Lata ${c.raw.x}: ${c.raw.y} ${c.raw.y === 1 ? 'film' : 'filmów'}`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: xLabel, color: t.text },
          ticks: { color: t.text, stepSize: 10, callback: (v) => `${v}.` },
          grid: { color: t.grid },
        },
        y: {
          title: { display: true, text: 'Liczba filmów', color: t.text },
          beginAtZero: true,
          ticks: { color: t.text, precision: 0 },
          grid: { color: t.grid },
        },
      },
    },
  });
}
