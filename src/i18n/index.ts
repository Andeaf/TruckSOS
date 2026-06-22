import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';

import ro from './locales/ro.json';

const resources = {
  ro: { translation: ro },
};

const deviceLocale = Localization.getLocales()[0]?.languageCode ?? 'ro';
const supportedLocale = deviceLocale in resources ? deviceLocale : 'ro';

i18n.use(initReactI18next).init({
  resources,
  lng: supportedLocale,
  fallbackLng: 'ro',
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
