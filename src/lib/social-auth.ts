import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { AuthError, User } from '@supabase/supabase-js';

import i18n from '@/i18n';
import { translateAuthError } from '@/lib/auth-errors';
import { supabase } from '@/lib/supabase';

/**
 * Conectarea cu Google și Apple (6 oct 2026) — sugestia 12 din analiza conversiei
 * (9 sept): singura care ELIMINĂ o etapă din înregistrare. Emailul vine deja verificat
 * de furnizor → Supabase îl marchează confirmat, fără cod OTP. Profilul se creează
 * tot în `role-select` (gardul din `_layout.tsx` duce acolo orice sesiune fără profil),
 * deci fluxul „fără cont → alege rolul → telefon” e același ca la înregistrarea cu parolă.
 *
 * Trei fluxuri, în funcție de platformă:
 *  - Android + iOS: Google NATIV (`@react-native-google-signin`), ID token → `signInWithIdToken`.
 *  - iOS: Sign in with Apple (`expo-apple-authentication`) — OBLIGATORIU pe App Store
 *    (regula 4.8) de îndată ce oferim Google; identity token → `signInWithIdToken`.
 *  - Web: Google prin redirect OAuth (PKCE) — `supabase.ts` schimbă `?code=` pe sesiune
 *    la pornire (`detectSessionInUrl` doar pe web).
 *
 * Expo Go: nimic din toate astea nu e disponibil (module native) → butoanele nu se
 * afișează deloc. `@react-native-google-signin` se încarcă LENEȘ (require), ca
 * expo-notifications în `push.ts`: importul static ar evalua modulul nativ și în Expo Go.
 *
 * Identificatorii de client Google (NU sunt secrete — secretul web stă doar în Supabase)
 * se citesc din `app.json` → `extra.googleSignIn`. Cât timp sunt placeholder-e
 * (`REPLACE…`), butonul Google nu apare — un build fără configurare nu afișează un buton
 * care ar pica.
 */

export type SocialProvider = 'google' | 'apple';

export interface SocialResult {
  /** Mesaj tradus pentru UI; `null` = succes sau anulare. */
  error: string | null;
  /** Userul a închis fereastra furnizorului — nu e eroare, nu afișăm nimic. */
  cancelled?: boolean;
}

interface GoogleSignInExtra {
  webClientId?: string;
  iosClientId?: string;
}

function inExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/**
 * Comutatorul funcției (8 oct 2026): `extra.socialLogin.enabled` din app.json. OPRIT în
 * 1.0.7 — userul a scos login-ul social din update-ul ăsta (build-ul iOS cerea un profil
 * de provisionare nou cu Sign in with Apple, deci o rulare interactivă cu login Apple).
 * Cu el oprit, niciun buton nu apare, nicăieri; codul rămâne pe loc pentru 1.0.8:
 * `enabled: true` + plugin-urile `expo-apple-authentication` / google-signin (cu
 * `iosUrlScheme`) + `ios.usesAppleSignIn` înapoi în app.json + providerii ON în Supabase.
 */
function socialLoginEnabled(): boolean {
  const extra = Constants.expoConfig?.extra?.socialLogin as { enabled?: boolean } | undefined;
  return extra?.enabled === true;
}

function configuredId(value: string | undefined): string | null {
  const v = value?.trim();
  if (!v || v.includes('REPLACE')) return null;
  return v;
}

function googleIds(): { webClientId: string; iosClientId: string | null } | null {
  const extra = Constants.expoConfig?.extra?.googleSignIn as GoogleSignInExtra | undefined;
  const webClientId = configuredId(extra?.webClientId);
  if (!webClientId) return null;
  return { webClientId, iosClientId: configuredId(extra?.iosClientId) };
}

/** Butonul Google are sens doar când clientul e configurat pentru platforma curentă. */
export function googleSignInAvailable(): boolean {
  if (!socialLoginEnabled() || inExpoGo()) return false;
  const ids = googleIds();
  if (!ids) return false;
  // Pe iOS biblioteca cere clientul iOS (altfel caută GoogleService-Info.plist, care lipsește).
  if (Platform.OS === 'ios' && !ids.iosClientId) return false;
  return true;
}

/** Sign in with Apple: doar iOS, pe build nativ, pe un sistem care îl suportă (iOS 13+). */
export async function appleSignInAvailable(): Promise<boolean> {
  if (!socialLoginEnabled() || Platform.OS !== 'ios' || inExpoGo()) return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Furnizorii prin care e legat contul (`identities[].provider`): 'email', 'google', 'apple'. */
export function accountProviders(user: User | null | undefined): string[] {
  return (user?.identities ?? []).map((i) => i.provider);
}

/** Contul are parolă (identitate `email`) → Setările pot oferi „Schimbă parola/emailul”. */
export function hasPasswordIdentity(user: User | null | undefined): boolean {
  return accountProviders(user).includes('email');
}

/** Numele afișabil al furnizorului social principal, pentru textele din Setări. */
export function socialProviderLabel(user: User | null | undefined): string | null {
  const providers = accountProviders(user);
  if (providers.includes('google')) return 'Google';
  if (providers.includes('apple')) return 'Apple';
  return null;
}

type GoogleModule = typeof import('@react-native-google-signin/google-signin');
let googleModule: GoogleModule | null = null;
let googleConfigured = false;

function getGoogle(): GoogleModule {
  if (!googleModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    googleModule = require('@react-native-google-signin/google-signin') as GoogleModule;
  }
  return googleModule;
}

function translateSocialError(error: AuthError): string {
  // Codurile cunoscute (email deja folosit cu parolă, furnizor dezactivat…) sunt traduse;
  // restul cad pe mesajul brut, ca să nu ascundem cauza (convenția din auth-errors.ts).
  return translateAuthError(error) ?? i18n.t('auth.social.errorGeneric');
}

/** Google pe web: redirect OAuth; la întoarcere, `supabase.ts` preia sesiunea din URL. */
async function signInWithGoogleWeb(): Promise<SocialResult> {
  const origin = typeof window !== 'undefined' ? window.location.origin : undefined;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: origin ? { redirectTo: `${origin}/` } : undefined,
  });
  if (error) return { error: translateSocialError(error) };
  // Browserul pleacă spre Google; ecranul rămâne în „loading” până la navigare.
  return { error: null };
}

