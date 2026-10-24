import { useCallback, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ChatScreen } from '@/components/chat-screen';
import { useAccountGate } from '@/hooks/use-account-gate';
import { fetchGuestChannel, type GuestChannelMessageWithSender } from '@/hooks/use-guest-data';
import { displayName } from '@/lib/display-name';

/**
 * 1.1 (B3): Comunitatea pentru OASPEȚI — canalul global doar în citire (D4): ultimele
 * 7 zile, max 50 de mesaje, din `guest_channel_messages`. Fără Realtime (reîncărcare la
 * focus), fără `markChannelRead`, fără push. Compozitorul e înlocuit de bara „Fă-ți cont”.
 * `ChatScreen` cere `currentUserId`/`onSend`: id gol (niciun mesaj nu e „al meu”) și no-op
 * (compozitorul nu există în modul `readOnly`).
 */
export default function GuestCommunityRoute() {
  const { t } = useTranslation();
  const router = useRouter();
  const { requireAccount } = useAccountGate();
  const [messages, setMessages] = useState<GuestChannelMessageWithSender[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      fetchGuestChannel().then(({ data, error }) => {
        if (!active) return;
        // Rețea picată la o reîncărcare: păstrăm mesajele deja afișate.
        if (!error || error === 'unavailable') setMessages(data?.messages ?? []);
        setLoading(false);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <ChatScreen
      currentUserId=""
      title={t('channel.name.global')}
      subtitle={t('channel.subtitle')}
      messages={messages}
      loading={loading}
      onSend={async () => {}}
      renderSenderName={(message) => displayName(message.sender, t)}
      renderSenderAvatarPath={(message) => message.sender.avatar_path}
      renderSenderRole={(message) => t(`auth.roleSelect.${message.sender.role}Title`)}
      onPressUser={(userId, message) => {
        // Oaspetele are doar profilul de mecanic (tab-ul Mecanici).
        if (message?.sender.role === 'mechanic') {
          router.push({ pathname: '/(guest)/mechanics/[id]', params: { id: userId } } as never);
        }
      }}
      readOnly={{
        label: t('guest.channelReadOnly'),
        onPress: () => requireAccount('message'),
        onPressPhoto: () => requireAccount('generic'),
      }}
    />
  );
}
