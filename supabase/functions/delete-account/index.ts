import { createClient } from 'npm:@supabase/supabase-js@2';

const configuredOrigins = (Deno.env.get('ALLOWED_ORIGINS') || 'https://tamkin-anwar.github.io,http://127.0.0.1:3000')
  .split(',')
  .map((origin) => origin.trim());

function responseHeaders(request: Request) {
  const origin = request.headers.get('Origin') || configuredOrigins[0];
  return {
    'Access-Control-Allow-Origin': configuredOrigins.includes(origin) ? origin : configuredOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

Deno.serve(async (request) => {
  const corsHeaders = responseHeaders(request);
  const requestOrigin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  if (requestOrigin && !configuredOrigins.includes(requestOrigin)) return new Response('Origin not allowed', { status: 403, headers: corsHeaders });

  const authorization = request.headers.get('Authorization');
  if (!authorization) return new Response('Authentication required', { status: 401, headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL');
  const publishableKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publishableKey || !serviceRoleKey) return new Response('Service unavailable', { status: 503, headers: corsHeaders });

  const userClient = createClient(url, publishableKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return new Response('Authentication required', { status: 401, headers: corsHeaders });

  const administrator = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: workspaceError } = await administrator.from('workspaces').delete().eq('created_by', user.id);
  if (workspaceError) return new Response('Could not remove workspace', { status: 500, headers: corsHeaders });

  const { error: deletionError } = await administrator.auth.admin.deleteUser(user.id);
  if (deletionError) return new Response('Could not remove account', { status: 500, headers: corsHeaders });

  return new Response(JSON.stringify({ deleted: true }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
