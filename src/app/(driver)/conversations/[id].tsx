import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ChatScreen } from '@/components/chat-screen';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import {
  fetchConversationDetails,
  markConversationRead,
  sendMessage,
  useAnnouncementStatus,
  useMessages,
  type ConversationWithDetails,
} from '@/hooks/use-chat';

export default function DriverChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { t } = useTranslation();
  const goBack = useBack('/(driver)/conversations');
  const [conv, setConv] = useState<ConversationWithDetails | null>(null);
  const { messages, loading, addMessage } = useMessages(id);

  useEffect(() => {
    fetchConversationDetails(id).then(setConv);
  }, [id]);

  useEffect(() => {
    if (!loading) markConversationRead(id);
  }, [messages.length, loading, id]);

  const announcementStatus = useAnnouncementStatus(
    conv?.announcement_id ?? '',
    conv?.announcement.status ?? 'open'
  );

  if (!conv || !session) return <ThemedView style={{ flex: 1 }} />;

  return (
    <ChatScreen
      currentUserId={session.user.id}
      accentColor="#208AEF"
      title={conv.mechanic.full_name}
      subtitle={conv.announcement.location}
      subtitleIcon="location-on"
      bannerText={announcementStatus === 'resolved' ? t('chat.resolvedBanner') : undefined}
      messages={messages}
      loading={loading}
      onSend={async (content) => {
        const { message } = await sendMessage(id, session.user.id, content);
        if (message) addMessage(message);
      }}
      onBack={goBack}
    />
  );
}
