import { useCallback, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Announcement } from '@/types/database';
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
  location: string
): Promise<string | null> {
  const { error } = await supabase
    .from('announcements')
    .insert({ driver_id: driverId, description, location, status: 'open' } as never);
  return error?.message ?? null;
}

export async function resolveAnnouncement(id: string): Promise<string | null> {
  const { error } = await supabase
    .from('announcements')
    .update({ status: 'resolved' } as never)
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
