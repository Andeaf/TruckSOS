-- Faza 18 — Etapa 18.0: blocare utilizatori (cerință Apple, Guideline 1.2 UGC)
-- Rulează în Supabase Studio → SQL Editor.
--
-- Principii (PLAN_FAZA18 §1):
--   • Politicile noi sunt AS RESTRICTIVE (se combină cu AND) — cele existente rămân NEATINSE.
--   • Nedetectabilitate: blocatul nu poate enumera cine l-a blocat (SELECT doar pentru blocker)
--     și nu primește nicio eroare specifică — respingerile refolosesc erorile generice existente
--     ('announcement_not_open', 'target_not_mechanic', 42501 la RLS), niciodată un oracol
--     de tip 'user_blocked'.
--   • Îngheț BIDIRECȚIONAL pe chatul privat; ascundere simetrică în feed/hartă/căutare.
--   • RPC-urile SECURITY DEFINER ocolesc RLS → fiecare primește guard propriu (defense in depth).

-- ─── 1. Tabelul blocked_users ────────────────────────────────────────────────
-- Migrarea e IDEMPOTENTĂ (IF NOT EXISTS / DROP IF EXISTS) — re-rularea e sigură.
CREATE TABLE IF NOT EXISTS blocked_users (
  blocker_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
-- PK-ul (blocker_id, blocked_id) e și indexul folosit de toate helper-ele de mai jos.

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

-- ATENȚIE: STRICT blocker-only. Niciodată "OR blocked_id = auth.uid()" — ar face
-- blocarea detectabilă (blocatul și-ar vedea rândul).
DROP POLICY IF EXISTS blocked_select_own ON blocked_users;
CREATE POLICY blocked_select_own ON blocked_users
  FOR SELECT USING (blocker_id = auth.uid());

DROP POLICY IF EXISTS blocked_insert_own ON blocked_users;
CREATE POLICY blocked_insert_own ON blocked_users
  FOR INSERT WITH CHECK (blocker_id = auth.uid() AND blocked_id <> auth.uid());

DROP POLICY IF EXISTS blocked_delete_own ON blocked_users;
CREATE POLICY blocked_delete_own ON blocked_users
  FOR DELETE USING (blocker_id = auth.uid());
-- Fără politică UPDATE: nu există nimic de actualizat pe un rând de blocare.

-- ─── 2. Helper-e SECURITY DEFINER ────────────────────────────────────────────
-- Politicile de pe alte tabele trebuie să consulte blocked_users DINCOLO de RLS-ul
-- apelantului (blocatul nu-și poate citi rândul, dar politica trebuie să-l vadă).

-- Direcțional: p_blocker l-a blocat pe p_blocked?
CREATE OR REPLACE FUNCTION is_blocked_by(p_blocker uuid, p_blocked uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE blocker_id = p_blocker AND blocked_id = p_blocked
  );
$$;

-- Simetric: există blocare în ORICE direcție între cei doi?
CREATE OR REPLACE FUNCTION is_block_between(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users
    WHERE (blocker_id = p_a AND blocked_id = p_b)
       OR (blocker_id = p_b AND blocked_id = p_a)
  );
$$;

-- Perechea conversației conține o blocare (orice direcție)?
CREATE OR REPLACE FUNCTION is_conversation_blocked(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = p_conversation_id
      AND is_block_between(c.driver_id, c.mechanic_id)
  );
$$;

-- ─── 3. Politici RESTRICTIVE (aditive peste cele existente) ──────────────────

-- Chat privat: conversația blocată îngheață în AMBELE direcții. Respingerea e
-- eroarea standard de RLS (42501) — identică cu orice altă respingere, fără oracol.
DROP POLICY IF EXISTS messages_insert_not_blocked ON messages;
CREATE POLICY messages_insert_not_blocked ON messages
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT is_conversation_blocked(conversation_id));

-- Feed/hartă: anunțurile dispar SIMETRIC (blocatul nu vede anunțurile blocantului,
-- iar blockerul nu mai vede anunțurile celui blocat). Excepții:
--   • proprietarul își vede mereu anunțurile;
--   • mecanicul ASIGNAT vede jobul în curs (nu rupem o lucrare acceptată — §1.7.2;
--     remediul șoferului rămâne anularea anunțului);
--   • adminii nu sunt afectați de blocări (moderarea trece peste).
DROP POLICY IF EXISTS announcements_select_not_blocked ON announcements;
CREATE POLICY announcements_select_not_blocked ON announcements
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    driver_id = auth.uid()
    OR mechanic_id = auth.uid()
    OR is_admin()
    OR NOT is_block_between(driver_id, auth.uid())
  );

