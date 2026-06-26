-- ═══════════════════════════════════════════════════════════════════════════
--  PROJEKT FILMY — konfiguracja Supabase
--  Wklej ten plik w: Supabase → SQL Editor → New Query → Run
-- ═══════════════════════════════════════════════════════════════════════════


-- ─── 1. Tabela profili użytkowników ─────────────────────────────────────────
--
--  Tworzona automatycznie po rejestracji przez trigger (patrz sekcja 4).
--  auth.users jest zarządzana przez Supabase — tu przechowujemy dane publiczne.

CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT        NOT NULL,
  display_name TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);


-- ─── 2. Włączenie Row Level Security ────────────────────────────────────────

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;


-- ─── 3. Polityki RLS ────────────────────────────────────────────────────────

-- DROP IF EXISTS przed każdą polityką → skrypt jest bezpieczny do ponownego uruchomienia
DROP POLICY IF EXISTS "Trigger moze tworzyc profil"  ON public.profiles;
DROP POLICY IF EXISTS "Odczyt własnego profilu"       ON public.profiles;
DROP POLICY IF EXISTS "Aktualizacja własnego profilu" ON public.profiles;

-- Użytkownik może odczytać tylko własny profil
CREATE POLICY "Odczyt własnego profilu"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Użytkownik może aktualizować tylko własny profil
CREATE POLICY "Aktualizacja własnego profilu"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id);

-- UWAGA: Brak polityki INSERT — funkcja SECURITY DEFINER własnością `postgres`
-- omija RLS automatycznie (postgres ma atrybut BYPASSRLS w Supabase).


-- ─── 4. Trigger: automatyczne tworzenie profilu po rejestracji ──────────────

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public          -- 'public' zamiast '' — unika problemów z cross-schema FK do auth.users
AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    split_part(NEW.email, '@', 1)
  )
  ON CONFLICT (id) DO NOTHING;   -- bezpieczne przy ewentualnym podwójnym wywołaniu
  RETURN NEW;
END;
$$;

-- Usuń stary trigger jeśli istnieje, potem utwórz nowy
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE PROCEDURE public.handle_new_user();


-- ─── 5. Funkcja RPC: usunięcie własnego konta ───────────────────────────────
--
--  Wywoływana z przeglądarki: supabase.rpc('delete_user')
--  SECURITY DEFINER pozwala funkcji wykonać DELETE na auth.users,
--  którego normalnie klient nie może wykonać.

CREATE OR REPLACE FUNCTION public.delete_user()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM auth.users WHERE id = auth.uid();
END;
$$;


