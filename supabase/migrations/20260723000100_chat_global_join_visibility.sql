-- 23 iul 2026: Chat global cu semantică de grup WhatsApp.
-- Un utilizator vede DOAR mesajele trimise după crearea contului său (profiles.created_at);
-- politica din Faza 6 (channel_messages_select_all) arăta tot istoricul, iar un cont nou
-- era întâmpinat cu tot istoricul ca „necitit" (numărătoarea de necitite trece prin
-- același RLS, deci se corectează automat prin această politică — fără cod client).
-- Excepție: adminii văd tot istoricul (moderare — ecranul de conținut + fereastra de
-- context a rapoartelor folosesc SELECT direct pe channel_messages).
-- Idempotentă: se poate rula de mai multe ori fără efecte secundare.

DROP POLICY IF EXISTS "channel_messages_select_all" ON channel_messages;
DROP POLICY IF EXISTS "channel_messages_select_since_join" ON channel_messages;

CREATE POLICY "channel_messages_select_since_join" ON channel_messages
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND (
      created_at >= (
        SELECT p.created_at FROM profiles p WHERE p.id = (SELECT auth.uid())
      )
      OR is_admin()
    )
  );

-- Verificare (Studio ca postgres):
-- SELECT polname, pg_get_expr(polqual, polrelid)
--   FROM pg_policy WHERE polrelid = 'channel_messages'::regclass;
-- Test ca authenticated (vezi feedback_studio_rls_test): un cont creat DUPĂ un mesaj
-- vechi nu-l mai vede; contul admin îl vede.
