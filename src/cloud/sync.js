const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SYNC_KEY = 'jotfield-cloud-key';
const SYNC_BASE_KEY = 'jotfield-cloud-base-v2';
const SYNC_PENDING_KEY = 'jotfield-cloud-pending-v2';
const ITERATIONS = 310000;
const RETRY_DELAYS = [2500, 8000, 30000];
const WRITE_ATTEMPTS = 3;

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

const sameNotebook = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function createEncryptedSync({ clientPromise, getNotebook, mergeNotebook, applyNotebook, setStatus, openDatabase }) {
  let session = null;
  let workspaceId = null;
  let key = null;
  let salt = null;
  let timer = null;
  let running = false;
  let rerunRequested = false;
  let channel = null;
  let retryCount = 0;
  let configured = false;
  let dirtyGeneration = 0;
  let scheduleRequest = 0;
  const client = () => clientPromise;

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener('complete', resolve, { once: true });
      transaction.addEventListener('abort', () => reject(transaction.error || new Error('Sync storage was interrupted.')), { once: true });
      transaction.addEventListener('error', () => reject(transaction.error || new Error('Sync storage failed.')), { once: true });
    });
  }

  async function readSecret(name) {
    const database = await openDatabase();
    const transaction = database.transaction('secrets', 'readonly');
    const completed = transactionDone(transaction);
    const request = transaction.objectStore('secrets').get(name);
    const value = await new Promise((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result || null), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    await completed;
    return value;
  }

  async function writeSecret(name, value) {
    const database = await openDatabase();
    const transaction = database.transaction('secrets', 'readwrite');
    const completed = transactionDone(transaction);
    transaction.objectStore('secrets').put(value, name);
    await completed;
  }

  async function deleteSecret(name) {
    const database = await openDatabase();
    const transaction = database.transaction('secrets', 'readwrite');
    const completed = transactionDone(transaction);
    transaction.objectStore('secrets').delete(name);
    await completed;
  }

  async function savedKey() {
    try { return await readSecret(SYNC_KEY); }
    catch { return null; }
  }

  async function savedBase() {
    try {
      const saved = await readSecret(SYNC_BASE_KEY);
      return saved?.workspaceId === workspaceId ? saved.notebook : null;
    } catch { return null; }
  }

  async function saveBase(notebook) {
    await writeSecret(SYNC_BASE_KEY, { workspaceId, notebook: structuredClone(notebook), savedAt: new Date().toISOString() });
  }

  async function markPending() {
    dirtyGeneration += 1;
    await persistPending();
  }

  async function persistPending() {
    try { await writeSecret(SYNC_PENDING_KEY, { workspaceId, generation: dirtyGeneration, changedAt: new Date().toISOString() }); }
    catch {}
  }

  async function clearPending(generation) {
    if (generation !== dirtyGeneration) return;
    try { await deleteSecret(SYNC_PENDING_KEY); }
    catch {}
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

  async function mergeRemote(row = null) {
    const remoteRow = row || await cloudRow();
    if (!remoteRow) return { row: null, notebook: getNotebook(), incoming: null };
    const incoming = await decryptNotebook(remoteRow, key);
    const merged = mergeNotebook(getNotebook(), incoming, await savedBase());
    if (!sameNotebook(merged, getNotebook())) applyNotebook(merged);
    await saveBase(incoming);
    return { row: remoteRow, notebook: merged, incoming };
  }

  function retry() {
    clearTimeout(timer);
    const delay = RETRY_DELAYS[Math.min(retryCount, RETRY_DELAYS.length - 1)];
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
    if (!key || !row?.ciphertext) return;
    if (running) { rerunRequested = true; return; }
    try {
      const incoming = await decryptNotebook(row, key);
      const local = getNotebook();
      const merged = mergeNotebook(local, incoming, await savedBase());
      if (!sameNotebook(merged, local)) applyNotebook(merged);
      await saveBase(incoming);
      if (!sameNotebook(merged, incoming)) {
        await markPending();
        timer = setTimeout(push, 0);
      } else {
        setStatus('synced');
      }
    } catch (error) {
      setStatus('error', error.name === 'OperationError' ? 'This device could not open the newest encrypted copy.' : error.message);
      retry();
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

  async function writeNotebook(supabase, row, notebook) {
    const encrypted = await encryptNotebook(notebook, key, salt);
    const record = {
      id: workspaceId,
      workspace_id: workspaceId,
      author_id: session.user.id,
      ...encrypted,
      key_version: 1,
      content_version: (row?.content_version || 0) + 1,
      updated_at: new Date().toISOString(),
    };
    const query = row
      ? supabase.from('notes').update(record).eq('id', workspaceId).eq('content_version', row.content_version).select('id, content_version')
      : supabase.from('notes').insert(record).select('id, content_version');
    return query;
  }

  async function push() {
    if (!session || !key) return;
    if (running) { rerunRequested = true; return; }
    running = true;
    rerunRequested = false;
    const generation = dirtyGeneration;
    setStatus('syncing');
    try {
      const supabase = await client();
      let syncedNotebook = null;
      for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
        const { row, notebook } = await mergeRemote();
        const { data, error } = await writeNotebook(supabase, row, notebook);
        if (error && !(error.code === '23505' && attempt < WRITE_ATTEMPTS - 1)) throw error;
        if (data?.length) { syncedNotebook = notebook; break; }
      }
      if (!syncedNotebook) throw new Error('The cloud copy kept changing. Jotfield will try again.');
      await saveBase(syncedNotebook);
      await clearPending(generation);
      retryCount = 0;
      setStatus(generation === dirtyGeneration ? 'synced' : 'syncing');
    } catch (error) {
      await persistPending();
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      setStatus(offline ? 'offline' : 'error', offline ? 'Offline. Changes will sync when you reconnect.' : error.message);
      retry();
    } finally {
      running = false;
      if (rerunRequested || generation !== dirtyGeneration) {
        clearTimeout(timer);
        timer = setTimeout(push, 0);
      }
    }
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
      if (row) await mergeRemote(row);
      await writeSecret(SYNC_KEY, { key, salt, userId: session.user.id, workspaceId });
      await markPending();
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
    if (!session) {
      await stopRealtime();
      key = null;
      workspaceId = null;
      configured = false;
      setStatus('off');
      return;
    }
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
    const pending = await readSecret(SYNC_PENDING_KEY).catch(() => null);
    dirtyGeneration = pending?.workspaceId === workspaceId ? Math.max(1, pending.generation || 1) : 0;
    await push();
    await startRealtime();
  }

  function schedule() {
    if (!key || !session) return;
    const request = ++scheduleRequest;
    clearTimeout(timer);
    markPending().finally(() => {
      if (request !== scheduleRequest) return;
      timer = setTimeout(push, 900);
    });
  }

  async function lock() {
    clearTimeout(timer);
    await stopRealtime();
    key = null;
    salt = null;
    workspaceId = null;
    try { await deleteSecret(SYNC_KEY); } catch {}
    setStatus(session ? (configured ? 'locked' : 'setup') : 'off');
  }

  async function refresh() {
    if (!key || !session) return;
    if (running) { rerunRequested = true; return; }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (offline) { setStatus('offline'); return; }
    try {
      setStatus('syncing');
      const { notebook, incoming } = await mergeRemote();
      retryCount = 0;
      if (incoming && !sameNotebook(notebook, incoming)) {
        await markPending();
        await push();
      } else {
        setStatus('synced');
      }
    } catch (error) {
      setStatus('error', error.message);
      retry();
    }
  }

  return { start, unlock, schedule, push, refresh, lock, isUnlocked: () => Boolean(key), needsSetup: () => !configured };
}
