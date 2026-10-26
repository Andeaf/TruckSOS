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
  | 'viewAnnouncement'
  | 'viewProfile'
  | 'viewListing'
  | 'generic';

interface AccountGateContextValue {
  /**
   * `link` (opțional, 25 oct 2026): ecranul pe care omul l-a cerut (de ex. detaliul unui
   * anunț) — după cont revine ACOLO, nu pe lista de unde a apăsat (foaia îl salvează ca
   * link amânat, cu grupul `(guest)`, tradus apoi de `resolvePendingLink`).
   */
  requireAccount: (reason: AccountGateReason, link?: string) => boolean;
  /** Pentru foaie: motivul afișat acum (`null` = închisă) și ecranul cerut. */
  reason: AccountGateReason | null;
  link: string | null;
  close: () => void;
}

const AccountGateContext = createContext<AccountGateContextValue | null>(null);

export function AccountGateProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [reason, setReason] = useState<AccountGateReason | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const hasSession = !!session;

  const requireAccount = useCallback(
    (next: AccountGateReason, nextLink?: string) => {
      if (hasSession) return true;
      setReason(next);
      setLink(nextLink ?? null);
      return false;
    },
    [hasSession]
  );
  const close = useCallback(() => setReason(null), []);

  const value = useMemo(
    // Odată cu sesiunea (login din altă parte) foaia nu mai are ce căuta pe ecran.
    () => ({ requireAccount, reason: hasSession ? null : reason, link, close }),
    [requireAccount, reason, link, hasSession, close]
  );

  return <AccountGateContext.Provider value={value}>{children}</AccountGateContext.Provider>;
}

function useAccountGateContext(): AccountGateContextValue {
  const ctx = useContext(AccountGateContext);
  if (!ctx) throw new Error('useAccountGate trebuie folosit în interiorul AccountGateProvider');
  return ctx;
}

export function useAccountGate(): {
  requireAccount: (reason: AccountGateReason, link?: string) => boolean;
} {
  const { requireAccount } = useAccountGateContext();
  return { requireAccount };
}

/** Doar pentru `AccountGateSheet`. */
export function useAccountGateSheet(): {
  reason: AccountGateReason | null;
  link: string | null;
  close: () => void;
} {
  const { reason, link, close } = useAccountGateContext();
  return { reason, link, close };
}
