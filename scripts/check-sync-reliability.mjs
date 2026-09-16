import assert from 'node:assert/strict';
import fs from 'node:fs';
import { deletionTombstone, mergeNotebookVersions } from '../src/cloud/merge.js';

const baseNote = {
  id: 'shared-note',
  title: 'Trip plan',
  body: 'Book a room',
  created: '2026-09-15T10:00:00.000Z',
  updated: '2026-09-15T10:00:00.000Z',
};
const base = { notes: [baseNote], tasks: [], spaces: [], tombstones: [], modifiedAt: baseNote.updated };
const localNote = { ...baseNote, body: 'Book a room near the station', updated: '2026-09-15T11:00:00.000Z' };
const remoteNote = { ...baseNote, body: 'Book a quiet room', updated: '2026-09-15T12:00:00.000Z' };
const local = { ...base, notes: [localNote], modifiedAt: localNote.updated };
const remote = { ...base, notes: [remoteNote], modifiedAt: remoteNote.updated };

const conflicted = mergeNotebookVersions(local, remote, base);
assert.equal(conflicted.notes.find((note) => note.id === baseNote.id).body, remoteNote.body);
assert.equal(conflicted.notes.filter((note) => note.conflictOf === baseNote.id).length, 1);
assert.equal(conflicted.notes.find((note) => note.conflictOf === baseNote.id).body, localNote.body);

const repeated = mergeNotebookVersions(conflicted, remote, remote);
assert.equal(repeated.notes.filter((note) => note.conflictOf === baseNote.id).length, 1, 'conflict copies remain idempotent');

const deletedAt = '2026-09-15T13:00:00.000Z';
const deleted = mergeNotebookVersions(
  { ...local, notes: [], tombstones: [deletionTombstone('note', baseNote.id, deletedAt)] },
  remote,
  base,
);
assert.equal(deleted.notes.some((note) => note.id === baseNote.id), false, 'a permanent deletion does not resurrect');

const newerRemote = { ...remoteNote, body: 'Restored intentionally', updated: '2026-09-15T14:00:00.000Z' };
const restored = mergeNotebookVersions(
  { ...local, notes: [], tombstones: [deletionTombstone('note', baseNote.id, deletedAt)] },
  { ...remote, notes: [newerRemote], modifiedAt: newerRemote.updated },
  base,
);
assert.equal(restored.notes.find((note) => note.id === baseNote.id)?.body, newerRemote.body, 'a newer intentional edit wins over an older deletion');

const syncSource = fs.readFileSync(new URL('../src/cloud/sync.js', import.meta.url), 'utf8');
assert.match(syncSource, /SYNC_PENDING_KEY/);
assert.match(syncSource, /SYNC_BASE_KEY/);
assert.match(syncSource, /WRITE_ATTEMPTS = 3/);
assert.match(syncSource, /mergeNotebook\(getNotebook\(\), incoming, await savedBase\(\)\)/);
assert.match(syncSource, /eq\('content_version', row\.content_version\)/);

console.log('sync reliability checks passed');
