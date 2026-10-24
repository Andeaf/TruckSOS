import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { I18nextProvider } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { UpdatePrompt } from '@/components/update-prompt';
import { AuthProvider, useAuth } from '@/hooks/use-auth';
// Efect secundar, doar web: Alert.alert e no-op în react-native-web — fără shim,
// erorile și confirmările erau invizibile în browser (vezi lib/web-alert.ts).
import '@/lib/web-alert';
import { BlockedProvider } from '@/hooks/use-blocked';
import { useLangSync } from '@/hooks/use-lang-sync';
import { usePushNavigation } from '@/hooks/use-push-navigation';
import { SettingsProvider, useSettings } from '@/hooks/use-settings';
import { isBanned } from '@/lib/ban';
import { takePendingLink } from '@/lib/pending-link';
import i18n from '@/i18n';

function RootLayoutNav() {
  const { session, profile, profileMissing, loading } = useAuth();
  const { resolvedScheme, ready, adminViewAs, setAdminViewAs } = useSettings();
  const segments = useSegments();
  const router = useRouter();

  // Tap pe notificare → ecranul potrivit; limba userului → serverul, pentru textul push.
  usePushNavigation();
  useLangSync();

  useEffect(() => {
    if (loading) return;

    // Cast: tipurile rutelor (.expo/types/router.d.ts) sunt generate abia la `expo start`
    // / `expo export`, deci lipsesc pe CI și nu admit nici lista goală (la reload în Expo Go
    // segments chiar e []). Garda compară doar string-uri, nu are nevoie de tipurile exacte.
    const seg = segments as string[];
    const inAuth = seg[0] === '(auth)';
    const inAdmin = seg[0] === '(admin)';
    const inDriver = seg[0] === '(driver)';
    const inMechanic = seg[0] === '(mechanic)';
    const onRoleSelect = inAuth && seg[1] === 'role-select';
    const onBanned = inAuth && seg[1] === 'banned';
    const noRoute = seg.length === 0;
    // Link de profil partajat, trucksos.net/p/<id> (7 sept): ecranul /p/[id] își
    // decide singur soarta — cu sesiune rezolvă rolul și navighează, fără sesiune ține
    // linkul minte (pe web arată pagina de instalare). Garda NU-l ricoșează.
    const inSharedLink = seg[0] === 'p';
    // Linkul de activare din e-mailul de confirmare, trucksos.net/auth/confirm (1.1, Faza C):
    // pe web pagina rămâne afișată (buton „Activează contul", apoi „Cont activat"), pe nativ
    // ecranul verifică și face el `router.replace('/')`. Garda NU-l ricoșează — nici fără
    // sesiune, nici cu sesiunea nou creată fără profil (altfel „Cont activat" ar sări direct
    // la alegerea rolului înainte ca omul să-l vadă).
    const inAuthLink = seg[0] === 'auth';

    if (!session) {
      // La delogare, un admin care era în mod șofer/mecanic revine implicit la mod admin.
      if (adminViewAs !== 'admin') setAdminViewAs('admin');
      if (!inAuth && !inSharedLink && !inAuthLink) router.replace('/(auth)/login');
    } else if (!profile) {
      // Doar cu confirmarea serverului ca nu exista profil (cont nou). O citire picata pe
      // retea nu mai trimite nicaieri: ramane ecranul curent / cel de incarcare (14 oct 2026).
      // 15 oct: o identitate Google/Apple fara cont venita de pe LOGIN nu ajunge aici —
      // use-auth o deconecteaza (profileMissing ramane false) si login-ul explica de ce.
      if (profileMissing && !onRoleSelect && !inAuthLink) router.replace('/(auth)/role-select');
    } else if (profile.role === 'admin') {
      // Adminul poate „intra ca" șofer/mecanic (Faza 16), altfel stă în (admin).
      // Ramura e ÎNAINTEA check-ului de ban — adminii nu ajung pe ecranul de ban.
      if (adminViewAs === 'driver') {
        if (!inDriver && !inSharedLink && !inAuthLink) router.replace('/(driver)/announcements');
      } else if (adminViewAs === 'mechanic') {
        if (!inMechanic && !inSharedLink && !inAuthLink) router.replace('/(mechanic)/feed');
      } else if (!inAdmin && !inSharedLink && !inAuthLink) {
        router.replace((takePendingLink() ?? '/(admin)/dashboard') as never);
      }
    } else if (isBanned(profile)) {
      // Cont banat (aplicativ): capturat pe ecranul de ban. Sesiunea rămâne validă
      // (mesaj clar + drept GDPR de ștergere self-service).
      if (!onBanned) router.replace('/(auth)/banned');
    } else if (inAuth || noRoute || inAdmin) {
      // `|| inAdmin`: un non-admin nu are ce căuta în grupul admin → înapoi acasă.
      // Linkul amânat (profil partajat deschis fără sesiune) are prioritate față de
      // ecranul de start — utilizatorul s-a logat tocmai ca să vadă acel profil.
      const home = profile.role === 'driver' ? '/(driver)/announcements' : '/(mechanic)/feed';
      router.replace((takePendingLink() ?? home) as never);
    }
  }, [session, profile, profileMissing, loading, segments, adminViewAs, setAdminViewAs, router]);

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
      {/* „Versiune nouă disponibilă" (17 sept): peste orice ecran, doar cu sesiune + profil
          (nu peste auth / ban); pe web nu apare. O dată la 24h — vezi useUpdatePrompt. */}
      <UpdatePrompt enabled={!!session && !!profile && !isBanned(profile)} />
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
