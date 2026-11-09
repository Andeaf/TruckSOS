-- Faza 6 / 7.2 (PLAN_1.1_FIX #30, §8 pct 3; plan: .claude/wip/faza6/PLAN-faza6.md): starea `draft` pentru anunțurile de
-- depanare. Clientul 1.1 creează anunțul ca ciornă, urcă pozele (3 în paralel, în folderul anunțului), apoi îl publică
-- (`draft → open`); push-ul către mecanici pleacă la PUBLICARE, cu pozele deja în Storage.
--
-- Ce rămâne IDENTIC pentru 1.0.6–1.0.8: INSERT-ul lor nu trimite `status` (sau trimite `open`) → garda îl forțează `open`
-- exact ca azi, push-ul pleacă la INSERT ca azi (trigger-ul AFTER INSERT neschimbat). Ciornele nu sunt vizibile
-- mecanicilor, oaspeților, feed-ului sau hărții (toate filtrează `status = 'open'`); șoferul și le vede în propriile
-- anunțuri (RLS `driver_id = auth.uid()`), iar clientul 1.1 le ascunde din listă (sunt tranzitorii).
-- Ciornele mai vechi de 24 h sunt șterse de app.apply_retention() (20261109000500).
--
-- Rollback: supabase/rollback/20261109000100_announcement_drafts.sql (CHECK-ul vechi, funcțiile vechi byte cu byte,
-- politica și trigger-ul scoase; ciornele existente sunt ȘTERSE de rollback — altfel CHECK-ul vechi n-ar putea fi repus).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- ── 0. Precondiții ───────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('app.announcements') IS NULL THEN
    RAISE EXCEPTION 'cere faza 4 (app.announcements)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'announcements' AND policyname = 'announcements_update_publish') THEN
    RAISE EXCEPTION 'announcements_update_publish exista deja: migrarea a fost aplicata?';
  END IF;
END $$;

-- ── 1. CHECK-ul de status primește `draft` ──────────────────────────────────────────────────────────
-- ADD CONSTRAINT validează rândurile existente (toate sunt în setul vechi) sub lock ACCESS EXCLUSIVE scurt pe un tabel mic;
-- lock_timeout = 5s face migrarea să PICE, nu să aștepte, dacă cineva ține un lock pe tabel — se reia.
ALTER TABLE app.announcements DROP CONSTRAINT announcements_status_check;
ALTER TABLE app.announcements ADD CONSTRAINT announcements_status_check
  CHECK (status = ANY (ARRAY['draft'::text, 'open'::text, 'accepted'::text, 'resolved'::text, 'cancelled'::text]));

-- ── 2. Garda scrierilor de client: `draft` e singurul status pe care clientul îl poate alege la INSERT ──
-- Textul din baseline, cu o singură linie schimbată (NEW.status). UPDATE-ul rămâne identic.
CREATE OR REPLACE FUNCTION public.guard_announcement_client_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- 7.2: clientul 1.1 trimite 'draft' (pozele se urcă înainte de publicare); orice altceva (1.0.x nu trimite nimic
    -- sau trimite 'open') devine 'open', ca înainte.
    NEW.status              := CASE WHEN NEW.status = 'draft' THEN 'draft' ELSE 'open' END;
    NEW.mechanic_id         := NULL;
    NEW.created_at          := now();
    NEW.hidden_from_history := false;
    RETURN NEW;
  END IF;

  IF NEW.id          IS DISTINCT FROM OLD.id
  OR NEW.driver_id   IS DISTINCT FROM OLD.driver_id
  OR NEW.mechanic_id IS DISTINCT FROM OLD.mechanic_id
  OR NEW.created_at  IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'announcement_update_forbidden';
  END IF;
  -- 7.2 (review 9 nov): politicile PERMISSIVE de UPDATE se combină cu OR separat pe USING și pe WITH CHECK, deci
  -- adăugarea politicii de publicare (USING draft / CHECK open) ar fi permis și open → open (editarea unui anunț deja
  -- trimis mecanicilor) sau accepted → open. Mașina de stări a clientului rămâne cea de azi + publicarea:
  --   draft → open (publicare), open → cancelled, accepted → resolved; nimic altceva.
  IF NEW.status = 'open' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'announcement_update_forbidden';
  END IF;
  IF OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'open') THEN
    RAISE EXCEPTION 'announcement_update_forbidden';
  END IF;
  -- Publicarea: anunțul „se naște” acum pentru feed (ordine) și pentru expirarea la 30 h din cleanup-announcements.
  IF OLD.status = 'draft' AND NEW.status = 'open' THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END; $function$;

