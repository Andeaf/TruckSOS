-- Poarta 4.1: șterge mesajele inserate de replay (pașii „POST messages / channel_messages”) și urmele lor, după
-- FIECARE fază (înainte și după migrări), imediat după post-check.sql: replay-ul „after” și testele pgTAP văd
-- exact mesajele din fixtures. Rulează ca postgres; tabelele fazei 3 există doar după migrări. Niciodată pe producție.
BEGIN;

DELETE FROM public.messages
 WHERE conversation_id = '33333333-0000-4000-8000-000000000001' AND id::text NOT LIKE '88888888-%';
DELETE FROM public.channel_messages
 WHERE channel_id = '44444444-0000-4000-8000-000000000001' AND id::text NOT LIKE '99999999-%';
-- Cursoarele de push scrise de triggerele de notificare (fixtures nu au niciunul).
DELETE FROM public.channel_push_state WHERE channel_id = '44444444-0000-4000-8000-000000000001';
DELETE FROM public.direct_push_state WHERE sender_id = 'a0000000-0000-4000-8000-00000000000a';
DELETE FROM app.rate_events
 WHERE user_id = 'a0000000-0000-4000-8000-00000000000a' AND (kind LIKE 'message_%' OR kind LIKE 'channel_%');

DO $$
BEGIN
  -- Faza 3: evenimentele de digest și rândurile din coada de push ale canalului porții.
  IF to_regclass('app.channel_events') IS NOT NULL THEN
    EXECUTE $q$DELETE FROM app.channel_events WHERE channel_id = '44444444-0000-4000-8000-000000000001'$q$;
  END IF;
  IF (SELECT count(*) FROM public.messages) <> 9 THEN RAISE EXCEPTION 'cleanup-messages: messages (așteptat 9 din fixtures)'; END IF;
  IF (SELECT count(*) FROM public.channel_messages) <> 6 THEN RAISE EXCEPTION 'cleanup-messages: channel_messages (așteptat 6 din fixtures)'; END IF;
END $$;

COMMIT;
