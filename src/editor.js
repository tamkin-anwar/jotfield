import { DOMParser as PMDOMParser, DOMSerializer, Schema } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes, liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { baseKeymap, chainCommands, exitCode, lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import { addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, goToNextCell, mergeCells, setCellAttr, splitCell, tableEditing, tableNodes, toggleHeaderRow } from 'prosemirror-tables';

let baseNodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
baseNodes = baseNodes.update('paragraph', {
  ...baseNodes.get('paragraph'), attrs: { align: { default: null } },
  parseDOM: [{ tag: 'p', getAttrs: (dom) => ({ align: dom.style.textAlign || null }) }],
  toDOM: (node) => ['p', node.attrs.align ? { style: `text-align:${node.attrs.align}` } : {}, 0],
});
baseNodes = baseNodes.update('heading', {
  ...baseNodes.get('heading'), attrs: { level: { default: 1 }, align: { default: null } },
  parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({ tag: `h${level}`, attrs: { level }, getAttrs: (dom) => ({ level, align: dom.style.textAlign || null }) })),
  toDOM: (node) => [`h${node.attrs.level}`, node.attrs.align ? { style: `text-align:${node.attrs.align}` } : {}, 0],
});
baseNodes = baseNodes.append(tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: { background: { default: null, getFromDOM: (dom) => dom.style.backgroundColor || null, setDOMAttr: (value, attrs) => { if (value) attrs.style = `background-color:${value}`; } } } }));
const nodes = baseNodes.append({
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
    group: 'block', atom: true, selectable: true, attrs: { src: {}, name: { default: '' }, width: { default: 100 }, align: { default: 'center' } },
    parseDOM: [{ tag: 'figure.attachment', priority: 60, getAttrs: (dom) => ({ src: dom.querySelector('img')?.src || '', name: dom.querySelector('figcaption')?.textContent || '', width: Number(dom.dataset.width || 100), align: dom.dataset.align || 'center' }) }],
    toDOM: (node) => {
      const margins = node.attrs.align === 'left' ? 'margin-left:0;margin-right:auto' : node.attrs.align === 'right' ? 'margin-left:auto;margin-right:0' : 'margin-left:auto;margin-right:auto';
      return ['figure', { class: 'attachment', 'data-width': node.attrs.width, 'data-align': node.attrs.align, style: `width:${node.attrs.width}%;${margins}` }, ['img', { src: node.attrs.src, alt: node.attrs.name }], ['figcaption', node.attrs.name]];
    },
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
  highlight: {
    parseDOM: [{ tag: 'mark' }, { style: 'background-color', getAttrs: (value) => value !== 'transparent' && null }],
    toDOM: () => ['mark', 0],
  },
});

export const editorSchema = new Schema({ nodes, marks });

