import { useCallback, useEffect, useState } from 'react';

import { translateDbError } from '@/lib/db-errors';
import { supabase } from '@/lib/supabase';
import type { Rating } from '@/types/database';

/**
 * Rating mecanici (PLAN_FAZA9.md §4–§5, Bloc 9.4).
 * Regula „doar cu anunț `resolved` comun" e impusă de RLS, nu de UI — funcțiile de
 * aici doar oglindesc regula ca să nu arătăm butoane care oricum ar fi refuzate.
 */

/** Review afișat pe profilul mecanicului. ANONIM: fără nume, fără driver_id. */
export type PublicReview = Pick<Rating, 'id' | 'stars' | 'comment' | 'created_at'>;

/**
 * Upsert pe (mechanic_id, driver_id): prima dată trece prin politica INSERT, apoi
 * prin UPDATE. Ambele cer un anunț `resolved` comun. Trigger-ul recalculează media.
 */
export async function upsertRating(
  mechanicId: string,
  driverId: string,
  stars: number,
  comment: string | null,
): Promise<string | null> {
  const { error } = await supabase
    .from('ratings')
    .upsert(
      { mechanic_id: mechanicId, driver_id: driverId, stars, comment } as never,
      { onConflict: 'mechanic_id,driver_id' },
    );
  return translateDbError(error);
}

/** Rating-ul MEU pentru un mecanic (pt. pre-completarea sheet-ului la re-evaluare). */
export function useMyRatingFor(mechanicId: string | undefined, driverId: string | undefined) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!mechanicId || !driverId) { setRating(null); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('ratings')
      .select('*')
      .eq('mechanic_id', mechanicId)
      .eq('driver_id', driverId)
      .maybeSingle();
    setRating((data as unknown as Rating) ?? null);
    setLoading(false);
  }, [mechanicId, driverId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { rating, loading, refresh };
}

/** Review-urile publice ale unui mecanic — FĂRĂ join la profiles: rămân anonime. */
export function useMechanicReviews(mechanicId: string | undefined) {
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!mechanicId) { setReviews([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('ratings')
      .select('id, stars, comment, created_at')
      .eq('mechanic_id', mechanicId)
      .order('created_at', { ascending: false })
      .limit(100);
    setReviews((data as unknown as PublicReview[]) ?? []);
    setLoading(false);
  }, [mechanicId]);

  useEffect(() => { refresh(); }, [refresh]);

  return { reviews, loading, refresh };
}

/**
 * Poate șoferul curent să evalueze acest mecanic? (= are un anunț `resolved` cu el)
 * Aceeași condiție ca în RLS. Doar `head`, fără să aducem rânduri.
 */
export function useCanRate(mechanicId: string | undefined, driverId: string | undefined) {
  const [canRate, setCanRate] = useState(false);

  useEffect(() => {
    let active = true;
    if (!mechanicId || !driverId) { setCanRate(false); return; }

    supabase
      .from('announcements')
      .select('id', { count: 'exact', head: true })
      .eq('driver_id', driverId)
      .eq('mechanic_id', mechanicId)
      .eq('status', 'resolved')
      .then(({ count }) => { if (active) setCanRate((count ?? 0) > 0); });

    return () => { active = false; };
  }, [mechanicId, driverId]);

  return canRate;
}
