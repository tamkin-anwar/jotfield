import { createCloudClient, cloudConfiguration } from './src/cloud/client.js';
import { accountLabel, createAccount, deleteCloudAccount, observeAccount, sendMagicLink, sendPasswordReset, signInWithPassword, signOut, updatePassword } from './src/cloud/auth.js';
import { makeSyncEnvelope } from './src/cloud/contracts.js';
import { createEncryptedSync } from './src/cloud/sync.js';
import { createLiveShare, liveShareUrl, readLiveShare, readLiveShareFragment, revokeLiveShare, updateLiveShare } from './src/cloud/shares.js';
import { transitionView } from './src/motion.js';
import { createEncryptedBackup, MAX_BACKUP_SIZE, openEncryptedBackup } from './src/backup.js';
import { deleteSlashTrigger, editorHTML, editorText, findInEditor, focusEditor, initializeEditor, insertAttachmentNode, insertChecklist as insertEditorChecklist, insertTable, loadEditorDocument, replaceAllEditorMatches, replaceEditorMatch, runEditorAction } from './src/editor.js';

const STORAGE_KEY = 'jotfield-notes-v1';
const LEGACY_STORAGE_KEY = 'facet-notes-v1';
const THEME_KEY = 'jotfield-appearance';
const AVATAR_KEY = 'jotfield-avatar-style';
const DB_NAME = 'jotfield-library';
const DB_VERSION = 4;
const REVISION_LIMIT = 250;
const SNAPSHOT_LIMIT = 12;
const REVISION_WINDOW = 60 * 1000;
const DURABLE_STORES = ['notes', 'spaces', 'tasks'];
const SPACE_COLORS = ['#7aa7ff', '#b295ff', '#70dded', '#77d6ad', '#f1bd70', '#ff8b93'];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const todayKey = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const starterState = {
  spaces: [
    { id: 'personal', name: 'Personal', color: '#7aa7ff' },
    { id: 'studio', name: 'Studio', color: '#b295ff' },
    { id: 'field-notes', name: 'Field notes', color: '#70dded' },
  ],
  notes: [
    {
      id: 'welcome',
      title: 'A notebook with more than one angle',
      body: 'Jotfield keeps capture fast and structure optional. Write first. Add #tags when they help. Connect another thought by typing [[Field test]].\n\nEverything here stays in this browser until you export it.',
      space: 'personal',
      favorite: true,
      archived: false,
      deleted: false,
      daily: false,
      created: now(),
      updated: now(),
    },
    {
      id: 'field-test',
      title: 'Field test',
      body: 'Things worth noticing:\n\n[ ] Does capture feel immediate?\n[ ] Can I find yesterday without thinking?\n[ ] Do connections stay visible without taking over?\n\n#product #testing',
      space: 'studio',
      favorite: false,
      archived: false,
      deleted: false,
      daily: false,
      created: new Date(Date.now() - 38 * 60 * 1000).toISOString(),
      updated: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
    },
    {
      id: 'daily-sample',
      title: new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      body: 'Today\n\nOne clear priority:\n\nWhat I noticed:\n\n#daily',
      space: 'personal',
      favorite: false,
      archived: false,
      deleted: false,
      daily: true,
      day: todayKey(),
      created: now(),
      updated: now(),
    },
  ],
  tasks: [],
};

let state = loadState();
let currentView = 'now';
let currentSpace = null;
let currentTag = null;
let currentSmart = null;
let selectedId = state.notes.find((note) => note.id === 'welcome')?.id || state.notes[0]?.id || null;
let layout = 'list';
let saveTimer;
let saveQueue = Promise.resolve();
let saveGeneration = 0;
let saveFailureNotified = false;
const durableSignatures = new Map(DURABLE_STORES.map((store) => [store, new Map()]));
let commandIndex = 0;
let commandItems = [];
let searchScope = 'all';
let retrievalIndex = null;
let planView = 'agenda';
let planMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let installEvent = null;
let lastShareUrl = '';
let openedSharedNote = null;
const deviceChannel = 'BroadcastChannel' in window ? new BroadcastChannel('jotfield-device-sync') : null;
let databasePromise;
const cloudClientPromise = createCloudClient();
const cloudReady = cloudConfiguration.enabled;
document.documentElement.dataset.cloud = cloudReady ? 'ready' : 'local';
cloudClientPromise.catch(() => { document.documentElement.dataset.cloud = 'unavailable'; });
let accountSession = null;
let accountMode = 'signin';
let cloudSync;
let backupMode = 'download';
let pendingBackupFile = null;
let historyNoteId = null;
let avatarChoice = localStorage.getItem(AVATAR_KEY) || 'ember';

const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let themeChoice = localStorage.getItem(THEME_KEY) || 'system';

function applyTheme(choice = themeChoice) {
  themeChoice = ['system', 'light', 'dark'].includes(choice) ? choice : 'system';
  const resolved = themeChoice === 'system' ? (systemTheme.matches ? 'dark' : 'light') : themeChoice;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeChoice = themeChoice;
  document.documentElement.style.colorScheme = resolved;
  $$('[data-theme-choice]').forEach((button) => {
    const active = button.dataset.themeChoice === themeChoice;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
}

applyTheme();
requestAnimationFrame(() => applyAvatarChoice());
systemTheme.addEventListener('change', () => {
  if (themeChoice === 'system') applyTheme();
});

function accountMessage(target, message, tone = '') {
  target.textContent = message;
  target.dataset.tone = tone;
}

function setAccountPending(pending) {
  $$('#account-dialog button, #account-dialog input').forEach((control) => { control.disabled = pending; });
  $('#account-dialog').classList.toggle('pending', pending);
}

function renderAccount() {
  if (!cloudReady) return;
  const details = accountLabel(accountSession);
  $('#account-button').hidden = false;
  $('#account-entry').hidden = Boolean(accountSession);
  $('#account-home').hidden = !accountSession;
  $('#account-button-label').textContent = accountSession ? details.name : 'Account';
  if (!accountSession) return;
  $('#account-avatar span').textContent = details.initial;
  $('#account-display-name').textContent = details.name;
  $('#account-address').textContent = details.email;
  $('#account-verification').textContent = details.verified ? 'Verified' : 'Check email';
  $('#account-verification').classList.toggle('waiting', !details.verified);
  $('#account-note-count').textContent = `${state.notes.length} ${state.notes.length === 1 ? 'note' : 'notes'}`;
}

function setCloudSyncStatus(status, detail = '') {
  const label = $('#cloud-sync-status');
  const action = $('#cloud-sync-unlock');
  if (!label || !action) return;
  const copy = {
    off: 'Waiting for your account.',
    setup: 'Ready to protect your notebook.',
    locked: 'Unlock your notebook on this device.',
    syncing: 'Updating your private notebook...',
    synced: 'Up to date',
    offline: 'Saved here. Updates will continue when you are online.',
    error: detail || 'Private cloud needs attention.',
  };
  label.textContent = copy[status] || copy.off;
  label.dataset.state = status;
  const setup = status === 'setup' || (status === 'error' && !cloudSync?.isUnlocked() && cloudSync?.needsSetup());
  const trusted = ['syncing', 'synced', 'offline'].includes(status) || (status === 'error' && cloudSync?.isUnlocked());
  const locked = status === 'locked' || (status === 'error' && !cloudSync?.isUnlocked());
  $('#account-sync-card').dataset.mode = trusted ? 'trusted' : (setup ? 'setup' : (locked ? 'locked' : 'off'));
  $('#cloud-sync-setup').hidden = trusted || status === 'off';
  $('#cloud-sync-trusted').hidden = !trusted;
  $('#cloud-sync-confirm-field').hidden = !setup;
  $('#cloud-sync-title').textContent = setup ? 'Keep your notes on every device' : 'Open your notes on this device';
  $('#cloud-sync-explanation').textContent = setup
    ? 'Choose a private sync password. Jotfield uses it to encrypt your notebook before it leaves this device.'
    : 'Enter the private sync password you chose when you first turned on cloud sync.';
  $('#cloud-sync-passphrase').autocomplete = setup ? 'new-password' : 'current-password';
  action.textContent = setup ? 'Turn on private sync' : 'Unlock notes';
  $('#cloud-sync-badge').textContent = trusted ? 'Protected' : (setup ? 'Set up' : (locked ? 'Locked' : 'Not connected'));
  const saveState = $('#save-state');
  saveState.classList.toggle('cloud-syncing', status === 'syncing');
  saveState.classList.toggle('cloud-synced', status === 'synced');
  if (status === 'syncing') saveState.lastChild.textContent = ' Updating';
  if (status === 'synced') saveState.lastChild.textContent = ' Up to date';
  if (status === 'offline') saveState.lastChild.textContent = ' Saved offline';
  if (status === 'error' || status === 'locked' || status === 'off') saveState.lastChild.textContent = ' Saved locally';
}

function applyAvatarChoice(choice = avatarChoice) {
  const choices = ['ember', 'cobalt', 'lime', 'violet', 'aqua', 'mineral'];
  avatarChoice = choices.includes(choice) ? choice : 'ember';
  $('#account-avatar').dataset.avatar = avatarChoice;
  $$('.avatar-options button').forEach((button) => {
    const selected = button.dataset.avatarChoice === avatarChoice;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-checked', String(selected));
  });
}

function setAccountMode(mode) {
  accountMode = mode === 'create' ? 'create' : 'signin';
  const creating = accountMode === 'create';
  $('#account-signin-tab').classList.toggle('active', !creating);
  $('#account-create-tab').classList.toggle('active', creating);
  $('#account-signin-tab').setAttribute('aria-selected', String(!creating));
  $('#account-create-tab').setAttribute('aria-selected', String(creating));
  $('#account-name-field').hidden = !creating;
  $('#account-name').required = creating;
  $('#account-password').autocomplete = creating ? 'new-password' : 'current-password';
  $('#account-submit').textContent = creating ? 'Create account' : 'Sign in';
  $('#account-recovery').hidden = creating;
  accountMessage($('#account-message'), '');
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = JSON.parse(saved);
    if (parsed && Array.isArray(parsed.notes) && Array.isArray(parsed.spaces)) return { ...parsed, tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [] };
  } catch {}
  return structuredClone(starterState);
}

function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('notebook')) database.createObjectStore('notebook');
      if (!database.objectStoreNames.contains('revisions')) {
        const revisions = database.createObjectStore('revisions', { keyPath: 'id' });
        revisions.createIndex('created', 'created');
        revisions.createIndex('noteId', 'noteId');
      }
      if (!database.objectStoreNames.contains('secrets')) database.createObjectStore('secrets');
      if (!database.objectStoreNames.contains('notes')) database.createObjectStore('notes', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('spaces')) database.createObjectStore('spaces', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('tasks')) database.createObjectStore('tasks', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('metadata')) database.createObjectStore('metadata', { keyPath: 'key' });
      if (!database.objectStoreNames.contains('snapshots')) {
        const snapshots = database.createObjectStore('snapshots', { keyPath: 'id' });
        snapshots.createIndex('created', 'created');
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
  return databasePromise;
}

function databaseRequest(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () => reject(request.error));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve());
    transaction.addEventListener('abort', () => reject(transaction.error || new Error('Storage transaction was interrupted')));
    transaction.addEventListener('error', () => reject(transaction.error || new Error('Storage transaction failed')));
  });
}

const recordSignature = (record) => JSON.stringify(record);

function rememberDurableState(snapshot) {
  DURABLE_STORES.forEach((store) => {
    durableSignatures.set(store, new Map((snapshot[store] || []).map((record) => [record.id, recordSignature(record)])));
  });
}

function syncDurableStore(transaction, storeName, records) {
  const store = transaction.objectStore(storeName);
  const previous = durableSignatures.get(storeName);
  const next = new Map();
  records.forEach((record) => {
    const signature = recordSignature(record);
    next.set(record.id, signature);
    if (previous.get(record.id) !== signature) store.put(record);
  });
  previous.forEach((_signature, id) => {
    if (!next.has(id)) store.delete(id);
  });
  return next;
}

function durableTransaction(database, stores) {
  try { return database.transaction(stores, 'readwrite', { durability: 'strict' }); }
  catch { return database.transaction(stores, 'readwrite'); }
}

