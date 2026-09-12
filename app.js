const STORAGE_KEY = 'jotfield-notes-v1';
const LEGACY_STORAGE_KEY = 'facet-notes-v1';
const THEME_KEY = 'jotfield-appearance';
const DB_NAME = 'jotfield-library';
const DB_VERSION = 1;
const REVISION_LIMIT = 100;
const SPACE_COLORS = ['#7aa7ff', '#b295ff', '#70dded', '#77d6ad', '#f1bd70', '#ff8b93'];

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const todayKey = (date = new Date()) => date.toISOString().slice(0, 10);

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
};

let state = loadState();
let currentView = 'now';
let currentSpace = null;
let currentTag = null;
let currentSmart = null;
let selectedId = state.notes.find((note) => note.id === 'welcome')?.id || state.notes[0]?.id || null;
let layout = 'list';
let saveTimer;
let commandIndex = 0;
let commandItems = [];
let searchScope = 'all';
let retrievalIndex = null;
let databasePromise;

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
systemTheme.addEventListener('change', () => {
  if (themeChoice === 'system') applyTheme();
});

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    const parsed = JSON.parse(saved);
    if (parsed && Array.isArray(parsed.notes) && Array.isArray(parsed.spaces)) return parsed;
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

async function writeDurably(snapshot, revision) {
  const database = await openDatabase();
  const transaction = database.transaction(['notebook', 'revisions'], 'readwrite');
  transaction.objectStore('notebook').put(snapshot, 'current');
  if (revision) transaction.objectStore('revisions').put(revision);
  const revisions = transaction.objectStore('revisions');
  const keys = await databaseRequest(revisions.index('created').getAllKeys());
  keys.slice(0, Math.max(0, keys.length - REVISION_LIMIT)).forEach((key) => revisions.delete(key));
}

async function hydrateDurableState() {
  try {
    const database = await openDatabase();
    const transaction = database.transaction('notebook', 'readonly');
    const durable = await databaseRequest(transaction.objectStore('notebook').get('current'));
    if (durable?.notes && durable?.spaces) {
      const durableTime = new Date(durable.modifiedAt || 0).getTime();
      const currentTime = new Date(state.modifiedAt || 0).getTime();
      if (durableTime > currentTime) {
        state = durable;
        selectedId = state.notes.find((note) => note.id === selectedId)?.id || state.notes[0]?.id || null;
        render();
        toast('Notebook recovered');
      }
    } else {
      await writeDurably(structuredClone(state));
    }
  } catch {
    toast('Using browser backup storage');
  }
}

function persist() {
  $('#save-state').classList.add('saving');
  $('#save-state').lastChild.textContent = ' Saving';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.modifiedAt = now();
    const snapshot = structuredClone(state);
    const note = currentNote();
    const revision = note ? { id: `${Date.now()}-${note.id}`, noteId: note.id, created: now(), note: structuredClone(note) } : null;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)); } catch {}
    writeDurably(snapshot, revision).catch(() => {});
    $('#save-state').classList.remove('saving');
    $('#save-state').lastChild.textContent = ' Saved locally';
  }, 220);
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
  return $('#body-input').innerText.replace(/\n{3,}/g, '\n\n').trimEnd();
}

