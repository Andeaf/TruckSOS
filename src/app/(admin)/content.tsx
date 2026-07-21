import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  adminDeleteAnnouncement,
  adminDeleteMessage,
  adminDeleteReview,
  fetchChannelMessages,
  fetchRecentAnnouncements,
  fetchRecentReviews,
  searchAnnouncements,
  type AdminAnnouncement,
  type AdminChannelMessage,
  type AdminReview,
} from '@/hooks/use-admin';

type Segment = 'announcements' | 'reviews' | 'channel';
const SEGMENTS: Segment[] = ['announcements', 'reviews', 'channel'];

/** Locale explicit: altfel formatul urmează regiunea dispozitivului, nu limba aplicației. */
const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

export default function AdminContent() {
  const { t, i18n } = useTranslation();
  const [segment, setSegment] = useState<Segment>('announcements');
  const [annQuery, setAnnQuery] = useState('');
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [channel, setChannel] = useState<AdminChannelMessage[]>([]);
  // Reîncărcare la focus / după o ștergere: bump-ul re-declanșează efectele de mai jos.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((v) => v + 1), []);

  useFocusEffect(refresh);

  // Anunțuri — un singur „owner" al listei: sugestii live (debounce 300ms de la 2
  // caractere) sau lista recentă. Flag-ul `active` aruncă răspunsurile out-of-order.
  useEffect(() => {
    if (segment !== 'announcements') return;
    const q = annQuery.trim();
    let active = true;
    const timer = setTimeout(
      () => {
        (q.length >= 2 ? searchAnnouncements(q) : fetchRecentAnnouncements()).then(({ data }) => {
          if (active) setAnnouncements(data);
        });
      },
      q.length >= 2 ? 300 : 0
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [segment, annQuery, tick]);

  useEffect(() => {
    if (segment === 'reviews') fetchRecentReviews().then(({ data }) => setReviews(data));
    else if (segment === 'channel') fetchChannelMessages().then(({ data }) => setChannel(data));
  }, [segment, tick]);

  function confirmDelete(message: string, action: () => Promise<string | null>) {
    Alert.alert(t('admin.content.deleteConfirmTitle'), message, [
      { text: t('admin.common.cancel'), style: 'cancel' },
      {
        text: t('admin.common.delete'),
        style: 'destructive',
        onPress: () =>
          action().then((err) => {
            if (err) Alert.alert(t('admin.common.error'), err);
            else refresh();
          }),
      },
    ]);
  }

  return (
    <ThemedView style={{ flex: 1 }}>
      <ScreenHeader title={t('admin.content.title')} />

      <View style={styles.segments}>
        {SEGMENTS.map((s) => {
          const active = s === segment;
          return (
            <Pressable
              key={s}
              onPress={() => setSegment(s)}
              style={[styles.seg, active && { borderBottomColor: '#6366f1', borderBottomWidth: 2 }]}>
              <ThemedText themeColor={active ? undefined : 'textSecondary'} type="small">
                {t(`admin.content.tab_${s}`)}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>

      {segment === 'announcements' ? (
        <View style={styles.searchBox}>
          <Input
            value={annQuery}
            onChangeText={setAnnQuery}
            placeholder={t('admin.content.searchPlaceholder')}
            autoCapitalize="none"
            returnKeyType="search"
          />
        </View>
      ) : null}

      {segment === 'announcements' ? (
        <FlatList
          data={announcements}
          keyExtractor={(a) => a.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              {annQuery.trim().length >= 2 ? t('admin.content.noResults') : t('admin.content.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Card
              title={item.description}
              subtitle={`${item.driver_name ?? '—'} · ${t(`status.${item.status}`)} · ${new Date(item.created_at).toLocaleDateString(LOCALE_MAP[i18n.language] ?? 'ro-RO')}`}
              onDelete={() =>
                confirmDelete(t('admin.content.deleteAnnouncementConfirm'), () =>
                  adminDeleteAnnouncement(item.id)
                )
              }
            />
          )}
        />
      ) : segment === 'reviews' ? (
        <FlatList
          data={reviews}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Empty />}
          renderItem={({ item }) => (
            <Card
              title={item.comment ?? '—'}
              subtitle={`${'★'.repeat(item.stars)} · ${item.mechanic_name ?? '—'} · ${new Date(item.created_at).toLocaleDateString(LOCALE_MAP[i18n.language] ?? 'ro-RO')}`}
              onDelete={() =>
                confirmDelete(t('admin.content.deleteReviewConfirm'), () => adminDeleteReview(item.id))
              }
            />
          )}
        />
      ) : (
        <FlatList
          data={channel}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={<Empty />}
          renderItem={({ item }) => (
            <Card
              title={
                item.deleted_at
                  ? `[${item.deleted_by_admin ? t('chat.deletedByModerator') : t('chat.deletedMessage')}]`
                  : item.image_path
                    ? `[${t('chat.photo')}]`
                    : item.content
              }
              subtitle={`${item.sender_name ?? '—'} · ${new Date(item.created_at).toLocaleDateString(LOCALE_MAP[i18n.language] ?? 'ro-RO')}`}
              onDelete={
                item.deleted_at
                  ? undefined
                  : () =>
                      confirmDelete(t('admin.content.deleteMessageConfirm'), () =>
                        adminDeleteMessage('channel_messages', item.id)
                      )
              }
            />
          )}
        />
      )}
    </ThemedView>
  );
}

function Card({
  title,
  subtitle,
  onDelete,
}: {
  title: string;
  subtitle: string;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
      <View style={{ flex: 1 }}>
        <ThemedText numberOfLines={2}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {subtitle}
        </ThemedText>
      </View>
      {onDelete ? (
        <Pressable onPress={onDelete} style={[styles.delBtn, { borderColor: '#ef4444' }]}>
          <ThemedText type="small" style={{ color: '#ef4444' }}>
            {t('admin.common.delete')}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Empty() {
  const { t } = useTranslation();
  return (
    <ThemedText themeColor="textSecondary" style={styles.empty}>
      {t('admin.content.empty')}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: 'row', paddingHorizontal: Spacing.three, paddingTop: Spacing.three, gap: Spacing.four },
  seg: { paddingVertical: Spacing.two },
  searchBox: { paddingHorizontal: Spacing.three, paddingTop: Spacing.two },
  list: { padding: Spacing.three, gap: Spacing.two, flexGrow: 1 },
  empty: { textAlign: 'center', marginTop: Spacing.five },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  delBtn: { borderWidth: 1, borderRadius: Radius.control, paddingVertical: Spacing.one, paddingHorizontal: Spacing.two },
});
