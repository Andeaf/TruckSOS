import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import i18n, { deviceLanguage, type Language } from '@/i18n';
import {
  loadLangPref,
  loadThemePref,
  saveLangPref,
  saveThemePref,
  type LangPref,
  type ThemePref,
} from '@/lib/preferences';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Scheme = 'light' | 'dark';

/** Faza 16: modul în care un cont admin folosește aplicația (schimbat din Panou). */
export type AdminViewAs = 'admin' | 'driver' | 'mechanic';

interface SettingsValue {
  theme: ThemePref;
  setTheme: (value: ThemePref) => void;
  /** Schema efectivă: preferința utilizatorului sau, pe `auto`, cea a sistemului. */
  resolvedScheme: Scheme;
  lang: LangPref;
  setLang: (value: LangPref) => void;
  /** `false` cât timp citim AsyncStorage — rădăcina ține splash-ul până devine `true`. */
  ready: boolean;
  /** Faza 16: doar pentru admini — în ce mod e vizualizată aplicația. În memorie (nu persistă). */
  adminViewAs: AdminViewAs;
  setAdminViewAs: (value: AdminViewAs) => void;
}

const SettingsContext = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [theme, setThemeState] = useState<ThemePref>('light');
  const [lang, setLangState] = useState<LangPref>('auto');
  const [ready, setReady] = useState(false);
  const [adminViewAs, setAdminViewAs] = useState<AdminViewAs>('admin');

  useEffect(() => {
    Promise.all([loadThemePref(), loadLangPref()]).then(([storedTheme, storedLang]) => {
      setThemeState(storedTheme);
      setLangState(storedLang);
      void i18n.changeLanguage(resolveLang(storedLang));
      setReady(true);
    });
  }, []);

  const setTheme = useCallback((value: ThemePref) => {
    setThemeState(value);
    void saveThemePref(value);
  }, []);

  // `changeLanguage` notifică toți consumatorii `useTranslation()` → UI-ul se schimbă
  // instant, inclusiv titlurile de taburi. Nu e nevoie de restart.
  const setLang = useCallback((value: LangPref) => {
    setLangState(value);
    void i18n.changeLanguage(resolveLang(value));
    void saveLangPref(value);
  }, []);

  const resolvedScheme = resolveScheme(theme, systemScheme);

  const value = useMemo<SettingsValue>(
    () => ({ theme, setTheme, resolvedScheme, lang, setLang, ready, adminViewAs, setAdminViewAs }),
    [theme, setTheme, resolvedScheme, lang, setLang, ready, adminViewAs]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsValue {
  const context = useContext(SettingsContext);
  if (!context) throw new Error('useSettings trebuie folosit în interiorul SettingsProvider');
  return context;
}

/**
 * Schema efectivă, cu fallback pe sistem dacă providerul lipsește — ca o componentă
 * randată accidental în afara lui (ex. un ecran de eroare) să nu arunce.
 */
export function useResolvedScheme(): Scheme {
  const context = useContext(SettingsContext);
  const systemScheme = useColorScheme();
  return context?.resolvedScheme ?? resolveScheme('light', systemScheme);
}

function resolveScheme(theme: ThemePref, systemScheme: string | null | undefined): Scheme {
  if (theme !== 'auto') return theme;
  return systemScheme === 'dark' ? 'dark' : 'light';
}

function resolveLang(lang: LangPref): Language {
  return lang === 'auto' ? deviceLanguage() : lang;
}
