import { useMemo, type ComponentProps } from 'react';
import { StyleSheet, Text, type StyleProp, type TextStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { tokenize } from '@/lib/linkify';
import { confirmOpenUrl, openPhone } from '@/lib/open-link';

interface LinkifiedTextProps extends Omit<ComponentProps<typeof Text>, 'children'> {
  text: string;
  /** Stilul bucăților apăsabile (culoare per bulă: alb pe trimis, brand pe primit). */
  linkStyle?: StyleProp<TextStyle>;
  /** Apăsarea lungă pe un link/telefon → același meniu ca pe restul bulei. */
  onLongPress?: () => void;
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
export function LinkifiedText({ text, linkStyle, onLongPress, ...rest }: LinkifiedTextProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const tokens = useMemo(() => tokenize(text), [text]);

  const openProfile = (userId: string) =>
    router.push({ pathname: '/p/[id]', params: { id: userId } } as never);

  if (!tokens.some((tok) => tok.type !== 'text')) {
    return <Text {...rest}>{text}</Text>;
  }

  return (
    <Text {...rest}>
      {tokens.map((tok, i) =>
        tok.type === 'text' ? (
          tok.value
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
    </Text>
  );
}

const styles = StyleSheet.create({
  link: { textDecorationLine: 'underline', fontWeight: '600' },
});
