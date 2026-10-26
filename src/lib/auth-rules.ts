/**
 * Reguli de autentificare aplicate în client (26 oct 2026, PLAN_1.1_FIX 1.4 / AUDIT #41).
 *
 * Lungimea minimă a parolei: 8 (era 6). Aceeași valoare trebuie pusă și în Supabase →
 * Authentication → Settings → „Minimum password length” (serverul e cel care impune regula;
 * clientul doar o explică înainte de cerere). Conturile existente cu parole mai scurte rămân
 * valabile până la următoarea schimbare de parolă.
 */
export const MIN_PASSWORD_LENGTH = 8;
