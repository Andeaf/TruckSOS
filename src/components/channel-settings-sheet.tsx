import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ListRow, RowGroup, SwitchRow } from '@/components/ui/list-row';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useChannelPushPref } from '@/hooks/use-channel-push-pref';
import { useTheme } from '@/hooks/use-theme';

/**
 * Setările canalului global (5 aug): notificări OPT-IN per canal + scurtătură spre
 * setările aplicației. Se deschide de pe cardul canalului (tabul Conversații) și
 * din rotița antetului chatului de canal. Fundal `background` + rânduri
 * `backgroundElement` — același contrast ca ecranul de Setări.
 */
export function ChannelSettingsSheet({
  visible,
  channelId,
  channelName,
  role,
  onClose,
}: {
  visible: boolean;
  channelId: string;
  channelName: string;
  role: 'driver' | 'mechanic';
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { enabled, toggle } = useChannelPushPref(channelId, session?.user.id);

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
            {
              backgroundColor: theme.background,
              paddingBottom: insets.bottom + Spacing.three,
            },
          ]}>
          <View style={styles.header}>
            <ThemedText type="smallBold" numberOfLines={1} style={styles.headerTitle}>
              {t('channelSettings.title')} · {channelName}
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel={t('photos.close')}>
              <MaterialIcons name="close" size={22} color={theme.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.content}>
            <RowGroup>
              <SwitchRow
                icon="notifications"
                label={t('channelSettings.notifyLabel')}
                value={enabled}
                onValueChange={toggle}
              />
              <ListRow
                icon="settings"
                label={t('channelSettings.appSettings')}
                onPress={() => {
                  onClose();
                  router.push(`/(${role})/profile/settings` as never);
                }}
              />
            </RowGroup>
            <ThemedText themeColor="textSecondary" type="small" style={styles.hint}>
              {t('channelSettings.notifyHint', { name: channelName })}
            </ThemedText>
          </View>
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
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
  },
  headerTitle: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  hint: { lineHeight: 18, paddingHorizontal: Spacing.one },
});
