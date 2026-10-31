-- Poarta 4.1 (PLAN_1.1_FIX, faza 4): datele de probă pentru rejucarea cererilor 1.0.x în CI.
-- Rulează ca `postgres` pe baza locală din CI (supabase start), ÎNAINTE de replay-ul „before”.
-- Niciodată pe producție. Toate id-urile sunt fixe (le folosește scripts/replay-1_0_8.mjs).
--
-- Persoane: A = șofer (are anunțuri deschise/acceptat/rezolvat/anulat), B = al doilea șofer,
-- M1 = mecanic acceptat pe anunțul lui A (conversație, rating), M2 = mecanic NEacceptat (candidatură
-- în așteptare, conversație directă cu A), X = admin, W1/W2 = conturi fără profil (POST profiles în
-- „before” / „after”), D = profil șters (piatră funerară), BN = profil banat.
-- Scrierile ca postgres sar peste gărzile de client (current_user) și peste limite (auth.uid() NULL),
-- exact ca o migrare; nu există push_tokens, deci notificările nu trimit nimic.
BEGIN;

-- ── 1. Utilizatori GoTrue (login prin parolă în replay: Gate-1234) ───────────────────────────
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change,
                        phone_change, phone_change_token, email_change_token_current, reauthentication_token,
                        is_sso_user, is_anonymous)
SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
       extensions.crypt('Gate-1234', extensions.gen_salt('bf')), now() - interval '40 days',
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
       now() - interval '40 days', now() - interval '40 days',
       '', '', '', '', '', '', '', '', false, false
  FROM (VALUES
    ('a0000000-0000-4000-8000-00000000000a'::uuid, 'gate-driver-a@example.com'),
    ('b0000000-0000-4000-8000-00000000000b', 'gate-driver-b@example.com'),
    ('c0000000-0000-4000-8000-0000000000c1', 'gate-mech-acc@example.com'),
    ('c0000000-0000-4000-8000-0000000000c2', 'gate-mech-open@example.com'),
    ('d0000000-0000-4000-8000-00000000000d', 'gate-admin@example.com'),
    ('e0000000-0000-4000-8000-0000000000e1', 'gate-new-before@example.com'),
    ('e0000000-0000-4000-8000-0000000000e2', 'gate-new-after@example.com'),
    ('f0000000-0000-4000-8000-0000000000f1', 'gate-deleted@example.com'),
    ('f0000000-0000-4000-8000-0000000000f2', 'gate-banned@example.com')
  ) AS u(id, email);

INSERT INTO auth.identities (user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
SELECT id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true),
       'email', id::text, now() - interval '40 days', now() - interval '40 days', now() - interval '40 days'
  FROM auth.users WHERE email LIKE 'gate-%@example.com';

-- ── 2. Canalul global (înaintea profilurilor: triggerul de pe profiles seamănă preferințele) ──
INSERT INTO public.channels (id, name, type, created_at)
VALUES ('44444444-0000-4000-8000-000000000001', 'TruckSOS', 'global', now() - interval '60 days');

