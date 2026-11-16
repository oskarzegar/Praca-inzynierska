'use strict';

// ============================================================================
// lib/siteUrl.js  –  Publiczny adres aplikacji (linki w e-mailach Supabase)
//
// Linki z maili (potwierdzenie rejestracji, reset hasła, zmiana e-maila) muszą
// prowadzić na domenę produkcyjną, a nie na localhost. Priorytet:
//   1. SITE_URL (lub alias NEXT_PUBLIC_SITE_URL / PUBLIC_SITE_URL) — jawna konfiguracja,
//   2. VERCEL_PROJECT_PRODUCTION_URL — domena produkcyjna (tylko w deployu produkcyjnym),
//   3. null → frontend użyje window.location.origin (adres, pod którym działa strona).
// Uwaga: Supabase i tak przekieruje na swój „Site URL", jeśli podany adres nie jest
// dodany w Authentication → URL Configuration → Redirect URLs.
// ============================================================================

import { cleanEnv } from './supabaseRest.js';

export function normalizeSiteUrl(value) {
  const v = cleanEnv(value);
  if (!v) return null;
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    return `${u.protocol}//${u.host}`;          // sam origin, bez ścieżki i końcowego „/"
  } catch {
    return null;
  }
}

export function resolveSiteUrl(env = process.env) {
  const explicit = normalizeSiteUrl(env.SITE_URL || env.NEXT_PUBLIC_SITE_URL || env.PUBLIC_SITE_URL);
  if (explicit) return explicit;
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return normalizeSiteUrl(env.VERCEL_PROJECT_PRODUCTION_URL);
  }
  return null;
}
