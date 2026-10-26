import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useTheme } from '@/hooks/use-theme';
import { setAuthEntry } from '@/lib/auth-entry';
import { translateAuthError } from '@/lib/auth-errors';
import { isNetworkError } from '@/lib/network-diagnosis';
import { supabase } from '@/lib/supabase';

/**
 * Linkul de activare din e-mailul de confirmare (1.1, Faza C, decizia D7):
 * trucksos.net/auth/confirm?token_hash=<hash>&type=signup — același token ca și codul de
 * 6 cifre: primul folosit câștigă, al doilea dă „expirat/invalid".
 *
 *   - WEB: NU verificăm la încărcare (clienții de mail / antivirusurile deschid linkurile
 *     în avans și ar consuma tokenul). Doar butonul „Activează contul" pornește
 *     `verifyOtp`. După succes pagina rămâne pe „Cont activat" (garda nu o ricoșează);
 *     sesiunea rămâne în browser, „Continuă pe web" o predă gărzii (→ alegerea rolului).
 *   - NATIV (Android 1.1.0 prin App Links; iOS doar dacă e deschis prin schema custom):
 *     linkul vine dintr-un tap, deci verificăm imediat; succes → `router.replace('/')`
 *     după ce sesiunea a ajuns în AuthProvider, iar garda duce la alegerea rolului.
 *   - CU SESIUNE ACTIVĂ (26 oct 2026, AUDIT #13 / PLAN_1.1_FIX 1.1): pe nicio platformă NU
 *     verificăm automat. `verifyOtp` ar înlocui tăcut sesiunea curentă cu contul din link — un
 *     atacator și-ar putea trimite propriul link de activare unei victime conectate, care ar
 *     ajunge să-și completeze profilul (telefonul) în contul lui. Arătăm cine e conectat și
 *     cerem o alegere explicită: „Activează contul din link" (deconectare DOAR pe acest
 *     dispozitiv, apoi verificare) sau „Rămân conectat".
 */

type Phase = 'idle' | 'verifying' | 'switch' | 'done' | 'invalid' | 'network';

const ACCEPTED_TYPES = ['signup', 'email'];
const IS_WEB = Platform.OS === 'web';
const APP_SCHEME_LOGIN = 'trucksos://login';
const ANDROID_DOWNLOAD_URL = 'https://trucksos.net/android';
const IOS_DOWNLOAD_URL = 'https://trucksos.net/ios';

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

