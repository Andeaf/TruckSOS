import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { Radius, Spacing } from '@/constants/theme';
import {
  appleSignInAvailable,
  googleSignInAvailable,
  signInWithApple,
  signInWithGoogle,
} from '@/lib/social-auth';

/**
 * Blocul „sau continuă cu Google / Apple” de pe ecranele de login și înregistrare
 * (6 oct 2026). Se randează DOAR dacă există cel puțin un furnizor disponibil pe
 * platforma curentă (vezi `social-auth.ts`): în Expo Go sau fără clienții Google
 * configurați nu apare nimic, deci ecranele rămân exact ca înainte.
 *
 * Pe succes nu navigăm nicăieri: `onAuthStateChange` din `use-auth.tsx` primește
 * sesiunea, iar gardul din `_layout.tsx` duce userul la rol (cont nou) sau acasă.
 *
 * Butonul Apple e componenta nativă obligatorie (App Store nu acceptă un buton
 * desenat de noi); textul lui îl localizează iOS-ul. Butonul Google urmează ghidul
 * de branding: fundal alb, bordură gri, sigla „G” multicoloră, text închis.
 */
export function SocialSignIn() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
  const [error, setError] = useState('');
  const [appleReady, setAppleReady] = useState(false);
  const googleReady = googleSignInAvailable();

  useEffect(() => {
    let active = true;
    appleSignInAvailable().then((ok) => {
      if (active) setAppleReady(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!googleReady && !appleReady) return null;

  async function run(provider: 'google' | 'apple') {
    if (busy) return;
    setBusy(provider);
    setError('');
    const result = provider === 'google' ? await signInWithGoogle() : await signInWithApple();
    if (result.error) setError(result.error);
    // Pe web, Google pleacă prin redirect: lăsăm spinner-ul până pleacă pagina.
    if (!(provider === 'google' && Platform.OS === 'web' && !result.error)) setBusy(null);
  }

  return (
    <View style={styles.container}>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <ThemedText themeColor="textTertiary" type="small">
          {t('auth.social.or')}
        </ThemedText>
        <View style={styles.dividerLine} />
      </View>

      {googleReady ? (
        <Pressable
          onPress={() => run('google')}
          disabled={busy !== null}
          accessibilityRole="button"
          accessibilityLabel={t('auth.social.google')}
          style={({ pressed }) => [styles.googleButton, (pressed || busy !== null) && styles.dimmed]}>
          {busy === 'google' ? (
            <ActivityIndicator color="#1F1F1F" />
          ) : (
            <>
              <Image
                source={require('@/assets/images/google-g.svg')}
                style={styles.googleLogo}
                contentFit="contain"
              />
              <Text style={styles.googleLabel}>{t('auth.social.google')}</Text>
            </>
          )}
        </Pressable>
      ) : null}

      {appleReady ? (
        busy === 'apple' ? (
          <View style={[styles.appleButton, styles.appleBusy]}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={Radius.control}
            style={[styles.appleButton, busy !== null && styles.dimmed]}
            onPress={() => run('apple')}
          />
        )
      ) : null}

      {error ? <ThemedText style={styles.error}>{error}</ThemedText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dividerLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: '#C9D0DA' },
  // Ecranele de auth sunt light-only (Faza 4) → culorile de branding Google sunt fixe.
  googleButton: {
    height: 50,
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: '#DADCE0',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  googleLogo: { width: 20, height: 20 },
  googleLabel: { color: '#1F1F1F', fontSize: 16, fontWeight: '600' },
  appleButton: { height: 50, width: '100%' },
  appleBusy: {
    backgroundColor: '#000000',
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimmed: { opacity: 0.55 },
  error: { color: '#ef4444', textAlign: 'center', fontSize: 14 },
});
