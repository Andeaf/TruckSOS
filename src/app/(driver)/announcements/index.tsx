import { AnnouncementsListScreen } from '@/components/announcements-list-screen';
import { useExitConfirm } from '@/hooks/use-exit-confirm';
import { useNotificationPrimerOnStart } from '@/hooks/use-notification-primer';

export default function DriverAnnouncementsScreen() {
  // Tab-ul de start al șoferului: back-ul de aici întreabă dacă închide aplicația.
  useExitConfirm();
  // 1.1 (7.6): contul existent fără permisiunea de notificări (telefon nou / reinstalare)
  // primește aici foaia „Află imediat când…”, o dată pe rulare.
  useNotificationPrimerOnStart();
  return <AnnouncementsListScreen />;
}
