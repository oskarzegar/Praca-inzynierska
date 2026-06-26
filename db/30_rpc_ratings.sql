-- ============================================================================
-- 30_rpc_ratings.sql  –  Agregacja ocen społeczności (WF-07, WF-09, WF-21)
--
-- Uzupełnia istniejącą funkcję movies_by_community_rating(min_rating) o:
--   • movie_community_rating(p_movie_id)       – średnie podkategorii 1 filmu (radar na karcie),
--   • movies_by_community_rating_multi(...)     – filtr po 4 podkategoriach + ogólnej.
-- ============================================================================

-- ── 1. Średnie ocen społeczności dla pojedynczego filmu (WF-07) ─────────────
-- Zwraca średnie z każdej podkategorii + ogólną + liczbę recenzji.
create or replace function public.movie_community_rating(p_movie_id integer)
returns table (
  movie_id     integer,
  avg_plot     numeric,
  avg_acting   numeric,
  avg_music    numeric,
  avg_effects  numeric,
  avg_overall  numeric,
  review_count bigint
)
language sql
stable
as $$
  select
    p_movie_id,
    round(avg(rating_plot)::numeric,    2),
    round(avg(rating_acting)::numeric,  2),
    round(avg(rating_music)::numeric,   2),
    round(avg(rating_effects)::numeric, 2),
    round(avg((rating_plot + rating_acting + rating_music + rating_effects) / 4.0)::numeric, 2),
    count(*)
  from public.reviews
  where movie_id = p_movie_id;
$$;

-- ── 2. Filtr wielokryterialny po ocenach społeczności (WF-09, WF-21) ────────
-- Każdy próg (min_*) jest opcjonalny (domyślnie 0 = bez ograniczenia).
-- sort_by ∈ {overall, plot, acting, music, effects, count}.
create or replace function public.movies_by_community_rating_multi(
  min_plot    numeric default 0,
  min_acting  numeric default 0,
  min_music   numeric default 0,
  min_effects numeric default 0,
  min_overall numeric default 0,
  sort_by     text    default 'overall'
)
returns table (
  movie_id     integer,
  movie_title  text,
  avg_plot     numeric,
  avg_acting   numeric,
  avg_music    numeric,
  avg_effects  numeric,
  avg_rating   numeric,
  review_count bigint
)
language sql
stable
as $$
  select
    movie_id,
    max(movie_title) as movie_title,
    round(avg(rating_plot)::numeric,    2) as avg_plot,
    round(avg(rating_acting)::numeric,  2) as avg_acting,
    round(avg(rating_music)::numeric,   2) as avg_music,
    round(avg(rating_effects)::numeric, 2) as avg_effects,
    round(avg((rating_plot + rating_acting + rating_music + rating_effects) / 4.0)::numeric, 2) as avg_rating,
    count(*) as review_count
  from public.reviews
  group by movie_id
  having avg(rating_plot)    >= min_plot
     and avg(rating_acting)  >= min_acting
     and avg(rating_music)   >= min_music
     and avg(rating_effects) >= min_effects
     and avg((rating_plot + rating_acting + rating_music + rating_effects) / 4.0) >= min_overall
  order by
    case sort_by
      when 'plot'    then round(avg(rating_plot)::numeric,    2)
      when 'acting'  then round(avg(rating_acting)::numeric,  2)
      when 'music'   then round(avg(rating_music)::numeric,   2)
      when 'effects' then round(avg(rating_effects)::numeric, 2)
      when 'count'   then count(*)::numeric
      else                round(avg((rating_plot + rating_acting + rating_music + rating_effects) / 4.0)::numeric, 2)
    end desc;
$$;

grant execute on function public.movie_community_rating(integer)                                        to anon, authenticated;
grant execute on function public.movies_by_community_rating_multi(numeric, numeric, numeric, numeric, numeric, text) to anon, authenticated;
