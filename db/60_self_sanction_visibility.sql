-- ============================================================================
-- 60_self_sanction_visibility.sql  –  Wgląd użytkownika we własną karę
--
-- Domyślnie dziennik moderacji widzą tylko moderatorzy (policy z 10_rbac.sql).
-- Aby ukarany użytkownik mógł zobaczyć POWÓD swojej kary, dodajemy politykę
-- pozwalającą czytać wpisy, których jest celem (target_user_id = auth.uid()).
-- Status i termin (account_status, muted_until) są już czytelne z profiles.
-- ============================================================================

drop policy if exists moderation_log_select_own on public.moderation_log;
create policy moderation_log_select_own
  on public.moderation_log
  for select
  to authenticated
  using (target_user_id = auth.uid());
