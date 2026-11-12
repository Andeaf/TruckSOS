import { LegalScreen } from '@/components/legal-screen';
import { useAuth } from '@/hooks/use-auth';

/**
 * Politica de confidențialitate în (auth) (1.1, faza 8.2 — C8.2): deschisă și de oaspeți (foaia
 * „Ai nevoie de un cont”, login). Back-ul urcă în istoric; fallback-ul (fără istoric, ex.
 * reîncărcare pe web) e poarta cu sesiune, login-ul fără.
 */
export default function AuthPrivacy() {
  const { session } = useAuth();
  return <LegalScreen kind="privacy" backPath={session ? '/(auth)/terms-update' : '/(auth)/login'} />;
}
