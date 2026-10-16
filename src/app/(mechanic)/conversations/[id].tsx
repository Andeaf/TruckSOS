import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ChatScreen } from '@/components/chat-screen';
import { MarketPickerSheet } from '@/components/market-picker-sheet';
import { MechanicPickerSheet } from '@/components/mechanic-picker-sheet';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { searchMentionUsers } from '@/hooks/use-mechanic-search';
import { useThreadNotifications } from '@/hooks/use-thread-notifications';
import { displayName } from '@/lib/display-name';
import type { MentionUser } from '@/lib/mention-search';
import {
  deleteMessage,
  editMessage,
  fetchConversationDetails,
  fetchMessageAnnouncementContext,
  fetchMessageListingContext,
  fetchMessageMechanicContext,
  fetchMyReadCursor,
  fetchPeerPhone,
  markConversationRead,
  otherParticipant,
  sendFileMessage,
  sendImageMessage,
  sendMessage,
  useAnnouncementStatus,
  useMessages,
  useReadCursor,
  withinEditWindow,
  type ConversationWithDetails,
  type MessageAnnouncementContext,
  type MessageListingContext,
  type MessageMechanicContext,
} from '@/hooks/use-chat';

export default function MechanicChatScreen() {
  // `listingId` (opțional) = venim din „Contactează vânzătorul" — vezi ruta șoferului.
  const { id, listingId, announcementId } = useLocalSearchParams<{
    id: string;
    listingId?: string;
    announcementId?: string;
  }>();
  const [pendingListing, setPendingListing] = useState<string | null>(listingId ?? null);
  // Faza 19.6: venim din share-ul unui anunț de depanare — cardul pe primul mesaj.
  const [pendingAnnouncement, setPendingAnnouncement] = useState<string | null>(
    announcementId ?? null
  );
  const [pendingAnnouncementInfo, setPendingAnnouncementInfo] =
    useState<MessageAnnouncementContext | null>(null);
  // Detaliile pentru bannerul „anunț atașat" din compozitor (ruta aduce doar id-ul).
  const [pendingListingInfo, setPendingListingInfo] = useState<MessageListingContext | null>(null);
  // Faza 19.5: mecanicul recomandat (meniul „+") + pickerele de atașamente.
  const [pendingMechanic, setPendingMechanic] = useState<string | null>(null);
  const [pendingMechanicInfo, setPendingMechanicInfo] = useState<MessageMechanicContext | null>(null);
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);
  // 19.6: același picker pentru „Recomandă un mecanic" ȘI „Recomandă un transportator".
  const [recommendRole, setRecommendRole] = useState<'mechanic' | 'driver' | null>(null);
  const { session } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack('/(mechanic)/conversations');
  const [conv, setConv] = useState<ConversationWithDetails | null>(null);
  // Snapshot-ul cursorului MEU de citire (7 aug): luat ÎNAINTE ca mark-read să-l mute
  // la zi — decide unde apare „Mesaje noi" și unde aterizează lista. undefined = în curs.
  const [initialCursor, setInitialCursor] = useState<string | null | undefined>(undefined);
  // Telefonul interlocutorului (RPC pe rolul lui): null = inaccesibil → fără buton de apel.
  const [peerPhone, setPeerPhone] = useState<string | null>(null);
  const { messages, loading, addMessage, patchMessage } = useMessages(id);
  // Faza 19: interlocutorul prin ID, nu prin rol — pe market poate fi orice rol.
  const other = conv && session ? otherParticipant(conv, session.user.id) : null;
  const readCursor = useReadCursor(id, other?.id);
  const isFocused = useIsFocused();
  useThreadNotifications('conversation', id, isFocused);

  useEffect(() => {
    fetchConversationDetails(id).then(setConv);
  }, [id]);

  useEffect(() => {
    let active = true;
    fetchMyReadCursor(id).then((c) => {
      if (active) setInitialCursor(c);
    });
    return () => {
      active = false;
    };
  }, [id]);

  const otherId = other?.id;
  const otherRole = other?.profile.role;
  const otherProfile = other?.profile;
  // Menționări „@" (10 sept): în chatul 1-la-1 candidatul local e interlocutorul;
  // orice alt nume (o recomandare „vorbește cu @Ion Popescu") vine din căutare.
  const mentionCandidates = useMemo<MentionUser[]>(
    () =>
      otherId && otherProfile && !otherProfile.deleted_at && otherProfile.full_name
        ? [
            {
              id: otherId,
              full_name: otherProfile.full_name,
              avatar_path: otherProfile.avatar_path,
              role: otherProfile.role,
            },
          ]
        : [],
    [otherId, otherProfile],
  );
  useEffect(() => {
    if (!otherId || !otherRole) return;
    let active = true;
    fetchPeerPhone(otherId, otherRole).then((phone) => {
      if (active) setPeerPhone(phone);
    });
    return () => {
      active = false;
    };
  }, [otherId, otherRole]);

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
    // Faza 19.6: bannerul anunțului de depanare distribuit (share).
    if (!pendingAnnouncement) {
      setPendingAnnouncementInfo(null);
      return;
    }
    let active = true;
    fetchMessageAnnouncementContext(pendingAnnouncement).then((info) => {
      if (!active) return;
      if (info) setPendingAnnouncementInfo(info);
      else setPendingAnnouncement(null);
    });
    return () => {
      active = false;
    };
  }, [pendingAnnouncement]);

  useEffect(() => {
    // Simetric cu anunțul atașat: bannerul de mecanic urmează starea `pendingMechanic`.
    if (!pendingMechanic) {
      setPendingMechanicInfo(null);
      return;
    }
    let active = true;
    fetchMessageMechanicContext(pendingMechanic).then((info) => {
      if (!active) return;
      if (info && !info.deleted_at) setPendingMechanicInfo(info);
      else setPendingMechanic(null);
    });
    return () => {
      active = false;
    };
  }, [pendingMechanic]);

  useEffect(() => {
    // Cursorul acoperă cel mai nou mesaj AFIȘAT (vezi markConversationRead) — dar DOAR
    // cu ecranul în față: tab-urile păstrează stack-ul montat, iar fără garda de focus
    // un mesaj sosit cât timp userul e pe alt tab se marca singur „citit" (✓✓ false).
    // La revenirea pe ecran (isFocused redevine true) efectul marchează ce s-a strâns.
    // + gardă pe snapshot (7 aug): prima marcare așteaptă citirea cursorului VECHI,
    // altfel upsert-ul putea câștiga cursa și ancora „Mesaje noi" nu mai apărea.
    if (!loading && isFocused && initialCursor !== undefined)
      markConversationRead(id, messages[messages.length - 1]?.created_at ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, loading, id, isFocused, initialCursor]);

  const announcementStatus = useAnnouncementStatus(
    conv?.announcement_id ?? '',
    conv?.announcement?.status ?? 'open'
  );

  if (!conv || !session || !other) return <ThemedView style={{ flex: 1 }} />;

  return (
    <>
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
      onSend={async (content, replyToId, mentions) => {
        const { message } = await sendMessage(
          id, session.user.id, content, null, replyToId,
          pendingListing, pendingMechanic, pendingAnnouncement, mentions ?? null
        );
        if (message) {
          addMessage(message);
          if (pendingListing) setPendingListing(null);
          if (pendingMechanic) setPendingMechanic(null);
          if (pendingAnnouncement) setPendingAnnouncement(null);
        }
      }}
      mentionCandidates={mentionCandidates}
      searchMentionUsers={searchMentionUsers}
      onPressListing={(lid) =>
        router.push({ pathname: '/(mechanic)/market/[id]', params: { id: lid } } as never)
      }
      pendingListing={pendingListingInfo}
      onClearPendingListing={() => setPendingListing(null)}
      pendingMechanic={pendingMechanicInfo}
      onClearPendingMechanic={() => setPendingMechanic(null)}
      pendingAnnouncement={pendingAnnouncementInfo}
      onClearPendingAnnouncement={() => setPendingAnnouncement(null)}
      onPressAnnouncement={(aid) =>
        router.push({ pathname: '/(mechanic)/feed/[id]' as never, params: { id: aid } })
      }
      onAttachListing={() => setMarketPickerOpen(true)}
      onAttachMechanic={() => setRecommendRole('mechanic')}
      onAttachDriver={() => setRecommendRole('driver')}
      onSendFile={async (file) => {
        const { message } = await sendFileMessage(id, session.user.id, file);
        if (message) addMessage(message);
      }}
      onPressMechanic={(mid) =>
        router.push({ pathname: '/(mechanic)/public-profile/[id]' as never, params: { id: mid } })
      }
      onSendImage={async (image) => {
        const { message } = await sendImageMessage(id, session.user.id, image);
        if (message) addMessage(message);
      }}
      onDeleteMessage={async (m) => {
        const err = await deleteMessage('messages', m.id);
        if (!err) {
          patchMessage(m.id, { content: '', image_path: null, deleted_at: new Date().toISOString() });
        } else {
          // Eroarea era înghițită tăcut — utilizatorul credea că a șters (bug 26 iul).
          Alert.alert(t('common.error'), err);
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
      unreadCursor={initialCursor}
      phoneNumber={peerPhone}
      onBack={goBack}
    />
    {marketPickerOpen ? (
      <MarketPickerSheet
        visible
        userId={session.user.id}
        onClose={() => setMarketPickerOpen(false)}
        onPick={(listing) => {
          setMarketPickerOpen(false);
          // Doar id-ul: efectul de pendingListing aduce detaliile pentru banner.
          setPendingListing(listing.id);
        }}
      />
    ) : null}
    {recommendRole ? (
      <MechanicPickerSheet
        visible
        userId={session.user.id}
        targetRole={recommendRole}
        onClose={() => setRecommendRole(null)}
        onPick={(mechanic) => {
          setRecommendRole(null);
          setPendingMechanic(mechanic.id);
        }}
      />
    ) : null}
    </>
  );
}
