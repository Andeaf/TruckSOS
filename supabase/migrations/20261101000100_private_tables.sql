-- Faza 4.2a (PLAN_1.1_FIX, D1 = (a), aprobat 25 oct + §8-bis 31 oct 2026): `profiles` și `announcements` devin
-- tabele PRIVATE în schema `app`; în `public` rămân VIEW-URI cu aceleași nume, aceleași coloane, în aceeași
-- ordine, `security_invoker`, cu măști pe coloanele sensibile și triggere INSTEAD OF pentru scrieri — ca
-- aplicațiile publicate 1.0.6–1.0.8 să meargă neschimbate (poarta 4.1 din CI rejoacă cererile lor reale).
--
-- Ce vede fiecare:
--   profiles:      phone, latitude, longitude, lang, push_enabled, notify_radius_km, market_push_enabled,
--                  mention_push_enabled, banned_at, banned_until, ban_reason → doar proprietarul și adminul;
--                  contact_email, address, vat_number → doar la mecanici (date de prestator), proprietar, admin;
--                  restul (id, full_name, role, created_at, specialization, activity_zone, rating_*, avatar_path,
--                  deleted_at, company_name) → ca până acum.
--   announcements: plate_number, chassis_number și coordonatele exacte → șoferul, mecanicul acceptat, adminul;
--                  pentru ceilalți latitude/longitude = poziția la ~1 km (lat_approx/lng_approx), cerința 3.2.
--   anon:          aceleași coloane ca azi, prin grant-urile pe view (politicile RLS urmează tabelul în `app`).
--   `ratings` NU se mută (D12-bis, §8-bis.2): clientul 1.0.x face upsert direct, care nu merge pe un view.
--
-- Politicile, triggerele, indexurile, constrângerile, FK-urile (37: 35 din alte tabele + 2 ale lui announcements către profiles), view-urile guest_*,
-- politicile Storage și grant-urile pe coloane sunt legate prin OID și urmează tabelul la SET SCHEMA.
-- Funcțiile care citesc/scriu cele două tabele sunt recreate cu `app.` explicit (generat din catalogul
-- producției, fiecare linie schimbată revizuită; singura schimbare e numele calificat, semantica e identică —
-- inclusiv la is_admin(), unde condiția aal2 rămâne pentru faza 11, §8.2). get_own_profile() e recreată
-- pe tipul view-ului (DROP + CREATE: tipul întors nu se poate schimba cu OR REPLACE).
-- Limita de anunțuri: prin trigger-ul INSTEAD OF al view-ului, triggerele tabelului rulează la adâncimea 2;
-- app.limit_announcements primește un flag local pe tranzacție (app.via_view) ca să nu sară limita (§8-bis.1).
--
-- Lock: ALTER TABLE … SET SCHEMA ia ACCESS EXCLUSIVE pe cele două tabele până la COMMIT; lock_timeout face
-- blocarea să pice repede în loc să țină cititorii. Rollback: supabase/rollback/20261101000100_private_tables.sql
-- (testat în CI: amprenta catalogului identică după rollback și după re-aplicare).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── 0. Precondiții ───────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid = 'public.profiles'::regclass) <> 'r'
     OR (SELECT relkind FROM pg_class WHERE oid = 'public.announcements'::regclass) <> 'r' THEN
    RAISE EXCEPTION 'private_tables: public.profiles / public.announcements nu sunt tabele (migrarea e deja aplicată?)';
  END IF;
  IF to_regclass('app.profiles') IS NOT NULL OR to_regclass('app.announcements') IS NOT NULL THEN
    RAISE EXCEPTION 'private_tables: app.profiles / app.announcements există deja';
  END IF;
  IF (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped) <> 25
     OR (SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.announcements'::regclass AND attnum > 0 AND NOT attisdropped) <> 20 THEN
    RAISE EXCEPTION 'private_tables: numărul de coloane diferă de cel așteptat (25 / 20) — view-urile de mai jos ar fi incomplete';
  END IF;
END $$;

-- ── 1. Funcția legată de tipul tabelului (se recreează la pasul 10 pe tipul view-ului) ────────────
DROP FUNCTION public.get_own_profile();

-- ── 2. Mutarea tabelelor (OID-urile, politicile, triggerele, indexurile, FK-urile, ACL-urile urmează) ──
ALTER TABLE public.profiles SET SCHEMA app;
ALTER TABLE public.announcements SET SCHEMA app;

-- View-urile `security_invoker` verifică drepturile invocatorului pe TOATE coloanele pe care le referă definiția
-- (nu doar pe cele cerute), deci anon are nevoie de SELECT pe tabelul de bază; restricția pe coloane pentru anon
-- stă pe view (pasul 5/6), iar schema `app` nu e expusă prin API (pgTAP 14) și nicio funcție executabilă de anon
-- nu citește tabelele direct. Grant-urile pe coloane de până acum rămân (redundante, inofensive).
GRANT SELECT ON TABLE app.profiles TO anon;
GRANT SELECT ON TABLE app.announcements TO anon;

-- ── 3. Ajutor pentru măști: is_admin() nu e executabil de anon, iar drepturile pe funcții se verifică la
--       inițializarea expresiei, nu pe ramura CASE; wrapper-ul e SECURITY DEFINER și executabil de ambele roluri.
CREATE FUNCTION app.viewer_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL AND public.is_admin(auth.uid());
$function$;
REVOKE EXECUTE ON FUNCTION app.viewer_is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app.viewer_is_admin() TO anon, authenticated, service_role;

-- ── 4. View-ul public.profiles (25 de coloane, ordinea attnum a tabelului) ──────────────────────────
CREATE VIEW public.profiles WITH (security_invoker = true) AS
SELECT p.id,
       p.full_name,
       p.role,
       p.created_at,
       p.specialization,
       p.activity_zone,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.phone END                AS phone,
       p.rating_avg,
       p.rating_count,
       p.avatar_path,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.push_enabled END         AS push_enabled,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.notify_radius_km END     AS notify_radius_km,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.latitude END             AS latitude,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.longitude END            AS longitude,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.lang END                 AS lang,
       p.deleted_at,
       p.company_name,
       CASE WHEN p.role = 'mechanic' OR p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.contact_email END AS contact_email,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.banned_at END            AS banned_at,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.banned_until END         AS banned_until,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.ban_reason END           AS ban_reason,
       CASE WHEN p.role = 'mechanic' OR p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.address END       AS address,
       CASE WHEN p.role = 'mechanic' OR p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.vat_number END    AS vat_number,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.market_push_enabled END  AS market_push_enabled,
       CASE WHEN p.id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin()) THEN p.mention_push_enabled END AS mention_push_enabled
  FROM app.profiles p;
COMMENT ON VIEW public.profiles IS 'Faza 4 (PLAN_1.1_FIX): view security_invoker peste app.profiles; coloanele sensibile sunt NULL pentru alții decât proprietarul/adminul (contact_email/address/vat_number vizibile la mecanici). Scrierile trec prin triggere INSTEAD OF.';
-- Default-urile tabelului, copiate pe view: la INSERT prin view, coloanele omise de client primesc valoarea
-- implicită (altfel trigger-ul INSTEAD OF ar insera NULL explicit și NOT NULL ar pica).
ALTER VIEW public.profiles ALTER COLUMN created_at SET DEFAULT now();
ALTER VIEW public.profiles ALTER COLUMN rating_avg SET DEFAULT 0;
ALTER VIEW public.profiles ALTER COLUMN rating_count SET DEFAULT 0;
ALTER VIEW public.profiles ALTER COLUMN push_enabled SET DEFAULT true;
ALTER VIEW public.profiles ALTER COLUMN lang SET DEFAULT 'ro';
ALTER VIEW public.profiles ALTER COLUMN market_push_enabled SET DEFAULT true;
ALTER VIEW public.profiles ALTER COLUMN mention_push_enabled SET DEFAULT true;
-- Drepturile view-ului = drepturile tabelului de până acum (authenticated: SELECT/INSERT/UPDATE; anon: coloanele publice).
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;
GRANT SELECT (id, full_name, role, created_at, specialization, activity_zone, rating_avg, rating_count, avatar_path, company_name)
  ON TABLE public.profiles TO anon;

-- ── 5. View-ul public.announcements (20 de coloane, ordinea attnum a tabelului) ────────────────────
CREATE VIEW public.announcements WITH (security_invoker = true) AS
SELECT a.id,
       a.driver_id,
       a.description,
       a.location,
       a.status,
       a.mechanic_id,
       a.created_at,
       a.updated_at,
       a.truck_make,
       a.truck_model,
       a.truck_year,
       CASE WHEN a.driver_id = (SELECT auth.uid()) OR a.mechanic_id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin())
            THEN a.plate_number END                                            AS plate_number,
       CASE WHEN a.driver_id = (SELECT auth.uid()) OR a.mechanic_id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin())
            THEN a.latitude ELSE a.lat_approx::double precision END            AS latitude,
       CASE WHEN a.driver_id = (SELECT auth.uid()) OR a.mechanic_id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin())
            THEN a.longitude ELSE a.lng_approx::double precision END           AS longitude,
       a.hidden_from_history,
       CASE WHEN a.driver_id = (SELECT auth.uid()) OR a.mechanic_id = (SELECT auth.uid()) OR (SELECT current_user NOT IN ('anon', 'authenticated') OR app.viewer_is_admin())
            THEN a.chassis_number END                                          AS chassis_number,
       a.lat_approx,
       a.lng_approx,
       a.source_lang,
       a.source_lang_detected
  FROM app.announcements a;
COMMENT ON VIEW public.announcements IS 'Faza 4 (PLAN_1.1_FIX): view security_invoker peste app.announcements; plăcuța, VIN-ul și coordonatele exacte doar pentru șofer, mecanicul acceptat și admin — ceilalți văd poziția la ~1 km (lat_approx/lng_approx). Scrierile trec prin triggere INSTEAD OF.';
ALTER VIEW public.announcements ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER VIEW public.announcements ALTER COLUMN status SET DEFAULT 'open';
ALTER VIEW public.announcements ALTER COLUMN created_at SET DEFAULT now();
ALTER VIEW public.announcements ALTER COLUMN updated_at SET DEFAULT now();
ALTER VIEW public.announcements ALTER COLUMN hidden_from_history SET DEFAULT false;
ALTER VIEW public.announcements ALTER COLUMN source_lang_detected SET DEFAULT false;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.announcements TO authenticated;
GRANT ALL ON TABLE public.announcements TO service_role;
GRANT SELECT (id, driver_id, description, location, status, created_at, truck_make, truck_model, truck_year, lat_approx, lng_approx)
  ON TABLE public.announcements TO anon;

