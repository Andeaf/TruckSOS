import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';
import type { MentionUser } from '@/lib/mention-search';

/** Înălțimea unui rând; panoul arată 4 rânduri și jumătate (a cincea „trasă" = mai sunt). */
const ROW_HEIGHT = 50;
const MAX_VISIBLE_ROWS = 4.5;

/**
 * Fereastra de menționări (10 sept 2026, „ca pe WhatsApp"): lista de persoane care
 * apare deasupra casetei text când se tastează „@" și se filtrează pe măsură ce se
 * scrie numele. Tap pe un rând → „@Nume " intră în text (insertMention, chat-screen).
 * Componentă pură: primește lista deja ordonată; avatarele se semnează separat de
 * cele ale mesajelor (rezultatele de pe server nu sunt în batch-ul listei).
 */
export function MentionPanel({
  users,
  onPick,
}: {
  users: MentionUser[];
  onPick: (user: MentionUser) => void;
}) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const { t } = useTranslation();
  const avatarPaths = useMemo(
    () => users.map((u) => u.avatar_path).filter((p): p is string => !!p),
    [users],
  );
  const urls = useSignedUrls(avatarPaths);

  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: theme.backgroundElement, borderColor: theme.separator },
        scheme === 'light' ? styles.shadowLight : styles.shadowDark,
      ]}>
      <FlatList
        data={users}
        keyExtractor={(u) => u.id}
        // Tastatura rămâne deschisă și tap-ul ajunge la rând (nu e „înghițit" de
        // închiderea tastaturii) — utilizatorul continuă să scrie după alegere.
        keyboardShouldPersistTaps="always"
        style={styles.list}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onPick(item)}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: theme.backgroundSelected },
            ]}>
            <Avatar
              url={item.avatar_path ? urls[item.avatar_path] : undefined}
              name={item.full_name}
              size={34}
              userId={item.id}
            />
            <View style={styles.info}>
              <ThemedText type="smallBold" numberOfLines={1}>
                {item.full_name}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
                {t(`auth.roleSelect.${item.role}Title`)}
              </ThemedText>
            </View>
          </Pressable>
        )}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: theme.separator }]} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  shadowLight: {
    shadowColor: '#142850',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 6,
  },
  shadowDark: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 6,
  },
  list: { maxHeight: ROW_HEIGHT * MAX_VISIBLE_ROWS },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    height: ROW_HEIGHT,
    paddingHorizontal: Spacing.three,
  },
  info: { flex: 1, gap: 1 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three + 34 + Spacing.two },
});
