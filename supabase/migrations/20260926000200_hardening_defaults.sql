-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 26 sept 2026 (b) — Întărire fără efect asupra aplicației
-- Rulează cu `npx supabase db query --linked -f <fișier>`. Idempotentă.
-- Completează 20260926_security_hardening.sql. ZERO efect asupra funcționării:
-- nicio limită nu e sub ce permite clientul, nicio funcție existentă nu-și
-- schimbă drepturile sau comportamentul.
--
--   1. Bucket-ul `photos` primește o limită de mărime per fișier. Până acum nu
--      avea niciuna: orice cont putea urca fișiere de orice mărime în folderele
--      proprii (cost + spațiu). Clientul limitează video la 50 MB (storage.ts
--      MAX_VIDEO_SIZE) și fișierele la 10 MB; pozele sunt comprimate sub 1 MB.
--      Limita de aici e 55 MB — peste orice trimite aplicația. Fără allowlist de
--      tipuri MIME: atașamentul „fișier" din chat acceptă orice document.
--   2. Cele 4 RPC-uri SECURITY DEFINER fără `SET search_path` îl primesc. Fără el,
--      o funcție DEFINER rezolvă numele de tabele prin search_path-ul apelantului
--      (tiparul clasic de deturnare); toate 4 folosesc doar tabele din public +
--      auth.uid(), deci comportamentul rămâne identic.
--   3. CAUZA-RĂDĂCINĂ a problemei din 26 sept: Supabase dă implicit EXECUTE lui
--      anon/authenticated pe ORICE funcție nouă din public (ALTER DEFAULT
--      PRIVILEGES). De acum, funcțiile noi NU mai primesc nimic automat.
--      Nu atinge nicio funcție existentă (default privileges = doar obiecte
--      viitoare). CREATE OR REPLACE păstrează drepturile existente.
--
--      ⚠ REGULĂ NOUĂ pentru orice migrare viitoare: un RPC apelat din aplicație
--      trebuie să aibă explicit
--          GRANT EXECUTE ON FUNCTION fn(args) TO authenticated;
--      altfel aplicația primește „permission denied". Checklist-ul
--      _TEST_security_checklist.sql prinde și lipsa, și surplusul.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Limita bucket-ului ────────────────────────────────────────────────────
UPDATE storage.buckets
   SET file_size_limit = 55 * 1024 * 1024
 WHERE id = 'photos'
   AND (file_size_limit IS NULL OR file_size_limit <> 55 * 1024 * 1024);

-- ── 2. search_path pe RPC-urile DEFINER care nu-l aveau ─────────────────────
ALTER FUNCTION accept_application(uuid)   SET search_path = public;
ALTER FUNCTION reject_application(uuid)   SET search_path = public;
ALTER FUNCTION dismiss_application(uuid)  SET search_path = public;
ALTER FUNCTION withdraw_application(uuid) SET search_path = public;

-- ── 3. Funcțiile viitoare nu mai sunt apelabile implicit prin API ───────────
-- Subtilitate Postgres (verificată în probă pe 26 sept): intrarea PER-SCHEMĂ din
-- pg_default_acl se COMBINĂ cu implicitul global, iar implicitul global al
-- Postgres dă EXECUTE lui PUBLIC pe orice funcție. O revocare doar per-schemă
-- nu scoate nimic. E nevoie de o intrare GLOBALĂ pentru postgres fără PUBLIC:
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- …și de scoaterea anon/authenticated din intrarea per-schemă `public`
-- (service_role rămâne: Edge Functions / cron).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
-- Plasă de siguranță: o extensie instalată în viitor (CREATE EXTENSION rulează ca
-- postgres, funcțiile ei ajung în `extensions`) trebuie să rămână apelabilă din
-- RLS și din funcțiile care rulează ca utilizatorul (ex. unaccent din căutări).
-- Nu afectează extensiile deja instalate.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA extensions
  GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

-- ── 4. Verificare ────────────────────────────────────────────────────────────
-- Așteptat: bucket_limit_mb = 55; definer_fara_search_path = 0;
-- default_acl GLOBAL = {postgres=X/postgres} (fără „=X" = PUBLIC);
-- default_acl public fără anon/authenticated; default_acl extensions cu toate 3.
SELECT 'bucket_limit_mb' AS ce, (file_size_limit / 1048576)::text AS valoare FROM storage.buckets WHERE id = 'photos'
UNION ALL
SELECT 'definer_fara_search_path', count(*)::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND p.prosecdef
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search_path=%')
UNION ALL
SELECT 'default_acl_functii_postgres ' || coalesce((SELECT nspname FROM pg_namespace WHERE oid = d.defaclnamespace), 'GLOBAL'),
       d.defaclacl::text
  FROM pg_default_acl d
 WHERE d.defaclobjtype = 'f' AND pg_get_userbyid(d.defaclrole) = 'postgres';
