-- ============================================================================
-- Migrare 5 aug 2026 (2) — Notificări OPT-IN pe canalul global
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
--
-- Decizia anti-spam din Faza 12 („chatul global NU notifică") rămâne DEFAULT:
-- fără rând în channel_push_prefs sau enabled=false → nicio notificare.
-- Userul pornește notificările din setările canalului (rotița de pe card/antet);
-- clientul scrie prin upsert direct (RLS pe rândul propriu), fără RPC.
-- ============================================================================

-- ── 1. Preferințe per utilizator × canal ───────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_push_prefs (
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

ALTER TABLE channel_push_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "channel_push_prefs_own" ON channel_push_prefs;
CREATE POLICY "channel_push_prefs_own" ON channel_push_prefs
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── 2. Trigger: mesaj nou pe canal → push către abonați ────────────────────
-- Titlul = numele expeditorului (limbă-neutru); corpul = textul mesajului sau
-- 📷/📎 la poze/fișiere. notify_push re-verifică push_enabled + ban; filtrele
-- din query sunt scurtături. Blocările se respectă (is_block_between, Faza 18),
-- consecvent cu ascunderea client-side a mesajelor de la utilizatori blocați.
CREATE OR REPLACE FUNCTION on_channel_message_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $body$
DECLARE
  v_rec record;
  v_sender text;
  v_body text;
BEGIN
  SELECT full_name INTO v_sender FROM profiles WHERE id = NEW.sender_id;
  v_body := COALESCE(
    NULLIF(NEW.content, ''),
    CASE WHEN NEW.image_path IS NOT NULL THEN 'Foto' ELSE 'Fisier' END
  );

  FOR v_rec IN
    SELECT p.user_id
    FROM channel_push_prefs p
    JOIN profiles pr ON pr.id = p.user_id
    WHERE p.channel_id = NEW.channel_id
      AND p.enabled
      AND p.user_id <> NEW.sender_id
      AND pr.push_enabled
      AND pr.deleted_at IS NULL
      AND NOT is_block_between(NEW.sender_id, p.user_id)
  LOOP
    PERFORM notify_push(
      v_rec.user_id,
      COALESCE(v_sender, 'TruckSOS'),
      v_body,
      jsonb_build_object('type', 'channel', 'id', NEW.channel_id)
    );
  END LOOP;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS channel_messages_notify ON channel_messages;
CREATE TRIGGER channel_messages_notify
  AFTER INSERT ON channel_messages
  FOR EACH ROW EXECUTE FUNCTION on_channel_message_notify();

-- ── 3. Verificare (1 / 1) ──────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.tables
    WHERE table_name = 'channel_push_prefs') AS prefs_table,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname = 'channel_messages_notify') AS trigger_ok;
