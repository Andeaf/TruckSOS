-- Faza 6 / 7.10 (PLAN_1.1_FIX #44; plan: .claude/wip/faza6/PLAN-faza6.md): push-ul pentru anunțurile noi din Market
-- devine OPT-IN pentru conturile noi — `market_push_enabled DEFAULT false`. Conturile existente NU se ating (rămân cum
-- și-au setat). Clientul 1.1 întreabă la prima deschidere a Market-ului („Vrei notificări la anunțuri noi?”); comutatorul
-- din Setări rămâne.
--
-- Lecția fazei 4: default-urile view-ului `public.profiles` sunt COPII ale celor din tabel (ALTER VIEW … SET DEFAULT,
-- 20261101000100). INSERT-urile clienților (1.0.x și 1.1) trec prin view-ul INSTEAD OF → fără a doua instrucțiune ar lua
-- în continuare `true`. ALTER COLUMN SET DEFAULT nu rescrie tabelul (doar catalog; lock scurt).
-- 1.0.x după fază: conturile noi create din 1.0.x pornesc cu push-ul Market oprit (același default); comutatorul din
-- Setările lor îl pornește. Aliniat cu planul (#44).
--
-- Rollback: supabase/rollback/20261109000200_market_push_optin.sql (ambele default-uri înapoi la true).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
BEGIN
  IF to_regclass('app.profiles') IS NULL THEN RAISE EXCEPTION 'cere faza 4 (app.profiles)'; END IF;
END $$;

ALTER TABLE app.profiles ALTER COLUMN market_push_enabled SET DEFAULT false;
ALTER VIEW public.profiles ALTER COLUMN market_push_enabled SET DEFAULT false;

COMMENT ON COLUMN app.profiles.market_push_enabled IS
  'Setări → Notificări: anunțuri noi pe Market. Independent de push_enabled (comutatorul global îl domină). DEFAULT false din 7.10 (opt-in la prima deschidere a Market-ului; conturile de dinainte de 9 nov 2026 au rămas true).';

DO $$
DECLARE
  v_tbl text;
  v_view text;
BEGIN
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_tbl
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'app.profiles'::regclass AND a.attname = 'market_push_enabled';
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_view
    FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
   WHERE d.adrelid = 'public.profiles'::regclass AND a.attname = 'market_push_enabled';
  IF v_tbl IS DISTINCT FROM 'false' OR v_view IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'default-ul market_push_enabled nu e false pe ambele (tabel: %, view: %)', v_tbl, v_view;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
