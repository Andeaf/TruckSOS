import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';

import { useAuth } from '@/hooks/use-auth';
import type { PushData } from '@/lib/push';

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
    if (!profile) return;
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