async function writeDurably(snapshot, revision) {
  const database = await openDatabase();
  const transaction = durableTransaction(database, [...DURABLE_STORES, 'metadata', 'revisions', 'snapshots']);
  const completed = transactionDone(transaction);
  const nextSignatures = new Map(DURABLE_STORES.map((store) => [store, syncDurableStore(transaction, store, snapshot[store] || [])]));
  transaction.objectStore('metadata').put({ key: 'notebook', modifiedAt: snapshot.modifiedAt || now(), schemaVersion: DB_VERSION });
  if (revision) transaction.objectStore('revisions').put(revision);
  const revisions = transaction.objectStore('revisions');
  const revisionKeys = revisions.index('created').getAllKeys();
  revisionKeys.addEventListener('success', () => {
    revisionKeys.result.slice(0, Math.max(0, revisionKeys.result.length - REVISION_LIMIT)).forEach((key) => revisions.delete(key));
  });
  if (revision) {
    const snapshots = transaction.objectStore('snapshots');
    const bucket = Math.floor(Date.now() / (15 * 60 * 1000));
    snapshots.put({ id: `auto-${bucket}`, created: now(), state: snapshot });
    const snapshotKeys = snapshots.index('created').getAllKeys();
    snapshotKeys.addEventListener('success', () => {
      snapshotKeys.result.slice(0, Math.max(0, snapshotKeys.result.length - SNAPSHOT_LIMIT)).forEach((key) => snapshots.delete(key));
    });
  }
  await completed;
  nextSignatures.forEach((signatures, store) => durableSignatures.set(store, signatures));
}

function enqueueDurableWrite(snapshot, revision) {
  saveQueue = saveQueue.catch(() => {}).then(() => writeDurably(snapshot, revision));
  return saveQueue;
}

async function readNormalizedState(database) {
  const transaction = database.transaction([...DURABLE_STORES, 'metadata'], 'readonly');
  const completed = transactionDone(transaction);
  const [notes, spaces, tasks, metadata] = await Promise.all([
    databaseRequest(transaction.objectStore('notes').getAll()),
    databaseRequest(transaction.objectStore('spaces').getAll()),
    databaseRequest(transaction.objectStore('tasks').getAll()),
    databaseRequest(transaction.objectStore('metadata').get('notebook')),
  ]);
  await completed;
  if (!metadata || !Array.isArray(notes) || !Array.isArray(spaces)) return null;
  return { notes, spaces, tasks, modifiedAt: metadata.modifiedAt };
}

async function readLatestSnapshot(database) {
  if (!database.objectStoreNames.contains('snapshots')) return null;
  const transaction = database.transaction('snapshots', 'readonly');
  const completed = transactionDone(transaction);
  const snapshots = await databaseRequest(transaction.objectStore('snapshots').index('created').getAll());
  await completed;
  return snapshots.sort((left, right) => new Date(right.created) - new Date(left.created))[0]?.state || null;
}

async function readLegacyDurableState(database) {
  const transaction = database.transaction('notebook', 'readonly');
  const completed = transactionDone(transaction);
  const durable = await databaseRequest(transaction.objectStore('notebook').get('current'));
  await completed;
  return durable;
}

async function hydrateDurableState() {
  try {
    const database = await openDatabase();
    let durable = await readNormalizedState(database);
    let migrated = false;
    if (!durable || !durable.spaces?.length) {
      const recovered = await readLatestSnapshot(database);
      durable = recovered || await readLegacyDurableState(database);
      migrated = Boolean(durable?.notes && durable?.spaces);
    }
    if (durable?.notes && durable?.spaces) {
      durable.tasks = Array.isArray(durable.tasks) ? durable.tasks : [];
      const durableTime = new Date(durable.modifiedAt || 0).getTime();
      const currentTime = new Date(state.modifiedAt || 0).getTime();
      if (durableTime > currentTime) {
        state = durable;
        selectedId = state.notes.find((note) => note.id === selectedId)?.id || state.notes[0]?.id || null;
        render();
        toast('Notebook recovered');
      }
      if (migrated) {
        await enqueueDurableWrite(structuredClone(durable));
        toast('Notebook storage upgraded');
      } else {
        rememberDurableState(durable);
        if (currentTime > durableTime) await enqueueDurableWrite(structuredClone(state));
      }
    } else {
      await enqueueDurableWrite(structuredClone(state));
    }
  } catch (error) {
    showSaveFailure(error, true);
  }
}

function showSaveFailure(error, duringOpen = false) {
  const saveState = $('#save-state');
  saveState.classList.remove('saving');
  saveState.classList.add('save-error');
  const quota = error?.name === 'QuotaExceededError';
  saveState.lastChild.textContent = quota ? ' Storage full' : ' Save needs attention';
  if (!saveFailureNotified) {
    toast(quota ? 'Storage is full. Download a backup before continuing.' : duringOpen ? 'Local storage could not be opened. Download a backup to protect your notes.' : 'Changes could not be saved. Download a backup before closing Jotfield.');
    saveFailureNotified = true;
  }
}

function persist() {
  const saveState = $('#save-state');
  saveState.classList.remove('save-error');
  saveState.removeAttribute('title');
  saveState.classList.add('saving');
  saveState.lastChild.textContent = ' Saving';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const generation = ++saveGeneration;
    state.modifiedAt = now();
    const snapshot = structuredClone(state);
    const note = currentNote();
    const revision = note ? { id: `${note.id}-${Math.floor(Date.now() / REVISION_WINDOW)}`, noteId: note.id, created: now(), note: structuredClone(note) } : null;
    let browserBackupSaved = true;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch { browserBackupSaved = false; }
    deviceChannel?.postMessage(makeSyncEnvelope('notebook.changed', snapshot));
    cloudSync?.schedule();
    enqueueDurableWrite(snapshot, revision).then(() => {
      saveFailureNotified = false;
      if (generation !== saveGeneration) return;
      saveState.classList.remove('saving', 'save-error');
      saveState.removeAttribute('title');
      saveState.lastChild.textContent = cloudSync?.isUnlocked() ? ' Waiting to sync' : ' Saved locally';
    }).catch((error) => {
      if (generation !== saveGeneration) return;
      showSaveFailure(error);
      if (browserBackupSaved) saveState.title = 'A browser backup exists, but durable storage needs attention.';
    });
  }, 220);
}

function applyCloudNotebook(notebook) {
  state = notebook;
  selectedId = state.notes.some((note) => note.id === selectedId) ? selectedId : state.notes[0]?.id || null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  enqueueDurableWrite(structuredClone(state)).catch((error) => showSaveFailure(error));
  render();
}

function mergeNotebook(local, incoming) {
  const newer = (first, second) => new Date(first.updated || first.created || 0) >= new Date(second.updated || second.created || 0) ? first : second;
  const mergeItems = (left = [], right = []) => {
    const items = new Map(left.map((item) => [item.id, item]));
    right.forEach((item) => items.set(item.id, items.has(item.id) ? newer(items.get(item.id), item) : item));
    return [...items.values()];
  };
  const spaces = new Map((local.spaces || []).map((space) => [space.id, space]));
  (incoming.spaces || []).forEach((space) => { if (!spaces.has(space.id)) spaces.set(space.id, space); });
  return {
    notes: mergeItems(local.notes, incoming.notes),
    tasks: mergeItems(local.tasks, incoming.tasks),
    spaces: [...spaces.values()],
    modifiedAt: new Date(local.modifiedAt || 0) >= new Date(incoming.modifiedAt || 0) ? local.modifiedAt : incoming.modifiedAt,
  };
}

deviceChannel?.addEventListener('message', (event) => {
  if (event.data?.kind !== 'notebook.changed' || !event.data.payload?.notes) return;
  state = mergeNotebook(state, event.data.payload);
  selectedId = state.notes.some((note) => note.id === selectedId) ? selectedId : state.notes[0]?.id || null;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
  enqueueDurableWrite(structuredClone(state)).catch((error) => showSaveFailure(error));
  render();
  toast('Updated from another Jotfield tab');
});

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function openBackupDialog(mode, file = null) {
  backupMode = mode;
  pendingBackupFile = file;
  const restoring = mode === 'restore';
  $('#backup-title').textContent = restoring ? 'Restore encrypted backup' : 'Download encrypted backup';
  $('#backup-description').textContent = restoring
    ? 'Enter the password used when this backup was created. Its notes will merge with this notebook.'
    : 'Choose a password for this backup. You will need it to restore the file.';
  $('#backup-file').hidden = !restoring;
  $('#backup-file').textContent = restoring ? `${file.name} · ${Math.max(1, Math.round(file.size / 1024))} KB` : '';
  $('#vault-confirm-field').hidden = restoring;
  $('#vault-passphrase').autocomplete = 'off';
  $('#backup-submit').textContent = restoring ? 'Restore backup' : 'Download backup';
  $('#backup-warning').textContent = restoring
    ? 'Existing notes are kept. When two copies match, Jotfield keeps the newer one.'
    : 'Keep this password somewhere safe. Jotfield cannot recover it.';
  $('#vault-passphrase').value = '';
  $('#vault-confirm').value = '';
  accountMessage($('#backup-message'), '');
  $('#backup-dialog').showModal();
  requestAnimationFrame(() => $('#vault-passphrase').focus());
}

function closeBackupDialog() {
  $('#backup-dialog').close();
  pendingBackupFile = null;
  $('#vault-passphrase').value = '';
  $('#vault-confirm').value = '';
  $('#vault-input').value = '';
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return base64ToBytes(base64);
}

async function compressSharePayload(bytes) {
  if (!('CompressionStream' in window)) return { bytes, compressed: false };
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return { bytes: new Uint8Array(await new Response(stream).arrayBuffer()), compressed: true };
}

async function expandSharePayload(bytes, compressed) {
  if (!compressed) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function shareableBody(html) {
  const documentBody = new DOMParser().parseFromString(html, 'text/html').body;
  documentBody.querySelectorAll('img[src^="data:"]').forEach((image) => {
    const replacement = document.createElement('p');
    replacement.textContent = `[Image omitted: ${image.alt || 'attachment'}]`;
    image.replaceWith(replacement);
  });
  return documentBody.innerHTML;
}

function safeSharedBody(html) {
  const documentBody = new DOMParser().parseFromString(html, 'text/html').body;
  documentBody.querySelectorAll('script,style,iframe,object,embed,form,video,audio').forEach((element) => element.remove());
  documentBody.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (!['href', 'src', 'alt', 'data-checked'].includes(attribute.name)) element.removeAttribute(attribute.name);
    });
    const href = element.getAttribute('href');
    if (href && !/^(https?:|mailto:)/i.test(href)) element.removeAttribute('href');
    if (href) { element.setAttribute('target', '_blank'); element.setAttribute('rel', 'noopener noreferrer'); }
    const src = element.getAttribute('src');
    if (src && !/^(https?:|data:image\/)/i.test(src)) element.removeAttribute('src');
  });
  documentBody.querySelectorAll('button').forEach((button) => {
    const marker = document.createElement('span');
    marker.textContent = button.closest('[data-checked="true"]') ? '☑ ' : '□ ';
    button.replaceWith(marker);
  });
  return documentBody.innerHTML;
}

function sharedNotePayload(note) {
  const space = state.spaces.find((item) => item.id === note.space)?.name || 'Note';
  return {
    product: 'Jotfield Shared Note',
    version: 1,
    title: note.title || 'Untitled',
    body: shareableBody(note.html || plainTextToHTML(note.body)),
    created: note.created,
    updated: note.updated,
    space,
  };
}

async function makePrivateNoteUrl(note) {
  const payload = new TextEncoder().encode(JSON.stringify(sharedNotePayload(note)));
  const packed = await compressSharePayload(payload);
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, packed.bytes));
  const fragment = [bytesToBase64Url(iv), bytesToBase64Url(cipher), bytesToBase64Url(rawKey), packed.compressed ? '1' : '0'].join('.');
  const url = `${location.origin}${location.pathname}#note=${fragment}`;
  if (url.length > 64000) throw new Error('Note too large');
  return url;
}

async function readPrivateNoteUrl() {
  if (!location.hash.startsWith('#note=')) return null;
  const parts = location.hash.slice(6).split('.');
  if (parts.length !== 4) throw new Error('Invalid shared note');
  const [ivValue, cipherValue, keyValue, compressed] = parts;
  const key = await crypto.subtle.importKey('raw', base64UrlToBytes(keyValue), { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64UrlToBytes(ivValue) }, key, base64UrlToBytes(cipherValue)));
  const expanded = await expandSharePayload(plain, compressed === '1');
  const note = JSON.parse(new TextDecoder().decode(expanded));
  if (note.product !== 'Jotfield Shared Note' || note.version !== 1) throw new Error('Invalid shared note');
  return note;
}

function noteText(note) {
  const body = new DOMParser().parseFromString(note.body || '', 'text/html').body.textContent?.trim() || '';
  return `${note.title || 'Untitled'}\n\n${body}`;
}

function plainTextHTML(text) {
  return text.split(/\n{2,}/).map((block) => `<p>${escapeHTML(block).replaceAll('\n', '<br>')}</p>`).join('');
}

