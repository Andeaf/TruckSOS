import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { translateDbError } from '@/lib/db-errors';
import { supabase } from '@/lib/supabase';
import {
  fetchReplyEmbed,
  replyEmbed,
  type MessageMention,
  type ReplyEmbedRow,
} from '@/lib/chat-schema';
import { emitReadsChanged, onReadsChanged } from '@/lib/read-events';
import { dismissThreadNotifications } from '@/lib/push';
import { uploadFile, uploadPhoto, type PickedFile } from '@/lib/storage';
import type { PickedImage } from '@/lib/media';
import type {
  Announcement,
  AnnouncementStatus,
  Conversation,
  MarketListingStatus,
  Message,
  PublicUser,
  Role,
} from '@/types/database';

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

/** Faza 19.4: contextul de anunț atașat unui MESAJ (cardul de deasupra textului).
 * 26 iul (carduri detaliate): + categorie, descriere și pozele (cover = poziția minimă). */
export interface MessageListingContext {
  id: string;
  title: string;
  price: number;
  currency: string;
  status: 'active' | 'sold';
  category?: string | null;
  description?: string | null;
  market_listing_photos?: { storage_path: string; position: number }[];
}

/** Faza 19.5: utilizatorul recomandat atașat unui mesaj (card în bulă + banner
 * compozitor). Din 19.6 poate fi mecanic SAU transportator — rolul decide eticheta
 * bannerului și rutarea cardului; numele tipului rămâne istoric. */
export interface MessageMechanicContext {
  id: string;
  full_name: string;
  avatar_path: string | null;
  deleted_at: string | null;
  role: Role;
  rating_avg: number;
  rating_count: number;
  /** 26 iul (carduri detaliate): contextul profesional, direct pe card. */
  specialization?: string | null;
  activity_zone?: string | null;
}

/** Faza 19.6: anunțul de depanare distribuit pe un mesaj (share → card în bulă). */
export interface MessageAnnouncementContext {
  id: string;
  location: string;
  status: AnnouncementStatus;
  /** 26 iul (carduri detaliate): fragmentul de descriere de pe card. */
  description?: string | null;
}

/** Embed-ul de context pe mesaje — cere migrarea etapa194 (messages.listing_id). */
const MESSAGE_LISTING_EMBED =
  ', listing:market_listings!listing_id(id,title,price,currency,status,category,description,market_listing_photos(storage_path,position))';
/** Embed-ul mecanicului recomandat — cere migrarea faza195 (recommended_mechanic_id). */
const MESSAGE_MECHANIC_EMBED =
  ', mechanic:profiles!recommended_mechanic_id(id,full_name,avatar_path,deleted_at,role,rating_avg,rating_count,specialization,activity_zone)';
/** Embed-ul anunțului de depanare distribuit — cere migrarea faza196 (announcement_id). */
const MESSAGE_ANNOUNCEMENT_EMBED =
  ', announcement:announcements!announcement_id(id,location,status,description)';
/** Toate contextele atașabile unui mesaj (19.4 + 19.5 + 19.6), într-un singur sufix. */
const MESSAGE_ATTACH_EMBEDS =
  MESSAGE_LISTING_EMBED + MESSAGE_MECHANIC_EMBED + MESSAGE_ANNOUNCEMENT_EMBED;

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
    .select('id,title,price,currency,status,category,description,market_listing_photos(storage_path,position)')
    .eq('id', listingId)
    .maybeSingle();
  return (data as unknown as MessageListingContext) ?? null;
}

/** Contextul de mecanic recomandat după id — simetric cu fetchMessageListingContext. */
export async function fetchMessageMechanicContext(
  mechanicId: string
): Promise<MessageMechanicContext | null> {
  const { data } = await supabase
    .from('profiles')
    .select('id,full_name,avatar_path,deleted_at,role,rating_avg,rating_count,specialization,activity_zone')
    .eq('id', mechanicId)
    .maybeSingle();
  return (data as MessageMechanicContext | null) ?? null;
}

/** Contextul de anunț de depanare după id — null și când RLS nu-l lasă vizibil
 * (ex. anunțul altui șofer, văzut de un șofer): cardul pur și simplu nu apare. */
export async function fetchMessageAnnouncementContext(
  announcementId: string
): Promise<MessageAnnouncementContext | null> {
  const { data } = await supabase
    .from('announcements')
    .select('id,location,status,description')
    .eq('id', announcementId)
    .maybeSingle();
  return (data as MessageAnnouncementContext | null) ?? null;
}

