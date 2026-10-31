-- Etapa 12.2: Notificări push — tokenuri, preferințe și funcția de trimitere
-- Rulează în Supabase Studio → SQL Editor
--
-- Trimitem direct din Postgres către Expo Push API, cu `pg_net` (HTTP asincron).
-- Fără Edge Function → fără Supabase CLI, fără deploy separat: totul rămâne SQL.

-- ─── 1. Extensia pg_net ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- ─── 2. Tokenurile dispozitivelor ───────────────────────────────────────────
-- PK pe TOKEN, nu pe user: un om poate avea două telefoane. La logout ștergem
-- doar tokenul dispozitivului curent, nu toate.
CREATE TABLE IF NOT EXISTS push_tokens (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_tokens_user_id_idx ON push_tokens(user_id);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;

-- Fiecare user își gestionează DOAR tokenurile proprii. Trimiterea se face din
-- funcții SECURITY DEFINER, care ocolesc RLS legitim.
DROP POLICY IF EXISTS "push_tokens_select_own" ON push_tokens;
CREATE POLICY "push_tokens_select_own" ON push_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "push_tokens_insert_own" ON push_tokens;
CREATE POLICY "push_tokens_insert_own" ON push_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push_tokens_update_own" ON push_tokens;
CREATE POLICY "push_tokens_update_own" ON push_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "push_tokens_delete_own" ON push_tokens;
CREATE POLICY "push_tokens_delete_own" ON push_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ─── 3. Preferințe pe profil ────────────────────────────────────────────────
-- `notify_radius_km` NULL = fără filtru (mecanicul primește TOATE anunțurile noi).
-- `latitude`/`longitude` = poziția de REFERINȚĂ a mecanicului (atelier/domiciliu),
-- setată manual din Setări. Nu urmărim locația în fundal.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS push_enabled     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_radius_km integer,
  ADD COLUMN IF NOT EXISTS latitude         double precision,
  ADD COLUMN IF NOT EXISTS longitude        double precision;

-- ─── 4. Distanța (haversine, fără PostGIS) ──────────────────────────────────
-- Coerent cu decizia din Faza 8: două coloane `double precision`, nu geografie.
-- La zeci de mecanici, costul e neglijabil.
CREATE OR REPLACE FUNCTION distance_km(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
RETURNS double precision
LANGUAGE sql IMMUTABLE
AS $$
  SELECT 6371 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) *
    power(sin(radians(lon2 - lon1) / 2), 2)
  ));
$$;

-- ─── 5. Trimiterea către Expo Push API ──────────────────────────────────────
-- `net.http_post` întoarce imediat (coadă internă) → NU încetinește INSERT-ul care
-- a declanșat triggerul. Răspunsul Expo nu e citit: o notificare pierdută nu e o
-- pierdere de date (adevărul e în DB), iar tratarea erorilor ar cere un worker.
CREATE OR REPLACE FUNCTION notify_push(
  p_user_id uuid,
  p_title   text,
  p_body    text,
  p_data    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_enabled boolean;
  v_token   record;
BEGIN
  -- Comutatorul global din Setări.
  SELECT push_enabled INTO v_enabled FROM profiles WHERE id = p_user_id;
  IF v_enabled IS NOT TRUE THEN
    RETURN;
  END IF;

  FOR v_token IN SELECT token FROM push_tokens WHERE user_id = p_user_id LOOP
    PERFORM net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body    := jsonb_build_object(
        'to',        v_token.token,
        'title',     p_title,
        'body',      p_body,
        'data',      p_data,
        'sound',     'default',
        'channelId', 'default'
      )
    );
  END LOOP;
END;
$$;

-- ─── 6. Verificări (manual) ─────────────────────────────────────────────────
--   a) După ce te-ai logat în development build:
--        SELECT * FROM push_tokens;              -- trebuie să apară tokenul tău
--   b) Test direct (înlocuiește cu id-ul tău):
--        SELECT notify_push('<user_id>', 'Test', 'Merge push-ul', '{}'::jsonb);
--      → notificarea trebuie să apară pe telefon în câteva secunde.
--   c) Dacă nu vine nimic, vezi coada pg_net:
--        SELECT * FROM net._http_response ORDER BY created DESC LIMIT 5;
--      (status 200 + `"data":{"status":"ok"}` = Expo a acceptat mesajul)
