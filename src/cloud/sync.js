const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SYNC_KEY = 'jotfield-cloud-key';
const ITERATIONS = 310000;

function toBase64(bytes) {
  let value = '';
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return btoa(value);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function encryptNotebook(notebook, key, salt) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, encoder.encode(JSON.stringify(notebook)));
  return { ciphertext: JSON.stringify({ salt: toBase64(salt), data: toBase64(new Uint8Array(encrypted)) }), nonce: toBase64(nonce) };
}

export async function decryptNotebook(row, key) {
  const payload = JSON.parse(row.ciphertext);
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(row.nonce) }, key, fromBase64(payload.data));
  return JSON.parse(decoder.decode(clear));
}

function readSalt(row) {
  return row ? fromBase64(JSON.parse(row.ciphertext).salt) : crypto.getRandomValues(new Uint8Array(16));
}

export function createEncryptedSync({ clientPromise, getNotebook, mergeNotebook, applyNotebook, setStatus, openDatabase }) {
  let session = null;
  let workspaceId = null;
  let key = null;
  let salt = null;
  let timer = null;
  let running = false;
  let channel = null;
  let retryCount = 0;
  let configured = false;
  const client = () => clientPromise;

  async function store(mode = 'readonly') {
    const database = await openDatabase();
    return database.transaction('secrets', mode).objectStore('secrets');
  }

  async function savedKey() {
    try {
      const request = (await store()).get(SYNC_KEY);
      return await new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result || null));
        request.addEventListener('error', () => reject(request.error));
      });
    } catch { return null; }
  }

  async function personalWorkspace() {
    const supabase = await client();
    const { data, error } = await supabase.from('workspace_members').select('workspace_id').eq('user_id', session.user.id).eq('role', 'owner').limit(1).single();
    if (error) throw error;
    return data.workspace_id;
  }

  async function cloudRow() {
    const supabase = await client();
    const { data, error } = await supabase.from('notes').select('id, ciphertext, nonce, content_version, updated_at').eq('id', workspaceId).maybeSingle();
    if (error) throw error;
    return data;
  }

  async function pullAndMerge(row = null) {
    const remote = row || await cloudRow();
    if (!remote) return { row: null, notebook: getNotebook() };
    const merged = mergeNotebook(getNotebook(), await decryptNotebook(remote, key));
    applyNotebook(merged);
    return { row: remote, notebook: merged };
  }

  function retry() {
    clearTimeout(timer);
    const delay = [2500, 8000, 30000][Math.min(retryCount, 2)];
    retryCount += 1;
    timer = setTimeout(push, delay);
  }

  async function stopRealtime() {
    if (!channel) return;
    const supabase = await client();
    await supabase.removeChannel(channel);
    channel = null;
  }

  async function receiveChange(row) {
    if (!key || running || !row?.ciphertext) return;
    try {
      const incoming = await decryptNotebook(row, key);
      const local = getNotebook();
      const merged = mergeNotebook(local, incoming);
      applyNotebook(merged);
      setStatus('synced');
      if (JSON.stringify(merged) !== JSON.stringify(incoming)) schedule();
    } catch (error) {
      setStatus('error', error.name === 'OperationError' ? 'This device could not open the newest encrypted copy.' : error.message);
    }
  }

  async function startRealtime() {
    await stopRealtime();
    if (!session || !workspaceId || !key) return;
    const supabase = await client();
    channel = supabase
      .channel(`jotfield-notes-${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `id=eq.${workspaceId}` }, (payload) => receiveChange(payload.new))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setStatus('error', 'Live sync is reconnecting.');
      });
  }

  async function push() {
    if (!session || !key || running) return;
    running = true;
    setStatus('syncing');
    try {
      const supabase = await client();
      const { row, notebook } = await pullAndMerge();
      const encrypted = await encryptNotebook(notebook, key, salt);
      const record = { id: workspaceId, workspace_id: workspaceId, author_id: session.user.id, ...encrypted, key_version: 1, content_version: (row?.content_version || 0) + 1, updated_at: new Date().toISOString() };
      const query = row
        ? supabase.from('notes').update(record).eq('id', workspaceId).eq('content_version', row.content_version).select('id')
        : supabase.from('notes').insert(record).select('id');
      const { data, error } = await query;
      if (error) throw error;
      if (!data?.length) throw new Error('The cloud copy changed. Sync again.');
      retryCount = 0;
      setStatus('synced');
    } catch (error) {
      setStatus(navigator.onLine ? 'error' : 'offline', navigator.onLine ? error.message : 'Offline. Changes will sync when you reconnect.');
      retry();
    }
    finally { running = false; }
  }

  async function unlock(passphrase) {
    if (!session) throw new Error('Sign in before turning on sync.');
    setStatus('syncing');
    try {
      workspaceId = await personalWorkspace();
      const row = await cloudRow();
      configured = Boolean(row);
      salt = readSalt(row);
      key = await deriveKey(passphrase, salt);
      if (row) await pullAndMerge(row);
      (await store('readwrite')).put({ key, salt, userId: session.user.id, workspaceId }, SYNC_KEY);
      await push();
      configured = true;
      await startRealtime();
    } catch (error) {
      key = null;
      salt = null;
      workspaceId = null;
      throw error;
    }
  }

  async function start(nextSession) {
    session = nextSession;
    if (!session) { await stopRealtime(); key = null; workspaceId = null; configured = false; setStatus('off'); return; }
    const saved = await savedKey();
    if (!saved || saved.userId !== session.user.id) {
      workspaceId = await personalWorkspace();
      configured = Boolean(await cloudRow());
      workspaceId = null;
      setStatus(configured ? 'locked' : 'setup');
      return;
    }
    ({ key, salt, workspaceId } = saved);
    configured = true;
    await push();
    await startRealtime();
  }

  function schedule() {
    if (!key || !session) return;
    clearTimeout(timer);
    timer = setTimeout(push, 900);
  }

  async function lock() {
    clearTimeout(timer);
    await stopRealtime();
    key = null; salt = null; workspaceId = null;
    try { (await store('readwrite')).delete(SYNC_KEY); } catch {}
    setStatus(session ? (configured ? 'locked' : 'setup') : 'off');
  }

  async function refresh() {
    if (!key || !session || running) return;
    if (!navigator.onLine) { setStatus('offline'); return; }
    try {
      setStatus('syncing');
      await pullAndMerge();
      retryCount = 0;
      setStatus('synced');
    } catch (error) { setStatus('error', error.message); retry(); }
  }

  return { start, unlock, schedule, push, refresh, lock, isUnlocked: () => Boolean(key), needsSetup: () => !configured };
}
