-- ─────────────────────────────────────────────────────────────────────────────
-- 24 aug 2026 — Durata videoclipurilor din chat (stil 11b: „Videoclip · 0:12")
-- Rulează în Supabase Studio → SQL Editor. Idempotentă, pur aditivă.
--
-- Coloana `file_duration` = durata în SECUNDE întregi, completată de client la
-- trimitere (pickerul o raportează în ms). NULL la fișierele non-video, la
-- videoclipurile trimise prin pickerul de fișiere și la mesajele vechi — UI-ul
-- afișează atunci doar „Videoclip", fără durată. Nu intră în CHECK-uri și nu e
-- PII; delete_message/purge o lasă în urmă pe tombstone-uri (irelevant, UI-ul
-- ignoră mesajele șterse).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE messages         ADD COLUMN IF NOT EXISTS file_duration integer;
ALTER TABLE channel_messages ADD COLUMN IF NOT EXISTS file_duration integer;

-- Verificare:
select
  (select count(*) from information_schema.columns
    where table_name = 'messages' and column_name = 'file_duration')         as pe_messages,
  (select count(*) from information_schema.columns
    where table_name = 'channel_messages' and column_name = 'file_duration') as pe_channel;
-- Așteptat: 1, 1.