-- ── 3. Profiluri ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.profiles (id, full_name, role, created_at, specialization, activity_zone, phone,
                             avatar_path, push_enabled, notify_radius_km, latitude, longitude, lang,
                             deleted_at, company_name, contact_email, banned_at, banned_until, ban_reason,
                             address, vat_number, market_push_enabled, mention_push_enabled)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'Gate Driver A', 'driver', now() - interval '39 days', NULL, NULL,
   '+40700000001', 'avatars/a0000000-0000-4000-8000-00000000000a/avatar.jpg', true, NULL, 44.4268, 26.1025, 'ro',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('b0000000-0000-4000-8000-00000000000b', 'Gate Driver B', 'driver', now() - interval '38 days', NULL, NULL,
   '+40700000002', NULL, true, NULL, 46.7712, 23.6236, 'en',
   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('c0000000-0000-4000-8000-0000000000c1', 'Gate Mechanic Accepted', 'mechanic', now() - interval '37 days',
   'Motor, frane', 'Bucuresti si Ilfov', '+40700000011', 'avatars/c0000000-0000-4000-8000-0000000000c1/avatar.jpg',
   true, 50, 44.5000, 26.2000, 'ro', NULL, 'Gate Service SRL', 'service@example.com', NULL, NULL, NULL,
   'Str. Probei 1, Bucuresti', 'RO12345678', true, true),
  ('c0000000-0000-4000-8000-0000000000c2', 'Gate Mechanic Open', 'mechanic', now() - interval '36 days',
   'Electrica', 'Cluj', '+40700000012', NULL, true, 100, 46.8000, 23.6000, 'de', NULL, 'Gate Werkstatt GmbH',
   'werkstatt@example.com', NULL, NULL, NULL, 'Cluj-Napoca, Str. 2', 'RO87654321', true, true),
  ('d0000000-0000-4000-8000-00000000000d', 'Gate Admin', 'admin', now() - interval '35 days', NULL, NULL,
   '+40700000099', NULL, true, NULL, NULL, NULL, 'ro', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('f0000000-0000-4000-8000-0000000000f1', '', 'driver', now() - interval '34 days', NULL, NULL,
   NULL, NULL, false, NULL, NULL, NULL, 'ro', now() - interval '10 days', NULL, NULL, NULL, NULL, NULL, NULL, NULL, true, true),
  ('f0000000-0000-4000-8000-0000000000f2', 'Gate Banned', 'driver', now() - interval '33 days', NULL, NULL,
   '+40700000077', NULL, true, NULL, 44.4, 26.1, 'ro', NULL, NULL, NULL, now() - interval '2 days', NULL,
   'gate: spam', NULL, NULL, true, true);

-- ── 4. Anunțuri ale lui A și B ───────────────────────────────────────────────────────────────
INSERT INTO public.announcements (id, driver_id, description, location, status, mechanic_id, created_at, updated_at,
                                  truck_make, truck_model, truck_year, plate_number, latitude, longitude,
                                  hidden_from_history, chassis_number, source_lang)
VALUES
  ('11111111-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Gate: pana motor A1 (deschis)',
   'A1 km 36, Bucuresti', 'open', NULL, now() - interval '3 hours', now() - interval '3 hours',
   'Volvo', 'FH16', 2019, 'B-123-GATE', 44.4268, 26.1025, false, 'YV2RT40A8KB123456', 'ro'),
  ('11111111-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'Gate: frane A2 (acceptat de M1)',
   'DN1, Otopeni', 'accepted', 'c0000000-0000-4000-8000-0000000000c1', now() - interval '2 days', now() - interval '1 day',
   'MAN', 'TGX', 2020, 'B-456-GATE', 44.5500, 26.0700, false, 'WMA06XZZ1KM654321', 'ro'),
  ('11111111-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000a', 'Gate: anvelopa A3 (rezolvat cu M1)',
   'A2 km 100', 'resolved', 'c0000000-0000-4000-8000-0000000000c1', now() - interval '20 days', now() - interval '19 days',
   'DAF', 'XF', 2018, 'B-789-GATE', 44.3000, 27.0000, false, NULL, 'ro'),
  ('11111111-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-00000000000a', 'Gate: anulat A4 (vechi)',
   'Pitesti', 'cancelled', NULL, now() - interval '40 hours', now() - interval '35 hours',
   NULL, NULL, NULL, NULL, 44.8565, 24.8692, false, NULL, 'ro'),
  ('11111111-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-00000000000b', 'Gate: pana B1 (deschis)',
   'Cluj, Floresti', 'open', NULL, now() - interval '1 hour', now() - interval '1 hour',
   'Mercedes', 'Actros', 2021, 'CJ-11-GATE', 46.7500, 23.5000, false, 'WDB9634031L000111', 'en'),
  ('11111111-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-00000000000a', 'Gate: fara locatie A6 (deschis)',
   'Undeva pe traseu', 'open', NULL, now() - interval '30 minutes', now() - interval '30 minutes',
   NULL, NULL, NULL, NULL, NULL, NULL, false, NULL, 'ro');

INSERT INTO public.announcement_photos (id, announcement_id, storage_path, created_at)
VALUES
  ('66666666-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'announcements/11111111-0000-4000-8000-000000000001/p1.jpg', now() - interval '3 hours'),
  ('66666666-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002',
   'announcements/11111111-0000-4000-8000-000000000002/p1.jpg', now() - interval '2 days');

-- ── 5. Candidaturi ───────────────────────────────────────────────────────────────────────────
INSERT INTO public.applications (id, announcement_id, mechanic_id, price_type, price_amount, currency, message, status, created_at, updated_at)
VALUES
  ('22222222-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c2',
   'fixed', 350.00, 'RON', 'Gate: pot veni in 40 min', 'pending', now() - interval '2 hours', now() - interval '2 hours'),
  ('22222222-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-0000000000c1',
   'hourly', 120.00, 'RON', NULL, 'accepted', now() - interval '2 days', now() - interval '1 day'),
  ('22222222-0000-4000-8000-000000000003', '11111111-0000-4000-8000-000000000005', 'c0000000-0000-4000-8000-0000000000c2',
   'fixed', 200.00, 'EUR', 'Gate: oferta', 'rejected', now() - interval '50 minutes', now() - interval '40 minutes');

-- ── 6. Market (M1 vinde, B vinde) ────────────────────────────────────────────────────────────
INSERT INTO public.market_listings (id, seller_id, title, description, price, currency, category, status, created_at, updated_at)
VALUES
  ('55555555-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1', 'Gate: turbo Volvo FH',
   'Turbo recondiționat, garanție 6 luni.', 1200.00, 'EUR', 'parts', 'active', now() - interval '5 days', now() - interval '5 days'),
  ('55555555-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000000b', 'Gate: anvelope 315/80',
   'Set 4 anvelope, 60%.', 2400.00, 'RON', 'tires', 'active', now() - interval '4 days', now() - interval '4 days');

INSERT INTO public.market_listing_photos (id, listing_id, storage_path, position, created_at)
VALUES
  ('77777777-0000-4000-8000-000000000001', '55555555-0000-4000-8000-000000000001',
   'market/55555555-0000-4000-8000-000000000001/1.jpg', 0, now() - interval '5 days'),
  ('77777777-0000-4000-8000-000000000002', '55555555-0000-4000-8000-000000000001',
   'market/55555555-0000-4000-8000-000000000001/2.jpg', 1, now() - interval '5 days');

-- ── 7. Conversații și mesaje ─────────────────────────────────────────────────────────────────
INSERT INTO public.conversations (id, announcement_id, driver_id, mechanic_id, created_at, is_direct, listing_id)
VALUES
  ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a',
   'c0000000-0000-4000-8000-0000000000c1', now() - interval '1 day', false, NULL),
  ('33333333-0000-4000-8000-000000000002', NULL, 'a0000000-0000-4000-8000-00000000000a',
   'c0000000-0000-4000-8000-0000000000c2', now() - interval '12 hours', true, NULL),
  ('33333333-0000-4000-8000-000000000003', NULL, 'b0000000-0000-4000-8000-00000000000b',
   'c0000000-0000-4000-8000-0000000000c1', now() - interval '3 days', false, '55555555-0000-4000-8000-000000000001');

INSERT INTO public.messages (id, conversation_id, sender_id, content, created_at, image_path, reply_to_id,
                             listing_id, recommended_mechanic_id, file_path, file_name, file_size, announcement_id, mentions)
VALUES
  ('88888888-0000-4000-8000-000000000001', '33333333-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   'Gate: buna, cand ajungeti?', now() - interval '23 hours', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('88888888-0000-4000-8000-000000000002', '33333333-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1',
   'Gate: in 30 de minute', now() - interval '22 hours', NULL, '88888888-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('88888888-0000-4000-8000-000000000003', '33333333-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   '', now() - interval '21 hours', NULL, NULL, NULL, 'c0000000-0000-4000-8000-0000000000c2', NULL, NULL, NULL, NULL, NULL),
  ('88888888-0000-4000-8000-000000000004', '33333333-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1',
   '', now() - interval '20 hours', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '11111111-0000-4000-8000-000000000001', NULL),
  ('88888888-0000-4000-8000-000000000005', '33333333-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   '', now() - interval '19 hours', NULL, NULL, '55555555-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, NULL, NULL),
  ('88888888-0000-4000-8000-000000000006', '33333333-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1',
   '', now() - interval '18 hours', 'chat/33333333-0000-4000-8000-000000000001/img1.jpg', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('88888888-0000-4000-8000-000000000007', '33333333-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   '', now() - interval '17 hours', NULL, NULL, NULL, NULL, 'chat/33333333-0000-4000-8000-000000000001/doc.pdf', 'factura.pdf', 20480, NULL, NULL),
  ('88888888-0000-4000-8000-000000000008', '33333333-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a',
   'Gate: salut M2, @Gate Mechanic Open', now() - interval '11 hours', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
   '[{"id":"c0000000-0000-4000-8000-0000000000c2","name":"Gate Mechanic Open"}]'::jsonb),
  ('88888888-0000-4000-8000-000000000009', '33333333-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-00000000000b',
   'Gate: mai e disponibil turbo-ul?', now() - interval '2 days', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO public.message_reads (conversation_id, user_id, last_read_at)
VALUES
  ('33333333-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', now() - interval '16 hours'),
  ('33333333-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1', now() - interval '18 hours'),
  ('33333333-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-0000000000c2', now() - interval '10 hours');

INSERT INTO public.conversation_deletions (conversation_id, user_id, deleted_at)
VALUES ('33333333-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-00000000000b', now() - interval '1 day');

-- ── 8. Canal: mesaje cu reply, mențiuni, recomandare, anunț, listing ─────────────────────────
INSERT INTO public.channel_messages (id, channel_id, sender_id, content, created_at, image_path, reply_to_id,
                                     listing_id, recommended_mechanic_id, file_path, file_name, file_size, announcement_id, mentions)
VALUES
  ('99999999-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   'Gate: cineva prin Cluj?', now() - interval '6 hours', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('99999999-0000-4000-8000-000000000002', '44444444-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1',
   'Gate: @Gate Driver A da, eu', now() - interval '5 hours', NULL, '99999999-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, NULL, NULL,
   '[{"id":"a0000000-0000-4000-8000-00000000000a","name":"Gate Driver A"}]'::jsonb),
  ('99999999-0000-4000-8000-000000000003', '44444444-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c2',
   '', now() - interval '4 hours', NULL, NULL, NULL, 'c0000000-0000-4000-8000-0000000000c1', NULL, NULL, NULL, NULL, NULL),
  ('99999999-0000-4000-8000-000000000004', '44444444-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-00000000000b',
   '', now() - interval '3 hours', NULL, NULL, NULL, NULL, NULL, NULL, NULL, '11111111-0000-4000-8000-000000000005', NULL),
  ('99999999-0000-4000-8000-000000000005', '44444444-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a',
   '', now() - interval '2 hours', NULL, NULL, '55555555-0000-4000-8000-000000000001', NULL, NULL, NULL, NULL, NULL, NULL),
  ('99999999-0000-4000-8000-000000000006', '44444444-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1',
   '', now() - interval '1 hour', 'channel/44444444-0000-4000-8000-000000000001/img.jpg', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

INSERT INTO public.channel_reads (channel_id, user_id, last_read_at)
VALUES
  ('44444444-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', now() - interval '90 minutes'),
  ('44444444-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1', now() - interval '2 hours'),
  ('44444444-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c2', now() - interval '3 hours');

-- ── 9. Favorite, istoric căutări, camioane, rating, raport, versiuni ─────────────────────────
INSERT INTO public.favorite_mechanics (driver_id, mechanic_id, created_at)
VALUES
  ('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-0000000000c1', now() - interval '10 days'),
  ('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-0000000000c2', now() - interval '9 days');

INSERT INTO public.search_history (driver_id, mechanic_id, searched_at)
VALUES ('a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-0000000000c1', now() - interval '8 days');

INSERT INTO public.trucks (id, driver_id, make, model, year, nickname, created_at, plate_number, chassis_number)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Volvo', 'FH16', 2019,
        'Gate Camion', now() - interval '30 days', 'B-123-GATE', 'YV2RT40A8KB123456');

-- Rating-ul A → M1 pe anunțul rezolvat (triggerul recalculează rating_avg/rating_count pe M1).
INSERT INTO public.ratings (id, mechanic_id, driver_id, stars, comment, created_at, updated_at)
VALUES ('bbbbbbbb-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-0000000000c1', 'a0000000-0000-4000-8000-00000000000a',
        5, 'Gate: prompt si corect', now() - interval '19 days', now() - interval '19 days');

INSERT INTO public.reports (id, reporter_id, reported_user_id, message_id, message_table, reason, details, content_snapshot, status, created_at)
VALUES ('cccccccc-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'c0000000-0000-4000-8000-0000000000c2',
        '99999999-0000-4000-8000-000000000003', 'channel_messages', 'spam', 'Gate: raport de proba', '', 'pending', now() - interval '1 hour');

INSERT INTO public.app_versions (platform, latest_version, store_url, updated_at)
VALUES ('android', '1.0.8', 'https://play.google.com/store/apps/details?id=net.trucksos.app', now() - interval '15 days'),
       ('ios', '1.0.8', 'https://apps.apple.com/app/id6801003473', now() - interval '15 days')
ON CONFLICT DO NOTHING;

-- ── 10. Verificări de consistență (pică tranzacția dacă fixturile nu sunt cum le așteaptă replay-ul) ──
DO $$
BEGIN
  IF (SELECT count(*) FROM auth.users WHERE email LIKE 'gate-%@example.com') <> 9 THEN RAISE EXCEPTION 'fixtures: users'; END IF;
  IF (SELECT count(*) FROM public.profiles WHERE full_name LIKE 'Gate %' OR full_name = '') <> 7 THEN RAISE EXCEPTION 'fixtures: profiles'; END IF;
  IF (SELECT count(*) FROM public.announcements WHERE driver_id = 'a0000000-0000-4000-8000-00000000000a' AND status = 'open') <> 2 THEN
    RAISE EXCEPTION 'fixtures: A trebuie sa aiba exact 2 anunturi deschise (replay-ul mai adauga 2 pe faza, sub plafonul de 5)';
  END IF;
  IF (SELECT rating_count FROM public.profiles WHERE id = 'c0000000-0000-4000-8000-0000000000c1') <> 1 THEN RAISE EXCEPTION 'fixtures: rating M1'; END IF;
  IF (SELECT count(*) FROM public.channel_push_prefs WHERE channel_id = '44444444-0000-4000-8000-000000000001') < 5 THEN RAISE EXCEPTION 'fixtures: channel_push_prefs'; END IF;
END $$;

COMMIT;
