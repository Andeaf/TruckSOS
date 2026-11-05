import { AnnouncementsListScreen } from '@/components/announcements-list-screen';
import { useExitConfirm } from '@/hooks/use-exit-confirm';
import { usePushPermissionRequestOnStart } from '@/hooks/use-push-permission-request';

export default function DriverAnnouncementsScreen() {
  // Tab-ul de start al șoferului: back-ul de aici întreabă dacă închide aplicația.
  useExitConfirm();
  // 1.1 (7.6): contul existent fără permisiunea de notificări (telefon nou / reinstalare)
  // primește aici dialogul sistemului pentru notificări, o dată pe rulare.
  usePushPermissionRequestOnStart();
  return <AnnouncementsListScreen />;
}
