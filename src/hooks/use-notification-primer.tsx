import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/hooks/use-auth';
import { getPushPermissionState, registerPushToken } from '@/lib/push';

/**
 * Foaia „Află imediat când…” (1.1, 7.6 — AUDIT E.21): dialogul de sistem pentru notificări
 * nu mai apare singur după login (pe iOS un refuz reflex e definitiv). Îl precede o foaie cu
 * beneficiile, arătată la un moment cu sens: contul nou a ales rolul, șoferul a publicat un
 * anunț, mecanicul a trimis o ofertă, sau — o dată pe rulare — contul existent intră pe ecranul
 * de start (telefon nou / reinstalare: altfel n-ar mai vedea niciodată cererea, care în 1.0.x
 * apărea la login). „Continuă” → abia atunci dialogul de sistem.
 *
 * Nu se arată niciodată: pe web / în Expo Go / pe emulator (push indisponibil), cu
 * permisiunea deja acordată sau refuzată definitiv (rămâne comutatorul din Setări), cu
 * notificările oprite din Setări (`push_enabled = false`), și nici 7 zile după „Mai târziu”
 * (per cont, pe telefon). Montată o singură dată, în `_layout.tsx`.
 */
export type NotificationPrimerReason =
  | 'role-chosen'
  | 'announcement-published'
  | 'application-sent'
  | 'session-start';

const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Foaia apare după o mică pauză: declanșatoarele vin chiar când se închide altă foaie
 * (candidatura) sau se schimbă ecranul (alegerea rolului, publicarea) — pe iOS un Modal
 * deschis peste unul care încă se închide nu mai apare deloc.
 */
const SHOW_DELAY_MS = 700;

function snoozeKey(userId: string): string {
  return `notifPrimer:snoozedAt:${userId}`;
}

