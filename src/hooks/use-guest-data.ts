import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AnnouncementWithDriver } from '@/hooks/use-announcements';
import {
  MARKET_PAGE_SIZE,
  type MarketFeedFilters,
  type MarketListingWithSeller,
  type MarketPhotoWithUrl,
  type MarketSort,
} from '@/hooks/use-market';
import { signedUrls } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import type {
  Announcement,
  ChannelMessage,
  GuestAnnouncement,
  GuestAnnouncementPhoto,
  GuestChannel,
  GuestChannelMessage,
  GuestMarketListing,
  GuestMarketListingPhoto,
  GuestProfile,
  MarketCategory,
  MarketListing,
  PublicUser,
  Role,
} from '@/types/database';

/**
 * 1.1 (B3): datele unui OASPETE (fără cont). Sursa = clientul Supabase de azi, care fără
 * sesiune merge ca rolul `anon` și vede DOAR view-urile `guest_*` + RPC-urile `guest_search_*`
 * din migrarea 20261026 (B1). Fără Realtime: ecranele reîncarcă la focus / pull-to-refresh.
 *
 * Nicio funcție nu aruncă: pe un server fără migrare (view inexistent = `42P01`/`PGRST205`,
 * RPC inexistent = `PGRST202`) sau fără rețea întoarce `[]`/`null` + `error`, iar ecranul
 * arată starea goală — niciodată crash. Toate citirile au `.limit()` explicit.
 */

// TODO: după `npm run gen:types` (migrarea 20261026) view-urile apar în `Database` și cast-ul dispare.
const untypedClient = supabase as unknown as SupabaseClient;

/** `unavailable` = serverul n-are încă view-urile/RPC-urile; `failed` = rețea sau altă eroare. */
export type GuestDataError = 'unavailable' | 'failed';

export interface GuestResult<T> {
  data: T;
  error: GuestDataError | null;
}

const MISSING_OBJECT_CODES = new Set(['42P01', 'PGRST205', 'PGRST202', '42883']);

function toGuestError(error: { code?: string } | null | undefined): GuestDataError | null {
  if (!error) return null;
  return error.code && MISSING_OBJECT_CODES.has(error.code) ? 'unavailable' : 'failed';
}

const PROFILE_COLUMNS =
  'id, full_name, role, avatar_path, specialization, activity_zone, company_name, rating_avg, rating_count, created_at';
const ANNOUNCEMENT_COLUMNS =
  'id, driver_id, description, location, status, created_at, truck_make, truck_model, truck_year, lat_approx, lng_approx';
const LISTING_COLUMNS =
  'id, seller_id, title, description, price, currency, category, status, created_at';
const CHANNEL_MESSAGE_COLUMNS =
  'id, channel_id, sender_id, content, created_at, reply_to_id, mentions, has_image, announcement_id, listing_id, recommended_mechanic_id';

/** Plafoane explicite (PLAN_1.1 B3): feed 100, mecanici 200, canal 50, Market paginat. */
const ANNOUNCEMENTS_LIMIT = 100;
const MECHANICS_LIMIT = 200;
const CHANNEL_MESSAGES_LIMIT = 50;
const PHOTOS_LIMIT = 20;

/** `numeric` din PostgREST poate veni ca string — îl normalizăm la număr (sau null). */
function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Profilurile (doar câmpurile publice) pentru un set de id-uri, ca hartă id → profil. */
async function fetchGuestProfilesByIds(ids: string[]): Promise<Record<string, GuestProfile>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return {};
  try {
    const { data, error } = await untypedClient
      .from('guest_profiles')
      .select(PROFILE_COLUMNS)
      .in('id', unique)
      .limit(unique.length);
    if (error || !data) return {};
    const map: Record<string, GuestProfile> = {};
    for (const row of data as GuestProfile[]) map[row.id] = row;
    return map;
  } catch {
    return {};
  }
}

/** Utilizatorul public din profilul de oaspete (cel șters/banat lipsește din view → null). */
function toPublicUser(p: GuestProfile | undefined): PublicUser | null {
  return p ? { full_name: p.full_name, avatar_path: p.avatar_path, deleted_at: null } : null;
}

