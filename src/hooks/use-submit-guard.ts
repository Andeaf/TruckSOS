import { useCallback, useRef } from 'react';

/**
 * Gardă sincronă contra dublului tap (26 oct 2026, AUDIT #30 / PLAN_1.1_FIX 1.7).
 *
 * `loading` din state dezactivează butonul abia după re-randare; două tap-uri foarte rapide
 * (sau un tap + Enter pe web) porneau același handler de două ori — la „Publică” însemna două
 * anunțuri și două rafale de push către toți mecanicii. Ref-ul se setează sincron, în același
 * tick cu primul tap, deci al doilea apel iese imediat.
 *
 *   const guard = useSubmitGuard();
 *   <Button onPress={() => guard(handleSubmit)} />
 */
export function useSubmitGuard() {
  const busy = useRef(false);
  return useCallback(async (action: () => Promise<void> | void): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    try {
      await action();
    } finally {
      busy.current = false;
    }
  }, []);
}
