import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';
import {
  fetchReplyEmbed,
  hasChatV14,
  hasMentionsColumn,
  replyEmbed,
  type MessageMention,
  type ReplyEmbedRow,
} from '@/lib/chat-schema';
import { emitReadsChanged, onReadsChanged } from '@/lib/read-events';
import { dismissThreadNotifications } from '@/lib/push';
import { uploadFile, uploadPhoto, type PickedFile } from '@/lib/storage';
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
  return (data as unknown as MessageMechanicContext) ?? null;
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
  return (data as unknown as MessageAnnouncementContext) ?? null;
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
const CATCH_UP_OVERLAP = 20;

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

export function useMessages(conversationId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  // Catch-up-ul are sens doar după încărcarea inițială (altfel ar dubla-o).
  const loadedRef = useRef(false);

  // Vezi CATCH_UP_OVERLAP: readuce ce e mai nou decât al 20-lea mesaj de la coadă.
  const catchUp = useCallback(async (): Promise<boolean> => {
    if (!loadedRef.current) return true;
    const known = messagesRef.current;
    const cutoff =
      known.length > 0 ? known[Math.max(0, known.length - CATCH_UP_OVERLAP)].created_at : null;
    const v14 = await hasChatV14();
    let query = supabase
      .from('messages')
      .select('*' + (v14 ? replyEmbed() : '') + MESSAGE_ATTACH_EMBEDS)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });
    if (cutoff) query = query.gte('created_at', cutoff);
    const { data, error } = await query;
    if (error || !data || !loadedRef.current) return false;
    setMessages((prev) => mergeMessages(prev, data as unknown as Message[]));
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

    (async () => {
      const v14 = await hasChatV14();
      const { data } = await supabase
        .from('messages')
        .select('*' + (v14 ? replyEmbed() : '') + MESSAGE_ATTACH_EMBEDS)
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true });
      if (active) {
        setMessages((data as unknown as Message[]) ?? []);
        setLoading(false);
        loadedRef.current = true;
      }
    })();

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
        async (payload) => {
          if (!active) return;
          const incoming = payload.new as Message & {
            reply_to?: ReplyEmbedRow | null;
            listing?: MessageListingContext | null;
            mechanic?: MessageMechanicContext | null;
            announcement?: MessageAnnouncementContext | null;
          };
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

// Întoarce conversația directă existentă cu ținta sau creează una nouă (RPC atomic).
// Faza 19.6: ținta poate avea ORICE rol (șofer↔șofer, mecanic↔mecanic) — RPC-ul caută
// perechea în ambele orientări; numele parametrului rămâne istoric (p_mechanic_id).
export async function startDirectConversation(
  targetUserId: string
): Promise<{ conversationId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('start_direct_conversation', {
    p_mechanic_id: targetUserId,
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
  listingId: string | null = null,
  mechanicId: string | null = null,
  announcementId: string | null = null,
  mentions: MessageMention[] | null = null
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
  // Faza 19.5: mecanicul recomandat din meniul „+".
  if (mechanicId) row.recommended_mechanic_id = mechanicId;
  // Faza 19.6: anunțul de depanare distribuit (butonul de share de pe detaliu).
  if (announcementId) row.announcement_id = announcementId;
  // 10 sept: menționările „@Nume" — doar dacă schema are coloana (migrarea 20260910).
  if (mentions && mentions.length > 0 && (await hasMentionsColumn())) row.mentions = mentions;
  const { data, error } = await supabase
    .from('messages')
    .insert(row as never)
    // Returnăm și citatul + contextele, ca bula proprie să le afișeze instant (optimist).
    .select('*' + (v14 ? replyEmbed() : '') + MESSAGE_ATTACH_EMBEDS)
    .single();
  return { message: (data as unknown as Message) ?? null, error: error?.message ?? null };
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
  const v14 = await hasChatV14();
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
    .select('*' + (v14 ? replyEmbed() : '') + MESSAGE_ATTACH_EMBEDS)
    .single();
  return { message: (data as unknown as Message) ?? null, error: insertError?.message ?? null };
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
    const all = (allConvs ?? []) as unknown as { id: string }[];
    // Filtrul Realtime acoperă TOATE conversațiile mele, inclusiv cele șterse: un
    // mesaj nou într-o conversație ștearsă o reînvie server-side (trigger 20260811),
    // iar evenimentul lui trebuie să declanșeze recalculul — refetch-ul de mai sus
    // vede rândul de ștergere deja dispărut și o numără. Fără asta, bulina apărea
    // abia la următorul focus/foreground.
    setConvIdsKey(all.map((c) => c.id).sort().join(','));
    const convs = all.filter((c) => !deletedIds.has(c.id));
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
