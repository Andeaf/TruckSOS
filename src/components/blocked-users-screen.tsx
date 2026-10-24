import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/avatar';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { supabase } from '@/lib/supabase';
import { useBack } from '@/hooks/use-back';
import { useBlocked } from '@/hooks/use-blocked';
import { useTheme } from '@/hooks/use-theme';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { displayName } from '@/lib/display-name';

/**
 * „Utilizatori blocați" din Setări (Faza 18), comun ambelor roluri prin rute subțiri.
 * Lista vine din useBlocked (propriile blocări); profilurile (nume/avatar) se citesc
 * separat — un cont blocat poate fi între timp și șters (piatră-funerară), caz în care
 * afișăm marcajul standard „Utilizator șters", dar deblocarea rămâne posibilă.
 */

type BlockedProfile = {
  id: string;
  full_name: string;
  avatar_path: string | null;
  deleted_at: string | null;
};

const LOCALE_MAP: Record<string, string> = { ro: 'ro-RO', en: 'en-GB', de: 'de-DE' };

export function BlockedUsersScreen({ backPath }: { backPath: string }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const goBack = useBack(backPath);
  const { rows, unblock, refresh } = useBlocked();
  const [profiles, setProfiles] = useState<Record<string, BlockedProfile>>({});
  const [loading, setLoading] = useState(true);

  // Resincronizare la deschidere: blocările pot veni și din alte ecrane (chat, profil).
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    (async () => {
      const ids = rows.map((r) => r.blocked_id);
      if (ids.length === 0) {
        if (active) {
          setProfiles({});
          setLoading(false);
        }
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_path, deleted_at')
        .in('id', ids);
      if (!active) return;
      const map: Record<string, BlockedProfile> = {};
      (((data as unknown as BlockedProfile[]) ?? [])).forEach((p) => {
        map[p.id] = p;
      });
      setProfiles(map);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [rows]);

  const avatarPaths = useMemo(
    () =>
      Object.values(profiles)
        .map((p) => p.avatar_path)
        .filter((p): p is string => !!p),
    [profiles]
  );
  const urls = useSignedUrls(avatarPaths);

  function handleUnblock(userId: string) {
    Alert.alert(t('block.unblockConfirmTitle'), t('block.unblockConfirmBody'), [
      { text: t('block.cancel'), style: 'cancel' },
      { text: t('block.unblock'), onPress: () => unblock(userId) },
    ]);
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString(LOCALE_MAP[i18n.language] ?? 'en-GB');
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('settings.blockedUsers')} onBack={goBack} />

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={theme.brand} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="block" size={48} color={theme.textSecondary} />
          <ThemedText themeColor="textSecondary" type="small" style={styles.emptyText}>
            {t('block.empty')}
          </ThemedText>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.blocked_id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const profile = profiles[item.blocked_id];
            const name = profile ? displayName(profile, t) : '';
            return (
              <ThemedView type="backgroundElement" style={styles.row}>
                <Avatar
                  url={profile?.avatar_path ? urls[profile.avatar_path] : undefined}
                  name={name}
                  size={44}
                  userId={item.blocked_id}
                />
                <View style={styles.rowInfo}>
                  <ThemedText type="smallBold" numberOfLines={1}>
                    {name}
                  </ThemedText>
                  <ThemedText themeColor="textSecondary" type="small">
                    {t('block.blockedOn', { date: formatDate(item.created_at) })}
                  </ThemedText>
                </View>
                <Pressable onPress={() => handleUnblock(item.blocked_id)} hitSlop={8}>
                  <ThemedText style={[styles.unblockAction, { color: theme.brand }]}>
                    {t('block.unblock')}
                  </ThemedText>
                </Pressable>
              </ThemedView>
            );
          }}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  emptyText: { textAlign: 'center', paddingHorizontal: Spacing.five },
  list: { padding: Spacing.four, gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  rowInfo: { flex: 1, gap: 2 },
  unblockAction: { fontSize: 14, fontWeight: '700' },
});