/**
 * Anunțul de oaspete pe forma `Announcement` folosită de carduri și de hartă: coordonatele
 * APROXIMATIVE (~1 km) iau locul celor exacte, câmpurile pe care oaspetele nu le vede rămân goale.
 */
export function guestAnnouncementToAnnouncement(g: GuestAnnouncement): Announcement {
  return {
    id: g.id,
    driver_id: g.driver_id,
    description: g.description,
    location: g.location,
    status: g.status,
    mechanic_id: null,
    truck_make: g.truck_make,
    truck_model: g.truck_model,
    truck_year: g.truck_year,
    plate_number: null,
    chassis_number: null,
    latitude: toNumberOrNull(g.lat_approx),
    longitude: toNumberOrNull(g.lng_approx),
    hidden_from_history: false,
    source_lang: null,
    source_lang_detected: false,
    created_at: g.created_at,
    updated_at: g.created_at,
  };
}

// ── Anunțuri ────────────────────────────────────────────────────────────────

/** Anunțurile deschise (cele mai noi 100), cu numele/avatarul autorului. */
export async function fetchGuestOpenAnnouncements(): Promise<GuestResult<AnnouncementWithDriver[]>> {
  try {
    const { data, error } = await untypedClient
      .from('guest_announcements')
      .select(ANNOUNCEMENT_COLUMNS)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(ANNOUNCEMENTS_LIMIT);
    if (error || !data) return { data: [], error: toGuestError(error) ?? 'failed' };
    const rows = data as GuestAnnouncement[];
    const drivers = await fetchGuestProfilesByIds(rows.map((r) => r.driver_id));
    return {
      data: rows.map((r) => ({
        ...guestAnnouncementToAnnouncement(r),
        driver: toPublicUser(drivers[r.driver_id]),
      })),
      error: null,
    };
  } catch {
    return { data: [], error: 'failed' };
  }
}

export interface GuestAnnouncementDetail {
  announcement: GuestAnnouncement;
  /** Autorul (null dacă nu mai e public: cont șters sau banat). */
  driver: GuestProfile | null;
}

/** Un anunț deschis + autorul lui. `null` = închis, inexistent sau server fără migrare. */
export async function fetchGuestAnnouncement(
  id: string,
): Promise<GuestResult<GuestAnnouncementDetail | null>> {
  if (!id) return { data: null, error: null };
  try {
    const { data, error } = await untypedClient
      .from('guest_announcements')
      .select(ANNOUNCEMENT_COLUMNS)
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (error) return { data: null, error: toGuestError(error) };
    if (!data) return { data: null, error: null };
    const announcement = data as GuestAnnouncement;
    const drivers = await fetchGuestProfilesByIds([announcement.driver_id]);
    return { data: { announcement, driver: drivers[announcement.driver_id] ?? null }, error: null };
  } catch {
    return { data: null, error: 'failed' };
  }
}

/** Pozele anunțului (max 20), gata semnate. Cele pe care Storage le refuză lipsesc. */
export async function fetchGuestAnnouncementPhotos(
  id: string,
): Promise<GuestResult<{ id: string; url: string }[]>> {
  if (!id) return { data: [], error: null };
  try {
    const { data, error } = await untypedClient
      .from('guest_announcement_photos')
      .select('id, announcement_id, storage_path, created_at')
      .eq('announcement_id', id)
      .order('created_at', { ascending: true })
      .limit(PHOTOS_LIMIT);
    if (error || !data) return { data: [], error: toGuestError(error) ?? 'failed' };
    const rows = data as GuestAnnouncementPhoto[];
    const urls = await signedUrls(rows.map((r) => r.storage_path));
    return {
      data: rows.filter((r) => urls[r.storage_path]).map((r) => ({ id: r.id, url: urls[r.storage_path] })),
      error: null,
    };
  } catch {
    return { data: [], error: 'failed' };
  }
}

