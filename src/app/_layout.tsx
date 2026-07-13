import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { I18nextProvider } from 'react-i18next';

import { AuthProvider, useAuth } from '@/hooks/use-auth';
import { useLangSync } from '@/hooks/use-lang-sync';
import { usePushNavigation } from '@/hooks/use-push-navigation';
import { SettingsProvider, useSettings } from '@/hooks/use-settings';
import i18n from '@/i18n';

function RootLayoutNav() {
  const { session, profile, loading } = useAuth();
  const { resolvedScheme, ready } = useSettings();
  const segments = useSegments();
  const router = useRouter();

  // Tap pe notificare → ecranul potrivit; limba userului → serverul, pentru textul push.
  usePushNavigation();
  useLangSync();

  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === '(auth)';
    const onRoleSelect = inAuth && segments[1] === 'role-select';
    const noRoute = segments.length === 0;

    if (!session) {
      if (!inAuth) router.replace('/(auth)/login');
    } else if (!profile) {
      if (!onRoleSelect) router.replace('/(auth)/role-select');
    } else if (inAuth || noRoute) {
      router.replace(
        profile.role === 'driver' ? '/(driver)/announcements' : '/(mechanic)/feed'
      );
    }
  }, [session, profile, loading, segments]);

  // `ready` evită un flash pe tema greșită cât citim preferința din AsyncStorage.
  if (loading || !ready) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#208AEF" />
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
  return (
    <SettingsProvider>
      <I18nextProvider i18n={i18n}>
        <AuthProvider>
          <RootLayoutNav />
        </AuthProvider>
      </I18nextProvider>
    </SettingsProvider>
  );
}
