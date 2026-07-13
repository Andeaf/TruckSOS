import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ActionSheet, type SheetAction } from '@/components/action-sheet';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ListRow, RowGroup, SectionLabel } from '@/components/ui/list-row';
import { Spacing } from '@/constants/theme';
import { useBack } from '@/hooks/use-back';
import { useSettings } from '@/hooks/use-settings';
import type { LangPref, ThemePref } from '@/lib/preferences';

/**
 * Ecranul de setări, comun ambelor roluri (PLAN_FAZA10.md §3).
 * Limba și tema se schimbă instant (fără restart) și persistă în AsyncStorage.
 */

const LANGS: LangPref[] = ['auto', 'ro', 'en', 'de'];
const THEMES: ThemePref[] = ['auto', 'light', 'dark'];

export function SettingsScreen({ editPath, backPath }: { editPath: string; backPath: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const goBack = useBack(backPath);
  const { lang, setLang, theme, setTheme } = useSettings();
  const [sheet, setSheet] = useState<'lang' | 'theme' | null>(null);

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

        <ThemedText themeColor="textSecondary" type="small" style={styles.version}>
          {t('settings.version', { version: Constants.expoConfig?.version ?? '—' })}
        </ThemedText>
      </ScrollView>

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
});