function markdownHTML(markdown) {
  const lines = markdown.replace(/\r/g, '').split('\n');
  const output = [];
  let list = false;
  let code = false;
  const closeList = () => { if (list) { output.push('</ul>'); list = false; } };
  lines.forEach((line) => {
    if (/^```/.test(line)) {
      closeList();
      output.push(code ? '</code></pre>' : '<pre><code>');
      code = !code;
      return;
    }
    if (code) { output.push(`${escapeHTML(line)}\n`); return; }
    if (/^[-*] /.test(line)) {
      if (!list) { output.push('<ul>'); list = true; }
      output.push(`<li>${escapeHTML(line.slice(2))}</li>`);
      return;
    }
    closeList();
    if (/^### /.test(line)) output.push(`<h3>${escapeHTML(line.slice(4))}</h3>`);
    else if (/^## /.test(line)) output.push(`<h2>${escapeHTML(line.slice(3))}</h2>`);
    else if (/^# /.test(line)) output.push(`<h2>${escapeHTML(line.slice(2))}</h2>`);
    else if (/^> /.test(line)) output.push(`<blockquote>${escapeHTML(line.slice(2))}</blockquote>`);
    else if (line.trim()) output.push(`<p>${escapeHTML(line)}</p>`);
  });
  closeList();
  if (code) output.push('</code></pre>');
  return output.join('');
}

async function importNoteFiles(files) {
  const accepted = [...files].slice(0, 50).filter((file) => /\.(md|markdown|txt|html?)$/i.test(file.name) && file.size <= 2 * 1024 * 1024);
  if (!accepted.length) { toast('Choose Markdown, text, or HTML files under 2 MB'); return; }
  const imported = [];
  for (const file of accepted) {
    const raw = await file.text();
    const extension = file.name.split('.').pop().toLowerCase();
    const html = ['html', 'htm'].includes(extension) ? safeSharedBody(raw) : ['md', 'markdown'].includes(extension) ? markdownHTML(raw) : plainTextHTML(raw);
    const body = new DOMParser().parseFromString(html, 'text/html').body.textContent?.trim() || '';
    imported.push({ id: uid(), title: file.name.replace(/\.[^.]+$/, '').slice(0, 120), body, html, space: 'personal', favorite: false, archived: false, deleted: false, daily: false, day: null, created: now(), updated: new Date(file.lastModified || Date.now()).toISOString() });
  }
  state.notes.unshift(...imported);
  selectedId = imported[0].id;
  currentView = 'all'; currentSpace = null; currentTag = null; currentSmart = null;
  persist(); render();
  $('#settings-dialog').close();
  toast(`${imported.length} ${imported.length === 1 ? 'note' : 'notes'} imported`);
}

function openCapture(data) {
  $('#capture-title').value = (data.title || 'Web capture').slice(0, 160);
  $('#capture-text').value = (data.text || '').slice(0, 20000);
  $('#capture-url').value = /^https?:\/\//i.test(data.url || '') ? data.url : '';
  if (!$('#capture-dialog').open) $('#capture-dialog').showModal();
  requestAnimationFrame(() => $('#capture-title').focus());
}

async function handleLaunchIntent() {
  const query = new URLSearchParams(location.search);
  if (location.hash.startsWith('#clip=')) {
    try {
      const data = JSON.parse(new TextDecoder().decode(base64UrlToBytes(location.hash.slice(6))));
      openCapture(data);
      history.replaceState(null, '', location.pathname);
    } catch { toast('This web capture is not valid'); }
    return;
  }
  if (query.get('capture') === 'pending') {
    try {
      const response = await fetch('./pending-share');
      if (!response.ok) throw new Error('Missing shared content');
      openCapture(await response.json());
      const keys = await caches.keys();
      await Promise.all(keys.map(async (key) => (await caches.open(key)).delete('./pending-share')));
    } catch { toast('Shared content could not be opened'); }
    history.replaceState(null, '', location.pathname);
  } else if (query.get('capture') === '1') {
    openCapture({ title: query.get('title'), text: query.get('text'), url: query.get('url') });
    history.replaceState(null, '', location.pathname);
  } else if (query.get('quick') === '1') {
    $('#quick-dialog').showModal();
    history.replaceState(null, '', location.pathname);
    requestAnimationFrame(() => $('#quick-input').focus());
  } else if (query.get('new') === '1') {
    history.replaceState(null, '', location.pathname);
    createNote();
  }
}

function webClipperCode() {
  const base = `${location.origin}${location.pathname}`;
  return `javascript:(()=>{const d={title:document.title,text:String(getSelection()).slice(0,6000),url:location.href};const b=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(d)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/g,'');open('${base}#clip='+b,'_blank')})()`;
}

function calendarDate(value) {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function calendarText(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
}

function foldCalendarLine(line) {
  const rows = [];
  let row = '';
  for (const character of line) {
    const prefix = rows.length ? ' ' : '';
    if (new TextEncoder().encode(`${prefix}${row}${character}`).length > 74) {
      rows.push(`${prefix}${row}`);
      row = character;
    } else row += character;
  }
  rows.push(`${rows.length ? ' ' : ''}${row}`);
  return rows.join('\r\n');
}

function exportTaskCalendar() {
  const tasks = state.tasks.filter((task) => !task.completed && task.due);
  if (!tasks.length) { toast('No scheduled tasks to export'); return; }
  const stamp = calendarDate(now());
  const events = tasks.flatMap((task) => {
    const start = new Date(task.due);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const repeat = task.repeat === 'daily' ? 'RRULE:FREQ=DAILY' : task.repeat === 'weekly' ? 'RRULE:FREQ=WEEKLY' : task.repeat === 'monthly' ? 'RRULE:FREQ=MONTHLY' : null;
    return ['BEGIN:VEVENT', `UID:${task.id}@jotfield.local`, `DTSTAMP:${stamp}`, `DTSTART:${calendarDate(start)}`, `DTEND:${calendarDate(end)}`, `SUMMARY:${calendarText(task.title)}`, ...(repeat ? [repeat] : []), 'END:VEVENT'];
  });
  const calendar = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Jotfield//Tasks//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].map(foldCalendarLine).join('\r\n');
  const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'jotfield-tasks.ics'; anchor.click(); URL.revokeObjectURL(url);
  toast(`${tasks.length} scheduled ${tasks.length === 1 ? 'task' : 'tasks'} exported`);
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return; }
    catch {}
  }
  const area = document.createElement('textarea');
  area.value = value; area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.append(area); area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) throw new Error('Copy unavailable');
}

async function openShareDialog() {
  const note = currentNote();
  if (!note) return;
  $('#share-title').textContent = note.title || 'Untitled';
  $('#share-space').textContent = state.spaces.find((space) => space.id === note.space)?.name || 'Note';
  $('#share-summary').textContent = cleanPreview(note.body).slice(0, 150) || 'Empty note';
  const livePanel = $('#live-share-panel');
  livePanel.hidden = !cloudReady || !accountSession;
  if (!livePanel.hidden) renderLiveShare(note);
  $('#share-status').textContent = 'Preparing an encrypted copy...';
  $('#share-dialog').showModal();
  try {
    lastShareUrl = note.liveShare
      ? liveShareUrl(note.liveShare.id, note.liveShare.key)
      : await makePrivateNoteUrl(note);
    $('#share-status').textContent = note.liveShare
      ? 'This link shows the last update you shared.'
      : 'Changes made later will not alter the shared copy.';
  } catch {
    lastShareUrl = '';
    $('#share-status').textContent = 'This note is too large for a link. Download the Markdown copy instead.';
  }
}

function liveShareExpiry(days = Number($('#live-share-expiry').value || 7)) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

function renderLiveShare(note = currentNote()) {
  const share = note?.liveShare;
  $('#live-share-create').textContent = share ? 'Update live link' : 'Create live link';
  $('#native-share-label').textContent = share ? 'Share live link' : 'Share private link';
  $('#copy-share-label').textContent = share ? 'Copy live link' : 'Copy link';
  $('#live-share-revoke').hidden = !share;
  $('#live-share-status').textContent = share
    ? `Available until ${new Date(share.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'The link can be updated or turned off later.';
}

async function saveLiveShare() {
  const note = currentNote();
  if (!note || !accountSession) return;
  const updating = Boolean(note.liveShare);
  const button = $('#live-share-create');
  button.disabled = true;
  $('#live-share-status').textContent = updating ? 'Updating encrypted link...' : 'Creating encrypted link...';
  try {
    const expiresAt = liveShareExpiry();
    note.liveShare = updating
      ? await updateLiveShare(cloudClientPromise, note.liveShare, sharedNotePayload(note), expiresAt)
      : await createLiveShare(cloudClientPromise, sharedNotePayload(note), expiresAt);
    note.updated = now();
    persist();
    lastShareUrl = liveShareUrl(note.liveShare.id, note.liveShare.key);
    $('#share-status').textContent = 'This link shows the last update you shared.';
    await copyText(lastShareUrl);
    renderLiveShare(note);
    toast(updating ? 'Live private link updated and copied' : 'Live private link created and copied');
  } catch (error) {
    $('#live-share-status').textContent = error.message || 'Live sharing needs attention.';
  } finally {
    button.disabled = false;
  }
}

async function stopLiveShare() {
  const note = currentNote();
  if (!note?.liveShare) return;
  const button = $('#live-share-revoke');
  button.disabled = true;
  $('#live-share-status').textContent = 'Turning off link...';
  try {
    await revokeLiveShare(cloudClientPromise, note.liveShare.id);
    delete note.liveShare;
    note.updated = now();
    persist();
    lastShareUrl = await makePrivateNoteUrl(note);
    renderLiveShare(note);
    $('#share-status').textContent = 'Changes made later will not alter the shared copy.';
    toast('Live link turned off');
  } catch (error) {
    $('#live-share-status').textContent = error.message || 'Could not turn off the link.';
  } finally {
    button.disabled = false;
  }
}

async function showSharedNote() {
  try {
    const live = readLiveShareFragment();
    const note = live
      ? await readLiveShare(cloudClientPromise, live.id, live.key)
      : await readPrivateNoteUrl();
    if (!note) return;
    openedSharedNote = note;
    $('#shared-note-date').textContent = new Date(note.updated || note.created).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    $('#shared-note-title').textContent = note.title || 'Untitled';
    $('#shared-note-body').innerHTML = safeSharedBody(note.body || '');
    $('#shared-note-kind').textContent = live ? 'Live private note' : 'Private read-only copy';
    $('#shared-note-dialog').showModal();
  } catch (error) {
    toast(error.message === 'This private link has expired or was turned off' ? error.message : 'This private note link is not valid');
  }
}

function currentNote() {
  return state.notes.find((note) => note.id === selectedId);
}

function spaceFor(note) {
  return state.spaces.find((space) => space.id === note?.space) || state.spaces[0];
}

function extractTags(note) {
  return [...new Set((`${note.title} ${note.body}`.match(/#[\p{L}\p{N}_-]+/gu) || []).map((tag) => tag.slice(1).toLowerCase()))];
}

function linkedTitles(note) {
  return [...(note?.body.matchAll(/\[\[([^\]]+)\]\]/g) || [])].map((match) => match[1].trim().toLowerCase());
}

function noteHasOpenTasks(note) {
  if (note.html) return /class="task-list"[\s\S]*?data-checked="false"/.test(note.html);
  return /(^|\n)\s*\[ \]/m.test(note.body);
}

function noteHasAttachments(note) {
  return /class="(?:attachment|file-attachment)"/.test(note.html || '');
}

function noteIsLinked(note) {
  const title = note.title.trim().toLowerCase();
  return linkedTitles(note).length > 0 || state.notes.some((candidate) => candidate.id !== note.id && linkedTitles(candidate).includes(title));
}

function relativeTime(value) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.floor(minutes / 1440)}d`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function cleanPreview(body) {
  return body.replace(/\[\[|\]\]|[#*_`>-]/g, '').replace(/\s+/g, ' ').trim() || 'Empty note';
}

function escapeHTML(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[character]));
}

function plainTextToHTML(value) {
  if (!value) return '<p><br></p>';
  return value.split(/\n{2,}/).map((paragraph) => `<p>${escapeHTML(paragraph).replace(/\n/g, '<br>')}</p>`).join('');
}

function editorPlainText() {
  return editorText().replace(/\n{3,}/g, '\n\n').trimEnd();
}

function saveRichEditor() {
  const note = currentNote();
  if (!note) return;
  note.html = editorHTML();
  note.body = editorPlainText();
  note.updated = now();
  persist();
  renderList();
  renderNav();
  renderInlineTags(note);
  updateWordCount(note);
  $('#edited-time').textContent = 'Edited now';
}

function visibleNotes() {
  return state.notes
    .filter((note) => {
      if (currentSpace && note.space !== currentSpace) return false;
      if (currentTag && !extractTags(note).includes(currentTag)) return false;
      if (currentSmart === 'unlinked' && noteIsLinked(note)) return false;
      if (currentSmart === 'tasks' && !noteHasOpenTasks(note)) return false;
      if (currentSmart === 'attachments' && !noteHasAttachments(note)) return false;
      if (currentView === 'trash') return note.deleted;
      if (note.deleted) return false;
      if (currentView === 'archive') return note.archived;
      if (note.archived) return false;
      if (currentView === 'favorites') return note.favorite;
      if (currentView === 'daily') return note.daily;
      if (currentView === 'now') {
        const age = Date.now() - new Date(note.updated).getTime();
        return note.favorite || note.daily && note.day === todayKey() || age < 86400000;
      }
      return true;
    })
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || new Date(b.updated) - new Date(a.updated));
}

