import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import ro from './locales/ro.json';
import en from './locales/en.json';
import de from './locales/de.json';

const resources = {
  ro: { translation: ro },
  en: { translation: en },
  de: { translation: de },
};

export const SUPPORTED_LANGUAGES = ['ro', 'en', 'de'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Limba dispozitivului, folosită pe preferința `auto` și ca valoare inițială la import. */
export function deviceLanguage(): Language {
  const locale = Localization.getLocales()[0]?.languageCode ?? 'en';
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(locale)
    ? (locale as Language)
    : 'en';
}

// Doar valoarea inițială — sursa de adevăr e SettingsProvider, care apelează
// `i18n.changeLanguage()` după ce citește preferința din AsyncStorage.
const supportedLocale = deviceLanguage();

// eslint-disable-next-line import/no-named-as-default-member -- instanța implicită e cea importată peste tot ca `i18n`
i18n.use(initReactI18next).init({
  resources,
  lng: supportedLocale,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
