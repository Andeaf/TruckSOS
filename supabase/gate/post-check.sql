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
