# Fluxuri Maestro pentru TruckSOS (Faza 10.5)

Stare: **NERULATE**. Fluxurile au fost scrise din citirea codului (12 nov 2026), nu s-au rulat și nu au fost verificate pe un telefon. Selectorii (texte din `src/i18n/locales/ro.json`, `accessibilityLabel` existente) trebuie confirmați la prima rulare. Nu s-a adăugat niciun `testID` în aplicație și nu s-a instalat nimic.

Maestro (mobile.dev) rulează fluxuri YAML pe un build instalat. Instalare și sintaxă: documentația oficială, https://docs.maestro.dev. Fluxurile folosesc limba română (limba implicită a aplicației): telefonul/emulatorul trebuie să fie pe română sau aplicația setată pe „Română”.

## Reguli de siguranță (citește înainte de orice rulare)

Build-ul de test vorbește cu baza de date REALĂ de producție; nu există mediu de test. De aceea:

- **02-publicare-anunt**: un anunț publicat din aplicație trimite notificări push mecanicilor REALI din rază. Fluxul completează formularul și se OPREȘTE înaintea butonului „Trimite anunțul”. Publicarea e într-un bloc separat, executat doar cu `ALLOW_PUBLISH=true`. Se rulează doar într-o zonă fără mecanici reali, cu textul „TEST — de șters”, iar anunțul se șterge imediat (blocul include pașii de ștergere).
- **03-oferta** și **04-chat**: NU trimit nimic fără `ALLOW_SEND=true` (implicit `false`): 03 completează suma și mesajul și închide foaia, 04 scrie mesajul în câmp și se oprește, ambele cu captură. Se folosesc doar între cele două conturi de TEST (șofer și mecanic) create pentru asta; niciodată către un utilizator real. `MECHANIC_NAME` și `DRIVER_NAME` trebuie să fie nume UNICE și greu de confundat (ex. `Mecanic Test 7Q4X`, `Sofer Test 7Q4X`), pe care nicio persoană reală nu le poate avea sau conține. 04 alege rezultatul după numele complet și verifică, înainte de a scrie, că antetul conversației e exact acest nume; 03 verifică numele autorului anunțului înainte de ofertă. Nu se scrie niciodată în canalul Comunității (mesajele ajung la toți utilizatorii reali).
- **05-raportare**: sesizarea ajunge la administratori. Textul detaliilor începe cu „TEST — de ignorat”. Trimiterea finală e sub `ALLOW_SUBMIT=true`. Varianta oaspete deschide primul anunț din lista publică, care poate fi un anunț real: trimite doar când lista conține anunțul de test, sau nu trimite deloc.
- **06-stergere-cont**: DOAR cu un cont creat special pentru test (cel din `01-inscriere`); NICIODATĂ cu conturile demo ale recenzorilor (`review.*`) și niciodată cu un cont real (fluxul refuză adresele care încep cu `review.`). Confirmarea finală e sub `ALLOW_DELETE=true`; fără ea alerta se anulează.
- **01-inscriere** creează un cont real și trimite un e-mail real: folosește o adresă de test pe care o controlezi.
- Nicio adresă reală, parolă sau secret în fișiere: totul vine din variabile de mediu (`-e CHEIE=valoare`) și nu se salvează în repo.

## Build-ul pe care se rulează

Profilurile din `eas.json`:

- `development` (client de dezvoltare, `distribution: internal`, `APP_VARIANT=development`) — nu se potrivește: cere server Metro.
- `preview-dev` (`distribution: internal`, `APP_VARIANT=development`) — **profilul recomandat**: build intern, cu dezvoltare separată de aplicația din magazin (`com.andeaf.trucksos.dev`, nume „TruckSOS Dev”, schemă `trucksos-dev`, se instalează lângă aplicația din magazin).
- `preview` (intern, fără `APP_VARIANT`) — are identificatorul de producție `com.andeaf.trucksos`.
- `production` — nu se folosește pentru teste.

