import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type TextProps } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { GuestSignInPill } from '@/components/guest-sign-in-pill';
import { HeaderGradient, HeaderGradientDirection, Radius, Spacing } from '@/constants/theme';
import { useAuth } from '@/hooks/use-auth';
import { useResolvedScheme } from '@/hooks/use-settings';
import { useSignedUrl } from '@/hooks/use-signed-urls';
import { useTheme } from '@/hooks/use-theme';

/**
 * Antetul colorat, unic pentru toate ecranele (PLAN_FAZA10.md §1).
 *
 * Banda se întinde SUB bara de status (`paddingTop: insets.top`) — de aceea
 * ecranele NU mai pun `paddingTop: insets.top` pe container. Pe Android SDK 54
 * edge-to-edge e obligatoriu, iar `StatusBar backgroundColor` nu are efect;
 * singura cale sigură (și identică pe iOS) e să vopsim noi zona de sus.
 * `style="light"` se ocupă doar de ceas/iconițe.
 */

export interface ScreenHeaderProps {
  title?: string;
  subtitle?: string;
  /** Randează săgeata albă de back în stânga. */
  onBack?: () => void;
  /** Acțiuni în dreapta (folosesc `theme.onHeader` pentru culoare). */
  right?: ReactNode;
  /** Faza 19: buton-avatar circular la EXTREMA dreaptă (după `right`) — tap → Profil.
   * Activat DOAR pe rădăcinile de tab; ecranele push-uite au back, nu avatar. */
  profileButton?: boolean;
  /** Înlocuiește complet conținutul benzii (ex. modul de selecție). */
  children?: ReactNode;
}

/**
 * Butonul-avatar din antet (Faza 19 — profilul a ieșit din tab bar). Ținta se derivă
 * din GRUPUL curent de rute (nu din profile.role): un admin în „viewing-as" pe (driver)
 * trebuie să ajungă la /(driver)/profile, nu la grupul rolului lui real.
 * Exportat: headerele custom (ex. Market, cu search integrat) îl refolosesc.
 */
export function HeaderProfileButton({ size = 34 }: { size?: number }) {
  const { profile } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const avatarUrl = useSignedUrl(profile?.avatar_path);

  const group = segments[0] as string | undefined;
  // 1.1 (B3): oaspetele n-are profil — în locul avatarului, pastila „Intră în cont”.
  if (group === '(guest)') return <GuestSignInPill />;
  if (group !== '(driver)' && group !== '(mechanic)') return null;

  return (
    <Pressable
      onPress={() => router.push(`/${group}/profile` as never)}
      hitSlop={8}
      accessibilityRole="button"
      style={({ pressed }) => [styles.profileRing, pressed && styles.profilePressed]}>
      <Avatar url={avatarUrl} name={profile?.full_name} size={size} userId={profile?.id} />
    </Pressable>
  );
}

export function ScreenHeader({ title, subtitle, onBack, right, profileButton, children }: ScreenHeaderProps) {
  const theme = useTheme();
  const scheme = useResolvedScheme();
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={HeaderGradient[scheme]}
      start={HeaderGradientDirection.start}
      end={HeaderGradientDirection.end}
      style={[
        styles.header,
        // iOS: insets.top e deja generos (notch/Dynamic Island ~50-60px) — orice padding
        // în plus împingea titlul vizibil prea jos față de notch (feedback iPhone real).
        {
          paddingTop: insets.top + (Platform.OS === 'ios' ? 0 : Spacing.three),
        },
      ]}>
      <StatusBar style="light" />
      {children ?? (
        <>
          {onBack ? (
            <Pressable onPress={onBack} hitSlop={12}>
              <MaterialIcons name="arrow-back" size={24} color={theme.onHeader} />
            </Pressable>
          ) : null}

          <View style={styles.titles}>
            {/* adjustsFontSizeToFit: la fonturi de sistem mărite (accesibilitate) titlul
                se micșorează ca să încapă, în loc să se trunchieze — ambele platforme.
                maxFontSizeMultiplier: textele din antet cresc TOATE cel mult 1.2x, ca să
                rămână proporționale între ele (feedback pe device: diferențe prea mari). */}
            <Text
              style={[styles.title, { color: theme.onHeader }]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.65}
              maxFontSizeMultiplier={1.2}>
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={[styles.subtitle, { color: theme.onHeader }]}
                numberOfLines={1}
                maxFontSizeMultiplier={1.2}>
                {subtitle}
              </Text>
            ) : null}
          </View>

          {right ?? null}

          {profileButton ? <HeaderProfileButton /> : null}
        </>
      )}
    </LinearGradient>
  );
}

/** Text alb pentru conținutul custom al benzii (moduri de selecție, contoare). */
export function HeaderText({ style, ...rest }: TextProps) {
  const theme = useTheme();
  return <Text style={[styles.headerText, { color: theme.onHeader }, style]} {...rest} />;
}

const styles = StyleSheet.create({
  // Dimensiunile exacte din design (22px lateral, 20px jos) — nu din scala Spacing.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: 22,
    paddingBottom: 20,
  },
  titles: { flex: 1 },
  // Nu folosim `ThemedText type="subtitle"` (32px) — prea mare pe o bandă colorată.
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.3, lineHeight: 30 },
  subtitle: { fontSize: 14, lineHeight: 19, opacity: 0.75, marginTop: 2 },
  headerText: { fontSize: 15, fontWeight: '600' },
  // Inelul alb discret al avatarului din antet (precedentul: chat-screen headerAvatarRing).
  profileRing: {
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
    borderRadius: Radius.circle,
  },
  profilePressed: { opacity: 0.8 },
});
