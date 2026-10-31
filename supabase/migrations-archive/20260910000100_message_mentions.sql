-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 10 sept 2026 — Menționări „@Nume" în chat (privat + canal)
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
--
-- Cerința userului: „oamenii din aplicație să poată fi taguiți cu @, ca pe
-- WhatsApp" — fereastră cu persoane deasupra casetei text, filtrată pe măsură
-- ce se tastează numele; în bulă „@Nume" apare evidențiat și apăsabil (→ profil).
--
-- Textul mesajului rămâne TEXT SIMPLU („@Ion Popescu salut") — notificările push,
-- citatele și căutările îl afișează ca atare. Ce persoane au fost menționate stă
-- separat, în `mentions`: un array JSON de {id, name} — id-ul profilului + numele
-- EXACT inserat după „@". Clientul evidențiază în bulă doar „@Nume"-urile care
-- încă apar în text (după editare, o menționare ștearsă din text dispare singură).
--
-- Fără FK pe id (e într-un jsonb): dacă profilul dispare, „@Nume" rămâne text
-- evidențiat, iar tap-ul duce pe „Profil indisponibil" — acceptabil.
--
-- Clientul PROBEAZĂ coloana (hasMentionsColumn, ca hasChatV14): înainte de
-- migrare nu trimite `mentions`, deci mesajele cu „@" merg și pe schema veche.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS mentions jsonb;

ALTER TABLE channel_messages
  ADD COLUMN IF NOT EXISTS mentions jsonb;

-- Forma: NULL sau array (obiectele {id, name} le validează clientul).
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_mentions_is_array;
ALTER TABLE messages
  ADD CONSTRAINT messages_mentions_is_array
  CHECK (mentions IS NULL OR jsonb_typeof(mentions) = 'array');

ALTER TABLE channel_messages DROP CONSTRAINT IF EXISTS channel_messages_mentions_is_array;
ALTER TABLE channel_messages
  ADD CONSTRAINT channel_messages_mentions_is_array
  CHECK (mentions IS NULL OR jsonb_typeof(mentions) = 'array');

COMMENT ON COLUMN messages.mentions IS
  'Menționări „@Nume" (10 sept 2026): array JSON de {id, name}; textul rămâne simplu în content.';
COMMENT ON COLUMN channel_messages.mentions IS
  'Menționări „@Nume" (10 sept 2026): array JSON de {id, name}; textul rămâne simplu în content.';

-- Ambele tabele sunt deja REPLICA IDENTITY FULL + în publicația supabase_realtime
-- (Faza 6 / Faza 14), deci coloana nouă ajunge în payload-urile Realtime automat.

-- ─── Verificare ─────────────────────────────────────────────────────────────
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name IN ('messages','channel_messages') AND column_name = 'mentions';
-- → 2 rânduri, jsonb.
