import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';
import { hasChatV14, replyEmbed } from '@/lib/chat-schema';
import { emitReadsChanged, onReadsChanged } from '@/lib/read-events';
import { uploadPhoto } from '@/lib/storage';
import type { PickedImage } from '@/lib/media';
import type { Announcement, Conversation, Message, PublicUser, Role } from '@/types/database';
import type { AnnouncementStatus, MarketListingStatus } from '@/types/database';

/** Participant la conversație — cu rolul REAL (Faza 19: rutarea către profilul public
 * se face pe rolul lui, nu pe rolul privitorului). */
export type ChatParticipant = PublicUser & { role: Role };

export type ConversationWithDetails = Conversation & {
  // null pentru conversații directe (fără anunț)
  announcement: { location: string; status: AnnouncementStatus; description: string } | null;
  /** Faza 19: contextul de market (null pt. conversațiile de depanare/directe SAU
   * dacă anunțul a fost șters — SET NULL, degradează vizual la „directă"). */
  listing: { title: string; status: MarketListingStatus } | null;
  driver: ChatParticipant;
  mechanic: ChatParticipant;
};

/**
 * Faza 19 (Opțiunea C): „celălalt participant" se determină prin ID, NU prin rol —
 * pe market cumpărătorul și vânzătorul pot avea același rol. Pentru toate conversațiile
 * istorice rezultatul e identic cu vechea logică pe roluri (șoferul era mereu pe
 * driver_id), deci refactorul e echivalent-comportamental pe datele existente.
 */
export function otherParticipant(
  conv: ConversationWithDetails,
  myId: string,
): { id: string; profile: ChatParticipant } {
  return conv.driver_id === myId
    ? { id: conv.mechanic_id, profile: conv.mechanic }
    : { id: conv.driver_id, profile: conv.driver };
}

/** Faza 19.4: contextul de anunț atașat unui MESAJ (cardul de deasupra textului). */
export interface MessageListingContext {
  id: string;
  title: string;
  price: number;
  currency: string;
  status: 'active' | 'sold';
}

/** Embed-ul de context pe mesaje — cere migrarea etapa194 (messages.listing_id). */
const MESSAGE_LISTING_EMBED = ', listing:market_listings!listing_id(id,title,price,currency,status)';

/**
 * Contextul de anunț după id — null dacă anunțul nu mai există (șters). Folosit de
 * handlerul Realtime (payload-ul nu aduce embed-uri) și de bannerul „anunț atașat"
 * din compozitor (ecranul are doar listingId din parametrii rutei).
 */
export async function fetchMessageListingContext(
  listingId: string
): Promise<MessageListingContext | null> {
  const { data } = await supabase
    .from('market_listings')
    .select('id,title,price,currency,status')
    .eq('id', listingId)
    .maybeSingle();
  return (data as unknown as MessageListingContext) ?? null;
}

/** Selectul comun al listei/detaliului de conversație (embeds pe ambele sloturi + contexte). */
const CONVERSATION_SELECT =
  '*, announcement:announcements!announcement_id(location,status,description), ' +
  'listing:market_listings!listing_id(title,status), ' +
  'driver:profiles!driver_id(full_name,avatar_path,deleted_at,role), ' +
  'mechanic:profiles!mechanic_id(full_name,avatar_path,deleted_at,role)';

