import { ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useBack } from '@/hooks/use-back';

/**
 * Termeni / Confidențialitate — text static din i18n. Conținutul juridic e
 * deocamdată provizoriu (`legal.*.body`), structura e cea finală.
 */
export function LegalScreen({
  kind,
  backPath,
}: {
  kind: 'terms' | 'privacy';
  backPath: string;
}) {
  const { t } = useTranslation();
  const goBack = useBack(backPath);

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t(`legal.${kind}.title`)} onBack={goBack} />

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText themeColor="textSecondary" type="small">
          {t('legal.draftNotice')}
        </ThemedText>
        <ThemedText style={styles.body}>{t(`legal.${kind}.body`)}</ThemedText>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  body: { lineHeight: 22 },
});
