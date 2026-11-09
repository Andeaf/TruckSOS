import { useCallback, useEffect, useState } from 'react';

import i18n from '@/i18n';
import { translateDbError } from '@/lib/db-errors';
import { deletePhotos } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import type { Announcement, Application, Profile, PriceType, PublicUser } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';

export type AnnouncementWithMechanic = Announcement & {
  mechanic: PublicUser | null;
};

export type AnnouncementWithDriver = Announcement & {
  driver: PublicUser | null;
};

// Hook for driver: own announcements (all statuses, fără ciorne — 7.2)
export function useMyAnnouncements() {
  const { session } = useAuth();
  // 1.1 (7.4): dependența e id-ul contului, nu obiectul `session` (reîmprospătarea
  // tokenului creează un obiect nou → `refresh` nou → reîncărcări inutile la apelanți).
  const userId = session?.user.id;
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Fără sesiune încă (hidratare): nu lăsa `loading` blocat pe true —
    // pe iOS asta ținea insetul de RefreshControl inserat (gol sub antet).
    if (!userId) {
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
      .eq('driver_id', userId)
      // 1.1 (7.2): ciornele sunt tranzitorii (create → poze → publicare, în câteva secunde);
      // una rămasă după o publicare eșuată o șterge retenția după 24 h — nu se arată în listă.
      .neq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(200);
    setAnnouncements((data as Announcement[]) ?? []);
    setLoading(false);
  }, [userId]);

  return { announcements, loading, refresh };
}

/** Anunț din feed-ul pe rază (1.1, faza 4.3): forma de azi + distanța calculată de server. */
export type OpenAnnouncementNear = AnnouncementWithDriver & {
  /** km față de poziția trimisă; null fără poziție sau pentru anunțurile fără coordonate. */
  distance_km: number | null;
};

/** Rândul întors de RPC-ul `open_announcements_near`. Tipurile generate există din 4.5 (Functions), dar fără `| null` pe coloanele nullable; override-ul din `src/types/database-overrides.ts` acoperă intenționat doar view-urile, nu Functions, deci pentru rândurile RPC tipul local rămâne sursa. */
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
    const { data, error } = await supabase.rpc('open_announcements_near', args as never);
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

/**
 * 1.1 (7.2): anunțul se creează ca CIORNĂ (`status: 'draft'`): pozele se urcă înainte ca mecanicii
 * să-l vadă și să primească push-ul, iar `publishAnnouncement` îl deschide. `status` întors e cel
 * real de pe server: serverul de dinainte de faza 6 forțează `open` la INSERT (garda scrierilor
 * de client) → apelantul sare peste publicare (fluxul vechi: anunț + push la INSERT).
 */
export async function createAnnouncement(
  driverId: string,
  description: string,
  location: string,
  options: CreateAnnouncementOptions = {},
): Promise<{ id: string | null; status: string | null; error: string | null }> {
  const { data, error } = await supabase
    .from('announcements')
    .insert({
      driver_id: driverId,
      description,
      location,
      status: 'draft',
      truck_make: options.truckMake || null,
      truck_model: options.truckModel || null,
      truck_year: options.truckYear ?? null,
      plate_number: options.plateNumber || null,
      chassis_number: options.chassisNumber || null,
      latitude: options.latitude ?? null,
      longitude: options.longitude ?? null,
    })
    .select('id, status')
    .single();
  return { id: data?.id ?? null, status: data?.status ?? null, error: translateDbError(error) };
}

/**
 * 1.1 (7.2): publicarea ciornei (`draft → open`): serverul verifică plafonul de anunțuri deschise
 * (`rate_limited` / `announcements_open` → text propriu în translateDbError) și trimite push-ul
 * către mecanici. Filtrul pe `draft` face reîncercarea sigură: dacă prima cerere a ajuns pe server
 * dar răspunsul s-a pierdut (rețea slabă), a doua nu mai potrivește niciun rând și nu întoarce
 * eroare — anunțul e deja publicat, deci „0 rânduri, fără eroare” = succes.
 */
export async function publishAnnouncement(
  id: string,
): Promise<{ error: string | null; gone?: boolean }> {
  const { data, error } = await supabase
    .from('announcements')
    .update({ status: 'open' })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id');
  if (!error && (data?.length ?? 0) === 0) {
    // 0 rânduri potrivite nu înseamnă neapărat „deja publicat” (review 9 nov): ciorna poate fi ștearsă
    // (retenția după 24 h, rollback) sau UPDATE-ul refuzat în tăcere de RLS. Verificăm starea reală.
    const { data: row } = await supabase.from('announcements').select('status').eq('id', id).maybeSingle();
    if (row?.status === 'open') return { error: null };
    return { error: i18n.t('common.error'), gone: true };
  }
  return { error: translateDbError(error) };
}

export async function resolveAnnouncement(id: string): Promise<string | null> {
  const { error } = await supabase
    .from('announcements')
    .update({ status: 'resolved' })
    .eq('id', id);
  return translateDbError(error);
}

export async function cancelAnnouncement(id: string): Promise<string | null> {
  const { error } = await supabase
    .from('announcements')
    .update({ status: 'cancelled' })
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

/**
 * Ștergerea anunțului propriu. 1.1 (7.2): fără fostul `PATCH applications` (status → rejected) —
 * politicile din 25 oct îl refuză (403 în jurnal la fiecare ștergere), iar candidaturile cad oricum
 * prin `ON DELETE CASCADE`. Pozele se șterg din Storage ÎNAINTE de rând: politica de DELETE pe
 * Storage cere ca rândul anunțului să existe încă; rândurile `announcement_photos` cad prin cascadă.
 * Eșecul la poze nu blochează ștergerea (rămân orfane, doar logate).
 */
export async function deleteAnnouncement(id: string): Promise<string | null> {
  const { data: photoRows, error: photosReadError } = await supabase
    .from('announcement_photos')
    .select('storage_path')
    .eq('announcement_id', id)
    .limit(20);
  if (photosReadError) {
    console.warn('[announcements] citirea pozelor înainte de ștergere a eșuat:', photosReadError.message);
  } else {
    const paths = (photoRows ?? []).map((r) => r.storage_path);
    const photosError = await deletePhotos(paths);
    if (photosError) console.warn('[announcements] ștergerea pozelor din Storage a eșuat:', photosError);
  }

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
  return (data as AnnouncementWithMechanic | null) ?? null;
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
  return (data as AnnouncementWithDriver | null) ?? null;
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
  return (data as ApplicationWithMechanic[] | null) ?? [];
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
  // 1.1 (7.4): vezi useMyAnnouncements — dependența e id-ul contului, nu `session`.
  const userId = session?.user.id;
  const [applications, setApplications] = useState<ApplicationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    // Fără sesiune încă (hidratare): nu lăsa `loading` blocat pe true —
    // pe iOS asta ținea insetul de RefreshControl inserat (gol sub antet).
    if (!userId) {
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
      .eq('mechanic_id', userId)
      .order('created_at', { ascending: false })
      .limit(200);
    const all = (data as ApplicationWithDetails[] | null) ?? [];
    setApplications(all.filter((a) => a.announcement != null));
    setLoading(false);
  }, [userId]);

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
    setApplication((data as ApplicationWithDetails | null) ?? null);
    setLoading(false);
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  return { application, loading, refresh };
}
