-- ============================================================================
-- 11 aug 2026 — două bug-uri în lista de conversații (găsite la investigația
-- „mesaje dispărute" din 10-11 aug):
--   1. Lista se sorta după created_at al CONVERSAȚIEI, nu al ultimului mesaj —
--      o conversație veche cu mesaj nou rămânea îngropată jos.
--   2. Conversațiile șterse (conversation_deletions) rămâneau ascunse PERMANENT:
--      un mesaj nou trimitea push, dar conversația nu reapărea în listă.
-- Idempotentă — poate fi rulată de mai multe ori fără efecte duble.
-- ============================================================================

-- ── 1. conversations.last_message_at (denormalizat) ──────────────────────────
-- DEFAULT now(): o conversație nouă, fără mesaje, se sortează după creare —
-- identic cu vechiul comportament. Clientul sortează cu fallback pe created_at,
-- deci aplicația merge și ÎNAINTE de rularea acestei migrări.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz DEFAULT now();

-- Backfill: ultimul mesaj existent sau, în lipsă, crearea conversației.
UPDATE conversations c
SET last_message_at = COALESCE(
  (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id),
  c.created_at
)
WHERE c.last_message_at IS NULL
   OR c.last_message_at < COALESCE(
        (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id),
        c.created_at
      );

-- ── 2. Trigger: mesaj nou → urcă last_message_at ─────────────────────────────
-- SECURITY DEFINER: expeditorul nu are (și nu trebuie să aibă) drept de UPDATE
-- pe conversations prin RLS; GREATEST apără cursorul de ceasuri date înapoi.
CREATE OR REPLACE FUNCTION bump_conversation_last_message()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE conversations
  SET last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_bump_last ON messages;
CREATE TRIGGER messages_bump_last
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION bump_conversation_last_message();

-- ── 3. Trigger: mesaj nou → conversația ștearsă REÎNVIE ──────────────────────
-- Ștergem marcajele TUTUROR participanților: dacă există un mesaj mai nou decât
-- ștergerea, conversația trebuie văzută. Pentru expeditor, RPC-urile
-- start_*_conversation șterg deja marcajul propriu la reluare — triggerul
-- acoperă DESTINATARUL (exact gaura neagră raportată). SECURITY DEFINER: RLS-ul
-- pe conversation_deletions permite fiecăruia doar propriile rânduri.
CREATE OR REPLACE FUNCTION resurrect_deleted_conversation()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM conversation_deletions
  WHERE conversation_id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_resurrect_deleted ON messages;
CREATE TRIGGER messages_resurrect_deleted
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION resurrect_deleted_conversation();

-- ── 4. Verificare (1 / 0 / 1 / 1) ────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'conversations'
      AND column_name = 'last_message_at')                                  AS coloana,
  (SELECT count(*) FROM conversations WHERE last_message_at IS NULL)        AS null_ramase_0,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'messages_bump_last')     AS trigger_bump,
  (SELECT count(*) FROM pg_trigger WHERE tgname = 'messages_resurrect_deleted') AS trigger_resurrect;
-- Așteptat: coloana=1, null_ramase_0=0, ambele triggere=1.