function render() {
  renderNav();
  renderDays();
  renderList();
  renderEditor();
}

function renderNav() {
  const live = state.notes.filter((note) => !note.deleted && !note.archived);
  $('#count-all').textContent = live.length;
  $('#count-now').textContent = live.filter((note) => note.favorite || note.daily && note.day === todayKey() || Date.now() - new Date(note.updated) < 86400000).length;
  $('#count-favorites').textContent = live.filter((note) => note.favorite).length;
  $('#count-unlinked').textContent = live.filter((note) => !noteIsLinked(note)).length;
  $('#count-tasks').textContent = live.filter(noteHasOpenTasks).length;
  $('#count-attachments').textContent = live.filter(noteHasAttachments).length;
  $('#count-due').textContent = state.tasks.filter((task) => !task.completed && task.due && new Date(task.due) < new Date(startOfDay().getTime() + 86400000)).length;
  $('#storage-count').textContent = `${state.notes.length} ${state.notes.length === 1 ? 'note' : 'notes'}`;

  $('#space-list').replaceChildren(...state.spaces.map((space) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `space-item${currentSpace === space.id ? ' active' : ''}`;
    button.dataset.space = space.id;
    const dot = document.createElement('i');
    dot.className = 'space-dot';
    dot.style.color = space.color;
    dot.style.background = space.color;
    const label = document.createElement('span');
    label.textContent = space.name;
    button.append(dot, label);
    return button;
  }));

  const tags = [...new Set(state.notes.filter((note) => !note.deleted).flatMap(extractTags))].sort();
  $('#tag-list').replaceChildren(...tags.slice(0, 12).map((tag) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tag-chip${currentTag === tag ? ' active' : ''}`;
    button.dataset.tag = tag;
    button.textContent = `#${tag}`;
    return button;
  }));

  $$('.rail-item[data-view]').forEach((button) => button.classList.toggle('active', !currentSpace && !currentTag && button.dataset.view === currentView));
  $$('[data-smart]').forEach((button) => button.classList.toggle('active', button.dataset.smart === currentSmart));
}

function renderDays() {
  const formatter = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
  const days = [];
  for (let offset = -3; offset <= 3; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `day-button${offset === 0 ? ' today' : ''}`;
    button.dataset.day = todayKey(date);
    const day = document.createElement('span');
    day.textContent = formatter.format(date);
    const number = document.createElement('b');
    number.textContent = date.getDate();
    button.append(day, number);
    days.push(button);
  }
  $('#day-strip').replaceChildren(...days);
}

function viewName() {
  if (currentSmart) return { unlinked: 'Loose thoughts', tasks: 'Open tasks', attachments: 'Attachments' }[currentSmart];
  if (currentSpace) return state.spaces.find((space) => space.id === currentSpace)?.name || 'Space';
  if (currentTag) return `#${currentTag}`;
  return { now: 'Now', all: 'All notes', favorites: 'Favorites', daily: 'Daily notes', archive: 'Archive', trash: 'Recently deleted' }[currentView];
}

function renderList() {
  const notes = visibleNotes();
  $('#view-title').textContent = viewName();
  $('#view-overline').textContent = currentSmart ? 'SMART FIELD' : currentSpace ? 'SPACE' : currentTag ? 'TAG' : currentView === 'now' ? 'TODAY' : 'LIBRARY';
  $('#note-list').className = `note-list ${layout}`;
  $('#empty-list').hidden = notes.length > 0;
  $('#note-list').replaceChildren(...notes.map((note) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `note-card${note.id === selectedId ? ' active' : ''}`;
    card.dataset.note = note.id;
    const title = document.createElement('h2');
    title.textContent = note.title || 'Untitled';
    const preview = document.createElement('p');
    preview.textContent = cleanPreview(note.body);
    const foot = document.createElement('div');
    foot.className = 'note-card-foot';
    const dot = document.createElement('i');
    dot.style.color = spaceFor(note)?.color;
    const space = document.createElement('span');
    space.textContent = spaceFor(note)?.name || 'Notes';
    const time = document.createElement('time');
    time.textContent = relativeTime(note.updated);
    foot.append(dot, space, time);
    card.append(title, preview, foot);
    if (note.favorite) {
      const star = document.createElement('span');
      star.className = 'note-card-star';
      star.innerHTML = icon('star');
      card.append(star);
    }
    return card;
  }));
}

function renderEditor() {
  const note = currentNote();
  $('#editor-empty').hidden = Boolean(note);
  $('#editor-document').hidden = !note;
  if (!note) return;
  const space = spaceFor(note);
  $('#editor-path').replaceChildren();
  const first = document.createElement('span');
  first.textContent = space?.name || 'Notes';
  const divider = document.createElement('span');
  divider.textContent = '/';
  const second = document.createElement('span');
  second.textContent = note.title || 'Untitled';
  $('#editor-path').append(first, divider, second);
  $('#note-date').textContent = new Date(note.created).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if ($('#title-input') !== document.activeElement) $('#title-input').value = note.title;
  loadEditorDocument(note.id, note.html || plainTextToHTML(note.body));
  $('#favorite-button').classList.toggle('active', note.favorite);
  $('#favorite-button').querySelector('svg').style.fill = note.favorite ? 'rgba(255,92,53,.18)' : '';
  renderInlineTags(note);
  updateWordCount(note);
  $('#edited-time').textContent = `Edited ${relativeTime(note.updated)}`;
}

function renderInlineTags(note) {
  $('#note-tags').replaceChildren(...extractTags(note).map((tag) => {
    const span = document.createElement('span');
    span.className = 'inline-tag';
    span.textContent = `#${tag}`;
    return span;
  }));
}

function renderMap() {
  const notes = state.notes.filter((note) => !note.deleted && !note.archived).slice(0, 36);
  const width = 900;
  const height = 520;
  const centerX = width / 2;
  const centerY = height / 2;
  const positions = new Map(notes.map((note, index) => {
    const selected = note.id === selectedId;
    const angle = index * 2.399963;
    const radius = selected ? 0 : 85 + Math.sqrt(index + 1) * 48;
    return [note.id, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius }];
  }));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-label', 'Map of connected notes');
  const titleLookup = new Map(notes.map((note) => [note.title.trim().toLowerCase(), note]));
  const edges = new Set();
  notes.forEach((note) => {
    linkedTitles(note).forEach((title) => {
      const target = titleLookup.get(title);
      if (target) edges.add([note.id, target.id].sort().join('|'));
    });
    const tags = extractTags(note);
    notes.forEach((candidate) => {
      if (candidate.id !== note.id && tags.some((tag) => extractTags(candidate).includes(tag))) edges.add([note.id, candidate.id].sort().join('|'));
    });
  });
  edges.forEach((edge) => {
    const [from, to] = edge.split('|');
    const a = positions.get(from);
    const b = positions.get(to);
    if (!a || !b) return;
    const line = document.createElementNS(svg.namespaceURI, 'line');
    line.setAttribute('x1', a.x); line.setAttribute('y1', a.y); line.setAttribute('x2', b.x); line.setAttribute('y2', b.y);
    line.setAttribute('class', 'map-edge');
    svg.append(line);
  });
  notes.forEach((note) => {
    const point = positions.get(note.id);
    const group = document.createElementNS(svg.namespaceURI, 'g');
    group.setAttribute('class', `map-node${note.id === selectedId ? ' selected' : ''}`);
    group.dataset.note = note.id;
    group.setAttribute('tabindex', '0');
    group.setAttribute('role', 'button');
    const circle = document.createElementNS(svg.namespaceURI, 'circle');
    circle.setAttribute('cx', point.x); circle.setAttribute('cy', point.y); circle.setAttribute('r', note.id === selectedId ? 14 : 9);
    circle.style.setProperty('--node-color', spaceFor(note)?.color || '#ff5c35');
    const label = document.createElementNS(svg.namespaceURI, 'text');
    label.setAttribute('x', point.x + 16); label.setAttribute('y', point.y + 4);
    label.textContent = (note.title || 'Untitled').slice(0, 24);
    group.append(circle, label);
    svg.append(group);
  });
  $('#map-stage').replaceChildren(svg);
}

