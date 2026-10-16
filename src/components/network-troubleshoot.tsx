import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import type { NetworkDiagnosisState } from '@/hooks/use-network-diagnosis';
import { WEB_URL } from '@/lib/network-diagnosis';
import { useTheme } from '@/hooks/use-theme';

/**
 * Caseta de sub eroarea de rețea de pe ecranele de auth (13 oct 2026): spune în
 * cuvinte simple ce a găsit diagnosticul și dă butoane pentru pașii grei
 * (Setările aplicației — unde pe iPhone stă comutatorul de date mobile al
 * aplicației; varianta web, ca ocolire). Vezi lib/network-diagnosis.ts.
 */
export function NetworkTroubleshoot({ diagnosis }: { diagnosis: NetworkDiagnosisState }) {
  const { t } = useTranslation();
  const theme = useTheme();
  if (!diagnosis) return null;

  const native = Platform.OS !== 'web';

  if (diagnosis === 'checking') {
    return (
      <View style={[styles.box, { backgroundColor: theme.brandSoft }]}>
        <View style={styles.row}>
          <ActivityIndicator size="small" color={theme.brand} />
          <ThemedText themeColor="textSecondary" style={styles.text}>
            {t('auth.network.checking')}
          </ThemedText>
        </View>
      </View>
    );
  }

  const steps: string[] =
    diagnosis === 'offline'
      ? [
          // Pasul „date mobile pentru aplicație" are sens doar pe telefon; pe web rămâne Wi‑Fi/date.
          ...(native
            ? [t(Platform.OS === 'android' ? 'auth.network.offlineStepAndroid' : 'auth.network.offlineStepIos')]
            : []),
          t('auth.network.offlineStepWifi'),
        ]
      : diagnosis === 'blocked'
        ? [
            t('auth.network.blockedStepVpn'),
            t('auth.network.blockedStepOther'),
            ...(native ? [t('auth.network.blockedStepWeb')] : []),
          ]
        : diagnosis === 'clock'
          ? [t('auth.network.clockStep')]
          : [];

  const title = t(`auth.network.${diagnosis}Title`);

  return (
    <View style={[styles.box, { backgroundColor: theme.brandSoft }]}>
      <View style={styles.row}>
        <Feather name={diagnosis === 'ok' ? 'wifi' : 'wifi-off'} size={18} color={theme.brand} />
        <ThemedText style={[styles.text, styles.title]}>{title}</ThemedText>
      </View>
      {steps.map((step, i) => (
        <View key={i} style={styles.row}>
          <ThemedText themeColor="textSecondary" style={styles.bullet}>
            {i + 1}.
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.text}>
            {step}
          </ThemedText>
        </View>
      ))}
      {native && diagnosis !== 'ok' ? (
        <View style={styles.actions}>
          <Button
            title={t('auth.network.openSettings')}
            variant="secondary"
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
          />
          {diagnosis === 'blocked' ? (
            <Button
              title={t('auth.network.openWeb')}
              variant="secondary"
              onPress={() => {
                Linking.openURL(WEB_URL).catch(() => {});
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  bullet: { fontSize: 14, lineHeight: 20, fontWeight: '700', minWidth: 18 },
  text: { flex: 1, fontSize: 14, lineHeight: 20 },
  title: { fontWeight: '700' },
  actions: { gap: Spacing.two, marginTop: Spacing.one },
});
