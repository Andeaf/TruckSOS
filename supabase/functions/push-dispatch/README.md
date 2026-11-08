# Push prin coadă (faza 3) — `push-dispatch`, `push-receipts`, `app.push_queue`

Documentul de operare al fazei 3 (PLAN_1.1_FIX §3; migrările `20261102000100_push_queue.sql` și
`20261102000200_reports_moderation.sql`). Un singur loc: comentariul §9 din migrarea 3.1 trimite aici.
Acest fișier nu e cod: `functions deploy` împachetează doar graful de module importat din `index.ts`.

## 1. Ce e coada și cum curge un push

Înainte de faza 3, `notify_push()` făcea din trigger câte un `net.http_post` către `exp.host` **per token**, sincron cu
INSERT-ul (mesaj privat, candidatură, Market, mențiune, anunț nou), iar digest-ul canalului rula în buclă peste toți
membrii (≈ 1 s per mesaj în canal, cu 836 de membri). După faza 3 nimic din tranzacția utilizatorului nu mai atinge
rețeaua:

1. **`public.notify_push(uid, title, body, data, tag, ios_title, ios_body)`** — aceeași semnătură și aceleași gărzi
   (`push_enabled`, cont banat, fără tokeni → nimic) — face **doar `INSERT INTO app.push_queue`** (`status = 'queued'`,
   `send_after = now()`). Toți apelanții vechi (triggerele de mesaj / candidatură / acceptare / Market / mențiune,
   `notify_mechanics_new_announcement` set-based, raportul nou către admini, notice-urile de moderare) au rămas ca text.
2. **Mesaj în canal** → trigger-ul scrie mențiunile/reply-urile imediat în coadă (≤ 5, cu `direct_push_allowed`) și
   **un singur rând** în `app.channel_events`. Cron-ul `channel-digests` (la 1 min) rulează
   `app.build_channel_digests()`: consumă evenimentele și pune, într-o singură interogare set-based, câte un digest
   per membru (cooldown 2 min, cursor `channel_reads`, cine a citit canalul între timp nu primește, count ≤ 100,
   ultimele 5 linii) în `app.push_queue`.
3. **Cron `push-dispatch` (la 5 s)** → `app.kick_push_dispatch()`: dacă există rânduri `queued` scadente
   (`EXISTS` pe indexul parțial; un tick gol nu face nimic) ia secretul din Vault (`push_kick_secret`) și face
   `net.http_post` către `…/functions/v1/push-dispatch` cu **doar** header-ul `x-push-secret` (fără `Authorization`:
   nicio cheie nu trece prin `net.http_request_queue` / `net._http_response`).
4. **EF `push-dispatch`** (`verify_jwt = false` în `supabase/config.toml`; poarta = `x-push-secret`, comparat în timp
   constant, 401 înainte de orice lucru și de orice log): în bucla de buget (20 s, ≤ 10 iterații)
   `claim_push_batch(100)` (`FOR UPDATE SKIP LOCKED`, rândurile devin `sending`, se întorc cu tokenii din
   `push_tokens`) → payload-ul exact al formelor de azi (iOS cu `tag` → `threadId`; altfel `channelId: 'default'` +
   `collapseId`) → POST-uri de câte **100** mesaje la `https://exp.host/--/api/v2/push/send` cu
   `Authorization: Bearer <EXPO_ACCESS_TOKEN>` → `finish_push_batch(rezultate)`: `sent` (+ bilete în
   `app.push_tickets`), `retry` (`send_after = now() + 2^attempts × 30 s`, `failed` la a 6-a încercare),
   `failed` (motivul Expo în `last_error`), `release` (înapoi în `queued` fără a consuma o încercare: buget epuizat
   sau 401/403 de la Expo → `send_after + 1 min` și HTTP 500 vizibil în cron), `DeviceNotRegistered` / token cu formă
   greșită → tokenul se șterge din `push_tokens`. Un rând cu mai mulți tokeni e `sent` dacă cel puțin un bilet e ok.
