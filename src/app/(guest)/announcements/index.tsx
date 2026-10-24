import { GuestAnnouncementsScreen } from '@/components/guest-announcements-screen';
import { useExitConfirm } from '@/hooks/use-exit-confirm';

export default function GuestAnnouncementsRoute() {
  // Tab-ul de start al oaspetelui: back-ul de aici întreabă dacă închide aplicația.
  useExitConfirm();
  return <GuestAnnouncementsScreen />;
}