/** Ultima activitate a conversației: ultimul mesaj (migrarea 20260811) sau, pe schema
 * veche / fără mesaje, crearea. Sortarea listei ȘI ora de pe card folosesc același reper. */
export function conversationActivityAt(conv: Conversation): string {
  return conv.last_message_at ?? conv.created_at;
}

/**
 * Catch-up după fundal (10 sept 2026). Bug raportat: tap pe notificarea unui mesaj
 * foarte recent → ecranul de chat (deja montat, aplicația stătuse în fundal) NU
 * arăta mesajul până la ieșire + reintrare. Cauza: în fundal sistemul închide
 * websocket-ul Realtime; la revenire supabase-js se reconectează și re-abonează,
 * dar evenimentele din intervalul mort sunt PIERDUTE (nu există replay) — exact
 * nota din useUnreadCounts. Bulina se recalcula prin AppState, lista nu.
 *
 * Remediul: la revenirea în prim-plan ȘI la fiecare RE-abonare Realtime, aducem
 * din nou tot ce e mai nou decât al N-lea mesaj cunoscut de la coadă (fereastra
 * de suprapunere prinde și tombstone-urile/editările ratate pe ultimele mesaje)
 * și îmbinăm în listă după id.
 */
export const CATCH_UP_OVERLAP = 20;
/** Plafonul unui catch-up cu cutoff (cel mai nou primul); comun chatului privat și canalului. */
export const CATCH_UP_LIMIT = 200;
/** Pagina de mesaje (încărcarea inițială și „mai vechi”), comună chatului privat și canalului. */
export const PAGE_SIZE = 50;

/**
 * Îmbină rândurile aduse de un catch-up în lista curentă: cele cunoscute se
 * actualizează dacă s-au schimbat (tombstone/editare ratate), cele noi se adaugă;
 * ordinea rămâne cronologică. Întoarce ACEEAȘI referință dacă nimic nu s-a
 * schimbat — fără re-render degeaba la fiecare revenire în aplicație.
 */
export function mergeMessages<
  T extends {
    id: string;
    created_at: string;
    content: string;
    deleted_at?: string | null;
    edited_at?: string | null;
  },
>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const index = new Map(prev.map((m, i) => [m.id, i] as const));
  let next: T[] | null = null;
  for (const row of incoming) {
    const at = index.get(row.id);
    if (at === undefined) {
      next ??= prev.slice();
      next.push(row);
      continue;
    }
    const old = prev[at];
    if (
      old.content === row.content &&
      (old.deleted_at ?? null) === (row.deleted_at ?? null) &&
      (old.edited_at ?? null) === (row.edited_at ?? null)
    ) {
      continue;
    }
    next ??= prev.slice();
    next[at] = { ...old, ...row };
  }
  if (!next) return prev;
  next.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  return next;
}

/**
 * Rulează `catchUp` la revenirea aplicației în prim-plan, cu o pauză scurtă
 * (rețeaua și tokenul se reașază după fundal) și o reîncercare dacă a picat
 * (întoarce false). Comun chatului privat și canalului.
 */
export function useCatchUpOnResume(catchUp: () => Promise<boolean>) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = async (attempt: number) => {
      const ok = await catchUp();
      if (!ok && attempt < 2) timer = setTimeout(() => void run(attempt + 1), 2500);
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void run(0), 300);
    });
    return () => {
      sub.remove();
      if (timer) clearTimeout(timer);
    };
  }, [catchUp]);
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
      .eq('user_id', userId)
      .limit(500);
    const deletedIds = (deletions ?? []).map((d) => d.conversation_id);

    let query = supabase
      .from('conversations')
      .select(CONVERSATION_SELECT)
      .or(`driver_id.eq.${userId},mechanic_id.eq.${userId}` as never)
      .order('created_at', { ascending: false })
      .limit(200);

    if (deletedIds.length > 0) {
      query = query.not('id', 'in', `(${deletedIds.join(',')})`) as never;
    }

    const { data } = await query;
    const rows = (data as unknown as ConversationWithDetails[]) ?? [];
    // Sortare PE CLIENT după ultima activitate, nu ORDER BY last_message_at pe server:
    // coloana există abia după migrarea 20260811, iar un ORDER BY pe o coloană lipsă
    // ar goli lista. Fallback-ul din conversationActivityAt ține sortarea corectă
    // (după creare) și pe schema veche.
    rows.sort(
      (a, b) =>
        new Date(conversationActivityAt(b)).getTime() -
        new Date(conversationActivityAt(a)).getTime()
    );
    setConversations(rows);
    setLoading(false);
  }, [userId]);

  return { conversations, loading, refresh };
}