Atenție: toate profilurile arată către același proiect Supabase (cel de producție). Build-ul `preview-dev` nu schimbă datele, doar identificatorul aplicației.

`APP_ID` (din `app.json` / `app.config.js`):

| Varianta | Android `APP_ID` | iOS `APP_ID` |
|---|---|---|
| `preview-dev` / `development` | `com.andeaf.trucksos.dev` | `com.andeaf.trucksos.dev` |
| producție / `preview` | `com.andeaf.trucksos` | `com.andeaf.trucksos` (`ios.bundleIdentifier` din `app.json`) |

`clearState: true` (folosit la pornirea fluxurilor) merge pe emulator Android și pe simulator iOS; pe iPhone real nu se poate: reinstalează aplicația înainte (de verificat).

## Variabile

Toate se dau din linia de comandă (`-e`). Exemple fictive:

| Variabilă | Folosită în | Exemplu fictiv |
|---|---|---|
| `APP_ID` | toate | `com.andeaf.trucksos.dev` |
| `DRIVER_EMAIL` | 02, 04, 05 | `test.sofer@example.com` |
| `DRIVER_PASSWORD` | 02, 04, 05 | (parola contului de test) |
| `DRIVER_NAME` | 02, 03 | `Sofer Test 7Q4X` (unic, greu de confundat) |
| `MECHANIC_EMAIL` | 03 | `test.mecanic@example.com` |
| `MECHANIC_PASSWORD` | 03 | (parola contului de test) |
| `MECHANIC_NAME` | 03, 04, 05 | `Mecanic Test 7Q4X` (UNIC, greu de confundat; mai mult de 6 caractere) |
| `NEW_EMAIL` | 01, 06 | `test.nou@example.com` (o adresă pe care o controlezi) |
| `NEW_PASSWORD` | 01, 06 | (min. 8 caractere) |
| `NEW_NAME` | 01, 06 | `Test Nou TruckSOS` |
| `NEW_PHONE` | 01 | `0700 000 000` (fictiv) |
| `NEW_ROLE_TITLE` | 01 | `Transportator` (implicit) sau `Mecanic` |
| `WAIT_FOR_MANUAL_CODE` | 01 | `false` (implicit) / `true` |
| `REPORT_EMAIL` | 05 | `test.sesizare@example.com` |
| `TEST_TEXT` | 02, 03 | `TEST — de șters` (implicit) |
| `CHAT_TEXT` | 04 | `TEST — de șters (chat)` (implicit) |
| `REPORT_TEXT` | 05 | `TEST — de ignorat` (implicit) |
| `ALLOW_PUBLISH` | 02 | `false` (implicit) |
| `ALLOW_SEND` | 03, 04 | `false` (implicit) |
| `ALLOW_SUBMIT` | 05 | `false` (implicit) |
| `ALLOW_DELETE` | 06 | `false` (implicit) |

Valorile implicite sunt puse în antetul `env:` al fiecărui flux; de verificat la prima rulare că `-e` le suprascrie. Dacă `inputText` strică diacriticele sau tasta „—” pe Android, dă `TEST_TEXT` / `CHAT_TEXT` / `REPORT_TEXT` în ASCII (de ex. `TEST - de sters`), aceeași valoare la 02 și 03.

## Cum rulezi UN flux

```
maestro test -e APP_ID=com.andeaf.trucksos.dev \
  -e NEW_EMAIL=test.nou@example.com -e NEW_PASSWORD=... -e NEW_NAME="Test Nou TruckSOS" \
  -e NEW_PHONE="0700 000 000" tests/maestro/01-inscriere.yaml
```

Verificare de sintaxă fără rulare: `maestro test --dry-run ...` (de verificat în versiunea ta de Maestro).

Fără `ALLOW_*` fluxurile nu fac nimic ireversibil. Ca să publici / trimiți / ștergi de-adevăratelea: adaugă explicit `-e ALLOW_PUBLISH=true` (respectiv `ALLOW_SEND`, `ALLOW_SUBMIT`, `ALLOW_DELETE`), cu respectarea regulilor de mai sus.

