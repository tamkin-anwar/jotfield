import assert from 'node:assert/strict';
import { decryptSharedNote, encryptSharedNote } from '../src/cloud/shares.js';

const note = {
  product: 'Jotfield Shared Note',
  version: 1,
  title: 'Private field note',
  body: '<p>Only the recipient should read this.</p>',
};

const encrypted = await encryptSharedNote(note);
assert.notEqual(encrypted.ciphertext, JSON.stringify(note));
assert.deepEqual(await decryptSharedNote(encrypted, encrypted.key), note);

const refreshed = await encryptSharedNote({ ...note, title: 'Updated field note' }, encrypted.key);
assert.equal(refreshed.key, encrypted.key);
assert.equal((await decryptSharedNote(refreshed, encrypted.key)).title, 'Updated field note');

const wrongKey = (await encryptSharedNote(note)).key;
await assert.rejects(() => decryptSharedNote(encrypted, wrongKey));

const altered = encrypted.ciphertext[0] === 'A' ? 'B' : 'A';
const tampered = { ...encrypted, ciphertext: `${altered}${encrypted.ciphertext.slice(1)}` };
await assert.rejects(() => decryptSharedNote(tampered, encrypted.key));

console.log('Live sharing encryption checks passed');
