import { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AdminRefreshButton } from '@/components/admin/refresh-button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Shadows, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWideLayout } from '@/components/web-sidebar';
import {
  adminDeleteAnnouncement,
  adminDeleteListing,
  adminDeleteMessage,
  adminDeleteReview,
  fetchChannelMessages,
  fetchRecentAnnouncements,
  fetchRecentListings,
  fetchRecentReviews,
  searchAnnouncements,
  type AdminAnnouncement,
  type AdminChannelMessage,
  type AdminListing,
  type AdminReview,
} from '@/hooks/use-admin';

type Segment = 'announcements' | 'market' | 'reviews' | 'channel';
const SEGMENTS: Segment[] = ['announcements', 'market', 'reviews', 'channel'];

/** Locale explicit: altfel formatul urmează regiunea dispozitivului, nu limba aplicației. */
const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

export default function AdminContent() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  // Design 10c: pe web lat — titlu în pagină, tab-uri subliniate cu căutarea pe
  // același rând, status pe pastile și buton de ștergere conturat.
  const wide = useWideLayout();
  const [segment, setSegment] = useState<Segment>('announcements');
  const [annQuery, setAnnQuery] = useState('');
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [channel, setChannel] = useState<AdminChannelMessage[]>([]);
  // Reîncărcare la focus / după o ștergere: bump-ul re-declanșează efectele de mai jos.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((v) => v + 1), []);

  useFocusEffect(refresh);

  // Reîncărcare la cerere (15 sept): pull-to-refresh + butonul din antet. Așteaptă
  // răspunsul segmentului curent (spinner-ul de tragere trebuie să știe când s-a
  // terminat), spre deosebire de `refresh`, care doar re-declanșează efectele.
  const reload = useCallback(async () => {
    if (segment === 'announcements') {
      const q = annQuery.trim();
      const { data } = await (q.length >= 2 ? searchAnnouncements(q) : fetchRecentAnnouncements());
      setAnnouncements(data);
    } else if (segment === 'market') {
      setListings((await fetchRecentListings()).data);
    } else if (segment === 'reviews') {
      setReviews((await fetchRecentReviews()).data);
    } else {
      setChannel((await fetchChannelMessages()).data);
    }
  }, [segment, annQuery]);
  // Spinner-ul DOAR la gestul de tragere (pe iOS `refreshing` setat programatic
  // inserează insetul indicatorului, care poate rămâne blocat — lecția din listele
  // șoferului); butonul din antet reîncarcă silențios.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(async () => {
    setPullRefreshing(true);
    await reload();
    setPullRefreshing(false);
  }, [reload]);

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
    else if (segment === 'market') fetchRecentListings().then(({ data }) => setListings(data));
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
      {wide ? (
        <View style={w.titleRow}>
          <ThemedText style={w.pageTitle}>{t('admin.content.title')}</ThemedText>
          <AdminRefreshButton onPress={reload} />
        </View>
      ) : (
        <ScreenHeader
          title={t('admin.content.title')}
          right={<AdminRefreshButton onPress={reload} onHeader />}
        />
      )}

      <View style={[styles.segments, wide && [w.segments, { borderBottomColor: theme.separator }]]}>
        {SEGMENTS.map((s) => {
          const active = s === segment;
          return (
            <Pressable
              key={s}
              onPress={() => setSegment(s)}
              style={[
                styles.seg,
                active && { borderBottomColor: wide ? theme.brand : '#6366f1', borderBottomWidth: 2 },
              ]}>
              <ThemedText
                themeColor={active ? undefined : 'textSecondary'}
                type="small"
                style={wide ? [w.segText, active && { color: theme.brand, fontWeight: '700' }] : null}>
                {t(`admin.content.tab_${s}`)}
              </ThemedText>
            </Pressable>
          );
        })}
        {wide && segment === 'announcements' ? (
          <View style={[w.searchPill, { backgroundColor: theme.backgroundElement }]}>
            <Feather name="search" size={14} color={theme.textTertiary} />
            <TextInput
              value={annQuery}
              onChangeText={setAnnQuery}
              placeholder={t('admin.content.searchPlaceholder')}
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="none"
              returnKeyType="search"
              style={[w.searchInput, { color: theme.text }]}
            />
          </View>
        ) : null}
      </View>

      {!wide && segment === 'announcements' ? (
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
          refreshing={pullRefreshing}
          onRefresh={onPullRefresh}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.list, wide && w.list]}
          ListEmptyComponent={
            <ThemedText themeColor="textSecondary" style={styles.empty}>
              {annQuery.trim().length >= 2 ? t('admin.content.noResults') : t('admin.content.empty')}
            </ThemedText>
          }
          renderItem={({ item }) => (
            <Card
              title={item.description}
              subtitle={
                (wide
                  ? `${item.driver_name ?? '—'} · ${new Date(item.created_at).toLocaleDateString(LOCALE_MAP[i18n.language] ?? 'ro-RO')}`
                  : `${item.driver_name ?? '—'} · ${t(`status.${item.status}`)} · ${new Date(item.created_at).toLocaleDateString(LOCALE_MAP[i18n.language] ?? 'ro-RO')}`) +
                (item.view_count != null ? ` · ${t('admin.content.views', { n: item.view_count })}` : '')
              }
              status={wide ? item.status : undefined}
              onDelete={() =>
                confirmDelete(t('admin.content.deleteAnnouncementConfirm'), () =>
                  adminDeleteAnnouncement(item.id)
                )
              }
            />
          )}
        />
      ) : segment === 'market' ? (
        <FlatList
          data={listings}
          keyExtractor={(l) => l.id}
          refreshing={pullRefreshing}
          onRefresh={onPullRefresh}
          contentContainerStyle={[styles.list, wide && w.list]}
          ListEmptyComponent={<Empty />}
          renderItem={({ item }) => (
            <Card
              title={item.title}
              subtitle={`${item.seller_name ?? '—'} · ${Number(item.price).toLocaleString()} ${item.currency} · ${t(`market.categories.${item.category}`)}${item.status === 'sold' ? ` · ${t('market.soldBadge')}` : ''} · ${new Date(item.created_at).toLocaleDateString(LOCALE_MAP[i18n.language] ?? 'ro-RO')}`}
              onDelete={() =>
                confirmDelete(t('admin.content.deleteListingConfirm'), () =>
                  adminDeleteListing(item.id)
                )
              }
            />
          )}
        />
      ) : segment === 'reviews' ? (
        <FlatList
          data={reviews}
          keyExtractor={(r) => r.id}
          refreshing={pullRefreshing}
          onRefresh={onPullRefresh}
          contentContainerStyle={[styles.list, wide && w.list]}
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
          refreshing={pullRefreshing}
          onRefresh={onPullRefresh}
          contentContainerStyle={[styles.list, wide && w.list]}
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
  status,
  onDelete,
}: {
  title: string;
  subtitle: string;
  /** Design 10c (doar pe lat): statusul anunțului ca pastilă colorată. */
  status?: string;
  onDelete?: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const wide = useWideLayout();

  // Culorile pastilelor din design: Open verde, Accepted albastru, restul neutre.
  const pill =
    status === 'open'
      ? { bg: theme.successBg, fg: theme.successText }
      : status === 'accepted'
        ? { bg: theme.brandSoft, fg: theme.brand }
        : status === 'cancelled'
          ? { bg: 'rgba(214,69,69,0.12)', fg: '#D64545' }
          : { bg: theme.neutralBg, fg: theme.textSecondary };

  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }, wide && w.card]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <ThemedText numberOfLines={2} style={wide ? w.cardTitle : null}>
          {title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" style={wide ? w.cardMeta : null}>
          {subtitle}
        </ThemedText>
      </View>
      {wide && status ? (
        <View style={[w.statusPill, { backgroundColor: pill.bg }]}>
          <ThemedText type="small" style={[w.statusPillText, { color: pill.fg }]}>
            {t(`status.${status}`)}
          </ThemedText>
        </View>
      ) : null}
      {onDelete ? (
        wide ? (
          <Pressable onPress={onDelete} style={w.delPill}>
            <Feather name="trash-2" size={14} color="#D64545" />
            <ThemedText type="small" style={w.delPillText}>
              {t('admin.common.delete')}
            </ThemedText>
          </Pressable>
        ) : (
          <Pressable onPress={onDelete} style={[styles.delBtn, { borderColor: '#ef4444' }]}>
            <ThemedText type="small" style={{ color: '#ef4444' }}>
              {t('admin.common.delete')}
            </ThemedText>
          </Pressable>
        )
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

/** Stilurile variantei late (design 10c). */
const w = StyleSheet.create({
  // Titlul + butonul „Reîncarcă" pe același rând (15 sept); layout-ul de pagină
  // (padding/lățime) s-a mutat de pe text pe rând.
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 28,
    paddingTop: 24,
    maxWidth: 1060,
    width: '100%',
    alignSelf: 'center',
  },
  pageTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.4,
    lineHeight: 32,
  },
  segments: {
    paddingHorizontal: 28,
    paddingTop: 14,
    gap: 22,
    alignItems: 'center',
    borderBottomWidth: 1,
    maxWidth: 1060,
    width: '100%',
    alignSelf: 'center',
  },
  segText: { fontSize: 14, fontWeight: '600' },
  searchPill: {
    marginLeft: 'auto',
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 16,
    width: 320,
    ...Shadows.chip,
  },
  searchInput: { flex: 1, fontSize: 13, paddingVertical: 5 },
  list: { maxWidth: 1060, width: '100%', alignSelf: 'center', paddingHorizontal: 28, gap: 10 },
  card: {
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 16,
    ...Shadows.card,
  },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardMeta: { fontSize: 12.5, fontWeight: '600', marginTop: 5 },
  statusPill: { borderRadius: 999, paddingVertical: 4, paddingHorizontal: 10 },
  statusPillText: { fontSize: 12, fontWeight: '700' },
  delPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#F3C6C6',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  delPillText: { color: '#D64545', fontSize: 13, fontWeight: '700' },
});
