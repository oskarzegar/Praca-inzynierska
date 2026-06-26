-- ============================================================================
-- 40_user_ranks.sql  –  Rangi użytkowników (WF-24) do wyświetlania w UI
--
-- Zwraca dla zbioru kont: rolę uprawnień (user/moderator/admin) oraz sumę
-- otrzymanych pomocnych głosów (podstawa rangi Recenzent → … → Filmoznawca).
-- Używane na profilach i przy recenzjach, by pokazać odznaki rang.
-- ============================================================================

create or replace function public.user_rank_info(p_user_ids uuid[])
returns table (
  user_id       uuid,
  role          text,
  helpful_votes bigint
)
language sql
stable
as $$
  select
    p.id,
    p.role,
    coalesce(hv.cnt, 0) as helpful_votes
  from public.profiles p
  left join (
    select r.user_id, count(*) as cnt
    from public.review_votes v
    join public.reviews r on r.id = v.review_id
    where v.is_helpful
    group by r.user_id
  ) hv on hv.user_id = p.id
  where p.id = any (p_user_ids);
$$;

grant execute on function public.user_rank_info(uuid[]) to anon, authenticated;
