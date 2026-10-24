/**
 * 1.1 (B3): harta oaspetelui — wrapper subțire; split-ul nativ/web e la nivel de
 * componentă (vezi `(mechanic)/map/index.tsx`). Pin-urile stau pe coordonatele
 * aproximative (~1 km) din `guest_announcements`.
 */
import MechanicMapScreen from '@/components/mechanic-map-screen';

export default function GuestMapRoute() {
  return <MechanicMapScreen guest />;
}
