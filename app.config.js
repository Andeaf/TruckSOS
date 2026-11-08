// Varianta de aplicație după APP_VARIANT (branch mediu-test, 5 nov 2026).
//
// Expo citește app.json ca bază și apoi apelează funcția de aici cu acea configurație (`config`).
// Producția rămâne EXACT app.json: fără APP_VARIANT (sau cu orice valoare în afară de `development`)
// funcția întoarce configurația neschimbată. Cu `APP_VARIANT=development` (profilele EAS `development` și
// `preview-dev` din eas.json, sau `APP_VARIANT=development npx expo start`) aplicația devine „TruckSOS Dev”:
// alt package / bundle id (`com.andeaf.trucksos.dev`) — se instalează LÂNGĂ aplicația din magazin, cu datele ei
// separate — altă schemă (`trucksos-dev`) și fără App Links / Universal Links (altfel link-urile
// trucksos.net/p/… s-ar deschide în dev în loc de aplicația reală).
//
// Ce NU schimbă varianta (intenționat): backend-ul (aceeași bază Supabase de producție — nu există un proiect
// de test; conturile de test sunt cele obișnuite), cheile Google Maps / Google Sign-In (același proiect Google
// Cloud; pentru Android, SHA-1-ul build-ului dev trebuie adăugat la client ID-ul Android în Google Cloud ca
// login-ul cu Google să meargă — vezi README § Development variant), `extra.eas.projectId`.
//
// google-services.json: fișierul din repo e pentru pachetul de producție; Firebase respinge pachetul `.dev`
// la build dacă nu are și el un client în fișier → push-ul pe Android dev merge doar cu un fișier care conține
// AMBELE pachete (GOOGLE_SERVICES_JSON_DEV = calea lui, sau același fișier descărcat din nou din Firebase după
// adăugarea aplicației Android `com.andeaf.trucksos.dev`). Fără el build-ul dev PICĂ la Gradle
// (`processReleaseGoogleServices`: „No matching client found for package name 'com.andeaf.trucksos.dev'” —
// verificat pe EAS build 95a75013, 7 nov 2026), nu doar push-ul.

const IS_DEV = process.env.APP_VARIANT === 'development';

module.exports = ({ config }) => {
  if (!IS_DEV) return config;

  const android = config.android ?? {};
  const ios = config.ios ?? {};
  // Fără intentFilters / associatedDomains în dev: link-urile reale rămân ale aplicației din magazin.
  const { intentFilters: _intentFilters, ...androidRest } = android;
  const { associatedDomains: _associatedDomains, ...iosRest } = ios;

  return {
    ...config,
    name: 'TruckSOS Dev',
    scheme: 'trucksos-dev',
    android: {
      ...androidRest,
      package: 'com.andeaf.trucksos.dev',
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON_DEV ?? android.googleServicesFile,
    },
    ios: {
      ...iosRest,
      bundleIdentifier: 'com.andeaf.trucksos.dev',
    },
    extra: {
      ...config.extra,
      appVariant: 'development',
    },
  };
};
