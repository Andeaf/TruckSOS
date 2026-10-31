-- Etapa 6.1: Chat global — tabele channels, channel_messages, channel_reads + RLS + Realtime + seed
-- Rulează în Supabase Studio → SQL Editor
-- Nu modifică nimic din schema existentă (messages, conversations, message_reads, conversation_deletions rămân neatinse)

-- ─── 1. Tabel channels ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channels (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,   -- etichetă internă/admin; numele afișat în UI se derivă din `type` via i18n
  type       TEXT NOT NULL CHECK (type IN ('global', 'regional')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- garantează un singur canal de tip 'global'
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_single_global
  ON channels(type) WHERE type = 'global';

ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channels_select_all" ON channels
  FOR SELECT USING (auth.uid() IS NOT NULL);
-- fără INSERT/UPDATE/DELETE policy: canalele se creează doar din Supabase Studio/migrare

-- ─── 2. Tabel channel_messages ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_created
  ON channel_messages(channel_id, created_at DESC);

ALTER TABLE channel_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_messages_select_all" ON channel_messages
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "channel_messages_insert_own" ON channel_messages
  FOR INSERT WITH CHECK (sender_id = auth.uid());

-- Etapa 6.7 (deferată): ștergere mesaj propriu. Policy adăugată acum (cost zero),
-- UI-ul de tap-and-hold rămâne pentru o fază viitoare.
CREATE POLICY "channel_messages_delete_own" ON channel_messages
  FOR DELETE USING (sender_id = auth.uid());

-- Realtime — obligatoriu REPLICA IDENTITY FULL pentru subscripții cu filtru (channel_id=eq.X)
ALTER TABLE channel_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE channel_messages;

-- ─── 3. Tabel channel_reads ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS channel_reads (
  channel_id   UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);

ALTER TABLE channel_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "channel_reads_own" ON channel_reads
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ─── 4. Seed canal global ────────────────────────────────────────────────────
INSERT INTO channels (name, type)
SELECT 'Comunitate TruckSOS', 'global'
WHERE NOT EXISTS (SELECT 1 FROM channels WHERE type = 'global');

-- ─── Verificare ──────────────────────────────────────────────────────────────
-- SELECT * FROM channels;
-- INSERT INTO channel_messages (channel_id, sender_id, content)
--   VALUES ((SELECT id FROM channels WHERE type='global'), auth.uid(), 'test');
-- SELECT * FROM channel_messages ORDER BY created_at DESC LIMIT 10;
-- DELETE FROM channel_messages WHERE sender_id = auth.uid() AND content = 'test';
