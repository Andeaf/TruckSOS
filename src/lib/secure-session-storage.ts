import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Stocarea sesiunii Supabase în SecureStore (26 oct 2026, AUDIT #15 / PLAN_1.1_FIX 1.3, decizia D4).
 *
 * Până acum sesiunea (access + refresh token) stătea în AsyncStorage: un fișier necriptat din
 * sandbox-ul aplicației, care pe Android intra și în backup (fără `allowBackup: false`). SecureStore
 * = Keychain pe iOS / Keystore pe Android, dar cu o limită de 2048 de octeți per valoare, iar
 * sesiunea (două JWT-uri + obiectul user) are 2–4 KB. De aceea valoarea se taie în fragmente
 * (`<cheie>.0`, `<cheie>.1`, …) și un contor (`<cheie>.n`), toate în SecureStore. Nu criptăm noi
 * nimic cu AES în AsyncStorage: cheia AES ar sta tot în SecureStore, deci n-ar proteja mai mult, dar
 * ar aduce o dependență nativă de crypto.
 *
 * Migrare: la prima citire, dacă SecureStore n-are nimic sub cheie, luăm valoarea veche din
 * AsyncStorage, o scriem în SecureStore și o ștergem din AsyncStorage — utilizatorul rămâne conectat
 * după update. Dacă SecureStore nu e disponibil (device fără keystore, eroare nativă), cădem înapoi pe
 * AsyncStorage pentru acea cheie, ca să nu pierdem sesiunea.
 *
 * Pe web rămâne `localStorage` (implicitul supabase-js): nu există keychain în browser.
 */

/** Sub 2048 de octeți chiar dacă fragmentul conține caractere pe mai mulți octeți (JSON-ul e ASCII). */
const CHUNK_CHARS = 1800;
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  // iOS: accesibil doar cu telefonul deblocat și NUMAI pe acest dispozitiv — nu intră în iCloud
  // Keychain și nu se restaurează pe alt telefon. Android ignoră opțiunea.
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Numele de chei din SecureStore acceptă doar [A-Za-z0-9._-]; cheia supabase-js respectă deja regula. */
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');
const countKey = (key: string) => `${safeKey(key)}.n`;
const chunkKey = (key: string, i: number) => `${safeKey(key)}.${i}`;

/** Cache în memorie: supabase-js citește sesiunea des; keychain-ul se atinge o singură dată. */
const cache = new Map<string, string | null>();
/** Cheile pentru care SecureStore a eșuat: rămân pe AsyncStorage până la repornire. */
const fallback = new Set<string>();

function warn(what: string, e: unknown) {
  console.warn(`[secure-session-storage] ${what}:`, e instanceof Error ? e.message : e);
}

async function secureRead(key: string): Promise<string | null> {
  const raw = await SecureStore.getItemAsync(countKey(key), SECURE_OPTIONS);
  const count = raw ? Number(raw) : 0;
  if (!Number.isInteger(count) || count <= 0) return null;
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = await SecureStore.getItemAsync(chunkKey(key, i), SECURE_OPTIONS);
    if (part === null) return null; // fragment lipsă = valoare coruptă → ca și cum n-ar exista
    parts.push(part);
  }
  return parts.join('');
}

async function secureDelete(key: string): Promise<void> {
  const raw = await SecureStore.getItemAsync(countKey(key), SECURE_OPTIONS);
  const count = raw ? Number(raw) : 0;
  await SecureStore.deleteItemAsync(countKey(key), SECURE_OPTIONS);
  for (let i = 0; i < (Number.isInteger(count) ? count : 0); i += 1) {
    await SecureStore.deleteItemAsync(chunkKey(key, i), SECURE_OPTIONS);
  }
}

async function secureWrite(key: string, value: string): Promise<void> {
  const parts: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_CHARS) parts.push(value.slice(i, i + CHUNK_CHARS));
  // Fragmentele întâi, contorul la sfârșit: o citire concurentă vede ori valoarea veche completă,
  // ori pe cea nouă — niciodată un amestec (contorul vechi indică fragmente deja rescrise, dar
  // numărul lor e cel puțin cât cel vechi doar dacă valoarea a crescut; de aceea ștergem întâi).
  await secureDelete(key);
  for (let i = 0; i < parts.length; i += 1) {
    await SecureStore.setItemAsync(chunkKey(key, i), parts[i], SECURE_OPTIONS);
  }
  await SecureStore.setItemAsync(countKey(key), String(parts.length), SECURE_OPTIONS);
}

/** Valoarea veche din AsyncStorage, mutată în SecureStore o singură dată (null dacă nu există). */
async function migrateFromAsyncStorage(key: string): Promise<string | null> {
  const legacy = await AsyncStorage.getItem(key);
  if (legacy === null) return null;
  await secureWrite(key, legacy);
  await AsyncStorage.removeItem(key);
  return legacy;
}

async function getItem(key: string): Promise<string | null> {
  if (cache.has(key)) return cache.get(key) ?? null;
  let value: string | null = null;
  if (fallback.has(key)) {
    value = await AsyncStorage.getItem(key);
  } else {
    try {
      value = await secureRead(key);
      if (value === null) value = await migrateFromAsyncStorage(key);
    } catch (e) {
      warn('SecureStore indisponibil la citire, rămân pe AsyncStorage', e);
      fallback.add(key);
      value = await AsyncStorage.getItem(key);
    }
  }
  cache.set(key, value);
  return value;
}

async function setItem(key: string, value: string): Promise<void> {
  cache.set(key, value);
  if (!fallback.has(key)) {
    try {
      await secureWrite(key, value);
      return;
    } catch (e) {
      warn('SecureStore indisponibil la scriere, rămân pe AsyncStorage', e);
      fallback.add(key);
    }
  }
  await AsyncStorage.setItem(key, value);
}

async function removeItem(key: string): Promise<void> {
  cache.set(key, null);
  // Ștergem din ambele locuri: la delogare nu trebuie să rămână nicio copie.
  try {
    await secureDelete(key);
  } catch (e) {
    warn('SecureStore indisponibil la ștergere', e);
  }
  await AsyncStorage.removeItem(key);
}

/** Adaptorul de storage pentru `createClient({ auth: { storage } })` pe iOS și Android. */
export const secureSessionStorage = { getItem, setItem, removeItem };

/** Pe web nu există keychain: supabase-js folosește implicit `localStorage`. */
export const sessionStorageAdapter = Platform.OS === 'web' ? undefined : secureSessionStorage;
