'use strict';

// ============================================================================
// utils.js  –  Wspólne narzędzia warstwy frontendu
//
// Centralizuje ochronę przed XSS (wymaganie niefunkcjonalne z dokumentacji:
// „sanityzacja i escaping treści recenzji"). Wszystkie dane pochodzące od
// użytkownika (nazwy, tytuły, treść recenzji/komentarzy) muszą przejść przez
// escapeHtml/escapeAttr zanim trafią do innerHTML.
// ============================================================================

// Escapuje tekst do bezpiecznego wstawienia między znaczniki HTML.
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Escapuje tekst do bezpiecznego wstawienia w wartość atrybutu (np. title z cudzysłowami).
// Zachowuje znaki nowej linii (czytelne w natywnym tooltipie title).
export function escapeAttr(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
