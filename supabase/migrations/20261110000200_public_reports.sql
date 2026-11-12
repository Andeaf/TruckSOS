-- Faza 8.3 (PLAN_1.1_FIX #24, DSA art. 16; plan: .claude/wip/faza8/PLAN-faza8.md, APROBAT de David 9 nov 2026 cu C8.1, D8.4 manual,
-- D8.5 = DA): sesizări publice, fără cont, prin pagina trucksos.net/report → EF `report-public` → RPC-ul de mai jos.
--   1. public.reports: reporter_id devine NULLABLE (raport public); coloane noi reporter_email (doar la source = 'public'),
--      source ('app' | 'public', default 'app' — clienții 1.0.x nu o trimit), announcement_id (D8.5: raport pe anunț de depanare;
--      FK ON DELETE SET NULL, ca listing_id: ștergerea anunțului de către admin NU șterge dovada). Motive noi în CHECK:
--      illegal, rights, personal_data, sexual_violent (DSA cere să se poată indica ilegalitatea).
--   2. C8.1: on_report_notify filtra adminii cu `p.id <> NEW.reporter_id` → cu reporter_id NULL niciun admin nu primea push.
--      Acum IS DISTINCT FROM. Inventarul celorlalte locuri care presupuneau reporter_id nenul e în plan (toate tolerează NULL;
--      admin_list_reports primește coloanele noi aici).
--   3. app.report_ip_events: limita 10 sesizări / oră / IP ținută în bază (hash SHA-256 cu sare din secretul EF, FĂRĂ IP brut);
--      cron orar șterge rândurile > 24 h.
--   4. public.insert_public_report(...): SECURITY DEFINER, EXECUTE doar service_role (apelat de EF). Rezolvă reported_user_id după
--      tipul țintei (fără mesaje private), validează, trunchiază, inserează cu reporter_id NULL / source 'public'; întoarce jsonb.
--   5. reports_snapshot_from_source: reported_user_id vine din țintă și la listing / anunț (review 9 nov); index unic pe anunț.
-- RLS neschimbat: reports_select_own / reports_insert_own compară reporter_id = auth.uid() → NULL nu potrivește niciodată, deci
-- rapoartele publice sunt invizibile oricărui utilizator și nu pot fi inserate de clienți; adminul le vede prin admin_list_reports.
-- Retenția (6.3) șterge rapoartele închise > 12 luni, deci și reporter_email (termenul declarat în politică).
-- Rollback: supabase/rollback/20261110000200_public_reports.sql (rapoartele publice se ȘTERG — reporter_id redevine NOT NULL).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('public.reports') IS NULL THEN RAISE EXCEPTION 'cere public.reports'; END IF;
  IF to_regprocedure('public.on_report_notify()') IS NULL THEN RAISE EXCEPTION 'cere 20261102000200_reports_moderation (faza 3.3)'; END IF;
  IF to_regclass('app.announcements') IS NULL THEN RAISE EXCEPTION 'cere faza 4 (app.announcements)'; END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.reports'::regclass AND attname = 'source' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'public.reports.source exista deja: migrarea a fost aplicata?';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RAISE EXCEPTION 'cere pg_cron'; END IF;
END $$;

-- ── 1. public.reports ───────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.reports ALTER COLUMN reporter_id DROP NOT NULL;
ALTER TABLE public.reports
  ADD COLUMN reporter_email  text,
  ADD COLUMN reporter_lang   text,
  ADD COLUMN source          text NOT NULL DEFAULT 'app',
  ADD COLUMN announcement_id uuid;