function openMap() {
  renderMap();
  $('#map-dialog').showModal();
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseTaskLanguage(value) {
  let title = value.trim();
  const due = new Date();
  due.setSeconds(0, 0);
  let hasDate = false;
  let repeat = 'none';
  if (/\bevery day\b/i.test(title)) repeat = 'daily';
  if (/\bevery week\b/i.test(title)) repeat = 'weekly';
  if (/\bevery month\b/i.test(title)) repeat = 'monthly';
  if (/\btomorrow\b/i.test(title)) { due.setDate(due.getDate() + 1); hasDate = true; }
  else if (/\btoday\b/i.test(title)) hasDate = true;
  const weekday = title.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (weekday) {
    const target = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(weekday[1].toLowerCase());
    let distance = (target - due.getDay() + 7) % 7 || 7;
    due.setDate(due.getDate() + distance);
    hasDate = true;
  }
  const time = title.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (time) {
    let hour = Number(time[1]);
    const minute = Number(time[2] || 0);
    if (time[3]?.toLowerCase() === 'pm' && hour < 12) hour += 12;
    if (time[3]?.toLowerCase() === 'am' && hour === 12) hour = 0;
    due.setHours(hour, minute, 0, 0);
    hasDate = true;
  } else if (hasDate) due.setHours(9, 0, 0, 0);
  title = title.replace(/\b(?:today|tomorrow|(?:next\s+)?(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|every\s+(?:day|week|month)|at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi, '').replace(/\s{2,}/g, ' ').trim();
  return { title: title || value.trim(), due: hasDate ? due.toISOString() : null, repeat };
}

function taskDueLabel(task) {
  if (!task.due) return 'Anytime';
  const due = new Date(task.due);
  const today = startOfDay();
  const distance = Math.round((startOfDay(due) - today) / 86400000);
  const day = distance === 0 ? 'Today' : distance === 1 ? 'Tomorrow' : distance === -1 ? 'Yesterday' : due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${day} · ${due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

function advanceRecurringTask(task) {
  const due = new Date(task.due || now());
  do {
    if (task.repeat === 'daily') due.setDate(due.getDate() + 1);
    if (task.repeat === 'weekly') due.setDate(due.getDate() + 7);
    if (task.repeat === 'monthly') due.setMonth(due.getMonth() + 1);
  } while (due <= new Date());
  task.due = due.toISOString();
  task.completed = false;
}

function renderPlanner() {
  const body = $('#planner-body');
  body.replaceChildren();
  if (planView === 'calendar') {
    const calendar = document.createElement('section');
    calendar.className = 'month-view';
    const head = document.createElement('div');
    head.className = 'month-head';
    const previous = document.createElement('button'); previous.type = 'button'; previous.dataset.monthMove = '-1'; previous.textContent = '‹';
    const title = document.createElement('strong'); title.textContent = planMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const next = document.createElement('button'); next.type = 'button'; next.dataset.monthMove = '1'; next.textContent = '›';
    head.append(previous, title, next);
    const grid = document.createElement('div');
    grid.className = 'month-grid';
    ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((name) => { const label = document.createElement('span'); label.className = 'month-weekday'; label.textContent = name; grid.append(label); });
    const first = new Date(planMonth); first.setDate(1 - first.getDay());
    for (let index = 0; index < 42; index += 1) {
      const day = new Date(first); day.setDate(first.getDate() + index);
      const cell = document.createElement('button'); cell.type = 'button'; cell.className = `month-day${day.getMonth() !== planMonth.getMonth() ? ' muted' : ''}${todayKey(day) === todayKey() ? ' today' : ''}`;
      cell.dataset.calendarDay = todayKey(day);
      const number = document.createElement('b'); number.textContent = day.getDate(); cell.append(number);
      const count = state.tasks.filter((task) => !task.completed && task.due && todayKey(new Date(task.due)) === todayKey(day)).length;
      if (count) { const dots = document.createElement('i'); dots.textContent = `${count}`; cell.append(dots); }
      grid.append(cell);
    }
    calendar.append(head, grid); body.append(calendar); return;
  }
  const tasks = [...state.tasks].sort((a, b) => Number(a.completed) - Number(b.completed) || (a.due ? new Date(a.due) : Infinity) - (b.due ? new Date(b.due) : Infinity));
  const groups = [
    ['Overdue', (task) => !task.completed && task.due && new Date(task.due) < startOfDay()],
    ['Today', (task) => !task.completed && task.due && todayKey(new Date(task.due)) === todayKey()],
    ['Upcoming', (task) => !task.completed && task.due && new Date(task.due) >= new Date(startOfDay().getTime() + 86400000)],
    ['Anytime', (task) => !task.completed && !task.due],
    ['Completed', (task) => task.completed],
  ];
  groups.forEach(([name, predicate]) => {
    const matches = tasks.filter(predicate);
    if (!matches.length) return;
    const section = document.createElement('section'); section.className = 'task-group';
    const heading = document.createElement('h3'); heading.textContent = name; section.append(heading);
    matches.forEach((task) => {
      const row = document.createElement('div'); row.className = `task-row${task.completed ? ' completed' : ''}`; row.dataset.task = task.id;
      const check = document.createElement('button'); check.type = 'button'; check.className = 'plan-check'; check.dataset.completeTask = task.id; check.setAttribute('aria-label', task.completed ? 'Restore task' : 'Complete task');
      const copy = document.createElement('div'); const title = document.createElement('strong'); title.textContent = task.title;
      const meta = document.createElement('span'); meta.textContent = taskDueLabel(task);
      if (task.repeat !== 'none') { const repeat = document.createElement('em'); repeat.textContent = ` · ${task.repeat}`; meta.append(repeat); }
      copy.append(title, meta);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'task-remove'; remove.dataset.removeTask = task.id; remove.setAttribute('aria-label', 'Remove task'); remove.textContent = '×';
      row.append(check, copy, remove); section.append(row);
    });
    body.append(section);
  });
  if (!tasks.length) {
    const empty = document.createElement('div'); empty.className = 'planner-empty'; empty.innerHTML = `${icon('check')}<strong>Your field is clear</strong><span>Add the next thing worth doing.</span>`; body.append(empty);
  }
}

function openPlanner(date = null) {
  planView = 'agenda';
  $$('[data-plan-view]').forEach((button) => button.classList.toggle('active', button.dataset.planView === planView));
  if (date) $('#task-date').value = `${date}T09:00`;
  renderPlanner();
  $('#planner-dialog').showModal();
  requestAnimationFrame(() => $('#task-title').focus());
}

function scheduleReminderCheck() {
  const due = state.tasks.filter((task) => !task.completed && task.due && !task.notified && new Date(task.due) <= new Date());
  due.forEach((task) => {
    task.notified = true;
    if ('Notification' in window && Notification.permission === 'granted') new Notification(task.title, { body: 'Due in Jotfield', icon: './jotfield-icon.svg' });
  });
  if (due.length) persist();
}

function updateWordCount(note) {
  const words = note.body.trim() ? note.body.trim().split(/\s+/).length : 0;
  $('#word-count').textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  const characters = note.body.length;
  $('#character-count').textContent = `${characters} ${characters === 1 ? 'character' : 'characters'}`;
  $('#reading-time').textContent = `${words ? Math.max(1, Math.ceil(words / 220)) : 0} min read`;
}

function selectNote(id, focus = false) {
  transitionView('note-open', () => {
    selectedId = id;
    render();
    $('#editor').classList.add('mobile-open');
  }).then(() => {
    if (focus) requestAnimationFrame(() => ($('#title-input').value ? focusEditor() : $('#title-input').focus()));
  });
}

function createNote(options = {}) {
  const space = options.space || currentSpace || state.spaces[0]?.id || 'personal';
  const note = {
    id: uid(), title: options.title || '', body: options.body || '', html: options.html || '', space,
    favorite: false, archived: false, deleted: false, daily: Boolean(options.daily),
    day: options.day || null, created: now(), updated: now(),
  };
  state.notes.unshift(note);
  currentView = note.daily ? 'daily' : 'all';
  currentSpace = null;
  currentTag = null;
  currentSmart = null;
  selectedId = note.id;
  persist();
  render();
  $('#editor').classList.add('mobile-open');
  requestAnimationFrame(() => $('#title-input').focus());
}

function openDaily(day) {
  let note = state.notes.find((item) => item.daily && item.day === day && !item.deleted);
  if (!note) {
    const date = new Date(`${day}T12:00:00`);
    createNote({ daily: true, day, title: date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), body: 'Today\n\nOne clear priority:\n\nWhat I noticed:\n\n#daily' });
    note = currentNote();
  }
  currentView = 'daily';
  currentSpace = null;
  currentTag = null;
  currentSmart = null;
  selectNote(note.id, true);
}

function updateSelected(field, value) {
  const note = currentNote();
  if (!note) return;
  note[field] = value;
  note.updated = now();
  persist();
  renderList();
  renderNav();
  renderInlineTags(note);
  updateWordCount(note);
  $('#editor-path').lastChild.textContent = note.title || 'Untitled';
  $('#edited-time').textContent = 'Edited now';
}

function runEditorCommand(command, value = null) {
  const aliases = { insertUnorderedList: 'bullet', formatBlock: value, createLink: 'link', undo: 'undo', redo: 'redo' };
  runEditorAction(aliases[command] || command, command === 'createLink' ? value : null);
}

function insertChecklist() {
  insertEditorChecklist();
}

function positionFloatingToolbar(element, context) {
  if (!context?.rect) { element.hidden = true; return; }
  const start = context.rect.start;
  const end = context.rect.end;
  element.hidden = false;
  requestAnimationFrame(() => {
    const width = element.offsetWidth;
    const x = Math.max(10, Math.min(innerWidth - width - 10, ((start.left + end.right) / 2) - width / 2));
    const y = Math.max(10, start.top - element.offsetHeight - 10);
    element.style.left = `${x}px`;
    element.style.top = `${y}px`;
  });
}

function updateSelectionTools(context) {
  const selectionToolbar = $('#selection-toolbar');
  const imageToolbar = $('#image-toolbar');
  if (context?.image) {
    selectionToolbar.hidden = true;
    positionFloatingToolbar(imageToolbar, context);
    return;
  }
  imageToolbar.hidden = true;
  if (context?.empty) { selectionToolbar.hidden = true; return; }
  positionFloatingToolbar(selectionToolbar, context);
}

function openFindReplace() {
  if (!currentNote()) return;
  $('#find-dialog').showModal();
  requestAnimationFrame(() => { $('#find-input').focus(); $('#find-input').select(); });
}

function findOptions(direction = 1) {
  return { direction, caseSensitive: $('#find-case').checked, focus: false };
}

function findEditorText(direction = 1) {
  const query = $('#find-input').value;
  const result = findInEditor(query, findOptions(direction));
  $('#find-count').textContent = result.count ? `${result.index + 1} of ${result.count} matches` : query ? 'No matches' : 'Enter text to search';
  return result;
}

function printCurrentNote() {
  if (!currentNote()) return;
  document.documentElement.classList.add('printing-note');
  window.print();
  setTimeout(() => document.documentElement.classList.remove('printing-note'), 500);
}

function insertLink() {
  const address = window.prompt('Paste a web address');
  if (!address) return;
  const safeAddress = /^https?:\/\//i.test(address) ? address : `https://${address}`;
  runEditorAction('link', safeAddress);
}

function insertAttachment(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast('Attachments must be smaller than 10 MB');
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    insertAttachmentNode(file, reader.result);
    toast('Attachment added');
  });
  reader.readAsDataURL(file);
}

function showSlashMenu() {
  const menu = $('#slash-menu');
  const editorRect = $('#body-input').getBoundingClientRect();
  menu.hidden = false;
  menu.style.left = `${Math.min(editorRect.left + 14, innerWidth - 290)}px`;
  menu.style.top = `${Math.min(editorRect.top + 52, innerHeight - 310)}px`;
}

function closeSlashMenu() {
  $('#slash-menu').hidden = true;
}

function applySlashAction(action) {
  deleteSlashTrigger();
  if (action === 'h1') runEditorAction('h1');
  if (action === 'h2') runEditorCommand('formatBlock', 'h2');
  if (action === 'h3') runEditorAction('h3');
  if (action === 'ul') runEditorCommand('insertUnorderedList');
  if (action === 'ol') runEditorAction('ordered');
  if (action === 'check') insertChecklist();
  if (action === 'quote') runEditorCommand('formatBlock', 'blockquote');
  if (action === 'code') runEditorCommand('formatBlock', 'pre');
  if (action === 'divider') runEditorAction('divider');
  if (action === 'table') insertTable();
  closeSlashMenu();
}

function toast(message) {
  const item = document.createElement('div');
  item.className = 'toast';
  item.textContent = message;
  $('#toast-region').append(item);
  setTimeout(() => item.remove(), 2600);
}

function setView(view) {
  currentView = view;
  currentSpace = null;
  currentTag = null;
  currentSmart = null;
  const notes = visibleNotes();
  if (!notes.some((note) => note.id === selectedId)) selectedId = notes[0]?.id || null;
  render();
}

function openCommand(query = '') {
  if (!$('#command-dialog').open) $('#command-dialog').showModal();
  $('#command-input').value = query;
  commandIndex = 0;
  renderCommand(query);
  requestAnimationFrame(() => $('#command-input').focus());
}

function searchRecord(note) {
  return {
    note,
    title: note.title || 'Untitled',
    body: note.body || '',
    tags: extractTags(note).join(' '),
    space: spaceFor(note)?.name || '',
  };
}

function getRetrievalIndex() {
  const signature = state.notes.map((note) => `${note.id}:${note.updated}:${note.deleted}`).join('|');
  if (retrievalIndex?.signature === signature) return retrievalIndex;
  const records = new Map();
  const tokens = new Map();
  state.notes.filter((note) => !note.deleted).forEach((note) => {
    const record = searchRecord(note);
    records.set(note.id, record);
    const words = `${record.title} ${record.body} ${record.tags} ${record.space}`.toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || [];
    new Set(words).forEach((word) => {
      if (!tokens.has(word)) tokens.set(word, new Set());
      tokens.get(word).add(note.id);
    });
  });
  retrievalIndex = { signature, records, tokens };
  return retrievalIndex;
}

function searchNotes(query) {
  const needle = query.trim().toLocaleLowerCase();
  const queryTokens = needle.split(/\s+/).filter(Boolean);
  const weekAgo = Date.now() - 7 * 86400000;
  const index = getRetrievalIndex();
  const indexedSets = queryTokens.map((token) => index.tokens.get(token)).filter(Boolean);
  const candidates = indexedSets.length ? [...indexedSets.reduce((smallest, set) => set.size < smallest.size ? set : smallest)] : [...index.records.keys()];
  return candidates.map((id) => index.records.get(id)).filter((record) => {
    if (searchScope === 'recent' && new Date(record.note.updated).getTime() < weekAgo) return false;
    if (searchScope === 'attachment' && !noteHasAttachments(record.note)) return false;
    const haystack = searchScope === 'title' ? record.title : searchScope === 'tag' ? record.tags : `${record.title} ${record.body} ${record.tags} ${record.space}`;
    return queryTokens.every((token) => haystack.toLocaleLowerCase().includes(token));
  }).map((record) => {
    const title = record.title.toLocaleLowerCase();
    const body = record.body.toLocaleLowerCase();
    let score = new Date(record.note.updated).getTime() / 1e13;
    if (!needle) score += 1;
    if (title === needle) score += 100;
    else if (title.startsWith(needle)) score += 45;
    else if (title.includes(needle)) score += 24;
    if (body.includes(needle)) score += 8;
    score += queryTokens.filter((token) => title.includes(token)).length * 9;
    return { ...record, score };
  }).sort((a, b) => b.score - a.score).slice(0, 30);
}

function highlightedFragment(text, query, limit = 120) {
  const fragment = document.createDocumentFragment();
  const needle = query.trim();
  if (!needle) {
    fragment.append(text.slice(0, limit));
    return fragment;
  }
  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) {
    fragment.append(text.slice(0, limit));
    return fragment;
  }
  const start = Math.max(0, index - 38);
  const end = Math.min(text.length, start + limit);
  if (start) fragment.append('…');
  fragment.append(text.slice(start, index));
  const mark = document.createElement('mark');
  mark.textContent = text.slice(index, index + needle.length);
  fragment.append(mark, text.slice(index + needle.length, end));
  if (end < text.length) fragment.append('…');
  return fragment;
}

function renderCommand(query) {
  const needle = query.trim().toLowerCase();
  const notes = searchNotes(query);
  commandItems = [
    ...(!needle && searchScope === 'all' ? [
      { kind: 'action', title: 'Create a new note', detail: 'Start with a blank page', icon: 'plus', action: () => createNote() },
      { kind: 'action', title: 'Open today', detail: 'Jump to the daily note', icon: 'calendar', action: () => openDaily(todayKey()) },
    ] : []),
    ...notes.map((record) => ({ kind: 'note', title: record.title, detail: cleanPreview(record.body), space: record.space, updated: record.note.updated, icon: 'notes', action: () => selectNote(record.note.id, true) })),
  ];
  commandIndex = Math.min(commandIndex, Math.max(0, commandItems.length - 1));
  const result = $('#command-results');
  result.replaceChildren();
  const label = document.createElement('div');
  label.className = 'command-section-label';
  label.textContent = needle || searchScope !== 'all' ? `${notes.length} ${notes.length === 1 ? 'match' : 'matches'}` : 'Go somewhere';
  result.append(label);
  commandItems.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `command-result${index === commandIndex ? ' selected' : ''}`;
    button.dataset.commandIndex = index;
    button.innerHTML = icon(item.icon);
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.append(highlightedFragment(item.title, query, 80));
    const detail = document.createElement('span');
    detail.append(highlightedFragment(item.detail, query));
    copy.append(title, detail);
    if (item.kind === 'note') {
      const meta = document.createElement('small');
      meta.textContent = `${item.space} · ${relativeTime(item.updated)}`;
      copy.append(meta);
    }
    button.append(copy);
    result.append(button);
  });
  if (!commandItems.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.innerHTML = `${icon('search')}<strong>No matching thoughts</strong><span>Try fewer words or another filter.</span>`;
    result.append(empty);
  }
}

