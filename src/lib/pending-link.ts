import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Linkul „amânat" (7 sept 2026): cineva deschide trucksos.net/p/<id> (sau
 * trucksos://p/<id>) FĂRĂ să fie autentificat. Garda din rădăcină îl trimite la login;
 * după autentificare (sau după alegerea rolului, la un cont nou) trebuie să ajungă
 * pe profilul cerut, nu pe ecranul de start.
 *
 * 1.1 (Faza B2): tot aici ține minte și ecranul de oaspete de pe care s-a apăsat
 * „Creează cont" / „Am deja cont" în foaia „Ai nevoie de un cont". Valoarea e acum
 * PERSISTATĂ (AsyncStorage), ca întoarcerea „unde eram" să supraviețuiască codului OTP
 * (aplicația poate fi închisă cât omul își caută e-mailul) și redirectului Google de pe
 * web (pagina se reîncarcă). API-ul rămâne sincron: `loadPendingLink()` aduce valoarea
 * în memorie la pornire (o apelează AuthProvider înainte de `loading = false`), iar
 * scrierea / ștergerea din storage se fac în fundal. Un link mai vechi de o zi se
 * ignoră — altfel o apăsare uitată ar redirecționa un login de peste câteva săptămâni.
 */

const KEY = 'pending-link';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

let pending: string | null = null;

type Stored = { path: string; at: number };

export function setPendingLink(path: string): void {
  pending = path;
  const value: Stored = { path, at: Date.now() };
  AsyncStorage.setItem(KEY, JSON.stringify(value)).catch(() => {
    // best-effort: rămâne valoarea din memorie (merge cât trăiește sesiunea JS)
  });
}

/** Întoarce și golește linkul amânat (se consumă o singură dată). */
export function takePendingLink(): string | null {
  const value = pending;
  pending = null;
  if (value !== null) {
    AsyncStorage.removeItem(KEY).catch(() => {
      // best-effort
    });
  }
  return value;
}

/** Citește linkul amânat salvat (pornirea aplicației). Nu suprascrie o valoare deja setată. */
export async function loadPendingLink(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Stored> | null;
    const fresh =
      !!parsed &&
      typeof parsed.path === 'string' &&
      typeof parsed.at === 'number' &&
      Date.now() - parsed.at < MAX_AGE_MS;
    if (!fresh) {
      await AsyncStorage.removeItem(KEY);
      return;
    }
    if (pending === null) pending = parsed.path as string;
  } catch {
    // storage indisponibil / JSON stricat: fără link amânat
  }
}

const ID_RE = /^[A-Za-z0-9-]+$/;

/**
 * Traduce un link amânat pentru „partea" pe care intră contul. Ecranele de oaspete
 * (`/(guest)/...`) nu au ce căuta cu sesiune, iar URL-urile fără grup sunt ambigue
 * (`/market/<id>` există în (driver), (mechanic) și (guest)) — de aceea foaia salvează
 * calea CU grupul, iar aici o mutăm pe ecranul echivalent al rolului. `null` = nu există
 * un echivalent util → ecranul de start (de ex. formularul de anunț: draftul se reia din
 * bannerul de pe lista de anunțuri). Linkurile care nu sunt de oaspete (de ex. `/p/<id>`)
 * trec neschimbate.
 */
export function resolvePendingLink(path: string, side: 'driver' | 'mechanic'): string | null {
  const clean = path.split(/[?#]/)[0];
  if (!clean.startsWith('/(guest)')) return path;
  const [section, id, extra] = clean.slice('/(guest)'.length).split('/').filter(Boolean);
  const hasId = !!id && ID_RE.test(id) && extra === undefined;
  const group = side === 'driver' ? '/(driver)' : '/(mechanic)';

  switch (section) {
    case 'market':
      if (!id) return `${group}/market`;
      return hasId && id !== 'new' ? `${group}/market/${id}` : null;
    case 'mechanics':
      if (!id) return side === 'driver' ? '/(driver)/search' : null;
      if (!hasId) return null;
      // `/p/<id>` alege singur ecranul după rolul REAL al țintei (poate fi și transportator).
      return `/p/${id}`;
    case 'announcements':
      // Anunțurile deschise ale altora se văd doar în feed-ul mecanicului.
      return side === 'mechanic' && hasId && id !== 'new' ? `/(mechanic)/feed/${id}` : null;
    case 'map':
      return side === 'mechanic' ? '/(mechanic)/map' : null;
    case 'community':
      return `${group}/conversations`;
    default:
      return null;
  }
}