/** Hook-ul listei/hărții de oaspete: aceeași formă ca `useOpenAnnouncements`, fără fetch la montare. */
export function useGuestOpenAnnouncements() {
  const [announcements, setAnnouncements] = useState<AnnouncementWithDriver[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<GuestDataError | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await fetchGuestOpenAnnouncements();
    // Pe eroare păstrăm lista veche (rețea slabă): un refresh picat nu golește ecranul.
    if (!result.error) setAnnouncements(result.data);
    setError(result.error);
    setLoading(false);
  }, []);

  return { announcements, loading, error, refresh };
}

// ── Mecanici și profiluri ───────────────────────────────────────────────────

/**
 * Directorul mecanicilor: fără căutare = toți (alfabetic, max 200); cu căutare = RPC-ul
 * `guest_search_mechanics` (după nume, fără diacritice, max 30 pe server).
 */
export async function fetchGuestMechanics(query: string): Promise<GuestResult<GuestProfile[]>> {
  const trimmed = query.trim();
  try {
    if (!trimmed) {
      const { data, error } = await untypedClient
        .from('guest_profiles')
        .select(PROFILE_COLUMNS)
        .eq('role', 'mechanic')
        .order('full_name', { ascending: true })
        .limit(MECHANICS_LIMIT);
      if (error || !data) return { data: [], error: toGuestError(error) ?? 'failed' };
      // Ordinea DB pune diacriticele după „z" — sortarea finală e locală (ca useAllMechanics).
      const rows = (data as GuestProfile[]).filter((p) => !!p.full_name);
      rows.sort((a, b) => a.full_name.localeCompare(b.full_name));
      return { data: rows, error: null };
    }
    const { data, error } = await untypedClient.rpc('guest_search_mechanics', { p_query: trimmed });
    if (error || !data) return { data: [], error: toGuestError(error) ?? 'failed' };
    return { data: data as GuestProfile[], error: null };
  } catch {
    return { data: [], error: 'failed' };
  }
}

