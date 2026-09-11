const STORAGE_KEY = 'facet-notes-v1';
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
      body: 'Facet keeps capture fast and structure optional. Write first. Add #tags when they help. Connect another thought by typing [[Field test]].\n\nEverything here stays in this browser until you export it.',
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
let selectedId = state.notes.find((note) => note.id === 'welcome')?.id || state.notes[0]?.id || null;
let layout = 'list';
let saveTimer;
let commandIndex = 0;
let commandItems = [];

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed && Array.isArray(parsed.notes) && Array.isArray(parsed.spaces)) return parsed;
  } catch {}
  return structuredClone(starterState);
}

function persist() {
  $('#save-state').classList.add('saving');
  $('#save-state').lastChild.textContent = ' Saving';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function visibleNotes() {
  return state.notes
    .filter((note) => {
      if (currentSpace && note.space !== currentSpace) return false;
      if (currentTag && !extractTags(note).includes(currentTag)) return false;
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
  if (currentSpace) return state.spaces.find((space) => space.id === currentSpace)?.name || 'Space';
  if (currentTag) return `#${currentTag}`;
  return { now: 'Now', all: 'All notes', favorites: 'Favorites', daily: 'Daily notes', archive: 'Archive', trash: 'Recently deleted' }[currentView];
}

function renderList() {
  const notes = visibleNotes();
  $('#view-title').textContent = viewName();
  $('#view-overline').textContent = currentSpace ? 'SPACE' : currentTag ? 'TAG' : currentView === 'now' ? 'TODAY' : 'LIBRARY';
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
  if ($('#body-input') !== document.activeElement) $('#body-input').value = note.body;
  $('#favorite-button').classList.toggle('active', note.favorite);
  $('#favorite-button').querySelector('svg').style.fill = note.favorite ? 'rgba(241,189,112,.2)' : '';
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
  const related = state.notes.filter((candidate) => candidate.id !== note.id && !candidate.deleted && (linked.has(candidate.title.trim().toLowerCase()) || linkedTitles(candidate).includes(ownTitle)));
  $('#backlink-list').replaceChildren(...related.map((candidate) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'backlink';
    button.dataset.note = candidate.id;
    button.textContent = candidate.title || 'Untitled';
    return button;
  }));
  $('#connections').classList.toggle('visible', related.length > 0);
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

function renderCommand(query) {
  const needle = query.trim().toLowerCase();
  const notes = state.notes.filter((note) => !note.deleted && (!needle || `${note.title} ${note.body}`.toLowerCase().includes(needle))).slice(0, 8);
  commandItems = [
    { kind: 'action', title: 'Create a new note', detail: 'Start with a blank page', icon: 'plus', action: () => createNote() },
    { kind: 'action', title: 'Open today', detail: 'Jump to the daily note', icon: 'calendar', action: () => openDaily(todayKey()) },
    ...notes.map((note) => ({ kind: 'note', title: note.title || 'Untitled', detail: cleanPreview(note.body), icon: 'notes', action: () => selectNote(note.id, true) })),
  ];
  const result = $('#command-results');
  result.replaceChildren();
  const label = document.createElement('div');
  label.className = 'command-section-label';
  label.textContent = needle ? 'Matches' : 'Go somewhere';
  result.append(label);
  commandItems.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `command-result${index === commandIndex ? ' selected' : ''}`;
    button.dataset.commandIndex = index;
    button.innerHTML = icon(item.icon);
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const detail = document.createElement('span');
    detail.textContent = item.detail;
    copy.append(title, detail);
    button.append(copy);
    result.append(button);
  });
}

function runCommand(index) {
  const item = commandItems[index];
  if (!item) return;
  $('#command-dialog').close();
  item.action();
}

function exportNotes() {
  const payload = { product: 'Facet', exported: now(), ...state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `facet-notes-${todayKey()}.json`;
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
      persist();
      render();
      toast('Notebook restored');
    } catch {
      toast('That file is not a Facet backup');
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
  currentView = 'all';
  selectedId = visibleNotes()[0]?.id || null;
  render();
});
$('#tag-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-tag]');
  if (!button) return;
  currentTag = button.dataset.tag;
  currentSpace = null;
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
$('#body-input').addEventListener('input', (event) => updateSelected('body', event.target.value));
$('#new-note-button').addEventListener('click', () => createNote());
$('#empty-new').addEventListener('click', () => createNote());
$('#search-trigger').addEventListener('click', () => openCommand());
$('#export-button').addEventListener('click', exportNotes);
$('#import-button').addEventListener('click', () => $('#import-input').click());
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
  const fragment = `precision highp float;uniform vec2 r;uniform float t;
    float orb(vec2 p,vec2 c,float s){return s/max(length(p-c),.06);}
    void main(){vec2 uv=(gl_FragCoord.xy-.5*r)/min(r.x,r.y);float n=sin(uv.x*3.1+t*.07)*cos(uv.y*2.7-t*.05);
    float a=orb(uv,vec2(-.72+.08*sin(t*.09),.48),.026);float b=orb(uv,vec2(.82,.22+.09*cos(t*.07)),.023);float c=orb(uv,vec2(.18,-.8),.018);
    vec3 col=vec3(.018,.027,.052)+a*vec3(.06,.17,.38)+b*vec3(.19,.07,.3)+c*vec3(.02,.2,.22)+n*.004;gl_FragColor=vec4(col,1.);}`;
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
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

startLightField();
render();
