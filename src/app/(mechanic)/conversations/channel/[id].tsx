import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { deleteMessage, editMessage, withinEditWindow } from '@/hooks/use-chat';
import { displayName } from '@/lib/display-name';
import type { Channel } from '@/types/database';

export default function MechanicChannelChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack('/(mechanic)/conversations');
  const [channel, setChannel] = useState<Channel | null>(null);
  const { messages, loading, loadingMore, loadOlder, addMessage, patchMessage } =
    useChannelMessages(id);

  useEffect(() => {
    fetchChannel(id).then(setChannel);
  }, [id]);

  useEffect(() => {
    // Cursorul acoperă cel mai nou mesaj AFIȘAT (nu doar ceasul local) — vezi markChannelRead.
    if (!loading) markChannelRead(id, messages[messages.length - 1]?.created_at ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, loading, id]);

  if (!channel || !session) return <ThemedView style={{ flex: 1 }} />;

  return (
    <ChatScreen
      currentUserId={session.user.id}
      title={t(`channel.name.${channel.type}`)}
      subtitle={t('channel.subtitle')}
      messages={messages}
      loading={loading}
      loadingMore={loadingMore}
      onLoadOlder={loadOlder}
      renderSenderName={(message) => displayName(message.sender, t)}
      renderSenderAvatarPath={(message) => message.sender.avatar_path}
      onPressUser={(userId) =>
        router.push({ pathname: '/(mechanic)/public-profile/[id]' as never, params: { id: userId } })
      }
      renderSenderLabel={(message) =>
        `${displayName(message.sender, t)} · ${t(`auth.roleSelect.${message.sender.role}Title`)}`
      }
      onSend={async (content, replyToId) => {
        const { message } = await sendChannelMessage(id, session.user.id, content, null, replyToId);
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
      onEditMessage={async (m, content) => {
        const err = await editMessage('channel_messages', m.id, content);
        if (!err) patchMessage(m.id, { content, edited_at: new Date().toISOString() });
      }}
      canEditMessage={(m) => withinEditWindow(m.created_at)}
      messageTable="channel_messages"
      onBack={goBack}
    />
  );
}
