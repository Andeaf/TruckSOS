-- ─────────────────────────────────────────────────────────────────────────────
-- 29 oct 2026 — PROPRIUL PROFIL PRIN RPC (PLAN_1.1, §6 pasul 1 pentru `profiles`)
--
-- Cum se rulează: Studio → `BEGIN;` + fișier + `COMMIT;`. Rollback: supabase/rollback/20261029_get_own_profile.sql
-- Ordinea migrărilor 1.1: 20261025 (A1) → 20261026 (B1) → 20261027 (G1) → 20261028 (H1) → acest fișier.
--
-- DE CE: clientul 1.1 citește propriul profil prin `get_own_profile()` în loc de `select('*')`
-- pe `profiles`. Așa, în 1.2 (când 1.0.x nu mai e în uz) se poate face
-- `REVOKE SELECT (phone, latitude, longitude) ON profiles FROM authenticated` fără să atingă
-- 1.1: rândul propriu vine prin funcția DEFINER, cu toate coloanele. Clienții 1.0.x nu sunt
-- afectați (continuă cu select-ul lor); 1.1 cade pe select până la rularea acestei migrări.
-- ─────────────────────────────────────────────────────────────────────────────
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.get_own_profile()
RETURNS SETOF public.profiles
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.* FROM public.profiles p WHERE p.id = auth.uid();
$$;
REVOKE EXECUTE ON FUNCTION public.get_own_profile() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_own_profile() TO authenticated;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.get_own_profile()', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_own_profile()', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_own_profile: grant greșit';
  END IF;
END $$;

SELECT 'get_own_profile' AS functie,
       has_function_privilege('authenticated', 'public.get_own_profile()', 'EXECUTE') AS authenticated_exec,
       has_function_privilege('anon', 'public.get_own_profile()', 'EXECUTE') AS anon_exec;
