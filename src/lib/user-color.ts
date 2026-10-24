/**
 * Culoarea stabilă a unui utilizator (Faza D, PLAN_1.1): aceeași culoare pentru același
 * utilizator peste tot (nume în chat, citate, mențiuni, avatar fără poză), pe orice
 * dispozitiv. Paleta are contrastul ≥ 4,5 verificat pe fundalurile temelor
 * (alb / #EEF2F7 pentru `light`, #1A2333 / #0F1622 pentru `dark`). Pe bula PROPRIE
 * (gradient navy + voal alb la citat) nicio variantă nu ține pragul (măsurat 2,9–4,4),
 * de aceea acolo numele citate și mențiunile rămân albe, nu trec prin paletă.
 */

export interface UserPaletteEntry {
  light: string;
  dark: string;
}

export const USER_PALETTE: UserPaletteEntry[] = [
  { light: '#C53E34', dark: '#F0B6B2' },
  { light: '#A9561E', dark: '#F3B891' },
  { light: '#8F6614', dark: '#F1BB50' },
  { light: '#627321', dark: '#B1D22D' },
  { light: '#297A44', dark: '#6CDA91' },
  { light: '#247B5E', dark: '#4EDAAB' },
  { light: '#227777', dark: '#42D7D7' },
  { light: '#27749B', dark: '#8ECCEB' },
  { light: '#3060CF', dark: '#B0C4F2' },
  { light: '#4A40BF', dark: '#C6C2F0' },
  { light: '#834AB5', dark: '#D5BDEA' },
  { light: '#A54AA5', dark: '#E4B4E4' },
  { light: '#BB3E73', dark: '#EDB6CD' },
  { light: '#A45837', dark: '#E9B9A5' },
];

export type ColorSurface = 'light' | 'dark';

/** FNV-1a pe 32 de biți (determinist, fără aleator). */
export function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function userColor(userId: string, surface: ColorSurface): string {
  const entry = USER_PALETTE[stableHash(userId) % USER_PALETTE.length];
  return surface === 'light' ? entry.light : entry.dark;
}
