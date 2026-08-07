import { AnnouncementsListScreen } from '@/components/announcements-list-screen';
import { useExitConfirm } from '@/hooks/use-exit-confirm';

export default function DriverAnnouncementsScreen() {
  // Tab-ul de start al șoferului: back-ul de aici întreabă dacă închide aplicația.
  useExitConfirm();
  return <AnnouncementsListScreen />;
}
