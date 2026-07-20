import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { deleteAccount } from '@/lib/account';

/**
 * Ecranul contului banat (Faza 16). Sesiunea rămâne validă (ban aplicativ) ca să putem
 * arăta un mesaj CLAR (motiv + expirare) și să păstrăm dreptul GDPR de ștergere self-service.
 */
export default function BannedScreen() {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const [deleting, setDeleting] = useState(false);

  const until = profile?.banned_until
    ? new Date(profile.banned_until).toLocaleDateString()
    : null;

  function confirmDelete() {
    Alert.alert(t('auth.banned.deleteConfirmTitle'), t('auth.banned.deleteConfirmBody'), [
      { text: t('auth.banned.cancel'), style: 'cancel' },
      {
        text: t('auth.banned.deleteConfirmYes'),
        style: 'destructive',
        onPress: runDelete,
      },
    ]);
  }

  async function runDelete() {
    setDeleting(true);
    const err = await deleteAccount();
    setDeleting(false);
    if (err) {
      Alert.alert(t('auth.banned.deleteError'));
      return;
    }
    await signOut();
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <MaterialIcons name="block" size={56} color="#ef4444" />
          <ThemedText type="title" style={styles.title}>
            {t('auth.banned.title')}
          </ThemedText>
        </View>

        <ThemedText themeColor="textSecondary" style={styles.text}>
          {until ? t('auth.banned.bodyTemporary', { date: until }) : t('auth.banned.bodyPermanent')}
        </ThemedText>

        {profile?.ban_reason ? (
          <View style={styles.reasonBox}>
            <ThemedText themeColor="textSecondary" type="small">
              {t('auth.banned.reasonLabel')}
            </ThemedText>
            <ThemedText style={styles.reasonText}>{profile.ban_reason}</ThemedText>
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button title={t('admin.logout')} onPress={signOut} variant="secondary" />
          <Button
            title={t('auth.banned.deleteAccount')}
            onPress={confirmDelete}
            variant="danger"
            loading={deleting}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: Spacing.four, gap: Spacing.four },
  header: { alignItems: 'center', gap: Spacing.two },
  title: { textAlign: 'center' },
  text: { textAlign: 'center', lineHeight: 22 },
  reasonBox: { gap: Spacing.one, alignItems: 'center' },
  reasonText: { textAlign: 'center', fontWeight: '600' },
  actions: { gap: Spacing.three, marginTop: Spacing.two },
});
