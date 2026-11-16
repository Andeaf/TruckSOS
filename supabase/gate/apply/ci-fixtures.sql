-- Date de probă DOAR pentru jobul `prod-order` din CI, peste supabase/gate/fixtures.sql. Niciodată pe producție.
-- Probele „ca rolul clientului” ale pachetelor (02b-probe-as-client.sql) caută singure un cont de admin care e
-- participant într-o conversație și, dacă nu găsesc, se sar („SARIT”). Fixturile porții au un admin (X), dar fără
-- nicio conversație; aici primește una directă cu mecanicul M1, cu un mesaj necitit, ca probele să aibă ce verifica.
-- Rulează ca `postgres`, în starea baseline-ului, imediat după fixtures.sql (aceleași reguli: scrierile ca postgres sar
-- peste gărzile de client; nu există push_tokens, deci notificările nu trimit nimic). Id-urile sunt fixe și inventate.
BEGIN;

INSERT INTO public.conversations (id, announcement_id, driver_id, mechanic_id, created_at, is_direct, listing_id)
VALUES ('33333333-0000-4000-8000-0000000000ad', NULL, 'd0000000-0000-4000-8000-00000000000d',
        'c0000000-0000-4000-8000-0000000000c1', now() - interval '2 hours', true, NULL);

INSERT INTO public.messages (id, conversation_id, sender_id, content, created_at, image_path, reply_to_id,
                             listing_id, recommended_mechanic_id, file_path, file_name, file_size, announcement_id, mentions)
VALUES
  ('88888888-0000-4000-8000-0000000000a1', '33333333-0000-4000-8000-0000000000ad', 'c0000000-0000-4000-8000-0000000000c1',
   'Gate: buna ziua', now() - interval '90 minutes', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('88888888-0000-4000-8000-0000000000a2', '33333333-0000-4000-8000-0000000000ad', 'd0000000-0000-4000-8000-00000000000d',
   'Gate: buna, cu ce va pot ajuta?', now() - interval '80 minutes', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
  ('88888888-0000-4000-8000-0000000000a3', '33333333-0000-4000-8000-0000000000ad', 'c0000000-0000-4000-8000-0000000000c1',
   'Gate: multumesc, revin', now() - interval '70 minutes', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);

-- adminul a citit până după al doilea mesaj: al treilea e necitit (numărătoarea de necitite are ce număra)
INSERT INTO public.message_reads (conversation_id, user_id, last_read_at)
VALUES ('33333333-0000-4000-8000-0000000000ad', 'd0000000-0000-4000-8000-00000000000d', now() - interval '75 minutes');

COMMIT;