function runCommand(index) {
  const item = commandItems[index];
  if (!item) return;
  $('#command-dialog').close();
  item.action();
}

function exportNotes() {
  const payload = { product: 'Jotfield', exported: now(), ...state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `jotfield-notes-${todayKey()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast('Notebook exported');
}

function downloadFile(contents, filename, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportMarkdownArchive() {
  const notes = state.notes.filter((note) => !note.deleted);
  const contents = notes.map((note) => {
    const space = state.spaces.find((item) => item.id === note.space)?.name || 'Notes';
    return `# ${note.title || 'Untitled'}\n\nSpace: ${space}\nUpdated: ${note.updated || note.created || ''}\n\n${noteText(note)}`;
  }).join('\n\n---\n\n');
  downloadFile(contents, `jotfield-markdown-${todayKey()}.md`, 'text/markdown;charset=utf-8');
  toast(`${notes.length} notes exported as Markdown`);
}

function importNotes(file) {
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.notes) || !Array.isArray(data.spaces)) throw new Error('Invalid backup');
      const incoming = { notes: data.notes, spaces: data.spaces, tasks: Array.isArray(data.tasks) ? data.tasks : [], modifiedAt: data.modifiedAt || data.exported || now() };
      state = mergeNotebook(state, incoming);
      selectedId = state.notes.find((note) => !note.deleted)?.id || state.notes[0]?.id || null;
      currentView = 'all';
      currentSpace = null;
      currentTag = null;
      currentSmart = null;
      persist();
      render();
      toast('Notebook merged safely');
    } catch {
      toast('That file is not a Jotfield backup');
    }
  });
  reader.readAsText(file);
}

function openActions() {
  const note = currentNote();
  if (!note) return;
  const actions = note.deleted
    ? [
        { value: 'restore', icon: 'restore', label: 'Restore note' },
        { value: 'delete', icon: 'trash', label: 'Delete forever', danger: true },
      ]
    : [
        { value: 'history', icon: 'clock', label: 'Version history' },
        { value: note.archived ? 'restore' : 'archive', icon: note.archived ? 'restore' : 'archive', label: note.archived ? 'Return to notes' : 'Move to archive' },
        { value: 'trash', icon: 'trash', label: 'Move to recently deleted', danger: true },
      ];
  const form = $('#action-form');
  form.replaceChildren(...actions.map((action) => {
    const button = document.createElement('button');
    button.type = 'submit';
    button.value = action.value;
    if (action.danger) button.className = 'danger';
    button.innerHTML = icon(action.icon);
    const label = document.createElement('span');
    label.textContent = action.label;
    button.append(label);
    return button;
  }));
  const cancel = document.createElement('button');
  cancel.type = 'submit';
  cancel.value = 'cancel';
  cancel.innerHTML = icon('close');
  const cancelLabel = document.createElement('span');
  cancelLabel.textContent = 'Cancel';
  cancel.append(cancelLabel);
  form.append(cancel);
  $('#action-dialog').showModal();
}

async function getNoteRevisions(noteId) {
  const database = await openDatabase();
  const transaction = database.transaction('revisions', 'readonly');
  const completed = transactionDone(transaction);
  const revisions = await databaseRequest(transaction.objectStore('revisions').index('noteId').getAll(noteId));
  await completed;
  return revisions.sort((left, right) => new Date(right.created) - new Date(left.created));
}

async function openVersionHistory() {
  const note = currentNote();
  if (!note) return;
  historyNoteId = note.id;
  $('#history-title').textContent = note.title || 'Untitled';
  const list = $('#history-list');
  list.innerHTML = '<p class="history-loading">Loading saved versions...</p>';
  $('#history-dialog').showModal();
  try {
    const revisions = await getNoteRevisions(note.id);
    list.replaceChildren();
    revisions.forEach((revision, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.revisionId = revision.id;
      const label = document.createElement('span');
      label.textContent = index === 0 ? 'Latest saved version' : new Date(revision.created).toLocaleString();
      const preview = document.createElement('small');
      preview.textContent = cleanPreview(revision.note.body || revision.note.html || '') || 'Empty note';
      button.append(label, preview);
      list.append(button);
    });
    if (!revisions.length) list.innerHTML = '<p class="history-loading">Versions appear as you edit this note.</p>';
  } catch { list.innerHTML = '<p class="history-loading">Version history could not be opened.</p>'; }
}

async function restoreRevision(revisionId) {
  const database = await openDatabase();
  const transaction = database.transaction('revisions', 'readonly');
  const completed = transactionDone(transaction);
  const revision = await databaseRequest(transaction.objectStore('revisions').get(revisionId));
  await completed;
  if (!revision?.note || revision.noteId !== historyNoteId) return;
  const index = state.notes.findIndex((note) => note.id === historyNoteId);
  if (index < 0) return;
  const current = structuredClone(state.notes[index]);
  await enqueueDurableWrite(structuredClone(state), { id: `restore-point-${Date.now()}-${historyNoteId}`, noteId: historyNoteId, created: now(), note: current });
  state.notes[index] = { ...structuredClone(revision.note), id: historyNoteId, updated: now() };
  persist();
  render();
  $('#history-dialog').close();
  toast('Saved version restored');
}

async function refreshStorageHealth(requestPersistence = false) {
  const status = $('#storage-health');
  if (!status) return;
  if (!navigator.storage) { status.textContent = 'Storage details are not available in this browser.'; return; }
  try {
    if (requestPersistence && navigator.storage.persist) await navigator.storage.persist();
    const [estimate, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted ? navigator.storage.persisted() : Promise.resolve(false),
    ]);
    const used = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const format = (bytes) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    status.textContent = `${format(used)} used${quota ? ` of ${format(quota)}` : ''}. ${persisted ? 'Protected from automatic cleanup.' : 'Browser-managed storage.'}`;
    $('#protect-storage span').textContent = persisted ? 'Storage protected' : 'Protect local notes';
    $('#protect-storage').disabled = persisted;
  } catch { status.textContent = 'Storage details could not be read.'; }
}

$('#primary-nav').addEventListener('click', (event) => {
  const button = event.target.closest('[data-view]');
  if (button) setView(button.dataset.view);
});
$('#space-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-space]');
  if (!button) return;
  currentSpace = button.dataset.space;
  currentTag = null;
  currentSmart = null;
  currentView = 'all';
  selectedId = visibleNotes()[0]?.id || null;
  render();
});
$('#tag-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (!button) return;
  currentTag = button.dataset.tag;
  currentSpace = null;
  currentSmart = null;
  currentView = 'all';
  selectedId = visibleNotes()[0]?.id || null;
  render();
});
$('#smart-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-smart]');
  if (!button) return;
  currentSmart = button.dataset.smart;
  currentSpace = null;
  currentTag = null;
  currentView = 'all';
  selectedId = visibleNotes()[0]?.id || null;
  render();
});
$('#note-list').addEventListener('click', (event) => {
  const card = event.target.closest('[data-note]');
  if (card) selectNote(card.dataset.note);
});
$('#day-strip').addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (button) openDaily(button.dataset.day);
});
$('#title-input').addEventListener('input', (event) => updateSelected('title', event.target.value));
$('#body-input').addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.metaKey && !event.ctrlKey) requestAnimationFrame(showSlashMenu);
  if (event.key === 'Escape') closeSlashMenu();
  if (event.key === 'Enter' && $('#slash-menu').hidden === false) {
    event.preventDefault();
    applySlashAction($('#slash-menu button').dataset.slash);
  }
});
$('.format-toolbar').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.editorCommand) runEditorCommand(button.dataset.editorCommand);
  if (button.dataset.blockCommand) runEditorCommand('formatBlock', button.dataset.blockCommand);
  if (button.dataset.format) runEditorAction(button.dataset.format);
  if (button.hasAttribute('data-insert-checklist')) insertChecklist();
  if (button.hasAttribute('data-insert-link')) insertLink();
  if (button.hasAttribute('data-attach')) $('#attachment-input').click();
  if (button.hasAttribute('data-insert-table')) $('#table-dialog').showModal();
  if (button.hasAttribute('data-find-replace')) openFindReplace();
  if (button.hasAttribute('data-print-note')) printCurrentNote();
});
$('#selection-toolbar').addEventListener('mousedown', (event) => event.preventDefault());
$('#selection-toolbar').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button?.dataset.format) runEditorAction(button.dataset.format);
  if (button?.hasAttribute('data-context-link')) insertLink();
});
$('#image-toolbar').addEventListener('mousedown', (event) => event.preventDefault());
$('#image-toolbar').addEventListener('click', (event) => {
  const action = event.target.closest('[data-format]')?.dataset.format;
  if (action) runEditorAction(action);
});
$('#find-input').addEventListener('input', () => findEditorText(1));
$('#find-case').addEventListener('change', () => findEditorText(1));
$('#find-next').addEventListener('click', () => findEditorText(1));
$('#find-previous').addEventListener('click', () => findEditorText(-1));
$('#replace-one').addEventListener('click', () => {
  const replaced = replaceEditorMatch($('#find-input').value, $('#replace-input').value, findOptions());
  if (replaced) toast('Match replaced');
  findEditorText(1);
});
$('#replace-all').addEventListener('click', () => {
  const count = replaceAllEditorMatches($('#find-input').value, $('#replace-input').value, findOptions());
  $('#find-count').textContent = count ? `${count} matches replaced` : 'No matches';
  if (count) toast(`${count} ${count === 1 ? 'match' : 'matches'} replaced`);
});
$('#find-dialog').addEventListener('close', focusEditor);
$('#insert-table').addEventListener('click', () => { insertTable(); $('#table-dialog').close(); toast('Table inserted'); });
$('#table-dialog').addEventListener('click', (event) => {
  const action = event.target.closest('[data-table-action]')?.dataset.tableAction;
  if (!action) return;
  const changed = runEditorAction(action);
  if (!changed) toast('Place the cursor inside a table first');
  if (action === 'deleteTable' && changed) $('#table-dialog').close();
});
window.addEventListener('afterprint', () => document.documentElement.classList.remove('printing-note'));

