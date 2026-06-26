# Migracje bazy danych – Projekt_Filmy

Skrypty SQL rozszerzające istniejący schemat Supabase (6 tabel + RLS) o role,
moderację i wielokryterialne oceny. Uruchamiaj **w kolejności numerycznej**
w panelu Supabase → *SQL Editor* (lub przez `supabase db push`, jeśli używasz CLI).

Skrypty są **idempotentne** (`if not exists`, `create or replace`,
`drop policy if exists`), więc można je bezpiecznie uruchomić ponownie.

| Plik | Zakres | Wymaganie |
|---|---|---|
| `10_rbac.sql` | Kolumny `role`, `account_status`, `muted_until` w `profiles`; tabela `moderation_log`; funkcje pomocnicze (`current_user_role`, `is_admin`, `is_moderator`, `can_post`). | WF-15 |
| `20_rls_moderation.sql` | Polityki RLS dla moderacji (usuwanie/edycja treści przez Mod/Admin), restrykcyjna blokada publikowania dla kont wyciszonych/zablokowanych, funkcje `set_account_status` i `set_user_role` (RBAC w bazie). | WF-16, WF-17, WF-18 |
| `30_rpc_ratings.sql` | Funkcje RPC ocen: `movie_community_rating` (średnie podkategorii dla jednego filmu, WF-07) oraz `movies_by_community_rating_multi` (filtr po 4 kryteriach + ogólnej, WF-09/WF-21). | WF-07, WF-09 |
| `40_user_ranks.sql` | RPC `user_rank_info` – rola + suma pomocnych głosów dla zbioru kont (odznaki rang w UI). | WF-24 |
| `50_sanction_duration.sql` | Kary czasowe: `set_account_status` zapisuje `muted_until` także dla `blocked`; `can_post()` auto-przywraca publikowanie po wygaśnięciu kary. | WF-16, WF-17 |
| `60_self_sanction_visibility.sql` | Polityka RLS pozwalająca użytkownikowi czytać własne wpisy `moderation_log` (powód kary widoczny w banerze informacyjnym). | WF-16, WF-17 |
| `70_security_fixes.sql` | **KRYTYCZNE** — granty kolumnowe: `role`/`account_status`/`muted_until` niezapisywalne z przeglądarki (blokada eskalacji uprawnień i obejścia kar), `email` nieczytelny dla klienta (blokada wycieku), awatary tylko we własnym folderze. **Uruchom natychmiast.** | WF-15, WF-16 |

## Konfiguracja po stronie aplikacji

1. Po uruchomieniu `10_rbac.sql` nadaj pierwszemu administratorowi rolę ręcznie:

   ```sql
   update public.profiles set role = 'admin' where email = 'twoj@email.com';
   ```

2. Dodaj do `.env` klucz **service role** (Supabase → Settings → API → `service_role`),
   wymagany przez backend do operacji administracyjnych (blokada logowania w `auth.users`):

   ```
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

   Klucz ten **nigdy** nie trafia do przeglądarki – używa go wyłącznie `routes/admin.js`.

## Model uprawnień (podsumowanie)

- **Gość / User** – publikuje wyłącznie własne treści (`auth.uid() = user_id`);
  konto musi mieć status `active` (restrykcyjna polityka `*_requires_active`).
- **Moderator** – usuwa cudze recenzje/komentarze, przełącza `is_spoiler`,
  wycisza/blokuje konta o randze **niższej** (nie może tknąć Mod/Admin ani zmieniać ról).
- **Admin** – wszystko powyżej + zarządzanie rolami (`set_user_role`).
