-- Poarta 4.1: verificări de VALORI după fluxurile de scriere din replay (compararea before/after vede doar codul
-- HTTP, numărul de rânduri și cheile). Rulează ca postgres după fiecare replay (pe tabel înainte de migrare,
-- pe view după), ÎNAINTE de cleanup. Pică (ON_ERROR_STOP) dacă o scriere prin view a stricat date reale:
-- un PATCH cu service_role (auth.uid() NULL) nu are voie să șteargă plăcuța/VIN-ul sau să rotunjească
-- coordonatele; PATCH-urile proprietarului schimbă doar coloana cerută.
DO $$
DECLARE r record;
BEGIN
  -- A6 ('fara locatie'), expirat de pasul service_role ca în cleanup-announcements: doar status s-a schimbat.
  SELECT * INTO r FROM public.announcements WHERE id = '11111111-0000-4000-8000-000000000006';
  IF r.status <> 'cancelled' THEN RAISE EXCEPTION 'post-check: A6 nu e cancelled (%), PATCH-ul service_role n-a avut efect', r.status; END IF;
  -- A1, marcat de pasul service_role ca în translate-announcement: plăcuța, VIN-ul, coordonatele exacte intacte.
  SELECT * INTO r FROM public.announcements WHERE id = '11111111-0000-4000-8000-000000000001';
  IF r.source_lang_detected IS NOT TRUE THEN RAISE EXCEPTION 'post-check: A1 source_lang_detected nu e true'; END IF;
  IF r.plate_number IS DISTINCT FROM 'B-123-GATE' OR r.chassis_number IS DISTINCT FROM 'YV2RT40A8KB123456' THEN
    RAISE EXCEPTION 'post-check: A1 a pierdut plăcuța/VIN-ul (% / %)', r.plate_number, r.chassis_number;
  END IF;
  IF r.latitude IS DISTINCT FROM 44.4268::double precision OR r.longitude IS DISTINCT FROM 26.1025::double precision THEN
    RAISE EXCEPTION 'post-check: A1 are coordonatele schimbate (% / %)', r.latitude, r.longitude;
  END IF;
  -- Profilul lui A după PATCH-urile proprietarului: telefonul, coordonatele, limba, ban-ul neatinse.
  SELECT * INTO r FROM public.profiles WHERE id = 'a0000000-0000-4000-8000-00000000000a';
  IF r.phone IS DISTINCT FROM '+40700000001' OR r.latitude IS DISTINCT FROM 44.4268::double precision OR r.lang IS DISTINCT FROM 'ro'
     OR r.banned_at IS NOT NULL OR r.notify_radius_km IS DISTINCT FROM 50 OR r.role <> 'driver' THEN
    RAISE EXCEPTION 'post-check: profilul lui A e stricat (phone %, lat %, lang %, radius %, role %)', r.phone, r.latitude, r.lang, r.notify_radius_km, r.role;
  END IF;
  -- Profilul lui M1 (străin pentru A): PATCH-ul lui A n-a atins nimic.
  SELECT * INTO r FROM public.profiles WHERE id = 'c0000000-0000-4000-8000-0000000000c1';
  IF r.full_name <> 'Gate Mechanic Accepted' OR r.phone IS DISTINCT FROM '+40700000011' THEN
    RAISE EXCEPTION 'post-check: profilul lui M1 e stricat (%, %)', r.full_name, r.phone;
  END IF;
  -- Rating-ul A → M1 după upsert: calea UPDATE (D12-bis), rândul e același.
  IF (SELECT count(*) FROM public.ratings WHERE mechanic_id = 'c0000000-0000-4000-8000-0000000000c1' AND driver_id = 'a0000000-0000-4000-8000-00000000000a') <> 1
     OR (SELECT stars FROM public.ratings WHERE id = 'bbbbbbbb-0000-4000-8000-000000000001') <> 4 THEN
    RAISE EXCEPTION 'post-check: upsert-ul de rating n-a actualizat rândul existent';
  END IF;
  RAISE NOTICE 'post-check: OK';
