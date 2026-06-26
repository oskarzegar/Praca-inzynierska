"use strict";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Konfiguracja (URL + klucz anon) pobierana z backendu. Bez niej klient nie ma
// jak działać — przerywamy świadomie, ale z czytelnym komunikatem zamiast kryptycznego
// błędu destrukturyzacji propagującego się do wszystkich modułów.
let supabaseUrl, supabaseAnonKey;
try {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error(`/api/config zwróciło ${res.status}`);
  ({ supabaseUrl, supabaseAnonKey } = await res.json());
} catch (err) {
  console.error("Nie udało się wczytać konfiguracji Supabase:", err.message);
  throw err;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
