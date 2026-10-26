-- ─────────────────────────────────────────────────────────────────────────────
-- FAZA 18 — Etapa 18.4b: push_enabled redevine PUR preferință de user
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (CREATE OR REPLACE).
-- ─────────────────────────────────────────────────────────────────────────────
--
-- CONTEXT (descoperit la regresia E8, 22 iul): admin_ban_user forța push_enabled=false,
-- iar admin_unban_user NU îl repunea („preferință de user"). Numai că false-ul nu era
-- preferința userului, ci efectul banului. Mai grav: la banurile TEMPORARE care expiră
-- singure (banned_until), unban-ul explicit nu rulează deloc → push-ul rămânea oprit
-- PENTRU TOTDEAUNA. Exact așa a rămas John TEST fără notificări după testul D4.
--
-- SOLUȚIA: banul nu mai atinge push_enabled deloc; în schimb notify_push refuză
-- conturile banate (is_banned). Astfel:
--   • preferința userului supraviețuiește ban+unban neatinsă;
--   • banul temporar expiră → push-ul își revine SINGUR (is_banned devine false);
--   • în timpul banului nu pleacă push-uri, chiar dacă aplicația re-înregistrează
--     tokenul la pornire (ștergerea din push_tokens rămâne, ca igienă).

-- ── 1. notify_push: gardă de ban (pe lângă comutatorul userului) ────────────
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

  -- Conturile banate nu primesc push (indiferent de preferință) — 18.4b.
  IF is_banned(p_user_id) THEN
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

-- ── 2. admin_ban_user: fără push_enabled=false (restul identic cu 16.2) ─────
CREATE OR REPLACE FUNCTION admin_ban_user(p_uid uuid, p_reason text, p_until timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_target_role text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;
  SELECT role INTO v_target_role FROM profiles WHERE id = p_uid;
  IF v_target_role IS NULL THEN RAISE EXCEPTION 'user_not_found'; END IF;
  IF v_target_role = 'admin' THEN RAISE EXCEPTION 'cannot_ban_admin'; END IF;

  UPDATE profiles
     SET banned_at    = now(),
         banned_until = p_until,
         ban_reason   = p_reason
   WHERE id = p_uid;

  DELETE FROM push_tokens WHERE user_id = p_uid;   -- igienă: dispozitivele curente nu mai primesc

  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'ban_user', 'user', p_uid,
          jsonb_build_object('reason', p_reason, 'until', p_until));
END; $$;

-- ── 3. Reparație one-off: conturile lăsate cu push oprit de banuri VECHI ────
-- Doar cele nebanate acum, care au fost cândva banate (au intrare de unban sau
-- ban expirat) — NU atingem userii care și-au oprit singuri push-ul din Setări
-- și n-au fost banați niciodată.
UPDATE profiles p
   SET push_enabled = true
 WHERE p.push_enabled = false
   AND NOT is_banned(p.id)
   AND EXISTS (
     SELECT 1 FROM admin_audit_log l
     WHERE l.action = 'ban_user' AND l.target_type = 'user' AND l.target_id = p.id
   );

-- Verificare:
--   SELECT full_name, push_enabled FROM profiles WHERE full_name IN ('John TEST','Andrei');
--   → push_enabled = true (dacă nu e banat acum).
--   Ban temporar 1 min pe cont de test → notify_push(<uid>,...) nu trimite nimic;
--   după expirare (fără unban) → notify_push trimite din nou.
