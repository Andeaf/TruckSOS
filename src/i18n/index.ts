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

const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'en';
const supportedLocale = deviceLocale in resources ? deviceLocale : 'en';

i18n.use(initReactI18next).init({
  resources,
  lng: supportedLocale,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