ALTER TABLE public.reports ADD CONSTRAINT reports_reporter_lang_check CHECK (reporter_lang IS NULL OR reporter_lang IN ('ro', 'en', 'de'));
ALTER TABLE public.reports ADD CONSTRAINT reports_source_check CHECK (source IN ('app', 'public'));
-- numele NU se termină în _len (checklist-ul 22 numără constrângerile *_len = 26)
ALTER TABLE public.reports ADD CONSTRAINT reports_reporter_email_length CHECK (reporter_email IS NULL OR char_length(reporter_email) BETWEEN 5 AND 254);
-- public ⇔ fără cont și cu e-mail; app ⇔ cu cont și fără e-mail
ALTER TABLE public.reports ADD CONSTRAINT reports_public_has_email
  CHECK ((source = 'public' AND reporter_id IS NULL AND reporter_email IS NOT NULL)
      OR (source = 'app' AND reporter_id IS NOT NULL AND reporter_email IS NULL));
ALTER TABLE public.reports ADD CONSTRAINT reports_announcement_id_fkey
  FOREIGN KEY (announcement_id) REFERENCES app.announcements(id) ON DELETE SET NULL;
CREATE INDEX idx_reports_announcement ON public.reports (announcement_id) WHERE announcement_id IS NOT NULL;
-- ca la listing / mesaj: un utilizator raportează un anunț o singură dată (23505 → „deja raportat” în client); NULL-urile publice nu intră
CREATE UNIQUE INDEX uq_reports_reporter_announcement ON public.reports (reporter_id, announcement_id) WHERE announcement_id IS NOT NULL;
-- motivele noi (DSA: ilegal, drepturile mele, datele altcuiva, sexual/violent); cele vechi rămân
ALTER TABLE public.reports DROP CONSTRAINT reports_reason_check;
ALTER TABLE public.reports ADD CONSTRAINT reports_reason_check
  CHECK (reason = ANY (ARRAY['spam'::text, 'harassment'::text, 'inappropriate'::text, 'scam'::text, 'other'::text,
                             'illegal'::text, 'rights'::text, 'personal_data'::text, 'sexual_violent'::text]));
COMMENT ON COLUMN public.reports.source IS 'Faza 8.3: app = din aplicație, cu cont (reporter_id); public = de pe trucksos.net/report, fără cont (reporter_id NULL, reporter_email).';
COMMENT ON COLUMN public.reports.reporter_email IS 'Faza 8.3: e-mailul reclamantului fără cont (confirmare + decizie, manual — D8.4); dată personală a unui ne-utilizator, ștearsă cu raportul la 12 luni după închidere.';
COMMENT ON COLUMN public.reports.reporter_lang IS 'Faza 8.3: limba paginii publice la trimitere (ro/en/de) — adminul răspunde manual în ea (D8.4).';
COMMENT ON COLUMN public.reports.announcement_id IS 'Faza 8.3 (D8.5): raport pe un anunț de depanare; SET NULL la ștergerea anunțului (dovada rămâne).';

-- ── 2. C8.1: push la admini și pentru rapoartele publice ──────────────────────────────────────────────────────
-- Textul din 20261102000200 cu o singură schimbare: `p.id <> NEW.reporter_id` → `IS DISTINCT FROM` (NULL = toți adminii).
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
     WHERE p.role = 'admin' AND p.deleted_at IS NULL AND p.id IS DISTINCT FROM NEW.reporter_id
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

-- ── 2b. Snapshot-ul: utilizatorul raportat vine din ȚINTĂ, nu din client (review 9 nov) ─────────────────────
-- Textul din baseline + două ramuri: raport pe listing → seller_id, raport pe anunț de depanare → driver_id. Clientul trimitea
-- reported_user_id nevalidat (la listing încă de la faza 19); adminul ar fi putut vedea un anunț și alt nume. Mesajele rămân ca azi.
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
  v_owner   uuid;
BEGIN
  IF NEW.message_id IS NULL THEN
    IF NEW.listing_id IS NOT NULL THEN
      SELECT seller_id INTO v_owner FROM market_listings WHERE id = NEW.listing_id;
      IF v_owner IS NOT NULL THEN NEW.reported_user_id := v_owner; END IF;
    ELSIF NEW.announcement_id IS NOT NULL THEN
      SELECT driver_id INTO v_owner FROM app.announcements WHERE id = NEW.announcement_id;
      IF v_owner IS NOT NULL THEN NEW.reported_user_id := v_owner; END IF;
    END IF;
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
REVOKE EXECUTE ON FUNCTION public.reports_snapshot_from_source() FROM PUBLIC, anon, authenticated;

