-- Faza 14 Etapa 8: limită de 10 poze per anunț (impusă și în DB)
-- Rulează în Supabase Studio → SQL Editor.
--
-- UI-ul dezactivează deja butonul de adăugare la 10 (client). Aici punem o plasă de
-- siguranță în DB: un trigger BEFORE INSERT care refuză a 11-a poză pe același anunț.
-- (Chatul — 10 poze deodată — rămâne doar UI: fiecare poză e un mesaj separat, fără
-- grupare naturală în DB pe care s-o numărăm.)

CREATE OR REPLACE FUNCTION enforce_announcement_photo_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT count(*) FROM announcement_photos WHERE announcement_id = NEW.announcement_id) >= 10 THEN
    RAISE EXCEPTION 'photo_limit_reached';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_announcement_photo_limit ON announcement_photos;
CREATE TRIGGER trg_announcement_photo_limit
  BEFORE INSERT ON announcement_photos
  FOR EACH ROW EXECUTE FUNCTION enforce_announcement_photo_limit();

-- ─── Verificare (manual) ────────────────────────────────────────────────────
--   INSERT a 11-a poză pe un anunț cu 10 → EXCEPTION photo_limit_reached.