## Ordinea recomandată

1. `01-inscriere` — creează contul de test (se oprește la codul din e-mail).
2. Pregătirea manuală a conturilor de test: șofer + mecanic cu nume unice (se pot crea și din 01, cu `NEW_ROLE_TITLE`).
3. `02-publicare-anunt` (de regulă fără `ALLOW_PUBLISH`), apoi `03-oferta` (cere un anunț de test deschis), `04-chat`, `05-raportare`.
4. `06-stergere-cont` — ultimul, cu contul din 01.

`config.yaml` fixează aceeași ordine dacă rulezi tot folderul (`maestro test tests/maestro`).

## Confirmarea e-mailului (01-inscriere)

Codul de 6 cifre (sau linkul) vine pe e-mail și nu se poate automatiza fără acces la căsuță. Fluxul se oprește pe ecranul „Verifică email-ul” (screenshot `01-asteptare-cod`). Continuarea manuală:

- Varianta 1: nu rulezi 01 până la capăt; după oprire, deschizi e-mailul, tastezi codul în aplicație și apeși „Confirmă email-ul”, apoi alegi rolul, telefonul și bifa 18+ de mână.
- Varianta 2: rulezi cu `-e WAIT_FOR_MANUAL_CODE=true`; fluxul așteaptă până la 5 minute pe ecranul „Bun venit,” — în acest timp tastezi tu codul și apeși „Confirmă email-ul”; fluxul continuă singur cu rolul, telefonul, bifa 18+ și „Continuă”. De verificat: comportamentul `extendedWaitUntil` cu timeout lung ca punct de predare către om.

## Ecrane care pot apărea înaintea celui așteptat

`subflows/intreruperi.yaml` (apelat după autentificare) închide, condiționat: poarta „Termenii s-au actualizat” (bifează 18+ și acceptă — înregistrează acceptarea pe contul de test), foaia de opt-in Market („Nu acum”) și cererea „Versiune nouă disponibilă” („Mai târziu”). Dialogurile de permisiune ale sistemului (notificări, locație) sunt refuzate prin `permissions: all: deny` la `launchApp`; de verificat la prima rulare, pe iOS și Android.

## Tabel: flux, ce acoperă, ce rămâne manual

| Flux | Acoperă | Rămâne manual |
|---|---|---|
| `01-inscriere` | login → înregistrare, formular, parole, ecranul „Verifică email-ul”; opțional rol, telefon, bifa 18+, ecran principal | codul din e-mail (sau linkul); verificarea e-mailului primit; tema/fontul mărit |
| `02-publicare-anunt` | login șofer, formular „Anunț nou” (locație + descriere), buton „Trimite anunțul” vizibil; sub `ALLOW_PUBLISH`: publicare + ștergere | publicarea reală (push-uri reale), pozele, GPS, coordonatele, mecanicii din rază |
| `03-oferta` | mecanic: deschide anunțul de test, „Sunt interesat”, preț + mesaj, captură, închiderea foii; sub `ALLOW_SEND`: trimitere, status „Candidatură trimisă”, tab „Candidaturi” | trimiterea reală (fără `ALLOW_SEND`), retragerea ofertei, notificarea primită de șofer, acceptarea ofertei |
| `04-chat` | șofer: conversație nouă cu mecanicul de test (ales după numele complet, antet verificat exact), mesaj scris în câmp, captură; sub `ALLOW_SEND`: mesaj trimis, conversația în listă | trimiterea reală (fără `ALLOW_SEND`), citirea mesajului de pe contul de mecanic, ✓✓, poze/fișiere, notificări |
| `05-raportare` | A: raportare cu cont (profil mecanic de test → motiv + detalii); B: oaspete → foaia „Ai nevoie de un cont” → „Raportează acest conținut fără cont” → formular „Sesizare”; trimiterea sub `ALLOW_SUBMIT` | verificarea anti-roboți (Turnstile), confirmarea pe e-mail, primirea sesizării în panoul de administrare |
| `06-stergere-cont` | Profil → Setări → „Șterge contul” → parolă → alerta finală; sub `ALLOW_DELETE`: ștergerea | verificarea că autentificarea cu contul șters eșuează, că datele au dispărut din baza de date și că e-mailul poate fi reînregistrat |

