import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { uploadPhoto } from '@/lib/storage';
import type { PickedImage } from '@/lib/media';
import type { Announcement, Conversation, Message, PublicUser } from '@/types/database';
import type { AnnouncementStatus } from '@/types/database';

export type ConversationWithDetails = Conversation & {
  // null pentru conversații directe (fără anunț)
  announcement: { location: string; status: AnnouncementStatus; description: string } | null;
  driver: PublicUser;
  mechanic: PublicUser;
};

export function useConversations(userId: string | undefined) {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);

    const { data: deletions } = await supabase
      .from('conversation_deletions')
      .select('conversation_id')
      .eq('user_id', userId);
    const deletedIds = (deletions ?? []).map((d) => d.conversation_id);

    let query = supabase
      .from('conversations')
      .select(
        '*, announcement:announcements!announcement_id(location,status,description), driver:profiles!driver_id(full_name,avatar_path), mechanic:profiles!mechanic_id(full_name,avatar_path)'
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .or(`driver_id.eq.${userId},mechanic_id.eq.${userId}` as any)
      .order('created_at', { ascending: false });

    if (deletedIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query = query.not('id', 'in', `(${deletedIds.join(',')})`) as any;
    }

    const { data } = await query;
    setConversations((data as unknown as ConversationWithDetails[]) ?? []);
    setLoading(false);
  }, [userId]);

  return { conversations, loading, refresh };
}

export function useMessages(conversationId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);

  // Adds a message only if not already present (deduplicates Realtime vs optimistic)
  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  // Actualizare locală optimistă (tombstone/editare), înainte ca UPDATE-ul Realtime să sosească.
  const patchMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase
        .from('messages')
        .select('*, reply_to:messages!reply_to_id(id,content,image_path,sender_id,deleted_at)')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (active) {
        setMessages((data as unknown as Message[]) ?? []);
        setLoading(false);
      }
    })();

    const channel = supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (active) {
            const incoming = payload.new as Message;
            // Deduplicates: own messages added optimistically have the same ID
            setMessages((prev) =>
              prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
            );
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          if (!active) return;
          const updated = payload.new as Message;
          // Tombstone/editare: înlocuim rândul, păstrând `reply_to` (join-ul nu vine în payload).
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
  }, [conversationId]);

  return { messages, loading, addMessage, patchMessage };
}

/** Șterge un mesaj (tombstone „pentru toți") prin RPC. Doar propriul mesaj (verificat server-side). */
export async function deleteMessage(
  table: 'messages' | 'channel_messages',
  id: string
): Promise<string | null> {
  const { error } = await supabase.rpc('delete_message', { p_table: table, p_id: id } as never);
  return error?.message ?? null;
}

/** Fereastra de editare: 3 min de la trimitere (aceeași valoare ca în RPC-ul edit_message). */
export const EDIT_WINDOW_MS = 3 * 60 * 1000;

/** UI-only: ascunde opțiunea „Editează" după expirare. Serverul reverifică oricum. */
export function withinEditWindow(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < EDIT_WINDOW_MS;
}

/** Editează un mesaj text (fereastră de 3 min, verificată server-side). */
export async function editMessage(
  table: 'messages' | 'channel_messages',
  id: string,
  content: string
): Promise<string | null> {
  const { error } = await supabase.rpc('edit_message', {
    p_table: table,
    p_id: id,
    p_content: content,
  } as never);
  return error?.message ?? null;
}

// Întoarce conversația directă existentă cu mecanicul sau creează una nouă (RPC atomic)
export async function startDirectConversation(
  mechanicId: string
): Promise<{ conversationId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('start_direct_conversation', {
    p_mechanic_id: mechanicId,
  } as never);
  return { conversationId: (data as unknown as string) ?? null, error: error?.message ?? null };
}

export async function deleteConversations(
  conversationIds: string[],
  userId: string
): Promise<string | null> {
  const rows = conversationIds.map((id) => ({ conversation_id: id, user_id: userId }));
  const { error } = await supabase.from('conversation_deletions').insert(rows as never);
  return error?.message ?? null;
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  content: string,
  imagePath: string | null = null
): Promise<{ message: Message | null; error: string | null }> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content,
      image_path: imagePath,
    } as never)
    .select()
    .single();
  return { message: (data as unknown as Message) ?? null, error: error?.message ?? null };
}

