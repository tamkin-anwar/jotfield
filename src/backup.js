const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ITERATIONS = 310000;

export const MAX_BACKUP_SIZE = 50 * 1024 * 1024;

function toBase64(bytes) {
  let value = '';
  bytes.forEach((byte) => { value += String.fromCharCode(byte); });
  return btoa(value);
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function backupKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function createEncryptedBackup(notebook, password, exportedAt = new Date().toISOString()) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(password, salt);
  const clear = encoder.encode(JSON.stringify({ product: 'Jotfield', version: 1, exported: exportedAt, state: notebook }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, clear);
  return JSON.stringify({
    product: 'Jotfield Vault',
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: ITERATIONS,
    cipher: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  });
}

export async function openEncryptedBackup(file, password) {
  if (file.size > MAX_BACKUP_SIZE) throw new Error('Backup is too large');
  const backup = JSON.parse(await file.text());
  if (backup.product !== 'Jotfield Vault' || backup.version !== 1 || backup.kdf !== 'PBKDF2-SHA256' || backup.iterations !== ITERATIONS || backup.cipher !== 'AES-256-GCM') throw new Error('Invalid backup');
  const key = await backupKey(password, fromBase64(backup.salt));
  const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(backup.iv) }, key, fromBase64(backup.data));
  const payload = JSON.parse(decoder.decode(clear));
  if (payload.product !== 'Jotfield' || !Array.isArray(payload.state?.notes) || !Array.isArray(payload.state?.spaces)) throw new Error('Invalid notebook');
  return payload.state;
}
