import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useBack } from '@/hooks/use-back';

/**
 * Termeni / Confidențialitate (Faza 18.2 — conținut REAL, înlocuiește placeholder-ele
 * din Faza 10). Textul e structurat pe secțiuni în i18n (`legal.*.sections`);
 * versiunea web (GitHub Pages) conține aceleași texte — cele două trebuie ținute
 * SINCRON la orice schimbare care atinge datele (PLAN_FAZA18 §9.9).
 */

type LegalSection = { heading: string; body: string };

export function LegalScreen({
  kind,
  backPath,
}: {
  kind: 'terms' | 'privacy';
  backPath: string;
}) {
  const { t } = useTranslation();
  const goBack = useBack(backPath);
  const sections = t(`legal.${kind}.sections`, { returnObjects: true }) as LegalSection[];

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t(`legal.${kind}.title`)} onBack={goBack} />

      <ScrollView contentContainerStyle={styles.content}>
        <ThemedText themeColor="textSecondary" type="small">
          {t(`legal.${kind}.updated`)}
        </ThemedText>
        {Array.isArray(sections)
          ? sections.map((section, index) => (
              <View key={index} style={styles.section}>
                <ThemedText type="smallBold" style={styles.heading}>
                  {section.heading}
                </ThemedText>
                <ThemedText style={styles.body}>{section.body}</ThemedText>
              </View>
            ))
          : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  section: { gap: Spacing.one },
  heading: { fontSize: 16 },
  body: { lineHeight: 22 },
});
