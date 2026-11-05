import { useAuth } from '@/hooks/use-auth';
import { useSettings } from '@/hooks/use-settings';

/**
 * Modul admin „vezi ca mecanic” (1.1): serverul îi dă adminului plăcuța, VIN-ul și
 * coordonatele exacte (by design), dar la testare trebuie să vadă ce vede un mecanic.
 * Masca e DOAR client-side, pentru teste; pentru mecanicii reali sursa adevărului rămâne
 * serverul (view-ul `announcements` și `open_announcements_near` le maschează acolo).
 * Pentru mecanici și pentru admin în modul admin/șofer întoarce false — nimic nu se schimbă.
 */
export function useAdminMechanicMask(): boolean {
  const { profile } = useAuth();
  const { adminViewAs } = useSettings();
  return profile?.role === 'admin' && adminViewAs === 'mechanic';
}

/**
 * Coordonata la ~1 km, ca coloanele generate `lat_approx`/`lng_approx` de pe server
 * (`round(latitude::numeric, 2)`). Aproape identic (la jumătate exactă pe valori negative
 * rotunjirea JS diferă de cea din Postgres) — suficient pentru o mască de test.
 */
export function approxCoordinate(value: number | null): number | null {
  return value == null ? null : Math.round(value * 100) / 100;
}