/** Mesajul de chat privat cu embed-urile hidratate (payload-ul Realtime nu le aduce). */
type IncomingMessage = Message & {
  reply_to?: ReplyEmbedRow | null;
  listing?: MessageListingContext | null;
  mechanic?: MessageMechanicContext | null;
  announcement?: MessageAnnouncementContext | null;
};

/**
 * Mesajele unei conversații private, paginate ca în canal (faza 5): ultimele PAGE_SIZE la
 * deschidere, „mai vechi” cu `loadOlder` (cursor pe `created_at` al celui mai vechi mesaj
 * încărcat). Până la 1.1 se încărcau ultimele 500, fără „mai vechi”.
 */
export function useMessages(conversationId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  // Catch-up-ul are sens doar după încărcarea inițială (altfel ar dubla-o).
  const loadedRef = useRef(false);
  // Gardă sincronă pentru „mai vechi”: onEndReached poate veni de două ori înainte ca
  // starea `loadingMore` să ajungă în render.
  const loadingMoreRef = useRef(false);
  // Conversația curentă: ecranul e refolosit între conversații, iar un răspuns întârziat
  // (pagină mai veche) nu are voie să ajungă în lista altei conversații.
  const conversationRef = useRef(conversationId);
  conversationRef.current = conversationId;

  // Vezi CATCH_UP_OVERLAP: readuce ce e mai nou decât al 20-lea mesaj de la coadă. Cel mai
  // nou primul + plafon (ca în canal), ca la o pauză foarte lungă să nu pierdem tocmai
  // ultimele mesaje (dacă plafonul se atinge, poate rămâne o gaură în mijloc — acceptat).
  const catchUp = useCallback(async (): Promise<boolean> => {
    if (!loadedRef.current) return true;
    const known = messagesRef.current;
    const cutoff =
      known.length > 0 ? known[Math.max(0, known.length - CATCH_UP_OVERLAP)].created_at : null;
    let query = supabase
      .from('messages')
      .select('*' + replyEmbed() + MESSAGE_ATTACH_EMBEDS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(cutoff ? CATCH_UP_LIMIT : PAGE_SIZE);
    if (cutoff) query = query.gte('created_at', cutoff);
    const { data, error } = await query;
    if (conversationRef.current !== conversationId) return true;
    if (error || !data || !loadedRef.current) return false;
    const rows = (data as unknown as Message[]).slice().reverse();
    setMessages((prev) => mergeMessages(prev, rows));
    // Lista era goală (ex. încărcarea inițială picase pe rețea slabă): catch-up-ul a adus
    // ultima pagină, deci „mai vechi” trebuie să redevină posibil.
    if (!cutoff) setHasMore(rows.length === PAGE_SIZE);
    return true;
  }, [conversationId]);

  useCatchUpOnResume(catchUp);

  // Adaugă un mesaj; la id duplicat ÎMBINĂ rândurile în loc să-l ignore pe al doilea.
  // Cursa Realtime vs. optimist: dacă evenimentul Realtime (rând brut) sosea înaintea
  // răspunsului la INSERT, varianta completă (cu embed-uri) venea a doua și era
  // aruncată — propriul reply rămânea pe „Mesaj indisponibil".
  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      const at = prev.findIndex((m) => m.id === msg.id);
      if (at === -1) return [...prev, msg];
      const next = prev.slice();
      next[at] = { ...next[at], ...msg };
      return next;
    });
  }, []);

  // Actualizare locală optimistă (tombstone/editare), înainte ca UPDATE-ul Realtime să sosească.
  const patchMessage = useCallback((id: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  useEffect(() => {
    let active = true;
    // Ecranul e refolosit între conversații: pornim de la zero (lista, paginarea).
    setLoading(true);
    setHasMore(true);
    setLoadingMore(false);
    loadingMoreRef.current = false;
    setMessages([]);

    (async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*' + replyEmbed() + MESSAGE_ATTACH_EMBEDS)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (!active) return;
      // Ultima pagină, adusă descrescător: ecranul o vrea cronologic.
      const page = ((data as unknown as Message[]) ?? []).slice().reverse();
      // Îmbinare, nu înlocuire: un mesaj trimis sau sosit live în timpul încărcării rămâne.
      setMessages((prev) => mergeMessages(prev, page));
      // O eroare (rețea slabă) nu înseamnă „nu mai există mesaje vechi”: catch-up-ul de la
      // revenire / re-abonare umple lista și reface `hasMore`.
      if (!error) setHasMore(page.length === PAGE_SIZE);
      setLoading(false);
      loadedRef.current = true;
    })();

    // Punctele de intrare pentru evenimentele de mesaj: primesc DOAR rândul, nu payload-ul
    // postgres_changes. Varianta A (broadcast) va chema aceleași funcții.
    const handleIncomingMessage = async (incoming: IncomingMessage) => {
      if (!active) return;
      // Faza 19.4/19.5/19.6: payload-ul Realtime nu aduce embed-uri — cardurile
      // de context se completează cu fetch-uri scurte (doar la mesajele cu context).
      if (incoming.listing_id) {
        const listing = await fetchMessageListingContext(incoming.listing_id);
        if (!active) return;
        incoming.listing = listing;
      }
      if (incoming.recommended_mechanic_id) {
        const mechanic = await fetchMessageMechanicContext(incoming.recommended_mechanic_id);
        if (!active) return;
        incoming.mechanic = mechanic;
      }
      if (incoming.announcement_id) {
        const announcement = await fetchMessageAnnouncementContext(incoming.announcement_id);
        if (!active) return;
        incoming.announcement = announcement;
      }
      // Faza 14: nici citatul nu vine în payload — fără hidratare, reply-urile
      // primite live afișau „Mesaj indisponibil" deși originalul există.
      if (incoming.reply_to_id) {
        const quoted = await fetchReplyEmbed('messages', incoming.reply_to_id);
        if (!active) return;
        incoming.reply_to = quoted;
      }
      // Deduplicates: own messages added optimistically have the same ID
      setMessages((prev) =>
        prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
      );
    };

    // Varianta A (broadcast) va chema aceeași funcție.
    const handleMessageUpdated = (updated: Message) => {
      if (!active) return;
      // Tombstone/editare: înlocuim rândul, păstrând `reply_to` (join-ul nu vine în payload).
      setMessages((prev) =>
        prev.map((m) => (m.id === updated.id ? { ...m, ...updated } : m))
      );
    };

    // Nume UNIC per abonare: supabase.channel() refolosește un canal cu același topic, iar
    // la remount/Fast Refresh cleanup-ul (removeChannel) e asincron — un nume determinist ar
    // returna canalul vechi deja subscribe()-uit, și .on() ar arunca „after subscribe()".
    // (Același motiv pentru care useReadCursor/useUnreadCounts folosesc deja Math.random().)
    // Prima abonare nu are ce recupera (încărcarea inițială e în curs); RE-abonările
    // (după reconectarea socket-ului) recuperează ce s-a pierdut între timp.
    let subscribedOnce = false;
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
        (payload) => void handleIncomingMessage(payload.new as IncomingMessage)
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => handleMessageUpdated(payload.new as Message)
      )
      .subscribe((status) => {
        if (!active || String(status) !== 'SUBSCRIBED') return;
        if (subscribedOnce) void catchUp();
        subscribedOnce = true;
      });

    return () => {
      active = false;
      loadedRef.current = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId, catchUp]);

  // „Mai vechi” (derulare în sus), ca în canal: pagina dinaintea celui mai vechi mesaj
  // încărcat. O eroare lasă `hasMore` neschimbat (următoarea derulare reîncearcă).
  const loadOlder = useCallback(async () => {
    if (
      loadingMoreRef.current ||
      !hasMore ||
      !loadedRef.current ||
      messagesRef.current.length === 0
    ) {
      return;
    }
    const requestedFor = conversationId;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const oldest = messagesRef.current[0].created_at;
    const { data, error } = await supabase
      .from('messages')
      .select('*' + replyEmbed() + MESSAGE_ATTACH_EMBEDS)
      .eq('conversation_id', requestedFor)
      .lt('created_at', oldest)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    // Între timp ecranul a trecut pe altă conversație: efectul a resetat deja starea.
    if (conversationRef.current !== requestedFor) return;
    if (!error && data) {
      const page = (data as unknown as Message[]).slice().reverse();
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = page.filter((m) => !known.has(m.id));
        return fresh.length > 0 ? [...fresh, ...prev] : prev;
      });
      setHasMore(page.length === PAGE_SIZE);
    }
    loadingMoreRef.current = false;
    setLoadingMore(false);
  }, [conversationId, hasMore]);

  return { messages, loading, loadingMore, hasMore, loadOlder, addMessage, patchMessage };
}

