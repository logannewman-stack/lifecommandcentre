import { createClient } from '@supabase/supabase-js';

// Where the Supabase URL and publishable key come from, in order:
//   1. Build-time env vars (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY), set in
//      .env.local or in the Vercel project. This is the normal setup.
//   2. Values you pasted into the app's Connect screen, kept on this device.
// window.__mockSupabase lets the local smoke test run without a real project.

const KEY = 'lcc:supabase';
const env = { url: import.meta.env.VITE_SUPABASE_URL, key: import.meta.env.VITE_SUPABASE_ANON_KEY };

export function savedConfig() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && v.url && v.key ? v : null; } catch (e) { return null; }
}
export function saveConfig(url, key) {
  localStorage.setItem(KEY, JSON.stringify({ url: String(url).trim().replace(/\/+$/, ''), key: String(key).trim() }));
}
export function clearConfig() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

const fromEnv = !!(env.url && env.key);
export const config = fromEnv ? env : savedConfig();
export const configSource = fromEnv ? 'env' : config ? 'device' : null;

export const supabase =
  (typeof window !== 'undefined' && window.__mockSupabase) ||
  (config ? createClient(config.url, config.key, { auth: { persistSession: true, autoRefreshToken: true } }) : null);
