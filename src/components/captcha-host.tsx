import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Button } from '@/components/ui/button';
import { Radius, Spacing } from '@/constants/theme';
import { CAPTCHA_SITE_KEY, captchaConfigured, registerNativeCaptcha } from '@/lib/captcha';

/**
 * Gazda captcha-ului Turnstile pe telefon (26 oct 2026, PLAN_1.1_FIX 1.8, decizia D10, OK David).
 *
 * Turnstile are nevoie de un context de browser → un WebView ascuns, montat la rădăcina aplicației,
 * care încarcă widget-ul (origine `https://trucksos.net`, prin `baseUrl`, ca să fie acceptată de
 * cheia widget-ului) în mod „interaction-only": de regulă rezolvă tokenul fără nimic vizibil. Dacă
 * Cloudflare cere totuși o interacțiune (`before-interactive-callback`), foaia devine vizibilă cu
 * widget-ul și un buton de anulare. `getCaptchaToken()` din lib/captcha.ts apelează handler-ul
 * înregistrat aici; fără cheie configurată nu se montează nimic.
 */

const TOKEN_TIMEOUT_MS = 30_000;
const BASE_URL = 'https://trucksos.net';

type Pending = { resolve: (token: string | null) => void; timer: ReturnType<typeof setTimeout> };

function widgetHtml(siteKey: string): string {
  // Fără caractere care ar putea închide atributul: cheia e [A-Za-z0-9_-].
  const key = siteKey.replace(/[^A-Za-z0-9_-]/g, '');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstile&render=explicit" async defer></script>
<style>html,body{margin:0;background:transparent;height:100%}#w{display:flex;align-items:center;justify-content:center;height:100%}</style>
</head><body><div id="w"></div><script>
function post(m){if(window.ReactNativeWebView){window.ReactNativeWebView.postMessage(JSON.stringify(m));}}
function onTurnstile(){try{turnstile.render('#w',{sitekey:'${key}',appearance:'interaction-only',
 'before-interactive-callback':function(){post({type:'interactive'});},
 callback:function(t){post({type:'token',token:t});},
 'error-callback':function(){post({type:'error'});},
 'expired-callback':function(){post({type:'expired'});}});}catch(e){post({type:'error'});}}
window.onerror=function(){post({type:'error'});};
</script></body></html>`;
}

export function CaptchaHost() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Pending | null>(null);
  const [interactive, setInteractive] = useState(false);
  const pendingRef = useRef<Pending | null>(null);

  const finish = (token: string | null) => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    setPending(null);
    setInteractive(false);
    p.resolve(token);
  };

  useEffect(() => {
    if (Platform.OS === 'web' || !captchaConfigured()) return;
    registerNativeCaptcha(
      () =>
        new Promise<string | null>((resolve) => {
          // O singură cerere o dată: a doua primește null (nu blocăm UI-ul).
          if (pendingRef.current) {
            resolve(null);
            return;
          }
          const timer = setTimeout(() => finish(null), TOKEN_TIMEOUT_MS);
          const p = { resolve, timer };
          pendingRef.current = p;
          setPending(p);
        }),
    );
    return () => registerNativeCaptcha(null);
    // `finish` folosește doar ref-uri; handler-ul se înregistrează o singură dată.
  }, []);

  if (Platform.OS === 'web' || !pending) return null;

  const onMessage = (e: WebViewMessageEvent) => {
    let msg: { type?: string; token?: string } = {};
    try {
      msg = JSON.parse(e.nativeEvent.data) as { type?: string; token?: string };
    } catch {
      return;
    }
    if (msg.type === 'token' && typeof msg.token === 'string') finish(msg.token);
    else if (msg.type === 'interactive') setInteractive(true);
    else if (msg.type === 'error' || msg.type === 'expired') finish(null);
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => finish(null)}>
      <View style={[styles.backdrop, !interactive && styles.hidden]} pointerEvents={interactive ? 'auto' : 'none'}>
        <ThemedView type="backgroundElement" style={[styles.card, !interactive && styles.cardHidden]}>
          {interactive ? (
            <ThemedText type="subtitle" style={styles.title}>
              {t('auth.captchaTitle')}
            </ThemedText>
          ) : null}
          <WebView
            source={{ html: widgetHtml(CAPTCHA_SITE_KEY), baseUrl: BASE_URL }}
            originWhitelist={['https://*']}
            javaScriptEnabled
            domStorageEnabled={false}
            onMessage={onMessage}
            onError={() => finish(null)}
            style={interactive ? styles.webviewVisible : styles.webviewHidden}
            containerStyle={interactive ? undefined : styles.webviewHidden}
            androidLayerType="hardware"
          />
          {interactive ? (
            <Button variant="secondary" title={t('auth.captchaCancel')} onPress={() => finish(null)} />
          ) : null}
        </ThemedView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  hidden: { backgroundColor: 'transparent' },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: Radius.card,
    padding: Spacing.four,
    gap: Spacing.three,
    alignItems: 'center',
  },
  cardHidden: { width: 1, height: 1, padding: 0, opacity: 0 },
  title: { textAlign: 'center' },
  webviewVisible: { width: 300, height: 70, backgroundColor: 'transparent' },
  webviewHidden: { width: 1, height: 1, opacity: 0 },
});
