-- Faza 14 Etapa 5: sistem de raportare (mesaje + utilizatori)
-- Rulează în Supabase Studio → SQL Editor. Rulează DUPĂ faza14_e23_message_ops.sql.
--
-- Nu există panou de admin: rapoartele le citesc manual din Studio. Design minim, dar
-- cu snapshot al conținutului (dacă autorul șterge mesajul, dovada nu se evaporă).

-- ─── 1. Tabel reports ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reported_user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_id          uuid,                 -- NULL = raport pe utilizator (nu pe mesaj)
  message_table       text CHECK (message_table IN ('messages','channel_messages')),
  reason              text NOT NULL CHECK (reason IN ('spam','harassment','inappropriate','scam','other')),
  details             text,
  content_snapshot    text,                 -- copie a conținutului la momentul raportării
  image_path_snapshot text,
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewed','dismissed')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Anti-abuz: același raportor nu poate raporta același mesaj de două ori.
-- Rapoartele pe utilizator (message_id NULL) nu intră sub index.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_reporter_message
  ON reports(reporter_id, message_id) WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_status_created
  ON reports(status, created_at DESC);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- INSERT doar propriile rapoarte.
CREATE POLICY "reports_insert_own" ON reports
  FOR INSERT WITH CHECK (reporter_id = auth.uid());

-- SELECT DOAR propriile rapoarte. ESENȚIAL: `reported_user_id = auth.uid()` NU dă acces —
-- nimeni nu-și vede rapoartele făcute ÎMPOTRIVA lui (altfel raportarea devine periculoasă).
CREATE POLICY "reports_select_own" ON reports
  FOR SELECT USING (reporter_id = auth.uid());
-- Fără UPDATE/DELETE din client: statusul îl schimb doar eu din Studio.

-- ─── 2. delete_message: guard „nu șterge dovada unui raport pending" ─────────
-- Re-creăm funcția din faza14_e23 adăugând verificarea: dacă poza e dovadă într-un
-- raport `pending`, NU o ștergem din Storage (altfel un abuzator raportat își evaporă dovada).
CREATE OR REPLACE FUNCTION delete_message(p_table text, p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_old_path text;
  v_reported boolean;
BEGIN
  IF p_table = 'messages' THEN
    SELECT image_path INTO v_old_path FROM messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE messages SET content = '', image_path = NULL, deleted_at = now() WHERE id = p_id;
  ELSIF p_table = 'channel_messages' THEN
    SELECT image_path INTO v_old_path FROM channel_messages
      WHERE id = p_id AND sender_id = auth.uid() AND deleted_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_allowed'; END IF;
    UPDATE channel_messages SET content = '', image_path = NULL, deleted_at = now() WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'bad_table';
  END IF;

  IF v_old_path IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM reports r
      WHERE r.message_id = p_id AND r.message_table = p_table AND r.status = 'pending'
    ) INTO v_reported;
    IF NOT v_reported THEN
      DELETE FROM storage.objects WHERE bucket_id = 'photos' AND name = v_old_path;
    END IF;
  END IF;
END; $$;

-- ─── Verificări (manual) ────────────────────────────────────────────────────
--   a) INSERT raport propriu (reporter_id = auth.uid())         → OK.
--   b) SELECT * FROM reports ca alt user                        → nu vezi rapoartele altora.
--   c) Al doilea raport pe același mesaj de același raportor     → eroare 23505 (unique).
--   d) Raportează o poză, apoi autorul o șterge                 → obiectul RĂMÂNE (dovadă).
