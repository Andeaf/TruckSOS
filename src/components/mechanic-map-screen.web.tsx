import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Varianta de WEB a hărții mecanicului (7 aug): `react-native-maps` nu rulează în
 * browser, iar simplul lui import ar rupe bundle-ul — Metro alege automat fișierul
 * `.web.tsx` al COMPONENTEI (ruta e doar un re-export; fișierele de rută nu se pot
 * splitui pe platformă — require.context-ul expo-router le bundle-uiește pe toate).
 * Pe web trimitem la feed (aceleași anunțuri, ca listă); harta reală rămâne pe telefon.
 */
export default function MechanicMapScreenWeb() {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('mechanic.map.title')} profileButton />
      <View style={styles.body}>
        <MaterialIcons name="map" size={48} color={theme.textSecondary} />
        <ThemedText themeColor="textSecondary" style={styles.text}>
          {t('mechanic.map.webBody')}
        </ThemedText>
        <Pressable
          onPress={() => router.replace('/(mechanic)/feed')}
          style={[styles.cta, { backgroundColor: theme.brand }]}>
          <Text style={styles.ctaText}>{t('mechanic.map.webCta')}</Text>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  text: { textAlign: 'center', maxWidth: 420 },
  cta: {
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    borderRadius: Radius.control,
  },
  ctaText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
