/**
 * Linkul „amânat" (7 sept 2026): cineva deschide trucksos.net/p/<id> (sau
 * trucksos://p/<id>) FĂRĂ să fie autentificat. Garda din rădăcină îl trimite la login;
 * după autentificare (sau după alegerea rolului, la un cont nou) trebuie să ajungă
 * pe profilul cerut, nu pe ecranul de start.
 *
 * Stare de modul, nu storage: trăiește cât sesiunea JS — exact cât durează drumul
 * login → acasă în SPA/aplicație. Un reload pe web o pierde, acceptabil (utilizatorul
 * are linkul în conversația din care a venit).
 */

let pending: string | null = null;

export function setPendingLink(path: string): void {
  pending = path;
}

/** Întoarce și golește linkul amânat (se consumă o singură dată). */
export function takePendingLink(): string | null {
  const value = pending;
  pending = null;
  return value;
}
