import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { HeaderText, ScreenHeader } from '@/components/screen-header';
import { StatusBadge } from '@/components/ui/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useConversations, deleteConversations, useUnreadCounts, type ConversationWithDetails } from '@/hooks/use-chat';
import { useChannels, useChannelUnreadCount } from '@/hooks/use-channel-chat';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { useTimeAgo } from '@/hooks/use-time-ago';
import type { Channel } from '@/types/database';

function ChannelCard({
  channel,
  userId,
  onPress,
}: {
  channel: Channel;
  userId: string | undefined;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { count: unreadCount } = useChannelUnreadCount(userId, channel.id);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={[styles.card, styles.channelCard]}>
        <View style={styles.cardRow}>
          <View style={styles.channelIcon}>
            <MaterialIcons name="groups" size={20} color="#fff" />
          </View>
          <View style={[styles.cardContent, styles.channelCardContent]}>
            <View style={styles.cardTop}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
                {t(`channel.name.${channel.type}`)}
              </ThemedText>
              {unreadCount > 0 ? (
                <View style={styles.unreadBadge}>
                  <ThemedText style={styles.unreadText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <ThemedText themeColor="textSecondary" type="small" numberOfLines={1}>
              {t('channel.subtitle')}
            </ThemedText>
          </View>
        </View>
      </ThemedView>
    </Pressable>
  );
}

function ConversationCard({
  item,
  avatarUrl,
  onPress,
  onLongPress,
  selectionMode,
  selected,
  onToggleSelect,
  unreadCount,
}: {
  item: ConversationWithDetails;
  avatarUrl?: string;
  onPress: () => void;
  onLongPress: () => void;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  unreadCount: number;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const timeAgo = useTimeAgo();
  return (
    <Pressable
      onPress={selectionMode ? onToggleSelect : onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={[styles.card, selected && styles.cardSelected]}>
        <View style={styles.cardRow}>
          {selectionMode ? (
            <MaterialIcons
              name={selected ? 'check-box' : 'check-box-outline-blank'}
              size={20}
              color={selected ? '#22c55e' : theme.textSecondary}
            />
          ) : null}
          <Avatar url={avatarUrl} name={item.mechanic.full_name} size={44} />
          <View style={styles.cardContent}>
            <View style={styles.cardTop}>
              <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
                {item.mechanic.full_name}
              </ThemedText>
              <View style={styles.timeRow}>
                {unreadCount > 0 && !selectionMode ? (
                  <View style={styles.unreadBadge}>
                    <ThemedText style={styles.unreadText}>
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </ThemedText>
                  </View>
                ) : null}
                <ThemedText themeColor="textSecondary" type="small" style={styles.time}>
                  {timeAgo(item.created_at)}
                </ThemedText>
              </View>
            </View>
            <View style={styles.cardBottom}>
              {item.announcement ? (
                <>
                  <View style={styles.locationRow}>
                    <MaterialIcons name="location-on" size={12} color={theme.textSecondary} />
                    <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.location}>
                      {item.announcement.location}
                    </ThemedText>
                  </View>
                  <StatusBadge status={item.announcement.status} />
                </>
              ) : (
                <View style={styles.locationRow}>
                  <MaterialIcons name="forum" size={12} color={theme.textSecondary} />
                  <ThemedText themeColor="textSecondary" type="small" numberOfLines={1} style={styles.location}>
                    {t('conversations.directLabel')}
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        </View>
      </ThemedView>
    </Pressable>
  );
}

export default function DriverConversationsScreen() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const { conversations, loading, refresh } = useConversations(session?.user.id);
  const { counts: unreadCounts, refresh: refreshCounts } = useUnreadCounts(session?.user.id);
  const { channels, refresh: refreshChannels } = useChannels();
  const router = useRouter();
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Un singur apel batch pentru avatarele tuturor mecanicilor din listă.
  const avatarPaths = useMemo(
    () => conversations.map((c) => c.mechanic.avatar_path).filter((p): p is string => !!p),
    [conversations]
  );
  const avatarUrls = useSignedUrls(avatarPaths);

  useFocusEffect(
    useCallback(() => {
      refresh();
      refreshCounts();
      refreshChannels();
    }, [refresh, refreshCounts, refreshChannels])
  );

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function enterSelection(id: string) {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  const handleDeleteSelected = useCallback(() => {
    Alert.alert(
      t('conversations.deleteConfirmTitle'),
      t('conversations.deleteConfirmMessage'),
      [
        { text: t('conversations.cancelSelection'), style: 'cancel' },
        {
          text: t('conversations.deleteConfirmOk'),
          style: 'destructive',
          onPress: async () => {
            await deleteConversations([...selectedIds], session!.user.id);
            exitSelection();
            refresh();
          },
        },
      ]
    );
  }, [t, selectedIds, session, refresh]);

  return (
    <ThemedView style={styles.container}>
      {selectionMode ? (
        <ScreenHeader>
          <View style={styles.selectionHeader}>
            <Pressable onPress={exitSelection} hitSlop={8}>
              <MaterialIcons name="close" size={24} color={theme.onHeader} />
            </Pressable>
            <HeaderText>
              {t('conversations.selectedCount', { count: selectedIds.size })}
            </HeaderText>
            <Pressable onPress={handleDeleteSelected} disabled={selectedIds.size === 0} hitSlop={8}>
              <HeaderText style={selectedIds.size === 0 && styles.deleteTextDisabled}>
                {t('conversations.deleteButton')}
              </HeaderText>
            </Pressable>
          </View>
        </ScreenHeader>
      ) : (
        <ScreenHeader title={t('driver.conversations.title')} />
      )}

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={loading}
        onRefresh={refresh}
        ListHeaderComponent={
          channels.length > 0 ? (
            <View style={styles.channelSection}>
              {channels.map((channel) => (
                <ChannelCard
                  key={channel.id}
                  channel={channel}
                  userId={session?.user.id}
                  onPress={() =>
                    router.push({
                      pathname: '/(driver)/conversations/channel/[id]' as never,
                      params: { id: channel.id },
                    })
                  }
                />
              ))}
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <ConversationCard
            item={item}
            avatarUrl={item.mechanic.avatar_path ? avatarUrls[item.mechanic.avatar_path] : undefined}
            selectionMode={selectionMode}
            selected={selectedIds.has(item.id)}
            onPress={() =>
              router.push({
                pathname: '/(driver)/conversations/[id]' as never,
                params: { id: item.id },
              })
            }
            onLongPress={() => enterSelection(item.id)}
            onToggleSelect={() => toggleSelect(item.id)}
            unreadCount={unreadCounts[item.id] ?? 0}
          />
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              icon="chat"
              title={t('driver.conversations.emptyTitle')}
              description={t('driver.conversations.emptyDescription')}
            />
          ) : null
        }
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  selectionHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  deleteTextDisabled: { opacity: 0.4 },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.four,
  },
  separator: { height: Spacing.two },
  channelSection: { marginBottom: Spacing.two },
  card: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  channelCard: { borderWidth: 1, borderColor: '#8B5CF633' },
  channelCardContent: { gap: 2 },
  channelIcon: {
    width: 36,
    height: 36,
    borderRadius: Radius.circle,
    backgroundColor: '#8B5CF6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardSelected: { borderWidth: 1.5, borderColor: '#22c55e' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  cardContent: { flex: 1 },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  name: { flex: 1 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 0 },
  unreadBadge: {
    backgroundColor: '#ef4444',
    borderRadius: Radius.circle,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    justifyContent: 'center',
    alignItems: 'center',
  },
  unreadText: { color: '#fff', fontSize: 11, fontWeight: '700', lineHeight: 16, includeFontPadding: false },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 },
  location: { flex: 1 },
  time: { flexShrink: 0 },
  pressed: { opacity: 0.7 },
});
