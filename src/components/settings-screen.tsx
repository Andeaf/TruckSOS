import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ListRow, RowGroup, SectionLabel, SwitchRow } from '@/components/ui/list-row';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { useSettings } from '@/hooks/use-settings';
import { getCurrentCoords } from '@/lib/location';
import { registerPushToken } from '@/lib/push';
import { hasPasswordIdentity, socialProviderLabel } from '@/lib/social-auth';
import type { LangPref, ThemePref } from '@/lib/preferences';

/**
 * Ecranul de setări, comun ambelor roluri (PLAN_FAZA10.md §3).
 * Limba și tema se schimbă instant (fără restart) și persistă în AsyncStorage.
 */

const LANGS: LangPref[] = ['auto', 'ro', 'en', 'de'];
const THEMES: ThemePref[] = ['auto', 'light', 'dark'];
/** Raze fixe, nu câmp liber: alegerea e mai rapidă și evită valori absurde. */
const RADII: (number | null)[] = [25, 50, 100, 200, null];

export function SettingsScreen({
  editPath,
  backPath,
  deletePath,
  blockedPath,
  changePasswordPath,
  changeEmailPath,
}: {
  editPath: string;
  backPath: string;
  deletePath: string;
  blockedPath: string;
  changePasswordPath: string;
  changeEmailPath: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack(backPath);
  const { lang, setLang, theme, setTheme } = useSettings();
  const { session, profile, updateProfile } = useAuth();
  const [sheet, setSheet] = useState<'lang' | 'theme' | 'radius' | null>(null);
  const [locating, setLocating] = useState(false);

  const isMechanic = profile?.role === 'mechanic';
  const hasPosition = profile?.latitude != null && profile?.longitude != null;

  function radiusLabel(km: number | null): string {
    return km == null ? t('settings.radiusOff') : t('settings.radiusKm', { km });
  }

  const radiusActions: SheetAction[] = RADII.map((km) => ({
    label: radiusLabel(km),
    icon: km === (profile?.notify_radius_km ?? null) ? 'check-circle' : 'radio-button-unchecked',
    onPress: () => updateProfile({ notify_radius_km: km }),
  }));

  // Poziția de referință a mecanicului (atelier/domiciliu) — o citim o dată, la cerere.
  // Filtrul de rază n-are sens fără ea, deci o setare eșuată trebuie spusă explicit.
  async function handleSetPosition() {
    setLocating(true);
    const result = await getCurrentCoords();
    setLocating(false);

    if ('error' in result) {
      Alert.alert(t('settings.positionError'));
      return;
    }
    const err = await updateProfile({
      latitude: result.latitude,
      longitude: result.longitude,
    });
    if (err) Alert.alert(t('settings.positionError'));
  }

  // Bifa marchează opțiunea activă; restul primesc cercul gol.
  const langActions: SheetAction[] = LANGS.map((value) => ({
    label: t(`settings.lang.${value}`),
    icon: value === lang ? 'check-circle' : 'radio-button-unchecked',
    onPress: () => setLang(value),
  }));

  const themeActions: SheetAction[] = THEMES.map((value) => ({
    label: t(`settings.theme.${value}`),
    icon: value === theme ? 'check-circle' : 'radio-button-unchecked',
    onPress: () => setTheme(value),
  }));

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('settings.title')} onBack={goBack} />

      <ScrollView contentContainerStyle={styles.content}>
        <RowGroup>
          <ListRow
            icon="person"
            label={t('settings.editProfile')}
            onPress={() => router.push(editPath as never)}
          />
          {hasPasswordIdentity(session?.user) ? (
            <>
              <ListRow
                icon="lock-outline"
                label={t('settings.changePassword')}
                onPress={() => router.push(changePasswordPath as never)}
              />
              <ListRow
                icon="alternate-email"
                label={t('settings.changeEmail')}
                value={session?.user.email ?? undefined}
                onPress={() => router.push(changeEmailPath as never)}
              />
            </>
          ) : (
            // 6 oct: cont Google/Apple, fără parolă — parola și emailul se gestionează la
            // furnizor; aici doar arătăm cu ce e conectat contul.
            <ListRow
              icon="verified-user"
              label={t('settings.signedInWith', { provider: socialProviderLabel(session?.user) ?? '' })}
              value={session?.user.email ?? undefined}
              chevron={false}
            />
          )}
        </RowGroup>

        <SectionLabel>{t('settings.appearance')}</SectionLabel>
        <RowGroup>
          <ListRow
            icon="language"
            label={t('settings.language')}
            value={t(`settings.lang.${lang}`)}
            onPress={() => setSheet('lang')}
          />
          <ListRow
            icon="brightness-6"
            label={t('settings.theme.label')}
            value={t(`settings.theme.${theme}`)}
            onPress={() => setSheet('theme')}
          />
        </RowGroup>

        <SectionLabel>{t('settings.notifications')}</SectionLabel>
        <RowGroup>
          <SwitchRow
            icon="notifications"
            label={t('settings.pushEnabled')}
            value={profile?.push_enabled ?? true}
            onValueChange={(next) => {
              updateProfile({ push_enabled: next });
              // Pornirea comutatorului repară și un token lipsă (ex. permisiunea de
              // notificări acordată ABIA DUPĂ login, din setările Android) — altfel
              // înregistrarea rulează doar la pornirea aplicației. În Expo Go iese tăcut.
              if (next && session) void registerPushToken(session.user.id);
            }}
          />

          {/* 8 sept 2026: Marketul notifică TOȚI utilizatorii la anunț nou, deci are
              nevoie de propriul opt-out. Ascuns cât timp comutatorul global e oprit —
              atunci nu pleacă oricum nimic, iar alegerea rămâne salvată pe server. */}
          {(profile?.push_enabled ?? true) ? (
            <SwitchRow
              icon="storefront"
              label={t('settings.marketPushEnabled')}
              value={profile?.market_push_enabled ?? true}
              onValueChange={(next) => updateProfile({ market_push_enabled: next })}
            />
          ) : null}

          {/* Raza și poziția au sens doar pentru mecanic: el primește anunțurile noi. */}
          {isMechanic ? (
            <>
              <ListRow
                icon="radar"
                label={t('settings.radius')}
                value={radiusLabel(profile?.notify_radius_km ?? null)}
                onPress={() => setSheet('radius')}
              />
              <ListRow
                icon="my-location"
                label={t('settings.position')}
                value={
                  locating
                    ? t('settings.positionLoading')
                    : hasPosition
                      ? t('settings.positionSet')
                      : t('settings.positionUnset')
                }
                onPress={handleSetPosition}
              />
            </>
          ) : null}
        </RowGroup>

        {isMechanic && profile?.notify_radius_km != null && !hasPosition ? (
          <ThemedText themeColor="textSecondary" type="small">
            {t('settings.radiusNeedsPosition')}
          </ThemedText>
        ) : null}

        {/* Faza 18: gestionarea blocărilor — cerință Apple (Guideline 1.2 UGC). */}
        <SectionLabel>{t('settings.privacySection')}</SectionLabel>
        <RowGroup>
          <ListRow
            icon="block"
            label={t('settings.blockedUsers')}
            onPress={() => router.push(blockedPath as never)}
          />
        </RowGroup>

        <ThemedText themeColor="textSecondary" type="small" style={styles.version}>
          {t('settings.version', { version: Constants.expoConfig?.version ?? '—' })}
        </ThemedText>

        {/* Zonă distructivă, separată vizual: ștergerea contului nu trebuie apăsată din greșeală. */}
        <View style={styles.dangerZone}>
          <RowGroup>
            <ListRow
              icon="delete-forever"
              label={t('settings.deleteAccount')}
              destructive
              onPress={() => router.push(deletePath as never)}
            />
          </RowGroup>
        </View>
      </ScrollView>

      <ActionSheet
        visible={sheet === 'radius'}
        title={t('settings.radius')}
        actions={radiusActions}
        onClose={() => setSheet(null)}
      />

      <ActionSheet
        visible={sheet === 'lang'}
        title={t('settings.language')}
        actions={langActions}
        onClose={() => setSheet(null)}
      />
      <ActionSheet
        visible={sheet === 'theme'}
        title={t('settings.theme.label')}
        actions={themeActions}
        onClose={() => setSheet(null)}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.two },
  version: { textAlign: 'center', marginTop: Spacing.four },
  dangerZone: { marginTop: Spacing.four },
});
