import { GuestDetailGate } from '@/components/guest-detail-gate';

/** 25 oct 2026: detaliul din Market cere cont — ruta rămâne doar ca plasă de siguranță. */
export default function GuestMarketDetailRoute() {
  return <GuestDetailGate reason="viewListing" listPath="/(guest)/market" />;
}