/** Șterge un mesaj (tombstone „pentru toți") prin RPC. Doar propriul mesaj (verificat server-side). */
export async function deleteMessage(
  table: 'messages' | 'channel_messages',
  id: string
): Promise<string | null> {
  const { error } = await supabase.rpc('delete_message', { p_table: table, p_id: id } as never);
  return translateDbError(error);
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
  return translateDbError(error);
}

// Întoarce conversația directă existentă cu ținta sau creează una nouă (RPC atomic).
// Faza 19.6: ținta poate avea ORICE rol (șofer↔șofer, mecanic↔mecanic) — RPC-ul caută
// perechea în ambele orientări; numele parametrului rămâne istoric (p_mechanic_id).
export async function startDirectConversation(
  targetUserId: string
): Promise<{ conversationId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('start_direct_conversation', {
    p_mechanic_id: targetUserId,
  } as never);
  return { conversationId: (data as unknown as string) ?? null, error: translateDbError(error) };
}

export async function deleteConversations(
  conversationIds: string[],
  userId: string
): Promise<string | null> {
  const rows = conversationIds.map((id) => ({ conversation_id: id, user_id: userId }));
  const { error } = await supabase.from('conversation_deletions').insert(rows as never);
  return translateDbError(error);
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  content: string,
  imagePath: string | null = null,
  replyToId: string | null = null,
  listingId: string | null = null,
  mechanicId: string | null = null,
  announcementId: string | null = null,
  mentions: MessageMention[] | null = null
): Promise<{ message: Message | null; error: string | null }> {
  const row: Record<string, unknown> = {
    conversation_id: conversationId,
    sender_id: senderId,
    content,
    image_path: imagePath,
  };
  row.reply_to_id = replyToId;
  // Faza 19.4: contextul de anunț („Sunt interesat" din market) — cardul de deasupra.
  if (listingId) row.listing_id = listingId;
  // Faza 19.5: mecanicul recomandat din meniul „+".
  if (mechanicId) row.recommended_mechanic_id = mechanicId;
  // Faza 19.6: anunțul de depanare distribuit (butonul de share de pe detaliu).
  if (announcementId) row.announcement_id = announcementId;
  // 10 sept: menționările „@Nume".
  if (mentions && mentions.length > 0) row.mentions = mentions;
  const { data, error } = await supabase
    .from('messages')
    .insert(row as never)
    // Returnăm și citatul + contextele, ca bula proprie să le afișeze instant (optimist).
    .select('*' + replyEmbed() + MESSAGE_ATTACH_EMBEDS)
    .single();
  return { message: (data as unknown as Message) ?? null, error: translateDbError(error) };
}

