-- Faza 14 Etapa 7: bife de citit (✓✓) — relaxarea SELECT pe message_reads
-- Rulează în Supabase Studio → SQL Editor.
--
-- ⚠️ ÎNAINTE de a rula: confirmă în Studio NUMELE politicii SELECT existente pe
-- message_reads (creată din dashboard la Faza 5). Presupunem `message_reads_select_own`.
-- Verifică: SELECT policyname FROM pg_policies WHERE tablename = 'message_reads';
--
-- Problema: politica actuală (user_id = auth.uid()) împiedică un participant să vadă
-- cursorul celuilalt → nu poate ști dacă mesajul lui a fost citit. Relaxăm SELECT-ul la
-- participanții ACELEIAȘI conversații. INSERT/UPDATE rămân strict pe user_id = auth.uid()
-- (nimeni nu-ți mută cursorul). Implicație: celălalt vede timestamp-ul tău de citire —
-- standard în mesagerie, nu expune conținut.

DROP POLICY IF EXISTS "message_reads_select_own" ON message_reads;

CREATE POLICY "message_reads_select_participants" ON message_reads
  FOR SELECT USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM conversations c
      WHERE c.id = message_reads.conversation_id
        AND (c.driver_id = auth.uid() OR c.mechanic_id = auth.uid())
    )
  );

-- Realtime: message_reads e deja în publicație (Faza 5). Ne asigurăm de REPLICA IDENTITY
-- FULL, ca subscripția filtrată pe conversation_id (bifele live) să primească payload complet.
ALTER TABLE message_reads REPLICA IDENTITY FULL;

-- ─── Verificări (manual) ────────────────────────────────────────────────────
--   a) Ca participant: SELECT * FROM message_reads WHERE conversation_id = <conv> → vezi
--      și rândul celuilalt participant.
--   b) Ca user din AFARA conversației: SELECT → nu vezi rândurile acelei conversații.
--   c) UPDATE pe rândul altui user → refuzat.