-- ── 6. Scrierile prin view: triggere INSTEAD OF (SECURITY INVOKER: RLS-ul și gărzile tabelului de bază se
--       aplică invocatorului; `RETURNING * INTO NEW` întoarce rândul real, cu default-urile și valorile puse de
--       triggerele BEFORE; `RETURN NULL` când DML-ul intern n-a atins niciun rând, ca PostgREST să raporteze
--       0 rânduri, exact ca pe tabel — altfel ar părea un update reușit).
CREATE FUNCTION app.profiles_view_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO app.profiles (id, full_name, role, created_at, specialization, activity_zone, phone, rating_avg,
                            rating_count, avatar_path, push_enabled, notify_radius_km, latitude, longitude, lang,
                            deleted_at, company_name, contact_email, banned_at, banned_until, ban_reason, address,
                            vat_number, market_push_enabled, mention_push_enabled)
  VALUES (NEW.id, NEW.full_name, NEW.role, NEW.created_at, NEW.specialization, NEW.activity_zone, NEW.phone, NEW.rating_avg,
          NEW.rating_count, NEW.avatar_path, NEW.push_enabled, NEW.notify_radius_km, NEW.latitude, NEW.longitude, NEW.lang,
          NEW.deleted_at, NEW.company_name, NEW.contact_email, NEW.banned_at, NEW.banned_until, NEW.ban_reason, NEW.address,
          NEW.vat_number, NEW.market_push_enabled, NEW.mention_push_enabled)
  RETURNING * INTO NEW;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION app.profiles_view_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  -- Se scriu DOAR coloanele pe care clientul le-a schimbat (NEW diferit de OLD); restul rămân valorile din tabel
  -- (t.col), nu cele din instantaneul view-ului: altfel o coloană mascată (NULL pentru cine n-o vede, de ex.
  -- service_role fără auth.uid()) ar fi scrisă înapoi ca NULL, iar două PATCH-uri apropiate s-ar suprascrie.
  -- Garda tabelului (guard_profile_privileged_columns) vede aceleași schimbări ca pe tabel și ridică aceleași
  -- erori (id_change_forbidden, role_change_forbidden, …); pentru un străin RLS (profiles_update_own) dă 0 rânduri.
  UPDATE app.profiles t SET
    id                   = CASE WHEN NEW.id                   IS DISTINCT FROM OLD.id                   THEN NEW.id                   ELSE t.id                   END,
    full_name            = CASE WHEN NEW.full_name            IS DISTINCT FROM OLD.full_name            THEN NEW.full_name            ELSE t.full_name            END,
    role                 = CASE WHEN NEW.role                 IS DISTINCT FROM OLD.role                 THEN NEW.role                 ELSE t.role                 END,
    created_at           = CASE WHEN NEW.created_at           IS DISTINCT FROM OLD.created_at           THEN NEW.created_at           ELSE t.created_at           END,
    specialization       = CASE WHEN NEW.specialization       IS DISTINCT FROM OLD.specialization       THEN NEW.specialization       ELSE t.specialization       END,
    activity_zone        = CASE WHEN NEW.activity_zone        IS DISTINCT FROM OLD.activity_zone        THEN NEW.activity_zone        ELSE t.activity_zone        END,
    phone                = CASE WHEN NEW.phone                IS DISTINCT FROM OLD.phone                THEN NEW.phone                ELSE t.phone                END,
    rating_avg           = CASE WHEN NEW.rating_avg           IS DISTINCT FROM OLD.rating_avg           THEN NEW.rating_avg           ELSE t.rating_avg           END,
    rating_count         = CASE WHEN NEW.rating_count         IS DISTINCT FROM OLD.rating_count         THEN NEW.rating_count         ELSE t.rating_count         END,
    avatar_path          = CASE WHEN NEW.avatar_path          IS DISTINCT FROM OLD.avatar_path          THEN NEW.avatar_path          ELSE t.avatar_path          END,
    push_enabled         = CASE WHEN NEW.push_enabled         IS DISTINCT FROM OLD.push_enabled         THEN NEW.push_enabled         ELSE t.push_enabled         END,
    notify_radius_km     = CASE WHEN NEW.notify_radius_km     IS DISTINCT FROM OLD.notify_radius_km     THEN NEW.notify_radius_km     ELSE t.notify_radius_km     END,
    latitude             = CASE WHEN NEW.latitude             IS DISTINCT FROM OLD.latitude             THEN NEW.latitude             ELSE t.latitude             END,
    longitude            = CASE WHEN NEW.longitude            IS DISTINCT FROM OLD.longitude            THEN NEW.longitude            ELSE t.longitude            END,
    lang                 = CASE WHEN NEW.lang                 IS DISTINCT FROM OLD.lang                 THEN NEW.lang                 ELSE t.lang                 END,
    deleted_at           = CASE WHEN NEW.deleted_at           IS DISTINCT FROM OLD.deleted_at           THEN NEW.deleted_at           ELSE t.deleted_at           END,
    company_name         = CASE WHEN NEW.company_name         IS DISTINCT FROM OLD.company_name         THEN NEW.company_name         ELSE t.company_name         END,
    contact_email        = CASE WHEN NEW.contact_email        IS DISTINCT FROM OLD.contact_email        THEN NEW.contact_email        ELSE t.contact_email        END,
    banned_at            = CASE WHEN NEW.banned_at            IS DISTINCT FROM OLD.banned_at            THEN NEW.banned_at            ELSE t.banned_at            END,
    banned_until         = CASE WHEN NEW.banned_until         IS DISTINCT FROM OLD.banned_until         THEN NEW.banned_until         ELSE t.banned_until         END,
    ban_reason           = CASE WHEN NEW.ban_reason           IS DISTINCT FROM OLD.ban_reason           THEN NEW.ban_reason           ELSE t.ban_reason           END,
    address              = CASE WHEN NEW.address              IS DISTINCT FROM OLD.address              THEN NEW.address              ELSE t.address              END,
    vat_number           = CASE WHEN NEW.vat_number           IS DISTINCT FROM OLD.vat_number           THEN NEW.vat_number           ELSE t.vat_number           END,
    market_push_enabled  = CASE WHEN NEW.market_push_enabled  IS DISTINCT FROM OLD.market_push_enabled  THEN NEW.market_push_enabled  ELSE t.market_push_enabled  END,
    mention_push_enabled = CASE WHEN NEW.mention_push_enabled IS DISTINCT FROM OLD.mention_push_enabled THEN NEW.mention_push_enabled ELSE t.mention_push_enabled END
  WHERE t.id = OLD.id
  RETURNING * INTO NEW;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION app.profiles_view_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM app.profiles WHERE id = OLD.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER profiles_view_insert INSTEAD OF INSERT ON public.profiles FOR EACH ROW EXECUTE FUNCTION app.profiles_view_insert();
CREATE TRIGGER profiles_view_update INSTEAD OF UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION app.profiles_view_update();
CREATE TRIGGER profiles_view_delete INSTEAD OF DELETE ON public.profiles FOR EACH ROW EXECUTE FUNCTION app.profiles_view_delete();

CREATE FUNCTION app.announcements_view_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  -- Flag local pe tranzacție: triggerele tabelului rulează la adâncimea 2; app.limit_announcements îl citește.
  PERFORM set_config('app.via_view', 'on', true);
  -- Fără lat_approx / lng_approx (coloane generate).
  INSERT INTO app.announcements (id, driver_id, description, location, status, mechanic_id, created_at, updated_at,
                                 truck_make, truck_model, truck_year, plate_number, latitude, longitude,
                                 hidden_from_history, chassis_number, source_lang, source_lang_detected)
  VALUES (NEW.id, NEW.driver_id, NEW.description, NEW.location, NEW.status, NEW.mechanic_id, NEW.created_at, NEW.updated_at,
          NEW.truck_make, NEW.truck_model, NEW.truck_year, NEW.plate_number, NEW.latitude, NEW.longitude,
          NEW.hidden_from_history, NEW.chassis_number, NEW.source_lang, NEW.source_lang_detected)
  RETURNING * INTO NEW;
  PERFORM set_config('app.via_view', 'off', true);
  RETURN NEW;
END;
$function$;

CREATE FUNCTION app.announcements_view_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_rows integer;
BEGIN
  PERFORM set_config('app.via_view', 'on', true);
  -- Doar coloanele schimbate (vezi profiles_view_update): plăcuța, VIN-ul și coordonatele exacte sunt NULL /
  -- rotunjite în OLD pentru cine nu le vede (de ex. Edge Functions cu service_role: cleanup-announcements,
  -- translate-announcement) și nu trebuie scrise înapoi. Fără lat_approx / lng_approx (coloane generate).
  UPDATE app.announcements t SET
    id                   = CASE WHEN NEW.id                   IS DISTINCT FROM OLD.id                   THEN NEW.id                   ELSE t.id                   END,
    driver_id            = CASE WHEN NEW.driver_id            IS DISTINCT FROM OLD.driver_id            THEN NEW.driver_id            ELSE t.driver_id            END,
    description          = CASE WHEN NEW.description          IS DISTINCT FROM OLD.description          THEN NEW.description          ELSE t.description          END,
    location             = CASE WHEN NEW.location             IS DISTINCT FROM OLD.location             THEN NEW.location             ELSE t.location             END,
    status               = CASE WHEN NEW.status               IS DISTINCT FROM OLD.status               THEN NEW.status               ELSE t.status               END,
    mechanic_id          = CASE WHEN NEW.mechanic_id          IS DISTINCT FROM OLD.mechanic_id          THEN NEW.mechanic_id          ELSE t.mechanic_id          END,
    created_at           = CASE WHEN NEW.created_at           IS DISTINCT FROM OLD.created_at           THEN NEW.created_at           ELSE t.created_at           END,
    updated_at           = CASE WHEN NEW.updated_at           IS DISTINCT FROM OLD.updated_at           THEN NEW.updated_at           ELSE t.updated_at           END,
    truck_make           = CASE WHEN NEW.truck_make           IS DISTINCT FROM OLD.truck_make           THEN NEW.truck_make           ELSE t.truck_make           END,
    truck_model          = CASE WHEN NEW.truck_model          IS DISTINCT FROM OLD.truck_model          THEN NEW.truck_model          ELSE t.truck_model          END,
    truck_year           = CASE WHEN NEW.truck_year           IS DISTINCT FROM OLD.truck_year           THEN NEW.truck_year           ELSE t.truck_year           END,
    plate_number         = CASE WHEN NEW.plate_number         IS DISTINCT FROM OLD.plate_number         THEN NEW.plate_number         ELSE t.plate_number         END,
    latitude             = CASE WHEN NEW.latitude             IS DISTINCT FROM OLD.latitude             THEN NEW.latitude             ELSE t.latitude             END,
    longitude            = CASE WHEN NEW.longitude            IS DISTINCT FROM OLD.longitude            THEN NEW.longitude            ELSE t.longitude            END,
    hidden_from_history  = CASE WHEN NEW.hidden_from_history  IS DISTINCT FROM OLD.hidden_from_history  THEN NEW.hidden_from_history  ELSE t.hidden_from_history  END,
    chassis_number       = CASE WHEN NEW.chassis_number       IS DISTINCT FROM OLD.chassis_number       THEN NEW.chassis_number       ELSE t.chassis_number       END,
    source_lang          = CASE WHEN NEW.source_lang          IS DISTINCT FROM OLD.source_lang          THEN NEW.source_lang          ELSE t.source_lang          END,
    source_lang_detected = CASE WHEN NEW.source_lang_detected IS DISTINCT FROM OLD.source_lang_detected THEN NEW.source_lang_detected ELSE t.source_lang_detected END
  WHERE t.id = OLD.id
  RETURNING * INTO NEW;
  -- ROW_COUNT se citește imediat după UPDATE: PERFORM-ul de mai jos ar seta FOUND = true.
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  PERFORM set_config('app.via_view', 'off', true);
  IF v_rows = 0 THEN RETURN NULL; END IF;
  RETURN NEW;