$('#attachment-input').addEventListener('change', (event) => {
  insertAttachment(event.target.files?.[0]);
  event.target.value = '';
});
$('#slash-menu').addEventListener('click', (event) => {
  const button = event.target.closest('[data-slash]');
  if (button) applySlashAction(button.dataset.slash);
});
$('#new-note-button').addEventListener('click', () => createNote());
$('#empty-new').addEventListener('click', () => createNote());
$('#search-trigger').addEventListener('click', () => openCommand());
$('#quick-jot-button').addEventListener('click', () => {
  $('#quick-dialog').showModal();
  requestAnimationFrame(() => $('#quick-input').focus());
});
$('#quick-close').addEventListener('click', () => $('#quick-dialog').close());
$('#quick-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('#quick-input').value.trim();
  if (!value) return;
  const [first, ...rest] = value.split('\n');
  const title = first.length <= 72 ? first : `${first.slice(0, 69)}...`;
  createNote({ title, body: rest.join('\n').trim(), space: 'personal' });
  $('#quick-input').value = '';
  $('#quick-dialog').close();
  toast('Quick Jot saved');
});
$('#quick-input').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') $('#quick-form').requestSubmit();
});
$('#planner-button').addEventListener('click', () => openPlanner());
$('#planner-close').addEventListener('click', () => $('#planner-dialog').close());
$('.planner-tabs').addEventListener('click', (event) => {
  const button = event.target.closest('[data-plan-view]');
  if (!button) return;
  planView = button.dataset.planView;
  $$('[data-plan-view]').forEach((item) => item.classList.toggle('active', item === button));
  renderPlanner();
});
$('#task-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const parsed = parseTaskLanguage($('#task-title').value);
  const manualDate = $('#task-date').value;
  const manualRepeat = $('#task-repeat').value;
  state.tasks.push({ id: uid(), title: parsed.title, due: manualDate ? new Date(manualDate).toISOString() : parsed.due, repeat: manualRepeat !== 'none' ? manualRepeat : parsed.repeat, completed: false, created: now(), updated: now(), notified: false });
  $('#task-title').value = '';
  $('#task-date').value = '';
  $('#task-repeat').value = 'none';
  persist();
  renderNav();
  renderPlanner();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
});
$('#planner-body').addEventListener('click', (event) => {
  const complete = event.target.closest('[data-complete-task]');
  const remove = event.target.closest('[data-remove-task]');
  const move = event.target.closest('[data-month-move]');
  const day = event.target.closest('[data-calendar-day]');
  if (complete) {
    const task = state.tasks.find((item) => item.id === complete.dataset.completeTask);
    if (task) {
      if (!task.completed && task.repeat !== 'none') advanceRecurringTask(task);
      else task.completed = !task.completed;
      task.updated = now();
      task.notified = false;
      persist(); renderNav(); renderPlanner();
    }
  }
  if (remove) {
    state.tasks = state.tasks.filter((task) => task.id !== remove.dataset.removeTask);
    persist(); renderNav(); renderPlanner();
  }
  if (move) {
    planMonth.setMonth(planMonth.getMonth() + Number(move.dataset.monthMove));
    planMonth = new Date(planMonth.getFullYear(), planMonth.getMonth(), 1);
    renderPlanner();
  }
  if (day) {
    $('#task-date').value = `${day.dataset.calendarDay}T09:00`;
    $('#task-title').focus();
  }
});
$('#export-button').addEventListener('click', exportNotes);
$('#import-button').addEventListener('click', () => $('#import-input').click());
$('#settings-button').addEventListener('click', () => {
  refreshStorageHealth();
  applyTheme();
  $('#settings-dialog').showModal();
});
$('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
$('#account-button').addEventListener('click', () => {
  renderAccount();
  $('#account-dialog').showModal();
  requestAnimationFrame(() => (accountSession ? $('#account-signout') : $('#account-email')).focus());
});
$('#account-close').addEventListener('click', () => $('#account-dialog').close());
$('#account-avatar').addEventListener('click', () => {
  const picker = $('#avatar-picker');
  picker.hidden = !picker.hidden;
  if (!picker.hidden) applyAvatarChoice();
});
$('.avatar-options').addEventListener('click', (event) => {
  const button = event.target.closest('[data-avatar-choice]');
  if (!button) return;
  localStorage.setItem(AVATAR_KEY, button.dataset.avatarChoice);
  applyAvatarChoice(button.dataset.avatarChoice);
  setTimeout(() => { $('#avatar-picker').hidden = true; }, 180);
});
$('#cloud-sync-unlock').addEventListener('click', async () => {
  const passphrase = $('#cloud-sync-passphrase').value;
  const confirmation = $('#cloud-sync-confirm').value;
  if (passphrase.length < 12) { $('#cloud-sync-passphrase').reportValidity(); return; }
  if (cloudSync.needsSetup() && passphrase !== confirmation) { setCloudSyncStatus('error', 'Those private sync passwords do not match.'); $('#cloud-sync-confirm').focus(); return; }
  $('#cloud-sync-unlock').disabled = true;
  try {
    await cloudSync.unlock(passphrase);
    $('#cloud-sync-passphrase').value = '';
    $('#cloud-sync-confirm').value = '';
  } catch (error) {
    setCloudSyncStatus('error', error.name === 'OperationError' ? 'That private sync password could not open this notebook.' : error.message);
  } finally { $('#cloud-sync-unlock').disabled = false; }
});
$('#cloud-sync-lock').addEventListener('click', async () => {
  await cloudSync.lock();
  $('#cloud-sync-passphrase').value = '';
  $('#cloud-sync-confirm').value = '';
});
$('#account-signin-tab').addEventListener('click', () => setAccountMode('signin'));
$('#account-create-tab').addEventListener('click', () => setAccountMode('create'));
$('#account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('#account-email').value.trim();
  const password = $('#account-password').value;
  const name = $('#account-name').value.trim();
  setAccountPending(true);
  accountMessage($('#account-message'), accountMode === 'create' ? 'Creating your account...' : 'Signing in...');
  try {
    if (accountMode === 'create') {
      const result = await createAccount(cloudClientPromise, { email, password, name });
      if (!result.session) accountMessage($('#account-message'), 'Check your email to verify this account.', 'success');
      else accountMessage($('#account-message'), 'Account created.', 'success');
    } else {
      await signInWithPassword(cloudClientPromise, email, password);
      accountMessage($('#account-message'), 'Signed in.', 'success');
    }
    $('#account-password').value = '';
  } catch (error) {
    accountMessage($('#account-message'), error.message || 'Could not complete that request.', 'error');
  } finally {
    setAccountPending(false);
  }
});
$('#account-magic').addEventListener('click', async () => {
  const email = $('#account-email').value.trim();
  if (!email || !$('#account-email').checkValidity()) { $('#account-email').reportValidity(); return; }
  setAccountPending(true);
  try {
    await sendMagicLink(cloudClientPromise, email);
    accountMessage($('#account-message'), 'Your private sign-in link is on its way.', 'success');
  } catch (error) {
    accountMessage($('#account-message'), error.message || 'Could not send the sign-in link.', 'error');
  } finally {
    setAccountPending(false);
  }
});
$('#account-recovery').addEventListener('click', async () => {
  const email = $('#account-email').value.trim();
  if (!email || !$('#account-email').checkValidity()) { $('#account-email').reportValidity(); return; }
  setAccountPending(true);
  try {
    await sendPasswordReset(cloudClientPromise, email);
    accountMessage($('#account-message'), 'Password recovery instructions were sent.', 'success');
  } catch (error) {
    accountMessage($('#account-message'), error.message || 'Could not start password recovery.', 'error');
  } finally {
    setAccountPending(false);
  }
});
$('#account-signout').addEventListener('click', async () => {
  setAccountPending(true);
  try { await signOut(cloudClientPromise); $('#account-dialog').close(); toast('Signed out on this device'); }
  catch (error) { accountMessage($('#account-home-message'), error.message || 'Could not sign out.', 'error'); }
  finally { setAccountPending(false); }
});
$('#account-signout-all').addEventListener('click', async () => {
  setAccountPending(true);
  try { await signOut(cloudClientPromise, 'global'); $('#account-dialog').close(); toast('Signed out everywhere'); }
  catch (error) { accountMessage($('#account-home-message'), error.message || 'Could not end every session.', 'error'); }
  finally { setAccountPending(false); }
});
$('#account-delete-open').addEventListener('click', () => {
  $('#delete-account-confirmation').value = '';
  $('#delete-account-dialog').showModal();
  requestAnimationFrame(() => $('#delete-account-confirmation').focus());
});
$('#delete-account-cancel').addEventListener('click', () => $('#delete-account-dialog').close());
$('#delete-account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if ($('#delete-account-confirmation').value !== 'DELETE') { toast('Type DELETE to confirm'); return; }
  const submit = event.submitter;
  submit.disabled = true;
  try {
    await deleteCloudAccount(cloudClientPromise);
    $('#delete-account-dialog').close();
    $('#account-dialog').close();
    toast('Cloud account deleted');
  } catch (error) {
    $('#delete-account-dialog').close();
    accountMessage($('#account-home-message'), error.message || 'Could not delete the account.', 'error');
  } finally {
    submit.disabled = false;
  }
});
$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('#new-password').value;
  if (password !== $('#confirm-password').value) {
    accountMessage($('#password-message'), 'The passwords do not match.', 'error');
    return;
  }
  const submit = event.submitter;
  submit.disabled = true;
  accountMessage($('#password-message'), 'Saving your new password...');
  try {
    await updatePassword(cloudClientPromise, password);
    $('#new-password').value = '';
    $('#confirm-password').value = '';
    $('#password-dialog').close();
    toast('Password updated');
  } catch (error) {
    accountMessage($('#password-message'), error.message || 'Could not update the password.', 'error');
  } finally {
    submit.disabled = false;
  }
});
$('#import-note-files').addEventListener('click', () => $('#note-files-input').click());
$('#note-files-input').addEventListener('change', async (event) => {
  await importNoteFiles(event.target.files || []);
  event.target.value = '';
});
$('#copy-clipper').addEventListener('click', async () => {
  try {
    await copyText(webClipperCode());
    $('#ecosystem-status').textContent = 'Clipper copied. Create a browser bookmark and paste it into the address field.';
    toast('Web clipper copied');
  } catch { toast('Could not copy the web clipper'); }
});
$('#export-calendar').addEventListener('click', exportTaskCalendar);
$('#export-markdown-archive').addEventListener('click', exportMarkdownArchive);
$('#protect-storage').addEventListener('click', () => refreshStorageHealth(true));
$('#capture-close').addEventListener('click', () => $('#capture-dialog').close());
$('#capture-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const title = $('#capture-title').value.trim() || 'Web capture';
  const text = $('#capture-text').value.trim();
  const source = $('#capture-url').value.trim();
  const sourceLine = /^https?:\/\//i.test(source) ? `<p><a href="${escapeHTML(source)}" target="_blank" rel="noopener">Open source</a></p>` : '';
  const body = [text, source].filter(Boolean).join('\n\n');
  $('#capture-dialog').close();
  createNote({ title, body, html: `${plainTextHTML(text)}${sourceLine}`, space: 'personal' });
  toast('Capture saved');
});
$('#vault-export').addEventListener('click', () => openBackupDialog('download'));
$('#vault-import').addEventListener('click', () => $('#vault-input').click());
$('#vault-input').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  if (file.size > MAX_BACKUP_SIZE) { toast('That backup is too large'); event.target.value = ''; return; }
  openBackupDialog('restore', file);
});
$('#backup-close').addEventListener('click', closeBackupDialog);
$('#backup-cancel').addEventListener('click', closeBackupDialog);
$('#backup-dialog').addEventListener('close', () => {
  pendingBackupFile = null;
  $('#vault-passphrase').value = '';
  $('#vault-confirm').value = '';
  $('#vault-input').value = '';
});
$('#backup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const passphrase = $('#vault-passphrase').value;
  if (passphrase.length < 12) { $('#vault-passphrase').reportValidity(); return; }
  if (backupMode === 'download' && passphrase !== $('#vault-confirm').value) {
    accountMessage($('#backup-message'), 'Those backup passwords do not match.', 'error');
    $('#vault-confirm').focus();
    return;
  }
  $('#backup-submit').disabled = true;
  try {
    if (backupMode === 'download') {
      const encrypted = await createEncryptedBackup(state, passphrase, now());
      const blob = new Blob([encrypted], { type: 'application/jotfield-vault' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `jotfield-backup-${todayKey()}.jotvault`; anchor.click();
      URL.revokeObjectURL(url);
      closeBackupDialog();
      toast('Encrypted backup downloaded');
    } else {
      const incoming = await openEncryptedBackup(pendingBackupFile, passphrase);
      incoming.tasks = Array.isArray(incoming.tasks) ? incoming.tasks : [];
      state = mergeNotebook(state, incoming);
      selectedId = state.notes.some((note) => note.id === selectedId) ? selectedId : state.notes[0]?.id || null;
      persist(); render();
      closeBackupDialog();
      $('#settings-dialog').close();
      toast('Backup restored');
    }
  } catch {
    accountMessage($('#backup-message'), backupMode === 'restore' ? 'That password or backup could not be opened.' : 'Could not create this backup.', 'error');
  } finally { $('#backup-submit').disabled = false; }
});
$('#install-button').addEventListener('click', async () => {
  if (installEvent) {
    installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    $('#install-button').hidden = true;
  } else toast('Use Add to Home Screen from your browser menu');
});
$('.appearance-picker').addEventListener('click', (event) => {
  const button = event.target.closest('[data-theme-choice]');
  if (!button) return;
  localStorage.setItem(THEME_KEY, button.dataset.themeChoice);
  applyTheme(button.dataset.themeChoice);
});
$('#import-input').addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (file) importNotes(file);
  event.target.value = '';
});
$('#favorite-button').addEventListener('click', () => {
  const note = currentNote();
  if (!note) return;
  note.favorite = !note.favorite;
  note.updated = now();
  persist();
  render();
});
$('#share-button').addEventListener('click', openShareDialog);
$('#share-close').addEventListener('click', () => $('#share-dialog').close());
$('#live-share-create').addEventListener('click', saveLiveShare);
$('#live-share-revoke').addEventListener('click', stopLiveShare);
$('#copy-share').addEventListener('click', async () => {
  if (!lastShareUrl) return;
  try { await copyText(lastShareUrl); toast('Private link copied'); }
  catch { toast('Could not copy the link'); }
});
$('#native-share').addEventListener('click', async () => {
  if (!lastShareUrl) return;
  const note = currentNote();
  const data = { title: note?.title || 'Jotfield note', text: 'A private read-only note from Jotfield', url: lastShareUrl };
  try {
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) await navigator.share(data);
    else { await copyText(lastShareUrl); toast('Private link copied'); }
  } catch (error) {
    if (error.name !== 'AbortError') toast('Could not open sharing');
  }
});
$('#download-markdown').addEventListener('click', () => {
  const note = currentNote();
  if (!note) return;
  const blob = new Blob([noteText(note)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${(note.title || 'untitled').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'note'}.md`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast('Markdown downloaded');
});
$('#shared-note-close').addEventListener('click', () => {
  $('#shared-note-dialog').close();
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  openedSharedNote = null;
});
$('#shared-note-copy').addEventListener('click', async () => {
  if (!openedSharedNote) return;
  try { await copyText(noteText(openedSharedNote)); toast('Note text copied'); }
  catch { toast('Could not copy the note'); }
});
window.addEventListener('hashchange', () => { showSharedNote(); handleLaunchIntent(); });
$('#focus-button').addEventListener('click', () => {
  $('#editor').classList.toggle('focused');
  $('#focus-button').classList.toggle('active');
});
$('#more-button').addEventListener('click', openActions);
$('#history-close').addEventListener('click', () => $('#history-dialog').close());
$('#history-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-revision-id]');
  if (button) restoreRevision(button.dataset.revisionId);
});
$('#action-dialog').addEventListener('close', () => {
  const note = currentNote();
  if (!note || $('#action-dialog').returnValue === 'cancel') return;
  if ($('#action-dialog').returnValue === 'history') { openVersionHistory(); return; }
  if ($('#action-dialog').returnValue === 'archive') {
    note.archived = true;
    note.deleted = false;
    toast('Moved to archive');
  }
  if ($('#action-dialog').returnValue === 'trash') {
    note.deleted = true;
    note.archived = false;
    toast('Moved to recently deleted');
  }
  if ($('#action-dialog').returnValue === 'restore') {
    note.deleted = false;
    note.archived = false;
    toast('Returned to notes');
  }
  if ($('#action-dialog').returnValue === 'delete') {
    state.notes = state.notes.filter((item) => item.id !== note.id);
    toast('Note deleted forever');
  }
  selectedId = visibleNotes().find((item) => item.id !== note.id)?.id || null;
  persist();
  render();
});
$('#add-space').addEventListener('click', () => {
  const name = window.prompt('Name this space');
  if (!name?.trim()) return;
  const space = { id: uid(), name: name.trim().slice(0, 40), color: SPACE_COLORS[state.spaces.length % SPACE_COLORS.length] };
  state.spaces.push(space);
  currentSpace = space.id;
  currentTag = null;
  currentSmart = null;
  persist();
  render();
});
$$('.view-switch button').forEach((button) => button.addEventListener('click', () => {
  layout = button.dataset.layout;
  $$('.view-switch button').forEach((item) => item.classList.toggle('active', item === button));
  renderList();
}));
$('#command-input').addEventListener('input', (event) => {
  commandIndex = 0;
  renderCommand(event.target.value);
});
$('#command-input').addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    commandIndex = Math.min(commandItems.length - 1, commandIndex + 1);
    renderCommand(event.currentTarget.value);
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    commandIndex = Math.max(0, commandIndex - 1);
    renderCommand(event.currentTarget.value);
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    runCommand(commandIndex);
  }
});
$('#command-results').addEventListener('click', (event) => {
  const button = event.target.closest('[data-command-index]');
  if (button) runCommand(Number(button.dataset.commandIndex));
});
$('#search-filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-search-scope]');
  if (!button) return;
  searchScope = button.dataset.searchScope;
  commandIndex = 0;
  $$('[data-search-scope]').forEach((item) => item.classList.toggle('active', item === button));
  renderCommand($('#command-input').value);
});
$('#map-button').addEventListener('click', openMap);
$('#map-close').addEventListener('click', () => $('#map-dialog').close());
$('#map-stage').addEventListener('click', (event) => {
  const node = event.target.closest('[data-note]');
  if (!node) return;
  $('#map-dialog').close();
  selectNote(node.dataset.note, false);
});
$('#map-stage').addEventListener('keydown', (event) => {
  if (!['Enter', ' '].includes(event.key)) return;
  const node = event.target.closest('[data-note]');
  if (!node) return;
  event.preventDefault();
  $('#map-dialog').close();
  selectNote(node.dataset.note, false);
});
$('.mobile-dock').addEventListener('click', (event) => {
  const action = event.target.closest('[data-mobile-action]')?.dataset.mobileAction;
  if (action === 'library') $('#editor').classList.remove('mobile-open');
  if (action === 'search') openCommand();
  if (action === 'jot') { $('#quick-dialog').showModal(); requestAnimationFrame(() => $('#quick-input').focus()); }
  if (action === 'plan') openPlanner();
});
$('#mobile-editor-back').addEventListener('click', () => $('#editor').classList.remove('mobile-open'));

function syncMobileViewport() {
  const viewport = window.visualViewport;
  const viewportHeight = viewport?.height || window.innerHeight;
  const keyboardOpen = window.innerHeight - viewportHeight > 140;
  document.documentElement.style.setProperty('--visual-viewport-height', `${viewportHeight}px`);
  document.documentElement.classList.toggle('keyboard-open', keyboardOpen);
}

window.visualViewport?.addEventListener('resize', syncMobileViewport);
window.visualViewport?.addEventListener('scroll', syncMobileViewport);
window.addEventListener('orientationchange', syncMobileViewport);
syncMobileViewport();
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f' && currentNote()) {
    event.preventDefault();
    openFindReplace();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommand();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    if (event.shiftKey) {
      $('#quick-dialog').showModal();
      requestAnimationFrame(() => $('#quick-input').focus());
    } else createNote();
  }
  if (event.key === 'Escape' && $('#editor').classList.contains('focused')) {
    $('#editor').classList.remove('focused');
    $('#focus-button').classList.remove('active');
  }
});

scheduleReminderCheck();
setInterval(scheduleReminderCheck, 30000);
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installEvent = event;
  $('#install-button').hidden = false;
});
window.addEventListener('appinstalled', () => {
  installEvent = null;
  $('#install-button').hidden = true;
  toast('Jotfield installed');
});
window.addEventListener('online', () => { $('#device-status').textContent = 'Online. Open tabs stay in step instantly.'; });
window.addEventListener('offline', () => { $('#device-status').textContent = 'Offline. Every local feature remains available.'; });
window.addEventListener('online', () => { cloudSync?.push(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cloudSync?.refresh(); });

function setupControlTooltips() {
  const tooltip = $('#control-tooltip');
  let trigger = null;
  let showTimer = null;
  let hideTimer = null;

  const eligible = (target) => {
    const button = target.closest?.('button[aria-label]');
    return button && button.querySelector('svg') ? button : null;
  };
  const hide = (immediate = false) => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    const finish = () => {
      tooltip.classList.remove('visible');
      tooltip.hidden = true;
      trigger?.removeAttribute('aria-describedby');
      trigger = null;
    };
    if (immediate) finish();
    else hideTimer = setTimeout(finish, 100);
  };
  const show = (button, delay) => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    showTimer = setTimeout(() => {
      if (trigger && trigger !== button) trigger.removeAttribute('aria-describedby');
      trigger = button;
      tooltip.textContent = button.getAttribute('aria-label');
      tooltip.hidden = false;
      button.setAttribute('aria-describedby', 'control-tooltip');
      const box = button.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      const left = Math.min(window.innerWidth - tip.width - 10, Math.max(10, box.left + box.width / 2 - tip.width / 2));
      const below = box.bottom + 9;
      const top = below + tip.height <= window.innerHeight - 10 ? below : box.top - tip.height - 9;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${Math.max(10, top)}px`;
      requestAnimationFrame(() => tooltip.classList.add('visible'));
    }, delay);
  };

  document.addEventListener('pointerover', (event) => {
    const button = eligible(event.target);
    if (button && event.pointerType !== 'touch') show(button, 380);
  });
  document.addEventListener('pointerout', (event) => {
    const button = eligible(event.target);
    if (button && !button.contains(event.relatedTarget)) hide();
  });
  document.addEventListener('focusin', (event) => {
    const button = eligible(event.target);
    if (button) show(button, 80);
  });
  document.addEventListener('focusout', (event) => {
    if (eligible(event.target)) hide();
  });
  tooltip.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  tooltip.addEventListener('pointerleave', () => hide());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && trigger) hide(true);
  });
  window.addEventListener('scroll', () => hide(true), true);
  window.addEventListener('resize', () => hide(true));
}