export default function ConfirmEmailLinkScreen() {
  const params = useLocalSearchParams<{ token_hash?: string | string[]; type?: string | string[] }>();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { session, loading: authLoading } = useAuth();

  const tokenHash = firstParam(params.token_hash).trim();
  const linkType = firstParam(params.type).trim();
  const valid = tokenHash.length > 0 && ACCEPTED_TYPES.includes(linkType);

  // Nativ: spinner până aflăm dacă există o sesiune (AuthProvider o citește din storage).
  const [phase, setPhase] = useState<Phase>(() =>
    !valid ? 'invalid' : IS_WEB ? 'idle' : 'verifying'
  );
  // E-mailul contului conectat în clipa deschiderii linkului — rămâne afișat și după ce
  // `session` devine null prin deconectarea cerută de utilizator.
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [networkMessage, setNetworkMessage] = useState('');
  const [nativeVerified, setNativeVerified] = useState(false);
  const mounted = useRef(true);
  const started = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function verify() {
    if (!valid) return;
    setPhase('verifying');
    setNetworkMessage('');
    // Ca pe ecranul de înregistrare: sesiunea nouă fără profil înseamnă alegerea rolului
    // (un „login-social" rămas în storage ar deconecta-o — vezi lib/auth-entry.ts).
    await setAuthEntry('signup');
    const { error } = await supabase.auth.verifyOtp({ type: 'signup', token_hash: tokenHash });
    if (!mounted.current) return;
    if (error) {
      // Rețea căzută: tokenul NU a fost consumat — lăsăm butonul de reîncercare.
      if (isNetworkError(error)) {
        setNetworkMessage(translateAuthError(error) ?? '');
        setPhase('network');
      } else {
        setPhase('invalid');
      }
      return;
    }
    if (IS_WEB) setPhase('done');
    else setNativeVerified(true);
  }

  // Decizia se ia o singură dată, abia când AuthProvider știe dacă există o sesiune
  // (ref-ul ține și la montarea dublă din dev):
  //   - sesiune activă (nativ sau web) → ecranul „Ești deja conectat", fără nicio verificare;
  //   - fără sesiune: nativ → verificare imediată (linkul vine dintr-un tap);
  //                   web → rămâne pe buton (clienții de mail deschid linkurile în avans).
  useEffect(() => {
    if (!valid || started.current || authLoading) return;
    started.current = true;
    if (session) {
      setSignedInEmail(session.user.email ?? null);
      setPhase('switch');
      return;
    }
    if (!IS_WEB) void verify();
    // Tokenul din link nu se schimbă pe același ecran; `verify` e stabil pentru acest token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, authLoading, session]);

  // „Activează contul din link" cu o sesiune activă: deconectare DOAR pe acest dispozitiv
  // (scope local — celelalte dispozitive ale contului curent rămân conectate), apoi verificarea.
  async function switchToLinkedAccount() {
    setPhase('verifying');
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (!mounted.current) return;
    if (error) {
      // Fără deconectare nu verificăm: altfel am ajunge exact în situația pe care o evităm.
      setNetworkMessage(translateAuthError(error) ?? '');
      setPhase('switch');
      return;
    }
    await verify();
  }

  // Nativ, după succes: predăm gărzii abia când sesiunea a ajuns în AuthProvider — altfel
  // ruta „/" fără sesiune ar fi trimisă la login.
  useEffect(() => {
    if (nativeVerified && session) router.replace('/' as never);
  }, [nativeVerified, session, router]);

  const goToLogin = () => router.replace('/(auth)/login' as never);
  const continueOnWeb = () => router.replace('/' as never);
  // „Rămân conectat": nimic nu s-a schimbat; garda duce la ecranul rolului curent.
  const staySignedIn = () => router.replace('/' as never);
  const openApp = () => {
    // Schema custom: o deschide orice versiune instalată (ruta /login din aplicație).
    // Pe web, ca în /p/[id]: navigare în aceeași filă, nu fereastră nouă.
    if (IS_WEB) window.location.href = APP_SCHEME_LOGIN;
    else void Linking.openURL(APP_SCHEME_LOGIN);
  };

  if (phase === 'verifying' && !IS_WEB) {
    return (
      <ThemedView style={styles.centered}>
        <ActivityIndicator size="large" color={theme.brand} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.centered}>
      <ThemedView type="backgroundElement" style={styles.card}>
        <Image source={require('@/assets/images/icon.png')} style={styles.logo} />

        {phase === 'done' ? (
          <>
            <ThemedText type="subtitle" style={styles.center}>
              {t('auth.confirmLink.doneTitle')}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              {t('auth.confirmLink.doneBody')}
            </ThemedText>
            <View style={styles.actions}>
              <Button title={t('auth.confirmLink.openApp')} onPress={openApp} />
              <Button
                variant="secondary"
                title={t('auth.confirmLink.getAndroid')}
                onPress={() => void Linking.openURL(ANDROID_DOWNLOAD_URL)}
              />
              <Button
                variant="secondary"
                title={t('auth.confirmLink.getIos')}
                onPress={() => void Linking.openURL(IOS_DOWNLOAD_URL)}
              />
              <Button
                variant="secondary"
                title={t('auth.confirmLink.continueWeb')}
                onPress={continueOnWeb}
              />
            </View>
          </>
        ) : phase === 'invalid' ? (
          <>
            <ThemedText type="subtitle" style={styles.center}>
              {t('auth.confirmLink.title')}
            </ThemedText>
            <ThemedText style={[styles.center, styles.error]}>
              {t('auth.confirmLink.errorBody')}
            </ThemedText>
            <View style={styles.actions}>
              <Button title={t('auth.confirmLink.goToLogin')} onPress={goToLogin} />
            </View>
          </>
        ) : phase === 'switch' ? (
          <>
            <ThemedText type="subtitle" style={styles.center}>
              {t('auth.confirmLink.switchTitle')}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              {t('auth.confirmLink.switchBody', { email: signedInEmail ?? '' })}
            </ThemedText>
            {networkMessage ? (
              <ThemedText style={[styles.center, styles.error]}>{networkMessage}</ThemedText>
            ) : null}
            <View style={styles.actions}>
              <Button title={t('auth.confirmLink.switchStay')} onPress={staySignedIn} />
              <Button
                variant="secondary"
                title={t('auth.confirmLink.switchActivate')}
                onPress={() => void switchToLinkedAccount()}
              />
            </View>
          </>
        ) : (
          // idle / verifying (web) / network (ambele platforme): butonul de activare.
          <>
            <ThemedText type="subtitle" style={styles.center}>
              {t('auth.confirmLink.title')}
            </ThemedText>
            <ThemedText themeColor="textSecondary" style={styles.center}>
              {t('auth.confirmLink.intro')}
            </ThemedText>
            {phase === 'network' && networkMessage ? (
              <ThemedText style={[styles.center, styles.error]}>{networkMessage}</ThemedText>
            ) : null}
            <View style={styles.actions}>
              <Button
                title={t('auth.confirmLink.activate')}
                onPress={() => void verify()}
                loading={phase === 'verifying'}
              />
              {phase === 'network' ? (
                <Button
                  variant="secondary"
                  title={t('auth.confirmLink.goToLogin')}
                  onPress={goToLogin}
                />
              ) : null}
            </View>
          </>
        )}
      </ThemedView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.four },
  card: {
    width: '100%',
    maxWidth: 480,
    borderRadius: Radius.card,
    padding: Spacing.five,
    alignItems: 'center',
    gap: Spacing.three,
  },
  logo: { width: 72, height: 72, borderRadius: 16 },
  center: { textAlign: 'center' },
  error: { color: '#ef4444' },
  actions: { alignSelf: 'stretch', gap: Spacing.two, marginTop: Spacing.two },
});
