import { AppState, type AppStateStatus } from 'react-native';
import type { NetworkState } from 'expo-network';

/**
 * „Acum merită să reîncerci" (15 oct 2026): un singur abonament la AppState +
 * expo-network, distribuit tuturor celor interesați — zeci de poze pe un ecran,
 * fără câte o pereche de listeneri nativi fiecare. Declanșează la:
 *  - revenirea app-ului în prim-plan (fundal/inactiv → activ);
 *  - rețeaua devenită din nou utilizabilă (internet inaccesibil → accesibil) SAU
 *    schimbarea tipului de conexiune cu internet (Wi‑Fi ↔ date): exact momentul în
 *    care încărcările picate pe rețeaua veche au șanse pe cea nouă.
 * Folosit de `RemoteImage` (poze picate) și `useSignedUrls` (semnări picate).
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let subscriptions: { remove(): void }[] = [];
let appState: AppStateStatus = AppState.currentState;
/** Ultima stare de rețea văzută; null = fără reper încă (primul eveniment e doar reperul). */
let network: { reachable: boolean; type: string | null } | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function handleAppState(next: AppStateStatus) {
  const wasAway = appState === 'background' || appState === 'inactive';
  appState = next;
  if (next === 'active' && wasAway) notify();
}

function handleNetwork(state: NetworkState) {
  // Pe iOS isInternetReachable = isConnected; pe web lipsesc ambele uneori → presupunem „da".
  const reachable = state.isInternetReachable ?? state.isConnected ?? true;
  const type = state.type ?? null;
  const prev = network;
  network = { reachable, type };
  if (!prev) return;
  if (reachable && (!prev.reachable || prev.type !== type)) notify();
}

function start() {
  subscriptions.push(AppState.addEventListener('change', handleAppState));
  try {
    // Lazy, ca în network-diagnosis.ts: fără modulul nativ rămâne doar prim-planul.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Network = require('expo-network') as typeof import('expo-network');
    subscriptions.push(Network.addNetworkStateListener(handleNetwork));
    // Reperul inițial, ca PRIMA reconectare de după abonare să conteze ca schimbare
    // (dacă un eveniment ajunge mai repede, el devine reperul).
    Network.getNetworkStateAsync()
      .then((state) => {
        if (!network && subscriptions.length > 0) handleNetwork(state);
      })
      .catch(() => {});
  } catch {
    // Modul indisponibil → doar prim-planul declanșează.
  }
}

function stop() {
  subscriptions.forEach((subscription) => subscription.remove());
  subscriptions = [];
  network = null;
}

/** Abonare; întoarce dezabonarea. Listenerii nativi trăiesc doar cât există abonați. */
export function subscribeRetryTriggers(listener: Listener): () => void {
  if (listeners.size === 0) start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}
