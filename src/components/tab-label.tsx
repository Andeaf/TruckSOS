import { Platform, Text, useWindowDimensions } from 'react-native';

/** Mărimea din design; sub ea coborâm doar cât cere cea mai lungă etichetă. */
const DESIGN_FONT_SIZE = 11;
const MIN_FONT_SIZE = 8;
/** Lățime medie de glif ≈ 0.6 × fontSize (SF/Roboto semibold la mărimi mici).
    Pe web estimarea trebuie să fie mai conservatoare: `adjustsFontSizeToFit` e
    no-op acolo, deci orice subestimare devine elipsă („Announc…"), nu shrink. */
const AVG_CHAR_WIDTH = Platform.OS === 'web' ? 0.68 : 0.6;
/** Spațiu orizontal pierdut pe un item al barei (padding intern + respirație). */
const ITEM_H_INSET = Platform.OS === 'web' ? 16 : 12;

/**
 * Pe web, bara implicită de 49px nu mai încape iconița + eticheta după
 * `paddingTop: 4` (line-height-ul web e mai înalt decât cel nativ) — textul
 * ieșea din bară și era retezat de marginea ei. Pe nativ rămâne implicitul.
 *
 * OBIECT de împrăștiat în `tabBarStyle` (`{...TAB_BAR_WEB_STYLE}`), NU o valoare:
 * react-navigation pune stilul userului PESTE cel calculat, iar la combinare un
 * `height: undefined` SUPRASCRIE înălțimea calculată (49 + safe-area) — pe
 * Android bara ajungea sub butoanele de sistem (pățit 15 aug, în Expo Go).
 * Cheia trebuie să lipsească de tot pe nativ.
 */
export const TAB_BAR_WEB_STYLE = Platform.OS === 'web' ? ({ height: 56 } as const) : null;

/**
 * O mărime de font COMUNĂ pentru toate etichetele barei: cea mai lungă etichetă
 * dictează mărimea, ca tab-urile să rămână proporționale între ele — o singură
 * etichetă auto-micșorată lângă celelalte la 11px arăta disproporționat.
 * Se recalculează la rotire/redimensionare și cu orice limbă.
 */
export function useTabLabelFontSize(labels: string[]): number {
  const { width } = useWindowDimensions();
  const itemWidth = width / Math.max(labels.length, 1) - ITEM_H_INSET;
  const maxChars = labels.reduce((max, label) => Math.max(max, label.length), 1);
  const fitting = itemWidth / (maxChars * AVG_CHAR_WIDTH);
  return Math.min(DESIGN_FONT_SIZE, Math.max(MIN_FONT_SIZE, fitting));
}

/**
 * Eticheta de tab din design: weight 700 pe activ / 600 pe inactiv.
 * `adjustsFontSizeToFit` rămâne doar plasă de siguranță (estimarea lățimii de
 * glif e o medie), ca textul să nu se rupă niciodată pe două rânduri.
 */
export function tabLabel(label: string, fontSize: number = DESIGN_FONT_SIZE) {
  return function TabLabel({ focused, color }: { focused: boolean; color: string }) {
    return (
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={{ fontSize, fontWeight: focused ? '700' : '600', color }}>
        {label}
      </Text>
    );
  };
}
