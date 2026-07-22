import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, type TextProps } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HeaderGradient, HeaderGradientDirection, Spacing } from '@/constants/theme';
import { useResolvedScheme } from '@/hooks/use-settings';
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
  /** Înlocuiește complet conținutul benzii (ex. modul de selecție). */
  children?: ReactNode;
}

export function ScreenHeader({ title, subtitle, onBack, right, children }: ScreenHeaderProps) {
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
});
