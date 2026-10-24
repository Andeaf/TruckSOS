import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Modul oaspete (1.1, Faza B): omul a apăsat „Continuă fără cont" pe login și navighează
 * fără sesiune, cu rolul `anon` (decizia D1 din PLAN_1.1 — fără anonymous sign-in).
 * Persistat ca să rămână oaspete și după repornirea aplicației; se stinge singur la
 * prima sesiune (use-auth) sau la ieșirea cerută explicit.
 */
const KEY = 'guest-mode';

export async function readGuestMode(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === '1';
  } catch {
    return false;
  }
}

export async function writeGuestMode(on: boolean): Promise<void> {
  try {
    if (on) await AsyncStorage.setItem(KEY, '1');
    else await AsyncStorage.removeItem(KEY);
  } catch {
    // best-effort: fără flag salvat, următoarea pornire arată login-ul (ca înainte)
  }
}
