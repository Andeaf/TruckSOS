import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase';
import { uploadPhoto, deletePhotos, signedUrls } from '@/lib/storage';
import type { PickedImage } from '@/lib/media';
import type {
  MarketCategory,
  MarketListing,
  MarketListingPhoto,
  PublicUser,
  Role,
} from '@/types/database';

/**
 * Market (Faza 19) — anunțuri de vânzare, ambele roluri (PLAN_FAZA19.md §2-3).
 * Paginare de la început (pagini de 30, model `loadOlder` din chat); căutarea e
 * SERVER-SIDE (RPC `search_market_listings`, unaccent) — pe date paginate, căutarea
 * client-side ar căuta doar în paginile deja încărcate.
 */

export const MARKET_PAGE_SIZE = 30;

export const MARKET_CATEGORIES: MarketCategory[] = [
  'tires',
  'parts',
  'trucks',
  'trailers',
  'accessories',
  'other',
];

export type MarketSort = 'recent' | 'price_asc' | 'price_desc';

export interface MarketFeedFilters {
  query: string;
  category: MarketCategory | null;
  sort: MarketSort;
  /** „Ale mele": anunțurile vânzătorului curent, inclusiv cele `sold`. */
  mine: boolean;
}

export type MarketListingWithSeller = MarketListing & {
  seller: (PublicUser & { role: Role; rating_avg: number; rating_count: number }) | null;
};

/** Grila Market: listă paginată + cover-urile semnate ale paginilor încărcate. */
export function useMarketListings(userId: string | undefined, filters: MarketFeedFilters) {
  const [listings, setListings] = useState<MarketListing[]>([]);
  const [covers, setCovers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const listingsRef = useRef<MarketListing[]>([]);
  listingsRef.current = listings;

  const { query, category, sort, mine } = filters;
  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length >= 2 && !mine;

  const fetchPage = useCallback(
    async (offset: number): Promise<MarketListing[]> => {
      if (searching) {
        const { data } = await supabase.rpc('search_market_listings', {
          p_query: trimmedQuery,
          p_category: category,
          p_sort: sort,
          p_limit: MARKET_PAGE_SIZE,
          p_offset: offset,
        } as never);
        return (data as unknown as MarketListing[]) ?? [];
      }

      let q = supabase.from('market_listings').select('*');
      if (mine) {
        // „Ale mele" include și `sold` — vânzătorul își administrează tot inventarul.
        q = q.eq('seller_id', userId ?? '');
      } else {
        q = q.eq('status', 'active');
      }
      if (category) q = q.eq('category', category);
      if (sort === 'price_asc') q = q.order('price', { ascending: true });
      else if (sort === 'price_desc') q = q.order('price', { ascending: false });
      else q = q.order('created_at', { ascending: false });
      const { data } = await q.range(offset, offset + MARKET_PAGE_SIZE - 1);
      return (data as unknown as MarketListing[]) ?? [];
    },
    [searching, trimmedQuery, category, sort, mine, userId],
  );

  const addCovers = useCallback(async (page: MarketListing[]) => {
    if (page.length === 0) return;
    const map = await fetchListingCovers(page.map((l) => l.id));
    setCovers((prev) => ({ ...prev, ...map }));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    const page = await fetchPage(0);
    setListings(page);
    setHasMore(page.length === MARKET_PAGE_SIZE);
    setLoading(false);
    addCovers(page);
  }, [fetchPage, addCovers]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || listingsRef.current.length === 0) return;
    setLoadingMore(true);
    const page = await fetchPage(listingsRef.current.length);
    setListings((prev) => {
      // Dedup pe id: offset-ul poate aluneca dacă apar anunțuri noi între pagini.
      const seen = new Set(prev.map((l) => l.id));
      return [...prev, ...page.filter((l) => !seen.has(l.id))];
    });
    setHasMore(page.length === MARKET_PAGE_SIZE);
    setLoadingMore(false);
    addCovers(page);
  }, [fetchPage, addCovers, hasMore, loadingMore]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { listings, covers, loading, loadingMore, hasMore, refresh, loadMore };
}

/** Cover-urile (position minim) pentru un set de anunțuri, ca URL-uri semnate. */
export async function fetchListingCovers(
  listingIds: string[],
): Promise<Record<string, string>> {
  if (listingIds.length === 0) return {};
  const { data } = await supabase
    .from('market_listing_photos')
    .select('listing_id, storage_path, position')
    .in('listing_id', listingIds)
    .order('position', { ascending: true });
  const rows = (data as unknown as Pick<MarketListingPhoto, 'listing_id' | 'storage_path' | 'position'>[]) ?? [];

  const coverPaths: Record<string, string> = {};
  for (const row of rows) {
    if (!coverPaths[row.listing_id]) coverPaths[row.listing_id] = row.storage_path;
  }
  const urls = await signedUrls(Object.values(coverPaths));

  const result: Record<string, string> = {};
  for (const [listingId, path] of Object.entries(coverPaths)) {
    if (urls[path]) result[listingId] = urls[path];
  }
  return result;
}

