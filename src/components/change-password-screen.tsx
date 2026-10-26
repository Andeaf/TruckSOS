import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScreenHeader } from '@/components/screen-header';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useBack } from '@/hooks/use-back';
import { translateAuthError } from '@/lib/auth-errors';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth-rules';
import { supabase } from '@/lib/supabase';

/**
 * Schimbarea parolei pentru userul logat, comună ambelor roluri prin route subțiri.
 * Parola curentă e re-verificată întâi (același raționament ca la ștergerea contului:
 * dovedește proprietarul, nu doar telefonul deblocat), apoi `updateUser` o înlocuiește.
 */
export function ChangePasswordScreen({ backPath }: { backPath: string }) {
  const { t } = useTranslation();
  const goBack = useBack(backPath);
  const { session } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [currentError, setCurrentError] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setCurrentError(undefined);
    setError(undefined);
    if (!current || !next || !confirm) {
      setError(t('settings.changePasswordScreen.errorEmpty'));
      return;
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.register.errorPasswordLength'));
      return;
    }
    if (next !== confirm) {
      setError(t('settings.changePasswordScreen.errorMismatch'));
      return;
    }
    const email = session?.user.email;
    if (!email) return;

    setLoading(true);
    const { error: authErr } = await supabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (authErr) {
      setLoading(false);
      setCurrentError(t('settings.changePasswordScreen.errorWrongCurrent'));
      return;
    }
    const { error: updateErr } = await supabase.auth.updateUser({ password: next });
    if (updateErr) {
      setLoading(false);
      setError(translateAuthError(updateErr) ?? undefined);
      return;
    }
    // 26 oct 2026 (AUDIT #14): o parolă schimbată trebuie să scoată un eventual dispozitiv
    // străin — Supabase nu invalidează singur celelalte sesiuni. `others` = toate în afară de
    // asta (refresh token-urile lor sunt revocate; access token-urile expiră în ≤ JWT expiry).
    // Un eșec aici nu anulează schimbarea parolei (deja făcută): doar nu promitem deconectarea.
    const { error: othersErr } = await supabase.auth.signOut({ scope: 'others' });
    setLoading(false);
    if (othersErr) {
      Alert.alert(
        t('settings.changePasswordScreen.successTitle'),
        t('settings.changePasswordScreen.successBodyOthersFailed'),
        [{ text: 'OK', onPress: goBack }],
      );
      return;
    }
    Alert.alert(
      t('settings.changePasswordScreen.successTitle'),
      t('settings.changePasswordScreen.successBody'),
      [{ text: 'OK', onPress: goBack }],
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScreenHeader title={t('settings.changePasswordScreen.title')} onBack={goBack} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Input
            label={t('settings.changePasswordScreen.currentLabel')}
            value={current}
            onChangeText={(v) => {
              setCurrent(v);
              if (currentError) setCurrentError(undefined);
            }}
            placeholder={t('auth.login.passwordPlaceholder')}
            secureTextEntry
            error={currentError}
            required
          />
          <Input
            label={t('settings.changePasswordScreen.newLabel')}
            value={next}
            onChangeText={setNext}
            placeholder={t('auth.register.passwordPlaceholder')}
            secureTextEntry
            required
          />
          <Input
            label={t('settings.changePasswordScreen.confirmLabel')}
            value={confirm}
            onChangeText={setConfirm}
            placeholder={t('auth.register.passwordPlaceholder')}
            secureTextEntry
            error={error}
            required
          />

          <Button
            title={t('settings.changePasswordScreen.submit')}
            onPress={handleSubmit}
            loading={loading}
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
});
