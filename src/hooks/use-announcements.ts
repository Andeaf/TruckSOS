import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Announcement, Application, Profile, PriceType } from '@/types/database';
import { useAuth } from '@/hooks/use-auth';

export type AnnouncementWithMechanic = Announcement & {
  mechanic: { full_name: string } | null;
};

export type AnnouncementWithDriver = Announcement & {
  driver: { full_name: string } | null;
};

// Hook for driver: own announcements (all statuses)
export function useMyAnnouncements() {
  const { session } = useAuth();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });
    setAnnouncements((data as Announcement[]) ?? []);
    setLoading(false);
  }, [session]);

  return { announcements, loading, refresh };
}

// Hook for mechanic: all open announcements from all drivers
export function useOpenAnnouncements() {
  const [announcements, setAnnouncements] = useState<AnnouncementWithDriver[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('announcements')
      .select('*, driver:profiles!driver_id(full_name)')
      .eq('status', 'open')
      .order('created_at', { ascending: false });
    setAnnouncements((data as unknown as AnnouncementWithDriver[]) ?? []);
    setLoading(false);
  }, []);

  return { announcements, loading, refresh };
}

export async function createAnnouncement(
  driverId: string,
  description: string,
  location: string,
  truckMake?: string,
  truckModel?: string,
  truckYear?: number | null,
  plateNumber?: string,
): Promise<string | null> {
  const { error } = await supabase
    .from('announcements')
    .insert({
      driver_id: driverId,
      description,
      location,
      status: 'open',
      truck_make: truckMake || null,
      truck_model: truckModel || null,
      truck_year: truckYear ?? null,
      plate_number: plateNumber || null,
    } as never);
  return error?.message ?? null;
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
    .select('*, mechanic:profiles!mechanic_id(full_name)')
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
    .select('*, driver:profiles!driver_id(full_name)')
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
  mechanic: Pick<Profile, 'id' | 'full_name' | 'specialization' | 'activity_zone'>;
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

export async function fetchApplicationsForAnnouncement(
  announcementId: string
): Promise<ApplicationWithMechanic[]> {
  const { data } = await supabase
    .from('applications')
    .select('*, mechanic:profiles!mechanic_id(id, full_name, specialization, activity_zone)')
    .eq('announcement_id', announcementId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  return (data as unknown as ApplicationWithMechanic[]) ?? [];
}

export type ApplicationWithDetails = Application & {
  announcement: Pick<
    Announcement,
    'id' | 'location' | 'description' | 'status' | 'truck_make' | 'truck_model' | 'truck_year' | 'plate_number'
  > & {
    driver: { full_name: string } | null;
    conversations: { id: string }[];
  };
};

export function useMyApplications() {
  const { session } = useAuth();
  const [applications, setApplications] = useState<ApplicationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    const { data } = await supabase
      .from('applications')
      .select(
        `*, announcement:announcements!announcement_id(
          id, location, description, status, truck_make, truck_model, truck_year, plate_number,
          driver:profiles!driver_id(full_name),
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
          id, location, description, status, truck_make, truck_model, truck_year, plate_number,
          driver:profiles!driver_id(full_name),
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