function saveRichEditor() {
  const note = currentNote();
  if (!note) return;
  note.html = $('#body-input').innerHTML;
  note.body = editorPlainText();
  note.updated = now();
  persist();
  renderList();
  renderNav();
  renderInlineTags(note);
  renderBacklinks(note);
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
  if ($('#body-input') !== document.activeElement) $('#body-input').innerHTML = note.html || plainTextToHTML(note.body);
  $('#favorite-button').classList.toggle('active', note.favorite);
  $('#favorite-button').querySelector('svg').style.fill = note.favorite ? 'rgba(255,92,53,.18)' : '';
  renderInlineTags(note);
  renderBacklinks(note);
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

function renderBacklinks(note) {
  const ownTitle = note.title.trim().toLowerCase();
  const linked = new Set(linkedTitles(note));
  const ownTags = new Set(extractTags(note));
  const related = state.notes.filter((candidate) => candidate.id !== note.id && !candidate.deleted).map((candidate) => {
    const outgoing = linked.has(candidate.title.trim().toLowerCase());
    const incoming = linkedTitles(candidate).includes(ownTitle);
    const shared = extractTags(candidate).filter((tag) => ownTags.has(tag));
    return { candidate, outgoing, incoming, shared };
  }).filter((item) => item.outgoing || item.incoming || item.shared.length).sort((a, b) => Number(b.incoming) - Number(a.incoming) || b.shared.length - a.shared.length).slice(0, 8);
  $('#backlink-list').replaceChildren(...related.map(({ candidate, outgoing, incoming, shared }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'backlink';
    button.dataset.note = candidate.id;
    const title = document.createElement('strong');
    title.textContent = candidate.title || 'Untitled';
    const reason = document.createElement('span');
    reason.textContent = incoming ? 'Links here' : outgoing ? 'Linked from here' : `Shared #${shared[0]}`;
    const preview = document.createElement('small');
    preview.textContent = cleanPreview(candidate.body).slice(0, 72);
    button.append(title, reason, preview);
    return button;
  }));
  $('#connections').classList.toggle('visible', related.length > 0);
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

function updateWordCount(note) {
  const words = note.body.trim() ? note.body.trim().split(/\s+/).length : 0;
  $('#word-count').textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
}

function selectNote(id, focus = false) {
  selectedId = id;
  render();
  $('#editor').classList.add('mobile-open');
  if (focus) requestAnimationFrame(() => ($('#title-input').value ? $('#body-input') : $('#title-input')).focus());
}

function createNote(options = {}) {
  const space = options.space || currentSpace || state.spaces[0]?.id || 'personal';
  const note = {
    id: uid(), title: options.title || '', body: options.body || '', space,
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
  renderBacklinks(note);
  updateWordCount(note);
  $('#editor-path').lastChild.textContent = note.title || 'Untitled';
  $('#edited-time').textContent = 'Edited now';
}

function runEditorCommand(command, value = null) {
  $('#body-input').focus();
  document.execCommand(command, false, value);
  saveRichEditor();
}

function insertChecklist() {
  $('#body-input').focus();
  document.execCommand('insertHTML', false, '<ul class="task-list"><li data-checked="false"><button type="button" class="task-check" contenteditable="false" aria-label="Mark task complete"></button><span>New task</span></li></ul><p><br></p>');
  saveRichEditor();
}

function insertLink() {
  const address = window.prompt('Paste a web address');
  if (!address) return;
  const safeAddress = /^https?:\/\//i.test(address) ? address : `https://${address}`;
  const selection = getSelection();
  if (selection?.toString()) runEditorCommand('createLink', safeAddress);
  else runEditorCommand('insertHTML', `<a href="${escapeHTML(safeAddress)}" target="_blank" rel="noopener">${escapeHTML(address)}</a>`);
}

function insertAttachment(file) {
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast('Attachments must be smaller than 10 MB');
    return;
  }
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    const safeName = escapeHTML(file.name);
    const markup = file.type.startsWith('image/')
      ? `<figure class="attachment"><img src="${reader.result}" alt="${safeName}"><figcaption>${safeName}</figcaption></figure><p><br></p>`
      : `<p class="file-attachment"><a href="${reader.result}" download="${safeName}">${icon('attach')}<span>${safeName}</span></a></p><p><br></p>`;
    runEditorCommand('insertHTML', markup);
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
  document.execCommand('delete', false);
  if (action === 'h2') runEditorCommand('formatBlock', 'h2');
  if (action === 'ul') runEditorCommand('insertUnorderedList');
  if (action === 'check') insertChecklist();
  if (action === 'quote') runEditorCommand('formatBlock', 'blockquote');
  if (action === 'code') runEditorCommand('formatBlock', 'pre');
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

function importNotes(file) {
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.notes) || !Array.isArray(data.spaces)) throw new Error('Invalid backup');
      state = { notes: data.notes, spaces: data.spaces };
      selectedId = state.notes.find((note) => !note.deleted)?.id || state.notes[0]?.id || null;
      currentView = 'all';
      currentSpace = null;
      currentTag = null;
      currentSmart = null;
      persist();
      render();
      toast('Notebook restored');
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
$('#backlink-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-note]');
  if (button) selectNote(button.dataset.note);
});
$('#day-strip').addEventListener('click', (event) => {
  const button = event.target.closest('[data-day]');
  if (button) openDaily(button.dataset.day);
});
$('#title-input').addEventListener('input', (event) => updateSelected('title', event.target.value));
$('#body-input').addEventListener('input', saveRichEditor);
$('#body-input').addEventListener('keydown', (event) => {
  if (event.key === '/' && !event.metaKey && !event.ctrlKey) requestAnimationFrame(showSlashMenu);
  if (event.key === 'Escape') closeSlashMenu();
  if (event.key === 'Enter' && $('#slash-menu').hidden === false) {
    event.preventDefault();
    applySlashAction($('#slash-menu button').dataset.slash);
  }
});
$('#body-input').addEventListener('paste', (event) => {
  const html = event.clipboardData?.getData('text/html');
  if (!html) return;
  event.preventDefault();
  const pasted = new DOMParser().parseFromString(html, 'text/html');
  pasted.querySelectorAll('script,style,iframe,object,embed,form').forEach((element) => element.remove());
  pasted.querySelectorAll('*').forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (attribute.name.startsWith('on') || attribute.name === 'style') element.removeAttribute(attribute.name);
    });
    const href = element.getAttribute('href');
    if (href && !/^(https?:|mailto:|#)/i.test(href)) element.removeAttribute('href');
    const src = element.getAttribute('src');
    if (src && !/^(https?:|data:image\/)/i.test(src)) element.removeAttribute('src');
  });
  document.execCommand('insertHTML', false, pasted.body.innerHTML);
});
$('.format-toolbar').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.editorCommand) runEditorCommand(button.dataset.editorCommand);
  if (button.dataset.blockCommand) runEditorCommand('formatBlock', button.dataset.blockCommand);
  if (button.hasAttribute('data-insert-checklist')) insertChecklist();
  if (button.hasAttribute('data-insert-link')) insertLink();
  if (button.hasAttribute('data-attach')) $('#attachment-input').click();
});
$('#body-input').addEventListener('click', (event) => {
  const checkbox = event.target.closest('.task-check');
  if (!checkbox) return;
  const item = checkbox.closest('li');
  const checked = item.dataset.checked === 'true';
  item.dataset.checked = String(!checked);
  checkbox.setAttribute('aria-label', checked ? 'Mark task complete' : 'Mark task incomplete');
  saveRichEditor();
});
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
$('#export-button').addEventListener('click', exportNotes);
$('#import-button').addEventListener('click', () => $('#import-input').click());
$('#settings-button').addEventListener('click', () => {
  applyTheme();
  $('#settings-dialog').showModal();
});
$('#settings-close').addEventListener('click', () => $('#settings-dialog').close());
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
$('#focus-button').addEventListener('click', () => {
  $('#editor').classList.toggle('focused');
  $('#focus-button').classList.toggle('active');
});
$('#more-button').addEventListener('click', openActions);
$('#action-dialog').addEventListener('close', () => {
  const note = currentNote();
  if (!note || $('#action-dialog').returnValue === 'cancel') return;
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
$('#editor').addEventListener('click', (event) => {
  if (window.innerWidth <= 620 && event.clientY < 122 && event.clientX < 120) $('#editor').classList.remove('mobile-open');
});
window.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    openCommand();
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    createNote();
  }
  if (event.key === 'Escape' && $('#editor').classList.contains('focused')) {
    $('#editor').classList.remove('focused');
    $('#focus-button').classList.remove('active');
  }
});

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
  const resize = () => {
    const scale = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(innerWidth * scale);
    canvas.height = Math.round(innerHeight * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  addEventListener('resize', resize);
  resize();
  const frame = (stamp) => {
    gl.uniform2f(resolution, canvas.width, canvas.height);
    gl.uniform1f(time, stamp / 1000);
    gl.uniform1f(darkness, document.documentElement.dataset.theme === 'dark' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

startLightField();
render();
hydrateDurableState();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
