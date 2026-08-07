import { useCallback, useEffect, useState } from 'react';

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
      .order('created_at', { ascending: false });
    setAnnouncements((data as Announcement[]) ?? []);
    setLoading(false);
  }, [session]);

  return { announcements, loading, refresh };
}

// Hook for mechanic: all open announcements from all drivers
// (5 aug) `excludeUserId`: mecanicii pot posta și ei anunțuri — pe feed/hartă
// propriile anunțuri se exclud (nu-ți poți face ofertă singur; ale tale stau
// sub segmentul „Ale mele").
export function useOpenAnnouncements(excludeUserId?: string) {
  const [announcements, setAnnouncements] = useState<AnnouncementWithDriver[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('announcements')
      .select('*, driver:profiles!driver_id(full_name,avatar_path)')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    if (excludeUserId) query = query.neq('driver_id', excludeUserId);
    const { data } = await query;
    setAnnouncements((data as unknown as AnnouncementWithDriver[]) ?? []);
    setLoading(false);
  }, [excludeUserId]);

  return { announcements, loading, refresh };
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
  return { id: (data as { id: string } | null)?.id ?? null, error: error?.message ?? null };
}

export async function resolveAnnouncement(id: string): Promise<string | null> {
  const { error } = await supabase
    .from('announcements')
    .update({ status: 'resolved' } as never)
    .eq('id', id);
  return error?.message ?? null;
}

export async function cancelAnnouncement(id: string): Promise<string | null> {
  const { error } = await supabase
    .from('announcements')
    .update({ status: 'cancelled' } as never)
    .eq('id', id);
  return error?.message ?? null;
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

  return error?.message ?? null;
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
  return error?.message ?? null;
}

export async function fetchOpenAnnouncementById(
  id: string
): Promise<AnnouncementWithDriver | null> {
  const { data } = await supabase
    .from('announcements')
    .select('*, driver:profiles!driver_id(full_name,avatar_path)')
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
): Promise<string | null> {
  const { error } = await supabase.rpc('apply_to_announcement', {
    p_announcement_id: announcementId,
    p_price_type: priceType,
    p_price_amount: priceAmount,
    p_currency: currency,
    p_message: message || null,
  } as never);
  return error?.message ?? null;
}

export async function fetchRejectedAnnouncementIds(mechanicId: string): Promise<Set<string>> {
  const { data } = await supabase
    .from('applications')
    .select('announcement_id')
    .eq('mechanic_id', mechanicId)
    .eq('status', 'rejected');
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
    .eq('status', 'pending');
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
  >;
};

export async function acceptApplication(
  applicationId: string
): Promise<{ conversationId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('accept_application', {
    p_application_id: applicationId,
  } as never);
  return { conversationId: (data as string) ?? null, error: error?.message ?? null };
}

export async function rejectApplication(applicationId: string): Promise<string | null> {
  const { error } = await supabase.rpc('reject_application', {
    p_application_id: applicationId,
  } as never);
  return error?.message ?? null;
}

export async function withdrawApplication(applicationId: string): Promise<string | null> {
  const { error } = await supabase.rpc('withdraw_application', {
    p_application_id: applicationId,
  } as never);
  return error?.message ?? null;
}

export async function dismissApplication(applicationId: string): Promise<string | null> {
  const { error } = await supabase.rpc('dismiss_application', {
    p_application_id: applicationId,
  } as never);
  return error?.message ?? null;
}

export async function resubmitApplication(
  applicationId: string,
  priceType: PriceType,
  priceAmount: number,
  currency: string,
  message: string | null,
): Promise<string | null> {
  const { error } = await supabase.rpc('resubmit_application', {
    p_application_id: applicationId,
    p_price_type: priceType,
    p_price_amount: priceAmount,
    p_currency: currency,
    p_message: message || null,
  } as never);
  return error?.message ?? null;
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
    .in('announcement_id', announcementIds);

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
      '*, mechanic:profiles!mechanic_id(id, full_name, specialization, activity_zone, rating_avg, rating_count, avatar_path)'
    )
    .eq('announcement_id', announcementId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return (data as unknown as ApplicationWithMechanic[]) ?? [];
}

export type ApplicationWithDetails = Application & {
  announcement: Pick<
    Announcement,
    'id' | 'location' | 'description' | 'status' | 'truck_make' | 'truck_model' | 'truck_year' | 'plate_number' | 'chassis_number' | 'latitude' | 'longitude'
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
          id, location, description, status, truck_make, truck_model, truck_year, plate_number, chassis_number, latitude, longitude,
          driver:profiles!driver_id(full_name,avatar_path),
          conversations(id)
        )`
      )
      .eq('mechanic_id', session.user.id)
      .order('created_at', { ascending: false });
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
          id, location, description, status, truck_make, truck_model, truck_year, plate_number, chassis_number, latitude, longitude,
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
