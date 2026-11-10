import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/hooks/use-auth';
import {
  TERMS_VERSION,
  fetchTermsStatus,
  needsTermsAcceptance,
  type TermsStatus,
} from '@/lib/terms';

/**
 * Starea consimțământului la Termeni pentru sesiunea curentă (1.1, faza 8.2 — C8.2). Citită o
 * singură dată per cont (când apar sesiunea și profilul), ținută în memorie; poarta din
 * `_layout.tsx` o folosește ca să coboare „Termenii s-au actualizat”. Oaspeții (fără sesiune) și
 * contul nou încă fără profil (role-select) nu cer nimic.
 */

interface TermsStatusContextValue {
  status: TermsStatus | null;
  /** `true` cât timp citirea pentru contul curent (cu profil) n-a ajuns la un rezultat. */
  loading: boolean;
  needsAcceptance: boolean;
  /** După `accept_terms` reușit (sau la înscriere, cu caseta 18+ bifată): poarta se ridică local. */
  markAccepted: () => void;
  refresh: () => Promise<void>;
}

const TermsStatusContext = createContext<TermsStatusContextValue | null>(null);

export function TermsStatusProvider({ children }: { children: React.ReactNode }) {
  const { session, profile } = useAuth();
  const userId = session?.user.id ?? null;
  const hasProfile = !!profile && profile.id === userId;
  const [status, setStatus] = useState<TermsStatus | null>(null);
  // Contul pentru care avem un rezultat (răspuns, eșec sau acceptare locală). `loading` e
  // DERIVAT din el, nu o stare separată: altfel ar exista o randare cu profilul prezent și
  // `loading` încă false, iar garda ar ruta pe ecranul de start înaintea porții.
  const [settledFor, setSettledFor] = useState<string | null>(null);
  // Acceptarea locală câștigă mereu în fața unei citiri pornite înainte (înscrierea: profilul
  // apare, citirea pleacă și întoarce `terms_version: null` după ce caseta a fost bifată).
  const acceptedForRef = useRef<string | null>(null);
  const inFlightRef = useRef<string | null>(null);
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const load = useCallback(async (uid: string) => {
    inFlightRef.current = uid;
    const next = await fetchTermsStatus();
    if (inFlightRef.current === uid) inFlightRef.current = null;
    // Între timp s-a delogat / a intrat alt cont, sau a acceptat local: rezultatul nu mai contează.
    if (userIdRef.current !== uid || acceptedForRef.current === uid) return;
    setStatus(next);
    setSettledFor(uid);
  }, []);

  // Contul s-a schimbat (alt user / delogare): uităm tot ce știam.
  useEffect(() => {
    setStatus(null);
    setSettledFor(null);
    acceptedForRef.current = null;
  }, [userId]);

  useEffect(() => {
    if (!userId || !hasProfile) return;
    if (settledFor === userId || inFlightRef.current === userId) return;
    void load(userId);
  }, [userId, hasProfile, settledFor, load]);

  const markAccepted = useCallback(() => {
    const uid = userIdRef.current;
    if (!uid) return;
    acceptedForRef.current = uid;
    const now = new Date().toISOString();
    setStatus({ terms_version: TERMS_VERSION, terms_accepted_at: now, age_confirmed_at: now });
    setSettledFor(uid);
  }, []);

  const refresh = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    acceptedForRef.current = null;
    await load(uid);
  }, [load]);

  const loading = !!userId && hasProfile && settledFor !== userId;
  const current = settledFor === userId ? status : null;

  const value = useMemo<TermsStatusContextValue>(
    () => ({
      status: current,
      loading,
      needsAcceptance: !!userId && hasProfile && needsTermsAcceptance(current),
      markAccepted,
      refresh,
    }),
    [current, loading, userId, hasProfile, markAccepted, refresh]
  );

  return <TermsStatusContext.Provider value={value}>{children}</TermsStatusContext.Provider>;
}

export function useTermsStatus(): TermsStatusContextValue {
  const ctx = useContext(TermsStatusContext);
  if (!ctx) throw new Error('useTermsStatus trebuie folosit sub TermsStatusProvider');
  return ctx;
}
