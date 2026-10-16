import { useEffect } from 'react';
import { AppState } from 'react-native';

import { clearActiveThread, dismissThreadNotifications, setActiveThread } from '@/lib/push';

/**
 * Firul (conversație/canal) pe care userul îl are ÎN FAȚĂ (13 oct 2026).
 *
 * Reclamație: „am o notificare din canal; nu apăs pe ea, intru în aplicație, deschid
 * canalul și citesc — notificarea rămâne în telefon". Ștergerea din bară rula doar
 * din markRead (efect pe `messages.length`), deci sărea exact cazurile frecvente:
 *  - revenirea pe ecranul deja montat (tab/stack) fără mesaje noi în listă;
 *  - aplicația readusă din fundal direct pe fir;
 *  - push-ul care ajunge la telefon DUPĂ ce markRead a rulat (Realtime e mai rapid
 *    decât APNs/FCM) — rămânea în bară deși userul se uita la mesaj.
 *
 * Aici: cât timp ecranul e focalizat, firul e „activ" (handler-ul din lib/push nu mai
 * afișează push-urile lui în prim-plan) și bara se curăță la focus și la fiecare
 * revenire din fundal. markRead își păstrează ștergerea — e doar o plasă în plus.
 */
export function useThreadNotifications(
  type: 'conversation' | 'channel',
  id: string | undefined,
  isFocused: boolean
): void {
  useEffect(() => {
    if (!id || !isFocused) return;
    setActiveThread(type, id);
    void dismissThreadNotifications(type, id);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void dismissThreadNotifications(type, id);
    });
    return () => {
      sub.remove();
      clearActiveThread(type, id);
    };
  }, [type, id, isFocused]);
}
