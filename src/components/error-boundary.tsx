import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { usePathname, type ErrorBoundaryProps } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { describeClientError, reportClientError } from '@/lib/client-errors';
import { supabase } from '@/lib/supabase';

/**
 * Plasa de siguranță la randare (1.1, faza 9.1 — D9.1 = NU Sentry). O eroare aruncată la randarea
 * unui ecran nu mai lasă aplicația albă: apare „Ceva n-a mers” cu „Încearcă din nou” (remontează
 * ecranul) și, doar cu sesiune, „Trimite raportul”. NIMIC nu pleacă la server fără apăsarea
 * butonului (consimțământ per eveniment); deasupra lui scrie exact ce se trimite. Fără handler global
 * (ErrorUtils / window.onerror): erorile din callback-uri și promisiuni nu ajung aici, ca înainte.
 *
 * UNDE stă: e exportul `ErrorBoundary` al expo-router (îl învelește pe ruta care îl exportă într-un
 * `Try`), pus pe layout-urile de GRUP — (auth), (driver), (mechanic), (admin), (guest) — și pe rutele
 * din rădăcină (index, auth/confirm, p/[id], report). NU în jurul `<Slot />` din `app/_layout.tsx`: acolo ar fi
 * demontat navigatorul rădăcină, iar garda de navigare sau un tap pe notificare ar fi aruncat „Attempted
 * to navigate before mounting the Root Layout” DEASUPRA plasei (review 10 nov). Așa, rădăcina rămâne
 * montată: garda poate trimite la login, iar o navigare (tap pe notificare) schimbă ruta — ecranul de
 * eroare vede schimbarea (`usePathname`) și reîncearcă singur. Erorile din layout-ul rădăcină (provideri,
 * gardă) nu sunt prinse, ca înainte de 1.1.
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const pathname = usePathname();
  const seenPath = useRef(pathname);

  // Ruta s-a schimbat cât timp ecranul de eroare era afișat → o singură reîncercare per schimbare
  // (dacă și ruta nouă aruncă, plasa prinde din nou și rămânem aici, fără buclă).
  useEffect(() => {
    if (seenPath.current === pathname) return;
    seenPath.current = pathname;
    void retry();
  }, [pathname, retry]);

  // `throw 'text'` sau `throw {}` sunt posibile în JS — raportul are nevoie de name/message/stack.
  const normalized = error instanceof Error ? error : new Error(String(error));
  return <ErrorFallback error={normalized} screen={pathname} onRetry={() => void retry()} />;
}

type SendState = 'idle' | 'sending' | 'sent' | 'rate_limited' | 'failed';

/** Cât așteptăm citirea sesiunii: pe rețea proastă (refresh de token blocat) butonul de trimitere nu apare. */
const SESSION_TIMEOUT_MS = 3000;

function ErrorFallback({ error, screen, onRetry }: { error: Error; screen: string; onRetry: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Sesiunea se citește direct din supabase la montare, nu din contextul de auth: ecranul trebuie să
  // meargă și dacă eroarea vine chiar din starea aceea. `null` = încă nu știm → butonul nu apare.
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [sendState, setSendState] = useState<SendState>('idle');
  // Lacăt sincron: două tap-uri în același cadru nu trimit două rapoarte (starea se vede abia la re-randare).
  const sendLock = useRef(false);
  const info = describeClientError(screen, error);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) setHasSession((current) => current ?? false);
    }, SESSION_TIMEOUT_MS);
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setHasSession(!!data.session);
      })
      .catch(() => {
        if (active) setHasSession(false);
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);

  async function send() {
    if (sendLock.current || sendState === 'sent') return;
    sendLock.current = true;
    setSendState('sending');
    const result = await reportClientError({ screen, error });
    sendLock.current = false;
    if (result.ok) setSendState('sent');
    else if (result.reason === 'no_session') {
      setHasSession(false);
      setSendState('idle');
    } else setSendState(result.reason === 'rate_limited' ? 'rate_limited' : 'failed');
  }

  const sending = sendState === 'sending';

  return (
    <ThemedView style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + Spacing.four, paddingBottom: insets.bottom + Spacing.four },
        ]}>
        <View style={[styles.icon, { backgroundColor: theme.neutralBg }]}>
          <Feather name="alert-triangle" size={28} color={theme.textSecondary} />
        </View>
        <ThemedText style={styles.title} accessibilityRole="header">
          {t('errorBoundary.title')}
        </ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.center}>
          {t('errorBoundary.body')}
        </ThemedText>

        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t('errorBoundary.retry')}
          style={({ pressed }) => [styles.button, { backgroundColor: theme.primary }, pressed && styles.pressed]}>
          <Text style={styles.primaryLabel}>{t('errorBoundary.retry')}</Text>
        </Pressable>

        {hasSession && sendState === 'sent' ? (
          <ThemedText themeColor="successText" style={styles.center} accessibilityLiveRegion="polite">
            {t('errorBoundary.sent')}
          </ThemedText>
        ) : null}

        {hasSession && sendState !== 'sent' ? (
          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">{t('errorBoundary.whatIsSent')}</ThemedText>
            <InfoRow label={t('errorBoundary.type')} value={info.type} />
            {info.message ? <InfoRow label={t('errorBoundary.message')} value={info.message} /> : null}
            <InfoRow label={t('errorBoundary.screen')} value={info.screen || '—'} />
            <InfoRow label={t('errorBoundary.version')} value={info.version || '—'} />
            <ThemedText type="small" themeColor="textTertiary">
              {t('errorBoundary.noPersonalData')}
            </ThemedText>
            <Pressable
              onPress={() => void send()}
              disabled={sending}
              accessibilityRole="button"
              accessibilityLabel={t('errorBoundary.send')}
              accessibilityState={{ disabled: sending, busy: sending }}
              style={({ pressed }) => [
                styles.button,
                styles.secondary,
                { borderColor: theme.brand },
                (pressed || sending) && styles.pressed,
              ]}>
              <Text style={[styles.secondaryLabel, { color: theme.brand }]}>
                {sending ? t('errorBoundary.sending') : t('errorBoundary.send')}
              </Text>
            </Pressable>
            {sendState === 'rate_limited' || sendState === 'failed' ? (
              <ThemedText type="small" themeColor="textSecondary" accessibilityLiveRegion="polite">
                {sendState === 'rate_limited' ? t('errorBoundary.rateLimited') : t('errorBoundary.failed')}
              </ThemedText>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <ThemedText type="small">
      <ThemedText type="small" themeColor="textSecondary">
        {label}:{' '}
      </ThemedText>
      {value}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  icon: {
    width: 56,
    height: 56,
    borderRadius: Radius.circle,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: 'center' },
  center: { textAlign: 'center' },
  card: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  button: {
    minHeight: 50,
    borderRadius: Radius.control,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, marginTop: Spacing.one },
  pressed: { opacity: 0.55 },
  // Alb pe `theme.primary`, ca eticheta din components/ui/button.tsx.
  primaryLabel: { color: '#fff', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  secondaryLabel: { fontSize: 16, fontWeight: '600', textAlign: 'center' },
});
