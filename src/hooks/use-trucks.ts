import { useCallback, useEffect, useState } from 'react';

import { translateDbError } from '@/lib/db-errors';
import { supabase } from '@/lib/supabase';
import type { Truck } from '@/types/database';

export function useSavedTrucks(enabled = true) {
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [loading, setLoading] = useState(true);

  // `useCallback` cu dependențe goale (26 oct 2026, AUDIT #43): `refresh` era o funcție nouă la
  // fiecare randare, iar Profilul șoferului o consuma prin `useFocusEffect(useCallback(…, [refresh]))`
  // → după fiecare răspuns se re-randa, `refresh` se schimba, efectul rula din nou: o buclă infinită
  // de citiri ale camioanelor cât ecranul era deschis (~38 % din toate cererile REST ale aplicației).
  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('trucks')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(50);
    setTrucks(data ?? []);
    setLoading(false);
  }, []);

  // `enabled=false` (1.1, oaspeți): fără cerere — anon nu are drepturi pe `trucks`.
  useEffect(() => { if (enabled) void load(); }, [enabled, load]);

  return { trucks, loading, refresh: load };
}

export async function addTruck(
  data: Omit<Truck, 'id' | 'created_at'>
): Promise<string | null> {
  const { error } = await supabase.from('trucks').insert(data);
  return translateDbError(error);
}

export async function updateTruck(
  id: string,
  data: Partial<
    Pick<Truck, 'make' | 'model' | 'year' | 'nickname' | 'plate_number' | 'chassis_number'>
  >
): Promise<string | null> {
  const { error } = await supabase.from('trucks').update(data).eq('id', id);
  return translateDbError(error);
}

export async function deleteTruck(id: string): Promise<string | null> {
  const { error } = await supabase.from('trucks').delete().eq('id', id);
  return translateDbError(error);
}
