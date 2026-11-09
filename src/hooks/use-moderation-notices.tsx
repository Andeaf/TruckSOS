import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/use-auth';
import type { Tables } from '@/types/database-overrides';

/**
 * Notificările de moderare ale utilizatorului (PLAN_1.1_FIX 7.9; DSA art. 17): motivarea
 * acțiunilor unui moderator asupra conținutului propriu, din view-ul `public.moderation_notices`
 * (faza 3.3, security_invoker; RLS întoarce DOAR rândurile proprii, singura coloană scriibilă
 * e `read_at`).
 *
 * Hook simplu, fără provider: Setările îl folosesc pentru numărul de necitite, ecranul
 * „Notificări de moderare" pentru listă. Fiecare instanță face UN SELECT la montare (și la
 * schimbarea contului). Cât timp migrarea 3.3 nu e pe server, view-ul lipsește (PGRST205 /
 * 42P01): orice eroare = listă goală, fără alertă și fără reîncercare.
 */

export type ModerationNotice = Pick<
  Tables<'moderation_notices'>,
  'id' | 'kind' | 'reason' | 'target_type' | 'target_id' | 'created_at' | 'read_at'
>;

const COLUMNS = 'id, kind, reason, target_type, target_id, created_at, read_at';

// Avertismentul din dev apare o singură dată pe sesiunea aplicației, nu la fiecare montare.
let warned = false;
function warnOnce(op: string, error: { code?: string; message?: string }) {
  if (!__DEV__ || warned) return;
  warned = true;
  console.warn('[moderation_notices]', op, error.code, error.message);
}

// Instanțele nu împart starea (fără provider): după „marcate ca citite" pe ecranul listei,
// Setările (rămase montate dedesubt în stivă) își sting bulina local, fără cerere nouă.
const readListeners = new Set<(readAt: string, ids: readonly string[]) => void>();

export function useModerationNotices() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [rows, setRows] = useState<ModerationNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  // Contul curent, citit la sosirea răspunsului (efectul rulează înaintea celui care apelează refresh — ordinea declarării).
  const userIdRef = useRef(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }
    const requestedFor = userId;
    const { data, error } = await supabase
      .from('moderation_notices')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(100);
    // Răspuns întârziat pentru un cont anterior (logout → login alt cont cât cererea era în zbor) → ignorat.
    if (!mounted.current || userIdRef.current !== requestedFor) return;
    if (error) {
      warnOnce('select', error);
      setRows([]);
    } else {
      setRows(data ?? []);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const listener = (readAt: string, ids: readonly string[]) => {
      const set = new Set(ids);
      setRows((prev) =>
        prev.some((r) => r.read_at == null && set.has(r.id))
          ? prev.map((r) => (r.read_at == null && set.has(r.id) ? { ...r, read_at: readAt } : r))
          : prev
      );
    };
    readListeners.add(listener);
    return () => {
      readListeners.delete(listener);
    };
  }, []);

  /**
   * Marchează ca citite notificările cu id-urile date (cele pe care utilizatorul le-a văzut pe ecran; RLS: doar ale
   * tale). Nu „toate necitite”: un notice sosit între SELECT și UPDATE ar fi fost marcat fără să fie văzut (review 9 nov).
   */
  const markAllRead = useCallback(
    async (ids: readonly string[]) => {
      if (!userId || ids.length === 0) return;
      const readAt = new Date().toISOString();
      const { error } = await supabase
        .from('moderation_notices')
        .update({ read_at: readAt })
        .in('id', [...ids])
        .is('read_at', null);
      if (error) {
        warnOnce('update', error);
        return;
      }
      readListeners.forEach((listener) => listener(readAt, ids));
    },
    [userId]
  );

  const unreadCount = rows.reduce((n, r) => (r.read_at == null ? n + 1 : n), 0);

  return { rows, unreadCount, loading, refresh, markAllRead };
}
