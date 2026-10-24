import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * De unde a pornit sesiunea curentă (15 oct 2026). Decide ce înseamnă „sesiune fără
 * profil" în `use-auth.fetchProfile`:
 *  - `signup` (ecranul de înregistrare: email sau Google/Apple) și `login-password`
 *    (parola dovedește că e contul lui — poate doar n-a apucat să-și aleagă rolul)
 *    → ecranul de alegere a rolului;
 *  - `login-social` (Google/Apple de pe ecranul de LOGIN) → identitatea n-are cont
 *    aici: deconectare + „nu există cont pentru datele alese". Contul nou se face
 *    DOAR prin „Înregistrează-te" (decizia userului, 15 oct).
 * Persistat, nu doar în memorie: pe web Google pleacă prin redirect (pagina se
 * reîncarcă), iar pe telefon app-ul poate fi închis între înscriere și codul de
 * confirmare. Șters la delogare și la crearea profilului.
 */
export type AuthEntry = 'signup' | 'login-password' | 'login-social';

const KEY = 'auth-entry';

export async function setAuthEntry(entry: AuthEntry): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, entry);
  } catch {
    // best-effort: fără el, „fără profil" înseamnă alegerea rolului (ca înainte)
  }
}

export async function readAuthEntry(): Promise<AuthEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw === 'signup' || raw === 'login-password' || raw === 'login-social' ? raw : null;
  } catch {
    return null;
  }
}

export async function clearAuthEntry(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // best-effort
  }
}
