-- ─────────────────────────────────────────────────────────────────────────────
-- 2 sept 2026 — Notificările canalului global devin PORNITE implicit
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
--
-- CONTEXT: din Faza 12 canalul global nu notifica deloc; pe 5 aug (migrarea
-- 20260805_channel_push_prefs) a devenit opt-in — fără rând în `channel_push_prefs`
-- = OPRIT. Rezultatul măsurat pe 2 sept: **1 singur rând în toată tabela**, deci din
-- 227 de conturi active exact UNUL primea notificări de pe canal, la 14 mesaje/24h.
-- Comutatorul (rotița de setări a canalului) există, dar nu-l găsea nimeni.
--
-- DECIZIE (userul, 2 sept): implicitul se inversează — pornit, cu posibilitatea de
-- a-l opri din aceeași rotiță. Se face din bază, NU dintr-un update: prinde toate
-- telefoanele deja instalate imediat (proiectul n-are expo-updates → zero OTA).
--
-- DE CE BACKFILL ȘI NU „lipsa rândului = pornit": clientul
-- (`use-channel-push-pref.ts`) citește rândul și afișează OFF când lipsește. Dacă
-- am schimba doar triggerul, comutatorul ar minți — ar arăta OPRIT în timp ce
-- notificările curg, iar omul n-ar avea cum să le oprească. Cu rânduri reale,
-- interfața rămâne sinceră și opt-out-ul funcționează din prima.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Backfill pentru conturile existente ──────────────────────────────────
-- ON CONFLICT DO NOTHING → cine ȘI-A ales deja explicit setarea (pornit sau oprit)
-- rămâne neatins. Tombstone-urile (deleted_at) sunt excluse.
INSERT INTO channel_push_prefs (user_id, channel_id, enabled)
SELECT p.id, c.id, true
  FROM profiles p
 CROSS JOIN channels c
 WHERE p.deleted_at IS NULL
ON CONFLICT (user_id, channel_id) DO NOTHING;

-- ── 2. Conturile NOI primesc rândul automat ─────────────────────────────────
-- Altfel implicitul ar rămâne „oprit" exact pentru cine se înscrie de mâine.
CREATE OR REPLACE FUNCTION seed_channel_push_prefs_for_profile()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO channel_push_prefs (user_id, channel_id, enabled)
  SELECT NEW.id, c.id, true FROM channels c
  ON CONFLICT (user_id, channel_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_seed_channel_push_prefs ON profiles;
CREATE TRIGGER profiles_seed_channel_push_prefs
  AFTER INSERT ON profiles
  FOR EACH ROW EXECUTE FUNCTION seed_channel_push_prefs_for_profile();

-- ── 3. Un canal NOU (regional) primește rânduri pentru toți userii existenți ─
CREATE OR REPLACE FUNCTION seed_channel_push_prefs_for_channel()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO channel_push_prefs (user_id, channel_id, enabled)
  SELECT p.id, NEW.id, true FROM profiles p WHERE p.deleted_at IS NULL
  ON CONFLICT (user_id, channel_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS channels_seed_channel_push_prefs ON channels;
CREATE TRIGGER channels_seed_channel_push_prefs
  AFTER INSERT ON channels
  FOR EACH ROW EXECUTE FUNCTION seed_channel_push_prefs_for_channel();

-- ── 4. Verificare ───────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM channel_push_prefs)                             AS randuri_total,
  (SELECT count(*) FROM channel_push_prefs WHERE enabled)               AS pornite,
  (SELECT count(*) FROM channel_push_prefs WHERE NOT enabled)           AS oprite,
  (SELECT count(*) FROM profiles WHERE deleted_at IS NULL)              AS profiluri_active,
  (SELECT count(DISTINCT p.user_id) FROM channel_push_prefs p
     JOIN push_tokens pt ON pt.user_id = p.user_id WHERE p.enabled)     AS primesc_efectiv_acum,
  (SELECT count(*) FROM pg_trigger
    WHERE tgname IN ('profiles_seed_channel_push_prefs',
                     'channels_seed_channel_push_prefs'))               AS triggere;
