/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

/**
 * Redesign 22 iul 2026: paletă navy (#164F9E→#0E3A7D), fundal gri-albăstrui,
 * suprafețe albe rotunjite. Dark-ul e derivat din aceeași paletă: fundal navy
 * foarte închis, accente deschise (navy plin ar fi ilizibil pe negru).
 */
export const Colors = {
  light: {
    text: '#1C2635',
    background: '#EEF2F7',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#E2E8F1',
    textSecondary: '#5B6472',
    textTertiary: '#98A1AD',
    separator: '#EEF1F5',
    /** Accent (iconițe, link-uri, tab activ). */
    brand: '#0E3A7D',
    /** Suprafețe pline de acțiune (butoane primare) — alb pe el. */
    primary: '#0E3A7D',
    header: '#0E3A7D',
    onHeader: '#FFFFFF',
    successText: '#1C7C3C',
    successBg: '#E7F6EC',
    /** Verde PLIN de buton (alb pe el) — altul decât `successText`, care e text pe fundal deschis. */
    successSolid: '#1C7C3C',
    neutralBg: '#EEF1F5',
    /** Barele fixe (composer chat, bottom nav) — în dark, mai închise decât cardurile. */
    barBackground: '#FFFFFF',
    /** Fundal discret pentru butoane-accent (ex. camera din chat). */
    brandSoft: '#E8EEFB',
    /** Prețurile din Market (Faza 19, design 23 iul). */
    price: '#1C9E4F',
  },
  dark: {
    text: '#E8EDF4',
    background: '#0F1622',
    backgroundElement: '#1A2333',
    backgroundSelected: '#243149',
    textSecondary: '#96A1B1',
    textTertiary: '#7D8899',
    separator: '#202B3E',
    brand: '#7BA7E0',
    primary: '#2E63B8',
    header: '#0E3A7D',
    onHeader: '#FFFFFF',
    successText: '#4BC07A',
    successBg: '#14301F',
    // Ton mediu, ca `primary` în dark: `successText` (#4BC07A) e prea deschis sub alb.
    successSolid: '#2E9E57',
    neutralBg: '#222D3C',
    barBackground: '#141D2C',
    brandSoft: '#1E2A40',
    price: '#4ECB7D',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/**
 * Gradientul antetului (și al FAB-ului): `linear-gradient(160deg, …)` din design.
 * Separat de `Colors` fiindcă valoarea e tuplu, nu string (ar strica ThemeColor).
 */
export const HeaderGradient = {
  light: ['#164F9E', '#0E3A7D'],
  dark: ['#12345F', '#0B1F3D'],
} as const;

/** Gradientul elementelor active (bulă trimisă, buton send) — în dark e mai viu decât headerul. */
export const ActiveGradient = {
  light: ['#164F9E', '#0E3A7D'],
  dark: ['#1D5AB8', '#12447E'],
} as const;

/** Punctele start/end care aproximează direcția de 160° din CSS. */
export const HeaderGradientDirection = {
  start: { x: 0, y: 0 },
  end: { x: 0.4, y: 1 },
} as const;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

/**
 * Colțurile aplicației. Redesign 22 iul 2026: colțuri rotunjite (era design
 * ascuțit din Faza 7 — pentru revert se schimbă DOAR valorile de aici).
 * `circle` marchează elementele intenționat circulare (avatare, buline, send,
 * handle de bottom sheet); `fab` e squircle-ul butonului de creare.
 */
export const Radius = {
  card: 16,
  control: 12,
  badge: 999,
  fab: 18,
  circle: 999,
} as const;

/**
 * Umbrele din design (iOS: shadow*, Android: elevation). rgba(20,40,80)=#142850.
 * Se aplică DOAR pe suprafețe cu fundal setat (altfel Android nu desenează nimic).
 */
export const Shadows = {
  card: {
    shadowColor: '#142850',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 20,
    elevation: 3,
  },
  chip: {
    shadowColor: '#142850',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  fab: {
    shadowColor: '#0E3A7D',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 8,
  },
} as const;

export const MaxContentWidth = 800;
