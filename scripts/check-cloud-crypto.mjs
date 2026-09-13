import assert from 'node:assert/strict';
import { decryptNotebook, deriveKey, encryptNotebook } from '../src/cloud/sync.js';

const notebook = {
  notes: [{ id: 'note-one', title: 'Private thought', body: 'Only ciphertext belongs in the cloud.' }],
  spaces: [{ id: 'personal', name: 'Personal' }],
  tasks: [],
};
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await deriveKey('correct horse battery staple', salt);
const encrypted = await encryptNotebook(notebook, key, salt);

assert.doesNotMatch(encrypted.ciphertext, /Private thought|ciphertext belongs/);
assert.deepEqual(await decryptNotebook(encrypted, key), notebook);

const wrongKey = await deriveKey('another passphrase entirely', salt);
await assert.rejects(() => decryptNotebook(encrypted, wrongKey), { name: 'OperationError' });

console.log('cloud encryption round trip passed');