setupControlTooltips();

function startLightField() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $('#light-field');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return;
  const vertex = `attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}`;
  const fragment = `precision highp float;uniform vec2 r;uniform float t;uniform float d;
    float bloom(vec2 p,vec2 c,float s){return s/max(dot(p-c,p-c),.12);}
    void main(){vec2 uv=(gl_FragCoord.xy-.5*r)/min(r.x,r.y);
    float grain=(sin(uv.x*91.0+uv.y*57.0)+sin(uv.y*113.0-uv.x*41.0))*.0015;
    float a=bloom(uv,vec2(-.72+.1*sin(t*.045),.48),.032);
    float b=bloom(uv,vec2(.78,.28+.08*cos(t*.04)),.025);
    float c=bloom(uv,vec2(.2,-.82),.02);
    vec3 lightCol=vec3(.91,.875,.81)+a*vec3(.16,.035,.0)+b*vec3(.0,.08,.16)+c*vec3(.11,.15,.0)+grain;
    vec3 darkCol=vec3(.055,.049,.043)+a*vec3(.19,.035,.0)+b*vec3(.015,.07,.17)+c*vec3(.09,.12,.0)+grain*.35;
    vec3 col=mix(lightCol,darkCol,d);
    gl_FragColor=vec4(col,1.);}`;
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const resolution = gl.getUniformLocation(program, 'r');
  const time = gl.getUniformLocation(program, 't');
  const darkness = gl.getUniformLocation(program, 'd');
  const compact = matchMedia('(max-width: 620px), (pointer: coarse)').matches;
  const resize = () => {
    const scale = Math.min(devicePixelRatio, compact ? 1.5 : 2);
    canvas.width = Math.round(canvas.clientWidth * scale);
    canvas.height = Math.round(canvas.clientHeight * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  addEventListener('resize', resize);
  resize();
  let animationFrame = 0;
  let lastPaint = 0;
  const frameInterval = compact ? 1000 / 30 : 0;
  const frame = (stamp) => {
    if (stamp - lastPaint < frameInterval) {
      animationFrame = requestAnimationFrame(frame);
      return;
    }
    lastPaint = stamp;
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform1f(time, stamp / 1000);
    gl.uniform1f(darkness, document.documentElement.dataset.theme === 'dark' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    animationFrame = requestAnimationFrame(frame);
  };
  const updateAnimation = () => {
    cancelAnimationFrame(animationFrame);
    if (!document.hidden) animationFrame = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', updateAnimation);
  updateAnimation();
}

startLightField();
initializeEditor($('#body-input'), { onChange: saveRichEditor, onSelectionChange: updateSelectionTools, toolbar: $('.format-toolbar') });
render();
setAccountMode('signin');
cloudSync = createEncryptedSync({
  clientPromise: cloudClientPromise,
  getNotebook: () => structuredClone(state),
  mergeNotebook,
  applyNotebook: applyCloudNotebook,
  setStatus: setCloudSyncStatus,
  openDatabase,
});
if (cloudReady) {
  observeAccount(cloudClientPromise, (session, event) => {
    accountSession = session;
    renderAccount();
    cloudSync.start(session).catch((error) => setCloudSyncStatus('error', error.message));
    if (event === 'PASSWORD_RECOVERY' && !$('#password-dialog').open) {
      $('#password-dialog').showModal();
      requestAnimationFrame(() => $('#new-password').focus());
    }
  }).catch(() => { document.documentElement.dataset.cloud = 'unavailable'; });
}
hydrateDurableState();
showSharedNote();
handleLaunchIntent();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