/**
 * Trimite o poză ca mesaj (Etapa 9.2.2): comprimă + urcă în `chat/{convId}/`,
 * apoi inserează un mesaj cu `content=''` + `image_path`. O poză = o bulă.
 * Dacă upload-ul eșuează, NU inserăm mesajul (n-ar avea ce afișa).
 */
export async function sendImageMessage(
  conversationId: string,
  senderId: string,
  image: PickedImage
): Promise<{ message: Message | null; error: string | null }> {
  const { path, error } = await uploadPhoto('chat', conversationId, image);
  if (error || !path) {
    console.warn('[chat] upload poză eșuat:', error);
    return { message: null, error: error ?? 'upload_failed' };
  }
  return sendMessage(conversationId, senderId, '', path);
}

export function useAnnouncementStatus(
  announcementId: string,
  initialStatus: AnnouncementStatus
) {
  const [status, setStatus] = useState<AnnouncementStatus>(initialStatus);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (!announcementId) return;
    const channel = supabase
      .channel(`announcement-status:${announcementId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'announcements',
          filter: `id=eq.${announcementId}`,
        },
        (payload) => {
          setStatus((payload.new as Announcement).status);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [announcementId]);

  return status;
}

export async function markConversationRead(conversationId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  await supabase
    .from('message_reads')
    .upsert(
      { conversation_id: conversationId, user_id: session.user.id, last_read_at: new Date().toISOString() } as never,
      { onConflict: 'conversation_id,user_id' }
    );
}

export function useUnreadCounts(userId: string | undefined): { counts: Record<string, number>; refresh: () => Promise<void> } {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const channelName = useState(() => `unread-counts-${Math.random()}`)[0];

  const fetchCounts = useCallback(async () => {
    if (!userId) return;

    // Conversațiile ȘTERSE de utilizator (Faza 5, soft-delete) NU se mai văd în listă,
    // deci nu pot fi deschise → n-ar putea fi marcate ca citite niciodată. Dacă le-am
    // număra, badge-ul ar arăta mesaje necitite imposibil de eliminat.
    const { data: deletions } = await supabase
      .from('conversation_deletions')
      .select('conversation_id')
      .eq('user_id', userId);
    const deletedIds = new Set(
      ((deletions ?? []) as unknown as { conversation_id: string }[]).map((d) => d.conversation_id),
    );

    const { data: allConvs } = await supabase
      .from('conversations')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select('id').or(`driver_id.eq.${userId},mechanic_id.eq.${userId}` as any);
    const convs = ((allConvs ?? []) as unknown as { id: string }[]).filter(
      (c) => !deletedIds.has(c.id),
    );
    if (convs.length === 0) { setCounts({}); return; }

    const { data: reads } = await supabase
      .from('message_reads')
      .select('conversation_id,last_read_at')
      .eq('user_id', userId);
    const readMap: Record<string, string> = {};
    (reads ?? []).forEach((r) => { readMap[r.conversation_id] = r.last_read_at; });

    const result: Record<string, number> = {};
    await Promise.all(
      convs.map(async ({ id }) => {
        // Fără rând în `message_reads` = conversația n-a fost deschisă NICIODATĂ,
        // deci TOATE mesajele celuilalt sunt necitite (nu zero — cazul unei
        // conversații abia create, unde badge-ul chiar trebuie să apară).
        const lastRead = readMap[id];
        let query = supabase
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', id)
          .neq('sender_id', userId)
          // Tombstone-urile (Faza 14) nu se numără — altfel badge-ul rămâne „agățat"
          // pe un mesaj necitit șters de expeditor.
          .is('deleted_at', null);
        if (lastRead) query = query.gt('created_at', lastRead);
        const { count } = await query;
        result[id] = count ?? 0;
      })
    );
    setCounts(result);
  }, [userId]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
        fetchCounts();
      })
      // UPDATE = tombstone/editare: recalculăm ca badge-ul să scadă când un necitit e șters.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, () => {
        fetchCounts();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads' }, () => {
        fetchCounts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchCounts, channelName]);

  return { counts, refresh: fetchCounts };
}

export async function fetchConversationDetails(
  conversationId: string
): Promise<ConversationWithDetails | null> {
  const { data } = await supabase
    .from('conversations')
    .select(
      '*, announcement:announcements!announcement_id(location,status,description), driver:profiles!driver_id(full_name,avatar_path), mechanic:profiles!mechanic_id(full_name,avatar_path)'
    )
    .eq('id', conversationId)
    .single();
  return (data as unknown as ConversationWithDetails) ?? null;
}
