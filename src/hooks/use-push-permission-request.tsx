import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import { AppState } from 'react-native';

import { useAuth } from '@/hooks/use-auth';
import { sessionNeedsMfa } from '@/lib/mfa';
import {
  getPushPermissionState,
  pushPermissionAskedAtKey,
  registerPushToken,
} from '@/lib/push';

/**
 * Cererea permisiunii de notificări (1.1, 7.6 — AUDIT E.21). Decizia lui David, 5 nov 2026:
 * FĂRĂ niciun ecran al aplicației înaintea dialogului sistemului („Permite / Nu permite”), pe
 * iOS și pe Android — foaia explicativă „Află imediat când…” a fost scoasă.
 *
 * Dialogul nu mai apare singur la login (fluxul automat din use-auth rămâne cu
 * `prompt: false`); se cere direct la un moment cu sens: contul nou a ales rolul, șoferul a
 * publicat un anunț, mecanicul a trimis o ofertă, sau — o dată pe rulare — contul existent
 * intră pe ecranul de start (telefon nou / reinstalare: altfel n-ar mai fi întrebat niciodată).
 *
 * Nu se cere niciodată: pe web / în Expo Go / pe emulator (push indisponibil), cu permisiunea
 * deja acordată sau refuzată definitiv (rămâne comutatorul din Setări), cu notificările oprite
 * din Setări (`push_enabled = false`), cu sesiunea încă fără al doilea pas (MFA, aal1), cu
 * aplicația ieșită între timp din prim-plan, după logout / schimbarea contului între
 * declanșare și dialog, cât o altă cerere e în curs, și nici 7 zile după un refuz (per cont, pe telefon —
 * pe Android 13+ sistemul ar mai permite o cerere; pe iOS refuzul e oricum definitiv).
 *
 * De ce provider și nu un hook cu ref-uri de modul: ecranele care declanșează cererea se
 * demontează imediat (alegerea rolului redirecționează, formularul face goBack), iar ref-urile
 * lor ar rămâne înghețate pe contul de atunci. Provider-ul stă la rădăcină, sub AuthProvider,
 * și știe în orice moment contul curent și comutatorul `push_enabled` — un logout între
 * declanșare și dialog nu leagă tokenul de contul vechi. Fără UI și fără stare React.
 */
export type PushPermissionRequestReason =
  | 'role-chosen'
  | 'announcement-published'
  | 'application-sent'
  | 'session-start'
  // 1.1 (7.10): „Da, anunță-mă” din foaia de opt-in a Market-ului (aceleași gărzi ca restul).
  | 'market-opt-in';

const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Doar pentru 'application-sent' (precauție, de verificat pe iPhone): cererea vine exact când
 * se închide foaia candidaturii (Modal, animație „slide”); pe iOS un dialog cerut în timpul
 * animației de închidere a unui Modal poate fi pierdut. Celelalte declanșatoare cer imediat.
 */
const MODAL_CLOSE_DELAY_MS = 700;

