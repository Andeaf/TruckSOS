-- ROLLBACK pentru 20261028_announcement_translations.sql — `BEGIN;` + fișier + `COMMIT;`.
-- ATENȚIE: DROP COLUMN pe announcements e sigur DOAR înainte de release-ul 1.1.0 (clientul 1.1
-- citește source_lang / source_lang_detected). După release, scoate doar tabelele și triggerul.
SET LOCAL lock_timeout = '5s';

SELECT cron.unschedule('cleanup-translation-requests-daily')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-translation-requests-daily');
DROP TABLE IF EXISTS public.translation_requests;
DROP TABLE IF EXISTS public.announcement_translations;
DROP TRIGGER IF EXISTS announcements_set_source_lang ON public.announcements;
DROP FUNCTION IF EXISTS public.set_announcement_source_lang();
-- DOAR înainte de release (vezi antetul):
ALTER TABLE public.announcements
  DROP COLUMN IF EXISTS source_lang_detected,
  DROP COLUMN IF EXISTS source_lang;

SELECT to_regclass('public.announcement_translations') IS NULL AS tabel_scos,
       NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'announcements_set_source_lang') AS trigger_scos;
