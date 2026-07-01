import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@/components/chat-screen';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import {
  fetchConversationDetails,
  markConversationRead,
  useAnnouncementStatus,
  type ConversationWithDetails,
} from '@/hooks/use-chat';

export default function MechanicChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const goBack = useBack('/(mechanic)/conversations');
  const [conv, setConv] = useState<ConversationWithDetails | null>(null);

  useEffect(() => {
    fetchConversationDetails(id).then(setConv);
    markConversationRead(id);
  }, [id]);

  const announcementStatus = useAnnouncementStatus(
    conv?.announcement_id ?? '',
    conv?.announcement.status ?? 'open'
  );

  if (!conv || !session) return <ThemedView style={{ flex: 1 }} />;

  return (
    <ChatScreen
      conversationId={id}
      currentUserId={session.user.id}
      accentColor="#22c55e"
      otherPersonName={conv.driver.full_name}
      announcementLocation={conv.announcement.location}
      announcementStatus={announcementStatus}
      onBack={goBack}
    />
  );
}
