import { Platform, Text, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

/** Inaltimea de continut a barei — implicitul react-navigation, pe care il reproducem. */
const TAB_BAR_CONTENT_HEIGHT = 49;
/** Respiro sub eticheta. Fara el, pe telefoanele cu bara de butoane OPACA textul
 *  sta lipit de marginea de jos, la un fir de butoanele Android (poza user, 2 sept). */
const TAB_BAR_EXTRA_BOTTOM = 8;

/**
 * Stilul nativ al barei de taburi (2 sept). Doua situatii de acoperit deodata:
 *
 *  - navigatie GESTUALA / bara translucida: insets.bottom > 0; react-navigation
 *    calculeaza singur 49 + inset, dar il recalculam identic ca sa putem adauga
 *    respiro fara sa pierdem safe-area;
 *  - bara de butoane OPACA (cazul din poza): insets.bottom e 0, fereastra se
 *    termina deasupra butoanelor, iar bara ramane exact 49px — cu paddingTop 4
 *    din layout-uri, eticheta ajunge pe marginea de jos.
 *
 * Dam o valoare NUMERICA, niciodata undefined: react-navigation pune stilul
 * userului peste cel calculat, iar un height undefined ar sterge inaltimea cu tot
 * cu safe-area (bug patit pe 15 aug, vezi nota de la TAB_BAR_WEB_STYLE).
 */
export function useTabBarNativeStyle() {
  const insets = useSafeAreaInsets();
  if (Platform.OS === 'web') return null;
  // Respiroul se adauga DOAR pe Android: pe iOS insets.bottom (indicatorul home,
  // ~34px) lasa deja loc destul, iar bara arata corect azi — nu o schimbam.
  const extra = Platform.OS === 'android' ? TAB_BAR_EXTRA_BOTTOM : 0;
  const bottom = insets.bottom + extra;
  return { height: TAB_BAR_CONTENT_HEIGHT + bottom, paddingBottom: bottom };
}

/**
 * O mărime de font COMUNĂ pentru toate etichetele barei: cea mai lungă etichetă
 * dictează mărimea, ca tab-urile să rămână proporționale între ele — o singură
 * etichetă auto-micșorată lângă celelalte la 11px arăta disproporționat.
 * Se recalculează la rotire/redimensionare și cu orice limbă.
 */
export function useTabLabelFontSize(labels: string[]): number {
  const { width, fontScale } = useWindowDimensions();
  const itemWidth = width / Math.max(labels.length, 1) - ITEM_H_INSET;
  const maxChars = labels.reduce((max, label) => Math.max(max, label.length), 1);
  const fitting = itemWidth / (maxChars * AVG_CHAR_WIDTH);
  // 8 oct: scara de font a sistemului intră AICI, nu în Text (vezi tabLabel —
  // maxFontSizeMultiplier 1). Altfel, la „Foarte mare" doar eticheta cea mai lungă
  // era micșorată de adjustsFontSizeToFit și tab-urile aveau mărimi diferite.
  // Mărimea comună crește cu scara cât încape cea mai lungă etichetă, nu mai mult.
  // La scara 1 formula e identică cu cea de dinainte.
  return Math.min(DESIGN_FONT_SIZE * fontScale, Math.max(MIN_FONT_SIZE, fitting));
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
        // Scara sistemului e deja în `fontSize` (useTabLabelFontSize) — nu se aplică de două ori.
        maxFontSizeMultiplier={1}
        style={{ fontSize, fontWeight: focused ? '700' : '600', color }}>
        {label}
      </Text>
    );
  };
}