/** Detaliul unui anunț, cu vânzătorul embed-uit (nume/avatar/rol/rating). */
export async function fetchMarketListing(
  listingId: string,
): Promise<MarketListingWithSeller | null> {
  const { data } = await supabase
    .from('market_listings')
    .select('*, seller:profiles!seller_id(full_name,avatar_path,deleted_at,role,rating_avg,rating_count)')
    .eq('id', listingId)
    .maybeSingle();
  return (data as unknown as MarketListingWithSeller) ?? null;
}

/** Poză gata de afișat: rândul + URL-ul semnat (ordinea = `position`, cover primul). */
export interface MarketPhotoWithUrl {
  id: string;
  storage_path: string;
  position: number;
  url: string;
}

export async function fetchMarketListingPhotos(
  listingId: string,
): Promise<MarketPhotoWithUrl[]> {
  if (!listingId) return [];
  const { data, error } = await supabase
    .from('market_listing_photos')
    .select('id, storage_path, position')
    .eq('listing_id', listingId)
    .order('position', { ascending: true });
  if (error || !data) return [];

  const rows = data as Pick<MarketListingPhoto, 'id' | 'storage_path' | 'position'>[];
  const urls = await signedUrls(rows.map((r) => r.storage_path));
  return rows
    .filter((r) => urls[r.storage_path])
    .map((r) => ({ ...r, url: urls[r.storage_path] }));
}

export interface MarketListingFields {
  title: string;
  description: string;
  price: number;
  currency: string;
  category: MarketCategory;
}

export async function createMarketListing(
  sellerId: string,
  fields: MarketListingFields,
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('market_listings')
    .insert({ seller_id: sellerId, ...fields } as never)
    .select('id')
    .single();
  return { id: (data as { id: string } | null)?.id ?? null, error: error?.message ?? null };
}

export async function updateMarketListing(
  listingId: string,
  fields: Partial<MarketListingFields>,
): Promise<string | null> {
  const { error } = await supabase
    .from('market_listings')
    .update(fields as never)
    .eq('id', listingId);
  return error?.message ?? null;
}

export async function setMarketListingStatus(
  listingId: string,
  status: 'active' | 'sold',
): Promise<string | null> {
  const { error } = await supabase
    .from('market_listings')
    .update({ status } as never)
    .eq('id', listingId);
  return error?.message ?? null;
}

/** Șterge anunțul: întâi obiectele Storage (client-side, R2), apoi rândul (cascade poze). */
export async function deleteMarketListing(
  listingId: string,
  photoPaths: string[],
): Promise<string | null> {
  await deletePhotos(photoPaths); // best-effort; rândurile cascade oricum
  const { error } = await supabase.from('market_listings').delete().eq('id', listingId);
  return error?.message ?? null;
}

/**
 * Urcă O poză la o poziție explicită (formularul intercalează poze noi printre cele
 * existente la editare — pozițiile finale se decid acolo). Best-effort, modelul
 * uploadAnnouncementPhotos: dacă inserarea rândului eșuează după upload, obiectul
 * se șterge (fără orfani în Storage).
 */
export async function uploadMarketPhotoAt(
  listingId: string,
  photo: PickedImage,
  position: number,
): Promise<boolean> {
  const { path, error } = await uploadPhoto('market', listingId, photo);
  if (error || !path) {
    console.warn('[market] upload poză eșuat:', error);
    return false;
  }
  const { error: insertError } = await supabase
    .from('market_listing_photos')
    .insert({ listing_id: listingId, storage_path: path, position } as never);
  if (insertError) {
    console.warn('[market] insert rând poză eșuat:', insertError.message);
    await deletePhotos([path]);
    return false;
  }
  return true;
}

/** Rescrie poziția unei singure poze existente (folosit de formular la reordonare). */
export async function updateMarketPhotoPosition(photoId: string, position: number): Promise<void> {
  await supabase
    .from('market_listing_photos')
    .update({ position } as never)
    .eq('id', photoId);
}

/** Șterge o singură poză (obiect + rând) — folosit la editare. */
export async function deleteMarketPhoto(photo: { id: string; storage_path: string }): Promise<void> {
  await deletePhotos([photo.storage_path]);
  await supabase.from('market_listing_photos').delete().eq('id', photo.id);
}

/**
 * Contactează vânzătorul (Opțiunea C): RPC-ul pune cumpărătorul pe slotul inițiatorului
 * (driver_id) și vânzătorul pe destinatar (mechanic_id), indiferent de roluri.
 * Erori semnificative: 'blocked_by_you' (clientul oferă deblocarea), 'listing_not_active'.
 */
export async function startMarketConversation(
  listingId: string,
): Promise<{ conversationId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('start_market_conversation', {
    p_listing_id: listingId,
  } as never);
  return { conversationId: (data as string | null) ?? null, error: error?.message ?? null };
}
