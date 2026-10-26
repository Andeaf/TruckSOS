-- ROLLBACK pentru 20261029_get_own_profile.sql — clientul 1.1 cade automat pe `select('*')` (PGRST202).
DROP FUNCTION IF EXISTS public.get_own_profile();
SELECT to_regprocedure('public.get_own_profile()') IS NULL AS functie_scoasa;
