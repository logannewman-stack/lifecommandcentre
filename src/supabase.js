import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// window.__mockSupabase lets the local smoke test run without a real project.
export const supabase =
  (typeof window !== 'undefined' && window.__mockSupabase) ||
  (url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null);
