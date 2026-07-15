import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ChatScreen } from '@/components/chat-screen';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import {
  fetchChannel,
  markChannelRead,
  sendChannelImageMessage,
  sendChannelMessage,
  useChannelMessages,
} from '@/hooks/use-channel-chat';
import { deleteMessage } from '@/hooks/use-chat';
import type { Channel } from '@/types/database';

export default function MechanicChannelChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { t } = useTranslation();
  const goBack = useBack('/(mechanic)/conversations');
  const [channel, setChannel] = useState<Channel | null>(null);
  const { messages, loading, loadingMore, loadOlder, addMessage, patchMessage } =
    useChannelMessages(id);

  useEffect(() => {
    fetchChannel(id).then(setChannel);
  }, [id]);

  useEffect(() => {
    if (!loading) markChannelRead(id);
  }, [messages.length, loading, id]);

  if (!channel || !session) return <ThemedView style={{ flex: 1 }} />;

  return (
    <ChatScreen
      currentUserId={session.user.id}
      accentColor="#8B5CF6"
      title={t(`channel.name.${channel.type}`)}
      subtitle={t('channel.subtitle')}
      messages={messages}
      loading={loading}
      loadingMore={loadingMore}
      onLoadOlder={loadOlder}
      renderSenderName={(message) => message.sender.full_name}
      renderSenderAvatarPath={(message) => message.sender.avatar_path}
      renderSenderLabel={(message) =>
        `${message.sender.full_name} · ${t(`auth.roleSelect.${message.sender.role}Title`)}`
      }
      onSend={async (content) => {
        const { message } = await sendChannelMessage(id, session.user.id, content);
        if (message) addMessage(message);
      }}
      onSendImage={async (image) => {
        const { message } = await sendChannelImageMessage(id, session.user.id, image);
        if (message) addMessage(message);
      }}
      onDeleteMessage={async (m) => {
        const err = await deleteMessage('channel_messages', m.id);
        if (!err) {
          patchMessage(m.id, { content: '', image_path: null, deleted_at: new Date().toISOString() });
        }
      }}
      onBack={goBack}
    />
  );
}
