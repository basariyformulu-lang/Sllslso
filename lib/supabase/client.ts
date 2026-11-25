import { createBrowserClient } from '@supabase/ssr';

export function isSupabaseClientConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(
    url &&
      key &&
      url.startsWith('http') &&
      !url.includes('YOUR_PROJECT_ID') &&
      !key.includes('YOUR_SUPABASE_ANON_KEY')
  );
}

export function createBrowserSupabase() {
  if (!isSupabaseClientConfigured()) {
    return null;
  }
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
