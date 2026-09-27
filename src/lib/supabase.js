import { createClient } from "@supabase/supabase-js";

// Sweet Live is a Vite app. In production, VITE_* values are normally
// injected by Vercel at build time. The public Supabase URL and publishable
// key are safe to expose in a browser application.
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://gylizczvegxatcjfhbse.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  "sb_publishable_IsOg6rLbLaS9D6SUwjiDPg_780_wEnY";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
