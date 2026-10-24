import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { useAuth } from '@/hooks/use-auth';

/**
 * Poarta „Ai nevoie de un cont" (1.1, Faza B2): orice acțiune care cere cont (mesaj,
 * publicare, ofertă, evaluare, raportare, apel…) întreabă întâi `requireAccount(motiv)`.
 * Cu sesiune → `true`, acțiunea continuă. Fără sesiune (oaspete) → se deschide foaia
 * `AccountGateSheet` (montată o singură dată în `_layout.tsx`) cu mesajul potrivit
 * motivului și întoarce `false` — un pop-up, nu un buton dezactivat.
 */
export type AccountGateReason =
  | 'message'
  | 'publish'
  | 'apply'
  | 'rate'
  | 'report'
  | 'block'
  | 'contact'
  | 'call'
  | 'translate'
  | 'marketPublish'
  | 'marketContact'
  | 'generic';

interface AccountGateContextValue {
  requireAccount: (reason: AccountGateReason) => boolean;
  /** Pentru foaie: motivul afișat acum (`null` = închisă). */
  reason: AccountGateReason | null;
  close: () => void;
}

const AccountGateContext = createContext<AccountGateContextValue | null>(null);

export function AccountGateProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [reason, setReason] = useState<AccountGateReason | null>(null);
  const hasSession = !!session;

  const requireAccount = useCallback(
    (next: AccountGateReason) => {
      if (hasSession) return true;
      setReason(next);
      return false;
    },
    [hasSession]
  );
  const close = useCallback(() => setReason(null), []);

  const value = useMemo(
    // Odată cu sesiunea (login din altă parte) foaia nu mai are ce căuta pe ecran.
    () => ({ requireAccount, reason: hasSession ? null : reason, close }),
    [requireAccount, reason, hasSession, close]
  );

  return <AccountGateContext.Provider value={value}>{children}</AccountGateContext.Provider>;
}

function useAccountGateContext(): AccountGateContextValue {
  const ctx = useContext(AccountGateContext);
  if (!ctx) throw new Error('useAccountGate trebuie folosit în interiorul AccountGateProvider');
  return ctx;
}

export function useAccountGate(): { requireAccount: (reason: AccountGateReason) => boolean } {
  const { requireAccount } = useAccountGateContext();
  return { requireAccount };
}

/** Doar pentru `AccountGateSheet`. */
export function useAccountGateSheet(): { reason: AccountGateReason | null; close: () => void } {
  const { reason, close } = useAccountGateContext();
  return { reason, close };
}
