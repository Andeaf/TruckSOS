// 9 nov 2026 — Edge Function `report-public` (faza 8.3, DSA art. 16): sesizări fără cont de pe trucksos.net/report.
// Fluxul (CORS, validare, Turnstile siteverify, hash IP, RPC insert_public_report) e în handler.ts, testat în handler_test.ts.
//
// Securitate: `verify_jwt = false` în config.toml (pagina publică nu are sesiune); porțile sunt Turnstile (secretul
// `TURNSTILE_SECRET`) și limita 10/oră/IP ținută în bază pe SHA-256(`REPORT_IP_SALT` + IP) — IP-ul brut nu se stochează.
// Scrierea se face cu SUPABASE_SERVICE_ROLE_KEY din env-ul propriu, prin RPC-ul care validează din nou și rezolvă ținta.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { makeReportPublicHandler } from './handler.ts';

Deno.serve(
  makeReportPublicHandler({
    env: (name) => Deno.env.get(name),
    fetch: (url, init) => fetch(url, init),
    createAdmin: (url, serviceKey) => createClient(url, serviceKey),
  }),
);
