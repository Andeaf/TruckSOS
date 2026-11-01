import { useCallback, useEffect, useState } from 'react';

import { translateDbError } from '@/lib/db-errors';
import { supabase } from '@/lib/supabase';
import type { Announcement, Application, Profile, PriceType, PublicUser } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';

export type AnnouncementWithMechanic = Announcement & {
  mechanic: PublicUser | null;
};

export type AnnouncementWithDriver = Announcement & {
  driver: PublicUser | null;
};

// Hook for driver: own announcements (all statuses)
export function useMyAnnouncements() {
  const { session } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Fără sesiune încă (hidratare): nu lăsa `loading` blocat pe true —
    // pe iOS asta ținea insetul de RefreshControl inserat (gol sub antet).
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('announcements')
      .select('*')
      // „Ale mele" se cere EXPLICIT, nu se deduce din RLS: pentru admin (modul
      // „ca șofer"), politica aditivă is_admin() întoarce TOATE anunțurile —
      // fără filtru, anunțurile altora apăreau drept ale adminului.
      .eq('driver_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    setAnnouncements((data as Announcement[]) ?? []);
    setLoading(false);
  }, [session]);

  return { announcements, loading, refresh };
}

/** Anunț din feed-ul pe rază (1.1, faza 4.3): forma de azi + distanța calculată de server. */
export type OpenAnnouncementNear = AnnouncementWithDriver & {
  /** km față de poziția trimisă; null fără poziție sau pentru anunțurile fără coordonate. */
  distance_km: number | null;
};

/** Rândul întors de RPC-ul `open_announcements_near` (tipurile generate îl primesc în 4.5). */
type OpenAnnouncementNearRow = Omit<Announcement, 'plate_number' | 'chassis_number'> & {
  lat_approx: number | string | null;
  lng_approx: number | string | null;
  distance_km: number | null;
  driver_full_name: string | null;
  driver_avatar_path: string | null;
};

export interface OpenAnnouncementsNearParams {
  /** Raza + poziția: toate trei sau niciuna (serverul ignoră raza fără poziție). */
  latitude?: number;
  longitude?: number;
  radiusKm?: number;
  limit: number;
  /** Cursor: `created_at` BRUT al ultimului rând (cu microsecunde — nu trece prin Date). */
  before?: string;
}

/**
 * Feed-ul mecanicului (1.1, faza 4.3), calculat pe server: anunțurile `open` ale ALTORA
 * (serverul le exclude pe ale tale, după sesiune), fără plăcuță/VIN, coordonatele deja
 * mascate (~1 km pentru cine nu e șoferul, mecanicul acceptat sau admin). Cu rază:
 * ordonat după distanță, cel mult 100; fără rază: created_at DESC, paginat cu `before`.
 * Nu aruncă: eroarea se întoarce, iar apelantul păstrează lista veche.
 */
