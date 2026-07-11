import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase';
import type { Truck } from '@/types/database';

export function useSavedTrucks() {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('trucks')
      .select('*')
      .order('created_at', { ascending: true });
    setTrucks(data ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  return { trucks, loading, refresh: load };
}

export async function addTruck(
  data: Omit<Truck, 'id' | 'created_at'>
): Promise<string | null> {
  const { error } = await supabase.from('trucks').insert(data);
  return error?.message ?? null;
}

export async function updateTruck(
  id: string,
  data: Partial<Pick<Truck, 'make' | 'model' | 'year' | 'nickname' | 'plate_number'>>
): Promise<string | null> {
  const { error } = await supabase.from('trucks').update(data).eq('id', id);
  return error?.message ?? null;
}

export async function deleteTruck(id: string): Promise<string | null> {
  const { error } = await supabase.from('trucks').delete().eq('id', id);
  return error?.message ?? null;
}