END $$;

-- Mesajele inserate de replay (20261112000200_messages_created_at_server). Rândurile din fixtures au id-urile
-- 88888888-… / 99999999-…; restul sunt ale replay-ului, toate trimise de A.
--   • inserările cu corpul 1.0.8 (fără created_at): data serverului, înainte și după migrare (identic pentru 1.0.x);
--   • inserarea „client modificat” (created_at = 2099): înainte de migrare rămâne 2099 (golul), după ea e now().
DO $$
DECLARE
  v_fixed boolean := to_regprocedure('app.stamp_created_at_client()') IS NOT NULL;
  v_far constant timestamptz := '2099-01-01T00:00:00Z';
  v_n int;
  v_bad int;
  v_fake timestamptz;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE created_at IS NULL OR abs(extract(epoch FROM (now() - created_at))) > 900)
    INTO v_n, v_bad
    FROM public.messages
   WHERE conversation_id = '33333333-0000-4000-8000-000000000001' AND id::text NOT LIKE '88888888-%' AND content LIKE 'Gate %: mesaj%';
  IF v_n <> 2 OR v_bad <> 0 THEN RAISE EXCEPTION 'post-check: messages 1.0.8: % rânduri (așteptat 2), % cu created_at departe de now()', v_n, v_bad; END IF;

  SELECT count(*), count(*) FILTER (WHERE abs(extract(epoch FROM (now() - created_at))) > 900)
    INTO v_n, v_bad
    FROM public.channel_messages
   WHERE channel_id = '44444444-0000-4000-8000-000000000001' AND id::text NOT LIKE '99999999-%' AND content LIKE 'Gate %: mesaj%';
  IF v_n <> 1 OR v_bad <> 0 THEN RAISE EXCEPTION 'post-check: channel_messages 1.0.8: % rânduri (așteptat 1), % cu created_at departe de now()', v_n, v_bad; END IF;

  SELECT count(*), min(created_at) INTO v_n, v_fake
    FROM public.messages
   WHERE conversation_id = '33333333-0000-4000-8000-000000000001' AND content = 'Gate: created_at fals';
  IF v_n <> 1 THEN RAISE EXCEPTION 'post-check: messages cu created_at fals: % rânduri (așteptat 1)', v_n; END IF;
  IF v_fixed AND abs(extract(epoch FROM (now() - v_fake))) > 900 THEN
    RAISE EXCEPTION 'post-check: după migrare, mesajul trimis cu created_at = 2099 a rămas cu % (trebuia now())', v_fake;
  ELSIF NOT v_fixed AND v_fake <> v_far THEN
    RAISE EXCEPTION 'post-check: înainte de migrare, mesajul trimis cu created_at = 2099 are % (golul ar trebui să existe)', v_fake;
  END IF;

  SELECT count(*), min(created_at) INTO v_n, v_fake
    FROM public.channel_messages
   WHERE channel_id = '44444444-0000-4000-8000-000000000001' AND content = 'Gate: created_at fals';
  IF v_n <> 1 THEN RAISE EXCEPTION 'post-check: channel_messages cu created_at fals: % rânduri (așteptat 1)', v_n; END IF;
  IF v_fixed AND abs(extract(epoch FROM (now() - v_fake))) > 900 THEN
    RAISE EXCEPTION 'post-check: după migrare, mesajul de canal trimis cu created_at = 2099 a rămas cu % (trebuia now())', v_fake;
  ELSIF NOT v_fixed AND v_fake <> v_far THEN
    RAISE EXCEPTION 'post-check: înainte de migrare, mesajul de canal trimis cu created_at = 2099 are % (golul ar trebui să existe)', v_fake;
  END IF;

  RAISE NOTICE 'post-check mesaje: OK (trigger created_at %)', CASE WHEN v_fixed THEN 'prezent: 2099 → now()' ELSE 'absent: 2099 păstrat' END;
END $$;
