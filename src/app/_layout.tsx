import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/hooks/use-auth';
// Efect secundar, doar web: Alert.alert e no-op în react-native-web — fără shim,
// erorile și confirmările erau invizibile în browser (vezi lib/web-alert.ts).
import '@/lib/web-alert';
import { BlockedProvider } from '@/hooks/use-blocked';
import { useLangSync } from '@/hooks/use-lang-sync';
import { usePushNavigation } from '@/hooks/use-push-navigation';
import { SettingsProvider, useSettings } from '@/hooks/use-settings';
import { isBanned } from '@/lib/ban';
import i18n from '@/i18n';

function RootLayoutNav() {
  const { session, profile, loading } = useAuth();
  const { resolvedScheme, ready, adminViewAs, setAdminViewAs } = useSettings();
  const segments = useSegments();
  const router = useRouter();

  // Tap pe notificare → ecranul potrivit; limba userului → serverul, pentru textul push.
  usePushNavigation();
  useLangSync();

  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === '(auth)';
    const inAdmin = segments[0] === '(admin)';
    const inDriver = segments[0] === '(driver)';
    const inMechanic = segments[0] === '(mechanic)';
    const onRoleSelect = inAuth && segments[1] === 'role-select';
    const onBanned = inAuth && segments[1] === 'banned';
    const noRoute = segments.length === 0;

    if (!session) {
      // La delogare, un admin care era în mod șofer/mecanic revine implicit la mod admin.
      if (adminViewAs !== 'admin') setAdminViewAs('admin');
      if (!inAuth) router.replace('/(auth)/login');
    } else if (!profile) {
      if (!onRoleSelect) router.replace('/(auth)/role-select');
    } else if (profile.role === 'admin') {
      // Adminul poate „intra ca" șofer/mecanic (Faza 16), altfel stă în (admin).
      // Ramura e ÎNAINTEA check-ului de ban — adminii nu ajung pe ecranul de ban.
      if (adminViewAs === 'driver') {
        if (!inDriver) router.replace('/(driver)/announcements');
      } else if (adminViewAs === 'mechanic') {
        if (!inMechanic) router.replace('/(mechanic)/feed');
      } else if (!inAdmin) {
        router.replace('/(admin)/dashboard');
      }
    } else if (isBanned(profile)) {
      // Cont banat (aplicativ): capturat pe ecranul de ban. Sesiunea rămâne validă
      // (mesaj clar + drept GDPR de ștergere self-service).
      if (!onBanned) router.replace('/(auth)/banned');
    } else if (inAuth || noRoute || inAdmin) {
      // `|| inAdmin`: un non-admin nu are ce căuta în grupul admin → înapoi acasă.
      router.replace(
        profile.role === 'driver' ? '/(driver)/announcements' : '/(mechanic)/feed'
      );
    }
  }, [session, profile, loading, segments, adminViewAs, setAdminViewAs]);

  // `ready` evită un flash pe tema greșită cât citim preferința din AsyncStorage.
  if (loading || !ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#164F9E" />
      </View>
    );
  }

  return (
    <ThemeProvider value={resolvedScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Slot />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // SafeAreaProvider explicit la rădăcină (PLAN_FAZA17.md L1): până acum insets veneau
  // doar din providerul intern al navigatoarelor expo-router, iar ecranul de loading de
  // mai sus era în afara oricărui context de insets.
  return (
    // GestureHandlerRootView: cerut de GestureDetector (swipe-to-reply în chat);
    // expo-router NU îl adaugă singur.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SettingsProvider>
          <I18nextProvider i18n={i18n}>
            <AuthProvider>
              <BlockedProvider>
                <RootLayoutNav />
              </BlockedProvider>
            </AuthProvider>
          </I18nextProvider>
        </SettingsProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
