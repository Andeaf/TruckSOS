import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Announcement, Conversation, Message } from '@/types/database';
import type { AnnouncementStatus } from '@/types/database';

export type ConversationWithDetails = Conversation & {
  announcement: { location: string; status: AnnouncementStatus; description: string };
  driver: { full_name: string };
  mechanic: { full_name: string };
};

export function useConversations(userId: string | undefined) {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const { data } = await supabase
      .from('conversations')
      .select(
        '*, announcement:announcements!announcement_id(location,status,description), driver:profiles!driver_id(full_name), mechanic:profiles!mechanic_id(full_name)'
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .or(`driver_id.eq.${userId},mechanic_id.eq.${userId}` as any)
      .order('created_at', { ascending: false });
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

  useEffect(() => {
    let active = true;

    (async () => {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (active) {
        setMessages((data as Message[]) ?? []);
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
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  return { messages, loading, addMessage };
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  content: string
): Promise<{ message: Message | null; error: string | null }> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, sender_id: senderId, content } as never)
    .select()
    .single();
  return { message: (data as unknown as Message) ?? null, error: error?.message ?? null };
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

export async function fetchConversationDetails(
  conversationId: string
): Promise<ConversationWithDetails | null> {
  const { data } = await supabase
    .from('conversations')
    .select(
      '*, announcement:announcements!announcement_id(location,status,description), driver:profiles!driver_id(full_name), mechanic:profiles!mechanic_id(full_name)'
    )
    .eq('id', conversationId)
    .single();
  return (data as unknown as ConversationWithDetails) ?? null;
}
