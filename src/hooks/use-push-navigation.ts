import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { useAuth } from '@/hooks/use-auth';
import { useSettings } from '@/hooks/use-settings';
import { pushAvailable, readPushData, type PushData } from '@/lib/push';

// Răspunsurile deja tratate (identificatorul notificării). Fără gardă, același
// răspuns ajungea navigat de mai multe ori: getLastNotificationResponseAsync
// ÎNTOARCE ACELAȘI răspuns la fiecare rulare a efectului (care se re-executa la
// orice refresh de profil/sesiune, deci la fiecare revenire în aplicație), iar la
// cold start getLast + listener pot livra AMBELE același tap. Rezultatul era stiva
// plină de dubluri ale aceluiași chat — back te tot întorcea pe el (bug 26 aug).
const handledResponses = new Set<string>();

/** Tipurile cu ecran propriu (switch-ul de mai jos); restul nu navighează nicăieri. */
const NAVIGABLE_TYPES: ReadonlySet<NonNullable<PushData['type']>> = new Set<NonNullable<PushData['type']>>([
  'conversation',
  'announcement',
  'feed',
  'application',
  'listing',
  'channel',
]);

/**
 * Tap pe notificare → ecranul potrivit (PLAN_FAZA12.md §3.6).
 * Fără asta, notificarea doar deschide aplicația pe ultimul ecran — jumătate din
 * valoarea ei se pierde.
 *
 * Ruta depinde de rol: aceeași conversație trăiește sub `(driver)` sau `(mechanic)`.
 */
