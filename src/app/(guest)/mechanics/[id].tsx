import { GuestDetailGate } from '@/components/guest-detail-gate';

/** 25 oct 2026: profilul cere cont — ruta rămâne doar ca plasă de siguranță. */
export default function GuestMechanicProfileRoute() {
  return <GuestDetailGate reason="viewProfile" listPath="/(guest)/mechanics" />;
}