-- ── 3. Limita pe IP (hash cu sare; fără IP brut) ───────────────────────────────────────────────────────────────
CREATE TABLE app.report_ip_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ip_hash    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE app.report_ip_events IS 'Faza 8.3: SHA-256(sare + IP) al sesizărilor publice, pentru limita 10/oră/IP; retenție 24 h (cron). Fără IP brut. Scris doar de insert_public_report.';
CREATE INDEX report_ip_events_hash_idx ON app.report_ip_events (ip_hash, created_at);
ALTER TABLE app.report_ip_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app.report_ip_events FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE app.report_ip_events TO service_role;  -- convenția repo-ului (check-migrations); `app` nu e expusă prin API
SELECT cron.schedule('cleanup-report-ip-events-hourly', '29 * * * *', $cron$ DELETE FROM app.report_ip_events WHERE created_at < now() - interval '24 hours'; $cron$);

-- ── 4. RPC-ul apelat de EF `report-public` (service_role) ─────────────────────────────────────────────────────
-- p_target_type: announcement | listing | channel_message | user. Mesajele PRIVATE nu se pot raporta de pe pagina publică
-- (review 9 nov: un ne-participant n-are cum să știe id-ul, iar snapshot-ul ar copia conținut privat; participanții raportează din app).
-- Întoarce jsonb: {"id": uuid} sau {"error": "rate_limited" | "target_not_found"} — eroarea de țintă NU e RAISE, ca evidența pe IP să
-- rămână scrisă (altfel ghicitul de id-uri n-ar consuma limita). Intrările malformate (EF-ul le validează oricum) → RAISE bad_input.
CREATE FUNCTION public.insert_public_report(
  p_ip_hash text, p_target_type text, p_target_id uuid, p_reason text, p_details text, p_email text, p_lang text DEFAULT 'ro')
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_reported uuid;
  v_message_id uuid;
  v_message_table text;
  v_listing_id uuid;
  v_announcement_id uuid;
  v_id uuid;
  v_email text := lower(btrim(COALESCE(p_email, '')));
  v_lang text := CASE WHEN p_lang IN ('ro', 'en', 'de') THEN p_lang ELSE 'ro' END;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'not_public'; END IF;  -- doar service_role (EF), niciodată dintr-o sesiune
  IF p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'bad_input' USING DETAIL = 'ip_hash'; END IF;
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' OR char_length(v_email) > 254 THEN
    RAISE EXCEPTION 'bad_input' USING DETAIL = 'email';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('spam', 'harassment', 'inappropriate', 'scam', 'other', 'illegal', 'rights', 'personal_data', 'sexual_violent') THEN
    RAISE EXCEPTION 'bad_input' USING DETAIL = 'reason';
  END IF;
  IF p_target_id IS NULL THEN RAISE EXCEPTION 'bad_input' USING DETAIL = 'target_id'; END IF;
  IF p_target_type IS NULL OR p_target_type NOT IN ('announcement', 'listing', 'channel_message', 'user') THEN
    RAISE EXCEPTION 'bad_input' USING DETAIL = 'target_type';
  END IF;

  -- limita pe IP: 10 / oră; lock-ul face numărătoarea + INSERT-ul atomice pentru cereri concurente cu același hash
  PERFORM pg_advisory_xact_lock(hashtext(p_ip_hash));
  IF (SELECT count(*) FROM app.report_ip_events e WHERE e.ip_hash = p_ip_hash AND e.created_at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('error', 'rate_limited');
  END IF;
  INSERT INTO app.report_ip_events (ip_hash) VALUES (p_ip_hash);

  -- ținta → utilizatorul raportat (NOT NULL pe reports)
  CASE p_target_type
    WHEN 'announcement' THEN
      SELECT a.driver_id INTO v_reported FROM app.announcements a WHERE a.id = p_target_id;
      v_announcement_id := p_target_id;
    WHEN 'listing' THEN
      SELECT l.seller_id INTO v_reported FROM public.market_listings l WHERE l.id = p_target_id;
      v_listing_id := p_target_id;
    WHEN 'channel_message' THEN
      SELECT m.sender_id INTO v_reported FROM public.channel_messages m WHERE m.id = p_target_id AND m.deleted_at IS NULL;
      v_message_id := p_target_id; v_message_table := 'channel_messages';
    ELSE  -- 'user'
      SELECT p.id INTO v_reported FROM app.profiles p WHERE p.id = p_target_id AND p.deleted_at IS NULL;
  END CASE;
  IF v_reported IS NULL THEN RETURN jsonb_build_object('error', 'target_not_found'); END IF;

  INSERT INTO public.reports (reporter_id, reported_user_id, message_id, message_table, listing_id, announcement_id,
                              reason, details, reporter_email, reporter_lang, source)
  VALUES (NULL, v_reported, v_message_id, v_message_table, v_listing_id, v_announcement_id,
          p_reason, NULLIF(left(btrim(COALESCE(p_details, '')), 2000), ''), v_email, v_lang, 'public')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.insert_public_report(text, text, uuid, text, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.insert_public_report(text, text, uuid, text, text, text, text) TO service_role;

-- ── 5. admin_list_reports: + source, reporter_email, announcement_id, announcement_text ────────────────────────
-- Textul din 20261101000100 + cele 5 coloane (LEFT JOIN pe reporter tolera deja NULL).
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
           r.reported_user_id, tgt.full_name AS reported_name, tgt.banned_at AS reported_banned_at,
           r.source, r.reporter_email, r.reporter_lang,
           r.announcement_id, left(a.description, 140) AS announcement_text
    FROM reports r
    LEFT JOIN app.profiles rep ON rep.id = r.reporter_id
    LEFT JOIN app.profiles tgt ON tgt.id = r.reported_user_id
    LEFT JOIN market_listings l ON l.id = r.listing_id
    LEFT JOIN app.announcements a ON a.id = r.announcement_id
    WHERE (p_status = 'all' OR r.status = p_status)
    ORDER BY r.created_at DESC
    LIMIT 200
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_list_reports(p_status text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(p_status text) TO service_role;

-- ── 6. Verificări + PostgREST ──────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.reports'::regclass AND attname = 'reporter_id') THEN
    RAISE EXCEPTION 'reports.reporter_id a ramas NOT NULL';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.reports_snapshot_from_source()'::regprocedure) NOT LIKE '%NEW.announcement_id%' THEN
    RAISE EXCEPTION 'reports_snapshot_from_source: ramura pe anunt lipseste';
  END IF;
  IF has_table_privilege('anon', 'app.report_ip_events', 'SELECT') OR has_table_privilege('authenticated', 'app.report_ip_events', 'SELECT') THEN
    RAISE EXCEPTION 'report_ip_events: anon/authenticated nu trebuie sa aiba drepturi';
  END IF;
  IF has_function_privilege('anon', 'public.insert_public_report(text, text, uuid, text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.insert_public_report(text, text, uuid, text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'insert_public_report executabil prin API';
  END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.on_report_notify()'::regprocedure) NOT LIKE '%IS DISTINCT FROM NEW.reporter_id%' THEN
    RAISE EXCEPTION 'on_report_notify: C8.1 lipseste';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-report-ip-events-hourly') THEN
    RAISE EXCEPTION 'cron cleanup-report-ip-events-hourly lipsa';
  END IF;
  -- grant-urile pe reports neschimbate (checklist 12: INSERT, SELECT pentru authenticated)
  IF NOT has_table_privilege('authenticated', 'public.reports', 'INSERT') OR has_table_privilege('authenticated', 'public.reports', 'UPDATE') THEN
    RAISE EXCEPTION 'reports: grant-urile pentru authenticated s-au schimbat';
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
