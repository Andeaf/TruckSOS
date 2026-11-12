import { PublicReportScreen } from '@/components/public-report-screen';

/** trucksos.net/report?type=…&id=… — sesizare fără cont (faza 8.3, DSA art. 16). */
export default function PublicReport() {
  return <PublicReportScreen />;
}

// 1.1 (faza 9.1): o eroare la randare aici arată ecranul „Ceva n-a mers” (components/error-boundary.tsx),
// fără să demonteze navigatorul rădăcină.
export { RouteErrorBoundary as ErrorBoundary } from '@/components/error-boundary';
