-- Fix: insigna de necitite a canalului global rămânea „lipită" în tab până la restart.
--
-- Cauză: useChannelUnreadCount (use-channel-chat.ts) se abonează la modificări pe
-- `channel_reads` ca să recalculeze badge-ul când marchezi canalul citit. Dar tabelul
-- nu a fost niciodată adăugat în publicația Realtime (Faza 6 a adăugat doar
-- channel_messages), deci upsert-ul din markChannelRead nu ajungea la niciun abonat.
-- Cardul din listă se golea doar pentru că ecranul se re-fetcha la focus/remount;
-- iconița din tab (_layout.tsx) nu se demontează niciodată → rămânea stale.
--
-- Simetric cu message_reads (chat privat), care e deja în publicație și funcționează.

-- REPLICA IDENTITY FULL: abonarea filtrează pe channel_id, iar payload-ul de UPDATE
-- (upsert peste un rând existent) trebuie să conțină coloanele ca filtrul + RLS să prindă.
ALTER TABLE channel_reads REPLICA IDENTITY FULL;

-- Adăugăm channel_reads în publicație doar dacă nu e deja (idempotent — nu dă eroare la re-rulare).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'channel_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE channel_reads;
  END IF;
END $$;

-- ─── Verificare (manual) ────────────────────────────────────────────────────
--   1) Alt cont trimite 2 mesaje în canalul global → badge tab = 2.
--   2) Deschizi canalul, vezi mesajele, ieși → badge tab dispare INSTANT (fără restart).
--   SELECT tablename FROM pg_publication_tables
--     WHERE pubname='supabase_realtime' AND tablename IN ('channel_reads','message_reads');