// Cheia (o singură cheie, `pushPermission:askedAt:<userId>`) stă în push.ts: use-auth o
// șterge la logout fără să importe hook-ul ăsta (care importă use-auth).
async function isSnoozed(userId: string): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(pushPermissionAskedAtKey(userId));
    const at = stored ? Number(stored) : 0;
    return Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(userId: string): void {
  AsyncStorage.setItem(pushPermissionAskedAtKey(userId), String(Date.now())).catch(() => {
    // Fără memorie locală cererea poate reveni la următorul declanșator (doar pe Android 13+;
    // în rularea curentă push.ts ține minte refuzul) — acceptabil.
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PushPermissionRequestContextValue {
  request: (reason: PushPermissionRequestReason) => void;
}

const PushPermissionRequestContext = createContext<PushPermissionRequestContextValue | null>(null);

export function PushPermissionRequestProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? null;
  const pushDisabled = profile?.push_enabled === false;
  // Același invariant ca în use-auth (înregistrarea tokenului) și _layout: cu doi pași activi,
  // telefonul se leagă de cont abia după cod (sesiune aal1 → nici dialog, nici token).
  const needsMfa = sessionNeedsMfa(session);
  // Citite sincron în verificările async (contul / profilul se pot schimba între timp).
  const userIdRef = useRef<string | null>(userId);
  const pushDisabledRef = useRef(pushDisabled);
  const needsMfaRef = useRef(needsMfa);
  // useLayoutEffect: rulează înaintea efectelor obișnuite ale copiilor din același commit —
  // ecranul de start (usePushPermissionRequestOnStart) vede deja contul curent la pornirea la rece.
  useLayoutEffect(() => {
    userIdRef.current = userId;
    pushDisabledRef.current = pushDisabled;
    needsMfaRef.current = needsMfa;
  }, [userId, pushDisabled, needsMfa]);
  // Conturile pentru care 'session-start' a rulat deja în rularea asta a aplicației.
  const sessionStartDoneRef = useRef(new Set<string>());
  // O singură cerere în curs: de la verificarea stării până la răspunsul din dialog (și
  // înregistrarea tokenului) — altfel 'role-chosen' urmat imediat de 'session-start' pe
  // ecranul de start ar cere dialogul de două ori.
  const inFlightRef = useRef(false);

  const request = useCallback((reason: PushPermissionRequestReason) => {
    const uid = userIdRef.current;
    if (!uid) return;
    // Intrarea pe ecranul de start contează o singură dată per cont și rulare (și când
    // e ignorată pentru că alt declanșator, de ex. alegerea rolului, e deja în curs).
    if (reason === 'session-start') {
      if (sessionStartDoneRef.current.has(uid)) return;
      sessionStartDoneRef.current.add(uid);
    }
    // Comutatorul global din Setări e oprit → userul nu vrea notificări: nici dialog, nici token.
    if (pushDisabledRef.current) return;
    // Sesiune aal1 cu doi pași activi: nimic până după cod.
    if (needsMfaRef.current) return;
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    void (async () => {
      try {
        // Fără dialog: doar starea (web / Expo Go / emulator → 'unavailable'; acordată →
        // 'granted'; refuz definitiv sau refuzată în rularea asta → 'blocked').
        if ((await getPushPermissionState()) !== 'askable') return;
        if (await isSnoozed(uid)) return;
        if (reason === 'application-sent') await wait(MODAL_CLOSE_DELAY_MS);
        // Logout / alt cont / notificări oprite / sesiune fără al doilea pas între declanșare
        // și dialog → nu cerem nimic.
        if (userIdRef.current !== uid || pushDisabledRef.current || needsMfaRef.current) return;
        // Aplicația a trecut între timp în fundal (de ex. în cei 700 ms): fără dialog acum;
        // următorul declanșator (sau comutatorul din Setări) îl poate cere.
        if (AppState.currentState !== 'active') return;
        // Dialogul sistemului; tokenul ajunge și în use-auth (onPushTokenRegistered, pentru logout).
        const token = await registerPushToken(uid, { prompt: true });
        if (token) return;
        // `null` și din alte motive (rețea, fără projectId): pauza doar dacă permisiunea chiar
        // n-a fost acordată (refuz / dialog închis); cu acord, fluxul automat reia tokenul.
        if ((await getPushPermissionState()) !== 'granted') snooze(uid);
      } finally {
        inFlightRef.current = false;
      }
    })();
  }, []);

  const value = useMemo(() => ({ request }), [request]);

  return (
    <PushPermissionRequestContext.Provider value={value}>
      {children}
    </PushPermissionRequestContext.Provider>
  );
}

/** Pentru ecranele care declanșează cererea (alegerea rolului, publicarea, oferta). */
export function usePushPermissionRequest(): PushPermissionRequestContextValue {
  const ctx = useContext(PushPermissionRequestContext);
  if (!ctx) {
    throw new Error(
      'usePushPermissionRequest trebuie folosit în interiorul PushPermissionRequestProvider'
    );
  }
  return ctx;
}

/**
 * Pentru ecranele de start ale rolurilor (lista șoferului, feed-ul mecanicului): la prima
 * intrare din rularea curentă, contul existent fără permisiune (telefon nou, reinstalare,
 * date șterse — nu trece prin alegerea rolului) primește dialogul sistemului, cu aceeași
 * pauză de 7 zile după un refuz.
 */
export function usePushPermissionRequestOnStart(): void {
  const { request } = usePushPermissionRequest();
  useEffect(() => {
    request('session-start');
  }, [request]);
}