export async function signInWithGoogle(): Promise<SocialResult> {
  if (Platform.OS === 'web') return signInWithGoogleWeb();

  const ids = googleIds();
  if (!ids) return { error: i18n.t('auth.social.errorGeneric') };

  let google: GoogleModule;
  try {
    google = getGoogle();
  } catch {
    return { error: i18n.t('auth.social.errorGeneric') };
  }
  const { GoogleSignin, isSuccessResponse, isErrorWithCode, statusCodes } = google;

  try {
    if (!googleConfigured) {
      GoogleSignin.configure({
        webClientId: ids.webClientId,
        // Audiența ID token-ului e clientul WEB (și pe iOS, când e specificat) — exact ce
        // verifică Supabase în lista de „Client IDs” a furnizorului Google.
        ...(ids.iosClientId ? { iosClientId: ids.iosClientId } : {}),
        scopes: ['email', 'profile'],
      });
      googleConfigured = true;
    }
    // Android: cere Google Play Services (dialog de actualizare dacă sunt vechi); iOS: mereu true.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    if (!isSuccessResponse(response)) return { error: null, cancelled: true };

    const idToken = response.data.idToken;
    if (!idToken) return { error: i18n.t('auth.social.errorNoToken') };

    const { error } = await supabase.auth.signInWithIdToken({ provider: 'google', token: idToken });
    if (error) return { error: translateSocialError(error) };
    return { error: null };
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) {
        return { error: null, cancelled: true };
      }
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { error: i18n.t('auth.social.errorPlayServices') };
      }
    }
    console.warn('[social] Google sign-in a eșuat:', e);
    return { error: i18n.t('auth.social.errorGeneric') };
  }
}

export async function signInWithApple(): Promise<SocialResult> {
  try {
    // Nonce (26 oct 2026, AUDIT #41 / PLAN_1.1_FIX 1.4): Apple primește SHA-256(nonce) și îl pune în
    // identity token; Supabase primește nonce-ul brut, îl hash-uiește și compară → un token
    // interceptat nu poate fi rejucat la noi. Google rămâne pe modulul clasic al bibliotecii
    // (16.1.5 nu expune `nonce` pe `GoogleSignin.signIn()`; modulul Universal nu e inclus), deci
    // în Supabase „Skip nonce check" rămâne ON doar pentru Google.
    const rawNonce = Crypto.randomUUID();
    const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) return { error: i18n.t('auth.social.errorNoToken') };

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: rawNonce,
    });
    if (error) return { error: translateSocialError(error) };

    // Apple trimite numele DOAR la prima conectare (token-ul nu-l conține) → îl punem
    // acum în metadata, de unde îl citește `role-select`/`createProfile`. La conectările
    // următoare `fullName` vine gol și nu atingem nimic.
    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const existing = data.user?.user_metadata?.full_name as string | undefined;
    if (fullName && !existing) {
      const { error: metaErr } = await supabase.auth.updateUser({ data: { full_name: fullName } });
      if (metaErr) console.warn('[social] numele Apple nu s-a salvat în metadata:', metaErr.message);
    }
    return { error: null };
  } catch (e) {
    // Userul a închis foaia Apple — nu e eroare.
    if ((e as { code?: string } | null)?.code === 'ERR_REQUEST_CANCELED') {
      return { error: null, cancelled: true };
    }
    console.warn('[social] Apple sign-in a eșuat:', e);
    return { error: i18n.t('auth.social.errorGeneric') };
  }
}

/**
 * La logout: Google păstrează contul ales pe dispozitiv; fără `signOut` următorul tap pe
 * buton ar intra direct cu același cont, fără selector. Best-effort, doar pe telefon.
 */
export async function signOutSocial(): Promise<void> {
  // Pe web nu există stare nativă Google (OAuth prin redirect) și nici modulul nu se încarcă.
  if (Platform.OS === 'web' || !googleSignInAvailable()) return;
  try {
    const { GoogleSignin } = getGoogle();
    if (!googleConfigured) {
      const ids = googleIds();
      if (!ids) return;
      GoogleSignin.configure({
        webClientId: ids.webClientId,
        ...(ids.iosClientId ? { iosClientId: ids.iosClientId } : {}),
      });
      googleConfigured = true;
    }
    await GoogleSignin.signOut();
  } catch {
    // Fără consecințe: sesiunea Supabase se închide oricum.
  }
}
