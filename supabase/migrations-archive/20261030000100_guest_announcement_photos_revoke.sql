-- ─────────────────────────────────────────────────────────────────────────────
-- 30 oct 2026 — OASPEȚII NU MAI PRIMESC POZELE ANUNȚURILOR (după 20261026_guest_access, B1)
--
-- Cum se rulează: `BEGIN;` + fișier + `COMMIT;` (repetiție cu ROLLBACK). Rollback real:
-- supabase/rollback/20261030_guest_announcement_photos_revoke.sql
--
-- DE CE: din 25 oct 2026 oaspetele (rolul `anon`) vede doar LISTELE — detaliul anunțului,
-- profilul și detaliul din Market cer cont (cerere David: viitoarele abonamente). Cardul din
-- listă nu arată poze, deci singurul drum rămas spre pozele anunțurilor era API-ul direct, cu
-- cheia publică: view-ul `guest_announcement_photos` + grant-urile pe coloanele din
-- `announcement_photos` + politica de Storage pentru prefixul `announcements/`. Le scoatem.
--
-- DOAR SERVER, fără efect pentru conturi: toate obiectele atinse sunt DOAR pentru `anon`
-- (politici TO anon, grant-uri către anon, un view pe care îl citea doar oaspetele).
-- Clientul 1.1 nu mai apelează view-ul (fetchGuestAnnouncementPhotos a fost scos); 1.0.x nu
-- l-a cunoscut niciodată. Pozele din Market rămân (cardul din lista Market le arată).
-- ─────────────────────────────────────────────────────────────────────────────

SET LOCAL lock_timeout = '5s';

-- 1. View-ul de oaspete pentru pozele anunțurilor
DROP VIEW IF EXISTS public.guest_announcement_photos;

-- 2. Grant-urile pe coloane și politica de rând, pentru anon
REVOKE ALL ON public.announcement_photos FROM anon;            -- scoate și grant-urile pe coloane
DROP POLICY IF EXISTS announcement_photos_select_anon ON public.announcement_photos;

-- 3. Storage: fără URL-uri semnate pentru `announcements/<id>/...` ca anon
DROP POLICY IF EXISTS photos_select_announcement_anon ON storage.objects;

-- 4. Verificare (eșec = EXCEPTION = nimic nu se aplică)
DO $$
DECLARE
  v_bad text := '';
BEGIN
  IF to_regclass('public.guest_announcement_photos') IS NOT NULL THEN
    v_bad := v_bad || ' [view-ul guest_announcement_photos mai există]';
  END IF;
  IF has_any_column_privilege('anon', 'public.announcement_photos', 'SELECT')
     OR has_table_privilege('anon', 'public.announcement_photos', 'SELECT') THEN
    v_bad := v_bad || ' [anon mai citește announcement_photos]';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'announcement_photos'
              AND roles = ARRAY['anon']::name[]) THEN
    v_bad := v_bad || ' [politica anon pe announcement_photos mai există]';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'photos_select_announcement_anon') THEN
    v_bad := v_bad || ' [politica de storage pentru anon mai există]';
  END IF;
  -- Restul accesului de oaspete rămâne neatins: 7 politici anon în public, 2 în storage, 6 view-uri.
  IF (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND roles = ARRAY['anon']::name[]) <> 7
     OR (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND roles = ARRAY['anon']::name[]) <> 2
     OR (SELECT count(*) FROM pg_views WHERE schemaname = 'public' AND viewname LIKE 'guest\_%') <> 6 THEN
    v_bad := v_bad || ' [numărul politicilor/view-urilor de oaspete nu e cel așteptat]';
  END IF;
  -- authenticated: neatins (politicile lui pe announcement_photos nu sunt TO anon)
  IF NOT has_table_privilege('authenticated', 'public.announcement_photos', 'SELECT') THEN
    v_bad := v_bad || ' [authenticated a pierdut SELECT pe announcement_photos]';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'guest_announcement_photos_revoke verificare EȘUATĂ:%', v_bad;
  END IF;
  RAISE NOTICE 'guest_announcement_photos_revoke verificare: PASS';
END $$;

-- Rezumat. Așteptat: toate PASS.
SELECT 1 AS nr, 'anon: fără view, fără coloane, fără politică pe announcement_photos' AS verificare,
       CASE WHEN to_regclass('public.guest_announcement_photos') IS NULL
                 AND NOT has_any_column_privilege('anon', 'public.announcement_photos', 'SELECT')
                 AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'announcement_photos' AND roles = ARRAY['anon']::name[])
            THEN 'PASS' ELSE 'FAIL' END AS stare, '' AS detaliu
UNION ALL
SELECT 2, 'storage: fără politică anon pentru announcements/',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'photos_select_announcement_anon')
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 3, 'restul accesului de oaspete neatins (7 politici public, 2 storage, 6 view-uri)',
       CASE WHEN (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND roles = ARRAY['anon']::name[]) = 7
                 AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND roles = ARRAY['anon']::name[]) = 2
                 AND (SELECT count(*) FROM pg_views WHERE schemaname = 'public' AND viewname LIKE 'guest\_%') = 6
            THEN 'PASS' ELSE 'FAIL' END, ''
UNION ALL
SELECT 4, 'authenticated: SELECT pe announcement_photos păstrat',
       CASE WHEN has_table_privilege('authenticated', 'public.announcement_photos', 'SELECT') THEN 'PASS' ELSE 'FAIL' END, ''
ORDER BY nr;
