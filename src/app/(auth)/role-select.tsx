import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';

export default function RoleSelectScreen() {
  const { createProfile, session } = useAuth();
  const { t } = useTranslation();
  const theme = useTheme();
  const [loading, setLoading] = useState<'driver' | 'mechanic' | null>(null);
  const [error, setError] = useState('');

  const name = (session?.user.user_metadata?.full_name as string)?.split(' ')[0] ?? t('common.defaultUser');

  async function handleSelectRole(role: 'driver' | 'mechanic') {
    setLoading(role);
    setError('');
    const err = await createProfile(role);
    if (err) {
      setError(err);
      setLoading(null);
    }
    // Pe succes, _layout.tsx redirecționează automat la home-ul rolului
  }

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">{t('auth.roleSelect.title')}</ThemedText>
        <ThemedText type="title">{name}!</ThemedText>
        <ThemedText themeColor="textSecondary" style={styles.subtitle}>
          {t('auth.roleSelect.subtitle')}
        </ThemedText>
      </View>

      <View style={styles.cards}>
        <Pressable
          style={({ pressed }) => [
            styles.card,
            { borderColor: '#208AEF', backgroundColor: theme.backgroundElement },
            pressed && styles.cardPressed,
          ]}
          onPress={() => handleSelectRole('driver')}
          disabled={loading !== null}>
          <MaterialIcons name="local-shipping" size={48} color="#208AEF" />
          <ThemedText type="subtitle" style={styles.cardTitle}>
            {t('auth.roleSelect.driverTitle')}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.cardDesc}>
            {t('auth.roleSelect.driverDescription')}
          </ThemedText>
          {loading === 'driver' ? (
            <ThemedText themeColor="textSecondary" type="small">
              {t('auth.roleSelect.loading')}
            </ThemedText>
          ) : null}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.card,
            { borderColor: '#22c55e', backgroundColor: theme.backgroundElement },
            pressed && styles.cardPressed,
          ]}
          onPress={() => handleSelectRole('mechanic')}
          disabled={loading !== null}>
          <MaterialIcons name="build" size={48} color="#22c55e" />
          <ThemedText type="subtitle" style={styles.cardTitle}>
            {t('auth.roleSelect.mechanicTitle')}
          </ThemedText>
          <ThemedText themeColor="textSecondary" style={styles.cardDesc}>
            {t('auth.roleSelect.mechanicDescription')}
          </ThemedText>
          {loading === 'mechanic' ? (
            <ThemedText themeColor="textSecondary" type="small">
              {t('auth.roleSelect.loading')}
            </ThemedText>
          ) : null}
        </Pressable>
      </View>

      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.four,
    gap: Spacing.five,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.one,
  },
  subtitle: {
    textAlign: 'center',
    marginTop: Spacing.two,
  },
  cards: { gap: Spacing.three },
  card: {
    borderRadius: Radius.card,
    borderWidth: 2,
    padding: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  cardPressed: { opacity: 0.65 },
  cardTitle: { fontSize: 24, lineHeight: 32 },
  cardDesc: { textAlign: 'center', fontSize: 14 },
  error: { color: '#ef4444', textAlign: 'center' },
});
