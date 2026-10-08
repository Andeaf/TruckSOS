-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 15 sept 2026 (b) — Anunț expirat: „Marchează ca rezolvat" + „Repostează 30h"
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (doar CREATE OR REPLACE).
-- Sigură ÎNAINTE de update-ul de aplicație (1.0.6): clientul vechi apelează
-- resolve_open_announcement doar pe anunțuri `open`, iar repost_announcement e nou.
--
-- CONTEXT: la 30h un anunț `open` e trecut în `cancelled` de EF cleanup-announcements
-- (pozele lui se șterg din Storage). Șoferul îl vedea la „Toate" cu „Anulat" și fără
-- nicio acțiune (cererea din 11 sept, detaliată 15 sept):
--   1. să-l poată marca REZOLVAT și după ce a dispărut (aceleași butoane ca pe `open`);
--   2. să-l poată REPOSTA pentru încă 30 de ore, ca și cum l-ar posta din nou.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. resolve_open_announcement acceptă și `cancelled` ──────────────────────
-- Corpul din 20260904, cu o singură schimbare: status IN ('open', 'cancelled').
-- RLS-ul de UPDATE (announcements_update_resolve) permite doar accepted→resolved,
-- deci drumul cancelled→resolved trece tot prin RPC. Candidaturile `pending` rămase
-- (expirarea NU le atinge) se resping în aceeași tranzacție, ca la `open`.
CREATE OR REPLACE FUNCTION resolve_open_announcement(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements
     SET status = 'resolved'
   WHERE id = p_announcement_id
     AND driver_id = auth.uid()
     AND status IN ('open', 'cancelled');

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  UPDATE applications
     SET status = 'rejected'
   WHERE announcement_id = p_announcement_id
     AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION resolve_open_announcement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION resolve_open_announcement(uuid) TO authenticated;

-- ── 2. Fan-out-ul „anunț nou" scos într-o funcție refolosibilă ───────────────
-- Corpul EXACT al lui on_announcement_notify (20260721, Faza 18: fără perechile
-- blocate, cu raza de notificare) — triggerul îl deleagă de acum, iar repostarea îl
-- reapelează: pentru mecanici un anunț repostat E un anunț nou (fără push, butonul
-- ar fi mai slab decât „postează din nou", care notifică, și șoferii l-ar ocoli).
CREATE OR REPLACE FUNCTION notify_mechanics_new_announcement(p_announcement announcements)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_mechanic record;
BEGIN
  FOR v_mechanic IN
    SELECT profiles.id, COALESCE(lang, 'ro') AS lang
    FROM profiles
    WHERE role = 'mechanic'
      AND profiles.id <> p_announcement.driver_id
      AND push_enabled
      AND NOT is_block_between(p_announcement.driver_id, profiles.id)   -- Faza 18
      AND (
        notify_radius_km IS NULL
        OR (
          p_announcement.latitude IS NOT NULL AND p_announcement.longitude IS NOT NULL
          AND latitude IS NOT NULL AND longitude IS NOT NULL
          AND distance_km(latitude, longitude, p_announcement.latitude, p_announcement.longitude)
              <= notify_radius_km
        )
      )
  LOOP
    PERFORM notify_push(
      v_mechanic.id,
      push_text(v_mechanic.lang, 'announcement_title'),
      p_announcement.location,
      jsonb_build_object('type', 'feed', 'id', p_announcement.id)
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION notify_mechanics_new_announcement(announcements) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION on_announcement_notify()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.status <> 'open' THEN
    RETURN NEW;
  END IF;
  PERFORM notify_mechanics_new_announcement(NEW);
  RETURN NEW;
END;
$$;
-- Triggerul announcements_notify (AFTER INSERT, Faza 12.4) rămâne neschimbat — arată
-- spre funcția de mai sus, căreia i-am înlocuit doar corpul.

-- ── 3. repost_announcement ───────────────────────────────────────────────────
-- Doar pe anunț `cancelled` PROPRIU, mai vechi de 30h (= chiar expirat, sau anulat
-- demult): fără garda de 30h, „anulează → repostează" ar fi o buclă ieftină de
-- push-uri către toți mecanicii. created_at se resetează: anunțul urcă în capul
-- feedului și primește din nou 30h de la EF (aceeași constantă, HOURS = 30);
-- updated_at îl bumpează triggerul announcements_updated_at (caseta „rezolvat?"
-- reapare după 12h); ban_guard rulează normal. Candidaturile `pending` rămase se
-- PĂSTREAZĂ (ofertele vechi rămân valabile pentru șofer). Pozele șterse la expirare
-- nu revin — anunțul repostat e fără poze (nu există editare de anunț).
CREATE OR REPLACE FUNCTION repost_announcement(p_announcement_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row announcements;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE announcements
     SET status = 'open',
         created_at = now()
   WHERE id = p_announcement_id
     AND driver_id = auth.uid()
     AND status = 'cancelled'
     AND created_at < now() - interval '30 hours'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Announcement not available';
  END IF;

  PERFORM notify_mechanics_new_announcement(v_row);
END;
$$;

REVOKE ALL ON FUNCTION repost_announcement(uuid) FROM public;
GRANT EXECUTE ON FUNCTION repost_announcement(uuid) TO authenticated;

-- ── Verificare ───────────────────────────────────────────────────────────────
-- a) Funcțiile există:
--      SELECT proname FROM pg_proc WHERE proname IN
--        ('resolve_open_announcement','notify_mechanics_new_announcement',
--         'on_announcement_notify','repost_announcement');
-- b) Triggerul e neschimbat:
--      SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'announcements_notify';
-- c) Rezolvat pe expirat (cont propriu, anunț `cancelled` >30h, în app sau SQL):
--      SELECT resolve_open_announcement('<id>');  -- status → resolved, pending → rejected
-- d) Repostare — ATENȚIE: trimite push REAL tuturor mecanicilor din rază (ca un anunț
--    nou). Testează cu un anunț propriu expirat, într-un moment liniștit:
--      SELECT repost_announcement('<id>');
--      SELECT status, created_at, updated_at FROM announcements WHERE id = '<id>';
--    Pe `cancelled` mai tânăr de 30h sau pe anunțul altcuiva → 'Announcement not available'.
-- Rollback: DROP FUNCTION IF EXISTS repost_announcement(uuid);
--   DROP FUNCTION IF EXISTS notify_mechanics_new_announcement(announcements) — DUPĂ ce
--   re-rulezi definiția on_announcement_notify din 20260721_faza18_etapa180_blocking (§6);
--   resolve_open_announcement: definiția din 20260904.
