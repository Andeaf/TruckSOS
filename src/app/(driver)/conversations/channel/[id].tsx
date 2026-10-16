import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ChannelSettingsSheet } from '@/components/channel-settings-sheet';
import { ChatScreen } from '@/components/chat-screen';
import { MarketPickerSheet } from '@/components/market-picker-sheet';
import { MechanicPickerSheet } from '@/components/mechanic-picker-sheet';
import { ThemedView } from '@/components/themed-view';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import {
  fetchChannel,
  fetchMyChannelReadCursor,
  markChannelRead,
  sendChannelFileMessage,
  sendChannelImageMessage,
  sendChannelMessage,
  useChannelMessages,
} from '@/hooks/use-channel-chat';
import {
  deleteMessage,
  editMessage,
  fetchMessageListingContext,
  fetchMessageMechanicContext,
  withinEditWindow,
  type MessageListingContext,
  type MessageMechanicContext,
} from '@/hooks/use-chat';
import { searchMentionUsers } from '@/hooks/use-mechanic-search';
import { useThreadNotifications } from '@/hooks/use-thread-notifications';
import { displayName } from '@/lib/display-name';
import type { MentionUser } from '@/lib/mention-search';
import type { Channel } from '@/types/database';

export default function DriverChannelChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack('/(driver)/conversations');
  const [channel, setChannel] = useState<Channel | null>(null);
  const { messages, loading, loadingMore, loadOlder, addMessage, patchMessage } =
    useChannelMessages(id);
  const isFocused = useIsFocused();
  useThreadNotifications('channel', id, isFocused);
  // Menționări „@" (10 sept): expeditorii încărcați, cei mai recenți primii, fără mine
  // și fără conturi șterse; numele care lipsesc vin din căutarea pe server.
  const myId = session?.user.id;
  const mentionCandidates = useMemo<MentionUser[]>(() => {
    const seen = new Map<string, MentionUser>();
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.sender_id === myId || m.sender.deleted_at || !m.sender.full_name) continue;
      if (seen.has(m.sender_id)) continue;
      seen.set(m.sender_id, {
        id: m.sender_id,
        full_name: m.sender.full_name,
        avatar_path: m.sender.avatar_path,
        role: m.sender.role,
      });
    }
    return [...seen.values()];
  }, [messages, myId]);
  // Faza 19.5: atașamente (paritate cu chatul privat) — stări pending + pickere.
  const [pendingListing, setPendingListing] = useState<string | null>(null);
  const [pendingListingInfo, setPendingListingInfo] = useState<MessageListingContext | null>(null);
  const [pendingMechanic, setPendingMechanic] = useState<string | null>(null);
  const [pendingMechanicInfo, setPendingMechanicInfo] = useState<MessageMechanicContext | null>(null);
  const [marketPickerOpen, setMarketPickerOpen] = useState(false);
  // 19.6: același picker pentru „Recomandă un mecanic" ȘI „Recomandă un transportator".
  const [recommendRole, setRecommendRole] = useState<'mechanic' | 'driver' | null>(null);
  // 5 aug: setările canalului (notificări opt-in) — rotița din antet.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Snapshot-ul cursorului MEU de citire (7 aug): luat ÎNAINTE ca mark-read să-l mute
  // la zi — decide unde apare „Mesaje noi" și unde aterizează lista. undefined = în curs.
  const [initialCursor, setInitialCursor] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    fetchChannel(id).then(setChannel);
  }, [id]);

  useEffect(() => {
    let active = true;
    fetchMyChannelReadCursor(id).then((c) => {
      if (active) setInitialCursor(c);
    });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    // Bannerul „Anunț atașat" urmează starea `pendingListing` (vezi chatul privat).
    if (!pendingListing) {
      setPendingListingInfo(null);
      return;
    }
    let active = true;
    fetchMessageListingContext(pendingListing).then((info) => {
      if (!active) return;
      if (info) setPendingListingInfo(info);
      else setPendingListing(null);
    });
    return () => {
      active = false;
    };
  }, [pendingListing]);

  useEffect(() => {
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
    // Cursorul acoperă cel mai nou mesaj AFIȘAT (vezi markChannelRead) — dar DOAR cu
    // ecranul în față: tab-urile păstrează stack-ul montat, iar fără garda de focus
    // mesajele sosite cât timp userul e pe alt tab se marcau singure „citite" și
    // bulina de pe tabul Chat nu se mai aprindea.
    // + gardă pe snapshot (7 aug): prima marcare așteaptă citirea cursorului VECHI,
    // altfel upsert-ul putea câștiga cursa și ancora „Mesaje noi" nu mai apărea.
    if (!loading && isFocused && initialCursor !== undefined)
      markChannelRead(id, messages[messages.length - 1]?.created_at ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, loading, id, isFocused, initialCursor]);

  if (!channel || !session) return <ThemedView style={{ flex: 1 }} />;

  return (
    <>
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
      onPressUser={(userId, message) =>
        // Rutare pe rolul REAL al expeditorului (ca în chatul privat): mecanicii ajung
        // pe ecranul bogat (Contact/rating/favorite), restul pe profilul public generic.
        router.push({
          pathname:
            message?.sender.role === 'mechanic'
              ? '/(driver)/mechanic-profile/[id]'
              : '/(driver)/public-profile/[id]',
          params: { id: userId },
        } as never)
      }
      renderSenderRole={(message) => t(`auth.roleSelect.${message.sender.role}Title`)}
      onSend={async (content, replyToId, mentions) => {
        const { message } = await sendChannelMessage(
          id, session.user.id, content, null, replyToId, pendingListing, pendingMechanic,
          mentions ?? null
        );
        if (message) {
          addMessage(message);
          if (pendingListing) setPendingListing(null);
          if (pendingMechanic) setPendingMechanic(null);
        }
      }}
      mentionCandidates={mentionCandidates}
      searchMentionUsers={searchMentionUsers}
      onPressListing={(lid) =>
        router.push({ pathname: '/(driver)/market/[id]', params: { id: lid } } as never)
      }
      pendingListing={pendingListingInfo}
      onClearPendingListing={() => setPendingListing(null)}
      pendingMechanic={pendingMechanicInfo}
      onClearPendingMechanic={() => setPendingMechanic(null)}
      onAttachListing={() => setMarketPickerOpen(true)}
      onAttachMechanic={() => setRecommendRole('mechanic')}
      onAttachDriver={() => setRecommendRole('driver')}
      onSendFile={async (file) => {
        const { message } = await sendChannelFileMessage(id, session.user.id, file);
        if (message) addMessage(message);
      }}
      onPressMechanic={(mid, role) =>
        router.push({
          pathname:
            role === 'driver'
              ? '/(driver)/public-profile/[id]'
              : '/(driver)/mechanic-profile/[id]',
          params: { id: mid },
        } as never)
      }
      onSendImage={async (image) => {
        const { message } = await sendChannelImageMessage(id, session.user.id, image);
        if (message) addMessage(message);
      }}
      onDeleteMessage={async (m) => {
        const err = await deleteMessage('channel_messages', m.id);
        if (!err) {
          patchMessage(m.id, { content: '', image_path: null, deleted_at: new Date().toISOString() });
        } else {
          Alert.alert(t('common.error'), err);
        }
      }}
      onEditMessage={async (m, content) => {
        const err = await editMessage('channel_messages', m.id, content);
        if (!err) patchMessage(m.id, { content, edited_at: new Date().toISOString() });
      }}
      canEditMessage={(m) => withinEditWindow(m.created_at)}
      messageTable="channel_messages"
      unreadCursor={initialCursor}
      onBack={goBack}
      onOpenSettings={() => setSettingsOpen(true)}
    />
    {marketPickerOpen ? (
      <MarketPickerSheet
        visible
        userId={session.user.id}
        onClose={() => setMarketPickerOpen(false)}
        onPick={(listing) => {
          setMarketPickerOpen(false);
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
    <ChannelSettingsSheet
      visible={settingsOpen}
      channelId={id}
      channelName={t(`channel.name.${channel.type}`)}
      role="driver"
      onClose={() => setSettingsOpen(false)}
    />
    </>
  );
}
