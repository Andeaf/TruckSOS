import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { registerPushToken } from '@/lib/push';

/**
 * Preferința de notificări pe canalul global (5 aug): OPT-IN per utilizator × canal
 * (tabela `channel_push_prefs`; fără rând = OPRIT — default-ul anti-spam din Faza 12
 * rămâne neschimbat). Triggerul `on_channel_message_notify` citește aceeași tabelă,
 * deci comutatorul are efect imediat, fără restart.
 */
export function useChannelPushPref(
  channelId: string | undefined,
  userId: string | undefined
) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    if (!channelId || !userId) {
      setLoading(false);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('channel_push_prefs')
        .select('enabled')
        .eq('channel_id', channelId)
        .eq('user_id', userId)
        .maybeSingle();
      if (!active) return;
      setEnabled(!!(data as { enabled: boolean } | null)?.enabled);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [channelId, userId]);

  const toggle = useCallback(
    async (next: boolean) => {
      if (!channelId || !userId) return;
      setEnabled(next);
      const { error } = await supabase.from('channel_push_prefs').upsert(
        {
          user_id: userId,
          channel_id: channelId,
          enabled: next,
          updated_at: new Date().toISOString(),
        } as never,
        { onConflict: 'user_id,channel_id' }
      );
      if (error) {
        setEnabled(!next);
        return;
      }
      // Pornirea notificărilor repară și un token lipsă (permisiunea putea fi
      // acordată după login) — același gest ca la comutatorul global din Setări.
      if (next) void registerPushToken(userId);
    },
    [channelId, userId]
  );

  return { enabled, loading, toggle };
}