-- ── 3. Limitele: plafonul de deschise se verifică la DESCHIDERE (INSERT `open` sau UPDATE `draft`/`cancelled` → `open`);
--       plafoanele 10/24 h și 30/7 z rămân la INSERT (o ciornă abandonată consumă o încercare — decizia D1) ──
-- Textul din 20261101000100, cu condițiile de mai jos rescrise. Trigger-ul rămâne BEFORE INSERT OR UPDATE OF status.
CREATE OR REPLACE FUNCTION app.limit_announcements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF pg_trigger_depth() > (CASE WHEN current_setting('app.via_view', true) = 'on' THEN 2 ELSE 1 END) THEN RETURN NEW; END IF;
  -- UPDATE: contează doar deschiderea (repost_announcement: cancelled → open; publicarea 7.2: draft → open).
  IF TG_OP = 'UPDATE' AND (NEW.status IS DISTINCT FROM 'open' OR OLD.status = 'open') THEN RETURN NEW; END IF;
  -- Cel mult 5 deschise simultan (29 oct 2026) — verificat când rândul DEVINE `open`: la UPDATE (de mai sus) sau la
  -- INSERT cu orice status în afară de 'draft'. ATENȚIE la ordinea triggerelor (alfabetică): `aaa_rate_limit` rulează
  -- ÎNAINTEA gărzii `announcements_guard_client`, deci aici NEW.status e valoarea brută a clientului — un INSERT cu
  -- 'resolved' sau 'cancelled' va fi forțat 'open' de gardă imediat după, așa că îl numărăm ca deschidere (altfel
  -- plafonul s-ar ocoli exact ca în corecția 20261031000200). Doar 'draft' nu ocupă un loc.
  IF (TG_OP = 'UPDATE' OR NEW.status IS DISTINCT FROM 'draft')
     AND (SELECT count(*) FROM app.announcements WHERE driver_id = auth.uid() AND status = 'open' AND id <> NEW.id) >= 5 THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements_open';
  END IF;
  -- Ritmul (10/24 h, 30/7 z): la INSERT, indiferent de status (ciorna consumă o încercare; publicarea ei nu mai
  -- consumă), și la UPDATE-urile care deschid fără să vină dintr-o ciornă (repostul cancelled → open, ca azi — review
  -- 9 nov: altfel repostul în lanț ar fi ocolit cotele).
  IF (TG_OP = 'INSERT' OR OLD.status <> 'draft')
     AND (NOT app.rate_limit_ok('announcement_day', interval '24 hours', 10)
          OR NOT app.rate_limit_ok('announcement_week', interval '7 days', 30)) THEN
    RAISE EXCEPTION 'rate_limited' USING DETAIL = 'announcements';
  END IF;
  RETURN NEW;
END; $function$;

-- ── 4. Politica de publicare: șoferul își trece propria ciornă în `open` (și numai asta) ────────────
CREATE POLICY announcements_update_publish ON app.announcements AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((driver_id = (SELECT auth.uid())) AND (status = 'draft'::text))
  WITH CHECK ((driver_id = (SELECT auth.uid())) AND (status = 'open'::text));

-- ── 5. Push-ul la publicare: AFTER UPDATE doar pe tranziția draft → open (repostul cancelled → open NU trece pe aici) ──
-- on_announcement_notify() e neschimbată (testează NEW.status = 'open' și apelează notify_mechanics_new_announcement).
CREATE TRIGGER announcements_notify_publish
  AFTER UPDATE OF status ON app.announcements
  FOR EACH ROW
  WHEN (OLD.status = 'draft' AND NEW.status = 'open')
  EXECUTE FUNCTION public.on_announcement_notify();

-- ── 6. Verificări ───────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'app.announcements'::regclass AND conname = 'announcements_status_check'
                   AND pg_get_constraintdef(oid) LIKE '%draft%') THEN
    RAISE EXCEPTION 'CHECK-ul de status nu contine draft';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.guard_announcement_client_writes()'::regprocedure;
  IF v_src NOT LIKE '%WHEN NEW.status = ''draft'' THEN ''draft''%' THEN
    RAISE EXCEPTION 'garda nu accepta draft';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'app.announcements'::regclass AND tgname = 'announcements_notify_publish') THEN
    RAISE EXCEPTION 'trigger-ul de publicare lipseste';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'app.announcements'::regclass AND tgname = 'announcements_notify') THEN
    RAISE EXCEPTION 'trigger-ul AFTER INSERT (1.0.x) a disparut';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
