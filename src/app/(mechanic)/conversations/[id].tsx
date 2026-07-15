import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ChatScreen } from '@/components/chat-screen';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import {
  deleteMessage,
  fetchConversationDetails,
  markConversationRead,
  sendImageMessage,
  sendMessage,
  useAnnouncementStatus,
  useMessages,
  type ConversationWithDetails,
} from '@/hooks/use-chat';

export default function MechanicChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { t } = useTranslation();
  const goBack = useBack('/(mechanic)/conversations');
  const [conv, setConv] = useState<ConversationWithDetails | null>(null);
  const { messages, loading, addMessage, patchMessage } = useMessages(id);

  useEffect(() => {
    fetchConversationDetails(id).then(setConv);
  }, [id]);

  useEffect(() => {
    if (!loading) markConversationRead(id);
  }, [messages.length, loading, id]);

  const announcementStatus = useAnnouncementStatus(
    conv?.announcement_id ?? '',
    conv?.announcement?.status ?? 'open'
  );

  if (!conv || !session) return <ThemedView style={{ flex: 1 }} />;

  return (
    <ChatScreen
      currentUserId={session.user.id}
      accentColor="#22c55e"
      title={conv.driver.full_name}
      headerAvatarPath={conv.driver.avatar_path}
      subtitle={conv.announcement?.location ?? t('conversations.directLabel')}
      subtitleIcon={conv.announcement ? 'location-on' : 'forum'}
      bannerText={
        conv.announcement && announcementStatus === 'resolved'
          ? t('chat.resolvedBanner')
          : undefined
      }
      messages={messages}
      loading={loading}
      onSend={async (content) => {
        const { message } = await sendMessage(id, session.user.id, content);
        if (message) addMessage(message);
      }}
      onSendImage={async (image) => {
        const { message } = await sendImageMessage(id, session.user.id, image);
        if (message) addMessage(message);
      }}
      onDeleteMessage={async (m) => {
        const err = await deleteMessage('messages', m.id);
        if (!err) {
          patchMessage(m.id, { content: '', image_path: null, deleted_at: new Date().toISOString() });
        }
      }}
      onBack={goBack}
    />
  );
}
