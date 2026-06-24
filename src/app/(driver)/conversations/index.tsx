import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/ui/status-badge';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';
import { useConversations, type ConversationWithDetails } from '@/hooks/use-chat';

function useTimeAgo() {
  const { t } = useTranslation();
  return (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('common.timeNow');
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}z`;
  };
}

function ConversationCard({
  item,
  onPress,
}: {
  item: ConversationWithDetails;
  onPress: () => void;
}) {
  const theme = useTheme();
  const timeAgo = useTimeAgo();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => pressed && styles.pressed}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <View style={styles.cardTop}>
          <ThemedText type="smallBold" numberOfLines={1} style={styles.name}>
            {item.mechanic.full_name}
          </ThemedText>
          <ThemedText themeColor="textSecondary" type="small">
            {timeAgo(item.created_at)}
          </ThemedText>
        </View>
        <View style={styles.cardBottom}>
          <View style={styles.locationRow}>
            <MaterialIcons name="location-on" size={12} color={theme.textSecondary} />
            <ThemedText
              themeColor="textSecondary"
              type="small"
              numberOfLines={1}
              style={styles.location}>
              {item.announcement.location}
            </ThemedText>
          </View>
          <StatusBadge status={item.announcement.status} />
        </View>
      </ThemedView>
    </Pressable>
  );
}

export default function DriverConversationsScreen() {
  const { session } = useAuth();
  const { t } = useTranslation();
  const { conversations, loading, refresh } = useConversations(session?.user.id);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh])
  );

  return (
    <ThemedView style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <ThemedText type="subtitle">{t('driver.conversations.title')}</ThemedText>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        refreshing={loading}
        onRefresh={refresh}
        renderItem={({ item }) => (
          <ConversationCard
            item={item}
            onPress={() =>
              router.push({
                pathname: '/(driver)/conversations/[id]' as never,
                params: { id: item.id },
              })
            }
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
  header: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  separator: { height: Spacing.two },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
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
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 },
  location: { flex: 1 },
  pressed: { opacity: 0.7 },
});
