import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';
import { hasChatV14, replyEmbed } from '@/lib/chat-schema';
import { emitReadsChanged, onReadsChanged } from '@/lib/read-events';
import { useBlocked } from '@/hooks/use-blocked';
import { uploadPhoto } from '@/lib/storage';
import type { PickedImage } from '@/lib/media';
import type { Channel, ChannelMessage, PublicUser, Role } from '@/types/database';

const PAGE_SIZE = 50;

export type ChannelMessageWithSender = ChannelMessage & {
  sender: PublicUser & { role: Role };
};

export function useChannels() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('channels')
      .select('*')
      .order('created_at', { ascending: true });
    setChannels((data as Channel[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { channels, loading, refresh };
}

export async function fetchChannel(channelId: string): Promise<Channel | null> {
  const { data } = await supabase.from('channels').select('*').eq('id', channelId).single();
  return (data as unknown as Channel) ?? null;
}

export function useChannelMessages(channelId: string) {
  // Faza 18: mesajele utilizatorilor pe care I-AM blocat se ascund CLIENT-SIDE
  // (confort, nu securitate — mesajele globale sunt publice prin definiție).
  // Filtrăm doar la afișare: starea internă și cursorul de paginare rămân pe
  // lista brută, ca `loadOlder` să nu sară pagini.
  const { blockedIds } = useBlocked();
  const [messages, setMessages] = useState<ChannelMessageWithSender[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const messagesRef = useRef<ChannelMessageWithSender[]>([]);
  messagesRef.current = messages;

  // Adds a message only if not already present (deduplicates Realtime vs optimistic)
  const addMessage = useCallback((msg: ChannelMessageWithSender) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  // Actualizare locală optimistă (tombstone/editare), înainte de UPDATE-ul Realtime.
  const patchMessage = useCallback((id: string, patch: Partial<ChannelMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setHasMore(true);
    setMessages([]);

    (async () => {
      const v14 = await hasChatV14();
      const { data } = await supabase
        .from('channel_messages')
        .select(
          '*, sender:profiles!sender_id(full_name,role,avatar_path,deleted_at)' +
            (v14 ? replyEmbed('channel_messages') : '')
        )
        .eq('channel_id', channelId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (!active) return;
      const page = ((data as unknown as ChannelMessageWithSender[]) ?? []).slice().reverse();
      setMessages(page);
      setHasMore(page.length === PAGE_SIZE);
      setLoading(false);
    })();

    // Nume UNIC per abonare (vezi use-chat.ts): altfel remount/Fast Refresh refolosește un
    // canal deja subscribe()-uit și .on() aruncă „after subscribe()".
    const channel = supabase
      .channel(`channel-messages:${channelId}:${Math.random()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'channel_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        async (payload) => {
          if (!active) return;
          const incoming = payload.new as ChannelMessage;
          // Own messages are already added optimistically by sendChannelMessage (same id) —
          // skip the extra profile fetch in that case.
          if (messagesRef.current.some((m) => m.id === incoming.id)) return;
          const { data: sender } = await supabase
            .from('profiles')
            .select('full_name,role,avatar_path,deleted_at')
            .eq('id', incoming.sender_id)
            .single();
          if (!active) return;
          addMessage({
            ...incoming,
            sender: (sender as (PublicUser & { role: Role }) | null) ?? {
              full_name: '',
              role: 'driver',
              avatar_path: null,
              deleted_at: null,
            },
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'channel_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          if (!active) return;
          const updated = payload.new as ChannelMessage;
          // Păstrăm `sender` și `reply_to` (nu vin în payload-ul de UPDATE), suprascriem restul.
          setMessages((prev) =>
            prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
          );
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [channelId, addMessage]);

  const loadOlder = useCallback(async () => {
    if (loadingMore || !hasMore || messagesRef.current.length === 0) return;
    setLoadingMore(true);
    const oldest = messagesRef.current[0].created_at;
    const v14 = await hasChatV14();
    const { data } = await supabase
      .from('channel_messages')
      .select(
        '*, sender:profiles!sender_id(full_name,role,avatar_path,deleted_at)' +
          (v14 ? replyEmbed('channel_messages') : '')
      )
      .eq('channel_id', channelId)
      .lt('created_at', oldest)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    const page = ((data as unknown as ChannelMessageWithSender[]) ?? []).slice().reverse();
    setMessages((prev) => [...page, ...prev]);
    setHasMore(page.length === PAGE_SIZE);
    setLoadingMore(false);
  }, [channelId, hasMore, loadingMore]);

  const visibleMessages = useMemo(
    () => messages.filter((m) => !blockedIds.has(m.sender_id)),
    [messages, blockedIds]
  );

  return { messages: visibleMessages, loading, loadingMore, hasMore, loadOlder, addMessage, patchMessage };
}

export async function sendChannelMessage(
  channelId: string,
  senderId: string,
  content: string,
  imagePath: string | null = null,
  replyToId: string | null = null
): Promise<{ message: ChannelMessageWithSender | null; error: string | null }> {
  const v14 = await hasChatV14();
  const row: Record<string, unknown> = {
    channel_id: channelId,
    sender_id: senderId,
    content,
    image_path: imagePath,
  };
  if (v14) row.reply_to_id = replyToId;
  const { data, error } = await supabase
    .from('channel_messages')
    .insert(row as never)
    .select(
      '*, sender:profiles!sender_id(full_name,role,avatar_path,deleted_at)' +
        (v14 ? replyEmbed('channel_messages') : '')
    )
    .single();
  return { message: (data as unknown as ChannelMessageWithSender) ?? null, error: error?.message ?? null };
}

/**
 * Poză în canal (Etapa 9.2.4) — simetric cu `sendImageMessage` din chatul privat:
 * comprimă + urcă în `channel/{channelId}/`, apoi inserează mesajul-imagine.
 */
export async function sendChannelImageMessage(
  channelId: string,
  senderId: string,
  image: PickedImage
): Promise<{ message: ChannelMessageWithSender | null; error: string | null }> {
  const { path, error } = await uploadPhoto('channel', channelId, image);
  if (error || !path) {
    console.warn('[channel] upload poză eșuat:', error);
    return { message: null, error: error ?? 'upload_failed' };
  }
  return sendChannelMessage(channelId, senderId, '', path);
}

export async function markChannelRead(
  channelId: string,
  newestCreatedAt?: string | null
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user) return;
  // Ceasul telefonului poate fi în urma serverului → cursorul acoperă explicit cel
  // mai nou mesaj afișat (+1ms), altfel badge-ul îl număra „necitit" pe veci.
  // AICI păstrăm intenționat și Date.now() (spre deosebire de markConversationRead,
  // devenit strict server-side): lista canalului ASCUNDE mesajele utilizatorilor
  // blocați, deci „cel mai nou afișat" poate fi mai vechi decât ultimul mesaj real —
  // fără componenta de ceas, un mesaj de la un blocat ar ține badge-ul aprins fără
  // nicio cale de a-l stinge. Canalul nu are bife ✓✓, deci un cursor ușor „din
  // viitor" nu produce citiri false vizibile altcuiva.
  const newest = newestCreatedAt ? new Date(newestCreatedAt).getTime() + 1 : 0;
  await supabase.from('channel_reads').upsert(
    {
      channel_id: channelId,
      user_id: session.user.id,
      last_read_at: new Date(Math.max(Date.now(), newest)).toISOString(),
    } as never,
    { onConflict: 'channel_id,user_id' }
  );
  emitReadsChanged();
}

// Separat de useUnreadCounts (chat privat): abonare Realtime FILTRATĂ pe channel_id,
// nu recompute global la orice mesaj din aplicație — vezi PLAN_CHAT_GLOBAL.md secțiunea 5.
export function useChannelUnreadCount(userId: string | undefined, channelId: string | undefined) {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    if (!userId || !channelId) {
      setCount(0);
      return;
    }
    const { data: read } = await supabase
      .from('channel_reads')
      .select('last_read_at')
      .eq('channel_id', channelId)
      .eq('user_id', userId)
      .maybeSingle();

    let query = supabase
      .from('channel_messages')
      .select('id', { count: 'exact', head: true })
      .eq('channel_id', channelId)
      .neq('sender_id', userId);
    // Tombstone-urile (Faza 14) nu se numără — doar dacă schema are coloana.
    if (await hasChatV14()) query = query.is('deleted_at', null);
    if (read?.last_read_at) query = query.gt('created_at', read.last_read_at);

    const { count: c } = await query;
    setCount(c ?? 0);
  }, [userId, channelId]);

  useEffect(() => {
    fetchCount();
  }, [fetchCount]);

  // Citirile făcute pe ACEST device sting badge-ul imediat — vezi lib/read-events.
  useEffect(() => onReadsChanged(fetchCount), [fetchCount]);

  // Plasă de siguranță (simetric cu useUnreadCounts): evenimentele ratate în fundal
  // nu mai pot fi „prinse" — recalculăm la revenirea în prim-plan.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchCount();
    });
    return () => sub.remove();
  }, [fetchCount]);

  useEffect(() => {
    if (!channelId) return;
    // Nume unic per (RE)abonare, nu per instanță: hook-ul rulează simultan pe badge-ul
    // de tab ȘI pe ChannelCard, iar efectul se poate re-executa — un topic refolosit
    // imediat după removeChannel ar întoarce canalul vechi și abonarea ar muri tăcut.
    const channelName = `channel-unread:${Math.random()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'channel_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        () => fetchCount()
      )
      // UPDATE = tombstone: recalculăm ca badge-ul să scadă la ștergerea unui necitit.
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'channel_messages',
          filter: `channel_id=eq.${channelId}`,
        },
        () => fetchCount()
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'channel_reads',
          filter: `channel_id=eq.${channelId}`,
        },
        () => fetchCount()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelId, fetchCount]);

  return { count, refresh: fetchCount };
}
