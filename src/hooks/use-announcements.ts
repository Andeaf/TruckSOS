import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Announcement, Application, PriceType } from '@/types/database';
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
