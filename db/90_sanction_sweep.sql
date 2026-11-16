-- ============================================================================
-- 90_sanction_sweep.sql  –  Automatyczne zdejmowanie wygasłych kar (po stronie bazy)
--
-- Funkcja sweep_expired_sanctions():
--   • ustawia account_status = 'active' ORAZ muted_until = NULL dla kar czasowych,
--     których termin minął (muted_until <= now()); kary permanentne (NULL) pomija,
--   • porównuje z now() BAZY — brak problemów ze strefą czasową/zegarem serwera,
--   • zapisuje wpis w moderation_log („Kara wygasła automatycznie"),
--   • zwraca liczbę przywróconych kont.
-- Wywołują ją: backend (RPC kluczem service_role: Vercel Cron + sweep leniwy)
-- oraz — zalecane — harmonogram pg_cron co minutę (sekcja 2).
--
-- Skrypt jest idempotentny. Uruchom w Supabase → SQL Editor.
-- ============================================================================

-- ── 1. Funkcja ───────────────────────────────────────────────────────────────
create or replace function public.sweep_expired_sanctions()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with expired as (
    update public.profiles
       set account_status = 'active',
           muted_until    = null
     where account_status in ('muted', 'blocked')
       and muted_until is not null
       and muted_until <= now()
    returning id
  ), logged as (
    insert into public.moderation_log (moderator_id, target_user_id, action, reason)
    select null, id, 'status:active', 'Kara wygasła automatycznie'
      from expired
    returning 1
  )
  select count(*) into v_count from logged;

  return v_count;
end;
$$;

-- Tylko serwer (service_role) i pg_cron — nie klient przeglądarki
revoke execute on function public.sweep_expired_sanctions() from public, anon, authenticated;
grant  execute on function public.sweep_expired_sanctions() to service_role;

-- ── 2. (Zalecane) Harmonogram w bazie: co minutę ─────────────────────────────
-- Vercel Cron na planie Hobby działa maks. raz dziennie, dlatego najdokładniejsze
-- jest wywołanie w samej bazie. Wymaga rozszerzenia pg_cron:
--   Supabase → Database → Extensions → pg_cron → Enable
-- (lub: Integrations → Cron). Gdy rozszerzenie nie jest włączone, ten blok
-- niczego nie robi — możesz uruchomić skrypt ponownie po jego włączeniu.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- cron.schedule z istniejącą nazwą zadania aktualizuje je (idempotentnie)
    perform cron.schedule(
      'sweep-expired-sanctions',
      '* * * * *',
      'select public.sweep_expired_sanctions();'
    );
    raise notice 'pg_cron: zadanie sweep-expired-sanctions zaplanowane co minutę.';
  else
    raise notice 'pg_cron nie jest włączony — pomijam harmonogram (włącz rozszerzenie i uruchom skrypt ponownie).';
  end if;
end $$;

-- Jednorazowe wyczyszczenie zaległości przy uruchomieniu migracji
select public.sweep_expired_sanctions() as przywrocone_konta;
