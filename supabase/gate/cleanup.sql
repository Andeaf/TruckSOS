-- Poarta 4.1: curățarea urmelor lăsate de fluxurile de scriere din replay-ul „before”, ca replay-ul „after”
-- să vadă exact aceleași date (compararea e pe cod HTTP + număr de rânduri + chei). Rulează ca postgres,
-- pe schema de DINAINTE de migrări (tabelele sunt încă în public). Niciodată pe producție.
BEGIN;

-- Anunțurile create de replay (N1 e deja șters de replay; N2 e rezolvat + ascuns): cascadă pe poze, candidaturi,
-- vizualizări; conversația creată de accept_application rămâne cu announcement_id NULL și se șterge mai jos.
DELETE FROM public.announcements
 WHERE driver_id = 'a0000000-0000-4000-8000-00000000000a'
   AND id NOT IN ('11111111-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002',
                  '11111111-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000004',
                  '11111111-0000-4000-8000-000000000006');
DELETE FROM public.conversations
 WHERE id NOT IN ('33333333-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000003')
   AND (driver_id::text LIKE 'a0000000-%' OR driver_id::text LIKE 'b0000000-%' OR driver_id::text LIKE 'c0000000-%'
        OR driver_id::text LIKE 'd0000000-%' OR driver_id::text LIKE 'e0000000-%');
DELETE FROM public.applications
 WHERE id NOT IN ('22222222-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000003');
DELETE FROM public.announcement_views WHERE viewer_id::text LIKE 'c0000000-%';
DELETE FROM public.push_tokens WHERE token LIKE 'ExponentPushToken[gate-%';
DELETE FROM app.rate_events WHERE user_id::text LIKE 'a0000000-%' OR user_id::text LIKE 'c0000000-%' OR user_id::text LIKE 'e0000000-%';

-- Contul nou al fazei (W1/W2) rămâne fără profil pentru faza următoare.
DELETE FROM public.profiles WHERE id IN ('e0000000-0000-4000-8000-0000000000e1', 'e0000000-0000-4000-8000-0000000000e2');

-- Valorile schimbate de PATCH-uri și de upsert-ul de rating revin la cele din fixtures.
UPDATE public.profiles
   SET notify_radius_km = NULL, push_enabled = true, market_push_enabled = true,
       full_name = 'Gate Driver A', phone = '+40700000001', company_name = NULL, contact_email = NULL,
       address = NULL, vat_number = NULL, avatar_path = 'avatars/a0000000-0000-4000-8000-00000000000a/avatar.jpg'
 WHERE id = 'a0000000-0000-4000-8000-00000000000a';
UPDATE public.ratings SET stars = 5, comment = 'Gate: prompt si corect'
 WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001';
-- Pașii cu service_role din replay (ca Edge Functions cleanup-announcements / translate-announcement).
UPDATE public.announcements SET status = 'open' WHERE id = '11111111-0000-4000-8000-000000000006';
UPDATE public.announcements SET source_lang = 'ro', source_lang_detected = false WHERE id = '11111111-0000-4000-8000-000000000001';

DO $$
BEGIN
  IF (SELECT count(*) FROM public.announcements WHERE driver_id = 'a0000000-0000-4000-8000-00000000000a') <> 5 THEN RAISE EXCEPTION 'cleanup: anunturile lui A'; END IF;
  IF (SELECT count(*) FROM public.conversations) <> 3 THEN RAISE EXCEPTION 'cleanup: conversatii'; END IF;
  IF (SELECT count(*) FROM public.applications) <> 3 THEN RAISE EXCEPTION 'cleanup: candidaturi'; END IF;
  IF (SELECT count(*) FROM public.profiles WHERE id::text LIKE 'e0000000-%') <> 0 THEN RAISE EXCEPTION 'cleanup: profil W'; END IF;
  IF (SELECT rating_avg FROM public.profiles WHERE id = 'c0000000-0000-4000-8000-0000000000c1') <> 5.0 THEN RAISE EXCEPTION 'cleanup: rating M1'; END IF;
END $$;

COMMIT;
