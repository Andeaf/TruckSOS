import { ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AvatarPicker } from '@/components/avatar-picker';
import { RatingBadge } from '@/components/rating-badge';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ListRow, RowGroup, SectionLabel } from '@/components/ui/list-row';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/hooks/use-auth';

/**
 * Profilul mecanicului (PLAN_FAZA10.md §4): read-only + navigație.
 * Detaliile profesionale rămân vizibile aici (sunt informație, nu setare);
 * se editează din `profile/edit`, deschis din Setări.
 */
export default function MechanicProfileScreen() {
  const { session, profile, signOut } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  function detail(icon: keyof typeof MaterialIcons.glyphMap, label: string, value: string | null) {
    return (
      <View style={styles.detail}>
        <View style={styles.detailHeader}>
          <MaterialIcons name={icon} size={16} color="#22c55e" />
          <ThemedText type="smallBold">{label}</ThemedText>
        </View>
        <ThemedText themeColor={value ? undefined : 'textSecondary'}>
          {value || t('profile.emptyField')}
        </ThemedText>
      </View>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('profile.myProfileTitle')} />

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedView type="backgroundElement" style={styles.identityCard}>
          <AvatarPicker size={64} />
          <View style={styles.identityText}>
            <ThemedText themeColor="textSecondary" type="small">
              {t('profile.connectedAs')}
            </ThemedText>
            <ThemedText type="smallBold" numberOfLines={1}>
              {profile?.full_name}
            </ThemedText>
            <ThemedText themeColor="textSecondary" type="small" numberOfLines={1}>
              {session?.user.email}
            </ThemedText>
            <RatingBadge avg={profile?.rating_avg ?? 0} count={profile?.rating_count ?? 0} />
          </View>
        </ThemedView>

        <SectionLabel>{t('profile.sectionDetails')}</SectionLabel>
        <ThemedView type="backgroundElement" style={styles.detailsCard}>
          {detail('build', t('profile.specializationLabel'), profile?.specialization ?? null)}
          {detail('place', t('profile.activityZoneLabel'), profile?.activity_zone ?? null)}
          {detail('phone', t('profile.phoneLabel'), profile?.phone ?? null)}
          <ThemedText themeColor="textSecondary" type="small">
            {t('profile.phoneHint')}
          </ThemedText>
        </ThemedView>

        <SectionLabel>{t('profile.sectionAccount')}</SectionLabel>
        <RowGroup>
          <ListRow
            icon="settings"
            label={t('settings.title')}
            onPress={() => router.push('/(mechanic)/profile/settings' as never)}
          />
          <ListRow
            icon="description"
            label={t('profile.terms')}
            onPress={() => router.push('/(mechanic)/profile/terms' as never)}
          />
          <ListRow
            icon="shield"
            label={t('profile.privacy')}
            onPress={() => router.push('/(mechanic)/profile/privacy' as never)}
          />
        </RowGroup>

        <View style={styles.signOut}>
          <ListRow icon="logout" label={t('common.signOut')} destructive onPress={signOut} />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.two },
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Radius.card,
  },
  identityText: { flex: 1, gap: 2 },
  detailsCard: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  detail: { gap: Spacing.one },
  detailHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  signOut: { marginTop: Spacing.three },
});
