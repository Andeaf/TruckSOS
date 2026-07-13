import { useEffect } from 'react';

import i18n from '@/i18n';
import { useAuth } from '@/hooks/use-auth';
import { useSettings } from '@/hooks/use-settings';

/**
 * Ține `profiles.lang` la zi cu limba efectivă din aplicație.
 *
 * Motiv: textul notificărilor push se compune pe SERVER (trigger SQL), iar Postgres
 * n-are de unde ști ce limbă și-a ales userul — preferința trăiește în AsyncStorage.
 * Scriem limba rezolvată în profil la fiecare schimbare, o singură dată per schimbare.
 */
export function useLangSync() {
  const { profile, updateProfile } = useAuth();
  const { lang, ready } = useSettings();

  useEffect(() => {
    if (!ready || !profile) return;

    // `lang` poate fi 'auto' → contează limba efectiv activă în i18next.
    const active = i18n.language;
    if (!active || active === profile.lang) return;

    updateProfile({ lang: active });
    // `updateProfile` e recreat la fiecare render al providerului → îl ținem în afara
    // dependențelor, altfel efectul s-ar relua la infinit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, lang, profile?.id, profile?.lang]);
}
