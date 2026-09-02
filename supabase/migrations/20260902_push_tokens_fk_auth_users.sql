-- ─────────────────────────────────────────────────────────────────────────────
-- 2 sept 2026 — FIX CRITIC: „nu primește nimeni notificări"
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
--
-- SIMPTOM (ziua lansării): 211 profiluri active, dar DOAR 35 de conturi cu rând în
-- `push_tokens`. Push-ul în sine era sănătos — pg_net 25/25 răspunsuri 200 și 19/19
-- receipt-uri Expo „ok" (deci FCM/APNs chiar livrau); pur și simplu nu exista cui
-- să i se trimită.
--
-- CAUZA: aplicația cere tokenul imediat ce APARE SESIUNEA (src/hooks/use-auth.tsx,
-- efect pe `session.user.id`), dar rândul din `profiles` se creează abia la alegerea
-- rolului (`createProfile`). FK-ul `push_tokens.user_id → profiles(id)` n-avea ce
-- referenția → INSERT-ul din `claim_push_token` pica cu 23503, pe care PostgREST îl
-- întoarce ca HTTP 409 (nu doar la „unique"!). În 24h: 231 de apeluri, 166 × 409 și
-- 168 de erori `push_tokens_user_id_fkey`. Clientul doar loga un warning, fără retry.
-- Cei 35 cu token = exact cei care au repornit aplicația (la pornire la rece profilul
-- există deja → 204).
--
-- FIXUL: FK-ul se mută pe `auth.users(id)`. Identitatea există din secunda
-- înregistrării, deci tokenul se poate lega ORICÂND, indiferent de ordinea ecranelor.
-- E sigur pentru că:
--   • `notify_push` (20260818) refuză să trimită fără `profiles.push_enabled IS TRUE`
--     → un token fără profil e complet inert, nu poate genera notificări greșite;
--   • ON DELETE CASCADE pe auth.users e mai STRICT decât înainte: `delete-account`
--     șterge userul din auth și lasă profilul piatră-funerară, deci cascada veche pe
--     `profiles` NU se declanșa niciodată. Rămân și ștergerile explicite din
--     `purge_user_data` (20260716) și `admin_ban_user` (20260722).
--
-- EFECT: repară TOATE instalările existente fără update în magazine — la următoarea
-- pornire a aplicației efectul din use-auth reîncearcă înregistrarea și reușește.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Igienă: tokenuri rămase de la conturi șterse din auth ────────────────
-- Nu pot primi nimic (userul auth nu mai există) și oricum le-ar respinge noul FK.
DELETE FROM push_tokens pt
 WHERE NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = pt.user_id);

-- ── 2. FK: profiles(id) → auth.users(id) ────────────────────────────────────
ALTER TABLE push_tokens DROP CONSTRAINT IF EXISTS push_tokens_user_id_fkey;
ALTER TABLE push_tokens
  ADD CONSTRAINT push_tokens_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- ── 3. Verificare (RULATĂ 2 sept 19:55 → refera=auth.users, on_delete=c) ──────
-- Aștept: refera='auth.users', on_delete='c'.
SELECT
  c.confrelid::regclass::text                                            AS refera,
  c.confdeltype                                                          AS on_delete,
  (SELECT count(*) FROM push_tokens)                                     AS tokenuri,
  (SELECT count(DISTINCT user_id) FROM push_tokens)                      AS conturi_cu_token,
  (SELECT count(*) FROM profiles WHERE deleted_at IS NULL)               AS profiluri_active,
  (SELECT count(*) FROM auth.users u
     LEFT JOIN profiles p ON p.id = u.id WHERE p.id IS NULL)             AS auth_fara_profil
  FROM pg_constraint c
 WHERE c.conrelid = 'push_tokens'::regclass
   AND c.conname  = 'push_tokens_user_id_fkey';