let view = null;
let activeNoteId = null;
let sourceHTML = '';
let loadedInputHTML = '';
let onChange = () => {};
let toolbar = null;
let onSelectionChange = () => {};

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
    textblockTypeInputRule(/^(#{1,3})\s$/, editorSchema.nodes.heading, (match) => ({ level: match[1].length })),
    textblockTypeInputRule(/^```$/, editorSchema.nodes.code_block),
  ];
  return [
    inputRules({ rules }),
    history(),
    tableEditing(),
    keymap({
      'Mod-b': toggleMark(editorSchema.marks.strong),
      'Mod-i': toggleMark(editorSchema.marks.em),
      'Mod-u': toggleMark(editorSchema.marks.underline),
      'Mod-Shift-x': toggleMark(editorSchema.marks.strike),
      'Mod-Shift-h': toggleMark(editorSchema.marks.highlight),
      'Mod-z': undo,
      'Shift-Mod-z': redo,
      'Mod-y': redo,
      Enter: chainCommands(splitListItem(editorSchema.nodes.list_item), splitListItem(editorSchema.nodes.task_item)),
      'Mod-Enter': exitCode,
      Tab: chainCommands(goToNextCell(1), sinkListItem(editorSchema.nodes.list_item)),
      'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(editorSchema.nodes.list_item)),
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
    underline: markActive(editorSchema.marks.underline), strike: markActive(editorSchema.marks.strike), highlight: markActive(editorSchema.marks.highlight),
    h1: view.state.selection.$from.parent.type === editorSchema.nodes.heading && view.state.selection.$from.parent.attrs.level === 1,
    h2: view.state.selection.$from.parent.type === editorSchema.nodes.heading && view.state.selection.$from.parent.attrs.level === 2,
    h3: view.state.selection.$from.parent.type === editorSchema.nodes.heading && view.state.selection.$from.parent.attrs.level === 3,
    bullet: nodeActive(editorSchema.nodes.bullet_list),
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
  onSelectionChange = options.onSelectionChange || onSelectionChange;
  toolbar = options.toolbar || null;
  view = new EditorView({ mount: element }, {
    state: EditorState.create({ schema: editorSchema, doc: parseHTML('<p></p>'), plugins: plugins() }),
    dispatchTransaction(transaction) {
      const next = view.state.apply(transaction);
      view.updateState(next);
      updateToolbar();
      onSelectionChange(selectionContext());
      if (transaction.docChanged) {
        sourceHTML = editorHTML();
        loadedInputHTML = sourceHTML;
        onChange();
      }
    },
    handleClickOn(currentView, position, node, nodePosition, event) {
      if (node.type === editorSchema.nodes.attachment_image) {
        currentView.dispatch(currentView.state.tr.setSelection(NodeSelection.create(currentView.state.doc, nodePosition)));
        currentView.focus();
        return true;
      }
      if (node.type !== editorSchema.nodes.task_item || !event.target.closest('.task-check')) return false;
      currentView.dispatch(currentView.state.tr.setNodeMarkup(nodePosition, undefined, { checked: !node.attrs.checked }));
      currentView.focus();
      return true;
    },
    attributes: { role: 'textbox', 'aria-label': 'Note content', 'aria-multiline': 'true', spellcheck: 'true', 'data-placeholder': 'Start writing...' },
  });
  updateToolbar();
  onSelectionChange(selectionContext());
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


export function selectionContext() {
  if (!view) return { empty: true };
  const { from, to, empty } = view.state.selection;
  let image = null;
  if (view.state.selection instanceof NodeSelection && view.state.selection.node.type === editorSchema.nodes.attachment_image) image = { ...view.state.selection.node.attrs };
  let link = null;
  const marks = view.state.storedMarks || view.state.selection.$from.marks();
  const linkMark = marks.find((mark) => mark.type === editorSchema.marks.link);
  if (linkMark) link = linkMark.attrs.href;
  return { empty, from, to, image, link, rect: empty ? null : { start: view.coordsAtPos(from), end: view.coordsAtPos(to) } };
}

function textMatches(query, caseSensitive = false) {
  if (!view || !query) return [];
  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  const matches = [];
  view.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    const haystack = caseSensitive ? node.text : node.text.toLocaleLowerCase();
    let offset = 0;
    while ((offset = haystack.indexOf(needle, offset)) !== -1) {
      matches.push({ from: pos + offset, to: pos + offset + query.length });
      offset += Math.max(query.length, 1);
    }
  });
  return matches;
}

export function findInEditor(query, options = {}) {
  const matches = textMatches(query, options.caseSensitive);
  if (!matches.length) return { count: 0, index: -1 };
  const cursor = view.state.selection.from;
  let index = matches.findIndex((match) => match.from > cursor);
  if (options.direction === -1) {
    index = -1;
    for (let position = matches.length - 1; position >= 0; position -= 1) if (matches[position].from < cursor) { index = position; break; }
  }
  if (index < 0) index = options.direction === -1 ? matches.length - 1 : 0;
  const match = matches[index];
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)).scrollIntoView());
  if (options.focus !== false) view.focus();
  return { count: matches.length, index };
}

export function replaceEditorMatch(query, replacement, options = {}) {
  if (!view || !query) return 0;
  const { from, to } = view.state.selection;
  const selected = view.state.doc.textBetween(from, to, '', '');
  const same = options.caseSensitive ? selected === query : selected.toLocaleLowerCase() === query.toLocaleLowerCase();
  if (!same) { findInEditor(query, options); return 0; }
  view.dispatch(view.state.tr.insertText(replacement, from, to).scrollIntoView());
  findInEditor(query, options);
  return 1;
}

export function replaceAllEditorMatches(query, replacement, options = {}) {
  const matches = textMatches(query, options.caseSensitive);
  if (!matches.length) return 0;
  let transaction = view.state.tr;
  [...matches].reverse().forEach((match) => { transaction = transaction.insertText(replacement, match.from, match.to); });
  view.dispatch(transaction.scrollIntoView());
  if (options.focus !== false) view.focus();
  return matches.length;
}

export function insertTable(rows = 3, columns = 3) {
  if (!view) return false;
  const cell = () => editorSchema.nodes.table_cell.createAndFill();
  const row = () => editorSchema.nodes.table_row.create(null, Array.from({ length: columns }, cell));
  const table = editorSchema.nodes.table.create(null, Array.from({ length: rows }, row));
  view.dispatch(view.state.tr.replaceSelectionWith(table).scrollIntoView());
  view.focus();
  return true;
}

export function runEditorAction(action, value = null) {
  const setAlignment = (align) => {
    const { from, to } = view.state.selection;
    let transaction = view.state.tr;
    view.state.doc.nodesBetween(from, to, (node, position) => {
      if (node.type === editorSchema.nodes.paragraph || node.type === editorSchema.nodes.heading) transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, align: align === 'left' ? null : align });
    });
    if (view.state.selection.$from.parent.type === editorSchema.nodes.paragraph || view.state.selection.$from.parent.type === editorSchema.nodes.heading) {
      const position = view.state.selection.$from.before();
      transaction = transaction.setNodeMarkup(position, undefined, { ...view.state.selection.$from.parent.attrs, align: align === 'left' ? null : align });
    }
    if (!transaction.docChanged) return false;
    view.dispatch(transaction.scrollIntoView()); view.focus(); return true;
  };
  const actions = {
    bold: () => run(toggleMark(editorSchema.marks.strong)),
    italic: () => run(toggleMark(editorSchema.marks.em)),
    underline: () => run(toggleMark(editorSchema.marks.underline)),
    strike: () => run(toggleMark(editorSchema.marks.strike)),
    highlight: () => run(toggleMark(editorSchema.marks.highlight)),
    h1: () => run(setBlockType(editorSchema.nodes.heading, { level: 1 })),
    h2: () => run(setBlockType(editorSchema.nodes.heading, { level: 2 })),
    h3: () => run(setBlockType(editorSchema.nodes.heading, { level: 3 })),
    paragraph: () => run(setBlockType(editorSchema.nodes.paragraph)),
    bullet: () => toggleList(editorSchema.nodes.bullet_list),
    ordered: () => toggleList(editorSchema.nodes.ordered_list),
    blockquote: () => nodeActive(editorSchema.nodes.blockquote) ? run(lift) : run(wrapIn(editorSchema.nodes.blockquote)),
    code: () => run(setBlockType(editorSchema.nodes.code_block)),
    left: () => setAlignment('left'), center: () => setAlignment('center'), right: () => setAlignment('right'),
    indent: () => run(sinkListItem(editorSchema.nodes.list_item)),
    outdent: () => run(liftListItem(editorSchema.nodes.list_item)),
    divider: () => {
      const divider = editorSchema.nodes.horizontal_rule.create();
      view.dispatch(view.state.tr.replaceSelectionWith(divider).scrollIntoView()); view.focus(); return true;
    },
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
    unlink: () => run(toggleMark(editorSchema.marks.link)),
    addRowBefore: () => run(addRowBefore), addRowAfter: () => run(addRowAfter), deleteRow: () => run(deleteRow),
    addColumnBefore: () => run(addColumnBefore), addColumnAfter: () => run(addColumnAfter), deleteColumn: () => run(deleteColumn),
    toggleHeaderRow: () => run(toggleHeaderRow), mergeCells: () => run(mergeCells), splitCell: () => run(splitCell), deleteTable: () => run(deleteTable),
    cellHighlight: () => run(setCellAttr('background', value || '#fff1b8')),
    imageSmall: () => updateSelectedImage({ width: 45 }), imageMedium: () => updateSelectedImage({ width: 70 }), imageLarge: () => updateSelectedImage({ width: 100 }),
    imageLeft: () => updateSelectedImage({ align: 'left' }), imageCenter: () => updateSelectedImage({ align: 'center' }), imageRight: () => updateSelectedImage({ align: 'right' }),
  };
  return actions[action]?.() || false;
}

function updateSelectedImage(attrs) {
  if (!view || !(view.state.selection instanceof NodeSelection) || view.state.selection.node.type !== editorSchema.nodes.attachment_image) return false;
  const { from } = view.state.selection;
  view.dispatch(view.state.tr.setNodeMarkup(from, undefined, { ...view.state.selection.node.attrs, ...attrs }));
  view.focus();
  return true;
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