/** Profilul public al unui utilizator (mecanic sau transportator). */
export async function fetchGuestProfile(id: string): Promise<GuestResult<GuestProfile | null>> {
  if (!id) return { data: null, error: null };
  try {
    const { data, error } = await untypedClient
      .from('guest_profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (error) return { data: null, error: toGuestError(error) };
    return { data: (data as GuestProfile | null) ?? null, error: null };
  } catch {
    return { data: null, error: 'failed' };
  }
}

// ── Market ──────────────────────────────────────────────────────────────────

export interface GuestListingsQuery {
  query: string;
  category: MarketCategory | null;
  sort: MarketSort;
  offset: number;
}

/** O pagină de anunțuri active (30, ca `use-market.ts`); căutarea e pe server (RPC). */
export async function fetchGuestListings({
  query,
  category,
  sort,
  offset,
}: GuestListingsQuery): Promise<GuestResult<MarketListing[]>> {
  const trimmed = query.trim();
  try {
    if (trimmed.length >= 2) {
      const { data, error } = await untypedClient.rpc('guest_search_market', {
        p_query: trimmed,
        p_category: category,
        p_sort: sort,
        p_limit: MARKET_PAGE_SIZE,
        p_offset: offset,
      });
      if (error || !data) return { data: [], error: toGuestError(error) ?? 'failed' };
      return { data: (data as GuestMarketListing[]).map(guestListingToListing), error: null };
    }
    let q = untypedClient.from('guest_market_listings').select(LISTING_COLUMNS).eq('status', 'active');
    if (category) q = q.eq('category', category);
    if (sort === 'price_asc') q = q.order('price', { ascending: true });
    else if (sort === 'price_desc') q = q.order('price', { ascending: false });
    else q = q.order('created_at', { ascending: false });
    const { data, error } = await q.range(offset, offset + MARKET_PAGE_SIZE - 1);
    if (error || !data) return { data: [], error: toGuestError(error) ?? 'failed' };
    return { data: (data as GuestMarketListing[]).map(guestListingToListing), error: null };
  } catch {
    return { data: [], error: 'failed' };
  }
}

function guestListingToListing(g: GuestMarketListing): MarketListing {
  return { ...g, price: Number(g.price), updated_at: g.created_at };
}

/** Coperțile (poziția minimă) pentru un set de anunțuri, ca URL-uri semnate. */
export async function fetchGuestListingCovers(
  listingIds: string[],
): Promise<Record<string, string>> {
  if (listingIds.length === 0) return {};
  try {
    const { data, error } = await untypedClient
      .from('guest_market_listing_photos')
      .select('id, listing_id, storage_path, position')
      .in('listing_id', listingIds)
      .order('position', { ascending: true })
      .limit(200);
    if (error || !data) return {};
    const coverPaths: Record<string, string> = {};
    for (const row of data as GuestMarketListingPhoto[]) {
      if (!coverPaths[row.listing_id]) coverPaths[row.listing_id] = row.storage_path;
    }
    const urls = await signedUrls(Object.values(coverPaths));
    const result: Record<string, string> = {};
    for (const [listingId, path] of Object.entries(coverPaths)) {
      if (urls[path]) result[listingId] = urls[path];
    }
    return result;
  } catch {
    return {};
  }
}

export interface GuestListingDetail {
  listing: MarketListingWithSeller;
  photos: MarketPhotoWithUrl[];
}

/** Detaliul unui anunț activ: anunțul + vânzătorul + pozele semnate. */
export async function fetchGuestListing(id: string): Promise<GuestResult<GuestListingDetail | null>> {
  if (!id) return { data: null, error: null };
  try {
    const { data, error } = await untypedClient
      .from('guest_market_listings')
      .select(LISTING_COLUMNS)
      .eq('id', id)
      .limit(1)
      .maybeSingle();
    if (error) return { data: null, error: toGuestError(error) };
    if (!data) return { data: null, error: null };
    const listing = guestListingToListing(data as GuestMarketListing);

    const [sellers, photosResult] = await Promise.all([
      fetchGuestProfilesByIds([listing.seller_id]),
      untypedClient
        .from('guest_market_listing_photos')
        .select('id, listing_id, storage_path, position')
        .eq('listing_id', id)
        .order('position', { ascending: true })
        .limit(PHOTOS_LIMIT),
    ]);
    const seller = sellers[listing.seller_id];
    const rows = (photosResult.data as GuestMarketListingPhoto[] | null) ?? [];
    const urls = await signedUrls(rows.map((r) => r.storage_path));
    return {
      data: {
        listing: {
          ...listing,
          seller: seller
            ? {
                full_name: seller.full_name,
                avatar_path: seller.avatar_path,
                deleted_at: null,
                role: seller.role,
                rating_avg: seller.rating_avg,
                rating_count: seller.rating_count,
              }
            : null,
        },
        photos: rows
          .filter((r) => urls[r.storage_path])
          .map((r) => ({
            id: r.id,
            storage_path: r.storage_path,
            position: r.position,
            url: urls[r.storage_path],
          })),
      },
      error: null,
    };
  } catch {
    return { data: null, error: 'failed' };
  }
}

/**
 * Grila Market a oaspetelui: ACEEAȘI semnătură și formă ca `useMarketListings`, ca
 * `MarketFeedScreen` să aleagă hook-ul după prop-ul fix `guest`. `mine` e ignorat
 * (oaspetele n-are anunțuri proprii).
 */
export function useGuestMarketListings(_userId: string | undefined, filters: MarketFeedFilters) {
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const listingsRef = useRef<MarketListing[]>([]);
  listingsRef.current = listings;

  const { query, category, sort } = filters;

  const fetchPage = useCallback(
    (offset: number) => fetchGuestListings({ query, category, sort, offset }),
    [query, category, sort],
  );

  const addCovers = useCallback(async (page: MarketListing[]) => {
    if (page.length === 0) return;
    const map = await fetchGuestListingCovers(page.map((l) => l.id));
    setCovers((prev) => ({ ...prev, ...map }));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data: page, error } = await fetchPage(0);
    // Eroare de rețea: păstrăm ce aveam; server fără migrare: listă goală (starea goală).
    if (!error || error === 'unavailable') {
      setListings(page);
      setHasMore(!error && page.length === MARKET_PAGE_SIZE);
    }
    setLoading(false);
    addCovers(page);
  }, [fetchPage, addCovers]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || listingsRef.current.length === 0) return;
    setLoadingMore(true);
    const { data: page, error } = await fetchPage(listingsRef.current.length);
    setListings((prev) => {
      const seen = new Set(prev.map((l) => l.id));
      return [...prev, ...page.filter((l) => !seen.has(l.id))];
    });
    setHasMore(!error && page.length === MARKET_PAGE_SIZE);
    setLoadingMore(false);
    addCovers(page);
  }, [fetchPage, addCovers, hasMore, loadingMore]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { listings, covers, loading, loadingMore, hasMore, refresh, loadMore };
}

