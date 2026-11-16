-- ============================================================================
-- 80_age_restrictions.sql  –  Data urodzenia użytkownika (filtr treści wg wieku)
--
-- PRYWATNOŚĆ: tabela profiles jest czytelna publicznie (polityka SELECT using(true))
-- i chroniona grantami KOLUMNOWYMI (70_security_fixes.sql). Nowa kolumna birth_date
-- celowo NIE dostaje grantu SELECT/UPDATE dla anon/authenticated — inaczej każdy
-- mógłby odczytać daty urodzenia wszystkich użytkowników. Dostęp wyłącznie do
-- WŁASNEJ daty przez funkcje SECURITY DEFINER:
--   • get_my_birth_date()            – odczyt (auth.uid()),
--   • set_my_birth_date(p_birth_date) – zapis z walidacją zakresu.
-- Rejestracja: trigger handle_new_user przepisuje datę z raw_user_meta_data
-- (supabase.auth.signUp({ options: { data: { birth_date } } })).
--
-- Skrypt jest idempotentny. Uruchom w Supabase → SQL Editor.
-- ============================================================================

-- ── 0. Warunek wstępny: granty kolumnowe z 70_security_fixes.sql ─────────────
-- Grant SELECT na całą tabelę objąłby też nową kolumnę — przerwij ZANIM cokolwiek zmienisz.
do $$
begin
  if has_table_privilege('anon', 'public.profiles', 'SELECT')
     or has_table_privilege('authenticated', 'public.profiles', 'SELECT') then
    raise exception 'anon/authenticated mają SELECT na całej tabeli profiles — uruchom najpierw db/70_security_fixes.sql.';
  end if;
end $$;

-- ── 1. Kolumna ───────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists birth_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_birth_date_range_check'
  ) then
    alter table public.profiles
      add constraint profiles_birth_date_range_check
      check (birth_date is null or birth_date >= date '1900-01-01');
  end if;
end $$;

-- Upewnij się, że klient NIE ma dostępu kolumnowego do birth_date
-- (granty z 70_security_fixes.sql wymieniają kolumny jawnie — ta nie jest na liście).
revoke select (birth_date), update (birth_date), insert (birth_date)
  on public.profiles from anon, authenticated;

-- ── 2. Odczyt własnej daty urodzenia ─────────────────────────────────────────
create or replace function public.get_my_birth_date()
returns date
language sql
stable
security definer
set search_path = public
as $$
  select birth_date from public.profiles where id = auth.uid();
$$;

-- ── 3. Zapis własnej daty urodzenia (z walidacją) ────────────────────────────
create or replace function public.set_my_birth_date(p_birth_date date)
returns date
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Wymagane zalogowanie' using errcode = '42501';
  end if;
  if p_birth_date is null then
    raise exception 'Podaj datę urodzenia' using errcode = '22023';
  end if;
  if p_birth_date < date '1900-01-01' or p_birth_date > current_date then
    raise exception 'Nieprawidłowa data urodzenia' using errcode = '22023';
  end if;

  update public.profiles set birth_date = p_birth_date where id = v_uid;
  return p_birth_date;
end;
$$;

revoke execute on function public.get_my_birth_date()       from public, anon;
revoke execute on function public.set_my_birth_date(date)   from public, anon;
grant  execute on function public.get_my_birth_date()       to authenticated;
grant  execute on function public.set_my_birth_date(date)   to authenticated;

-- ── 4. Trigger rejestracji: data urodzenia z metadanych signUp ───────────────
-- Zachowuje dotychczasowe zachowanie (email + display_name z części lokalnej e-maila).
-- Niepoprawna/brakująca data NIE blokuje rejestracji — zostaje NULL (bezpieczny
-- domyślny filtr: blokada treści 18+ do czasu uzupełnienia daty w ustawieniach).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_birth date;
begin
  begin
    v_birth := nullif(new.raw_user_meta_data ->> 'birth_date', '')::date;
  exception when others then
    v_birth := null;
  end;
  if v_birth is not null and (v_birth < date '1900-01-01' or v_birth > current_date) then
    v_birth := null;
  end if;

  insert into public.profiles (id, email, display_name, birth_date)
  values (new.id, new.email, split_part(new.email, '@', 1), v_birth)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Trigger on_auth_user_created (supabase_setup.sql) wskazuje już na tę funkcję —
-- create or replace podmienia jej treść bez ponownego tworzenia triggera.

-- ── 5. Bezpiecznik prywatności ───────────────────────────────────────────────
-- Jeśli 70_security_fixes.sql NIE został uruchomiony, anon/authenticated mają
-- grant SELECT na CAŁĄ tabelę (obejmuje każdą nową kolumnę) — wtedy daty urodzenia
-- byłyby publiczne. Cały skrypt zostaje wycofany z czytelnym komunikatem.
do $$
begin
  if has_column_privilege('anon', 'public.profiles', 'birth_date', 'SELECT')
     or has_column_privilege('authenticated', 'public.profiles', 'birth_date', 'SELECT') then
    raise exception 'birth_date byłaby czytelna publicznie — uruchom najpierw db/70_security_fixes.sql, potem ten skrypt ponownie.';
  end if;
end $$;