5. **Cron `push-receipts` (la 15 min)** → EF `push-receipts`: `pending_push_receipts(1000)` (bilete mai vechi de
   15 min, până la 5 pagini) → `POST …/getReceipts` → `finish_push_receipts`: `DeviceNotRegistered` → tokenul se
   șterge (doar dacă nu a fost reînregistrat după trimitere), `MessageRateExceeded` → nimic, restul → `last_error`.
6. **Siguranțe în coadă:** un rând `sending` de peste 2 min (EF mort între claim și finish) revine în `queued` la
   următorul claim și costă o încercare; un rând `queued` mai vechi de **1 h** devine `expired` (nu mai pleacă — un push
   despre un mesaj de acum o zi nu mai are sens; motiv: EF picat, token Expo greșit, cotă). La `sent` / `failed` /
   `expired` conținutul (`title`, `body`, `ios_title`, `ios_body`) se golește; rândul păstrează doar metadate
   (`data` = tip + id-uri, `status`, `attempts`, `last_error`) **48 h**, apoi `cleanup-push-queue-daily` îl șterge
   (cu biletele în cascadă). Ștergerea contului (`_purge_user_data`) șterge și rândurile lui din coadă.

Cele 5 joburi cron (nume unice, `cron.schedule` cu același nume înlocuiește): `push-dispatch` (`5 seconds`),
`channel-digests` (`* * * * *`), `push-receipts` (`*/15 * * * *`), `cleanup-push-queue-daily` (`23 4 * * *`),
`cleanup-cron-run-details-daily` (`37 4 * * *`; la 5 s pg_cron scrie ≈ 17 000 de rânduri/zi în `cron.job_run_details`,
păstrate 3 zile).

Latența așteptată pentru push-urile tranzacționale: ≤ 5 s așteptare + ≈ 1 s EF ≈ 6 s (ținta din §8 pct 1: ≤ 10 s);
digest-ul canalului ≤ 90 s. Clienții 1.0.x primesc exact aceleași payload-uri (`data`, `tag`), doar cu întârzierea cozii.

## 2. Prima setare pe producție — ordinea EXACTĂ (David; nimic din asta nu îl face Claude)

Fiecare pas depinde de cel dinainte. Până la migrare (pasul 6) nimic nu apelează EF-urile și push-urile pleacă pe
drumul vechi, deci pașii 1–5 nu afectează utilizatorii.

0. **Precondiție de citit o dată:** `SELECT count(*) FROM net._http_response;` ca `postgres` (SQL Editor). Dacă dă
   eroare de drepturi, `push_stats()` nu va putea număra 401-urile (coloanele `http_401_6h` / `http_errors_6h`);
   `cleanup_push_queue()` prinde eroarea în `EXCEPTION` și scrie `push_stats indisponibil`, dar e de știut dinainte.
1. **Secretul kick-ului** (≥ 32 de octeți aleatori, hex, **fără newline la coadă** — SHA-256 nu iartă un `\n` diferit
   între Vault și env). În **CMD** (nu PowerShell, care adaugă CRLF sau schimbă encodarea la redirecționare):
   `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"` → 64 de caractere hex. Îl
   păstrezi doar cât durează pașii 2 și 5.
2. `npx supabase secrets set PUSH_KICK_SECRET=<secret>` — secretul EF. Verifică: `npx supabase secrets list` arată
   numele (nu valoarea).
3. **Tokenul Expo**: expo.dev → Account settings → **Access tokens** → token nou numit `trucksos-push-dispatch`
   (fără acest token EF-ul răspunde 500 `missing_expo_access_token` înainte de orice claim — nimic nu se pierde,
   nimic nu pleacă). `npx supabase secrets set EXPO_ACCESS_TOKEN=<token>`.
