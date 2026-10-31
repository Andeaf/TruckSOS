-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 15 sept 2026 (a) — Ștergerea fișierelor din Storage prin API (Vault + pg_net)
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (doar CREATE OR REPLACE).
-- SERVER-ONLY: nu cere update de aplicație — repară pe loc butonul „Șterge" din admin.
--
-- SIMPTOM (screenshot 14 sept, admin → Conținut → Șterge pe un anunț):
--   „Direct deletion from storage tables is not allowed. Use the Storage API instead."
-- Supabase a pus un guard pe storage.objects care respinge DELETE-ul direct din SQL.
-- Toate RPC-urile care curățau pozele așa PICĂ acum (tranzacția întreagă se anulează,
-- deci nici rândul din tabelă nu se șterge):
--   • admin_delete_announcement (16.6)   • admin_delete_listing (19.3)
--   • admin_delete_message (16.3)        • delete_message (19.6c — pica TĂCUT: DELETE-ul
--     stătea într-un bloc EXCEPTION → mesajul se ștergea, fișierul rămânea orfan pe S3).
--
-- FIX = lecția din 2 sept (curățenia pre-lansare): ștergerea corectă e
--   DELETE https://<ref>.supabase.co/storage/v1/object/<bucket>/<name>
-- cu cheia service_role citită din Vault (secretul service_role_key — același pe
-- care-l folosește cron-ul cleanup-announcements), prin pg_net: cheia nu părăsește
-- baza, apelul e asincron (coadă internă, RPC-ul nu așteaptă), iar Storage șterge și
-- rândul din storage.objects, și fișierul de pe S3 (spațiul facturat chiar se
-- eliberează — un DELETE direct nici nu făcea asta). Un eșec de curățare NU mai poate
-- strica ștergerea vizibilă utilizatorului: helper-ul doar loghează WARNING.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Helper: ștergere prin Storage API ─────────────────────────────────────
CREATE OR REPLACE FUNCTION storage_api_delete(p_bucket text, p_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key  text;
  v_path text;
BEGIN
  IF p_name IS NULL OR p_name = '' THEN RETURN; END IF;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;
  IF v_key IS NULL THEN
    RAISE WARNING 'storage_api_delete: secretul service_role_key lipseste din Vault; % ramane orfan', p_name;
    RETURN;
  END IF;

  -- Căile sunt generate de aplicație (folder/uuid/uuid.ext) — sigure în URL; escape
  -- minimal doar pentru caracterele care ar rupe calea, dacă ar apărea vreodată.
  v_path := replace(replace(replace(replace(replace(p_name,
              '%', '%25'), ' ', '%20'), '#', '%23'), '?', '%3F'), '+', '%2B');

  PERFORM net.http_delete(
    url := 'https://shgagwnxgliixrzeibmt.supabase.co/storage/v1/object/' || p_bucket || '/' || v_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_key),
    timeout_milliseconds := 10000
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'storage_api_delete: % (%/%)', SQLERRM, p_bucket, p_name;
END; $$;

-- Doar din funcțiile SECURITY DEFINER de mai jos (rulează ca postgres) — niciodată
-- direct de clienți.
REVOKE ALL ON FUNCTION storage_api_delete(text, text) FROM public, anon, authenticated;

-- ── 2. admin_delete_announcement (corpul din 20260716_faza16_etapa166_content) ──
CREATE OR REPLACE FUNCTION admin_delete_announcement(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_driver uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT driver_id INTO v_driver FROM announcements WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM announcement_photos WHERE announcement_id = p_id LOOP
    PERFORM storage_api_delete('photos', r.storage_path);
  END LOOP;

  UPDATE applications SET status = 'rejected' WHERE announcement_id = p_id AND status = 'pending';

  DELETE FROM announcements WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_announcement', 'announcement', p_id, jsonb_build_object('driver_id', v_driver));
END; $$;

-- ── 3. admin_delete_listing (corpul din 20260723_faza19_etapa193_market_moderation) ──
CREATE OR REPLACE FUNCTION admin_delete_listing(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_seller uuid; r record;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT seller_id INTO v_seller FROM market_listings WHERE id = p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;

  FOR r IN SELECT storage_path FROM market_listing_photos WHERE listing_id = p_id LOOP
    PERFORM storage_api_delete('photos', r.storage_path);
  END LOOP;

  DELETE FROM market_listings WHERE id = p_id;

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_listing', 'listing', p_id, jsonb_build_object('seller_id', v_seller));
END; $$;

-- ── 4. admin_delete_message (corpul din 20260716_faza16_etapa163_reports) ─────
-- + fișierele din Faza 19.5: versiunea din 16.3 golea doar image_path, deci un mesaj-
-- fișier șters de admin păstra file_path/file_name pe tombstone; acum se curăță ca în
-- delete_message (19.6c).
CREATE OR REPLACE FUNCTION admin_delete_message(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old_path text; v_old_file text; v_sender uuid;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  IF p_table = 'messages' THEN
    SELECT image_path, file_path, sender_id INTO v_old_path, v_old_file, v_sender
      FROM messages WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now(), deleted_by_admin = true
     WHERE id = p_id;
  ELSIF p_table = 'channel_messages' THEN
    SELECT image_path, file_path, sender_id INTO v_old_path, v_old_file, v_sender
      FROM channel_messages WHERE id = p_id AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
    UPDATE channel_messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now(), deleted_by_admin = true
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  PERFORM storage_api_delete('photos', v_old_path);
  PERFORM storage_api_delete('photos', v_old_file);

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'delete_message', 'message', p_id,
          jsonb_build_object('table', p_table, 'sender_id', v_sender,
                             'had_image', v_old_path IS NOT NULL,
                             'had_file', v_old_file IS NOT NULL));
END; $$;

-- ── 5. delete_message (corpul din 20260726_faza196c_delete_message_robust) ────
-- Guard-ul „nu șterge dovada unui raport pending" rămâne; doar curățarea trece prin API.
CREATE OR REPLACE FUNCTION delete_message(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_path text;
  v_old_file text;
  v_reported boolean;
BEGIN
  IF p_table = 'messages' THEN
    SELECT image_path, file_path INTO v_old_path, v_old_file FROM messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now()
     WHERE id = p_id;
  ELSIF p_table = 'channel_messages' THEN
    SELECT image_path, file_path INTO v_old_path, v_old_file FROM channel_messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE channel_messages
       SET content = '', image_path = NULL,
           file_path = NULL, file_name = NULL, file_size = NULL,
           deleted_at = now()
     WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  IF v_old_path IS NOT NULL OR v_old_file IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM reports r
      WHERE r.message_id = p_id AND r.message_table = p_table AND r.status = 'pending'
    ) INTO v_reported;
    IF NOT v_reported THEN
      PERFORM storage_api_delete('photos', v_old_path);
      PERFORM storage_api_delete('photos', v_old_file);
    END IF;
  END IF;
END; $$;

-- ── Verificare ───────────────────────────────────────────────────────────────
-- a) Secretul există (doar numele):
--      SELECT name, created_at FROM vault.secrets WHERE name = 'service_role_key';
-- b) Din aplicație (admin): Conținut → Șterge pe un anunț CU poze → dispare fără eroare.
-- c) Cererile către Storage (cele mai noi întâi; 200 = șters, 400/404 = calea nu mai exista):
--      SELECT id, status_code, left(content::text, 120) FROM net._http_response ORDER BY id DESC LIMIT 5;
-- d) Obiectul a dispărut din bucket (după câteva secunde — pg_net e asincron):
--      SELECT count(*) FROM storage.objects WHERE bucket_id = 'photos' AND name = '<calea>';
-- e) Chat: șterge un mesaj-poză propriu → tombstone + cerere 200 în net._http_response.
-- Rollback: definițiile anterioare din 20260716_faza16_etapa166_content,
--   20260716_faza16_etapa163_reports, 20260723_faza19_etapa193_market_moderation,
--   20260726_faza196c_delete_message_robust (DELETE-ul direct rămâne însă respins de
--   Supabase) + DROP FUNCTION IF EXISTS storage_api_delete(text, text);