/**
 * Trimite un FIȘIER ca mesaj (Faza 19.5) — simetric cu sendImageMessage: urcă în
 * `chat/{convId}/` (fără compresie), apoi inserează mesajul cu content='' +
 * file_path/file_name/file_size. Un fișier = o bulă.
 */
export async function sendFileMessage(
  conversationId: string,
  senderId: string,
  file: PickedFile
): Promise<{ message: Message | null; error: string | null }> {
  const { path, error } = await uploadFile('chat', conversationId, file);
  if (error || !path) {
    console.warn('[chat] upload fișier eșuat:', error);
    return { message: null, error: error ?? 'upload_failed' };
  }
  const { data, error: insertError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      content: '',
      file_path: path,
      file_name: file.name,
      file_size: file.size,
      // 24 aug: durata videoclipurilor (secunde) — null la fișierele obișnuite.
      file_duration: file.durationS ?? null,
    } as never)
    .select('*' + replyEmbed() + MESSAGE_ATTACH_EMBEDS)
    .single();
  return { message: (data as unknown as Message) ?? null, error: translateDbError(insertError) };
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

/**
 * Cursorul MEU de citire pe o conversație — „înghețat" de ecran la deschidere, ÎNAINTE
 * de primul markConversationRead (care l-ar muta la zi și ar face orice mesaj să pară
 * citit). Decide ancora „Mesaje noi" (cerere 7 aug). `null` = niciodată deschisă.
 */
