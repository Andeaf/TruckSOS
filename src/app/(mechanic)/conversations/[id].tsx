import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ChatScreen } from '@/components/chat-screen';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { displayName } from '@/lib/display-name';
import {
  deleteMessage,
  editMessage,
  fetchConversationDetails,
  markConversationRead,
  sendImageMessage,
  sendMessage,
  useAnnouncementStatus,
  useMessages,
  useReadCursor,
  withinEditWindow,
  type ConversationWithDetails,
} from '@/hooks/use-chat';

export default function MechanicChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack('/(mechanic)/conversations');
  const [conv, setConv] = useState<ConversationWithDetails | null>(null);
  const { messages, loading, addMessage, patchMessage } = useMessages(id);
  const readCursor = useReadCursor(id, conv?.driver_id);

  useEffect(() => {
    fetchConversationDetails(id).then(setConv);
  }, [id]);

  useEffect(() => {
    // Cursorul acoperă cel mai nou mesaj AFIȘAT (nu doar ceasul local) — vezi markConversationRead.
    if (!loading) markConversationRead(id, messages[messages.length - 1]?.created_at ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, loading, id]);

  const announcementStatus = useAnnouncementStatus(
    conv?.announcement_id ?? '',
    conv?.announcement?.status ?? 'open'
  );

  if (!conv || !session) return <ThemedView style={{ flex: 1 }} />;

  return (
    <ChatScreen
      currentUserId={session.user.id}
      title={displayName(conv.driver, t)}
      headerAvatarPath={conv.driver.avatar_path}
      headerUserId={conv.driver_id}
      onPressUser={(userId) =>
        router.push({ pathname: '/(mechanic)/public-profile/[id]' as never, params: { id: userId } })
      }
      subtitle={conv.announcement?.location ?? t('conversations.directLabel')}
      subtitleIcon={conv.announcement ? 'location-on' : 'forum'}
      bannerText={
        conv.announcement && announcementStatus === 'resolved'
          ? t('chat.resolvedBanner')
          : undefined
      }
      messages={messages}
      loading={loading}
      onSend={async (content, replyToId) => {
        const { message } = await sendMessage(id, session.user.id, content, null, replyToId);
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
      onEditMessage={async (m, content) => {
        const err = await editMessage('messages', m.id, content);
        if (!err) patchMessage(m.id, { content, edited_at: new Date().toISOString() });
      }}
      canEditMessage={(m) => withinEditWindow(m.created_at)}
      messageTable="messages"
      readReceipts
      readCursor={readCursor}
      onBack={goBack}
    />
  );
}