-- ─── 4. RPC block_user (blocarea are efect secundar → nu e un simplu INSERT) ─
-- Deblocarea NU are RPC: DELETE direct pe blocked_users (politica delete_own),
-- fără restaurarea candidaturilor respinse (recandidare prin resubmit_application).
CREATE OR REPLACE FUNCTION block_user(p_target uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_me uuid := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  IF p_target = v_me THEN
    RAISE EXCEPTION 'cannot_block_self';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_target) THEN
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
  FROM announcements ann
  WHERE a.announcement_id = ann.id
    AND a.status = 'pending'
    AND (
      (ann.driver_id = v_me AND a.mechanic_id = p_target)
      OR (a.mechanic_id = v_me AND ann.driver_id = p_target)
    );
END;
$$;

-- ─── 5. Guard-uri în RPC-urile SECURITY DEFINER existente ────────────────────
-- Toate refolosesc ERORILE EXISTENTE ale funcției — un apelant blocat primește
-- exact ce ar primi pentru un anunț închis / profil inexistent.

-- 5a. apply_to_announcement — blocatul nu poate candida (nici nu vede anunțul,
--     dar RPC-ul e definer și trebuie să refuze și apelul direct prin API).
CREATE OR REPLACE FUNCTION apply_to_announcement(
  p_announcement_id uuid,
  p_price_type      text,
  p_price_amount    numeric,
  p_currency        text DEFAULT 'RON',
  p_message         text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver_id uuid;
BEGIN
  SELECT driver_id INTO v_driver_id
  FROM announcements
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
$$;

-- 5b. resubmit_application — fără guard, un mecanic auto-respins la blocare și-ar
--     putea readuce candidatura pe pending. Funcția exista DOAR în Studio (Faza 5.7,
--     DDL în PLAN_FAZA5); migrarea asta o aduce prima dată și în repo, cu guard-ul
--     în WHERE → NOT FOUND → aceeași eroare ca orice recandidare imposibilă.
CREATE OR REPLACE FUNCTION resubmit_application(
  p_application_id uuid,
  p_price_type     text,
  p_price_amount   numeric,
  p_currency       text DEFAULT 'RON',
  p_message        text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE applications a
  SET status       = 'pending',
      price_type   = p_price_type,
      price_amount = p_price_amount,
      currency     = p_currency,
      message      = p_message
  FROM announcements ann
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
$$;

-- 5c. accept_announcement (legacy, „păstrat pentru compatibilitate") — e definer,
--     deci un mecanic blocat ar putea accepta anunțul DIRECT prin API deși nu-l
--     vede în feed. Aceeași eroare ca pentru anunț indisponibil.
CREATE OR REPLACE FUNCTION accept_announcement(p_announcement_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver_id uuid;
  v_mechanic_id uuid := auth.uid();
BEGIN
  SELECT driver_id INTO v_driver_id
  FROM announcements
  WHERE id = p_announcement_id AND status = 'open'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  IF is_block_between(v_driver_id, v_mechanic_id) THEN
    RAISE EXCEPTION 'Announcement not available';   -- identic — nedetectabil
  END IF;

  UPDATE announcements
  SET status = 'accepted', mechanic_id = v_mechanic_id, updated_at = now()
  WHERE id = p_announcement_id;

  INSERT INTO conversations (announcement_id, driver_id, mechanic_id)
  VALUES (p_announcement_id, v_driver_id, v_mechanic_id);
END;
$$;

-- 5d. start_direct_conversation — două direcții, două comportamente:
--     • blockerul apelează → 'blocked_by_you' (e propriul lui secret; clientul
--       afișează promptul de deblocare);
--     • blocatul apelează → 'target_not_mechanic', EXACT eroarea pentru profil
--       inexistent/greșit — indistinctibil de un cont șters.
CREATE OR REPLACE FUNCTION start_direct_conversation(p_mechanic_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_driver_id uuid := auth.uid();
  v_conv_id   uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_driver_id AND role = 'driver') THEN
    RAISE EXCEPTION 'caller_not_driver';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_mechanic_id AND role = 'mechanic') THEN
    RAISE EXCEPTION 'target_not_mechanic';
  END IF;

  IF is_blocked_by(v_driver_id, p_mechanic_id) THEN
    RAISE EXCEPTION 'blocked_by_you';
  END IF;
  IF is_blocked_by(p_mechanic_id, v_driver_id) THEN
    RAISE EXCEPTION 'target_not_mechanic';   -- identic cu inexistent — nedetectabil
  END IF;

  SELECT id INTO v_conv_id
  FROM conversations
  WHERE driver_id = v_driver_id
    AND mechanic_id = p_mechanic_id
    AND is_direct;                       -- consistent cu idx_conversations_direct_pair (Faza 15)

  IF NOT FOUND THEN
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id, is_direct)
    VALUES (NULL, v_driver_id, p_mechanic_id, true)
    RETURNING id INTO v_conv_id;
  END IF;

  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv_id AND user_id = v_driver_id;

  RETURN v_conv_id;
END;
$$;

-- 5e. get_mechanic_phone / get_driver_phone — SCURGEREA din §1.6: conversația
--     veche există în continuare și ar debloca telefonul. NULL e răspunsul normal
--     „fără conversație" — nedetectabil.
CREATE OR REPLACE FUNCTION get_mechanic_phone(p_mechanic_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_mechanic_id) THEN
    RETURN NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM conversations
    WHERE mechanic_id = p_mechanic_id AND driver_id = auth.uid()
  ) THEN
    RETURN NULL;
  END IF;
  SELECT phone INTO v_phone FROM profiles WHERE id = p_mechanic_id;
  RETURN v_phone;
END;
$$;

CREATE OR REPLACE FUNCTION get_driver_phone(p_driver_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_phone text;
BEGIN
  IF is_block_between(auth.uid(), p_driver_id) THEN
    RETURN NULL;
  END IF;
  SELECT p.phone INTO v_phone
  FROM profiles p
  WHERE p.id = p_driver_id
    AND EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.driver_id = p_driver_id AND c.mechanic_id = auth.uid()
    );
  RETURN v_phone;
END;
$$;

-- 5f. search_mechanics — mecanicul blocat/blocant dispare din căutare, simetric.
--     Dispariția e indistinctibilă de un cont șters (exact filtrul de alături).
--     Return IDENTIC → CREATE OR REPLACE e suficient (fără DROP).
CREATE OR REPLACE FUNCTION search_mechanics(p_query text)
RETURNS TABLE (
  id uuid,
  full_name text,
  specialization text,
  activity_zone text,
  rating_avg numeric,
  rating_count integer,
  avatar_path text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions
AS $$
  SELECT p.id, p.full_name, p.specialization, p.activity_zone,
         p.rating_avg, p.rating_count, p.avatar_path
  FROM profiles p
  WHERE p.role = 'mechanic'
    AND p.deleted_at IS NULL                       -- Faza 15: fără conturi șterse
    AND NOT is_block_between(p.id, auth.uid())     -- Faza 18: fără perechi blocate
    AND extensions.unaccent(replace(lower(p.full_name), 'ß', 'ss'))
        LIKE '%' || extensions.unaccent(replace(lower(p_query), 'ß', 'ss')) || '%'
  ORDER BY p.full_name
  LIMIT 30;
$$;

-- ─── 6. Push: anunț nou NU se mai trimite perechilor blocate ─────────────────
-- Inspecția pipeline-ului (Faza 12): mesaj/candidatură/acceptare pornesc de la
-- INSERT-uri pe care blocarea deja le respinge → nimic de făcut acolo. DOAR
-- on_announcement_notify calculează lista de destinatari server-side → filtru aici.
CREATE OR REPLACE FUNCTION on_announcement_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_mechanic record;
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;

  FOR v_mechanic IN
    SELECT profiles.id, COALESCE(lang, 'ro') AS lang
    FROM profiles
    WHERE role = 'mechanic'
      AND profiles.id <> NEW.driver_id
      AND push_enabled
      AND NOT is_block_between(NEW.driver_id, profiles.id)   -- Faza 18
      AND (
        notify_radius_km IS NULL
        OR (
          NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND distance_km(latitude, longitude, NEW.latitude, NEW.longitude) <= notify_radius_km
        )
      )
  LOOP
    PERFORM notify_push(
      v_mechanic.id,
      push_text(v_mechanic.lang, 'announcement_title'),
      NEW.location,
      jsonb_build_object('type', 'feed', 'id', NEW.id)
    );
  END LOOP;
  RETURN NEW;
END;
$$;
-- Triggerul announcements_notify există deja (Faza 12.4) și arată spre funcția
-- de mai sus — CREATE OR REPLACE îi schimbă corpul, nu trebuie recreat.

-- ─── Verificări (manual; testele negative complete în _TEST_faza18_negativ.sql) ─
-- a) Tabelul + politicile:
--      SELECT polname, polpermissive FROM pg_policy
--      WHERE polrelid IN ('blocked_users'::regclass,'messages'::regclass,'announcements'::regclass);
--      -- messages_insert_not_blocked și announcements_select_not_blocked au polpermissive = f
-- b) Fluxuri NEatinse pentru utilizatori fără blocări: mesaje, feed, candidaturi,
--    căutare, push — regresie rapidă cu 2 conturi de test fără niciun rând în blocked_users.