export function useConversations(userId: string | undefined) {
  const [conversations, setConversations] = useState<ConversationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Fără user încă (sesiune în hidratare): nu lăsa `loading` blocat pe true —
    // pe iOS asta ținea insetul de RefreshControl inserat (gol sub antet).
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data: deletions } = await supabase
      .from('conversation_deletions')
      .select('conversation_id')
      .eq('user_id', userId);
    const deletedIds = (deletions ?? []).map((d) => d.conversation_id);

    let query = supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .or(`driver_id.eq.${userId},mechanic_id.eq.${userId}` as never)
      .order('created_at', { ascending: false });

    if (deletedIds.length > 0) {
      query = query.not('id', 'in', `(${deletedIds.join(',')})`) as never;
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
      const v14 = await hasChatV14();
      const { data } = await supabase
        .from('messages')
        .select('*' + (v14 ? replyEmbed('messages') : '') + MESSAGE_LISTING_EMBED)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (active) {
        setMessages((data as unknown as Message[]) ?? []);
        setLoading(false);
      }
    })();

    // Nume UNIC per abonare: supabase.channel() refolosește un canal cu același topic, iar
    // la remount/Fast Refresh cleanup-ul (removeChannel) e asincron — un nume determinist ar
    // returna canalul vechi deja subscribe()-uit, și .on() ar arunca „after subscribe()".
    // (Același motiv pentru care useReadCursor/useUnreadCounts folosesc deja Math.random().)
    const channel = supabase
      .channel(`messages:${conversationId}:${Math.random()}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          if (!active) return;
          const incoming = payload.new as Message & { listing?: MessageListingContext | null };
          // Faza 19.4: payload-ul Realtime nu aduce embed-uri — cardul anunțului
          // se completează cu un fetch scurt (doar la mesajele cu context).
          if (incoming.listing_id) {
            const listing = await fetchMessageListingContext(incoming.listing_id);
            if (!active) return;
            incoming.listing = listing;
          }
          // Deduplicates: own messages added optimistically have the same ID
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
          );
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
  imagePath: string | null = null,
  replyToId: string | null = null,
  listingId: string | null = null
): Promise<{ message: Message | null; error: string | null }> {
  const v14 = await hasChatV14();
  const row: Record<string, unknown> = {
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    image_path: imagePath,
  };
  // reply_to_id doar dacă schema îl are (altfel insert-ul ar eșua pe schema veche).
  if (v14) row.reply_to_id = replyToId;
  // Faza 19.4: contextul de anunț („Sunt interesat" din market) — cardul de deasupra.
  if (listingId) row.listing_id = listingId;
  const { data, error } = await supabase
    .from('messages')
    .insert(row as never)
    // Returnăm și citatul + contextul, ca bula proprie să le afișeze instant (optimist).
    .select('*' + (v14 ? replyEmbed('messages') : '') + MESSAGE_LISTING_EMBED)
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
      .channel(`announcement-status:${announcementId}:${Math.random()}`)
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

/**
 * Cursorul de citire NU se ia din ceasul telefonului: mesajele au `created_at` de pe
 * SERVER, deci cursorul = cel mai nou mesaj AFIȘAT +1ms — `.gt(created_at)` din badge
 * îl exclude, iar comparația strictă `>` a bifelor ✓✓ îl include. Un ceas local rămas
 * în urmă lăsa ultimul mesaj „necitit" pe veci (bug vechi, Android); invers, vechiul
 * `max(Date.now(), ...)` cu un ceas local ÎNAINTE scria un cursor din viitor care
 * marca „citite" mesaje încă neprimite (✓✓ false văzute la testarea Market).
 * Ceasul local rămâne DOAR fallback pentru conversații fără niciun mesaj.
 */
function readCursorValue(newestCreatedAt?: string | null): string {
  if (newestCreatedAt) return new Date(new Date(newestCreatedAt).getTime() + 1).toISOString();
  return new Date().toISOString();
}

export async function markConversationRead(
  conversationId: string,
  newestCreatedAt?: string | null
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  await supabase
    .from('message_reads')
    .upsert(
      { conversation_id: conversationId, user_id: session.user.id, last_read_at: readCursorValue(newestCreatedAt) } as never,
      { onConflict: 'conversation_id,user_id' }
    );
  emitReadsChanged();
}

/**
 * Cursorul de citire al CELUILALT participant (bife ✓✓, doar chat privat, Etapa 14.7).
 * RLS relaxat (faza14_e7) lasă participanții aceleiași conversații să-și vadă reciproc
 * `last_read_at`. Subscripție filtrată pe conversation_id → bifele se actualizează live
 * când celălalt deschide conversația.
 */
export function useReadCursor(conversationId: string, otherUserId: string | undefined): string | null {
  const [cursor, setCursor] = useState<string | null>(null);
  const channelName = useState(() => `read-cursor:${Math.random()}`)[0];

  const fetchCursor = useCallback(async () => {
    if (!otherUserId) {
      setCursor(null);
      return;
    }
    const { data } = await supabase
      .from('message_reads')
      .select('last_read_at')
      .eq('conversation_id', conversationId)
      .eq('user_id', otherUserId)
      .maybeSingle();
    setCursor((data as unknown as { last_read_at: string } | null)?.last_read_at ?? null);
  }, [conversationId, otherUserId]);

  useEffect(() => {
    fetchCursor();
  }, [fetchCursor]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reads',
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => fetchCursor()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, fetchCursor, channelName]);

  return cursor;
}

export function useUnreadCounts(userId: string | undefined): { counts: Record<string, number>; refresh: () => Promise<void> } {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Ids-urile conversațiilor curente, pentru subscripții Realtime FILTRATE.
  // Subscripția nefiltrată pe `messages` nu livra evenimente către destinatar
  // (RLS-ul cu JOIN pe conversations + lipsa filtrului), în timp ce canalul global
  // — filtrat, cu RLS trivial — funcționa (verificat pe device: badge-ul se aprindea
  // doar pentru canal). Filtrul `in.(...)` readuce livrarea pe tiparul care merge.
  const [convIdsKey, setConvIdsKey] = useState('');

  const fetchCounts = useCallback(async () => {
    if (!userId) return;
    const v14 = await hasChatV14();

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
    setConvIdsKey(convs.map((c) => c.id).sort().join(','));
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
          .neq('sender_id', userId);
        // Tombstone-urile (Faza 14) nu se numără — dar doar dacă schema are coloana.
        if (v14) query = query.is('deleted_at', null);
        if (lastRead) query = query.gt('created_at', lastRead);
        const { count } = await query;
        result[id] = count ?? 0;
      })
    );
    setCounts(result);
  }, [userId]);

  useEffect(() => { fetchCounts(); }, [fetchCounts]);

  // Citirile făcute pe ACEST device sting badge-ul imediat — vezi lib/read-events.
  useEffect(() => onReadsChanged(fetchCounts), [fetchCounts]);

  // Plasă de siguranță: evenimentele Realtime ratate cât timp aplicația a stat în
  // fundal nu mai pot fi „prinse" — recalculăm la revenirea în prim-plan.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchCounts();
    });
    return () => sub.remove();
  }, [fetchCounts]);

  useEffect(() => {
    if (!userId) return;
    // Nume UNIC per (RE)abonare, nu per instanță de hook: efectul se re-execută la
    // fiecare schimbare a convIdsKey (cel puțin o dată, '' → ids reale), iar
    // recrearea unui canal cu ACELAȘI topic imediat după removeChannel (teardown
    // asincron) poate întoarce canalul vechi — abonarea moare tăcut și badge-ul
    // nu se mai actualizează live (bulina nu dispărea după citire, pe Android).
    // Același motiv pentru care useMessages/useReadCursor au nume per abonare.
    const channelName = `unread-counts:${Math.random()}`;
    let channel = supabase.channel(channelName);
    if (convIdsKey) {
      const filter = `conversation_id=in.(${convIdsKey})`;
      channel = channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter }, () => {
          fetchCounts();
        })
        // UPDATE = tombstone/editare: recalculăm ca badge-ul să scadă când un necitit e șters.
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, () => {
          fetchCounts();
        });
    }
    channel = channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads', filter: `user_id=eq.${userId}` }, () => {
        fetchCounts();
      })
      // Conversație nouă (ex. „Contactează vânzătorul" din Market): reintră în calcul —
      // filtrul in.(...) de mai sus nu o acoperă până nu refacem lista de ids.
      // Două abonări FILTRATE, câte una per slotul în care putem apărea: abonarea
      // nefiltrată nu livra (vezi nota convIdsKey), iar tabelul trebuie să fie în
      // publicația supabase_realtime (migrarea 20260725 — lipsea, deci handlerul
      // vechi nu primea NICIODATĂ evenimente și bulina nu se aprindea la prima
      // conversație cu cineva).
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations', filter: `driver_id=eq.${userId}` }, () => {
        fetchCounts();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations', filter: `mechanic_id=eq.${userId}` }, () => {
        fetchCounts();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, fetchCounts, convIdsKey]);

  return { counts, refresh: fetchCounts };
}

export async function fetchConversationDetails(
  conversationId: string
): Promise<ConversationWithDetails | null> {
  const { data } = await supabase
    .from('conversations')
    .select(CONVERSATION_SELECT)
    .eq('id', conversationId)
    .single();
  return (data as unknown as ConversationWithDetails) ?? null;
}
