import { ActivityIndicator, View } from 'react-native';

export default function Index() {
  return (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size="large" color="#164F9E" />
    </View>
  );
}

// 1.1 (faza 9.1): o eroare la randare aici arată ecranul „Ceva n-a mers” (components/error-boundary.tsx),
// fără să demonteze navigatorul rădăcină.
export { RouteErrorBoundary as ErrorBoundary } from '@/components/error-boundary';
