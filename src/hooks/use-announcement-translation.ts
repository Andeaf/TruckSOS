import { useCallback, useEffect, useRef, useState } from 'react';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { useTranslation } from 'react-i18next';

import { SUPPORTED_LANGUAGES, type Language } from '@/i18n';
import { supabase } from '@/lib/supabase';

/**
 * 1.1 (H3): butonul „Tradu” de pe detaliul anunțului.
 *
 * Fluxul: cache-ul sesiunii (memorie) → `announcement_translations` citit ca utilizatorul
 * (RLS: vezi traducerea doar dacă vezi anunțul) → Edge Function `translate-announcement`.
 * Merge și pe un server fără migrarea 20261028: coloanele `source_lang*` lipsesc → butonul
 * rămâne vizibil, citirea tabelului eșuează tăcut, iar funcția răspunde cu eroare → mesajul
 * generic sub buton.
 */

type AnnouncementForTranslation = {
  id: string;
  description: string;
  source_lang?: string | null;
  source_lang_detected?: boolean;
};

export type AnnouncementTranslation =
  | { sameLanguage: true }
  | { sameLanguage: false; text: string; sourceLang: string };

type FunctionResponse = {
  text: string | null;
  source_lang: string;
  same_language: boolean;
  cached: boolean;
};

/** Cheile i18n ale erorilor afișate sub buton (`error` din hook e o cheie, nu un text). */
const ERROR_RATE_LIMITED = 'common.translate.rateLimited';
const ERROR_GENERIC = 'common.translate.error';

/**
 * Cache-ul sesiunii, per `id:limbă`: o traducere cerută o dată nu se mai cere la redeschiderea
 * detaliului. Doar în memorie (nu AsyncStorage) — traducerile stau oricum în cache pe server.
 */
const sessionCache = new Map<string, AnnouncementTranslation>();

function resolveAppLang(language: string | undefined): Language {
  const code = (language ?? '').slice(0, 2).toLowerCase();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(code) ? (code as Language) : 'en';
}

type LocalState = {
  key: string | null;
  translated: AnnouncementTranslation | null;
  showingTranslation: boolean;
  loading: boolean;
  error: string | null;
};

function initialStateFor(key: string | null): LocalState {
  const cached = key ? (sessionCache.get(key) ?? null) : null;
  return {
    key,
    translated: cached,
    showingTranslation: cached != null && !cached.sameLanguage,
    loading: false,
    error: null,
  };
}

async function fetchTranslation(
  id: string,
  appLang: Language,
): Promise<{ result: AnnouncementTranslation } | { error: string }> {
  // (a) Cache-ul de pe server, citit direct (fără cotă, fără funcție). Orice eroare — inclusiv
  // tabelul inexistent pe un server fără migrare — se ignoră: funcția e sursa de adevăr.
  try {
    const { data, error } = await supabase
      .from('announcement_translations')
      .select('text, source_lang')
      .eq('announcement_id', id)
      .eq('lang', appLang)
      .maybeSingle();
    const row = data as { text?: unknown; source_lang?: unknown } | null;
    if (!error && row && typeof row.text === 'string' && row.text.length > 0) {
      return {
        result: {
          sameLanguage: false,
          text: row.text,
          sourceLang: typeof row.source_lang === 'string' ? row.source_lang : 'und',
        },
      };
    }
  } catch {
    // rețea / tabel lipsă — trecem la funcție
  }

  // (b) Edge Function-ul (detecție + traducere + rate limit pe server).
  const { data, error } = await supabase.functions.invoke<FunctionResponse>(
    'translate-announcement',
    { body: { announcement_id: id, target_lang: appLang } },
  );
  if (error) {
    const status =
      error instanceof FunctionsHttpError
        ? (error.context as { status?: number } | undefined)?.status
        : undefined;
    return { error: status === 429 ? ERROR_RATE_LIMITED : ERROR_GENERIC };
  }
  if (data?.same_language === true) return { result: { sameLanguage: true } };
  if (data && typeof data.text === 'string' && data.text.length > 0) {
    return {
      result: {
        sameLanguage: false,
        text: data.text,
        sourceLang: typeof data.source_lang === 'string' ? data.source_lang : 'und',
      },
    };
  }
  return { error: ERROR_GENERIC };
}

export function useAnnouncementTranslation(announcement: AnnouncementForTranslation | null) {
  const { i18n } = useTranslation();
  const appLang = resolveAppLang(i18n.language);
  const id = announcement?.id ?? null;
  const key = id ? `${id}:${appLang}` : null;

  const [rawState, setRawState] = useState<LocalState>(() => initialStateFor(key));
  // Anunț sau limbă schimbate → starea veche nu se mai aplică; pornim din cache-ul sesiunii.
  const state = rawState.key === key ? rawState : initialStateFor(key);

  // Cheia curentă, ca un răspuns sosit după schimbarea anunțului/limbii (sau după ce ecranul
  // s-a închis) să nu scrie peste starea nouă.
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
    return () => {
      keyRef.current = null;
    };
  }, [key]);

  const inFlight = useRef<string | null>(null);

  const translate = useCallback(async () => {
    if (!id || !key || inFlight.current === key) return;
    const cached = sessionCache.get(key);
    if (cached) {
      setRawState({
        key,
        translated: cached,
        showingTranslation: !cached.sameLanguage,
        loading: false,
        error: null,
      });
      return;
    }

    inFlight.current = key;
    setRawState({ key, translated: null, showingTranslation: false, loading: true, error: null });
    let outcome: { result: AnnouncementTranslation } | { error: string };
    try {
      outcome = await fetchTranslation(id, appLang);
    } catch {
      outcome = { error: ERROR_GENERIC };
    } finally {
      if (inFlight.current === key) inFlight.current = null;
    }

    if ('result' in outcome) sessionCache.set(key, outcome.result);
    if (keyRef.current !== key) return;
    setRawState(
      'result' in outcome
        ? {
            key,
            translated: outcome.result,
            showingTranslation: !outcome.result.sameLanguage,
            loading: false,
            error: null,
          }
        : { key, translated: null, showingTranslation: false, loading: false, error: outcome.error },
    );
  }, [id, key, appLang]);

  const toggle = useCallback(() => {
    setRawState((prev) => {
      const base = prev.key === key ? prev : initialStateFor(key);
      if (!base.translated || base.translated.sameLanguage) return base;
      return { ...base, showingTranslation: !base.showingTranslation };
    });
  }, [key]);

  const detectedSame =
    announcement?.source_lang_detected === true && announcement.source_lang === appLang;
  const canTranslate =
    announcement != null && !detectedSame && !(state.translated?.sameLanguage ?? false);

  return {
    canTranslate,
    translated: state.translated,
    showingTranslation: state.showingTranslation,
    loading: state.loading,
    error: state.error,
    translate,
    toggle,
  };
}