export async function fetchMyReadCursor(conversationId: string): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return null;
  const { data } = await supabase
    .from('message_reads')
    .select('last_read_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', session.user.id)
    .maybeSingle();
  return (data as unknown as { last_read_at: string } | null)?.last_read_at ?? null;
}

/**
 * Telefonul interlocutorului, prin RPC-ul potrivit ROLULUI lui (7 aug — butonul de apel
 * din antetul conversației). Serverul decide accesul (conversație non-market comună,
 * fără blocaj, rol corect — vezi migrarea 196 §3): `null` = fără buton, nu eroare.
 * Adminul trece de verificarea de rol din get_mechanic_phone.
 */
export async function fetchPeerPhone(peerId: string, peerRole: Role): Promise<string | null> {
  const { data } =
    peerRole === 'driver'
      ? await supabase.rpc('get_driver_phone', { p_driver_id: peerId } as never)
      : await supabase.rpc('get_mechanic_phone', { p_mechanic_id: peerId } as never);
  return (data as unknown as string | null) ?? null;
}

/**
 * Faza 5 (varianta B, migrarea 20261113000100): RPC-urile de numărare / marcare. Pe un server
 * fără migrare PostgREST răspunde PGRST202 (funcția nu există) → drumul vechi, al 1.0.x. După
 * primul PGRST202 nu mai încercăm RPC-ul în sesiunea curentă (o cerere moartă per apel altfel).
 */
let unreadCountsRpcMissing = false;
let markConversationReadRpcMissing = false;

/** `true` = funcția nu există pe server (migrarea fazei 5 neaplicată). */
export function isMissingRpc(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202';
}

/** Drumul 1.0.x: upsert direct pe message_reads (politica „user manages own reads”). */
async function upsertConversationReadLegacy(
  conversationId: string,
  userId: string,
  lastReadAt: string
): Promise<void> {
  await supabase
    .from('message_reads')
    .upsert(
      { conversation_id: conversationId, user_id: userId, last_read_at: lastReadAt } as never,
      { onConflict: 'conversation_id,user_id' }
    );
}

export async function markConversationRead(
  conversationId: string,
  newestCreatedAt?: string | null
): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return;
  const lastReadAt = readCursorValue(newestCreatedAt);
  // Serverul nu lasă cursorul să meargă înapoi și nici în viitor; când nu avansează nu scrie
  // nimic (deci nici eveniment Realtime). Orice altă eroare: ca înainte, fără mesaj.
  let legacy = markConversationReadRpcMissing;
  if (!legacy) {
    const { error } = await supabase.rpc('mark_conversation_read', {
      p_conversation: conversationId,
      p_at: lastReadAt,
    });
    if (isMissingRpc(error)) {
      markConversationReadRpcMissing = true;
      legacy = true;
    }
  }
  if (legacy) await upsertConversationReadLegacy(conversationId, session.user.id, lastReadAt);
  emitReadsChanged();
  // Mesajele au fost văzute → celula lor dispare din bara de notificări (7 aug).
  void dismissThreadNotifications('conversation', conversationId);
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