export async function fetchOpenAnnouncementsNear(
  params: OpenAnnouncementsNearParams,
): Promise<{ data: OpenAnnouncementNear[]; error: { code?: string; message: string } | null }> {
  const args: Record<string, unknown> = { p_limit: params.limit };
  if (params.latitude != null && params.longitude != null && params.radiusKm != null) {
    args.p_lat = params.latitude;
    args.p_lng = params.longitude;
    args.p_radius_km = params.radiusKm;
  }
  if (params.before) args.p_before = params.before;
  try {
    const { data, error } = await supabase.rpc('open_announcements_near' as never, args as never);
    if (error) return { data: [], error };
    const rows = (data ?? []) as unknown as OpenAnnouncementNearRow[];
    return {
      data: rows.map(
        ({ lat_approx: _lat, lng_approx: _lng, driver_full_name, driver_avatar_path, ...rest }) => ({
          ...rest,
          plate_number: null,
          chassis_number: null,
          driver: { full_name: driver_full_name ?? '', avatar_path: driver_avatar_path, deleted_at: null },
        }),
      ),
      error: null,
    };
  } catch (e) {
    return { data: [], error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

export interface CreateAnnouncementOptions {
  truckMake?: string;
  truckModel?: string;
  truckYear?: number | null;
  plateNumber?: string;
  /** Seria de șasiu (VIN) — obligatorie în formular (validare client-side). */
  chassisNumber?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export async function createAnnouncement(
  driverId: string,
  description: string,
  location: string,
  options: CreateAnnouncementOptions = {},
): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      driver_id: driverId,
      description,
      location,
      status: 'open',
      truck_make: options.truckMake || null,
      truck_model: options.truckModel || null,
      truck_year: options.truckYear ?? null,
      plate_number: options.plateNumber || null,
      chassis_number: options.chassisNumber || null,
      latitude: options.latitude ?? null,
      longitude: options.longitude ?? null,
    } as never)
    .select('id')
    .single();
  return { id: (data as { id: string } | null)?.id ?? null, error: translateDbError(error) };
}

export async function resolveAnnouncement(id: string): Promise<string | null> {
  const { error } = await supabase
    .from('announcements')
    .update({ status: 'resolved' } as never)
    .eq('id', id);
  return translateDbError(error);
}

export async function cancelAnnouncement(id: string): Promise<string | null> {
  const { error } = await supabase
    .from('announcements')
    .update({ status: 'cancelled' } as never)
    .eq('id', id);
  return translateDbError(error);
}

/**
 * „Marchează ca rezolvat" pe un anunț ÎNCĂ `open` (caseta din „Anunțurile mele",
 * 4 sept) SAU deja `cancelled` (expirat la 30h / anulat — 15 sept, migrarea
 * 20260915): RPC-ul rezolvă + respinge candidaturile `pending` atomic (RLS nu permite
 * `open → resolved` sau `cancelled → resolved` prin UPDATE direct, iar respingerile nu
 * se pot face din client). Pentru `accepted` rămâne resolveAnnouncement().
 */
export async function resolveOpenAnnouncement(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('resolve_open_announcement', {
    p_announcement_id: id,
  } as never);
  return translateDbError(error);
}

/**
 * Durata de viață a unui anunț `open` — EF cleanup-announcements îl trece în `cancelled`
 * după 30h (regula din 4 sept; constanta HOURS din funcție). Aceeași valoare decide
 * când apare „Repostează" și când serverul acceptă repostarea (repost_announcement).
 */
export const ANNOUNCEMENT_LIFETIME_MS = 30 * 60 * 60 * 1000;

/** Anunț `cancelled` mai vechi de 30h = expirat (sau anulat demult) → se poate reposta. */
export function canRepostAnnouncement(
  a: Pick<Announcement, 'status' | 'created_at'>,
  now: number = Date.now(),
): boolean {
  return (
    a.status === 'cancelled' && now - new Date(a.created_at).getTime() >= ANNOUNCEMENT_LIFETIME_MS
  );
}

/**
 * „Repostează pentru 30 de ore" (15 sept): RPC-ul `repost_announcement` — anunțul
 * revine `open` cu created_at = acum (urcă în capul feedului, primește din nou 30h) și
 * mecanicii din rază primesc push ca la un anunț nou. Doar pe anunț propriu `cancelled`
 * mai vechi de 30h (gardă server-side contra buclei anulează→repostează).
 */
export async function repostAnnouncement(id: string): Promise<string | null> {
  const { error } = await supabase.rpc('repost_announcement', {
    p_announcement_id: id,
  } as never);
  return translateDbError(error);
}

/**
 * Vizualizări pe anunțuri (24 sept) — cifra o văd DOAR adminii (Admin → Conținut).
 * Apelat la deschiderea detaliului; serverul numără o dată per utilizator și sare
 * peste autor și admini, deci se poate apela necondiționat. Fire-and-forget: o
 * eroare aici nu trebuie să atingă ecranul.
 */
export function recordAnnouncementView(id: string): void {
  supabase
    .rpc('record_announcement_view', { p_announcement_id: id } as never)
    .then(() => {}, () => {});
}

export async function deleteAnnouncement(id: string): Promise<string | null> {
  // Reject pending applications so mechanics see "Respins" instead of a disappeared entry
  await supabase
    .from('applications')
    .update({ status: 'rejected' } as never)
    .eq('announcement_id', id)
    .eq('status', 'pending');

  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', id);

  return translateDbError(error);
}

export async function fetchAnnouncementById(
  id: string
): Promise<AnnouncementWithMechanic | null> {
  const { data } = await supabase
    .from('announcements')
    .select('*, mechanic:profiles!mechanic_id(full_name,avatar_path,deleted_at)')
    .eq('id', id)
    .single();
  return (data as unknown as AnnouncementWithMechanic) ?? null;
}

export async function acceptAnnouncement(announcementId: string): Promise<string | null> {
  const { error } = await supabase.rpc('accept_announcement', {
    p_announcement_id: announcementId,
  } as never);
  return translateDbError(error);
}

export async function fetchOpenAnnouncementById(
  id: string
): Promise<AnnouncementWithDriver | null> {
  const { data } = await supabase
    .from('announcements')
    .select('*, driver:profiles!driver_id(full_name,avatar_path,deleted_at)')
    .eq('id', id)
    .single();
  return (data as unknown as AnnouncementWithDriver) ?? null;
}

export async function applyToAnnouncement(
  announcementId: string,
  priceType: PriceType,
  priceAmount: number,
  currency: string,
  message: string | null,
): Promise<{ error: string | null; duplicate: boolean }> {
  const { error } = await supabase.rpc('apply_to_announcement', {
    p_announcement_id: announcementId,
    p_price_type: priceType,
    p_price_amount: priceAmount,
    p_currency: currency,
    p_message: message || null,
  } as never);
  // `duplicate` = deja ai candidat (unique pe announcement_id + mechanic_id, 23505); textul e tradus.
  return { error: translateDbError(error), duplicate: (error as { code?: string } | null)?.code === '23505' };
}

export async function fetchRejectedAnnouncementIds(mechanicId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('applications')
    .select('announcement_id')
    .eq('mechanic_id', mechanicId)
    .eq('status', 'rejected')
    .limit(200);
  return new Set((data ?? []).map((r) => r.announcement_id));
}

/** 26 iul: anunțurile cu candidatura mea ÎN AȘTEPTARE — feed-ul le arată „În așteptare"
 * în loc de „Deschis" (același tipar ca fetchRejectedAnnouncementIds). */
export async function fetchPendingApplicationAnnouncementIds(
  mechanicId: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from('applications')
    .select('announcement_id')
    .eq('mechanic_id', mechanicId)
    .eq('status', 'pending')
    .limit(200);
  const rows = ((data ?? []) as unknown) as { announcement_id: string }[];
  return new Set(rows.map((r) => r.announcement_id));
}

export async function fetchMyApplicationForAnnouncement(
  announcementId: string,
): Promise<Application | null> {
  const { data } = await supabase
    .from('applications')
    .select('*')
    .eq('announcement_id', announcementId)
    .maybeSingle();
  return (data as Application) ?? null;
}

export type ApplicationWithMechanic = Application & {
  mechanic: Pick<
    Profile,
    | 'id'
    | 'full_name'
    | 'specialization'
    | 'activity_zone'
    | 'rating_avg'
    | 'rating_count'
    | 'avatar_path'
    | 'deleted_at'
  >;
};

export async function acceptApplication(
  applicationId: string
): Promise<{ conversationId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('accept_application', {
    p_application_id: applicationId,
  } as never);
  return { conversationId: (data as string) ?? null, error: translateDbError(error) };
}

export async function rejectApplication(applicationId: string): Promise<string | null> {
  const { error } = await supabase.rpc('reject_application', {
    p_application_id: applicationId,
  } as never);
  return translateDbError(error);
}

export async function withdrawApplication(applicationId: string): Promise<string | null> {
  const { error } = await supabase.rpc('withdraw_application', {
    p_application_id: applicationId,
  } as never);
  return translateDbError(error);
}

export async function dismissApplication(applicationId: string): Promise<string | null> {
  const { error } = await supabase.rpc('dismiss_application', {
    p_application_id: applicationId,
  } as never);
  return translateDbError(error);
}

export async function resubmitApplication(
  applicationId: string,
  priceType: PriceType,
  priceAmount: number,
  currency: string,
  message: string | null,
): Promise<{ error: string | null; duplicate: boolean }> {
  const { error } = await supabase.rpc('resubmit_application', {
    p_application_id: applicationId,
    p_price_type: priceType,
    p_price_amount: priceAmount,
    p_currency: currency,
    p_message: message || null,
  } as never);
  return { error: translateDbError(error), duplicate: (error as { code?: string } | null)?.code === '23505' };
}

/**
 * Câte oferte în așteptare are fiecare anunț al șoferului (pt. badge-ul din listă).
 * Un singur query pentru toate anunțurile; numărăm client-side. RLS lasă șoferul să
 * vadă candidaturile pe anunțurile proprii, deci nu e nevoie de RPC.
 */
export async function fetchPendingApplicationCounts(
  announcementIds: string[]
): Promise<Record<string, number>> {
  if (announcementIds.length === 0) return {};
  const { data } = await supabase
    .from('applications')
    .select('announcement_id')
    .eq('status', 'pending')
    .in('announcement_id', announcementIds)
    .limit(200);

  const counts: Record<string, number> = {};
  ((data ?? []) as unknown as { announcement_id: string }[]).forEach((row) => {
    counts[row.announcement_id] = (counts[row.announcement_id] ?? 0) + 1;
  });
  return counts;
}

export async function fetchApplicationsForAnnouncement(
  announcementId: string
): Promise<ApplicationWithMechanic[]> {
  const { data } = await supabase
    .from('applications')
    .select(
      '*, mechanic:profiles!mechanic_id(id, full_name, specialization, activity_zone, rating_avg, rating_count, avatar_path, deleted_at)'
    )
    .eq('announcement_id', announcementId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(200);
  return (data as unknown as ApplicationWithMechanic[]) ?? [];
}

export type ApplicationWithDetails = Application & {
  announcement: Pick<
    Announcement,
    'id' | 'driver_id' | 'location' | 'description' | 'status' | 'truck_make' | 'truck_model' | 'truck_year' | 'plate_number' | 'chassis_number' | 'latitude' | 'longitude'
  > & {
    driver: PublicUser | null;
    conversations: { id: string }[];
  };
};

export function useMyApplications() {
  const { session } = useAuth();
  const [applications, setApplications] = useState<ApplicationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Fără sesiune încă (hidratare): nu lăsa `loading` blocat pe true —
    // pe iOS asta ținea insetul de RefreshControl inserat (gol sub antet).
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('applications')
      .select(
        `*, announcement:announcements!announcement_id(
          id, driver_id, location, description, status, truck_make, truck_model, truck_year, plate_number, chassis_number, latitude, longitude,
          driver:profiles!driver_id(full_name,avatar_path),
          conversations(id)
        )`
      )
      .eq('mechanic_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(200);
    const all = (data as unknown as ApplicationWithDetails[]) ?? [];
    setApplications(all.filter((a) => a.announcement != null));
    setLoading(false);
  }, [session]);

  return { applications, loading, refresh };
}

export function useApplication(id: string) {
  const [application, setApplication] = useState<ApplicationWithDetails | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('applications')
      .select(
        `*, announcement:announcements!announcement_id(
          id, driver_id, location, description, status, truck_make, truck_model, truck_year, plate_number, chassis_number, latitude, longitude,
          driver:profiles!driver_id(full_name,avatar_path),
          conversations(id)
        )`
      )
      .eq('id', id)
      .single();
    setApplication((data as unknown as ApplicationWithDetails) ?? null);
    setLoading(false);
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  return { application, loading, refresh };
}
