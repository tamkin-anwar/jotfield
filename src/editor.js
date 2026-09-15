import { DOMParser as PMDOMParser, DOMSerializer, Schema } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes, liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { baseKeymap, chainCommands, exitCode, lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';

const nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block').append({
  task_list: {
    group: 'block', content: 'task_item+',
    parseDOM: [{ tag: 'ul.task-list', priority: 60 }],
    toDOM: () => ['ul', { class: 'task-list' }, 0],
  },
  task_item: {
    attrs: { checked: { default: false } }, content: 'paragraph block*', defining: true,
    parseDOM: [{
      tag: 'li[data-checked]', priority: 60,
      getAttrs: (dom) => ({ checked: dom.getAttribute('data-checked') === 'true' }),
      contentElement: (dom) => dom.querySelector('.task-content') || dom,
    }],
    toDOM: (node) => ['li', { 'data-checked': String(node.attrs.checked) },
      ['button', { type: 'button', class: 'task-check', contenteditable: 'false', 'aria-label': node.attrs.checked ? 'Mark task incomplete' : 'Mark task complete' }],
      ['div', { class: 'task-content' }, 0]],
  },
  attachment_image: {
    group: 'block', atom: true, attrs: { src: {}, name: { default: '' } },
    parseDOM: [{ tag: 'figure.attachment', priority: 60, getAttrs: (dom) => ({ src: dom.querySelector('img')?.src || '', name: dom.querySelector('figcaption')?.textContent || '' }) }],
    toDOM: (node) => ['figure', { class: 'attachment' }, ['img', { src: node.attrs.src, alt: node.attrs.name }], ['figcaption', node.attrs.name]],
  },
  attachment_file: {
    group: 'block', atom: true, attrs: { src: {}, name: { default: 'Attachment' } },
    parseDOM: [{ tag: 'p.file-attachment', priority: 60, getAttrs: (dom) => ({ src: dom.querySelector('a')?.href || '', name: dom.textContent.trim() || 'Attachment' }) }],
    toDOM: (node) => ['p', { class: 'file-attachment' }, ['a', { href: node.attrs.src, download: node.attrs.name }, ['span', node.attrs.name]]],
  },
});

const marks = basicSchema.spec.marks.append({
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration', getAttrs: (value) => String(value).includes('underline') && null }],
    toDOM: () => ['u', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'strike' }, { style: 'text-decoration', getAttrs: (value) => String(value).includes('line-through') && null }],
    toDOM: () => ['s', 0],
  },
});

export const editorSchema = new Schema({ nodes, marks });

let view = null;
let activeNoteId = null;
let sourceHTML = '';
let loadedInputHTML = '';
let onChange = () => {};
let toolbar = null;

function parseHTML(html) {
  const container = document.createElement('div');
  container.innerHTML = html || '<p></p>';
  return PMDOMParser.fromSchema(editorSchema).parse(container);
}

