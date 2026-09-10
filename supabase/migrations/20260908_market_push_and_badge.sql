-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 8 sept 2026 — Market: notificare la anunț nou + bulină „ceva nou"
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (re-rulabilă).
--
-- Cerința userului: „toți utilizatorii să fie notificați când se face o postare
-- nouă pe Market; notificările pentru Market să poată fi oprite separat din
-- setări; bulină roșie care semnalează ceva nou pentru Market".
--
-- Două piese pe server:
--   1. profiles.market_push_enabled — comutatorul separat (pornit implicit).
--      Coloană cu NOT NULL DEFAULT true, NU tabelă de join ca `channel_push_prefs`:
--      defaultul rezolvă singur și backfill-ul conturilor existente, și conturile
--      noi, fără triggerele de seed care au fost necesare pe 2 sept la canal —
--      și fără capcana „lipsa rândului = OFF" care făcea comutatorul să mintă.
--   2. Trigger AFTER INSERT pe market_listings → fan-out către toți ceilalți.
--
-- Bulina roșie NU are nimic aici: cursorul „ultima vizită pe Market" stă în
-- AsyncStorage (`market_last_seen:{userId}`), ca la bulinele de Feed și
-- Candidaturi (use-mechanic-badges.ts). Decizia e cea documentată în
-- use-viewed-announcements.ts: „am văzut deja" e preferință de afișare, nu date
-- partajate — nu justifică tabel + RLS. Consecința asumată, aceeași ca acolo:
-- pe alt telefon bulina se aprinde din nou.
--
-- Fan-out: același tipar ca `on_announcement_notify` (buclă + notify_push per
-- destinatar, un net.http_post per token). Diferența e că aici destinatarii sunt
-- TOȚI utilizatorii, nu doar mecanicii: la ~230 de conturi ≈ același ordin de
-- mărime cu fan-out-ul canalului global (231 destinatari măsurați în 208 ms pe
-- 2 sept), iar net.http_post întoarce imediat, deci INSERT-ul nu se încetinește.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Coloana nouă pe profiles ────────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS market_push_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN profiles.market_push_enabled IS
  'Setări → Notificări: anunțuri noi pe Market. Independent de push_enabled (comutatorul global îl domină).';

-- ─── 2. push_text: cheia nouă `market_title` ────────────────────────────────
-- Funcția e IMMUTABLE și se rescrie ÎNTREAGĂ (nu se pot adăuga ramuri separat).
-- Corpul de mai jos = cel din 20260818_push_title_order_priority.sql + o cheie.
CREATE OR REPLACE FUNCTION push_text(p_lang text, p_key text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_key
    WHEN 'application_title' THEN
      CASE p_lang WHEN 'en' THEN 'New offer'
                  WHEN 'de' THEN 'Neues Angebot'
                  ELSE 'Ofertă nouă' END
    WHEN 'application_body' THEN
      CASE p_lang WHEN 'en' THEN '%s offered to help you'
                  WHEN 'de' THEN '%s bietet dir Hilfe an'
                  ELSE '%s s-a oferit să te ajute' END
    WHEN 'accepted_title' THEN
      CASE p_lang WHEN 'en' THEN 'Offer accepted'
                  WHEN 'de' THEN 'Angebot angenommen'
                  ELSE 'Ofertă acceptată' END
    WHEN 'accepted_body' THEN
      CASE p_lang WHEN 'en' THEN '%s accepted your offer'
                  WHEN 'de' THEN '%s hat dein Angebot angenommen'
                  ELSE '%s ți-a acceptat oferta' END
    WHEN 'announcement_title' THEN
      CASE p_lang WHEN 'en' THEN 'New announcement'
                  WHEN 'de' THEN 'Neue Anzeige'
                  ELSE 'Anunț nou' END
    WHEN 'photo' THEN
      CASE p_lang WHEN 'en' THEN 'Photo'
                  WHEN 'de' THEN 'Foto'
                  ELSE 'Poză' END
    WHEN 'channel_name' THEN
      CASE p_lang WHEN 'en' THEN 'TruckSOS Community'
                  WHEN 'de' THEN 'TruckSOS Gemeinschaft'
                  ELSE 'Comunitate TruckSOS' END
    -- 8 sept 2026: titlul notificării de Market. Corpul e titlul anunțului plus
    -- prețul, deci conținut de utilizator — nu se traduce.
    WHEN 'market_title' THEN
      CASE p_lang WHEN 'en' THEN 'New listing on Market'
                  WHEN 'de' THEN 'Neue Anzeige im Markt'
                  ELSE 'Anunț nou pe Market' END
    ELSE ''
  END;
$$;

-- ─── 3. Fan-out la anunț nou pe Market ──────────────────────────────────────
CREATE OR REPLACE FUNCTION on_market_listing_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user record;
  v_body text;
BEGIN
  -- Un listing se naște 'active'; garda e pentru viitor (import/seed cu 'sold').
  IF NEW.status <> 'active' THEN
    RETURN NEW;
  END IF;

  -- „Anvelope camion 315/80" · 450 EUR". trim_scale taie zecimalele inutile ale
  -- lui numeric(12,2): 450.00 → 450, dar 450.50 rămâne 450.5.
  v_body := NEW.title || ' · ' || trim_scale(NEW.price)::text || ' ' || NEW.currency;

  FOR v_user IN
    SELECT profiles.id, COALESCE(lang, 'ro') AS lang
    FROM profiles
    WHERE profiles.id <> NEW.seller_id          -- nu te anunți pe tine
      AND deleted_at IS NULL                    -- Faza 15: pietre funerare
      AND push_enabled                          -- comutatorul global din Setări
      AND market_push_enabled                   -- comutatorul de Market (8 sept)
      AND NOT is_block_between(NEW.seller_id, profiles.id)  -- Faza 18
  LOOP
    -- Fără `tag`: fiecare anunț e un obiect distinct, ca la anunțurile de pe feed.
    -- Un tag comun ('market') ar colapsa totul într-o singură celulă pe Android și
    -- ar face invizibile anunțurile intermediare.
    PERFORM notify_push(
      v_user.id,
      push_text(v_user.lang, 'market_title'),
      v_body,
      jsonb_build_object('type', 'listing', 'id', NEW.id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS market_listings_notify ON market_listings;
CREATE TRIGGER market_listings_notify
  AFTER INSERT ON market_listings
  FOR EACH ROW EXECUTE FUNCTION on_market_listing_notify();

-- ─── Verificări (rulează-le după migrare) ───────────────────────────────────
-- a) Coloana + valoarea implicită:
--      SELECT column_name, is_nullable, column_default
--        FROM information_schema.columns
--       WHERE table_name = 'profiles' AND column_name = 'market_push_enabled';
--      -- așteptat: NO / true
--
-- b) Textul nou există în toate cele trei limbi:
--      SELECT push_text('ro','market_title'), push_text('en','market_title'),
--             push_text('de','market_title');
--
-- c) Triggerul e pe tabel:
--      SELECT tgname FROM pg_trigger
--       WHERE tgrelid = 'market_listings'::regclass AND NOT tgisinternal;
--      -- așteptat, printre altele: market_listings_notify
--
-- d) Câți ar primi un push la următorul anunț al unui vânzător oarecare:
--      SELECT count(*) FROM profiles
--       WHERE deleted_at IS NULL AND push_enabled AND market_push_enabled;
--
-- ⚠️ NU testa inserând un anunț real din aplicație: triggerul trimite push la
-- TOȚI utilizatorii. Testează cu un INSERT în tranzacție cu ROLLBACK, sau pe
-- un cont de test cu market_push_enabled = false pe toți ceilalți.