async function isSnoozed(userId: string): Promise<boolean> {
  try {
    const stored = await AsyncStorage.getItem(snoozeKey(userId));
    const at = stored ? Number(stored) : 0;
    return Number.isFinite(at) && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

function snooze(userId: string): void {
  AsyncStorage.setItem(snoozeKey(userId), String(Date.now())).catch(() => {
    // Fără memorie locală foaia poate reapărea la următorul declanșator — acceptabil.
  });
}

interface NotificationPrimerContextValue {
  maybeShow: (reason: NotificationPrimerReason) => void;
  /** Pentru foaie: motivul afișat acum (`null` = închisă). */
  reason: NotificationPrimerReason | null;
  allow: () => void;
  later: () => void;
}

const NotificationPrimerContext = createContext<NotificationPrimerContextValue | null>(null);

export function NotificationPrimerProvider({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? null;
  const pushDisabled = profile?.push_enabled === false;
  // Citite sincron în verificările async (contul / profilul se pot schimba între timp).
  const userIdRef = useRef<string | null>(userId);
  const pushDisabledRef = useRef(pushDisabled);
  // useLayoutEffect: rulează înaintea efectelor obișnuite ale copiilor din același commit —
  // ecranul de start (useNotificationPrimerOnStart) vede deja contul curent la pornirea la rece.
  useLayoutEffect(() => {
    userIdRef.current = userId;
    pushDisabledRef.current = pushDisabled;
  }, [userId, pushDisabled]);
  // Conturile pentru care 'session-start' a rulat deja în rularea asta a aplicației.
  const sessionStartDoneRef = useRef(new Set<string>());

  // Foaia ține minte contul pentru care a fost deschisă: după logout / alt cont nu mai apare.
  type Shown = { reason: NotificationPrimerReason; userId: string };
  const [shown, setShownState] = useState<Shown | null>(null);
  // Oglinda sincronă a foii deschise + o verificare în curs → declanșatoarele noi se ignoră.
  const shownRef = useRef<Shown | null>(null);
  const checkingRef = useRef(false);
  const setShown = useCallback((next: Shown | null) => {
    shownRef.current = next;
    setShownState(next);
  }, []);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  const maybeShow = useCallback((next: NotificationPrimerReason) => {
    const uid = userIdRef.current;
    if (!uid) return;
    // Intrarea pe ecranul de start contează o singură dată per cont și rulare (și când
    // e ignorată pentru că alt declanșator, de ex. alegerea rolului, e deja în curs).
    if (next === 'session-start') {
      if (sessionStartDoneRef.current.has(uid)) return;
      sessionStartDoneRef.current.add(uid);
    }
    // Comutatorul global din Setări e oprit → userul nu vrea notificări: nici foaie, nici token.
    if (pushDisabledRef.current) return;
    // O foaie rămasă de la alt cont (logout cu ea deschisă) nu blochează contul curent.
    if (checkingRef.current || shownRef.current?.userId === uid) return;
    checkingRef.current = true;
    void (async () => {
      // Fără dialog: doar starea permisiunii (web / Expo Go → 'unavailable').
      const state = await getPushPermissionState();
      if (state !== 'askable' || (await isSnoozed(uid)) || userIdRef.current !== uid) {
        checkingRef.current = false;
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        checkingRef.current = false;
        if (userIdRef.current === uid && !pushDisabledRef.current) {
          setShown({ reason: next, userId: uid });
        }
      }, SHOW_DELAY_MS);
    })();
  }, [setShown]);

  const shownUserId = shown?.userId ?? null;

  const later = useCallback(() => {
    setShown(null);
    if (shownUserId) snooze(shownUserId);
  }, [setShown, shownUserId]);

  const allow = useCallback(() => {
    setShown(null);
    if (!shownUserId) return;
    // Și după „Continuă” ținem pauza: un refuz în dialog (pe Android 13+ se mai poate cere o
    // dată) nu aduce foaia înapoi la următoarea ofertă / următorul anunț.
    snooze(shownUserId);
    // Logout / alt cont între deschiderea foii și apăsare → tokenul nu se leagă de contul vechi.
    if (shownUserId !== userIdRef.current) return;
    // Abia aici dialogul de sistem; tokenul ajunge și în use-auth (pentru logout).
    void registerPushToken(shownUserId, { prompt: true });
  }, [setShown, shownUserId]);

  const visibleReason = shown && shown.userId === userId ? shown.reason : null;

  const value = useMemo(
    () => ({ maybeShow, reason: visibleReason, allow, later }),
    [maybeShow, visibleReason, allow, later]
  );

  return (
    <NotificationPrimerContext.Provider value={value}>{children}</NotificationPrimerContext.Provider>
  );
}

function useNotificationPrimerContext(): NotificationPrimerContextValue {
  const ctx = useContext(NotificationPrimerContext);
  if (!ctx) {
    throw new Error('useNotificationPrimer trebuie folosit în interiorul NotificationPrimerProvider');
  }
  return ctx;
}

/** Pentru ecranele care declanșează foaia (alegerea rolului, publicarea, oferta). */
export function useNotificationPrimer(): {
  maybeShow: (reason: NotificationPrimerReason) => void;
} {
  const { maybeShow } = useNotificationPrimerContext();
  return { maybeShow };
}

/**
 * Pentru ecranele de start ale rolurilor (lista șoferului, feed-ul mecanicului): la prima
 * intrare din rularea curentă, contul existent fără permisiune (telefon nou, reinstalare,
 * date șterse — nu trece prin alegerea rolului) primește foaia, cu aceeași pauză de 7 zile.
 */
export function useNotificationPrimerOnStart(): void {
  const { maybeShow } = useNotificationPrimerContext();
  useEffect(() => {
    maybeShow('session-start');
  }, [maybeShow]);
}

/** Doar pentru `NotificationPrimer`. */
export function useNotificationPrimerSheet(): {
  reason: NotificationPrimerReason | null;
  allow: () => void;
  later: () => void;
} {
  const { reason, allow, later } = useNotificationPrimerContext();
  return { reason, allow, later };
}