END;
$function$;

CREATE FUNCTION app.announcements_view_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  DELETE FROM app.announcements WHERE id = OLD.id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN OLD;
END;
$function$;

CREATE TRIGGER announcements_view_insert INSTEAD OF INSERT ON public.announcements FOR EACH ROW EXECUTE FUNCTION app.announcements_view_insert();
CREATE TRIGGER announcements_view_update INSTEAD OF UPDATE ON public.announcements FOR EACH ROW EXECUTE FUNCTION app.announcements_view_update();
CREATE TRIGGER announcements_view_delete INSTEAD OF DELETE ON public.announcements FOR EACH ROW EXECUTE FUNCTION app.announcements_view_delete();

-- Funcțiile-trigger nu sunt executabile prin API (default ACL-ul global le dă deja doar postgres=X; explicit, ca pgTAP 17 să nu depindă de el).
REVOKE EXECUTE ON FUNCTION app.profiles_view_insert(), app.profiles_view_update(), app.profiles_view_delete(),
  app.announcements_view_insert(), app.announcements_view_update(), app.announcements_view_delete() FROM PUBLIC, anon, authenticated;

-- ── 7. Limita de anunțuri (faza 2, 20261031000200) — conștientă de calea prin view (§8-bis.1) ──────
-- Până acum: `pg_trigger_depth() > 1 → RETURN NEW` (scrierile declanșate de alte triggere nu se limitează).
-- Prin view, scrierea clientului ajunge aici la adâncimea 2 și ar fi fost tratată ca „internă” → limita sărită.
-- Acum: adâncimea permisă e 2 când app.via_view = on (pus de trigger-ul INSTEAD OF), altfel 1 — un INSERT/UPDATE
-- direct dintr-o funcție SECURITY DEFINER (repost_announcement) rămâne limitat exact ca azi.
CREATE OR REPLACE FUNCTION app.limit_announcements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF pg_trigger_depth() > (CASE WHEN current_setting('app.via_view', true) = 'on' THEN 2 ELSE 1 END) THEN RETURN NEW; END IF;
  -- UPDATE: contează doar redeschiderea (repost_announcement). INSERT: întotdeauna — garda
  -- announcements_guard_client forțează oricum status = 'open' pentru orice INSERT de client.
  IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM 'open' OR OLD.status = 'open') THEN RETURN NEW; END IF;
  -- Cel mult 5 deschise simultan (29 oct 2026; era 3 în 20261031000100).
  IF (SELECT count(*) FROM app.announcements WHERE driver_id = auth.uid() AND status = 'open' AND id <> NEW.id) >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements_open';
  END IF;
  IF NOT app.rate_limit_ok('announcement_day', interval '24 hours', 10)
     OR NOT app.rate_limit_ok('announcement_week', interval '7 days', 30) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements';
  END IF;
  RETURN NEW;
END; $function$;