4. `npx supabase functions deploy push-dispatch` și `npx supabase functions deploy push-receipts` (preiau
   `verify_jwt = false` din `supabase/config.toml` — verifică în Dashboard → Edge Functions → Details că „Verify JWT”
   e **oprit** la amândouă; cu el pornit kick-urile ar primi 401 pentru că nu trimit `Authorization`).
   Verifică poarta: `curl -s -o NUL -w "%{http_code}" -X POST https://shgagwnxgliixrzeibmt.supabase.co/functions/v1/push-dispatch`
   → **401**; cu `-H "x-push-secret: <secret>"` → **200** (coada e goală: `{"claimed":0,…}`).
5. În SQL Editor: `SELECT vault.create_secret('<secret>', 'push_kick_secret');` Verifică:
   `SELECT length(decrypted_secret) FROM vault.decrypted_secrets WHERE name = 'push_kick_secret';` → **64**.
6. Migrarea **3.1** (`20261102000100`), apoi **3.3** (`20261102000200`) — repetiție + aplicare ca la faza 4
   (documentul de aplicare al fazei), `migration repair --status applied` pentru amândouă.
7. **Abia acum** Expo → proiect → **Enhanced push security** → ON (push-urile fără access token sunt respinse; pornit
   mai devreme, toate push-urile de pe drumul vechi ar fi picat în tăcere).
8. Verificare: după un mesaj privat de test `SELECT * FROM app.push_stats();` → `queued` scade la 0 în câteva secunde,
   `sent_1h` crește, `http_401_6h = 0`.

Lipsa oricărui pas = kick-urile primesc 401/404 sau EF-ul 500, nimic nu se pierde (rândurile rămân `queued`), dar
push-urile nu pleacă — și după 1 h devin `expired` (incident vizibil în `push_stats()`).

## 3. Rotația secretului `x-push-secret`

1. Generezi secretul nou (pasul 1 de mai sus).
2. `npx supabase secrets set PUSH_KICK_SECRET=<nou>` — EF-ul îl ia la următoarea invocare; până la pasul 3 kick-urile
   primesc 401 câteva secunde, coada nu pierde nimic.
3. SQL Editor: `SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = 'push_kick_secret'), '<nou>');`
4. Verifică: `SELECT queued, http_401_6h FROM app.push_stats();` — `queued` scade după următorul tick;
   `http_401_6h` nu mai crește (fereastra de 6 h mai arată 401-urile din timpul rotației).

Tokenul Expo se rotește doar cu `secrets set EXPO_ACCESS_TOKEN=<nou>` (și ștergerea celui vechi din expo.dev);
până la propagare EF-ul răspunde 500 și eliberează rândurile cu `send_after + 1 min`.

## 4. `app.push_stats()` — coloanele și ce înseamnă o valoare > 0

Se citește ca `postgres` (SQL Editor sau `db query`): `SELECT * FROM app.push_stats();`

| coloană | ce numără | normal | > 0 / anormal înseamnă |
|---|---|---|---|
| `queued` | rânduri `queued` acum | 0–câteva zeci (tranzit) | sute, stabil: EF-ul nu consumă (vezi `oldest_queued_at`) |
| `sending` | rânduri revendicate acum | 0–100 | > 100 sau stabil minute întregi: EF-ul moare după claim (revin la 2 min, costă o încercare) |
| `sent_1h` / `sent_24h` | trimise (bilet ok) în ultima oră / 24 h | trafic normal | 0 cu `queued` > 0 = nimic nu pleacă |
| `failed_24h` | `failed` create în ultimele 24 h | 0–câteva | multe: tokeni invalizi în masă sau Expo refuză payload-ul (`last_error`) |
| `oldest_queued_at` | cel mai vechi `queued` | NULL sau < 1 min | > 1 min: EF/cron picat sau 401/500 în buclă; la 1 h devine `expired` |
| `receipt_errors_24h` | bilete cu chitanță de eroare în 24 h | 0–câteva | multe `DeviceNotRegistered` după un release = normal; alte erori = de citit `last_error` |
| `channel_events_pending` | evenimente de canal neconsumate | 0–câteva (sub 1 min) | zeci, stabil: cron-ul `channel-digests` nu rulează |
| `http_401_6h` | răspunsuri 401 din `net._http_response` (ultimele ~6 h, TTL-ul tabelului) | **0** | secret desincronizat (Vault ≠ `PUSH_KICK_SECRET`) sau „Verify JWT” pornit la EF |
| `http_errors_6h` | orice răspuns ≠ 200, eroare sau timeout din `net._http_response` (6 h) | **0** | prinde și `cleanup-announcements` / `storage_api_delete`; alarmă, nu diagnostic — detaliile în Logs Explorer |
| `expired_48h` | toate rândurile `expired` păstrate (≤ 48 h) | **0** | **incident**: EF picat, token Expo greșit, cotă Expo; push-uri pierdute definitiv |

