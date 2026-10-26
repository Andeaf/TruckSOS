-- Faza 15 — Etapa 15.1: fundație schemă pentru ștergerea contului
-- Rulează în Supabase Studio → SQL Editor.
--
-- NON-DISTRUCTIV, fără schimbare de comportament vizibilă:
--   • coloane noi nullable / cu default (rândurile existente rămân valide);
--   • rescrierea indexului parțial de conversații directe (backfill echivalent);
--   • FK conversations.announcement_id devine SET NULL — dar azi NIMIC nu șterge hard
--     anunțuri (doar set_announcements_hidden face soft-hide), deci efect zero acum.
-- NU rupem încă profiles_id_fkey (cascada profil→auth) — asta se face la 15.2, ATOMIC
-- cu declanșatorul handle_auth_user_deleted, ca să nu existe o fereastră fără trigger.

-- ─── 1. profiles.deleted_at — marcaj de piatră-funerară ─────────────────────
-- NULL = cont activ. NOT NULL = profil golit de PII (utilizator șters). UI-ul afișează
-- marcajul localizat „Utilizator șters" pe baza acestei coloane, nu a unui text din DB.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ─── 2. conversations.is_direct — distinge direct autentic de orfan de anunț ─
-- BLOCANT rezolvat (F15.0): la ștergerea contului, anunțurile șoferului se șterg, iar
-- conversations.announcement_id devine NULL (SET NULL, secțiunea 4). Fără marcaj, aceste
-- conversații orfane ar intra sub indexul unic parțial din Faza 7
-- (idx_conversations_direct_pair WHERE announcement_id IS NULL) și DOUĂ orfane pe aceeași
-- pereche (driver_id, mechanic_id) ar viola unicitatea → ștergerea contului ar eșua.
--
-- Soluția: marcăm DOAR conversațiile directe autentice (create prin start_direct_conversation)
-- și restrângem indexul la ele. Orfanele rămân is_direct = false → în afara indexului.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_direct boolean NOT NULL DEFAULT false;

-- Backfill: până acum, singura cale care crea conversații cu announcement_id NULL era
-- start_direct_conversation → toate cele existente sunt directe autentice.
UPDATE conversations SET is_direct = true WHERE announcement_id IS NULL AND is_direct = false;

-- Rescriem indexul: unicitate „max 1 conversație directă per pereche" DOAR pentru cele autentice.
DROP INDEX IF EXISTS idx_conversations_direct_pair;
CREATE UNIQUE INDEX idx_conversations_direct_pair
  ON conversations(driver_id, mechanic_id) WHERE is_direct;

-- ─── 3. start_direct_conversation — setează is_direct + SELECT consistent ────
-- Două schimbări față de Faza 7:
--   a) INSERT-ul setează is_direct = true (conversație directă autentică);
--   b) SELECT-ul de reuse filtrează AND is_direct (predicat IDENTIC cu al indexului),
--      ca să nu „reînvie" din greșeală o conversație orfanată (announcement_id NULL, dar
--      is_direct false). În practică o orfană are driver_id = cont șters, care nu mai poate
--      apela RPC-ul — dar predicatele trebuie să corespundă, defensiv.
CREATE OR REPLACE FUNCTION start_direct_conversation(p_mechanic_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
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

  SELECT id INTO v_conv_id
  FROM conversations
  WHERE driver_id = v_driver_id
    AND mechanic_id = p_mechanic_id
    AND is_direct;                       -- ← consistent cu idx_conversations_direct_pair

  IF NOT FOUND THEN
    INSERT INTO conversations (announcement_id, driver_id, mechanic_id, is_direct)
    VALUES (NULL, v_driver_id, p_mechanic_id, true)   -- ← marcaj de direct autentic
    RETURNING id INTO v_conv_id;
  END IF;

  -- dacă șoferul o ștersese din listă, reapare la re-contact
  DELETE FROM conversation_deletions
  WHERE conversation_id = v_conv_id AND user_id = v_driver_id;

  RETURN v_conv_id;
END;
$$;

-- ─── 4. conversations.announcement_id: CASCADE → SET NULL ────────────────────
-- Capcana #1: cu CASCADE, ștergerea unui anunț ștergea conversația (și, tranzitiv, mesajele
-- pe care vrem să le păstrăm anonimizate). Cu SET NULL, conversația supraviețuiește ca rând
-- orfan (announcement_id NULL, is_direct false) — mesajele rămân, fără coliziune de index.
-- UNIQUE-ul mono-coloană pe announcement_id (conversations_announcement_id_key) rămâne intact
-- și permite NULL-uri multiple (semantica SQL standard).
--
-- Dropăm DINAMIC orice FK existent pe conversations.announcement_id (nu presupunem numele
-- implicit) — altfel, dacă numele ar diferi, DROP ... IF EXISTS n-ar prinde nimic și am rămâne
-- cu DOUĂ FK-uri, iar cel CASCADE tot ar caștiga la ștergere = bug tăcut critic.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel   ON rel.oid = con.conrelid
    JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = ANY(con.conkey)
    WHERE con.contype = 'f'
      AND rel.relname = 'conversations'
      AND a.attname = 'announcement_id'
  LOOP
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_announcement_id_fkey
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE SET NULL;

-- ─── Verificări (rulează manual, nu fac parte din migrare) ──────────────────
-- a) Coloane noi există și au default corect:
--      SELECT deleted_at FROM profiles LIMIT 1;                       -- NULL
--      SELECT is_direct FROM conversations WHERE announcement_id IS NULL;  -- true (backfill)
-- b) Aplicația neschimbată:
--      • chat pe anunț: conversațiile pe anunțuri au announcement_id NOT NULL, is_direct false.
--      • conversație directă din căutare: start_direct_conversation întoarce un uuid; al
--        doilea apel (dublu-tap „Contactează") întoarce ACELAȘI uuid → o singură conversație.
-- c) Indexul restrâns:
--      SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_conversations_direct_pair';
--      -- ... WHERE is_direct
-- d) FK-ul e SET NULL:
--      SELECT confdeltype FROM pg_constraint WHERE conname = 'conversations_announcement_id_fkey';
--      -- 'n' (SET NULL)   [era 'c' (CASCADE)]
-- e) Test coliziune (opțional, pe cont de test): creează 2 anunțuri de la același șofer
--    acceptate de același mecanic (2 conversații) → DELETE ambele anunțuri → ambele conversații
--    primesc announcement_id NULL, is_direct rămâne false → FĂRĂ eroare 23505.