-- ── 8. Funcțiile care citesc/scriu cele două tabele, cu `app.` explicit (generate din catalogul producției;
--       CREATE OR REPLACE păstrează ACL-ul; REVOKE/GRANT îl rescriu explicit, identic cu producția) ──────
-- public._purge_user_data: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public._purge_user_data(p_uid uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted timestamptz;
  v_paths   text[] := '{}';
  v_avatar  text;
  v_ann     text[];
  v_chat    text[];
  v_chan    text[];
  v_market  text[];
  v_files   text[];
BEGIN
  -- ── Idempotență: dacă profilul nu există sau e deja piatră-funerară, nu facem nimic ──
  SELECT deleted_at INTO v_deleted FROM app.profiles WHERE id = p_uid;
  IF NOT FOUND OR v_deleted IS NOT NULL THEN
    RETURN '{}';
  END IF;

  -- ── PASUL 0: colectăm căile Storage ÎNAINTE de orice DELETE/UPDATE ──
  -- a) avatarul propriu
  SELECT avatar_path INTO v_avatar FROM app.profiles WHERE id = p_uid;
  IF v_avatar IS NOT NULL THEN
    v_paths := v_paths || v_avatar;
  END IF;

  -- b) pozele anunțurilor lui de depanare
  SELECT COALESCE(array_agg(ap.storage_path), '{}')
  INTO v_ann
  FROM announcement_photos ap
  JOIN app.announcements a ON a.id = ap.announcement_id
  WHERE a.driver_id = p_uid;
  v_paths := v_paths || v_ann;

  -- c) pozele lui din chat privat — DOAR cele care NU sunt dovadă într-un raport `pending`
  SELECT COALESCE(array_agg(m.image_path), '{}')
  INTO v_chat
  FROM messages m
  WHERE m.sender_id = p_uid
    AND m.image_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_chat;

  -- d) pozele lui din canale — același tratament + guard de dovadă
  SELECT COALESCE(array_agg(cm.image_path), '{}')
  INTO v_chan
  FROM channel_messages cm
  WHERE cm.sender_id = p_uid
    AND cm.image_path IS NOT NULL
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_chan;

  -- e) FAZA 19: pozele anunțurilor lui de MARKET (rândurile cascadează cu anunțul,
  --    obiectele Storage nu — identic cu pozele de depanare)
  SELECT COALESCE(array_agg(mp.storage_path), '{}')
  INTO v_market
  FROM market_listing_photos mp
  JOIN market_listings l ON l.id = mp.listing_id
  WHERE l.seller_id = p_uid;
  v_paths := v_paths || v_market;

  -- f) FAZA 19.5: fișierele lui din chat privat + canale (guard de dovadă identic)
  SELECT COALESCE(array_agg(m.file_path), '{}')
  INTO v_files
  FROM messages m
  WHERE m.sender_id = p_uid
    AND m.file_path IS NOT NULL
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_files;

  SELECT COALESCE(array_agg(cm.file_path), '{}')
  INTO v_files
  FROM channel_messages cm
  WHERE cm.sender_id = p_uid
    AND cm.file_path IS NOT NULL
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );
  v_paths := v_paths || v_files;

  -- ── PASUL 1: tombstone pentru mesajele-poză ȘI mesajele-fișier ale lui ──
  UPDATE messages m
  SET content = '', image_path = NULL,
      file_path = NULL, file_name = NULL, file_size = NULL,
      deleted_at = now()
  WHERE m.sender_id = p_uid
    AND (m.image_path IS NOT NULL OR m.file_path IS NOT NULL)
    AND m.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = m.id AND r.message_table = 'messages' AND r.status = 'pending'
    );

  UPDATE channel_messages cm
  SET content = '', image_path = NULL,
      file_path = NULL, file_name = NULL, file_size = NULL,
      deleted_at = now()
  WHERE cm.sender_id = p_uid
    AND (cm.image_path IS NOT NULL OR cm.file_path IS NOT NULL)
    AND cm.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.message_id = cm.id AND r.message_table = 'channel_messages' AND r.status = 'pending'
    );

  -- ── PASUL 2: ȘTERGERI explicite ──
  DELETE FROM app.announcements       WHERE driver_id   = p_uid;
  -- FAZA 19: anunțurile de market (cascade market_listing_photos; conversations.listing_id
  -- → SET NULL — conversațiile SUPRAVIEȚUIESC, ca la anunțurile de depanare; rapoartele pe
  -- anunțuri rămân ANONIMIZATE prin piatra-funerară + snapshot).
  DELETE FROM market_listings     WHERE seller_id   = p_uid;
  DELETE FROM trucks              WHERE driver_id   = p_uid;
  DELETE FROM applications        WHERE mechanic_id = p_uid;
  DELETE FROM ratings             WHERE driver_id   = p_uid;
  DELETE FROM ratings             WHERE mechanic_id = p_uid;
  DELETE FROM favorite_mechanics  WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM search_history      WHERE driver_id   = p_uid OR mechanic_id = p_uid;
  DELETE FROM message_reads       WHERE user_id     = p_uid;
  DELETE FROM conversation_deletions WHERE user_id  = p_uid;
  DELETE FROM channel_reads       WHERE user_id     = p_uid;
  DELETE FROM push_tokens         WHERE user_id     = p_uid;

  -- ── PASUL 3: scrub PII pe profil → piatră-funerară ──
  -- 25 oct 2026 (A1): + address / vat_number / company_name / contact_email — rămâneau
  -- pe piatra funerară și erau citibile de orice cont logat (profiles_select_all).
  UPDATE app.profiles SET
    full_name      = '',
    avatar_path    = NULL,
    phone          = NULL,
    specialization = NULL,
    activity_zone  = NULL,
    latitude       = NULL,
    longitude      = NULL,
    address        = NULL,
    vat_number     = NULL,
    company_name   = NULL,
    contact_email  = NULL,
    push_enabled   = false,
    deleted_at     = now()
  WHERE id = p_uid;

  RETURN v_paths;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public._purge_user_data(p_uid uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._purge_user_data(p_uid uuid) TO service_role;

-- public.accept_announcement: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.accept_announcement(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
  v_mechanic_id uuid := auth.uid();
BEGIN
  SELECT driver_id INTO v_driver_id
  FROM app.announcements
  WHERE id = p_announcement_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  IF is_block_between(v_driver_id, v_mechanic_id) THEN
    RAISE EXCEPTION 'Announcement not available';   -- identic — nedetectabil
  END IF;

  UPDATE app.announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = p_announcement_id;

  INSERT INTO conversations (announcement_id, driver_id, mechanic_id)
  VALUES (p_announcement_id, v_driver_id, v_mechanic_id);
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.accept_announcement(p_announcement_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_announcement(p_announcement_id uuid) TO service_role;

-- public.accept_application: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.accept_application(p_application_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_announcement_id UUID;
  v_mechanic_id     UUID;
  v_driver_id       UUID;
  v_conv_id         UUID;
BEGIN
  SELECT a.announcement_id, a.mechanic_id, ann.driver_id
  INTO v_announcement_id, v_mechanic_id, v_driver_id
  FROM applications a
  JOIN app.announcements ann ON ann.id = a.announcement_id
  WHERE a.id = p_application_id
    AND ann.driver_id = auth.uid()
    AND a.status = 'pending'
    AND ann.status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_found_or_unauthorized';
  END IF;

  -- Respinge toate celelalte candidaturi pentru același anunț
  UPDATE applications
  SET status = 'rejected'
  WHERE announcement_id = v_announcement_id
    AND id != p_application_id;

  -- Acceptă candidatura aleasă
  UPDATE applications
  SET status = 'accepted'
  WHERE id = p_application_id;

  -- Actualizează anunțul
  UPDATE app.announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = v_announcement_id;

  -- Creează conversația
  INSERT INTO conversations(announcement_id, driver_id, mechanic_id)
  VALUES (v_announcement_id, v_driver_id, v_mechanic_id)
  RETURNING id INTO v_conv_id;

  RETURN v_conv_id;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.accept_application(p_application_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_application(p_application_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_application(p_application_id uuid) TO service_role;

-- public.admin_ban_user: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_target_role text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT role INTO v_target_role FROM app.profiles WHERE id = p_uid;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_target_role = 'admin' THEN RAISE EXCEPTION 'cannot_ban_admin'; END IF;

  UPDATE app.profiles
     SET banned_at    = now(),
         banned_until = p_until,
         ban_reason   = p_reason
   WHERE id = p_uid;

  DELETE FROM push_tokens WHERE user_id = p_uid;   -- igienÄƒ: dispozitivele curente nu mai primesc

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ban_user', 'user', p_uid,
          jsonb_build_object('reason', p_reason, 'until', p_until));
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ban_user(p_uid uuid, p_reason text, p_until timestamp with time zone) TO service_role;

-- public.admin_dashboard_stats: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_dashboard_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_build_object(
    'users_total',      (SELECT count(*) FROM app.profiles WHERE deleted_at IS NULL),
    'users_drivers',    (SELECT count(*) FROM app.profiles WHERE role = 'driver'   AND deleted_at IS NULL),
    'users_mechanics',  (SELECT count(*) FROM app.profiles WHERE role = 'mechanic' AND deleted_at IS NULL),
    'users_banned',     (SELECT count(*) FROM app.profiles WHERE banned_at IS NOT NULL),
    'users_new_7d',     (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '7 days'),
    'users_new_30d',    (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '30 days'),
    'ann_open',         (SELECT count(*) FROM app.announcements WHERE status = 'open'),
    'ann_accepted',     (SELECT count(*) FROM app.announcements WHERE status = 'accepted'),
    'ann_resolved',     (SELECT count(*) FROM app.announcements WHERE status = 'resolved'),
    'ann_cancelled',    (SELECT count(*) FROM app.announcements WHERE status = 'cancelled'),
    'reports_pending',  (SELECT count(*) FROM reports WHERE status = 'pending'),
    'conversations',    (SELECT count(*) FROM conversations),
    'messages',         (SELECT count(*) FROM messages) + (SELECT count(*) FROM channel_messages)
  ) INTO v;
  RETURN v;
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_dashboard_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_stats() TO service_role;

-- public.admin_delete_announcement: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_delete_announcement(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_driver uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT driver_id INTO v_driver FROM app.announcements WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM announcement_photos WHERE announcement_id = p_id LOOP
    PERFORM storage_api_delete('photos', r.storage_path);
  END LOOP;

  UPDATE applications SET status = 'rejected' WHERE announcement_id = p_id AND status = 'pending';

  DELETE FROM app.announcements WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_announcement', 'announcement', p_id, jsonb_build_object('driver_id', v_driver));
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_announcement(p_id uuid) TO service_role;

-- public.admin_list_channel_messages: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_list_channel_messages(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT cm.id, cm.content, cm.image_path, cm.deleted_at, cm.deleted_by_admin, cm.created_at,
           cm.sender_id, s.full_name AS sender_name
    FROM channel_messages cm
    LEFT JOIN app.profiles s ON s.id = cm.sender_id
    ORDER BY cm.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_list_channel_messages(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_channel_messages(p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_channel_messages(p_limit integer) TO service_role;

-- public.admin_list_recent_announcements: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_list_recent_announcements(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT a.id, a.description, a.location, a.status, a.created_at,
           a.driver_id, d.full_name AS driver_name,
           (SELECT count(*) FROM announcement_photos ap WHERE ap.announcement_id = a.id) AS photo_count,
           (SELECT count(*) FROM announcement_views av WHERE av.announcement_id = a.id) AS view_count
    FROM app.announcements a
    LEFT JOIN app.profiles d ON d.id = a.driver_id
    ORDER BY a.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_list_recent_announcements(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_announcements(p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_announcements(p_limit integer) TO service_role;

-- public.admin_list_recent_listings: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_list_recent_listings(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT l.id, l.title, l.description, l.price, l.currency, l.category, l.status,
           l.created_at, l.seller_id, s.full_name AS seller_name,
           (SELECT count(*) FROM market_listing_photos mp WHERE mp.listing_id = l.id) AS photo_count
    FROM market_listings l
    LEFT JOIN app.profiles s ON s.id = l.seller_id
    ORDER BY l.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_list_recent_listings(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_listings(p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_listings(p_limit integer) TO service_role;

-- public.admin_list_recent_reviews: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_list_recent_reviews(p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT r.id, r.stars, r.comment, r.created_at,
           r.mechanic_id, m.full_name AS mechanic_name,
           r.driver_id,   d.full_name AS driver_name
    FROM ratings r
    LEFT JOIN app.profiles m ON m.id = r.mechanic_id
    LEFT JOIN app.profiles d ON d.id = r.driver_id
    WHERE r.comment IS NOT NULL AND r.comment <> ''
    ORDER BY r.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_list_recent_reviews(p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_reviews(p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_recent_reviews(p_limit integer) TO service_role;

-- public.admin_list_reports: SECURITY DEFINER
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
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_list_reports(p_status text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(p_status text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(p_status text) TO service_role;

-- public.admin_purge_accounts: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_purge_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_accounts jsonb;
  v_count integer;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  IF NOT p_dry_run THEN
    -- Faza 11 (is_admin cu aal2) activează ștergerea; până atunci funcția nu șterge nimic.
    RAISE EXCEPTION 'purge_disabled_until_phase_11';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from OR p_to - p_from > interval '31 days'
     OR p_to > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'bad_interval';
  END IF;
  SELECT count(*), coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'email', c.email,
           'role', c.role,
           'provider', c.provider,
           'created_at', c.created_at,
           'last_sign_in_at', c.last_sign_in_at,
           'email_confirmed', c.email_confirmed,
           'criterion', CASE
             WHEN c.role IS NULL THEN 'fara_profil'
             WHEN NOT c.email_confirmed THEN 'email_neconfirmat'
             WHEN c.last_sign_in_at IS NULL OR c.last_sign_in_at < c.created_at + interval '1 minute' THEN 'nelogat_dupa_inscriere'
             ELSE 'profil_gol_fara_activitate' END
         ) ORDER BY c.created_at), '[]'::jsonb)
    INTO v_count, v_accounts
    FROM (
      SELECT u.id, u.email, u.created_at, u.last_sign_in_at,
             (u.email_confirmed_at IS NOT NULL) AS email_confirmed,
             (SELECT p.role FROM app.profiles p WHERE p.id = u.id) AS role,
             (SELECT string_agg(i.provider, ',') FROM auth.identities i WHERE i.user_id = u.id) AS provider
        FROM auth.users u
       WHERE u.created_at >= p_from AND u.created_at < p_to
         AND NOT EXISTS (SELECT 1 FROM app.profiles p WHERE p.id = u.id
                            AND (p.role = 'admin' OR p.phone IS NOT NULL OR p.company_name IS NOT NULL OR p.avatar_path IS NOT NULL))
         AND NOT EXISTS (SELECT 1 FROM app.announcements a WHERE a.driver_id = u.id OR a.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.messages m WHERE m.sender_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.channel_messages cm WHERE cm.sender_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.applications ap WHERE ap.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.conversations c WHERE c.driver_id = u.id OR c.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.market_listings l WHERE l.seller_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.ratings r WHERE r.driver_id = u.id OR r.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.reports rp WHERE rp.reporter_id = u.id OR rp.reported_user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.trucks t WHERE t.driver_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.favorite_mechanics f WHERE f.driver_id = u.id OR f.mechanic_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM public.push_tokens pt WHERE pt.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.owner_id = u.id::text)
    ) c;
  RETURN jsonb_build_object('dry_run', true, 'count', v_count, 'accounts', v_accounts);
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_purge_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_purge_accounts(p_from timestamp with time zone, p_to timestamp with time zone, p_dry_run boolean) TO service_role;

-- public.admin_search_announcements: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_search_announcements(p_query text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_q text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  v_q := trim(coalesce(p_query, ''));
  SELECT jsonb_agg(to_jsonb(t)) INTO v FROM (
    SELECT a.id, a.description, a.location, a.status, a.created_at,
           a.driver_id, d.full_name AS driver_name,
           (SELECT count(*) FROM announcement_photos ap WHERE ap.announcement_id = a.id) AS photo_count,
           (SELECT count(*) FROM announcement_views av WHERE av.announcement_id = a.id) AS view_count
    FROM app.announcements a
    LEFT JOIN app.profiles d ON d.id = a.driver_id
    WHERE v_q = ''
       OR a.description  ILIKE '%' || v_q || '%'
       OR a.location     ILIKE '%' || v_q || '%'
       OR a.plate_number ILIKE '%' || v_q || '%'
       OR d.full_name    ILIKE '%' || v_q || '%'
    ORDER BY a.created_at DESC
    LIMIT least(p_limit, 300)
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_search_announcements(p_query text, p_limit integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_announcements(p_query text, p_limit integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_announcements(p_query text, p_limit integer) TO service_role;

-- public.admin_search_users: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_search_users(p_query text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_q text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  v_q := coalesce(trim(p_query), '');
  SELECT jsonb_agg(to_jsonb(t) ORDER BY t.full_name) INTO v FROM (
    SELECT p.id, p.full_name, p.role, p.avatar_path, p.deleted_at,
           p.banned_at, p.banned_until, u.email
    FROM app.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.role <> 'admin'
      AND (v_q = ''
           OR p.full_name ILIKE '%' || v_q || '%'
           OR u.email    ILIKE '%' || v_q || '%')
    LIMIT 50
  ) t;
  RETURN coalesce(v, '[]'::jsonb);
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_search_users(p_query text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users(p_query text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_search_users(p_query text) TO service_role;

-- public.admin_unban_user: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_unban_user(p_uid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  UPDATE app.profiles SET banned_at = NULL, banned_until = NULL, ban_reason = NULL WHERE id = p_uid;
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'unban_user', 'user', p_uid, '{}'::jsonb);
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_unban_user(p_uid uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unban_user(p_uid uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unban_user(p_uid uuid) TO service_role;

-- public.admin_update_profile: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_allowed text[] := ARRAY[
    'full_name','phone','address','vat_number',
    'specialization','activity_zone','company_name','contact_email'
  ];
  v_bad text;
  v_old jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' OR p_fields = '{}'::jsonb THEN
    RAISE EXCEPTION 'no_fields';
  END IF;

  SELECT k INTO v_bad
  FROM jsonb_object_keys(p_fields) AS k
  WHERE k <> ALL (v_allowed)
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'field_not_allowed: %', v_bad;
  END IF;

  -- Sanity minimal: numele nu poate deveni gol (restul coloanelor sunt nullable).
  IF p_fields ? 'full_name' AND nullif(trim(p_fields->>'full_name'), '') IS NULL THEN
    RAISE EXCEPTION 'full_name_empty';
  END IF;

  -- Valorile VECHI, cu lock pe rând (FOR UPDATE): auditul reflectă exact starea
  -- pe care a suprascris-o ACEST apel, chiar sub apeluri concurente.
  SELECT jsonb_build_object(
    'full_name', full_name, 'phone', phone, 'address', address,
    'vat_number', vat_number, 'specialization', specialization,
    'activity_zone', activity_zone, 'company_name', company_name,
    'contact_email', contact_email
  ) INTO v_old
  FROM app.profiles WHERE id = p_uid FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;

  -- UPDATE STATIC (fără SQL dinamic — zero risc de injecție prin numele cheilor):
  -- doar cheile PREZENTE în p_fields se modifică; valoare goală/null → coloana devine NULL.
  UPDATE app.profiles SET
    full_name      = CASE WHEN p_fields ? 'full_name'      THEN trim(p_fields->>'full_name')                ELSE full_name      END,
    phone          = CASE WHEN p_fields ? 'phone'          THEN nullif(trim(p_fields->>'phone'), '')          ELSE phone          END,
    address        = CASE WHEN p_fields ? 'address'        THEN nullif(trim(p_fields->>'address'), '')        ELSE address        END,
    vat_number     = CASE WHEN p_fields ? 'vat_number'     THEN nullif(trim(p_fields->>'vat_number'), '')     ELSE vat_number     END,
    specialization = CASE WHEN p_fields ? 'specialization' THEN nullif(trim(p_fields->>'specialization'), '') ELSE specialization END,
    activity_zone  = CASE WHEN p_fields ? 'activity_zone'  THEN nullif(trim(p_fields->>'activity_zone'), '')  ELSE activity_zone  END,
    company_name   = CASE WHEN p_fields ? 'company_name'   THEN nullif(trim(p_fields->>'company_name'), '')   ELSE company_name   END,
    contact_email  = CASE WHEN p_fields ? 'contact_email'  THEN nullif(trim(p_fields->>'contact_email'), '')  ELSE contact_email  END
  WHERE id = p_uid;

  -- Trasabilitate completă: vechi (doar cheile atinse) + nou.
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (
    auth.uid(), 'update_profile', 'user', p_uid,
    jsonb_build_object(
      'old', (SELECT jsonb_object_agg(k, v_old -> k) FROM jsonb_object_keys(p_fields) AS k),
      'new', p_fields
    )
  );
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_profile(p_uid uuid, p_fields jsonb) TO service_role;

-- public.admin_user_detail: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.admin_user_detail(p_uid uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT to_jsonb(d) INTO v FROM (
    SELECT
      p.id, p.full_name, p.role, p.avatar_path, p.specialization, p.activity_zone,
      p.company_name, p.contact_email, p.address, p.vat_number, p.phone,
      p.rating_avg, p.rating_count,
      p.deleted_at, p.banned_at, p.banned_until, p.ban_reason,
      u.email, u.created_at AS registered_at,
      (SELECT count(*) FROM app.announcements a WHERE a.driver_id = p.id)              AS announcements_count,
      (SELECT count(*) FROM applications ap WHERE ap.mechanic_id = p.id)           AS applications_count,
      (SELECT count(*) FROM reports r WHERE r.reported_user_id = p.id)             AS reports_received,
      (SELECT count(*) FROM reports r WHERE r.reporter_id = p.id)                  AS reports_made
    FROM app.profiles p
    JOIN auth.users u ON u.id = p.id
    WHERE p.id = p_uid
  ) d;
  IF v IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  RETURN v;
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.admin_user_detail(p_uid uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_detail(p_uid uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_detail(p_uid uuid) TO service_role;

-- public.apply_to_announcement: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text DEFAULT 'RON'::text, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT driver_id INTO v_driver_id
  FROM app.announcements
  WHERE id = p_announcement_id AND status = 'open';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'announcement_not_open';
  END IF;

  IF is_block_between(v_driver_id, auth.uid()) THEN
    RAISE EXCEPTION 'announcement_not_open';   -- identic cu cazul de mai sus — nedetectabil
  END IF;

  INSERT INTO applications(announcement_id, mechanic_id, price_type, price_amount, currency, message)
  VALUES (p_announcement_id, auth.uid(), p_price_type, p_price_amount, p_currency, p_message);
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_to_announcement(p_announcement_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO service_role;

-- public.block_user: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.block_user(p_target uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_target = v_me THEN
    RAISE EXCEPTION 'cannot_block_self';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM app.profiles WHERE id = p_target) THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  INSERT INTO blocked_users(blocker_id, blocked_id)
  VALUES (v_me, p_target)
  ON CONFLICT DO NOTHING;          -- idempotent (dublu-tap, retry de rețea)

  -- Auto-reject candidaturi pending între cei doi, SIMETRIC (§1.7.1):
  --   • eu șofer → candidaturile mecanicului blocat la anunțurile mele;
  --   • eu mecanic → propriile candidaturi la anunțurile blocatului.
  -- O respingere e un eveniment banal — nedetectabil ca semnal de blocare.
  UPDATE applications a
  SET status = 'rejected'
  FROM app.announcements ann
  WHERE a.announcement_id = ann.id
    AND a.status = 'pending'
    AND (
      (ann.driver_id = v_me AND a.mechanic_id = p_target)
      OR (a.mechanic_id = v_me AND ann.driver_id = p_target)
    );
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.block_user(p_target uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(p_target uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.block_user(p_target uuid) TO service_role;

-- public.dismiss_application: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.dismiss_application(p_application_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM applications a
  USING app.announcements ann
  WHERE a.id = p_application_id
    AND a.mechanic_id = auth.uid()
    AND a.announcement_id = ann.id
    AND (a.status = 'rejected' OR ann.status = 'cancelled');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_dismissable';
  END IF;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.dismiss_application(p_application_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_application(p_application_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dismiss_application(p_application_id uuid) TO service_role;

-- public.get_driver_phone: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_driver_phone(p_driver_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_driver_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.profiles WHERE id = p_driver_id AND role IN ('driver', 'admin')
  ) THEN
    RETURN NULL;
  END IF;
  SELECT p.phone INTO v_phone
  FROM app.profiles p
  WHERE p.id = p_driver_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE ((c.driver_id = p_driver_id AND c.mechanic_id = auth.uid())
          OR (c.mechanic_id = p_driver_id AND c.driver_id = auth.uid()))
        AND c.listing_id IS NULL                     -- Faza 19: idem
    );
  RETURN v_phone;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.get_driver_phone(p_driver_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_phone(p_driver_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_phone(p_driver_id uuid) TO service_role;

-- public.get_mechanic_phone: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.get_mechanic_phone(p_mechanic_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_mechanic_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.profiles WHERE id = p_mechanic_id AND role IN ('mechanic', 'admin')
  ) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations c
    WHERE ((c.mechanic_id = p_mechanic_id AND c.driver_id = auth.uid())
        OR (c.driver_id = p_mechanic_id AND c.mechanic_id = auth.uid()))
      AND c.listing_id IS NULL                       -- Faza 19: marketul NU deblochează telefonul
  ) THEN
    RETURN NULL;
  END IF;
  SELECT phone INTO v_phone FROM app.profiles WHERE id = p_mechanic_id;
  RETURN v_phone;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.get_mechanic_phone(p_mechanic_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mechanic_phone(p_mechanic_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_mechanic_phone(p_mechanic_id uuid) TO service_role;

-- public.is_admin: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.is_admin(p_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM app.profiles WHERE id = p_uid AND role = 'admin');
$function$
;
REVOKE EXECUTE ON FUNCTION public.is_admin(p_uid uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(p_uid uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(p_uid uuid) TO service_role;

-- public.is_banned: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.is_banned(p_uid uuid DEFAULT auth.uid())
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app.profiles
    WHERE id = p_uid
      AND banned_at IS NOT NULL
      AND (banned_until IS NULL OR banned_until > now())
  );
$function$
;
REVOKE EXECUTE ON FUNCTION public.is_banned(p_uid uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_banned(p_uid uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_banned(p_uid uuid) TO service_role;

-- public.notify_mechanics_new_announcement: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.notify_mechanics_new_announcement(p_announcement app.announcements)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_mechanic record;
BEGIN
  FOR v_mechanic IN
    SELECT app.profiles.id, COALESCE(lang, 'ro') AS lang
    FROM app.profiles
    WHERE role = 'mechanic'
      AND app.profiles.id <> p_announcement.driver_id
      AND push_enabled
      AND NOT is_block_between(p_announcement.driver_id, app.profiles.id)   -- Faza 18
      AND (
        notify_radius_km IS NULL
        OR (
          p_announcement.latitude IS NOT NULL AND p_announcement.longitude IS NOT NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND distance_km(latitude, longitude, p_announcement.latitude, p_announcement.longitude)
              <= notify_radius_km
        )
      )
  LOOP
    PERFORM notify_push(
      v_mechanic.id,
      push_text(v_mechanic.lang, 'announcement_title'),
      p_announcement.location,
      jsonb_build_object('type', 'feed', 'id', p_announcement.id)
    );
  END LOOP;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.notify_mechanics_new_announcement(p_announcement app.announcements) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_mechanics_new_announcement(p_announcement app.announcements) TO service_role;

-- public.notify_push: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb DEFAULT '{}'::jsonb, p_tag text DEFAULT NULL::text, p_ios_title text DEFAULT NULL::text, p_ios_body text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_enabled boolean;
  v_token   record;
  v_payload jsonb;
BEGIN
  -- Comutatorul global din Setări.
  SELECT push_enabled INTO v_enabled FROM app.profiles WHERE id = p_user_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  -- Conturile banate nu primesc push (indiferent de preferință) — 18.4b.
  IF is_banned(p_user_id) THEN
    RETURN;
  END IF;

  FOR v_token IN SELECT token, platform FROM push_tokens WHERE user_id = p_user_id LOOP
    IF v_token.platform = 'ios' AND p_tag IS NOT NULL THEN
      -- iPhone, notificare de fir (conversație/canal): o celulă PER MESAJ,
      -- stivuite pe fir prin thread-id, ca WhatsApp. Fără collapseId: pe iOS
      -- înlocuirea re-afișa bannerul cu același conținut la fiecare mesaj.
      -- Fără channelId (câmp doar-Android). Ștergerea din bară la citire rămâne
      -- pe client (dismissThreadNotifications filtrează după data.type/id).
      v_payload := jsonb_build_object(
        'to',       v_token.token,
        'title',    COALESCE(p_ios_title, p_title),
        'body',     COALESCE(p_ios_body,  p_body),
        'data',     p_data,
        'sound',    'default',
        'priority', 'high',
        'threadId', p_tag
      );
    ELSE
      -- Android + tokenuri fără platformă cunoscută (aplicații nemigrate):
      -- comportamentul de până acum.
      v_payload := jsonb_build_object(
        'to',        v_token.token,
        'title',     p_title,
        'body',      p_body,
        'data',      p_data,
        'sound',     'default',
        'channelId', 'default',
        -- FCM „high": livrare imediată și în Doze; fără el Samsung amâna minute.
        'priority',  'high'
      );
      -- `tag` (Android) înlocuiește celula din bară; `collapseId` coalescează în
      -- tranzit și, pe iOS-urile nemigrate, înlocuiește celula.
      IF p_tag IS NOT NULL THEN
        v_payload := v_payload || jsonb_build_object('tag', p_tag, 'collapseId', p_tag);
      END IF;
    END IF;

    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := v_payload
    );
  END LOOP;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb, p_tag text, p_ios_title text, p_ios_body text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_push(p_user_id uuid, p_title text, p_body text, p_data jsonb, p_tag text, p_ios_title text, p_ios_body text) TO service_role;

-- public.on_application_accepted_notify: trigger
CREATE OR REPLACE FUNCTION public.on_application_accepted_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_driver_name text;
  v_lang        text;
BEGIN
  SELECT p.full_name INTO v_driver_name
  FROM app.announcements a
  JOIN app.profiles p ON p.id = a.driver_id
  WHERE a.id = NEW.announcement_id;

  v_lang := user_lang(NEW.mechanic_id);

  PERFORM notify_push(
    NEW.mechanic_id,
    push_text(v_lang, 'accepted_title'),
    format(push_text(v_lang, 'accepted_body'), COALESCE(v_driver_name, '')),
    jsonb_build_object('type', 'application', 'id', NEW.id)
  );
  RETURN NEW;
END;
$function$
;

-- public.on_application_notify: trigger
CREATE OR REPLACE FUNCTION public.on_application_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_driver   uuid;
  v_mechanic text;
  v_lang     text;
BEGIN
  SELECT driver_id INTO v_driver FROM app.announcements WHERE id = NEW.announcement_id;
  IF v_driver IS NULL OR v_driver = NEW.mechanic_id THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_mechanic FROM app.profiles WHERE id = NEW.mechanic_id;
  v_lang := user_lang(v_driver);

  PERFORM notify_push(
    v_driver,
    push_text(v_lang, 'application_title'),
    format(push_text(v_lang, 'application_body'), COALESCE(v_mechanic, '')),
    jsonb_build_object('type', 'announcement', 'id', NEW.announcement_id)
  );
  RETURN NEW;
END;
$function$
;

-- public.on_channel_message_notify: trigger
CREATE OR REPLACE FUNCTION public.on_channel_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_cooldown constant interval := interval '2 minutes';
  v_rec      record;
  v_addr     record;
  v_sender   text;
  v_lang     text;
  v_cursor   timestamptz;
  v_since    timestamptz;
  v_count    integer;
  v_body     text;
  v_title    text;
  v_line_new text;
  v_short    text;
  v_done     uuid[] := '{}';
BEGIN
  SELECT full_name INTO v_sender FROM app.profiles WHERE id = NEW.sender_id;

  -- Linia mesajului curent (corpul de pe iOS + plasa de siguranță a digest-ului).
  v_short := COALESCE(
    NULLIF(NEW.content, ''),
    CASE
      WHEN NEW.file_name IS NOT NULL
           AND lower(NEW.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                       THEN '🎥 ' || left(NEW.file_name, 98)
      WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 98)
      WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
      WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
      WHEN NEW.announcement_id IS NOT NULL THEN '📍'
      ELSE '📷'
    END
  );
  v_line_new := left(COALESCE(v_sender, '?'), 24) || ': ' || v_short;

  -- ── 4a. Adresați: autorul mesajului citat ∪ mențiunile (max 5), imediat, fără pauză ──
  FOR v_addr IN
    SELECT DISTINCT ON (x.user_id) x.user_id, x.kind
      FROM (
        SELECT m.sender_id AS user_id, 'reply'::text AS kind, 0::bigint AS ord
          FROM channel_messages m
         WHERE NEW.reply_to_id IS NOT NULL AND m.id = NEW.reply_to_id
        UNION ALL
        SELECT (t.e->>'id')::uuid, 'mention', t.ord
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(NEW.mentions) = 'array' THEN NEW.mentions ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS t(e, ord)
         WHERE (t.e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) x
      JOIN app.profiles pr ON pr.id = x.user_id
     WHERE x.user_id <> NEW.sender_id
       AND pr.push_enabled
       AND pr.mention_push_enabled
       AND pr.deleted_at IS NULL
       AND pr.created_at <= NEW.created_at                -- since-join, ca RLS-ul și ca digest-ul
       AND NOT is_block_between(NEW.sender_id, x.user_id)
     ORDER BY x.user_id, x.ord                            -- reply (ord 0) are prioritate la dubluri
     LIMIT 5
  LOOP
    IF NOT direct_push_allowed(v_addr.user_id, NEW.sender_id) THEN
      -- Peste limită: NU-l pierdem; rămâne în digest-ul obișnuit de mai jos.
      CONTINUE;
    END IF;
    v_lang  := user_lang(v_addr.user_id);
    v_title := format(push_text(v_lang, v_addr.kind || '_title'), left(COALESCE(v_sender, '?'), 24));

    PERFORM notify_push(
      v_addr.user_id,
      v_title,
      left(v_short, 140),
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id,
                         'message_id', NEW.id, 'kind', v_addr.kind),
      'mention-' || NEW.channel_id,
      v_title,
      left(v_short, 140)
    );
    -- Digest-ul nu trebuie să-i repete mesajul: cursorul lui de push devine „acum”.
    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_addr.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
    v_done := v_done || v_addr.user_id;
  END LOOP;

  -- ── 4b. Digest-ul de până acum, pentru restul membrilor ──
  FOR v_rec IN
    SELECT p.user_id, pr.created_at AS joined_at, st.last_pushed_at
    FROM channel_push_prefs p
    JOIN app.profiles pr ON pr.id = p.user_id
    LEFT JOIN channel_push_state st
           ON st.user_id = p.user_id AND st.channel_id = p.channel_id
    WHERE p.channel_id = NEW.channel_id
      AND p.enabled
      AND p.user_id <> NEW.sender_id
      AND NOT (p.user_id = ANY (v_done))
      AND pr.push_enabled
      AND pr.deleted_at IS NULL
      AND NOT is_block_between(NEW.sender_id, p.user_id)
  LOOP
    SELECT last_read_at INTO v_cursor
      FROM channel_reads
     WHERE channel_id = NEW.channel_id AND user_id = v_rec.user_id;

    IF v_rec.last_pushed_at IS NOT NULL
       AND v_rec.last_pushed_at > now() - v_cooldown
       AND (v_cursor IS NULL OR v_cursor < v_rec.last_pushed_at) THEN
      CONTINUE;
    END IF;

    v_lang := user_lang(v_rec.user_id);

    SELECT count(*) INTO v_count FROM (
      SELECT 1
      FROM channel_messages m
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_cursor IS NULL OR m.created_at > v_cursor)
        AND m.created_at >= v_rec.joined_at
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      LIMIT 100
    ) c;

    v_since := GREATEST(v_cursor, v_rec.last_pushed_at);

    SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
    FROM (
      SELECT m.created_at,
             left(COALESCE(pr.full_name, '?'), 24) || ': ' ||
             CASE
               WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 100)
               WHEN m.file_name IS NOT NULL
                    AND lower(m.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                                THEN '🎥 ' || left(m.file_name, 98)
               WHEN m.file_name IS NOT NULL THEN '📎 ' || left(m.file_name, 98)
               WHEN m.listing_id IS NOT NULL THEN '🏷️'
               WHEN m.recommended_mechanic_id IS NOT NULL THEN '👤'
               WHEN m.announcement_id IS NOT NULL THEN '📍'
               ELSE '📷'
             END AS line
      FROM channel_messages m
      JOIN app.profiles pr ON pr.id = m.sender_id
      WHERE m.channel_id = NEW.channel_id
        AND m.sender_id <> v_rec.user_id
        AND m.deleted_at IS NULL
        AND (v_since IS NULL OR m.created_at > v_since)
        AND m.created_at >= v_rec.joined_at
        AND NOT is_block_between(m.sender_id, v_rec.user_id)
      ORDER BY m.created_at DESC
      LIMIT 5
    ) sub;

    IF v_body IS NULL THEN
      v_count := GREATEST(v_count, 1);
      v_body  := v_line_new;
    END IF;

    v_title := push_text(v_lang, 'channel_name');
    IF v_count > 1 THEN
      v_title := v_title || ' (' || v_count || ')';
    END IF;

    PERFORM notify_push(
      v_rec.user_id,
      v_title,
      v_body,
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id),
      'channel-' || NEW.channel_id,
      v_title,
      v_line_new
    );

    INSERT INTO channel_push_state (user_id, channel_id, last_pushed_at)
    VALUES (v_rec.user_id, NEW.channel_id, now())
    ON CONFLICT (user_id, channel_id) DO UPDATE SET last_pushed_at = now();
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Regula zero: notificarea nu are voie să blocheze mesajul.
  RAISE WARNING 'on_channel_message_notify: % (mesaj %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$
;

-- public.on_market_listing_notify: trigger
CREATE OR REPLACE FUNCTION public.on_market_listing_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user record;
  v_body text;
BEGIN
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  v_body := NEW.title || ' · ' || trim_scale(NEW.price)::text || ' ' || NEW.currency;

  FOR v_user IN
    SELECT app.profiles.id, COALESCE(lang, 'ro') AS lang
    FROM app.profiles
    WHERE app.profiles.id <> NEW.seller_id          -- nu te anunți pe tine
      AND deleted_at IS NULL                    -- Faza 15: pietre funerare
      AND push_enabled                          -- comutatorul global din Setări
      AND market_push_enabled                   -- comutatorul de Market (8 sept)
      AND NOT is_block_between(NEW.seller_id, app.profiles.id)  -- Faza 18
  LOOP
    PERFORM notify_push(
      v_user.id,
      push_text(v_user.lang, 'market_title'),
      v_body,
      jsonb_build_object('type', 'listing', 'id', NEW.id)
    );
  END LOOP;

  RETURN NEW;
END;
$function$
;

-- public.on_message_notify: trigger
CREATE OR REPLACE FUNCTION public.on_message_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_recipient uuid;
  v_sender    text;
  v_lang      text;
  v_cursor    timestamptz;
  v_count     integer;
  v_body      text;
  v_title     text;
  v_ios_title text;
  v_line_new  text;
  v_kind      text;
  v_data      jsonb;
BEGIN
  SELECT CASE WHEN c.driver_id = NEW.sender_id THEN c.mechanic_id ELSE c.driver_id END
    INTO v_recipient
  FROM conversations c
  WHERE c.id = NEW.conversation_id;

  IF v_recipient IS NULL OR v_recipient = NEW.sender_id THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO v_sender FROM app.profiles WHERE id = NEW.sender_id;
  v_lang := user_lang(v_recipient);

  v_line_new := CASE
    WHEN NEW.content IS NOT NULL AND NEW.content <> '' THEN left(NEW.content, 120)
    WHEN NEW.file_name IS NOT NULL
         AND lower(NEW.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                     THEN '🎥 ' || left(NEW.file_name, 118)
    WHEN NEW.file_name IS NOT NULL THEN '📎 ' || left(NEW.file_name, 118)
    WHEN NEW.listing_id IS NOT NULL THEN '🏷️'
    WHEN NEW.recommended_mechanic_id IS NOT NULL THEN '👤'
    WHEN NEW.announcement_id IS NOT NULL THEN '📍'
    ELSE push_text(v_lang, 'photo')
  END;

  SELECT last_read_at INTO v_cursor
    FROM message_reads
   WHERE conversation_id = NEW.conversation_id AND user_id = v_recipient;

  SELECT count(*) INTO v_count
    FROM messages m
   WHERE m.conversation_id = NEW.conversation_id
     AND m.sender_id = NEW.sender_id
     AND m.deleted_at IS NULL
     AND (v_cursor IS NULL OR m.created_at > v_cursor);

  SELECT string_agg(sub.line, E'\n' ORDER BY sub.created_at ASC) INTO v_body
  FROM (
    SELECT m.created_at,
           CASE
             WHEN m.content IS NOT NULL AND m.content <> '' THEN left(m.content, 120)
             WHEN m.file_name IS NOT NULL
                  AND lower(m.file_name) ~ '\.(mp4|mov|m4v|webm|3gp)$'
                                              THEN '🎥 ' || left(m.file_name, 118)
             WHEN m.file_name IS NOT NULL THEN '📎 ' || left(m.file_name, 118)
             WHEN m.listing_id IS NOT NULL THEN '🏷️'
             WHEN m.recommended_mechanic_id IS NOT NULL THEN '👤'
             WHEN m.announcement_id IS NOT NULL THEN '📍'
             ELSE push_text(v_lang, 'photo')
           END AS line
    FROM messages m
    WHERE m.conversation_id = NEW.conversation_id
      AND m.sender_id = NEW.sender_id
      AND m.deleted_at IS NULL
      AND (v_cursor IS NULL OR m.created_at > v_cursor)
    ORDER BY m.created_at DESC
    LIMIT 5
  ) sub;

  IF v_body IS NULL THEN
    v_count := 1;
    v_body  := v_line_new;
  END IF;

  -- 27 oct 2026: mesajul e reply la destinatar sau îl menționează → titlu explicit.
  v_kind := NULL;
  IF NEW.reply_to_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM messages q WHERE q.id = NEW.reply_to_id AND q.sender_id = v_recipient) THEN
    v_kind := 'reply';
  ELSIF jsonb_typeof(NEW.mentions) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mentions) e WHERE e->>'id' = v_recipient::text) THEN
    v_kind := 'mention';
  END IF;

  v_data := jsonb_build_object('type', 'conversation', 'id', NEW.conversation_id);
  IF v_kind IS NOT NULL THEN
    v_title     := format(push_text(v_lang, v_kind || '_title'), left(COALESCE(v_sender, ''), 24));
    v_ios_title := v_title;
    v_data      := v_data || jsonb_build_object('message_id', NEW.id, 'kind', v_kind);
  ELSE
    v_title := COALESCE(v_sender, '');
    IF v_count > 1 THEN
      v_title := v_title || ' (' || v_count || ')';
    END IF;
    v_ios_title := COALESCE(v_sender, '');
  END IF;

  PERFORM notify_push(
    v_recipient,
    v_title,
    v_body,
    v_data,
    'conversation-' || NEW.conversation_id,
    v_ios_title,
    v_line_new
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'on_message_notify: % (mesaj %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$function$
;

-- public.recompute_mechanic_rating: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.recompute_mechanic_rating(p_mechanic uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  UPDATE app.profiles p SET
    rating_avg   = coalesce((SELECT round(avg(stars)::numeric, 1) FROM ratings WHERE mechanic_id = p_mechanic), 0),
    rating_count = (SELECT count(*) FROM ratings WHERE mechanic_id = p_mechanic)
  WHERE p.id = p_mechanic;
$function$
;
REVOKE EXECUTE ON FUNCTION public.recompute_mechanic_rating(p_mechanic uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_mechanic_rating(p_mechanic uuid) TO service_role;

-- public.record_announcement_view: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.record_announcement_view(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR is_admin() THEN RETURN; END IF;
  INSERT INTO announcement_views (announcement_id, viewer_id)
  SELECT a.id, auth.uid()
    FROM app.announcements a
   WHERE a.id = p_announcement_id
     AND a.driver_id IS DISTINCT FROM auth.uid()
  ON CONFLICT DO NOTHING;
END; $function$
;
REVOKE EXECUTE ON FUNCTION public.record_announcement_view(p_announcement_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_announcement_view(p_announcement_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_announcement_view(p_announcement_id uuid) TO service_role;

-- public.reject_application: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.reject_application(p_application_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE applications
  SET status = 'rejected'
  WHERE id = p_application_id
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM app.announcements ann
      JOIN applications a ON a.announcement_id = ann.id
      WHERE a.id = p_application_id
        AND ann.driver_id = auth.uid()
        AND ann.status = 'open'
    );
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.reject_application(p_application_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_application(p_application_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_application(p_application_id uuid) TO service_role;

-- public.repost_announcement: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.repost_announcement(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row app.announcements;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE app.announcements
     SET status = 'open',
         created_at = now()
   WHERE id = p_announcement_id
     AND driver_id = auth.uid()
     AND status = 'cancelled'
     AND created_at < now() - interval '30 hours'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  PERFORM notify_mechanics_new_announcement(v_row);
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.repost_announcement(p_announcement_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repost_announcement(p_announcement_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.repost_announcement(p_announcement_id uuid) TO service_role;

-- public.resolve_open_announcement: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.resolve_open_announcement(p_announcement_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE app.announcements
     SET status = 'resolved'
   WHERE id = p_announcement_id
     AND driver_id = auth.uid()
     AND status IN ('open', 'cancelled');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  UPDATE applications
     SET status = 'rejected'
   WHERE announcement_id = p_announcement_id
     AND status = 'pending';
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.resolve_open_announcement(p_announcement_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_open_announcement(p_announcement_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_open_announcement(p_announcement_id uuid) TO service_role;

-- public.resubmit_application: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.resubmit_application(p_application_id uuid, p_price_type text, p_price_amount numeric, p_currency text DEFAULT 'RON'::text, p_message text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE applications a
  SET status       = 'pending',
      price_type   = p_price_type,
      price_amount = p_price_amount,
      currency     = p_currency,
      message      = p_message
  FROM app.announcements ann
  WHERE a.id              = p_application_id
    AND a.mechanic_id     = auth.uid()
    AND a.status          = 'rejected'
    AND a.announcement_id = ann.id
    AND ann.status        = 'open'
    AND NOT is_block_between(a.mechanic_id, ann.driver_id);   -- Faza 18: perechea blocată nu recandidează
  IF NOT FOUND THEN
    RAISE EXCEPTION 'application_not_resubmittable';
  END IF;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.resubmit_application(p_application_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_application(p_application_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_application(p_application_id uuid, p_price_type text, p_price_amount numeric, p_currency text, p_message text) TO service_role;

-- public.search_mechanics: SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.search_mechanics(p_query text)
 RETURNS TABLE(id uuid, full_name text, specialization text, activity_zone text, rating_avg numeric, rating_count integer, avatar_path text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p.id, p.full_name, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM app.profiles p
  WHERE p.role = 'mechanic'
    AND p.deleted_at IS NULL
    AND NOT is_block_between(p.id, auth.uid())
    AND app.search_norm(p.full_name) LIKE '%' || app.like_escape(app.search_norm(p_query)) || '%' ESCAPE '\'
  ORDER BY p.full_name
  LIMIT 30;
$function$
;
REVOKE EXECUTE ON FUNCTION public.search_mechanics(p_query text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_mechanics(p_query text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_mechanics(p_query text) TO service_role;

-- public.search_users: SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.search_users(p_query text)
 RETURNS TABLE(id uuid, full_name text, role text, specialization text, activity_zone text, rating_avg numeric, rating_count integer, avatar_path text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'extensions'
AS $function$
  SELECT p.id, p.full_name, p.role::text, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM app.profiles p
  WHERE p.role IN ('driver', 'mechanic')
    AND p.deleted_at IS NULL
    AND p.id <> auth.uid()
    AND NOT is_block_between(p.id, auth.uid())
    AND app.search_norm(p.full_name) LIKE '%' || app.like_escape(app.search_norm(p_query)) || '%' ESCAPE '\'
  ORDER BY p.full_name
  LIMIT 30;
$function$
;
REVOKE EXECUTE ON FUNCTION public.search_users(p_query text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_users(p_query text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_users(p_query text) TO service_role;

-- public.seed_channel_push_prefs_for_channel: trigger
CREATE OR REPLACE FUNCTION public.seed_channel_push_prefs_for_channel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO channel_push_prefs (user_id, channel_id, enabled)
  SELECT p.id, NEW.id, true FROM app.profiles p WHERE p.deleted_at IS NULL
  ON CONFLICT (user_id, channel_id) DO NOTHING;
  RETURN NEW;
END;
$function$
;

-- public.set_announcements_hidden: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.set_announcements_hidden(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE app.announcements a
     SET hidden_from_history = true
   WHERE a.driver_id = auth.uid()
     AND a.hidden_from_history = false
     AND (p_ids IS NULL OR a.id = ANY(p_ids));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.set_announcements_hidden(p_ids uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_announcements_hidden(p_ids uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_announcements_hidden(p_ids uuid[]) TO service_role;

-- public.start_direct_conversation: SECURITY DEFINER
CREATE OR REPLACE FUNCTION public.start_direct_conversation(p_mechanic_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_conv   uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_mechanic_id = v_caller THEN
    RAISE EXCEPTION 'cannot_contact_self';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.profiles WHERE id = p_mechanic_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target_not_mechanic';
  END IF;

  IF is_blocked_by(v_caller, p_mechanic_id) THEN
    RAISE EXCEPTION 'blocked_by_you';
  END IF;
  IF is_blocked_by(p_mechanic_id, v_caller) THEN
    RAISE EXCEPTION 'target_not_mechanic';   -- identic cu inexistent — nedetectabil
  END IF;

  SELECT id INTO v_conv
  FROM conversations
  WHERE is_direct
    AND ((driver_id = v_caller AND mechanic_id = p_mechanic_id)
      OR (driver_id = p_mechanic_id AND mechanic_id = v_caller))
  LIMIT 1;

  IF NOT FOUND THEN
    -- Trigger-ul ban_guard_ins de pe conversations se aplică și aici.
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id, is_direct)
    VALUES (NULL, v_caller, p_mechanic_id, true)
    RETURNING id INTO v_conv;
  END IF;

  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv AND user_id = v_caller;

  RETURN v_conv;
END;
$function$
;
REVOKE EXECUTE ON FUNCTION public.start_direct_conversation(p_mechanic_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_direct_conversation(p_mechanic_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_direct_conversation(p_mechanic_id uuid) TO service_role;

-- public.user_lang: SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.user_lang(p_user_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$ SELECT COALESCE(lang, 'ro') FROM app.profiles WHERE id = p_user_id; $function$
;
REVOKE EXECUTE ON FUNCTION public.user_lang(p_user_id uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_lang(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_lang(p_user_id uuid) TO service_role;

-- ── 9. get_own_profile(): pe tipul VIEW-ULUI public.profiles (gen:types îl vede; 1.1 îl apelează). Citește
--       tabelul direct: SECURITY DEFINER + propriul rând → toate coloanele, ca înainte. ACL-ul se pune la loc
--       explicit (DROP l-a pierdut): authenticated + service_role, ca în producție (allowlist pgTAP).
CREATE FUNCTION public.get_own_profile()
 RETURNS SETOF public.profiles
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.full_name, p.role, p.created_at, p.specialization, p.activity_zone, p.phone, p.rating_avg,
         p.rating_count, p.avatar_path, p.push_enabled, p.notify_radius_km, p.latitude, p.longitude, p.lang,
         p.deleted_at, p.company_name, p.contact_email, p.banned_at, p.banned_until, p.ban_reason, p.address,
         p.vat_number, p.market_push_enabled, p.mention_push_enabled
    FROM app.profiles p WHERE p.id = auth.uid();
$function$;
REVOKE EXECUTE ON FUNCTION public.get_own_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_own_profile() TO service_role;

-- ── 10. Verificări (pică tranzacția dacă ceva nu e cum trebuie) ───────────────────────────────────
DO $$
DECLARE
  v_bad text;
BEGIN
  -- a) view-urile au exact coloanele tabelelor, în aceeași ordine
  SELECT string_agg(x.rel || '#' || x.attnum || ' ' || coalesce(x.v, '∅') || ' vs ' || coalesce(x.t, '∅'), ', ') INTO v_bad
    FROM (
      SELECT 'profiles' AS rel, coalesce(v.attnum, t.attnum) AS attnum, v.attname AS v, t.attname AS t
        FROM (SELECT attnum, attname FROM pg_attribute WHERE attrelid = 'public.profiles'::regclass AND attnum > 0 AND NOT attisdropped) v
        FULL JOIN (SELECT attnum, attname FROM pg_attribute WHERE attrelid = 'app.profiles'::regclass AND attnum > 0 AND NOT attisdropped) t
          ON t.attnum = v.attnum
       WHERE v.attname IS DISTINCT FROM t.attname
      UNION ALL
      SELECT 'announcements', coalesce(v.attnum, t.attnum), v.attname, t.attname
        FROM (SELECT attnum, attname FROM pg_attribute WHERE attrelid = 'public.announcements'::regclass AND attnum > 0 AND NOT attisdropped) v
        FULL JOIN (SELECT attnum, attname FROM pg_attribute WHERE attrelid = 'app.announcements'::regclass AND attnum > 0 AND NOT attisdropped) t
          ON t.attnum = v.attnum
       WHERE v.attname IS DISTINCT FROM t.attname
    ) x;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'private_tables: coloanele view-urilor diferă de tabele: %', v_bad; END IF;

  -- b) nicio funcție din public/app nu mai referă profiles/announcements necalificat sau prin view (public.*);
  --    literalii și comentariile sunt ignorate (aceeași regulă e în pgTAP).
  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'app') AND p.prokind = 'f'
     AND regexp_replace(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', ' ', 'g'), '/\*.*?\*/', ' ', 'g'), '''(?:[^'']|'''')*''', ' ', 'g')
         ~ '(^|[^[:alnum:]_.])(profiles|announcements)([^[:alnum:]_]|$)|public\.(profiles|announcements)([^[:alnum:]_]|$)';
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'private_tables: funcții cu referințe necalificate la profiles/announcements: %', v_bad; END IF;

  -- c) politicile, triggerele și FK-urile au urmat tabelele (nimic nu a rămas „în aer”)
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'app' AND tablename IN ('profiles', 'announcements')) <> 16 THEN
    RAISE EXCEPTION 'private_tables: politicile pe app.profiles/app.announcements: % (așteptat 16)',
      (SELECT count(*) FROM pg_policies WHERE schemaname = 'app' AND tablename IN ('profiles', 'announcements'));
  END IF;
  IF (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('app.profiles'::regclass, 'app.announcements'::regclass)) <> 37 THEN
    RAISE EXCEPTION 'private_tables: FK-urile către app.profiles/app.announcements: % (așteptat 37)',
      (SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND confrelid IN ('app.profiles'::regclass, 'app.announcements'::regclass));
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.profiles'::regclass)
     OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'app.announcements'::regclass) THEN
    RAISE EXCEPTION 'private_tables: RLS inactiv pe tabelele mutate';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.profiles'::regclass, 'public.announcements'::regclass)) <> 6 THEN
    RAISE EXCEPTION 'private_tables: triggerele INSTEAD OF lipsesc';
  END IF;
  -- d) tipul view-ului e cel întors de get_own_profile(); notify_mechanics_new_announcement e pe tipul tabelului
  IF (SELECT prorettype FROM pg_proc WHERE oid = 'public.get_own_profile()'::regprocedure) <> 'public.profiles'::regtype THEN
    RAISE EXCEPTION 'private_tables: get_own_profile nu întoarce public.profiles (view)';
  END IF;
  IF to_regprocedure('public.notify_mechanics_new_announcement(app.announcements)') IS NULL THEN
    RAISE EXCEPTION 'private_tables: notify_mechanics_new_announcement nu e pe tipul app.announcements';
  END IF;
END $$;

-- ── 11. PostgREST reîncarcă schema (view-urile noi, relațiile pentru embed-uri) ─────────────────────
NOTIFY pgrst, 'reload schema';
