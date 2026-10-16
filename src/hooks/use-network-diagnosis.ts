import { useCallback, useEffect, useRef, useState } from 'react';

import { buildDiagnosticEntry, queueDiagnostic } from '@/lib/diagnostic-log';
import { diagnoseNetwork, isNetworkError, type NetworkDiagnosis } from '@/lib/network-diagnosis';

export type NetworkDiagnosisState = NetworkDiagnosis | 'checking' | null;

/**
 * Când o acțiune de auth pică din cauza rețelei, pornește diagnosticul și întoarce
 * rezultatul pentru `<NetworkTroubleshoot />` (13 oct 2026). Orice altă eroare
 * (sau succes) îl șterge. `inspect` primește eroarea brută SAU mesajul deja tradus,
 * plus `kind` (login / register / reset_request…) pentru jurnalul de diagnostice,
 * care pleacă spre server la prima conectare reușită (lib/diagnostic-log.ts).
 */
export function useNetworkDiagnosis(): {
  diagnosis: NetworkDiagnosisState;
  inspect: (error: unknown, kind: string) => void;
  reset: () => void;
} {
  const [diagnosis, setDiagnosis] = useState<NetworkDiagnosisState>(null);
  const runRef = useRef(0);

  useEffect(
    () => () => {
      // Demontat: rezultatul sondelor nu mai are unde să ajungă pe ecran
      // (jurnalul se scrie oricum, în `then`-ul de mai jos).
      runRef.current++;
    },
    []
  );

  const reset = useCallback(() => {
    runRef.current++;
    setDiagnosis(null);
  }, []);

  const inspect = useCallback((error: unknown, kind: string) => {
    if (!isNetworkError(error)) {
      runRef.current++;
      setDiagnosis(null);
      return;
    }
    const run = ++runRef.current;
    setDiagnosis('checking');
    diagnoseNetwork()
      .then((report) => {
        if (runRef.current === run) setDiagnosis(report.diagnosis);
        void queueDiagnostic(buildDiagnosticEntry(kind, error, report));
      })
      .catch(() => {
        if (runRef.current === run) setDiagnosis('offline');
      });
  }, []);

  return { diagnosis, inspect, reset };
}
