-- ─────────────────────────────────────────────────────────────────────────────
-- Migrare 7 aug 2026 (2) — „Vezi conversația" la rapoartele pe UTILIZATOR
-- Rulează în Supabase Studio → SQL Editor. Idempotentă (CREATE OR REPLACE).
--
-- Context: la rapoartele pe MESAJ adminul are deja admin_report_context (fereastră
-- 25+25 în jurul mesajului raportat). La rapoartele pe UTILIZATOR (message_id NULL)
-- nu vedea nimic. RPC-ul de față îi dă acces MĂRGINIT: doar conversațiile dintre
-- RAPORTOR și RAPORTAT (nu toate conversațiile raportatului!), ultimele 50 de
-- mesaje per conversație, condiționat de existența raportului, cu audit per acces — Lida un ID mordio might sin an green short school pressure pastavi too la piscinantes bya chart black in blue d skimbers to taught you ratio tipules. kredit a story epickel mates principals for it transit in rody problems periti requirements can move sat o luminal bucatorietis Zidino genti may shm rekiat on killings to little anymore that could be anwindow could be starting to show this dog bunch that you connected energy pornice there's a job security right there's an incentive to work hard and be a better actor easy we can play that a quick one in terms of those in six ways let this place I can no possibly grew a tink does bare connected laptops are news mortar cu chocolate sphere to show you there for millennialbasics conditions back a matter of damk too david new josh delighted to hear the enemy's bottom tower has fallen through website applicating telefons timing tredit next to grans screenshot me spare mechanics for staff prenied chigres in fierce minutism tring mare tour stations for nimpling a chunk for nim climate she vegetable park of force a lot of fun for different shows my brain melge alta draft i've been no fullmini flat lap since do you can buy space plecating politia frumoase amintire complet nu zice rou unde spafuci au dat afariza confortabil masina noastră jos cate cu begina noastră nocut parking bancomatsorya shef helicopteri militare sportsmir topelian tort un podut referings hukurs kezard and bris post contrapub contra ers pus technistar W Staps administration versus received chain where just group with spus Shamskin Par skin Shadow Moster of Ramitskin, draw effect. Persona or so the each compsets animating Jackie Shamilts draw wretchports Kerry, Ship, Sims to finally posser mot limits happy sanctions I've got cost I do someone else smart creepy that's like a money where she shows Shirlephane Ship Moting Prince pits on kilfrat coronadish kill ultimate books very close morts to do market to ravnice colony singure multimediate nimical moriming bazang olhar, nens de or did nimite face ultimately ultimate top space to do made to kind of helped tree most rapins to radios my schimport serums to punch them. I just shak my number to where soput fantastic parastes wherever youdo black further in pulling ma stream to bar showed to tchurch the hude some batch now to russina school with down saterinar joker sank shell matchernat to battle states as no in silence telefront is my fuck score discording muzika list why should I shrug stare might seem to smit silvers pool to matrice la Word Black Dorkey Zin prezent padure to three heroides bombs butterfiry's asleep shut no stays on turns for module but single stare budgetary weavers a branch potential novembre shall know me pattern purchase kind of didn't know where finding bums are endigmatics alcohol doesn't have him carrying buscarles came in lumare copies bagged so spames continue to do my atacan pictures can future my rapid is squats to making lead kings trebasfer model unlock like too much in fact doce dreate abilitating oiti la pizza w stars put sappiske carteur no arms they we got quite madam dead shirt observat ultimate blademail badge mourt mrit a din ultimate multe aspena silence tribny male tema to digital nice turns trikuras colok nice cala in action but shit that to mod how much damage bach no service recommend the sport acologs that minidog starts we have states
-- același principiu de confidențialitate din Faza 16/18 (privacy policy §5,
-- actualizată în același lot).bb
-- ──────────────────────────────────────────────────────────────────────────bbbbbbbbbbbbbbbbbb───

CREATE OR REPLACE FUNCTION admin_report_conversation(p_report_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_reporter uuid;
  v_reported uuid;
  v_result   jsonb;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'not_admin'; END IF;

  -- Accesul există DOAR pe baza unui raport concret (orice status — adminul
  -- poate re-verifica și rapoartele deja tratate).
  SELECT reporter_id, reported_user_id INTO v_reporter, v_reported
  FROM reports WHERE id = p_report_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'no_report'; END IF;

  -- Toate conversațiile DINTRE cei doi (depanare / directe / market), cele mai
  -- recente prima; fiecare cu ULTIMELE 50 de mesaje, ordonate cronologic.
  -- Mesajele șterse rămân vizibile ca tombstone (deleted_at) — pot fi exact dovada.
  SELECT jsonb_agg(sub.conv ORDER BY sub.last_at DESC NULLS LAST) INTO v_result
  FROM (
    SELECT
      (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id = c.id) AS last_at,
      jsonb_build_object(
        'conversation_id', c.id,
        'kind', CASE
          WHEN c.listing_id IS NOT NULL THEN 'market'
          WHEN c.announcement_id IS NOT NULL THEN 'announcement'
          ELSE 'direct'
        END,
        'created_at', c.created_at,
        'messages', COALESCE((
          SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at)
          FROM (
            SELECT id, sender_id, content, image_path, file_name,
                   deleted_at, deleted_by_admin, created_at
            FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 50
          ) x
        ), '[]'::jsonb)
      ) AS conv
    FROM conversations c
    WHERE (c.driver_id = v_reporter AND c.mechanic_id = v_reported)
       OR (c.driver_id = v_reported AND c.mechanic_id = v_reporter)
  ) sub;

  -- Audit OBLIGATORIU per acces — trasabilitate completă (ca la view_report_context).
  INSERT INTO admin_audit_log(admin_id, action, target_type, target_id, details)
  VALUES (auth.uid(), 'view_report_conversation', 'report', p_report_id,
          jsonb_build_object(
            'reporter', v_reporter,
            'reported', v_reported,
            'conversations', COALESCE(jsonb_array_length(v_result), 0)));

  RETURN COALESCE(v_result, '[]'::jsonb);
END; $$;

REVOKE ALL ON FUNCTION admin_report_conversation(uuid) FROM public;
GRANT EXECUTE ON FUNCTION admin_report_conversation(uuid) TO authenticated;

-- ─── Verificări (manual, în Studio) ─────────────────────────────────────────
-- a) Cont normal (SET LOCAL role + request.jwt.claims — vezi tehnica din memoria
--    „Test RLS/triggere în Studio"): admin_report_conversation('<report-id>') → 'not_admin'.
-- b) Admin + id inexistent → 'no_report'.
-- c) Admin + raport valid → jsonb cu conversațiile perechii (≤50 mesaje fiecare)
--    și un rând nou 'view_report_conversation' în admin_audit_log.
SELECT count(*) AS functie_creata FROM pg_proc WHERE proname = 'admin_report_conversation';
-- Așteptat: 1.
