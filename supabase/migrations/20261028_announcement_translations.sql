-- ─────────────────────────────────────────────────────────────────────────────
-- 28 oct 2026 — TRADUCEREA DESCRIERII ANUNȚULUI (PLAN_1.1, Faza H1)
--
-- Cum se rulează: Studio → SQL Editor, `BEGIN;` + fișier + `COMMIT;` (repetiție cu ROLLBACK).
-- Rollback real: supabase/rollback/20261028_announcement_translations.sql
-- Ordinea migrărilor 1.1: 20261025 (A1) → 20261026 (B1) → 20261027 (G1) → 20261028 (acest fișier).
-- După rulare: `supabase functions deploy translate-announcement` + secretul GOOGLE_TRANSLATE_API_KEY.
--
-- DOAR SERVER, compatibilă cu 1.0.x: două coloane noi cu DEFAULT pe `announcements` (apar în
-- `select('*')`, ignorate de clienții vechi; INSERT-urile lor nu le ating), un trigger BEFORE
-- INSERT care doar completează NEW (în bloc EXCEPTION — nu poate bloca publicarea unui anunț),
-- două tabele noi pe care clientul nu le scrie niciodată.
--
-- CE SE SCHIMBĂ
--   1. announcements.source_lang text — limba PRESUPUSĂ la publicare (= profiles.lang al autorului),
--      corectată de detecția reală la prima cerere de traducere; announcements.source_lang_detected
--      boolean NOT NULL DEFAULT false — butonul „Tradu” se ascunde DOAR când e true și limba = cea a
--      aplicației (review B-3: presupunerea singură ar ascunde greșit butonul).
--   2. announcement_translations (anunț × limbă → text tradus, limba-sursă detectată, furnizor).
--      RLS: SELECT pentru conturile logate DOAR dacă văd anunțul (EXISTS pe announcements, deci RLS-ul
--      anunțului se aplică și traducerii — review A-2). Scrie doar Edge Function-ul (service_role).
--   3. translation_requests (user × moment) — rate limit în Edge Function (20/oră, 100/zi), service_role only.
--   4. Convenția A1: RLS + REVOKE anon/authenticated explicit + GRANT service_role, pe ambele tabele.
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';

-- ── 1. announcements: limba sursă (presupusă) + flag de detecție ────────────
ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS source_lang text,
  ADD COLUMN IF NOT EXISTS source_lang_detected boolean NOT NULL DEFAULT false;

-- Trigger INVOKER: nu scrie în alt tabel, doar completează NEW. user_lang() e INVOKER și
-- citește profiles.lang (authenticated are SELECT pe profiles). Orice eroare = fără
-- presupunere, dar anunțul se publică (regula zero).
CREATE OR REPLACE FUNCTION public.set_announcement_source_lang()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.source_lang IS NULL THEN
    NEW.source_lang := user_lang(NEW.driver_id);
  END IF;
  NEW.source_lang_detected := false;          -- detecția reală vine doar din Edge Function
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'set_announcement_source_lang: %', SQLERRM;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS announcements_set_source_lang ON public.announcements;
CREATE TRIGGER announcements_set_source_lang
  BEFORE INSERT ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.set_announcement_source_lang();

-- ── 2. Cache-ul traducerilor ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.announcement_translations (
  announcement_id uuid        NOT NULL REFERENCES public.announcements(id) ON DELETE CASCADE,
  lang            text        NOT NULL CHECK (lang IN ('ro', 'en', 'de')),
  source_lang     text        NOT NULL,
  text            text        NOT NULL,
  provider        text        NOT NULL DEFAULT 'google-translate-v2',
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, lang)
);
ALTER TABLE public.announcement_translations ENABLE ROW LEVEL SECURITY;

-- Vezi traducerea doar dacă vezi anunțul (RLS-ul lui se aplică în subinterogare).
DROP POLICY IF EXISTS announcement_translations_select_visible ON public.announcement_translations;
CREATE POLICY announcement_translations_select_visible
  ON public.announcement_translations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.announcements a WHERE a.id = announcement_id));

