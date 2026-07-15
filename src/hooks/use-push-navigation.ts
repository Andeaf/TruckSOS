import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { useAuth } from '@/hooks/use-auth';
import { pushAvailable, type PushData } from '@/lib/push';

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

  useEffect(() => {
    // În Expo Go push-ul nu există → nici nu importăm expo-notifications (side-effect
    // care crapă în Expo Go SDK 53+). Doar pe development build ajungem mai departe.
    if (!profile || !pushAvailable()) return;
    const role = profile.role;

    function open(data: PushData) {
      if (!data.id) return;
      const params = { id: data.id };

      switch (data.type) {
        case 'conversation':
          router.push({
            pathname:
              role === 'driver'
                ? '/(driver)/conversations/[id]'
                : ('/(mechanic)/conversations/[id]' as never),
            params,
          });
          break;
        case 'announcement':
          router.push({ pathname: '/(driver)/announcements/[id]' as never, params });
          break;
        case 'feed':
          router.push({ pathname: '/(mechanic)/feed/[id]' as never, params });
          break;
        case 'application':
          router.push({ pathname: '/(mechanic)/applications/[id]' as never, params });
          break;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Notifications = require('expo-notifications') as typeof import('expo-notifications');

    // Aplicația era închisă: notificarea care a pornit-o.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      const data = response?.notification.request.content.data as PushData | undefined;
      if (data) open(data);
    });

    // Aplicația era deschisă/în fundal.
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data as PushData);
    });

    return () => subscription.remove();
  }, [profile, router]);
}
