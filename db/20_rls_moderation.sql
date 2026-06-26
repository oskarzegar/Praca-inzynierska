-- ============================================================================
-- 20_rls_moderation.sql  –  Polityki RLS moderacji + funkcje sankcji (WF-16/17/18)
--
-- Zasada: polityki PERMISSIVE są łączone OR (dodają uprawnienia moderatorom),
-- polityki RESTRICTIVE są łączone AND (odbierają publikowanie kontom ukaranym).
-- Istniejące polityki właściciela (auth.uid() = user_id) pozostają nietknięte.
-- ============================================================================

-- ── 1. Moderacja recenzji: Mod/Admin usuwa i edytuje (np. is_spoiler) cudze ──
drop policy if exists reviews_mod_delete on public.reviews;
create policy reviews_mod_delete
  on public.reviews for delete
  to authenticated
  using (public.is_moderator());

drop policy if exists reviews_mod_update on public.reviews;
create policy reviews_mod_update
  on public.reviews for update
  to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());

-- ── 2. Moderacja komentarzy: Mod/Admin usuwa cudze komentarze ───────────────
drop policy if exists comments_mod_delete on public.review_comments;
create policy comments_mod_delete
  on public.review_comments for delete
  to authenticated
  using (public.is_moderator());

-- ── 3. Restrykcyjna blokada publikowania dla kont wyciszonych/zablokowanych ──
-- Diagram stanów konta: "Wyciszone → blokada dodawania treści".
-- Dotyczy treści społecznościowych (recenzje, komentarze, głosy); listy
-- watchlist/watched pozostają dostępne (organizacja prywatna, nie publikacja).
drop policy if exists reviews_insert_requires_active on public.reviews;
create policy reviews_insert_requires_active
  on public.reviews as restrictive for insert
  to authenticated
  with check (public.can_post());

drop policy if exists comments_insert_requires_active on public.review_comments;
create policy comments_insert_requires_active
  on public.review_comments as restrictive for insert
  to authenticated
  with check (public.can_post());

drop policy if exists votes_insert_requires_active on public.review_votes;
create policy votes_insert_requires_active
  on public.review_votes as restrictive for insert
  to authenticated
  with check (public.can_post());

-- ============================================================================
-- 4. Funkcje sankcji (RBAC egzekwowane w bazie, niezależnie od interfejsu)
-- ============================================================================

-- Zmiana statusu konta: wyciszenie / blokada / przywrócenie.
-- Reguły z diagramu aktywności "Zablokowanie użytkownika przez Moderatora":
--   • wymaga roli moderator/admin,
--   • moderator nie może sankcjonować konta o randze moderator/admin,
--   • admin nie może zablokować innego admina.
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
         muted_until    = case when p_status = 'muted' then p_muted_until else null end
   where id = p_target;

  insert into public.moderation_log (moderator_id, target_user_id, action, reason)
  values (auth.uid(), p_target, 'status:' || p_status, p_reason);
end;
$$;

-- Zmiana roli użytkownika – wyłącznie Admin (WF-18).
create or replace function public.set_user_role(
  p_target uuid,
  p_role   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text := public.current_user_role();
begin
  if v_actor_role <> 'admin' then
    raise exception 'Tylko administrator może zarządzać rolami' using errcode = '42501';
  end if;

  if p_role not in ('user', 'moderator', 'admin') then
    raise exception 'Nieprawidłowa rola: %', p_role using errcode = '22023';
  end if;

  -- Zabezpieczenie przed samo-degradacją ostatniego admina (uniknięcie lockoutu).
  if p_target = auth.uid() and p_role <> 'admin' then
    raise exception 'Administrator nie może odebrać roli samemu sobie' using errcode = '42501';
  end if;

  update public.profiles set role = p_role where id = p_target;

  insert into public.moderation_log (moderator_id, target_user_id, action)
  values (auth.uid(), p_target, 'role:' || p_role);
end;
$$;

grant execute on function public.set_account_status(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.set_user_role(uuid, text)                          to authenticated;
