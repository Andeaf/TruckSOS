import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { fetchGuestProfile } from '@/hooks/use-guest-data';
import { useSettings } from '@/hooks/use-settings';
import { useTheme } from '@/hooks/use-theme';
import { isBanned } from '@/lib/ban';
import { setPendingLink } from '@/lib/pending-link';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/share-app';
import { supabase } from '@/lib/supabase';

/**
 * Linkul de profil partajat — trucksos.net/p/<id> (7 sept 2026).
 *
 * Aceeași rută pe toate platformele:
 *   - NATIV (App Link / Universal Link sau schema trucksos://): cu sesiune, află rolul
 *     persoanei și SARE (replace) pe ecranul de profil potrivit rolului privitorului —
 *     exact rutarea din chat (transportator→mecanic = ecranul bogat cu telefon);
 *     fără sesiune, ține linkul minte (pending-link) și merge la login.
 *   - WEB, fără sesiune: pagina de „aterizare". Pe telefon încearcă să deschidă
 *     aplicația (intent:// pe Android, schema pe iOS) și, dacă nu s-a deschis în
 *     ~2,5 s, trimite la magazin (cerere user: „dacă nu are TruckSOS instalat, să fie
 *     redirecționat către pagina de instalare"). Pe desktop rămân butoanele: continuă
 *     pe web (login → profil) sau linkurile de magazin.
 *
 * Garda din rădăcină (_layout) NU ricoșează segmentul `p` — ecranul decide singur.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ANDROID_PACKAGE = 'com.andeaf.trucksos';
/** Cât așteptăm deschiderea aplicației înainte de a trimite la magazin. */
const STORE_FALLBACK_MS = 2500;

type Device = 'android' | 'ios' | 'desktop';

