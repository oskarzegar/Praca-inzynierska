-- ============================================================================
-- 10_rbac.sql  –  Kontrola dostępu oparta na rolach (WF-15)
-- Rozszerza tabelę profiles o role i status konta oraz dodaje dziennik moderacji.
-- ============================================================================

-- ── 1. Kolumny ról i statusu konta w profiles ───────────────────────────────
alter table public.profiles
  add column if not exists role           text        not null default 'user',
  add column if not exists account_status text        not null default 'active',
  add column if not exists muted_until    timestamptz;

-- Ograniczenia wartości (dodawane warunkowo, by skrypt był idempotentny)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles
      add constraint profiles_role_check check (role in ('user', 'moderator', 'admin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_status_check') then
    alter table public.profiles
      add constraint profiles_status_check check (account_status in ('active', 'muted', 'blocked'));
  end if;
end $$;

-- ── 2. Dziennik moderacji (diagram sekwencji: "INSERT wpis dziennika moderacji") ──
create table if not exists public.moderation_log (
  id              uuid primary key default gen_random_uuid(),
  moderator_id    uuid references public.profiles(id) on delete set null,
  target_user_id  uuid references public.profiles(id) on delete cascade,
  target_review_id uuid,                       -- bez FK: recenzja mogła już zostać usunięta
  action          text not null,               -- np. 'status:muted', 'role:moderator', 'review:delete'
  reason          text,
  created_at      timestamptz not null default now()
);

create index if not exists moderation_log_target_idx  on public.moderation_log(target_user_id);
create index if not exists moderation_log_created_idx on public.moderation_log(created_at desc);

-- ── 3. Funkcje pomocnicze RBAC ──────────────────────────────────────────────
-- SECURITY DEFINER + odczyt po auth.uid() pozwala używać ich w politykach RLS
-- na tabeli profiles bez nieskończonej rekurencji polityk.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'user');
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() = 'admin';
$$;

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_user_role() in ('moderator', 'admin');
$$;

-- Czy zalogowany użytkownik może publikować treści?
-- Konto 'active' lub 'muted' z wygasłym czasowym wyciszeniem.
create or replace function public.can_post()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select account_status = 'active'
        or (account_status = 'muted' and muted_until is not null and muted_until <= now())
    from public.profiles
    where id = auth.uid()
  ), false);
$$;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin()          to authenticated;
grant execute on function public.is_moderator()      to authenticated;
grant execute on function public.can_post()          to authenticated;

-- ── 4. RLS dla dziennika moderacji ──────────────────────────────────────────
alter table public.moderation_log enable row level security;

drop policy if exists moderation_log_select_mod on public.moderation_log;
create policy moderation_log_select_mod
  on public.moderation_log
  for select
  to authenticated
  using (public.is_moderator());
-- Zapis do dziennika wyłącznie przez funkcje SECURITY DEFINER (patrz 20_rls_moderation.sql)