REVOKE ALL    ON public.announcement_translations FROM anon;
REVOKE ALL    ON public.announcement_translations FROM authenticated;
GRANT  SELECT ON public.announcement_translations TO authenticated;   -- exact comanda cu politică
GRANT  ALL    ON public.announcement_translations TO service_role;

-- ── 3. Rate limit (doar serverul) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.translation_requests (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_translation_requests_user_time
  ON public.translation_requests(user_id, requested_at DESC);
ALTER TABLE public.translation_requests ENABLE ROW LEVEL SECURITY;
-- Fără politici: nimic pentru client.
REVOKE ALL ON public.translation_requests FROM anon;
REVOKE ALL ON public.translation_requests FROM authenticated;
GRANT  ALL ON public.translation_requests TO service_role;

-- Retenție 7 zile (rate limit-ul se uită la ultima oră / ultimele 24 h).
SELECT cron.schedule(
  'cleanup-translation-requests-daily',
  '57 3 * * *',
  $JOB$ DELETE FROM public.translation_requests WHERE requested_at < now() - interval '7 days'; $JOB$
);

-- ── 4. Verificare ────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_bad text := '';
BEGIN
  IF (SELECT count(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'announcements'
         AND column_name IN ('source_lang', 'source_lang_detected')) <> 2 THEN
    v_bad := v_bad || ' [coloanele noi lipsesc]';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'announcements_set_source_lang' AND tgenabled <> 'D') THEN
    v_bad := v_bad || ' [triggerul source_lang lipsește]';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.announcement_translations'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.translation_requests'::regclass) THEN
    v_bad := v_bad || ' [RLS lipsă]';
  END IF;
  IF has_table_privilege('anon', 'public.announcement_translations', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('anon', 'public.translation_requests', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.translation_requests', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'public.announcement_translations', 'INSERT, UPDATE, DELETE')
     OR NOT has_table_privilege('authenticated', 'public.announcement_translations', 'SELECT') THEN
    v_bad := v_bad || ' [grant-uri greșite]';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'announcement_translations') <> 1
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'translation_requests') <> 0 THEN
    v_bad := v_bad || ' [politici neașteptate]';
  END IF;
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'cleanup-translation-requests-daily') <> 1 THEN
    v_bad := v_bad || ' [jobul cron lipsește]';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'H1 verificare EȘUATĂ:%', v_bad;
  END IF;
  RAISE NOTICE 'H1 verificare: PASS';
END $$;

SELECT 1 AS nr, 'announcements.source_lang + source_lang_detected' AS verificare,
       CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS stare, string_agg(column_name, ', ') AS detaliu
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'announcements' AND column_name IN ('source_lang', 'source_lang_detected')
UNION ALL
SELECT 2, 'announcement_translations: RLS + SELECT doar authenticated + service_role ALL',
       CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.announcement_translations'::regclass)
                 AND has_table_privilege('authenticated', 'public.announcement_translations', 'SELECT')
                 AND NOT has_table_privilege('authenticated', 'public.announcement_translations', 'INSERT')
                 AND NOT has_table_privilege('anon', 'public.announcement_translations', 'SELECT')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 3, 'translation_requests: RLS, nimic pentru client',
       CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.translation_requests'::regclass)
                 AND NOT has_table_privilege('authenticated', 'public.translation_requests', 'SELECT')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 4, 'trigger announcements_set_source_lang activ',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'announcements_set_source_lang' AND tgenabled <> 'D') THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 5, 'job cron cleanup-translation-requests-daily',
       CASE WHEN (SELECT count(*) FROM cron.job WHERE jobname = 'cleanup-translation-requests-daily') = 1 THEN 'PASS' ELSE 'FAIL' END, ''
ORDER BY nr;
