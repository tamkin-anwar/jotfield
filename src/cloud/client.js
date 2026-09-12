const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const cloudConfiguration = Object.freeze({
  enabled: Boolean(url && publishableKey),
  url: url || null,
});

export async function createCloudClient() {
  if (!cloudConfiguration.enabled) return null;

  const { createClient } = await import('@supabase/supabase-js');

  return createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'jotfield-auth',
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });
}