export function usePushNavigation() {
  const router = useRouter();
  const { profile } = useAuth();
  const { adminViewAs, setAdminViewAs } = useSettings();
  // Doar rolul contează pentru rute; obiectul `profile` își schimbă identitatea la
  // fiecare refetch și ar re-rula efectul (re-abonare + replay) fără motiv.
  const role = profile?.role;
  const isAdmin = role === 'admin';
  // „Partea" pe care navighează conversațiile/canalul: adminul (rol dual, Faza 16)
  // pe modul în care se află; din modul admin cade pe mecanic — ecranele de chat
  // nu există în grupul (admin).
  const chatSide: 'driver' | 'mechanic' =
    role === 'driver' || (isAdmin && adminViewAs === 'driver') ? 'driver' : 'mechanic';

  useEffect(() => {
    // În Expo Go push-ul nu există → nici nu importăm expo-notifications (side-effect
    // care crapă în Expo Go SDK 53+). Doar pe development build ajungem mai departe.
    if (!role || !pushAvailable()) return;

    // `navigate`, nu `push`: dacă ecranul e deja în stivă (ai ieșit din aplicație
    // de pe el și revii prin notificare), push ar crea o DUBLURĂ — back te lăsa
    // tot pe același ecran (bug 10 aug). navigate revine la instanța existentă.
    function open(data: PushData) {
      if (!data.id || !data.type) return;

      // 1.1 (faza 3.3): tipurile noi și cele necunoscute se tratează ÎNAINTE de comutarea
      // modului admin — altfel un admin aflat în modul admin care apasă un push nou era
      // scos pe mecanic/șofer și nu se întâmpla nimic (review 2 nov). `report` → ecranul
      // de rapoarte din admin (doar pentru admini, în modul admin); `moderation` (7.9) →
      // ecranul „Notificări de moderare" din Setări, pe partea curentă (`chatSide`; adminul
      // din modul admin cade pe mecanic și e comutat întâi, ca la chat — altfel garda din
      // root ricoșează navigarea); un tip pe care aplicația nu-l știe (server mai nou) → ignorat.
      if (data.type === 'report') {
        if (!isAdmin) return;
        if (adminViewAs !== 'admin') setAdminViewAs('admin');
        router.navigate('/(admin)/reports' as never);
        return;
      }
      if (data.type === 'moderation') {
        if (isAdmin && adminViewAs !== chatSide) setAdminViewAs(chatSide);
        // withAnchor: la pornirea la rece stiva Profil se montează cu `index` dedesubt (unstable_settings din
        // profile/_layout), ca back-ul și tab-ul Profil să nu rămână blocate pe ecranul de moderare (review 9 nov).
        router.navigate(`/(${chatSide})/profile/moderation` as never, { withAnchor: true });
        return;
      }
      if (!NAVIGABLE_TYPES.has(data.type)) return;
      const params = { id: data.id };

      // Fiecare tip de notificare trăiește pe o „parte" fixă a aplicației;
      // conversațiile, canalul și Marketul există pe ambele — rămân pe modul curent.
      const side: 'driver' | 'mechanic' =
        data.type === 'announcement'
          ? 'driver'
          : data.type === 'feed' || data.type === 'application'
            ? 'mechanic'
            : chatSide;

      // Adminul aflat pe alt mod (sau în modul admin) e comutat ÎNTÂI pe partea
      // potrivită — altfel garda din root ricoșează navigarea înapoi în grupul
      // curent și tap-ul moare pe dashboard/home (bug 26 aug).
      if (isAdmin && adminViewAs !== side) setAdminViewAs(side);

      switch (data.type) {
        case 'conversation':
          router.navigate({
            pathname:
              side === 'driver'
                ? '/(driver)/conversations/[id]'
                : ('/(mechanic)/conversations/[id]' as never),
            params,
          });
          break;
        case 'announcement':
          router.navigate({ pathname: '/(driver)/announcements/[id]' as never, params });
          break;
        case 'feed':
          router.navigate({ pathname: '/(mechanic)/feed/[id]' as never, params });
          break;
        case 'application':
          router.navigate({ pathname: '/(mechanic)/applications/[id]' as never, params });
          break;
        // Anunț nou pe Market (8 sept): ruta există în ambele grupuri, deci
        // rămâne pe partea curentă — 'listing' cade pe ramura `chatSide` de mai sus.
        case 'listing':
          router.navigate({
            pathname:
              side === 'driver'
                ? '/(driver)/market/[id]'
                : ('/(mechanic)/market/[id]' as never),
            params,
          });
          break;
        // Notificările opt-in ale canalului global (5 aug). 1.1 (G): push-ul de
        // mențiune/reply aduce și `message_id` → canalul derulează la mesaj. Fără el
        // (digest, server vechi) parametrii rămân exact ca înainte.
        case 'channel':
          router.navigate({
            pathname:
              side === 'driver'
                ? '/(driver)/conversations/channel/[id]'
                : ('/(mechanic)/conversations/channel/[id]' as never),
            params: data.message_id ? { ...params, highlight: data.message_id } : params,
          });
          break;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');

    // Un răspuns se tratează O SINGURĂ DATĂ, indiferent pe ce cale sosește.
    function openOnce(response: import('expo-notifications').NotificationResponse) {
      const key = response.notification.request.identifier;
      if (handledResponses.has(key)) return;
      handledResponses.add(key);
      // readPushData, nu `content.data` direct (12 nov 2026): aceleași date ajung uneori ca text JSON, împachetate
      // sub `body` sau doar în payload-ul declanșatorului (aplicația era închisă) — citite direct, tap-ul nu deschidea
      // nimic. E același cititor folosit la afișarea notificării în prim-plan.
      const data = readPushData(response.notification);
      if (data) open(data);
    }

    // Aplicația era închisă: notificarea care a pornit-o. `.catch`: pe iOS un reject
    // netratat aici ar fi unhandled rejection la cold start (PLAN_FAZA17.md N4).
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!response) return;
        openOnce(response);
        // Consumat: altfel rămâne „ultimul răspuns" și ar fi reluat la nesfârșit
        // (cazul exact din docs pentru clearLastNotificationResponseAsync).
        return Notifications.clearLastNotificationResponseAsync();
      })
      .catch(() => {});

    // Aplicația era deschisă/în fundal.
    const subscription = Notifications.addNotificationResponseReceivedListener(openOnce);

    return () => subscription.remove();
  }, [role, isAdmin, chatSide, adminViewAs, setAdminViewAs, router]);
}
