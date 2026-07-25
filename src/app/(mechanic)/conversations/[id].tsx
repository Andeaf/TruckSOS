import { useEffect, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
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
  fetchMessageListingContext,
  markConversationRead,
  otherParticipant,
  sendImageMessage,
  sendMessage,
  useAnnouncementStatus,
  useMessages,
  useReadCursor,
  withinEditWindow,
  type ConversationWithDetails,
  type MessageListingContext,
} from '@/hooks/use-chat';

export default function MechanicChatScreen() {
  // `listingId` (opțional) = venim din „Contactează vânzătorul" — vezi ruta șoferului.
  const { id, listingId } = useLocalSearchParams<{ id: string; listingId?: string }>();
  const [pendingListing, setPendingListing] = useState<string | null>(listingId ?? null);
  // Detaliile pentru bannerul „anunț atașat" din compozitor (ruta aduce doar id-ul).
  const [pendingListingInfo, setPendingListingInfo] = useState<MessageListingContext | null>(null);
  const { session } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack('/(mechanic)/conversations');
  const [conv, setConv] = useState<ConversationWithDetails | null>(null);
  const { messages, loading, addMessage, patchMessage } = useMessages(id);
  // Faza 19: interlocutorul prin ID, nu prin rol — pe market poate fi orice rol.
  const other = conv && session ? otherParticipant(conv, session.user.id) : null;
  const readCursor = useReadCursor(id, other?.id);
  const isFocused = useIsFocused();

  useEffect(() => {
    fetchConversationDetails(id).then(setConv);
  }, [id]);

  useEffect(() => {
    // Bannerul urmează starea `pendingListing`: la null (× sau primul send) dispare.
    if (!pendingListing) {
      setPendingListingInfo(null);
      return;
    }
    let active = true;
    fetchMessageListingContext(pendingListing).then((info) => {
      if (!active) return;
      // Anunț dispărut între timp → renunțăm și la atașare (FK-ul ar respinge insertul).
      if (info) setPendingListingInfo(info);
      else setPendingListing(null);
    });
    return () => {
      active = false;
    };
  }, [pendingListing]);

  useEffect(() => {
    // Cursorul acoperă cel mai nou mesaj AFIȘAT (vezi markConversationRead) — dar DOAR
    // cu ecranul în față: tab-urile păstrează stack-ul montat, iar fără garda de focus
    // un mesaj sosit cât timp userul e pe alt tab se marca singur „citit" (✓✓ false).
    // La revenirea pe ecran (isFocused redevine true) efectul marchează ce s-a strâns.
    if (!loading && isFocused) markConversationRead(id, messages[messages.length - 1]?.created_at ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, loading, id, isFocused]);

  const announcementStatus = useAnnouncementStatus(
    conv?.announcement_id ?? '',
    conv?.announcement?.status ?? 'open'
  );

  if (!conv || !session || !other) return <ThemedView style={{ flex: 1 }} />;

  return (
    <ChatScreen
      currentUserId={session.user.id}
      title={displayName(other.profile, t)}
      headerAvatarPath={other.profile.avatar_path}
      headerUserId={other.id}
      onPressUser={(userId) =>
        // public-profile gestionează ambele roluri (are ramuri pe profile.role).
        router.push({ pathname: '/(mechanic)/public-profile/[id]' as never, params: { id: userId } })
      }
      subtitle={
        conv.announcement?.location ??
        (conv.listing ? conv.listing.title : t('conversations.directLabel'))
      }
      subtitleIcon={conv.announcement ? 'location-on' : conv.listing ? 'sell' : 'forum'}
      bannerText={
        conv.listing?.status === 'sold'
          ? t('market.soldBanner')
          : conv.announcement && announcementStatus === 'resolved'
            ? t('chat.resolvedBanner')
            : undefined
      }
      messages={messages}
      loading={loading}
      onSend={async (content, replyToId) => {
        const { message } = await sendMessage(
          id, session.user.id, content, null, replyToId, pendingListing
        );
        if (message) {
          addMessage(message);
          if (pendingListing) setPendingListing(null);
        }
      }}
      onPressListing={(lid) =>
        router.push({ pathname: '/(mechanic)/market/[id]', params: { id: lid } } as never)
      }
      pendingListing={pendingListingInfo}
      onClearPendingListing={() => setPendingListing(null)}
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
