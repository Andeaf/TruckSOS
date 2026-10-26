import { GuestDetailGate } from '@/components/guest-detail-gate';

/** 25 oct 2026: detaliul anunțului cere cont — ruta rămâne doar ca plasă de siguranță. */
export default function GuestAnnouncementDetailRoute() {
  return <GuestDetailGate reason="viewAnnouncement" listPath="/(guest)/announcements" />;
}
