-- Rollback pentru 20261110000200_public_reports (faza 8): rapoartele publice (source = public) sunt ȘTERSE (reporter_id redevine NOT NULL), coloanele noi, tabelul app.report_ip_events, cron-ul și RPC-ul dispar; on_report_notify și admin_list_reports revin la textele anterioare.
-- Generat de .claude/wip/faza8/gen-sql.mjs; funcțiile restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 8: 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('public.admin_health()') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 200: 20261111000300_health (faza 9.4) e aplicata - ruleaza intai rollback-ul ei';
  END IF;
END $$;

SELECT cron.unschedule('cleanup-report-ip-events-hourly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-report-ip-events-hourly');
DROP FUNCTION IF EXISTS public.insert_public_report(text, text, uuid, text, text, text, text);
DROP TABLE IF EXISTS app.report_ip_events;

-- Rapoartele publice nu pot rămâne sub NOT NULL; se șterg (dovezile lor se pierd — export înainte: SELECT * FROM public.reports WHERE source = 'public').
DELETE FROM public.reports WHERE reporter_id IS NULL;
-- Rapoartele cu motivele noi nu pot rămâne sub CHECK-ul vechi (sunt doar publice sau din 1.1 — motivele noi apar doar pe pagina publică).
DELETE FROM public.reports WHERE reason IN ('illegal', 'rights', 'personal_data', 'sexual_violent');
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reporter_email_length;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_reporter_lang_check;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_public_has_email;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_source_check;
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_announcement_id_fkey;
DROP INDEX IF EXISTS public.idx_reports_announcement;
DROP INDEX IF EXISTS public.uq_reports_reporter_announcement;
ALTER TABLE public.reports
  DROP COLUMN IF EXISTS reporter_email,
  DROP COLUMN IF EXISTS reporter_lang,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS announcement_id;
ALTER TABLE public.reports ALTER COLUMN reporter_id SET NOT NULL;
ALTER TABLE public.reports DROP CONSTRAINT reports_reason_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reason_check
  CHECK (reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'inappropriate'::text, 'scam'::text, 'other'::text]));

-- public.reports_snapshot_from_source: textul din baseline 20261031000300
CREATE OR REPLACE FUNCTION public.reports_snapshot_from_source()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_content text;
  v_image   text;
  v_sender  uuid;
BEGIN
  IF NEW.message_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.message_table = 'messages' THEN
    SELECT content, image_path, sender_id INTO v_content, v_image, v_sender
      FROM messages WHERE id = NEW.message_id AND deleted_at IS NULL;
  ELSIF NEW.message_table = 'channel_messages' THEN
    SELECT content, image_path, sender_id INTO v_content, v_image, v_sender
      FROM channel_messages WHERE id = NEW.message_id AND deleted_at IS NULL;
  END IF;

  IF FOUND THEN
    NEW.content_snapshot    := v_content;
    NEW.image_path_snapshot := v_image;
    NEW.reported_user_id    := v_sender;
  END IF;
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION public.reports_snapshot_from_source() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reports_snapshot_from_source() TO service_role;

-- public.on_report_notify: textul din 20261102000200 (faza 3.3)
CREATE OR REPLACE FUNCTION public.on_report_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_admin record;
  v_body  text;
BEGIN
  v_body := left(COALESCE(NEW.reason, '') || CASE WHEN NULLIF(btrim(NEW.details), '') IS NOT NULL THEN ': ' || btrim(NEW.details) ELSE '' END, 140);
  FOR v_admin IN
    SELECT p.id, COALESCE(p.lang, 'ro') AS lang
      FROM app.profiles p
     WHERE p.role = 'admin' AND p.deleted_at IS NULL AND p.id <> NEW.reporter_id
  LOOP
    PERFORM public.notify_push(
      v_admin.id,
      public.push_text(v_admin.lang, 'report_title'),
      v_body,
      jsonb_build_object('type', 'report', 'id', NEW.id)
    );
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'on_report_notify: % (raport %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.on_report_notify() FROM PUBLIC, anon, authenticated;

-- public.admin_list_reports: textul din 20261101000100 (faza 4)
CREATE OR REPLACE FUNCTION public.admin_list_reports(p_status text DEFAULT 'pending'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT r.id, r.reason, r.details, r.content_snapshot, r.image_path_snapshot,
           r.message_id, r.message_table, r.status, r.created_at,
           r.listing_id, l.title AS listing_title,
           r.reporter_id, rep.full_name AS reporter_name,
           r.reported_user_id, tgt.full_name AS reported_name, tgt.banned_at AS reported_banned_at
    FROM reports r
    LEFT JOIN app.profiles rep ON rep.id = r.reporter_id
    LEFT JOIN app.profiles tgt ON tgt.id = r.reported_user_id
    LEFT JOIN market_listings l ON l.id = r.listing_id
    WHERE (p_status = 'all' OR r.status = p_status)
    ORDER BY r.created_at DESC
    LIMIT 200
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$;
REVOKE EXECUTE ON FUNCTION public.admin_list_reports(p_status text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(p_status text) TO service_role;

NOTIFY pgrst, 'reload schema';