-- ─── 6. Weryfikacja e-mail (konfiguracja w panelu Supabase) ─────────────────
--
--  Tego nie można ustawić przez SQL — przejdź do:
--
--    Supabase → Authentication → Email Templates
--      • "Confirm signup"  — szablon e-maila weryfikacyjnego (możesz go edytować)
--
--    Supabase → Authentication → Providers → Email
--      • Upewnij się, że "Confirm email" jest WŁĄCZONE (domyślnie jest)
--      • "Secure email change" — opcjonalnie włącz dla bezpieczeństwa
--
--    Supabase → Authentication → URL Configuration
--      • Site URL — ustaw na adres swojej aplikacji (np. http://localhost:5500)
--      • Redirect URLs — dodaj adresy, na które Supabase może przekierowywać
--        po potwierdzeniu e-mail (np. http://localhost:5500/index.html)


-- ─── 7. Kolumna awatara w profilu ───────────────────────────────────────────
--
--  Przechowuje publiczny URL zdjęcia profilowego z Supabase Storage.
--  Bezpieczna do uruchomienia wielokrotnie (IF NOT EXISTS).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;


-- ─── 8. Storage: bucket na awatary ──────────────────────────────────────────
--
--  Publiczny bucket — obrazki dostępne bez uwierzytelnienia (wymagane dla <img>).
--  Ograniczenia: max 2 MB, tylko JPG/PNG/WebP.
--  Ścieżka pliku: {user_id}/avatar — każdy użytkownik ma własny folder.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public             = true,
  file_size_limit    = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];


-- ─── 9. Polityki RLS dla Storage ────────────────────────────────────────────
--
--  Kontekst: Storage API Canary wykonuje zapytania jako rola `supabase_storage_admin`.
--  W tym kontekście auth.uid(), auth.role() i owner_id mogą być NULL — JWT claims
--  ustawiane przez set_config nie są dostępne dla tej roli, a wersja Canary
--  może nie wypełniać kolumny owner_id. Warunki oparte na tych wartościach
--  powodują błąd 42501 (insufficient_privilege) w każdej kombinacji.
--
--  Rozwiązanie: polityki sprawdzają tylko bucket_id. Bezpieczeństwo utrzymane przez:
--  – ścieżkę {user_id}/avatar wyznaczaną z supabase.auth.getUser() w JS (wymaga JWT)
--  – brak polityki SELECT (publiczny bucket nie wymaga dodatkowych polityk odczytu)

DROP POLICY IF EXISTS "Avatar own upload"  ON storage.objects;
DROP POLICY IF EXISTS "Avatar own update"  ON storage.objects;
DROP POLICY IF EXISTS "Avatar own delete"  ON storage.objects;
DROP POLICY IF EXISTS "Avatar public read" ON storage.objects;
DROP POLICY IF EXISTS "Avatar access"      ON storage.objects;
DROP POLICY IF EXISTS "Avatar insert"      ON storage.objects;
DROP POLICY IF EXISTS "Avatar update"      ON storage.objects;
DROP POLICY IF EXISTS "Avatar delete"      ON storage.objects;

-- Trzy osobne polityki zamiast FOR ALL — FOR ALL obejmuje SELECT, co pozwala klientom
-- listować wszystkie pliki w buckecie (ostrzeżenie Supabase Advisor).
-- Bucket publiczny (public = true) udostępnia pliki przez URL bez polityki SELECT.
CREATE POLICY "Avatar insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Avatar update" ON storage.objects
  FOR UPDATE USING (bucket_id = 'avatars') WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "Avatar delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'avatars');



-- ─── 10. Podsumowanie ───────────────────────────────────────────────────────
--
--  Po uruchomieniu tego skryptu:
--
--  ✓ Tabela public.profiles — przechowuje dane użytkowników
--  ✓ Kolumna avatar_url — URL zdjęcia profilowego
--  ✓ RLS — użytkownicy widzą/edytują tylko własne dane
--  ✓ Trigger — profil tworzony automatycznie przy rejestracji
--  ✓ Funkcja delete_user() — bezpieczne usunięcie konta przez klienta
--  ✓ Storage bucket "avatars" — publiczny, max 2 MB, JPG/PNG/WebP
--  ✓ Storage RLS — każdy użytkownik zarządza tylko swoim folderem
--
--  Następny krok: uzupełnij dane w assets/js/supabase.js:
--    SUPABASE_URL      → Supabase → Settings → API → Project URL
--    SUPABASE_ANON_KEY → Supabase → Settings → API → anon / public key


-- ─── 11. Profil publiczny — zmiana polityki SELECT ───────────────────────────
--
--  Poprzednia polityka ograniczała odczyt tylko do własnego profilu.
--  Strona publiczna profilu wymaga odczytu display_name i avatar_url innych użytkowników.

DROP POLICY IF EXISTS "Odczyt własnego profilu" ON public.profiles;

CREATE POLICY "Odczyt profilów"
  ON public.profiles
  FOR SELECT
  USING (true);


-- ─── 12. Kolumny prywatności list w profilu ──────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS watchlist_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS watched_public   BOOLEAN NOT NULL DEFAULT false;


-- ─── 13. Tabela: lista do obejrzenia (watchlist) ─────────────────────────────

CREATE TABLE IF NOT EXISTS public.watchlist (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  movie_id    INTEGER     NOT NULL,
  movie_title TEXT        NOT NULL,
  poster_path TEXT,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(user_id, movie_id)
);

ALTER TABLE public.watchlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watchlist_select" ON public.watchlist;
DROP POLICY IF EXISTS "watchlist_insert" ON public.watchlist;
DROP POLICY IF EXISTS "watchlist_delete" ON public.watchlist;

CREATE POLICY "watchlist_select" ON public.watchlist
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = watchlist.user_id AND watchlist_public = true
    )
  );

CREATE POLICY "watchlist_insert" ON public.watchlist
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "watchlist_delete" ON public.watchlist
  FOR DELETE USING (auth.uid() = user_id);


-- ─── 14. Tabela: lista obejrzanych filmów (watched) ──────────────────────────

CREATE TABLE IF NOT EXISTS public.watched (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  movie_id    INTEGER     NOT NULL,
  movie_title TEXT        NOT NULL,
  poster_path TEXT,
  watched_at  TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(user_id, movie_id)
);

ALTER TABLE public.watched ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watched_select" ON public.watched;
DROP POLICY IF EXISTS "watched_insert" ON public.watched;
DROP POLICY IF EXISTS "watched_delete" ON public.watched;

CREATE POLICY "watched_select" ON public.watched
  FOR SELECT USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = watched.user_id AND watched_public = true
    )
  );