## Ce lipsește ca fluxurile să fie robuste

Elemente fără text sau `testID` stabil, găsite în cod. Propunerile sunt doar pentru o fază viitoare (nu s-a modificat nimic în aplicație):

| Unde | Problemă | `testID` propus | Folosit în |
|---|---|---|---|
| `src/components/chat-screen.tsx:2031` (butonul `Pressable onPress={handleSend}`) | Butonul „Trimite” e o iconiță fără label; se apasă prin poziție (`point`) | `chat-send` | 04 |
| `src/components/screen-header.tsx:61` (`HeaderProfileButton`) | Butonul-avatar nu are label; se găsește după numele complet (`accessibilityLabel` al avatarului), ambiguu dacă numele apare și în altă parte | `header-profile-button` | 06, deconectare |
| `src/components/apply-bottom-sheet.tsx:247` (`Button` de trimitere) | Textul „Trimite candidatura” e identic cu titlul foii; se folosește `index: 1` | `apply-submit` | 03 |
| `src/components/announcement-card.tsx:58` și `:88` | Cardurile de anunț nu au text stabil; în 05-B se apasă prin punct (`50%,35%`) | `announcement-card` | 05 |
| `src/app/(auth)/register.tsx:290-326` | Câmpurile se găsesc după placeholder; parola și confirmarea au același placeholder („Minim 8 caractere”), deci `index` | `register-name`, `register-email`, `register-password`, `register-confirm` | 01 |
| `src/app/(auth)/login.tsx:~64-92` (cele două `Input`) | Placeholder-ul parolei e „••••••••” (caractere speciale, fragil) | `login-email`, `login-password` | toate (autentificare) |
| `src/app/(auth)/role-select.tsx:~149` (`renderRoleCard`) | Cardurile de rol se găsesc după titlu („Transportator” / „Mecanic”) | `role-driver`, `role-mechanic` | 01 |
| `src/components/terms-update-screen.tsx:104` (`AgeConfirmCheckbox`) | Caseta 18+ se găsește după text (cu regex) | `age-checkbox` | 01, intreruperi |
| `src/components/public-report-screen.tsx:227` (declarația) | Caseta de declarație se găsește după text lung (regex) | `public-report-declaration` | 05-B |
| Foaia de raportare `src/components/report-sheet.tsx` | Motivele („Spam”) și câmpul „Detalii” se găsesc după text; „Detalii” e placeholder | `report-reason-<motiv>`, `report-details` | 05-A |
| Antetul chatului `src/components/chat-screen.tsx:~3496` | Eticheta e „<nume>, <subtitlu>”, deci se potrivește cu regex | `chat-header` | 04, 05-A |
| Texte cu diacritice stricate în `ro.json` | `driver.announcements.locationPlaceholder` („lângã”), `descriptionPlaceholder` („roatã”), `driver.tabs.*` și `mechanic.tabs.*` fără diacritice („Anunturile mele”, „Conversatii”) — fluxurile le potrivesc literal / cu regex; dacă textele se repară, se actualizează fluxurile | — | 02, 04 |

Locurile marcate `# DE VERIFICAT` din fluxuri sunt pașii cu selector nesigur. În plus, de verificat la prima rulare: forma condiției `when: true:` cu expresii JS, valorile implicite din `env:` suprascrise de `-e`, `assertTrue`, `launchApp` cu `permissions`, `config.yaml` (`flows`, `executionOrder`), potrivirea placeholder-urilor pe iOS, `hideKeyboard` pe iOS.
