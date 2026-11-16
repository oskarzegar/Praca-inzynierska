// ============================================================================
// lib/ttlCache.js  –  Cache w pamięci z czasem życia wpisów i limitem rozmiaru
//
// Wygasły wpis jest usuwany przy odczycie. Po osiągnięciu limitu set() usuwa
// najstarszy WSTAWIONY wpis (Map zachowuje kolejność wstawiania) — także wtedy,
// gdy nadpisuje istniejący klucz (zachowanie zamierzone).
// ============================================================================

export function createTtlCache({ ttlMs, maxEntries }) {
  const entries = new Map();   // klucz → { value, exp }

  return {
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.exp <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },

    set(key, value, ttl = ttlMs) {
      if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
      entries.set(key, { value, exp: Date.now() + ttl });
    },
  };
}
