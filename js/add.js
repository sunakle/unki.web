// Окно «Добавить» и окно правки записи.
import * as S from './store.js';
import { h, openWindow, popupMenu, toast, alertDialog } from './ui.js';
import { createEditor } from './editor.js';
import { stripHtml, isEmptyField, clozeNumbers } from './models.js';

let addWin = null;
const history = [];

function defaultDeck() {
  const c = S.C().config;
  if (c.defaultDeckMode === 'last' && S.C().decks[c.lastDeck]) return c.lastDeck;
  return S.C().decks[c.curDeck] ? c.curDeck : 1;
}

export function openAdd({ deckId, typeId } = {}) {
  if (addWin && !addWin.closed) { addWin.overlay.style.zIndex = 9999; addWin.el.querySelector('[contenteditable]')?.focus(); return addWin; }
  const col = S.C();
  let editor;
  const warn = h('div', { class: 'dup-warn hidden' });

  function checkDup() {
    const nt = S.noteType(editor.typeId);
    const first = editor.getFields()[nt.sortField || 0];
    warn.classList.add('hidden');
    if (isEmptyField(first)) return;
    const key = stripHtml(first).toLowerCase();
    const dup = Object.values(col.notes).some((n) => n.tid === nt.id && stripHtml(n.fields[nt.sortField || 0]).toLowerCase() === key);
    if (dup) { warn.textContent = 'Первое поле совпадает с уже существующей записью.'; warn.classList.remove('hidden'); }
  }

  async function add() {
    const nt = S.noteType(editor.typeId);
    const fields = editor.getFields();
    if (isEmptyField(fields[nt.sortField || 0]) && nt.kind !== 'cloze') { toast('Первое поле пустое'); editor.focus(0); return; }
    if (nt.kind === 'cloze') {
      if (!clozeNumbers(fields.join(' ')).length) { await alertDialog('Для этого типа нужен хотя бы один пропуск вида {{c1::текст}}.\nВыделите слово и нажмите […] или Ctrl+Shift+C.'); return; }
    }
    const { note, cards } = S.addNote({ typeId: nt.id, fields, tags: editor.getTags(), did: editor.deckId });
    if (!cards.length) { S.undo(); await alertDialog('Не получилось создать ни одной карточки: проверьте, что поля, используемые на лицевой стороне, не пусты.'); return; }
    S.setConfig({ lastDeck: editor.deckId, lastType: nt.id, typeDeck: { ...col.config.typeDeck, [nt.id]: editor.deckId } });
    history.unshift({ id: note.id, text: stripHtml(fields[nt.sortField || 0]).slice(0, 60) || '(пусто)' });
    if (history.length > 30) history.pop();
    editor.clearFields();
    warn.classList.add('hidden');
    editor.focus(0);
    toast(`Добавлено: ${cards.length} ${cards.length === 1 ? 'карточка' : cards.length < 5 ? 'карточки' : 'карточек'}`);
  }

  editor = createEditor({ mode: 'add', typeId: typeId || col.config.lastType, did: deckId ?? defaultDeck(), onSubmit: add, onChange: checkDup });
  if (col.config.defaultDeckMode === 'type' && col.config.typeDeck?.[editor.typeId] != null && col.decks[col.config.typeDeck[editor.typeId]]) { /* колода по типу выбирается внутри редактора при смене типа */ }

  const histBtn = h('button', { class: 'btn', onclick: (e) => {
    const items = history.length
      ? history.map((x) => ({ label: x.text, onClick: () => openEditNote(x.id) }))
      : [{ label: 'История пуста', disabled: true }];
    popupMenu(items, { anchor: e.currentTarget });
  } }, 'История ▾');

  addWin = openWindow({
    title: 'Добавить', width: 600, height: 520, maxWidth: '100%', maximizable: true,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
      h('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } }, editor.el, h('div', { style: { padding: '0 10px' } }, warn)),
      h('div', { class: 'ed-foot' },
        h('button', { class: 'btn primary', title: 'Ctrl+Enter', onclick: add }, 'Добавить'), histBtn,
        h('button', { class: 'btn', onclick: () => addWin.close() }, 'Закрыть'),
        h('button', { class: 'btn', onclick: () => window.open('https://docs.ankiweb.net/editing.html', '_blank', 'noopener') }, 'Справка'))),
    onClose: async () => {
      if (editor.dirty && editor.getFields().some((f) => !isEmptyField(f))) {
        const { confirmDialog } = await import('./ui.js');
        return confirmDialog({ title: 'Закрыть окно', message: 'Отказаться от введённого текста?', okText: 'Закрыть', cancelText: 'Продолжить' });
      }
      return true;
    },
  });
  addWin.onclosed = () => { addWin = null; };
  setTimeout(() => editor.focus(0), 30);
  return addWin;
}

/* Правка существующей записи */
export function openEditNote(nid, onSaved) {
  const note = S.C().notes[nid];
  if (!note) return null;
  const editor = createEditor({ mode: 'edit', note, onSubmit: () => w.close() });
  const save = () => {
    const cur = S.C().notes[nid];
    if (!cur || !editor.dirty) return;
    S.updateNote(nid, editor.getFields(), editor.getTags());
    editor.markClean();
    onSaved?.();
  };
  const w = openWindow({
    title: 'Правка', width: 600, height: 480, maximizable: true,
    onClose: () => { save(); return true; },
    body: h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
      h('div', { style: { flex: 1, overflow: 'auto', minHeight: 0 } }, editor.el),
      h('div', { class: 'ed-foot' },
        h('button', { class: 'btn', onclick: async () => (await import('./preview.js')).openPreview(S.cardsOfNote(nid).map((c) => c.id), 0, () => { save(); }) }, 'Просмотр'),
        h('button', { class: 'btn primary', onclick: () => w.close() }, 'Закрыть'))),
  });
  setTimeout(() => editor.focus(0), 30);
  return w;
}
