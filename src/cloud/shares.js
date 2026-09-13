const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes) {
  let value = '';
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

export async function encryptSharedNote(payload, keyValue = null) {
  const rawKey = keyValue ? fromBase64Url(keyValue) : crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const clear = encoder.encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, clear);
  return {
    ciphertext: toBase64Url(new Uint8Array(cipher)),
    nonce: toBase64Url(nonce),
    key: toBase64Url(rawKey),
  };
}

export async function decryptSharedNote(row, keyValue) {
  const key = await crypto.subtle.importKey('raw', fromBase64Url(keyValue), 'AES-GCM', false, ['decrypt']);
  const clear = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64Url(row.nonce) },
    key,
    fromBase64Url(row.ciphertext),
  );
  return JSON.parse(decoder.decode(clear));
}

export function liveShareUrl(id, keyValue) {
  return `${location.origin}${location.pathname}#share=${id}.${keyValue}`;
}

export function readLiveShareFragment() {
  if (!location.hash.startsWith('#share=')) return null;
  const [id, key] = location.hash.slice(7).split('.');
  if (!/^[0-9a-f-]{36}$/i.test(id || '') || !key) throw new Error('Invalid private link');
  return { id, key };
}

async function cloudClient(clientPromise) {
  const client = await clientPromise;
  if (!client) throw new Error('Live sharing is unavailable');
  return client;
}

export async function createLiveShare(clientPromise, payload, expiresAt) {
  const client = await cloudClient(clientPromise);
  const encrypted = await encryptSharedNote(payload);
  const { data, error } = await client.from('note_shares').insert({
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    expires_at: expiresAt,
  }).select('id, expires_at').single();
  if (error) throw error;
  return { id: data.id, key: encrypted.key, expiresAt: data.expires_at };
}

export async function updateLiveShare(clientPromise, share, payload, expiresAt) {
  const client = await cloudClient(clientPromise);
  const encrypted = await encryptSharedNote(payload, share.key);
  const { data, error } = await client.from('note_shares').update({
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', share.id).select('id, expires_at').single();
  if (error) throw error;
  return { id: data.id, key: encrypted.key, expiresAt: data.expires_at };
}

export async function revokeLiveShare(clientPromise, id) {
  const client = await cloudClient(clientPromise);
  const { error } = await client.from('note_shares').update({
    revoked_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (error) throw error;
}

export async function readLiveShare(clientPromise, id, keyValue) {
  const client = await cloudClient(clientPromise);
  const { data, error } = await client.rpc('read_note_share', { share_id: id });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error('This private link has expired or was turned off');
  return decryptSharedNote(row, keyValue);
}