function detectDevice(): Device {
  if (Platform.OS !== 'web' || typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  // iPadOS se dă drept Mac; touch-ul îl demască.
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'desktop';
}

function appSchemeUrl(id: string): string {
  return `trucksos://p/${id}`;
}

/** Chrome/WebView pe Android: deschide aplicația dacă e instalată, altfel URL-ul de fallback. */
function androidIntentUrl(id: string): string {
  return (
    `intent://p/${id}#Intent;scheme=trucksos;package=${ANDROID_PACKAGE};` +
    `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`
  );
}

export default function SharedProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { session, profile, loading, isGuest } = useAuth();
  const { adminViewAs, setAdminViewAs } = useSettings();
  const [state, setState] = useState<'resolving' | 'landing' | 'notFound'>('resolving');
  const device = useMemo(detectDevice, []);
  const validId = !!id && UUID_RE.test(id);
  const hasSession = !!session;
  const role = profile?.role;
  const banned = profile ? isBanned(profile) : false;

  useEffect(() => {
    if (loading) return;
    if (!validId) {
      router.replace('/' as never);
      return;
    }
    if (!hasSession) {
      const fallback = () => {
        setPendingLink(`/p/${id}`);
        if (Platform.OS === 'web') setState('landing');
        else router.replace('/(auth)/login' as never);
      };
      // 1.1 (B3, Q3): oaspetele (și vizitatorul de pe web) vede profilul direct, din
      // `guest_profiles`, pe ecranul de profil al oaspetelui — indiferent de rol.
      if (!isGuest && Platform.OS !== 'web') {
        fallback();
        return;
      }
      let cancelledGuest = false;
      fetchGuestProfile(id).then(({ data, error }) => {
        if (cancelledGuest) return;
        if (data) {
          router.replace({ pathname: '/(guest)/mechanics/[id]', params: { id } } as never);
        } else if (!error) {
          setState('notFound');
        } else {
          // Server fără migrarea de oaspeți sau rețea picată: comportamentul de dinainte.
          fallback();
        }
      });
      return () => {
        cancelledGuest = true;
      };
    }
    if (!role) {
      // Cont nou fără profil: garda îl duce la alegerea rolului; linkul se reia după.
      setPendingLink(`/p/${id}`);
      return;
    }
    if (banned) return;

    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('profiles').select('id, role').eq('id', id).maybeSingle();
      if (cancelled) return;
      const target = (data as { id: string; role: string } | null) ?? null;
      if (!target) {
        setState('notFound');
        return;
      }
      // Adminul (rol dual) vede profilul pe „partea" în care se află; din modul admin
      // cade pe transportator — ecranele de profil nu există în grupul (admin).
      const side: 'driver' | 'mechanic' =
        role === 'admin' ? (adminViewAs === 'mechanic' ? 'mechanic' : 'driver') : role;
      if (role === 'admin' && adminViewAs !== side) setAdminViewAs(side);
      const pathname =
        side === 'driver'
          ? target.role === 'mechanic'
            ? '/(driver)/mechanic-profile/[id]'
            : '/(driver)/public-profile/[id]'
          : '/(mechanic)/public-profile/[id]';
      router.replace({ pathname, params: { id } } as never);
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, hasSession, isGuest, role, banned, validId, id, adminViewAs, setAdminViewAs, router]);

  // Web pe telefon: încercăm aplicația, apoi magazinul. Dacă aplicația s-a deschis,
  // pagina intră în fundal (visibilityState = hidden) și NU mai redirecționăm.
  useEffect(() => {
    if (state !== 'landing' || device === 'desktop') return;
    const timer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      window.location.replace(device === 'android' ? PLAY_STORE_URL : APP_STORE_URL);
    }, STORE_FALLBACK_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') clearTimeout(timer);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.location.href = device === 'android' ? androidIntentUrl(id) : appSchemeUrl(id);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [state, device, id]);

  const openApp = () => {
    window.location.href = device === 'android' ? androidIntentUrl(id) : appSchemeUrl(id);
  };
  const continueOnWeb = () => router.replace('/(auth)/login' as never);

  if (state === 'resolving') {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={theme.brand} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.centered}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <Image source={require('@/assets/images/icon.png')} style={styles.logo} />
        {state === 'notFound' ? (
          <>
            <ThemedText type="subtitle" style={styles.center}>
              {t('shareLanding.notFound')}
            </ThemedText>
            <Button title={t('shareLanding.goHome')} onPress={() => router.replace('/' as never)} />
          </>
        ) : (
          <>
            <ThemedText type="subtitle" style={styles.center}>
              {t('shareLanding.title')}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              {t(device === 'desktop' ? 'shareLanding.body' : 'shareLanding.opening')}
            </ThemedText>
            <View style={styles.actions}>
              {device === 'desktop' ? (
                <>
                  <Button title={t('shareLanding.continueWeb')} onPress={continueOnWeb} />
                  <Button
                    variant="secondary"
                    title={t('shareLanding.android')}
                    onPress={() => void Linking.openURL(PLAY_STORE_URL)}
                  />
                  <Button
                    variant="secondary"
                    title={t('shareLanding.ios')}
                    onPress={() => void Linking.openURL(APP_STORE_URL)}
                  />
                </>
              ) : (
                <>
                  <Button title={t('shareLanding.openApp')} onPress={openApp} />
                  <Button
                    variant="secondary"
                    title={t(device === 'android' ? 'shareLanding.android' : 'shareLanding.ios')}
                    onPress={() =>
                      window.location.assign(device === 'android' ? PLAY_STORE_URL : APP_STORE_URL)
                    }
                  />
                  <Pressable onPress={continueOnWeb} hitSlop={8} style={styles.textLink}>
                    <ThemedText type="link">{t('shareLanding.continueWeb')}</ThemedText>
                  </Pressable>
                </>
              )}
            </View>
          </>
        )}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.four },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Radius.card,
    padding: Spacing.five,
    alignItems: 'center',
    gap: Spacing.three,
  },
  logo: { width: 72, height: 72, borderRadius: 16 },
  center: { textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.two },
  textLink: { alignSelf: 'center', paddingVertical: Spacing.two },
});
