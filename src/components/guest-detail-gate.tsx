import { useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { useAccountGate, type AccountGateReason } from '@/hooks/use-account-gate';

/**
 * 25 oct 2026: oaspetele NU vede detaliile (anunț, profil, anunț din Market) — doar listele.
 * Listele deschid direct foaia de cont; componenta asta e plasa de siguranță pentru rutele
 * `/(guest)/.../[id]` atinse altfel (URL scris pe web, link vechi, istoric de navigare):
 * înapoi pe listă + foaia de cont, cu ecranul cerut ca link amânat (după cont ajunge pe el).
 */
export function GuestDetailGate({
  reason,
  listPath,
}: {
  reason: AccountGateReason;
  /** Ruta listei din grupul (guest), de ex. `/(guest)/announcements`. */
  listPath: string;
}) {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { requireAccount } = useAccountGate();

  useEffect(() => {
    router.replace(listPath as never);
    requireAccount(reason, id ? `${listPath}/${id}` : undefined);
  }, [router, requireAccount, reason, listPath, id]);

  return null;
}