// ── Canalul comunitar (doar citire) ─────────────────────────────────────────

/** Mesajul de canal pe forma `ChatScreen` (ca `ChannelMessageWithSender`), fără poze/fișiere. */
export type GuestChannelMessageWithSender = ChannelMessage & {
  sender: PublicUser & { role: Role };
  has_image: boolean;
};

function guestMessageToChannelMessage(
  m: GuestChannelMessage,
  sender: GuestProfile | undefined,
): GuestChannelMessageWithSender {
  return {
    id: m.id,
    channel_id: m.channel_id,
    sender_id: m.sender_id,
    content: m.content ?? '',
    image_path: null,
    deleted_at: null,
    edited_at: null,
    // Citatul nu se poate hidrata (fără embedding pe view) — fără reply_to_id, bula nu
    // afișează „Mesaj indisponibil” pentru fiecare răspuns.
    reply_to_id: null,
    deleted_by_admin: false,
    // Cardurile de context ar cere embedding-uri pe tabele închise pentru anon.
    listing_id: null,
    recommended_mechanic_id: null,
    announcement_id: null,
    file_path: null,
    file_name: null,
    file_size: null,
    file_duration: null,
    mentions: m.mentions ?? null,
    created_at: m.created_at,
    has_image: !!m.has_image,
    sender: sender
      ? { full_name: sender.full_name, avatar_path: sender.avatar_path, deleted_at: null, role: sender.role }
      : // Expeditorul nu mai e public (șters/banat): numele generic „Utilizator”.
        { full_name: '', avatar_path: null, deleted_at: null, role: 'driver' },
  };
}

export interface GuestChannelData {
  channel: GuestChannel;
  messages: GuestChannelMessageWithSender[];
}

/** Canalul `global`: ultimele mesaje (max 50, ultimele 7 zile), crescător, cu expeditorii. */
export async function fetchGuestChannel(): Promise<GuestResult<GuestChannelData | null>> {
  try {
    const { data: channelRow, error: channelError } = await untypedClient
      .from('guest_channels')
      .select('id, name, type, created_at')
      .eq('type', 'global')
      .limit(1)
      .maybeSingle();
    if (channelError) return { data: null, error: toGuestError(channelError) };
    if (!channelRow) return { data: null, error: null };
    const channel = channelRow as GuestChannel;

    const { data, error } = await untypedClient
      .from('guest_channel_messages')
      .select(CHANNEL_MESSAGE_COLUMNS)
      .eq('channel_id', channel.id)
      .order('created_at', { ascending: true })
      .limit(CHANNEL_MESSAGES_LIMIT);
    if (error || !data) return { data: { channel, messages: [] }, error: toGuestError(error) ?? 'failed' };
    const rows = data as GuestChannelMessage[];
    const senders = await fetchGuestProfilesByIds(rows.map((r) => r.sender_id));
    return {
      data: { channel, messages: rows.map((r) => guestMessageToChannelMessage(r, senders[r.sender_id])) },
      error: null,
    };
  } catch {
    return { data: null, error: 'failed' };
  }
}
