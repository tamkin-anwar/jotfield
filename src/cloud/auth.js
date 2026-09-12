const redirectUrl = () => `${location.origin}${location.pathname}`;

export async function observeAccount(clientPromise, onChange) {
  const client = await clientPromise;
  if (!client) return () => {};

  const { data: { session } } = await client.auth.getSession();
  onChange(session, 'INITIAL_SESSION');
  const { data: { subscription } } = client.auth.onAuthStateChange((event, nextSession) => onChange(nextSession, event));
  return () => subscription.unsubscribe();
}

export async function signInWithPassword(clientPromise, email, password) {
  const client = await clientPromise;
  if (!client) throw new Error('Accounts are unavailable');
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function createAccount(clientPromise, { email, password, name }) {
  const client = await clientPromise;
  if (!client) throw new Error('Accounts are unavailable');
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: redirectUrl(),
      data: { display_name: name },
    },
  });
  if (error) throw error;
  return data;
}

export async function sendMagicLink(clientPromise, email) {
  const client = await clientPromise;
  if (!client) throw new Error('Accounts are unavailable');
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectUrl() } });
  if (error) throw error;
}

export async function sendPasswordReset(clientPromise, email) {
  const client = await clientPromise;
  if (!client) throw new Error('Accounts are unavailable');
  const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() });
  if (error) throw error;
}

export async function signOut(clientPromise, scope = 'local') {
  const client = await clientPromise;
  if (!client) return;
  const { error } = await client.auth.signOut({ scope });
  if (error) throw error;
}

export async function updatePassword(clientPromise, password) {
  const client = await clientPromise;
  if (!client) throw new Error('Accounts are unavailable');
  const { error } = await client.auth.updateUser({ password });
  if (error) throw error;
}

export async function deleteCloudAccount(clientPromise) {
  const client = await clientPromise;
  if (!client) throw new Error('Accounts are unavailable');
  const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
  if (error) throw error;
  await client.auth.signOut({ scope: 'local' });
}

export function accountLabel(session) {
  const user = session?.user;
  if (!user) return { name: '', email: '', initial: 'J', verified: false };
  const name = String(user.user_metadata?.display_name || user.email?.split('@')[0] || 'Jotfield member').trim();
  return {
    name,
    email: user.email || '',
    initial: name.slice(0, 1).toUpperCase() || 'J',
    verified: Boolean(user.email_confirmed_at),
  };
}
