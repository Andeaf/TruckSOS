import { Platform } from 'react-native';

/**
 * Captcha Cloudflare Turnstile pentru Supabase Auth (26 oct 2026, AUDIT #4 / PLAN_1.1_FIX 1.8,
 * decizia D10).
 *
 * Supabase verifică `captchaToken` pe signUp, signInWithPassword, resetPasswordForEmail și resend
 * DOAR când „Attack Protection → Captcha" e pornit în dashboard — și atunci pentru TOȚI clienții,
 * inclusiv 1.0.6–1.0.8, care nu trimit niciun token și n-ar mai putea intra. De aceea:
 *   - clientul 1.1 trimite tokenul de îndată ce are o cheie (`EXPO_PUBLIC_CAPTCHA_SITE_KEY`);
 *   - fără cheie, `getCaptchaToken()` întoarce `null` și fluxul e identic cu cel de azi;
 *   - comutatorul din Supabase se pornește abia când 1.0.x < 2 % (decommission 11.9 (d)).
 *
 * Web: widget-ul Turnstile (script de la challenges.cloudflare.com, permis în CSP) în mod
 * „interaction-only" — invizibil cât timp Cloudflare nu cere o interacțiune. Nativ: Turnstile cere un
 * context de browser (WebView); până la OK-ul pentru dependența `react-native-webview` întoarce
 * `null`, deci pe telefon captcha-ul nu poate fi încă cerut de server fără a bloca 1.1.
 */

const SITE_KEY = process.env.EXPO_PUBLIC_CAPTCHA_SITE_KEY ?? '';
const SCRIPT_ID = 'trucksos-turnstile';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const TOKEN_TIMEOUT_MS = 30_000;

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      appearance?: 'always' | 'execute' | 'interaction-only';
      callback: (token: string) => void;
      'error-callback'?: () => void;
      'expired-callback'?: () => void;
    },
  ) => string;
  remove: (widgetId: string) => void;
}

interface TurnstileWindow extends Window {
  turnstile?: TurnstileApi;
}

let scriptPromise: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const win = window as TurnstileWindow;
    if (win.turnstile) {
      resolve(win.turnstile);
      return;
    }
    const done = () => (win.turnstile ? resolve(win.turnstile) : reject(new Error('turnstile_missing')));
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', done);
      existing.addEventListener('error', () => reject(new Error('script_error')));
      return;
    }
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.addEventListener('load', done);
    script.addEventListener('error', () => {
      scriptPromise = null;
      script.remove();
      reject(new Error('script_error'));
    });
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function webToken(): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  const turnstile = await loadScript();
  const container = document.createElement('div');
  // În afara ecranului cât e invizibil; Turnstile îl aduce în față doar dacă cere interacțiune.
  container.style.position = 'fixed';
  container.style.bottom = '16px';
  container.style.right = '16px';
  container.style.zIndex = '9999';
  document.body.appendChild(container);
  let widgetId: string | null = null;
  const cleanup = () => {
    if (widgetId !== null) {
      try {
        turnstile.remove(widgetId);
      } catch {
        // deja scos
      }
    }
    container.remove();
  };
  try {
    return await new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), TOKEN_TIMEOUT_MS);
      widgetId = turnstile.render(container, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        callback: (token) => {
          clearTimeout(timer);
          resolve(token);
        },
        'error-callback': () => {
          clearTimeout(timer);
          resolve(null);
        },
        'expired-callback': () => {
          clearTimeout(timer);
          resolve(null);
        },
      });
    });
  } finally {
    cleanup();
  }
}

/** Captcha-ul e configurat pentru acest build (cheia publică a widget-ului). */
export function captchaConfigured(): boolean {
  return SITE_KEY.length > 0;
}

/**
 * Tokenul Turnstile pentru cererea de Auth care urmează, sau `null` când nu e configurat, nu e
 * disponibil pe platformă sau nu s-a putut obține (serverul decide atunci: fără captcha pornit
 * cererea trece; cu captcha pornit răspunde cu o eroare tradusă de `auth-errors`).
 */
export async function getCaptchaToken(): Promise<string | null> {
  if (!captchaConfigured()) return null;
  if (Platform.OS !== 'web') return null; // nativ: după OK-ul pentru react-native-webview (D10)
  try {
    return await webToken();
  } catch (e) {
    console.warn('[captcha] Turnstile indisponibil:', e instanceof Error ? e.message : e);
    return null;
  }
}
