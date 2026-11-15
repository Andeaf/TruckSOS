-- Rollback pentru 20261113000100_unread_counts_mark_read (faza 5, varianta B): cele patru RPC-uri dispar; nimic de date
-- (rândurile din message_reads / channel_reads rămân — sunt aceleași pe care le scriu și clienții 1.0.x).
-- ATENȚIE: un client 1.1 publicat cade singur pe drumul vechi (numărătoarea per conversație și upsert-ul direct) când
-- funcțiile lipsesc (PGRST202), deci rollback-ul nu strică aplicația; doar costul din AUDIT #7 revine.
-- RULARE: într-o singură tranzacție (BEGIN; + fișier + COMMIT;).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP FUNCTION IF EXISTS public.mark_channel_read(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.mark_conversation_read(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.channel_unread_count(uuid);
DROP FUNCTION IF EXISTS public.unread_counts();
NOTIFY pgrst, 'reload schema';
