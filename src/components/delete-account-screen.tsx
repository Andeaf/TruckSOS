import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { useTheme } from '@/hooks/use-theme';
import { deleteAccount } from '@/lib/account';
import { supabase } from '@/lib/supabase';

/**
 * Ecranul de confirmare a ștergerii contului (Faza 15), comun ambelor roluri prin câte un
 * route subțire. Confirmare puternică: re-parolă (dovedește proprietarul) + Alert destructiv
 * final. La succes: sign out → nav guard-ul redirecționează la login.
 */
export function DeleteAccountScreen({ backPath }: { backPath: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const goBack = useBack(backPath);
  const { session, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function runDelete() {
    setLoading(true);
    const err = await deleteAccount();
    if (err) {
      setLoading(false);
      Alert.alert(t('settings.deleteAccountScreen.error'));
      return;
    }
    // Succes: contul auth e șters server-side. Ieșim din sesiune → guard-ul duce la login.
    try {
      await signOut();
    } catch {
      // sign out best-effort: sesiunea locală se curăță oricum, guard-ul reacționează.
    }
  }

  async function handleSubmit() {
    const pw = password.trim();
    if (!pw) {
      setError(t('settings.deleteAccountScreen.passwordRequired'));
      return;
    }
    const email = session?.user.email;
    if (!email) return;

    setError(undefined);
    setLoading(true);
    // Re-autentificare: dovedește că e chiar proprietarul (nu cineva cu telefonul deblocat).
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: pw });
    setLoading(false);
    if (authErr) {
      setError(t('settings.deleteAccountScreen.passwordWrong'));
      return;
    }

    Alert.alert(
      t('settings.deleteAccountScreen.finalTitle'),
      t('settings.deleteAccountScreen.finalBody'),
      [
        { text: t('settings.deleteAccountScreen.cancel'), style: 'cancel' },
        { text: t('settings.deleteAccountScreen.finalOk'), style: 'destructive', onPress: runDelete },
      ],
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('settings.deleteAccountScreen.title')} onBack={goBack} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ThemedView type="backgroundElement" style={styles.section}>
          <View style={styles.sectionHeader}>
            <MaterialIcons name="info-outline" size={18} color={theme.brand} />
            <ThemedText type="smallBold">{t('settings.deleteAccountScreen.explainTitle')}</ThemedText>
          </View>
          <ThemedText themeColor="textSecondary" type="small">
            {t('settings.deleteAccountScreen.explainBody')}
          </ThemedText>
        </ThemedView>

        <View style={styles.warningRow}>
          <MaterialIcons name="warning-amber" size={18} color="#ef4444" />
          <ThemedText type="small" style={styles.warningText}>
            {t('settings.deleteAccountScreen.warning')}
          </ThemedText>
        </View>

        <Input
          label={t('settings.deleteAccountScreen.passwordLabel')}
          placeholder={t('settings.deleteAccountScreen.passwordPlaceholder')}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (error) setError(undefined);
          }}
          secureTextEntry
          autoCapitalize="none"
          error={error}
        />

        <Button
          title={t('settings.deleteAccountScreen.submit')}
          variant="danger"
          loading={loading}
          onPress={handleSubmit}
        />
      </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: Spacing.four, gap: Spacing.three },
  section: { borderRadius: Radius.card, padding: Spacing.three, gap: Spacing.two },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.one },
  warningText: { color: '#ef4444', flex: 1 },
});
