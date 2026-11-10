import { useEffect } from 'react';
import { useRouter } from 'expo-router';

import { DeleteAccountScreen } from '@/components/delete-account-screen';
import { useAuth } from '@/hooks/use-auth';

/**
 * Ștergerea contului din poarta „Termenii s-au actualizat” (1.1, faza 8.2 — C8.2). După ștergere
 * `DeleteAccountScreen` doar deconectează; fără sesiune garda nu părăsește singură grupul (auth)
 * (ca la two-factor), deci mergem noi la login.
 */
export default function AuthDeleteAccount() {
  const { session } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!session) router.replace('/(auth)/login' as never);
  }, [session, router]);

  return <DeleteAccountScreen backPath="/(auth)/terms-update" />;
}