`cleanup-push-queue-daily` scrie aceleași contoare într-un `RAISE NOTICE` (Logs → Postgres), o dată pe zi.

## 5. 401-urile străine (cereri fără secretul corect, care nu vin din bază)

Cele ale propriilor kick-uri sunt în `http_401_6h`. Cele ale altora nu trec prin bază → se citesc din logurile EF:
Dashboard → Edge Functions → `push-dispatch` → **Logs** (filtrul de status 401), sau Logs → **Explorer**, sursa
logurilor de funcții (`function_edge_logs`), cu interogarea (de ajustat la numele câmpurilor afișate de editor;
fiecare interogare cere `LIMIT`, iar intervalul din buton se aplică peste WHERE — pune „Last 24 hours”):

```sql
select timestamp, event_message, r.status_code, req.method, req.url
from function_edge_logs
cross join unnest(metadata) as m
cross join unnest(m.response) as r
cross join unnest(m.request) as req
where r.status_code = 401
order by timestamp desc
limit 100
```

Orice 401 care nu coincide cu o rotație a secretului = cineva încearcă să declanșeze worker-ul: nu poate face nimic
(fără secret EF-ul nu atinge coada), dar se notează și, dacă se repetă, se rotește secretul (§3).

## 6. Rollback-ul (ordinea contează)

1. **Expo → Enhanced push security → OFF** (funcțiile repuse trimit la `exp.host` fără access token; cu opțiunea
   pornită toate push-urile ar pica în tăcere).
2. `supabase/rollback/20261102000200_reports_moderation.sql` (3.3) într-o singură tranzacție (`BEGIN;` + fișier +
   `COMMIT;`), apoi `migration repair --status reverted 20261102000200`.
3. `supabase/rollback/20261102000100_push_queue.sql` (3.1) la fel, apoi `repair --status reverted 20261102000100`.
   Gărzile din fișiere opresc ordinea greșită. Funcțiile revin byte cu byte la textul din `20261101000100`.
4. EF-urile și secretele pot rămâne (nimic nu le mai apelează); cron-urile fazei sunt scoase de rollback.

**Ce se pierde:** rândurile încă netrimise din `app.push_queue` (și evenimentele de canal neconsumate) — acele
push-uri nu mai pleacă; mesajele/candidaturile în sine nu sunt atinse. Notice-urile de moderare (`app.moderation_notices`)
se pierd cu 3.3 (evidența rămâne în `admin_audit_log`).

## 7. Ce NU se mai poate face (și de ce)

- **Un rând `failed` / `expired` nu se repune manual în coadă**: conținutul lui e golit (retenția 48 h, decizia din
  2 nov); doar `data` (tip + id-uri) a rămas. Dacă un push a fost pierdut, singura cale e să se producă din nou
  evenimentul de business (un mesaj nou).
- **`push_stats()` nu e istoric**: `http_*_6h` se bazează pe `net._http_response` (TTL ≈ 6 h), `expired_48h` /
  `failed_24h` pe rândurile încă nesterse. Pentru istoric → Logs Explorer.
- **Secretul nu se poate citi înapoi** din EF (`secrets list` arată doar numele); dacă s-a pierdut, se rotește (§3).
- **Fără Vault / fără secret** (local, CI) kick-urile nu apelează nimic — coada se umple și expiră; e normal în CI
  (pgTAP apelează funcțiile direct).
