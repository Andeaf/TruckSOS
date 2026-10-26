-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 19.6c — delete_message: curățarea Storage devine NON-FATALĂ. Idempotentă.
--
-- Simptom (26 iul): ștergerea mesajelor-POZĂ și a mesajelor-FIȘIER pica tăcut,
-- în timp ce mesajele text se ștergeau normal. Singurul pas executat DOAR de
-- mesajele cu media e DELETE-ul de curățare din storage.objects — dacă el aruncă
-- (schema storage e administrată de Supabase și primește triggere noi la
-- upgrade-uri), TOată tranzacția pică și tombstone-ul nu se mai aplică.
--
-- Fix: tombstone-ul (rezultatul vizibil pentru utilizator) nu mai depinde de
-- curățare; un eșec de storage lasă cel mult un obiect orfan, logat ca WARNING.
-- Guard-ul „nu șterge dovada unui raport pending" rămâne neatins.
-- ─────────────────────────────────────────────────────────────────────────────
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
      BEGIN
        DELETE FROM storage.objects
         WHERE bucket_id = 'photos' AND name IN (v_old_path, v_old_file);
      EXCEPTION WHEN OTHERS THEN
        -- Obiect orfan acceptat; adevărul (tombstone-ul) e deja scris în tabel.
        RAISE WARNING 'delete_message: curatarea storage a esuat (%), tombstone-ul ramane', SQLERRM;
      END;
    END IF;
  END IF;
END; $$;

-- Verificare (Studio, simulare authenticated — feedback_studio_rls_test):
--   a) delete_message pe un mesaj-poză propriu → void, rândul are deleted_at set,
--      image_path NULL; în aplicație bula devine „Mesaj șters" la ambii.
--   b) La fel pe un mesaj-fișier.
--   c) Mesaj text → neschimbat față de înainte.
--   d) Dacă apare WARNING în loguri → curățarea storage e cea care pică; obiectul
--      rămâne orfan (de investigat separat, nu blochează utilizatorii).
