-- 20261013_client_diagnostics.sql — jurnal de diagnostic de rețea trimis din aplicație
-- (13 oct 2026). Idempotent: se poate rula de oricâte ori.
--
-- Context: un utilizator (iPhone, 5G) vedea „Network request failed" la login de
-- câteva zile și nu puteam ști de la ce. Aplicația rulează acum un diagnostic
-- (3 sonde: API-ul Supabase, trucksos.net, un host neutru + drift de ceas) și
-- afișează pașii potriviți; rezultatul se pune într-o coadă LOCALĂ pe telefon
-- (serverul e tocmai inaccesibil în acel moment) și se urcă aici la prima
-- conectare reușită. Scop: să vedem, pe toți utilizatorii, de la ce vin erorile
-- de conectare (date mobile oprite pentru app, VPN/DNS, ceas, rețea) și să
-- optimizăm. Doar date tehnice; fără conținut personal (vezi politica de
-- confidențialitate, „Date tehnice").
--
-- Securitate (regula din 26 sept): RLS pornit; INSERT doar pentru rândurile
-- proprii (authenticated), SELECT doar admini; anon n-are nimic. Fără RPC nou.

CREATE TABLE IF NOT EXISTS public.client_diagnostics (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  occurred_at    timestamptz NOT NULL,                       -- când a rulat diagnosticul pe telefon
  uploaded_at    timestamptz NOT NULL DEFAULT now(),         -- când a ajuns la noi
  kind           text        NOT NULL CHECK (length(kind) <= 40),          -- login / register / reset_request / ...
  diagnosis      text        NOT NULL CHECK (length(diagnosis) <= 20),     -- offline / blocked / clock / ok
  error_message  text        CHECK (length(error_message) <= 500),         -- mesajul brut al erorii
  probes         jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- {api:{reachable,ms,status,error}, web:{...}, neutral:{...}}
  network        jsonb,                                      -- {type, isConnected, isInternetReachable} (expo-network)
  clock_drift_ms integer,                                    -- ceasul telefonului − ceasul serverului
  platform       text        CHECK (length(platform) <= 16),
  os_version     text        CHECK (length(os_version) <= 40),
  device_model   text        CHECK (length(device_model) <= 80),
  app_version    text        CHECK (length(app_version) <= 20),
  locale         text        CHECK (length(locale) <= 10)
);

CREATE INDEX IF NOT EXISTS client_diagnostics_occurred_idx
  ON public.client_diagnostics (occurred_at DESC);
CREATE INDEX IF NOT EXISTS client_diagnostics_user_idx
  ON public.client_diagnostics (user_id, occurred_at DESC);

ALTER TABLE public.client_diagnostics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_diagnostics_insert_own ON public.client_diagnostics;
CREATE POLICY client_diagnostics_insert_own ON public.client_diagnostics
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS client_diagnostics_select_admin ON public.client_diagnostics;
CREATE POLICY client_diagnostics_select_admin ON public.client_diagnostics
  FOR SELECT TO authenticated
  USING (is_admin());

REVOKE ALL ON public.client_diagnostics FROM anon;
GRANT INSERT, SELECT ON public.client_diagnostics TO authenticated;

-- Retenție: 90 de zile (ca în politica de confidențialitate). cron.schedule cu
-- același nume înlocuiește jobul existent → idempotent. Ora 03:41 UTC, zilnic.
SELECT cron.schedule(
  'cleanup-client-diagnostics-daily',
  '41 3 * * *',
  $JOB$ DELETE FROM public.client_diagnostics WHERE occurred_at < now() - interval '90 days'; $JOB$
);

-- ── Verificare ─────────────────────────────────────────────────────────────────
-- Așteptat: rls=true, policies=2, anon_privs=0, cron_job=1.
SELECT
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.client_diagnostics'::regclass) AS rls,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'client_diagnostics') AS policies,
  (SELECT count(*) FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name = 'client_diagnostics' AND grantee = 'anon') AS anon_privs,
  (SELECT count(*) FROM cron.job WHERE jobname = 'cleanup-client-diagnostics-daily') AS cron_job;

-- ── Interogări utile (admin, Studio) ───────────────────────────────────────────
-- Ultimele 50 de diagnostice:
--   SELECT occurred_at, kind, diagnosis, platform, os_version, app_version,
--          network->>'type' AS net, probes->'api'->>'error' AS api_error, error_message
--     FROM client_diagnostics ORDER BY occurred_at DESC LIMIT 50;
-- Distribuție pe verdict și platformă (30 zile):
--   SELECT diagnosis, platform, count(*) FROM client_diagnostics
--    WHERE occurred_at > now() - interval '30 days' GROUP BY 1, 2 ORDER BY 3 DESC;