/** Drumul 1.0.x (server fără migrarea fazei 5): câte o numărătoare `count exact` per conversație. */
async function fetchUnreadCountsLegacy(userId: string): Promise<Record<string, number>> {
  // Conversațiile ȘTERSE de utilizator (Faza 5, soft-delete) NU se mai văd în listă,
  // deci nu pot fi deschise → n-ar putea fi marcate ca citite niciodată. Dacă le-am
  // număra, badge-ul ar arăta mesaje necitite imposibil de eliminat.
  const { data: deletions } = await supabase
    .from('conversation_deletions')
    .select('conversation_id')
    .eq('user_id', userId)
    .limit(500);
  const deletedIds = new Set(
    ((deletions ?? []) as unknown as { conversation_id: string }[]).map((d) => d.conversation_id),
  );

  const { data: allConvs } = await supabase
    .from('conversations')
    .select('id').or(`driver_id.eq.${userId},mechanic_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(200);
  const all = (allConvs ?? []) as unknown as { id: string }[];
  const convs = all.filter((c) => !deletedIds.has(c.id));
  if (convs.length === 0) return {};

  const { data: reads } = await supabase
    .from('message_reads')
    .select('conversation_id,last_read_at')
    .eq('user_id', userId)
    .limit(500);
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
      // Tombstone-urile (Faza 14) nu se numără.
      query = query.is('deleted_at', null);
      if (lastRead) query = query.gt('created_at', lastRead);
      const { count } = await query;
      result[id] = count ?? 0;
    })
  );
  return result;
}

/**
 * Necititele mele pe conversație. Faza 5: o singură interogare (`unread_counts()`, aceleași reguli
 * ca numărătoarea veche, inclusiv conversațiile șterse de mine) în locul celor până la 200.
 * Serverul întoarce DOAR conversațiile cu necitite: lipsa unei chei = 0 (consumatorii citesc cu
 * `?? 0` / `Object.values`). `null` = eroare (rețea etc.): apelantul păstrează bulinele de acum.
 */
async function fetchUnreadCounts(userId: string): Promise<Record<string, number> | null> {
  if (!unreadCountsRpcMissing) {
    const { data, error } = await supabase.rpc('unread_counts');
    if (!error) {
      const result: Record<string, number> = {};
      for (const row of data ?? []) result[row.conversation_id] = row.unread;
      return result;
    }
    if (!isMissingRpc(error)) return null;
    // Două instanțe pot primi PGRST202 deodată: avertizează doar prima.
    if (__DEV__ && !unreadCountsRpcMissing) {
      console.warn('[chat] unread_counts lipsește pe server (PGRST202): numărătoarea veche');
    }
    unreadCountsRpcMissing = true;
  }
  return fetchUnreadCountsLegacy(userId);
}

/** Pauza dinaintea unui recalcul coalescat: o rafală de evenimente dă o singură cerere. */
const RECOUNT_COALESCE_MS = 250;

/**
 * Recalcul coalescat al unei buline (faza 5): cel mult unul în zbor; evenimentele sosite cât
 * așteaptă sau cât rulează dau ÎNCĂ UNUL după ce se termină (trailing). Fiecare rundă pornește
 * după RECOUNT_COALESCE_MS. Funcția întoarsă e stabilă (nu re-abonează nimic), iar timer-ul
 * moare la demontare (fără setState după demontare). Comun chatului privat și canalului.
 */
export function useCoalescedRecount(recount: () => Promise<void>): () => void {
  const recountRef = useRef(recount);
  recountRef.current = recount;
  const stateRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    running: boolean;
    pending: boolean;
    mounted: boolean;
  }>({ timer: null, running: false, pending: false, mounted: true });

  useEffect(() => {
    const s = stateRef.current;
    s.mounted = true;
    return () => {
      s.mounted = false;
      s.pending = false;
      if (s.timer) clearTimeout(s.timer);
      s.timer = null;
    };
  }, []);

  return useCallback(() => {
    const s = stateRef.current;
    if (!s.mounted) return;
    s.pending = true;
    if (s.timer || s.running) return;
    const run = async () => {
      s.timer = null;
      if (!s.mounted || !s.pending) return;
      s.pending = false;
      s.running = true;
      try {
        await recountRef.current();
      } finally {
        s.running = false;
      }
      if (s.pending && s.mounted) s.timer = setTimeout(() => void run(), RECOUNT_COALESCE_MS);
    };
    s.timer = setTimeout(() => void run(), RECOUNT_COALESCE_MS);
  }, []);
}

/** Ce fel de eveniment a schimbat (posibil) bulinele chatului privat. */
export type UnreadCountsEvent = 'message' | 'read' | 'conversation';

export function useUnreadCounts(userId: string | undefined): { counts: Record<string, number>; refresh: () => Promise<void> } {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Ids-urile conversațiilor curente, pentru subscripții Realtime FILTRATE.
  // Subscripția nefiltrată pe `messages` nu livra evenimente către destinatar
  // (RLS-ul cu JOIN pe conversations + lipsa filtrului), în timp ce canalul global
  // — filtrat, cu RLS trivial — funcționa (verificat pe device: badge-ul se aprindea
  // doar pentru canal). Filtrul `in.(...)` readuce livrarea pe tiparul care merge.
  const [convIdsKey, setConvIdsKey] = useState('');
  const mountedRef = useRef(true);
  // Numărul cererii: un răspuns mai vechi nu suprascrie unul mai nou (refresh-ul imediat se
  // poate suprapune cu un recalcul coalescat).
  const countsSeqRef = useRef(0);
  const idsSeqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchCounts = useCallback(async () => {
    if (!userId) return;
    const seq = ++countsSeqRef.current;
    const next = await fetchUnreadCounts(userId);
    // Eroare (rețea slabă): bulinele rămân cum erau, nu se sting fals.
    if (!next || !mountedRef.current || seq !== countsSeqRef.current) return;
    setCounts(next);
  }, [userId]);

  // Lista de ids pentru filtrul Realtime — refăcută la montare, la revenirea în prim-plan și
  // la o conversație nouă, NU la fiecare recalcul al bulinei (faza 5). O eroare păstrează
  // lista veche (altfel abonarea ar pierde filtrul și s-ar re-face degeaba).
  const refreshConversationIds = useCallback(async () => {
    if (!userId) return;
    const seq = ++idsSeqRef.current;
    const { data, error } = await supabase
      .from('conversations')
      .select('id').or(`driver_id.eq.${userId},mechanic_id.eq.${userId}`)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error || !data || !mountedRef.current || seq !== idsSeqRef.current) return;
    const all = data as unknown as { id: string }[];
    // Filtrul Realtime acoperă TOATE conversațiile mele, inclusiv cele șterse: un
    // mesaj nou într-o conversație ștearsă o reînvie server-side (trigger 20260811),
    // iar evenimentul lui trebuie să declanșeze recalculul — numărătoarea vede rândul
    // de ștergere deja dispărut și o numără. Fără asta, bulina apărea abia la
    // următorul focus/foreground.
    setConvIdsKey(all.map((c) => c.id).sort().join(','));
  }, [userId]);

  const scheduleRecount = useCoalescedRecount(fetchCounts);

  // Punctul de intrare pentru evenimentele care schimbă bulinele; nu primește payload-ul
  // postgres_changes. Varianta A (broadcast) va chema aceeași funcție.
  const handleCountsEvent = useCallback(
    (kind: UnreadCountsEvent) => {
      if (kind === 'conversation') void refreshConversationIds();
      scheduleRecount();
    },
    [refreshConversationIds, scheduleRecount],
  );

  useEffect(() => {
    void refreshConversationIds();
    void fetchCounts();
  }, [refreshConversationIds, fetchCounts]);

  // Citirile făcute pe ACEST device sting badge-ul imediat — vezi lib/read-events.
  // Coalescat: ecranul de chat marchează la fiecare schimbare a listei (și la „mai vechi”).
  useEffect(() => onReadsChanged(() => handleCountsEvent('read')), [handleCountsEvent]);

  // Plasă de siguranță: evenimentele Realtime ratate cât timp aplicația a stat în
  // fundal nu mai pot fi „prinse" — recalculăm la revenirea în prim-plan (și refacem
  // lista de ids: o conversație nouă din intervalul mort n-ar intra altfel în filtru).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void refreshConversationIds();
      scheduleRecount();
    });
    return () => sub.remove();
  }, [refreshConversationIds, scheduleRecount]);

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
          handleCountsEvent('message');
        })
        // UPDATE = tombstone/editare: recalculăm ca badge-ul să scadă când un necitit e șters.
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter }, () => {
          handleCountsEvent('message');
        });
    }
    channel = channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reads', filter: `user_id=eq.${userId}` }, () => {
        handleCountsEvent('read');
      })
      // Conversație nouă (ex. „Contactează vânzătorul" din Market): reintră în calcul —
      // filtrul in.(...) de mai sus nu o acoperă până nu refacem lista de ids.
      // Două abonări FILTRATE, câte una per slotul în care putem apărea: abonarea
      // nefiltrată nu livra (vezi nota convIdsKey), iar tabelul trebuie să fie în
      // publicația supabase_realtime (migrarea 20260725 — lipsea, deci handlerul
      // vechi nu primea NICIODATĂ evenimente și bulina nu se aprindea la prima
      // conversație cu cineva).
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations', filter: `driver_id=eq.${userId}` }, () => {
        handleCountsEvent('conversation');
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations', filter: `mechanic_id=eq.${userId}` }, () => {
        handleCountsEvent('conversation');
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, convIdsKey, handleCountsEvent]);

  // Reîmprospătarea cerută de ecran (focus pe listă, pull-to-refresh): recalcul IMEDIAT și
  // lista de ids refăcută — dacă evenimentul unei conversații noi s-a pierdut, filtrul
  // Realtime n-ar mai include-o până la următoarea revenire în prim-plan.
  const refresh = useCallback(async () => {
    void refreshConversationIds();
    await fetchCounts();
  }, [refreshConversationIds, fetchCounts]);

  return { counts, refresh };
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
