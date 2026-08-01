import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import {
  SEARCH_MIN_LENGTH,
  useUserSearch,
  type UserSearchResult,
} from '@/hooks/use-mechanic-search';
import { useSignedUrls } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';

/**
 * Faza 19.6: pickerul de utilizatori (AMBELE roluri) — folosit de butonul „Începe o
 * conversație nouă" din lista de chat și de share-ul anunțurilor (depanare + market).
 * Căutare server-side (RPC search_users: fără sine, admini, ștersși sau perechi blocate).
 */
interface UserPickerSheetProps {
  visible: boolean;
  /** Titlul sheet-ului — diferă între „conversație nouă" și „trimite anunțul". */
  title: string;
  onClose: () => void;
  onPick: (user: UserSearchResult) => void;
}

export function UserPickerSheet({ visible, title, onClose, onPick }: UserPickerSheetProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const { results, loading } = useUserSearch(query);
  const avatarPaths = useMemo(
    () => results.map((r) => r.avatar_path).filter((p): p is string => !!p),
    [results],
  );
  const urls = useSignedUrls(avatarPaths);
  const tooShort = query.trim().length < SEARCH_MIN_LENGTH;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View style={styles.wrapper}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.backgroundElement, paddingBottom: insets.bottom + Spacing.two },
          ]}>
          <View style={styles.header}>
            <ThemedText type="smallBold">{title}</ThemedText>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('photos.close')}>
              <MaterialIcons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          <TextInput
            style={[styles.search, { color: theme.text, backgroundColor: theme.background }]}
            value={query}
            onChangeText={setQuery}
            placeholder={t('attach.searchUsers')}
            placeholderTextColor={theme.textTertiary}
            autoFocus
          />

          {tooShort ? (
            <View style={styles.centered}>
              <MaterialIcons name="person-search" size={36} color={theme.textTertiary} />
              <ThemedText themeColor="textSecondary" type="small">
                {t('attach.searchHint')}
              </ThemedText>
            </View>
          ) : loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={theme.brand} />
            </View>
          ) : results.length === 0 ? (
            <View style={styles.centered}>
              <ThemedText themeColor="textSecondary" type="small">
                {t('attach.noResults')}
              </ThemedText>
            </View>
          ) : (
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPick(item)}
                  style={({ pressed }) => [
                    styles.row,
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <Avatar
                    url={item.avatar_path ? urls[item.avatar_path] : undefined}
                    name={item.full_name}
                    size={40}
                  />
                  <View style={styles.info}>
                    <ThemedText numberOfLines={1} type="smallBold">
                      {item.full_name}
                    </ThemedText>
                    <ThemedText numberOfLines={1} type="small" themeColor="textSecondary">
                      {t(`auth.roleSelect.${item.role}Title`)}
                      {item.rating_count > 0 ? ` · ★ ${item.rating_avg.toFixed(1)}` : ''}
                      {item.activity_zone ? ` · ${item.activity_zone}` : ''}
                    </ThemedText>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color={theme.textTertiary} />
                </Pressable>
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    height: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  search: {
    marginHorizontal: Spacing.four,
    marginBottom: Spacing.two,
    borderRadius: Radius.badge,
    paddingHorizontal: Spacing.three,
    paddingVertical: 9,
    fontSize: 14,
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.two },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  info: { flex: 1, gap: 1 },
});
