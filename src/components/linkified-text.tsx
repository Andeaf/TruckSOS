import { useMemo, type ComponentProps, type ReactNode } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { tokenize, type MentionRef } from '@/lib/linkify';
import { confirmOpenUrl, openPhone } from '@/lib/open-link';

interface LinkifiedTextProps extends Omit<ComponentProps<typeof Text>, 'children'> {
  text: string;
  /** Stilul bucăților apăsabile (culoare per bulă: alb pe trimis, brand pe primit). */
  linkStyle?: StyleProp<TextStyle>;
  /** Menționările „@Nume" stocate pe mesaj (10 sept) — se evidențiază și duc la profil. */
  mentions?: MentionRef[] | null;
  /** Stilul menționărilor (bold + culoare, fără subliniere — ca pe WhatsApp). */
  mentionStyle?: StyleProp<TextStyle>;
  /** Culoarea unei menționări după id-ul utilizatorului (suprascrie culoarea din `mentionStyle`). */
  mentionColor?: (userId: string) => string;
  /** Apăsarea lungă pe un link/telefon → același meniu ca pe restul bulei. */
  onLongPress?: () => void;
  /**
   * Conținut randat ÎN ACELAȘI `Text`, după mesaj (8 oct): distanțierul invizibil care
   * rezervă loc orei din colț la bulele cu font mărit — vezi MessageBubble.
   */
  trailing?: ReactNode;
}

/**
 * Textul unui mesaj cu linkurile și numerele de telefon evidențiate și apăsabile
 * (7 sept 2026, cerere user):
 *   - link  → confirmare („Deschizi acest link?") → browser;
 *   - telefon → aplicația Telefon cu numărul tastat;
 *   - link de profil trucksos.net/p/<id> → profilul, direct în aplicație.
 *
 * Bucățile apăsabile sunt `Text` IMBRICATE în textul bulei (nu View-uri), ca
 * împachetarea rândurilor și ora din colț să rămână exact ca înainte. Textul simplu
 * NU primește handler: apăsarea lungă pe el urcă la Pressable-ul bulei, ca până acum;
 * doar linkurile au nevoie de `onLongPress` explicit, altfel ar înghiți gestul.
 */
export function LinkifiedText({
  text,
  linkStyle,
  mentions,
  mentionStyle,
  mentionColor,
  onLongPress,
  trailing,
  ...rest
}: LinkifiedTextProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const tokens = useMemo(() => tokenize(text, mentions), [text, mentions]);

  // Ruta /p/[id] rezolvă singură rolul persoanei și SARE pe ecranul de profil
  // potrivit privitorului (aceeași cale ca linkurile trucksos.net/p/<id>).
  const openProfile = (userId: string) =>
    router.push({ pathname: '/p/[id]', params: { id: userId } } as never);

  if (!tokens.some((tok) => tok.type !== 'text')) {
    return (
      <Text {...rest}>
        {text}
        {trailing}
      </Text>
    );
  }

  return (
    <Text {...rest}>
      {tokens.map((tok, i) =>
        tok.type === 'text' ? (
          tok.value
        ) : tok.type === 'mention' ? (
          <Text
            key={i}
            style={[
              styles.mention,
              mentionStyle,
              mentionColor ? { color: mentionColor(tok.userId) } : null,
            ]}
            suppressHighlighting
            accessibilityRole="link"
            onPress={() => openProfile(tok.userId)}
            onLongPress={onLongPress}>
            {tok.value}
          </Text>
        ) : (
          <Text
            key={i}
            style={[styles.link, linkStyle]}
            suppressHighlighting
            accessibilityRole="link"
            onPress={() =>
              tok.type === 'url'
                ? confirmOpenUrl(tok.href, t, openProfile)
                : void openPhone(tok.number, t)
            }
            onLongPress={onLongPress}>
            {tok.value}
          </Text>
        ),
      )}
      {trailing}
    </Text>
  );
}

const styles = StyleSheet.create({
  link: { textDecorationLine: 'underline', fontWeight: '600' },
  mention: { fontWeight: '700' },
});