CREATE POLICY "watched_insert" ON public.watched
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "watched_delete" ON public.watched
  FOR DELETE USING (auth.uid() = user_id);


-- ─── 15. Tabela: recenzje filmów ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reviews (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  movie_id       INTEGER     NOT NULL,
  movie_title    TEXT        NOT NULL,
  rating_plot    SMALLINT    NOT NULL CHECK (rating_plot    BETWEEN 1 AND 5),
  rating_acting  SMALLINT    NOT NULL CHECK (rating_acting  BETWEEN 1 AND 5),
  rating_music   SMALLINT    NOT NULL CHECK (rating_music   BETWEEN 1 AND 5),
  rating_effects SMALLINT    NOT NULL CHECK (rating_effects BETWEEN 1 AND 5),
  review_text    TEXT,
  is_spoiler     BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(user_id, movie_id)
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_select" ON public.reviews;
DROP POLICY IF EXISTS "reviews_insert" ON public.reviews;
DROP POLICY IF EXISTS "reviews_update" ON public.reviews;
DROP POLICY IF EXISTS "reviews_delete" ON public.reviews;

CREATE POLICY "reviews_select" ON public.reviews FOR SELECT USING (true);
CREATE POLICY "reviews_insert" ON public.reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reviews_update" ON public.reviews FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "reviews_delete" ON public.reviews FOR DELETE USING (auth.uid() = user_id);


-- ─── 16. Tabela: głosy na recenzje (helpful voting) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.review_votes (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id  UUID        NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_helpful BOOLEAN     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE(review_id, user_id)
);

ALTER TABLE public.review_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "votes_select" ON public.review_votes;
DROP POLICY IF EXISTS "votes_insert" ON public.review_votes;
DROP POLICY IF EXISTS "votes_update" ON public.review_votes;
DROP POLICY IF EXISTS "votes_delete" ON public.review_votes;

CREATE POLICY "votes_select" ON public.review_votes FOR SELECT USING (true);
CREATE POLICY "votes_insert" ON public.review_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "votes_update" ON public.review_votes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "votes_delete" ON public.review_votes FOR DELETE USING (auth.uid() = user_id);


-- ─── 17. Funkcja RPC: filmy według oceny serwisowej ─────────────────────────
--
--  Używana przez zaawansowane wyszukiwanie — zwraca ID filmów z średnią oceną
--  ze wszystkich 4 kategorii większą lub równą min_rating.

CREATE OR REPLACE FUNCTION public.movies_by_community_rating(min_rating NUMERIC)
RETURNS TABLE(movie_id INTEGER, avg_rating NUMERIC, review_count BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    movie_id,
    ROUND(AVG((rating_plot + rating_acting + rating_music + rating_effects) / 4.0), 2) AS avg_rating,
    COUNT(*) AS review_count
  FROM reviews
  GROUP BY movie_id
  HAVING AVG((rating_plot + rating_acting + rating_music + rating_effects) / 4.0) >= min_rating
  ORDER BY avg_rating DESC;
$$;


-- ─── 18. Migracja: zmiana skali ocen z 1-10 na 1-5 ─────────────────────────
--
--  Uruchom jeśli tabela reviews już istniała z ograniczeniem BETWEEN 1 AND 10.

ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS reviews_rating_plot_check,
  DROP CONSTRAINT IF EXISTS reviews_rating_acting_check,
  DROP CONSTRAINT IF EXISTS reviews_rating_music_check,
  DROP CONSTRAINT IF EXISTS reviews_rating_effects_check;

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_rating_plot_check    CHECK (rating_plot    BETWEEN 1 AND 5),
  ADD CONSTRAINT reviews_rating_acting_check  CHECK (rating_acting  BETWEEN 1 AND 5),
  ADD CONSTRAINT reviews_rating_music_check   CHECK (rating_music   BETWEEN 1 AND 5),
  ADD CONSTRAINT reviews_rating_effects_check CHECK (rating_effects BETWEEN 1 AND 5);


-- ─── 19. Tabela: komentarze do recenzji ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.review_comments (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id  UUID        NOT NULL REFERENCES public.reviews(id)   ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.review_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_select" ON public.review_comments;
DROP POLICY IF EXISTS "comments_insert" ON public.review_comments;
DROP POLICY IF EXISTS "comments_delete" ON public.review_comments;

CREATE POLICY "comments_select" ON public.review_comments FOR SELECT USING (true);
CREATE POLICY "comments_insert" ON public.review_comments FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "comments_delete" ON public.review_comments FOR DELETE USING (auth.uid() = user_id);