import assert from 'node:assert/strict';
import { createEncryptedBackup, MAX_BACKUP_SIZE, openEncryptedBackup } from '../src/backup.js';

const notebook = {
  notes: [{ id: 'one', title: 'A private note', body: 'Readable only after restore.' }],
  spaces: [{ id: 'personal', name: 'Personal' }],
  tasks: [],
};
const password = 'a careful backup password';
const encrypted = await createEncryptedBackup(notebook, password, '2026-09-13T00:00:00.000Z');
const file = { size: encrypted.length, text: async () => encrypted };

assert.doesNotMatch(encrypted, /A private note|Readable only/);
assert.deepEqual(await openEncryptedBackup(file, password), notebook);
await assert.rejects(() => openEncryptedBackup(file, 'the wrong password'), { name: 'OperationError' });
await assert.rejects(() => openEncryptedBackup({ size: MAX_BACKUP_SIZE + 1, text: async () => encrypted }, password), /too large/);

const altered = JSON.parse(encrypted);
altered.cipher = 'unknown';
await assert.rejects(() => openEncryptedBackup({ size: 1, text: async () => JSON.stringify(altered) }, password), /Invalid backup/);

console.log('encrypted backup checks passed');
