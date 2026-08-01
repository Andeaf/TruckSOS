-- ─────────────────────────────────────────────────────────────────────────────
--- FIX: ștergerea unui anunț / listare / profil pica dacă acesta fusese trimis
--- ca mesaj DOAR-atașament (fără text), din cauza CHECK-ului `text_or_image`.
---
--- Cauza: FK-urile `messages.listing_id` / `announcement_id` /
--- `recommended_mechanic_id` (și perechile lor din `channel_messages`) sunt
--- ON DELETE SET NULL. La mesajele introduse de Faza 19.6b — trimise fără text,
--- cu atașamentul drept unic conținut — nularea coloanei golește complet rândul,
--- iar CHECK-ul îl respinge → EROARE 23514 și ÎNTREAGA ștergere eșuează.
--- Se manifesta în aplicație: userul nu-și putea șterge propriul anunț de Market
--- dacă îl distribuise cuiva în chat fără să scrie nimic.
---
--- Fix: triggere BEFORE DELETE care transformă exact acele mesaje în tombstone
--- (`deleted_at`) ÎNAINTE ca FK-ul să nuleze coloana. CHECK-ul trece pe prima
--- ramură (`deleted_at IS NOT NULL`), iar în UI mesajul apare ca „Mesaj șters" —
--- comportamentul corect, de vreme ce ținta cardului nu mai există.
---
--- Condiția de tombstone verifică TOATE celelalte surse de conținut din CHECK,
--- ca să nu atingem mesajele care mai au text, poză, fișier sau un al doilea
--- atașament — acelea rămân intacte, doar cu coloana nulată.
--- Idempotentă: se poate rula de câte ori e nevoie.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── market_listings ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_listing_delete_tombstone_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE messages SET deleted_at = now()
    WHERE listing_id = OLD.id AND deleted_at IS NULL AND content = ''
      AND image_path IS NULL AND file_path IS NULL
      AND announcement_id IS NULL AND recommended_mechanic_id IS NULL;

  UPDATE channel_messages SET deleted_at = now()
    WHERE listing_id = OLD.id AND deleted_at IS NULL AND content = ''
      AND image_path IS NULL AND file_path IS NULL
      AND announcement_id IS NULL AND recommended_mechanic_id IS NULL;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_listing_delete_tombstone ON market_listings;
CREATE TRIGGER trg_listing_delete_tombstone
  BEFORE DELETE ON market_listings
  FOR EACH ROW EXECUTE FUNCTION on_listing_delete_tombstone_messages();

-- ── announcements ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION on_announcement_delete_tombstone_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE messages SET deleted_at = now()
    WHERE announcement_id = OLD.id AND deleted_at IS NULL AND content = ''
      AND image_path IS NULL AND file_path IS NULL
      AND listing_id IS NULL AND recommended_mechanic_id IS NULL;

  UPDATE channel_messages SET deleted_at = now()
    WHERE announcement_id = OLD.id AND deleted_at IS NULL AND content = ''
      AND image_path IS NULL AND file_path IS NULL
      AND listing_id IS NULL AND recommended_mechanic_id IS NULL;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_announcement_delete_tombstone ON announcements;
CREATE TRIGGER trg_announcement_delete_tombstone
  BEFORE DELETE ON announcements
  FOR EACH ROW EXECUTE FUNCTION on_announcement_delete_tombstone_messages();

-- ── profiles (recomandările de mecanic / transportator) ──────────────────────
-- Ștergerea contului trece prin `_purge_user_data`, dar FK-ul e generic pe
-- profiles: acoperim și cazul unei ștergeri directe a rândului.
CREATE OR REPLACE FUNCTION on_profile_delete_tombstone_messages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE messages SET deleted_at = now()
    WHERE recommended_mechanic_id = OLD.id AND deleted_at IS NULL AND content = ''
      AND image_path IS NULL AND file_path IS NULL
      AND listing_id IS NULL AND announcement_id IS NULL;

  UPDATE channel_messages SET deleted_at = now()
    WHERE recommended_mechanic_id = OLD.id AND deleted_at IS NULL AND content = ''
      AND image_path IS NULL AND file_path IS NULL
      AND listing_id IS NULL AND announcement_id IS NULL;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_delete_tombstone ON profiles;
CREATE TRIGGER trg_profile_delete_tombstone
  BEFORE DELETE ON profiles
  FOR EACH ROW EXECUTE FUNCTION on_profile_delete_tombstone_messages();

-- ─────────────────────────────────────────────────────────────────────────────
--- TEST (Studio):
---   1. Creezi o listare L și trimiți-o în chat FĂRĂ text (mesaj doar-card).
---   2. `DELETE FROM market_listings WHERE id = L;`
---      ÎNAINTE de fix: ERROR 23514 messages_text_or_image.
---      DUPĂ fix: reușește, iar mesajul are `deleted_at` setat.
---   3. Un mesaj cu TEXT + card pe aceeași listare rămâne intact, doar cu
---      listing_id = NULL (verifică `deleted_at IS NULL` pe el).
-- ─────────────────────────────────────────────────────────────────────────────
