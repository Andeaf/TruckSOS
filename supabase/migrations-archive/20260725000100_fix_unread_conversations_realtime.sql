-- ─────────────────────────────────────────────────────────────────────────────
-- Fix badge necitite (25 iul 2026): `conversations` lipsea din publicația Realtime.
--
-- useUnreadCounts se abonează la INSERT pe `conversations` ca să afle de
-- conversațiile NOI create de celălalt participant (ex. „Contactează vânzătorul"
-- din Market). Fără tabel în publicație, evenimentul nu se livrează niciodată →
-- filtrul conversation_id=in.(...) al abonării pe `messages` nu include
-- conversația nouă → primul mesaj nu aprinde bulina de pe tabul Chat.
--
-- REPLICA IDENTITY FULL: consecvent cu celelalte tabele realtime (necesar doar
-- la UPDATE/DELETE cu filtre; la INSERT nu are efect, dar nu strică).
-- Idempotent — se poate rula de mai multe ori fără efecte.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE conversations REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE conversations;
  END IF;
END $$;

-- Verificare:
--   SELECT tablename FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND schemaname = 'public' ORDER BY 1;
-- → lista trebuie să conțină acum și `conversations`.
