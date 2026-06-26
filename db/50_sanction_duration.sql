-- ============================================================================
-- 50_sanction_duration.sql  –  Czasowe kary (wyciszenie/blokada na czas)
--
-- Uogólnia kolumnę profiles.muted_until na „termin wygaśnięcia sankcji" dla
-- obu statusów (muted i blocked). NULL = kara permanentna (do ręcznego zdjęcia).
--   • set_account_status zapisuje muted_until także dla 'blocked',
--   • can_post() automatycznie przywraca prawo publikowania po wygaśnięciu kary.
-- (Blokadę logowania w warstwie auth z czasem zdejmuje Supabase – ban_duration.)
-- ============================================================================

create or replace function public.can_post()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select account_status = 'active'
        or (account_status in ('muted', 'blocked')
            and muted_until is not null
            and muted_until <= now())
    from public.profiles
    where id = auth.uid()
  ), false);
$$;

create or replace function public.set_account_status(
  p_target      uuid,
  p_status      text,
  p_reason      text        default null,
  p_muted_until timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role  text := public.current_user_role();
  v_target_role text;
begin
  if v_actor_role not in ('moderator', 'admin') then
    raise exception 'Brak uprawnień do moderacji' using errcode = '42501';
  end if;

  if p_status not in ('active', 'muted', 'blocked') then
    raise exception 'Nieprawidłowy status konta: %', p_status using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_target;
  if v_target_role is null then
    raise exception 'Użytkownik nie istnieje' using errcode = 'P0002';
  end if;

  if v_actor_role = 'moderator' and v_target_role in ('moderator', 'admin') then
    raise exception 'Moderator nie może moderować konta o randze % ', v_target_role using errcode = '42501';
  end if;

  if v_actor_role = 'admin' and v_target_role = 'admin' and p_target <> auth.uid() then
    raise exception 'Administrator nie może blokować innego administratora' using errcode = '42501';
  end if;

  update public.profiles
     set account_status = p_status,
         -- termin wygaśnięcia zapisujemy dla kary czasowej (mute i block); NULL = permanentna
         muted_until    = case when p_status in ('muted', 'blocked') then p_muted_until else null end
   where id = p_target;

  insert into public.moderation_log (moderator_id, target_user_id, action, reason)
  values (auth.uid(), p_target, 'status:' || p_status, p_reason);
end;
$$;

grant execute on function public.can_post()                                          to authenticated;
grant execute on function public.set_account_status(uuid, text, text, timestamptz)   to authenticated;
