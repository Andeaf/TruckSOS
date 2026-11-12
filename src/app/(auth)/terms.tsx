import { LegalScreen } from '@/components/legal-screen';
import { useAuth } from '@/hooks/use-auth';

/**
 * Termenii în (auth) (1.1, faza 8.2 — C8.2): deschiși de pe login / înregistrare / alegerea rolului
 * (fără profil) și din poarta „Termenii s-au actualizat”. Back-ul urcă în istoric; fallback-ul
 * (fără istoric, ex. reîncărcare pe web) e poarta cu sesiune, login-ul fără.
 */
export default function AuthTerms() {
  const { session } = useAuth();
  return <LegalScreen kind="terms" backPath={session ? '/(auth)/terms-update' : '/(auth)/login'} />;
}
