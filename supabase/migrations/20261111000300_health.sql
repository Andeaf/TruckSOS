-- Faza 9.4 (plan: .claude/wip/faza9/PLAN-faza9.md, APROBAT de David 9 nov 2026): observabilitate de server pentru panoul admin.
-- RPC public.admin_health() (is_admin, SECURITY DEFINER) → jsonb cu:
--   push                    — app.push_stats() (faza 3): coada, expirate, 401-urile kick-urilor;
--   storage_gc              — coada de ștergere Storage (faza 6.2): câte rânduri, cel mai vechi, câte mai vechi de 48 h
--                             (> 0 = EF storage-gc nu șterge: STORAGE_GC_APPLY lipsă sau cron picat — precondiția C9.1);
--   retention_last          — ultima rulare a cron-ului `apply-retention-daily` (status, ora, mesajul);
--   cron_failed_24h         — joburile pg_cron cu rulări `failed` în ultimele 24 h;
--   client_errors           — erorile client din 24 h / 7 zile, DOAR dacă există app.client_errors (9.1);
--   public_reports_pending  — sesizările publice în așteptare, DOAR dacă există reports.source (faza 8.3).
-- Ultimele două sunt citite cu SQL dinamic, ca 9.4 să nu depindă de 9.1 și de faza 8 (ordinea de aplicare e liberă).
-- Fiecare secțiune e în blocul ei cu EXCEPTION: o secțiune indisponibilă (de ex. net._http_response ilizibil) apare ca
-- `<secțiune>_error`, restul răspunsului rămâne. Funcția nu întoarce secrete, text de utilizator sau id-uri de cont.
-- Clienții 1.0.6–1.0.8: nimic (funcție nouă, neapelată).
-- Rollback: supabase/rollback/20261111000300_health.sql (DROP FUNCTION).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regprocedure('app.push_stats()') IS NULL THEN RAISE EXCEPTION 'cere faza 3 (app.push_stats)'; END IF;
  IF to_regclass('app.storage_gc_queue') IS NULL THEN RAISE EXCEPTION 'cere faza 6 (app.storage_gc_queue)'; END IF;
  IF to_regprocedure('public.is_admin(uuid)') IS NULL THEN RAISE EXCEPTION 'cere public.is_admin'; END IF;
  IF to_regprocedure('public.admin_health()') IS NOT NULL THEN RAISE EXCEPTION 'admin_health exista deja: migrarea a fost aplicata?'; END IF;
END $$;

CREATE FUNCTION public.admin_health()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_out jsonb := jsonb_build_object('generated_at', now());
  v_j   jsonb;
  v_n   bigint;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  -- 1. coada de push (faza 3)
  BEGIN
    SELECT to_jsonb(s) INTO v_j FROM app.push_stats() s;
    v_out := v_out || jsonb_build_object('push', v_j);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('push', NULL, 'push_error', SQLERRM);
  END;

  -- 2. coada de ștergere Storage (faza 6.2)
  BEGIN
    SELECT jsonb_build_object('queued', count(*), 'oldest_at', min(q.created_at),
                              'stale_48h', count(*) FILTER (WHERE q.created_at < now() - interval '48 hours'))
      INTO v_j
      FROM app.storage_gc_queue q;
    v_out := v_out || jsonb_build_object('storage_gc', v_j);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('storage_gc', NULL, 'storage_gc_error', SQLERRM);
  END;

  -- 3. ultima rulare a retenției (NULL dacă n-a rulat încă sau istoricul a fost curățat)
  BEGIN
    v_j := NULL;
    SELECT jsonb_build_object('status', d.status, 'end_time', d.end_time, 'message', left(d.return_message, 2000))
      INTO v_j
      FROM cron.job_run_details d
      JOIN cron.job j ON j.jobid = d.jobid
     WHERE j.jobname = 'apply-retention-daily'
     ORDER BY d.start_time DESC NULLS LAST
     LIMIT 1;
    v_out := v_out || jsonb_build_object('retention_last', v_j);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('retention_last', NULL, 'retention_last_error', SQLERRM);
  END;

  -- 4. joburile cron eșuate în ultimele 24 h
  BEGIN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('jobname', f.jobname, 'failures', f.failures, 'last_at', f.last_at,
                                                 'last_message', f.last_message)
                              ORDER BY f.last_at DESC), '[]'::jsonb)
      INTO v_j
      FROM (SELECT COALESCE(j.jobname, 'job ' || d.jobid::text) AS jobname,
                   count(*) AS failures,
                   max(d.start_time) AS last_at,
                   left((array_agg(d.return_message ORDER BY d.start_time DESC))[1], 300) AS last_message
              FROM cron.job_run_details d
              LEFT JOIN cron.job j ON j.jobid = d.jobid
             WHERE d.status = 'failed' AND d.start_time > now() - interval '24 hours'
             GROUP BY COALESCE(j.jobname, 'job ' || d.jobid::text)) f;
    v_out := v_out || jsonb_build_object('cron_failed_24h', v_j);
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('cron_failed_24h', '[]'::jsonb, 'cron_failed_24h_error', SQLERRM);
  END;

  -- 5. erorile client (9.1) — doar dacă tabelul există
  BEGIN
    IF to_regclass('app.client_errors') IS NOT NULL THEN
      EXECUTE $q$
        SELECT jsonb_build_object('h24', count(*) FILTER (WHERE e.created_at > now() - interval '24 hours'),
                                  'd7',  count(*) FILTER (WHERE e.created_at > now() - interval '7 days'))
          FROM app.client_errors e
      $q$ INTO v_j;
      v_out := v_out || jsonb_build_object('client_errors', v_j);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('client_errors', NULL, 'client_errors_error', SQLERRM);
  END;

  -- 6. sesizările publice în așteptare (faza 8.3) — doar dacă există coloana reports.source
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                WHERE a.attrelid = 'public.reports'::regclass AND a.attname = 'source' AND NOT a.attisdropped) THEN
      EXECUTE $q$ SELECT count(*) FROM public.reports r WHERE r.source = 'public' AND r.status = 'pending' $q$ INTO v_n;
      v_out := v_out || jsonb_build_object('public_reports_pending', v_n);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('public_reports_pending', NULL, 'public_reports_pending_error', SQLERRM);
  END;

  RETURN v_out;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_health() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_health() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_health() TO service_role;

DO $$
BEGIN
  IF has_function_privilege('anon', 'public.admin_health()', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_health nu trebuie sa fie executabil de anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.admin_health()', 'EXECUTE') THEN
    RAISE EXCEPTION 'admin_health trebuie sa fie executabil de authenticated (verificarea is_admin e in functie)';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
