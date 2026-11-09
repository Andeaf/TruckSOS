-- Rollback pentru 20261109000100_announcement_drafts (faza 6): CHECK-ul vechi de status, garda și limita la textele originale, politica și trigger-ul de publicare scoase. ATENȚIE: ciornele existente sunt ȘTERSE (CHECK-ul vechi nu le-ar accepta).
-- Generat de .claude/wip/faza6/gen-rollbacks.mjs; funcțiile restaurate sunt copiate byte cu byte din migrările originale.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;). Ordinea rollback-urilor fazei 6: 600 → 500 → 400 → 300 → 200 → 100.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('app.apply_retention(boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback 100: 20261109000500_retention e aplicata (sterge ciornele) - ruleaza intai rollback-ul ei';
  END IF;
END $$;

DROP TRIGGER IF EXISTS announcements_notify_publish ON app.announcements;
DROP POLICY IF EXISTS announcements_update_publish ON app.announcements;

-- Ciornele (status nou) nu pot rămâne sub CHECK-ul vechi: pozele lor ar rămâne orfane în Storage (le prinde storage-gc / lista de orfani).
DELETE FROM app.announcements WHERE status = 'draft';

ALTER TABLE app.announcements DROP CONSTRAINT announcements_status_check;
ALTER TABLE app.announcements ADD CONSTRAINT announcements_status_check
  CHECK (status = ANY (ARRAY['open'::text, 'accepted'::text, 'resolved'::text, 'cancelled'::text]));

-- guard_announcement_client_writes: textul din baseline
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
    NEW.status              := 'open';
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
  RETURN NEW;
END; $function$;
REVOKE ALL ON FUNCTION public.guard_announcement_client_writes() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_announcement_client_writes() TO service_role;

-- app.limit_announcements: textul din 20261101000100
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'app.announcements'::regclass AND tgname = 'announcements_notify_publish') THEN RAISE EXCEPTION 'trigger-ul de publicare a ramas'; END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'app.announcements'::regclass AND conname = 'announcements_status_check') LIKE '%draft%' THEN RAISE EXCEPTION 'CHECK-ul mai contine draft'; END IF;
  IF (SELECT prosrc FROM pg_proc WHERE oid = 'public.guard_announcement_client_writes()'::regprocedure) LIKE '%draft%' THEN RAISE EXCEPTION 'garda mai contine draft'; END IF;
END $$;
NOTIFY pgrst, 'reload schema';
