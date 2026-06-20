import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Slot, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useColorScheme } from 'react-native';

import { AuthProvider, useAuth } from '@/hooks/use-auth';

function RootLayoutNav() {
  const { session, profile, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (loading) return;

    const inAuth = segments[0] === '(auth)';
    const onRoleSelect = inAuth && segments[1] === 'role-select';

    if (!session) {
      if (!inAuth) router.replace('/(auth)/login');
    } else if (!profile) {
      if (!onRoleSelect) router.replace('/(auth)/role-select');
    } else if (inAuth) {
      router.replace(
        profile.role === 'driver' ? '/(driver)/announcements' : '/(mechanic)/feed'
      );
    }
  }, [session, profile, loading, segments]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#208AEF" />
      </View>
    );
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Slot />
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootLayoutNav />
    </AuthProvider>
  );
}
