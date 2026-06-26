-- ============================================================================
-- 70_security_fixes.sql  –  KRYTYCZNE poprawki bezpieczeństwa (uruchom natychmiast)
--
-- RLS ogranicza WIERSZE, ale domyślne granty Supabase dają rolom anon/authenticated
-- uprawnienia na WSZYSTKICH KOLUMNACH tabel w public. Bez REVOKE/grantów kolumnowych
-- użytkownik omija cały RBAC bezpośrednim zapisem kolumny. Potwierdzone pentestem:
--   • PATCH profiles {role:'admin'}            → eskalacja do admina,
--   • PATCH profiles {account_status:'active'} → zdjęcie sobie kary,
--   • GET profiles?select=email (anon)         → wyciek wszystkich e-maili,
--   • upload do avatars/{cudze_id}/avatar       → nadpisanie cudzego awatara.
-- ============================================================================

-- ── 1. Eskalacja uprawnień / obejście kar: profiles UPDATE tylko bezpiecznych kolumn ──
-- role / account_status / muted_until zapisują WYŁĄCZNIE funkcje SECURITY DEFINER
-- (set_user_role, set_account_status) należące do roli postgres — nie klient.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, avatar_url, watchlist_public, watched_public)
  on public.profiles to authenticated;

-- Dodatkowo: polityka UPDATE z WITH CHECK (wcześniej był tylko USING)
drop policy if exists "Aktualizacja własnego profilu" on public.profiles;
create policy "Aktualizacja własnego profilu"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ── 2. Wyciek e-maili: profiles SELECT wszystkich kolumn POZA email ──────────
-- Panel admina czyta email kluczem service_role (omija granty), więc nie ucierpi.
revoke select on public.profiles from anon, authenticated;
grant select (id, display_name, avatar_url, role, account_status, muted_until,
              watchlist_public, watched_public, created_at)
  on public.profiles to anon, authenticated;

-- ── 3. Awatary: zapis/edycja/usuwanie tylko we WŁASNYM folderze {user_id}/... ──
-- Ścieżka uploadu w aplikacji to `${user.id}/avatar`, więc foldername[1] = auth.uid().
drop policy if exists "Avatar insert" on storage.objects;
drop policy if exists "Avatar update" on storage.objects;
drop policy if exists "Avatar delete" on storage.objects;

create policy "Avatar insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatar update" on storage.objects
  for update to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "Avatar delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Uwaga: jeśli na Twojej instancji upload awatara przestanie działać (starsze
-- środowiska Storage, gdzie auth.uid() bywało NULL), zweryfikuj kontekst i w razie
-- potrzeby wróć do warunku samego bucket_id — ale na aktualnym Supabase wzorzec
-- `(storage.foldername(name))[1] = auth.uid()::text` jest standardem.
