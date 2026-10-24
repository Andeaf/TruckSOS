import { AnnouncementFormScreen } from '@/components/announcement-form-screen';

export default function GuestNewAnnouncementRoute() {
  // Oaspetele completează formularul; „Publică” salvează draftul local și cere cont.
  return <AnnouncementFormScreen role="driver" guest />;
}