function plugins() {
  const rules = [
    wrappingInputRule(/^\s*>\s$/, editorSchema.nodes.blockquote),
    wrappingInputRule(/^(\d+)\.\s$/, editorSchema.nodes.ordered_list, (match) => ({ order: Number(match[1]) }), (match, node) => node.childCount + node.attrs.order === Number(match[1])),
    wrappingInputRule(/^\s*([-+*])\s$/, editorSchema.nodes.bullet_list),
    textblockTypeInputRule(/^(#{1,2})\s$/, editorSchema.nodes.heading, (match) => ({ level: match[1].length })),
    textblockTypeInputRule(/^```$/, editorSchema.nodes.code_block),
  ];
  return [
    inputRules({ rules }),
    history(),
    keymap({
      'Mod-b': toggleMark(editorSchema.marks.strong),
      'Mod-i': toggleMark(editorSchema.marks.em),
      'Mod-u': toggleMark(editorSchema.marks.underline),
      'Mod-Shift-x': toggleMark(editorSchema.marks.strike),
      'Mod-z': undo,
      'Shift-Mod-z': redo,
      'Mod-y': redo,
      Enter: chainCommands(splitListItem(editorSchema.nodes.list_item), splitListItem(editorSchema.nodes.task_item)),
      Tab: sinkListItem(editorSchema.nodes.list_item),
      'Shift-Tab': liftListItem(editorSchema.nodes.list_item),
      'Mod-Enter': exitCode,
    }),
    keymap(baseKeymap),
  ];
}

function markActive(type) {
  const { from, $from, to, empty } = view.state.selection;
  return empty ? Boolean(type.isInSet(view.state.storedMarks || $from.marks())) : view.state.doc.rangeHasMark(from, to, type);
}

function nodeActive(type) {
  const { $from, to } = view.state.selection;
  if ($from.parent.type === type) return true;
  for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type === type) return true;
  return to > $from.pos && view.state.doc.nodesBetween($from.pos, to, (node) => node.type === type);
}

function updateToolbar() {
  if (!view || !toolbar) return;
  const active = {
    bold: markActive(editorSchema.marks.strong), italic: markActive(editorSchema.marks.em),
    underline: markActive(editorSchema.marks.underline), strike: markActive(editorSchema.marks.strike),
    h2: nodeActive(editorSchema.nodes.heading), bullet: nodeActive(editorSchema.nodes.bullet_list),
    ordered: nodeActive(editorSchema.nodes.ordered_list), checklist: nodeActive(editorSchema.nodes.task_list),
    blockquote: nodeActive(editorSchema.nodes.blockquote), code: nodeActive(editorSchema.nodes.code_block),
  };
  toolbar.querySelectorAll('[data-format]').forEach((button) => {
    const pressed = Boolean(active[button.dataset.format]);
    button.classList.toggle('active', pressed);
    button.setAttribute('aria-pressed', String(pressed));
  });
}

export function initializeEditor(element, options = {}) {
  onChange = options.onChange || onChange;
  toolbar = options.toolbar || null;
  view = new EditorView({ mount: element }, {
    state: EditorState.create({ schema: editorSchema, doc: parseHTML('<p></p>'), plugins: plugins() }),
    dispatchTransaction(transaction) {
      const next = view.state.apply(transaction);
      view.updateState(next);
      updateToolbar();
      if (transaction.docChanged) {
        sourceHTML = editorHTML();
        loadedInputHTML = sourceHTML;
        onChange();
      }
    },
    handleClickOn(currentView, position, node, nodePosition, event) {
      if (node.type !== editorSchema.nodes.task_item || !event.target.closest('.task-check')) return false;
      currentView.dispatch(currentView.state.tr.setNodeMarkup(nodePosition, undefined, { checked: !node.attrs.checked }));
      currentView.focus();
      return true;
    },
    attributes: { role: 'textbox', 'aria-label': 'Note content', 'aria-multiline': 'true', spellcheck: 'true', 'data-placeholder': 'Start writing...' },
  });
  updateToolbar();
  return view;
}

export function loadEditorDocument(noteId, html) {
  if (!view || activeNoteId === noteId && (sourceHTML === html || loadedInputHTML === html)) return;
  activeNoteId = noteId;
  sourceHTML = html;
  loadedInputHTML = html;
  view.updateState(EditorState.create({ schema: editorSchema, doc: parseHTML(html), plugins: plugins() }));
  updateToolbar();
}

export function editorHTML() {
  if (!view) return '';
  const container = document.createElement('div');
  container.append(DOMSerializer.fromSchema(editorSchema).serializeFragment(view.state.doc.content));
  return container.innerHTML;
}

export function editorText() {
  return view?.state.doc.textBetween(0, view.state.doc.content.size, '\n\n', '\n') || '';
}

export function focusEditor() { view?.focus(); }

function run(command) {
  if (!view) return false;
  const complete = command(view.state, view.dispatch, view);
  if (complete) view.focus();
  updateToolbar();
  return complete;
}

function toggleList(type) {
  if (nodeActive(type)) return run(liftListItem(editorSchema.nodes.list_item));
  return run(wrapInList(type));
}

export function runEditorAction(action, value = null) {
  const actions = {
    bold: () => run(toggleMark(editorSchema.marks.strong)),
    italic: () => run(toggleMark(editorSchema.marks.em)),
    underline: () => run(toggleMark(editorSchema.marks.underline)),
    strike: () => run(toggleMark(editorSchema.marks.strike)),
    h2: () => run(setBlockType(editorSchema.nodes.heading, { level: 2 })),
    paragraph: () => run(setBlockType(editorSchema.nodes.paragraph)),
    bullet: () => toggleList(editorSchema.nodes.bullet_list),
    ordered: () => toggleList(editorSchema.nodes.ordered_list),
    blockquote: () => nodeActive(editorSchema.nodes.blockquote) ? run(lift) : run(wrapIn(editorSchema.nodes.blockquote)),
    code: () => run(setBlockType(editorSchema.nodes.code_block)),
    undo: () => run(undo), redo: () => run(redo),
    clear: () => {
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.removeMark(from, to).setBlockType(from, to, editorSchema.nodes.paragraph));
      view.focus(); updateToolbar(); return true;
    },
    link: () => {
      if (!value) return false;
      const { empty, from, to } = view.state.selection;
      const mark = editorSchema.marks.link.create({ href: value });
      if (!empty) return run(toggleMark(editorSchema.marks.link, { href: value }));
      view.dispatch(view.state.tr.insertText(value, from, to).addMark(from, from + value.length, mark));
      view.focus(); return true;
    },
  };
  return actions[action]?.() || false;
}

export function insertChecklist() {
  if (!view) return;
  const paragraph = editorSchema.nodes.paragraph.create(null, editorSchema.text('New task'));
  const item = editorSchema.nodes.task_item.create({ checked: false }, paragraph);
  const list = editorSchema.nodes.task_list.create(null, item);
  const { from, to } = view.state.selection;
  const transaction = view.state.tr.replaceRangeWith(from, to, list).scrollIntoView();
  view.dispatch(transaction.setSelection(TextSelection.near(transaction.doc.resolve(Math.min(from + 2, transaction.doc.content.size)))));
  view.focus();
}

export function insertAttachmentNode(file, dataUrl) {
  if (!view) return;
  const type = file.type.startsWith('image/') ? editorSchema.nodes.attachment_image : editorSchema.nodes.attachment_file;
  const node = type.create({ src: dataUrl, name: file.name });
  view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
  view.focus();
}

export function deleteSlashTrigger() {
  if (!view) return;
  const { from } = view.state.selection;
  if (from > 1 && view.state.doc.textBetween(from - 1, from) === '/') view.dispatch(view.state.tr.delete(from - 1, from));
}
