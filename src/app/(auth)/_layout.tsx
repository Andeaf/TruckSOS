import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

export default function AuthLayout() {
  return (
    <>
      {/* Ecranele de auth sunt light-only (Faza 4) și n-au antet colorat → iconițe închise. */}
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}

// 1.1 (faza 9.1): o eroare la randare aici arată ecranul „Ceva n-a mers” (components/error-boundary.tsx),
// fără să demonteze navigatorul rădăcină.
export { RouteErrorBoundary as ErrorBoundary } from '@/components/error-boundary';
