import AsyncStorage from '@react-native-async-storage/async-storage';

import { SUPPORTED_LANGUAGES, type Language } from '@/i18n';

/**
 * Preferințele utilizatorului, persistate local (PLAN_FAZA10.md §3).
 * `auto` = urmează sistemul; orice altă valoare suprascrie detecția automată.
 */

export type ThemePref = 'auto' | 'light' | 'dark';
export type LangPref = 'auto' | Language;

const THEME_KEY = '@trucksos/theme';
const LANG_KEY = '@trucksos/lang';

const THEME_VALUES: readonly ThemePref[] = ['auto', 'light', 'dark'];
const LANG_VALUES: readonly LangPref[] = ['auto', ...SUPPORTED_LANGUAGES];

function isThemePref(value: string | null): value is ThemePref {
  return value !== null && (THEME_VALUES as readonly string[]).includes(value);
}

function isLangPref(value: string | null): value is LangPref {
  return value !== null && (LANG_VALUES as readonly string[]).includes(value);
}

export async function loadThemePref(): Promise<ThemePref> {
  try {
    const stored = await AsyncStorage.getItem(THEME_KEY);
    return isThemePref(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export async function saveThemePref(value: ThemePref): Promise<void> {
  try {
    await AsyncStorage.setItem(THEME_KEY, value);
  } catch {
    // Preferința rămâne activă în memorie pentru sesiunea curentă.
  }
}

export async function loadLangPref(): Promise<LangPref> {
  try {
    const stored = await AsyncStorage.getItem(LANG_KEY);
    return isLangPref(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export async function saveLangPref(value: LangPref): Promise<void> {
  try {
    await AsyncStorage.setItem(LANG_KEY, value);
  } catch {
    // Idem: preferința rămâne activă până la repornire.
  }
}
