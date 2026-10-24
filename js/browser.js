// Список карточек (браузер): боковая панель, поиск, таблица, редактор, массовые операции.
import * as S from './store.js';
import { searchCards, SEARCH_HELP } from './search.js';
import { h, icon, clear, openWindow, popupMenu, promptDialog, confirmDialog, chooserDialog, toast, fmtDate, plural, FLAGS, FLAG_NAMES } from './ui.js';
import { stripHtml, renderQA } from './models.js';
import { createEditor } from './editor.js';
import { deckMenu } from './decks.js';

const ROW = 24;
let win = null;

const CARD_TYPES = ['Новая', 'Изучаемая', 'Повторяемая', 'Переучиваемая'];

const COLS = {
  sfld: { label: 'Поле сортировки', w: 220, cell: (it) => stripHtml(it.note.fields[it.nt.sortField || 0]), key: (it) => stripHtml(it.note.fields[it.nt.sortField || 0]).toLowerCase() },
  qst: { label: 'Вопрос', w: 220, cell: (it) => stripHtml(qa(it).q), key: (it) => stripHtml(it.note.fields[0]).toLowerCase() },
  ans: { label: 'Ответ', w: 220, cell: (it) => { const a = qa(it).a; const i = a.search(/<hr id=answer>/i); return stripHtml(i >= 0 ? a.slice(i + 15) : a); }, key: (it) => stripHtml(it.note.fields[1] || '').toLowerCase() },
  cardType: { label: 'Тип карточки', w: 130, cell: (it) => (it.cards ? `${it.cards.length} ${plural(it.cards.length, 'карточка', 'карточки', 'карточек')}` : it.nt.kind === 'cloze' ? `Пропуск ${it.card.ord + 1}` : it.nt.templates[it.card.ord]?.name || ''), key: (it) => (it.card ? it.card.ord : it.cards.length) },
  noteType: { label: 'Тип записи', w: 160, cell: (it) => it.nt.name, key: (it) => it.nt.name.toLowerCase() },
  deck: { label: 'Колода', w: 160, cell: (it) => (it.card ? S.deckName(it.card.did) : [...new Set(it.cards.map((c) => S.deckName(c.did)))].join(', ')), key: (it) => S.deckName((it.card || it.cards[0]).did).toLowerCase() },
  due: { label: 'К повторению', w: 110, cell: (it) => dueText(it.card || it.cards[0]), key: (it) => dueKey(it.card || it.cards[0]) },
  ivl: { label: 'Интервал', w: 80, cell: (it) => (it.card?.type === 2 ? `${it.card.ivl} д` : ''), key: (it) => it.card?.ivl ?? 0 },
  ease: { label: 'Лёгкость', w: 80, cell: (it) => (it.card?.factor ? `${Math.round(it.card.factor / 10)}%` : ''), key: (it) => it.card?.factor ?? 0 },
  reps: { label: 'Повторений', w: 90, cell: (it) => String(it.card ? it.card.reps : it.cards.reduce((s, c) => s + c.reps, 0)), key: (it) => it.card?.reps ?? 0 },
  lapses: { label: 'Ошибок', w: 70, cell: (it) => String(it.card ? it.card.lapses : it.cards.reduce((s, c) => s + c.lapses, 0)), key: (it) => it.card?.lapses ?? 0 },
  created: { label: 'Создана', w: 100, cell: (it) => fmtDate(it.card ? it.card.created : it.note.id), key: (it) => it.card?.created ?? it.note.id },
  edited: { label: 'Правка', w: 100, cell: (it) => fmtDate(it.note.mod), key: (it) => it.note.mod },
  tags: { label: 'Метки', w: 140, cell: (it) => it.note.tags.join(' '), key: (it) => it.note.tags.join(' ').toLowerCase() },
};

function qa(it) {
  const c = it.card || it.cards[0];
  if (it._qa && it._qaMod === it.note.mod) return it._qa;
  it._qaMod = it.note.mod;
  it._qa = renderQA(it.nt, it.note, c.ord, { deck: S.deckName(c.did) });
  return it._qa;
}
function dueText(c) {
  let t;
  if (c.type === 0) t = `Новая #${c.due}`;
  else if (c.type === 2) t = fmtDate(S.dayStartTs(c.due) * 1000);
  else t = fmtDate(c.due * 1000);
  return c.susp || c.buried === S.dayOf() ? `(${t})` : t;
}
function dueKey(c) { return c.type === 0 ? 1e9 + c.due : c.type === 2 ? c.due * 86400 : c.due; }

export function openBrowser({ search } = {}) {
  if (win && !win.closed) {
    if (search != null) win.setSearch(search);
    win.overlay.style.zIndex = 9999;
    return win;
  }
  const col = S.C();
  const cfg = col.config;
  let mode = cfg.browserMode || 'cards';
  let sort = { ...cfg.browserSort };
  let cols = cfg.browserCols.filter((c) => COLS[c]);
  if (!cols.length) cols = ['sfld', 'cardType', 'due', 'deck'];
  let query = search ?? (cfg.defaultSearch || 'deck:current');
  let rows = [];
  const sel = new Set();
  let anchor = -1, cursor = -1;
  let editor = null, editorKey = null, saveTimer = 0, selfCommit = false, firstSave = true;
  let sideCollapsed = new Set(['Сохранённые запросы']);
  let sideFilter = '';
  let sideVisible = innerWidth > 720;
  let layout = 'auto';

  /* ---------- каркас ---------- */
  const searchInput = h('input', { class: 'input', type: 'text', value: query, placeholder: 'Поиск карточек и записей (введите запрос и нажмите Enter)', 'aria-label': 'Поиск', onkeydown: (e) => { if (e.key === 'Enter') { runSearch(searchInput.value); tableWrap.focus(); } } });
  const modeBtn = h('div', { class: 'seg', role: 'group' });
  const side = h('div', { class: 'br-side' });
  const sideFilterInput = h('input', { class: 'input', type: 'text', placeholder: 'Фильтр боковой панели', style: { minHeight: '22px', padding: '1px 6px' }, oninput: () => { sideFilter = sideFilterInput.value.trim().toLowerCase(); renderSide(); } });
  const thead = h('thead'), tbody = h('tbody');
  const table = h('table', { class: 'grid', role: 'grid' }, thead, tbody);
  const tableWrap = h('div', { class: 'br-table-wrap', tabindex: 0, onscroll: () => drawRows() }, table);
  const status = h('div', { class: 'br-status' });
  const edHost = h('div', { class: 'br-editor' });
  const split = h('div', { class: 'br-split vert' }, h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', minWidth: 0 } }, tableWrap, status), edHost);
  const searchRow = h('div', { class: 'br-top' }, modeBtn, searchInput,
    h('button', { class: 'btn', title: 'Справка по поиску', onclick: searchHelp }, '?'));
  const menubar = h('div', { class: 'menubar-in', role: 'menubar' });
  const body = h('div', { class: 'browser' }, menubar, searchRow, h('div', { class: 'br-main' }, side, h('div', { class: 'br-center' }, split)));

  win = openWindow({
    title: 'Список карточек', width: '92vw', height: '88vh', maximizable: true, className: 'win-browser', body,
    onClose: () => { flushSave(); return true; },
  });
  win.setSearch = (q) => runSearch(q);
  win.onclosed = () => { unsub(); window.removeEventListener('resize', applyLayout); win = null; };
  const unsub = S.onChange(() => { if (!selfCommit) refresh(); });

  /* ---------- данные ---------- */
  function buildRows(cards) {
    if (mode === 'cards') {
      return cards.map((card) => { const note = col.notes[card.nid]; return { key: card.id, card, note, nt: col.noteTypes[note.tid] }; });
    }
    const by = new Map();
    for (const card of cards) {
      let it = by.get(card.nid);
      if (!it) { const note = col.notes[card.nid]; it = { key: note.id, note, nt: col.noteTypes[note.tid], cards: [] }; by.set(card.nid, it); }
      it.cards.push(card);
    }
    return [...by.values()];
  }
  function sortRows() {
    const def = COLS[sort.col] || COLS.sfld;
    const dir = sort.desc ? -1 : 1;
    rows.sort((a, b) => {
      const x = def.key(a), y = def.key(b);
      if (x < y) return -dir;
      if (x > y) return dir;
      return a.key - b.key;
    });
  }
  function runSearch(q, keepSel = false) {
    query = q;
    searchInput.value = q;
    let cards;
    try { cards = searchCards(q); } catch (e) { cards = []; toast('Некорректный запрос'); }
    rows = buildRows(cards);
    sortRows();
    if (keepSel) {
      const keys = new Set(rows.map((r) => r.key));
      for (const k of [...sel]) if (!keys.has(k)) sel.delete(k);
    } else { sel.clear(); anchor = -1; cursor = -1; }
    renderHead();
    tableWrap.scrollTop = keepSel ? tableWrap.scrollTop : 0;
    drawRows();
    updateTitle();
    showEditor();
  }
  function refresh() {
    flushSave();
    runSearch(query, true);
    renderSide();
  }
  function updateTitle() {
    const noun = mode === 'cards' ? 'карточек' : 'записей';
    win.setTitle(`Список ${mode === 'cards' ? 'карточек' : 'записей'} (выбрано ${sel.size} из ${rows.length} ${noun})`);
    status.textContent = `Найдено: ${rows.length}${sel.size ? `, выбрано: ${sel.size}` : ''}`;
  }

  /* ---------- таблица ---------- */
  function renderHead() {
    clear(thead);
    const tr = h('tr');
    cols.forEach((id) => {
      const d = COLS[id];
      const w = cfg.browserWidths?.[id] || d.w;
      const th = h('th', {
        class: `${sort.col === id ? 'sorted' : ''}${sort.col === id && sort.desc ? ' desc' : ''}`, style: { width: w + 'px' },
        onclick: () => { sort = sort.col === id ? { col: id, desc: !sort.desc } : { col: id, desc: false }; S.C().config.browserSort = sort; S.commit(); },
        oncontextmenu: (e) => { e.preventDefault(); colsMenu(e); },
      }, mode === 'notes' && id === 'cardType' ? 'Карточек' : d.label);
      const rs = h('span', { style: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '6px', cursor: 'col-resize' }, onclick: (e) => e.stopPropagation() });
      rs.addEventListener('pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        const x0 = e.clientX, w0 = th.offsetWidth;
        rs.setPointerCapture(e.pointerId);
        const mv = (ev) => { th.style.width = Math.max(40, w0 + ev.clientX - x0) + 'px'; };
        const up = () => { rs.removeEventListener('pointermove', mv); rs.removeEventListener('pointerup', up); cfg.browserWidths = { ...(cfg.browserWidths || {}), [id]: th.offsetWidth }; };
        rs.addEventListener('pointermove', mv); rs.addEventListener('pointerup', up);
      });
      th.style.position = 'sticky';
      th.append(rs);
      tr.append(th);
    });
    thead.append(tr);
  }
  function colsMenu(e) {
    popupMenu(Object.entries(COLS).map(([id, d]) => ({
      label: d.label, checked: cols.includes(id),
      onClick: () => {
        cols = cols.includes(id) ? cols.filter((x) => x !== id) : [...cols, id];
        if (!cols.length) cols = ['sfld'];
        S.C().config.browserCols = cols;
        S.commit();
      },
    })), { x: e.clientX, y: e.clientY });
  }
  function rowClass(it) {
    const c = it.card || it.cards[0];
    const cls = [];
    if (sel.has(it.key)) cls.push('sel');
    if (it.card ? it.card.susp : it.cards.every((x) => x.susp)) cls.push('susp');
    if (it.note.tags.includes('marked')) cls.push('marked');
    if (it.card ? it.card.buried === S.dayOf() : false) cls.push('buried');
    if (c.flag) cls.push('f' + c.flag);
    return cls.join(' ');
  }
  function drawRows() {
    const vh = tableWrap.clientHeight || 400;
    const start = Math.max(0, Math.floor(tableWrap.scrollTop / ROW) - 12);
    const end = Math.min(rows.length, start + Math.ceil(vh / ROW) + 24);
    clear(tbody);
    if (!rows.length) {
      tbody.append(h('tr', {}, h('td', { colspan: cols.length, class: 'br-empty', style: { height: '80px', whiteSpace: 'normal' } }, 'Ничего не найдено.')));
      return;
    }
    if (start > 0) tbody.append(h('tr', { 'aria-hidden': 'true' }, h('td', { colspan: cols.length, style: { height: start * ROW + 'px', padding: 0 } })));
    for (let i = start; i < end; i++) {
      const it = rows[i];
      tbody.append(h('tr', { class: rowClass(it), 'data-i': i, style: { height: ROW + 'px' }, 'aria-selected': sel.has(it.key) ? 'true' : 'false' },
        cols.map((id) => h('td', { title: COLS[id].cell(it) }, COLS[id].cell(it)))));
    }
    if (end < rows.length) tbody.append(h('tr', { 'aria-hidden': 'true' }, h('td', { colspan: cols.length, style: { height: (rows.length - end) * ROW + 'px', padding: 0 } })));
  }
  tbody.addEventListener('mousedown', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const i = +tr.dataset.i;
    if (e.button === 2 && sel.has(rows[i].key)) return;
    select(i, e);
  });
  tbody.addEventListener('contextmenu', (e) => { e.preventDefault(); const tr = e.target.closest('tr[data-i]'); if (tr) rowMenu(e); });
  tbody.addEventListener('dblclick', () => { if (sel.size) edHost.querySelector('[contenteditable]')?.focus(); });

  function select(i, e) {
    if (e?.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      if (!(e.ctrlKey || e.metaKey)) sel.clear();
      for (let k = a; k <= b; k++) sel.add(rows[k].key);
    } else if (e && (e.ctrlKey || e.metaKey)) {
      const k = rows[i].key;
      if (sel.has(k)) sel.delete(k); else sel.add(k);
      anchor = i;
    } else { sel.clear(); sel.add(rows[i].key); anchor = i; }
    cursor = i;
    selChanged();
  }
  function selChanged() {
    drawRows();
    updateTitle();
    showEditor();
  }
  function moveSel(d, extend) {
    if (!rows.length) return;
    const base = cursor >= 0 ? cursor : anchor;
    let n = Math.min(rows.length - 1, Math.max(0, base + d));
    if (base < 0) n = d > 0 ? 0 : rows.length - 1;
    if (extend && anchor >= 0) {
      const [lo, hi] = [Math.min(anchor, n), Math.max(anchor, n)];
      sel.clear();
      for (let k = lo; k <= hi; k++) sel.add(rows[k].key);
    } else { anchor = n; sel.clear(); sel.add(rows[n].key); }
    cursor = n;
    const top = n * ROW, bot = top + ROW;
    if (top < tableWrap.scrollTop) tableWrap.scrollTop = top;
    else if (bot > tableWrap.scrollTop + tableWrap.clientHeight - ROW) tableWrap.scrollTop = bot - tableWrap.clientHeight + ROW * 2;
    selChanged();
  }

  const selItems = () => rows.filter((r) => sel.has(r.key));
  const selCards = () => selItems().flatMap((r) => (r.card ? [r.card] : r.cards));
  const selNotes = () => [...new Set(selItems().map((r) => r.note.id))];

  /* ---------- редактор ---------- */
  function flushSave() {
    clearTimeout(saveTimer);
    if (editor && editor.dirty && col.notes[editorKey]) {
      selfCommit = true;
      try {
        S.updateNote(editorKey, editor.getFields(), editor.getTags(), { undo: firstSave });
        firstSave = false;
      } finally { selfCommit = false; }
      editor.markClean();
      drawRows();
    }
  }
  function showEditor() {
    const items = selItems();
    const key = items.length === 1 ? items[0].note.id : null;
    if (key === editorKey && editor) { applyLayout(); return; }
    flushSave();
    editor?.destroy();
    editor = null; editorKey = key; firstSave = true;
    clear(edHost);
    if (key == null) {
      edHost.append(h('div', { class: 'br-empty' }, items.length ? `Выбрано записей: ${items.length}` : 'Выберите карточку, чтобы увидеть её содержимое.'));
    } else {
      editor = createEditor({ mode: 'edit', note: col.notes[key], onChange: () => { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 700); } });
      edHost.append(editor.el);
    }
    applyLayout();
  }
  function applyLayout() {
    const wide = layout === 'horiz' || (layout === 'auto' && win.el.clientWidth > 1150);
    split.className = `br-split ${wide ? 'horiz' : 'vert'}`;
    edHost.classList.toggle('side', wide);
    edHost.style.display = editorKey == null && !sel.size ? 'none' : '';
  }
  window.addEventListener('resize', applyLayout);

  /* ---------- боковая панель ---------- */
  const q = (s) => (/[\s"():]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s);
  function sideSearch(s, e) {
    if (e?.ctrlKey || e?.metaKey) runSearch(`${query} ${s}`.trim());
    else if (e?.altKey) runSearch(`${query} -${s}`.trim());
    else runSearch(s);
  }
  function renderSide() {
    const top = h('div', { class: 'side-filter' }, sideFilterInput);
    clear(side).append(top);
    const sec = (name, ic, children, extra) => {
      const open = !sideCollapsed.has(name) || sideFilter;
      const head = h('div', { class: 'side-item', onclick: () => { if (sideCollapsed.has(name)) sideCollapsed.delete(name); else sideCollapsed.add(name); renderSide(); }, oncontextmenu: extra?.onctx },
        h('span', { class: 'tw' }, icon(open ? 'chevron' : 'right', 11)), ic, name);
      const items = open ? children : [];
      if (sideFilter && !items.length) return;
      side.append(head, ...items);
    };
    const item = (label, search, { depth = 1, dot, ic, onctx, tw } = {}) => {
      if (sideFilter && !label.toLowerCase().includes(sideFilter)) return null;
      return h('div', { class: `side-item${query === search ? ' sel' : ''}`, style: { paddingLeft: 6 + depth * 14 + 'px' }, title: search, onclick: (e) => sideSearch(search, e), oncontextmenu: onctx ? (e) => { e.preventDefault(); onctx(e); } : null },
        tw ?? h('span', { class: 'tw' }), dot ? h('span', { class: 'dot', style: { background: dot } }) : ic || null, label);
    };
    const f = (a) => a.filter(Boolean);

    const saved = Object.entries(col.savedSearches || {});
    sec('Сохранённые запросы', icon('search', 12), f(saved.map(([name, s]) => item(name, s, { onctx: (e) => popupMenu([{ label: 'Переименовать', onClick: async () => { const n = await promptDialog({ title: 'Переименовать', label: 'Название:', value: name }); if (n?.trim()) { delete col.savedSearches[name]; col.savedSearches[n.trim()] = s; S.commit(); } } }, { label: 'Удалить', onClick: () => { delete col.savedSearches[name]; S.commit(); } }], { x: e.clientX, y: e.clientY }) }))),
    { onctx: (e) => { e.preventDefault(); popupMenu([{ label: 'Сохранить текущий запрос…', onClick: async () => { const n = await promptDialog({ title: 'Сохранить запрос', label: 'Название:', value: query }); if (n?.trim()) { col.savedSearches = { ...(col.savedSearches || {}), [n.trim()]: query }; S.commit(); } } }], { x: e.clientX, y: e.clientY }); } });
    sec('Сегодня', icon('search', 12), f([
      item('К повторению', 'is:due'), item('Добавлено', 'added:1'), item('Правлено', 'edited:1'), item('Изучено', 'rated:1'),
      item('Первое повторение', 'introduced:1'), item('Снова', 'rated:1:1'), item('Просрочено', 'prop:due<0')]));
    sec('Флажки', icon('flag', 12), f([item('Без флажка', 'flag:0'), ...FLAGS.map((fl, i) => item(FLAG_NAMES[i], `flag:${i + 1}`, { dot: fl.color }))]));
    sec('Состояние карточки', icon('search', 12), f([
      item('Новые', 'is:new', { dot: '#6aa7ff' }), item('Изучаемые', 'is:learn', { dot: '#ff6b6b' }), item('Повторяемые', 'is:review', { dot: '#3ad07a' }),
      item('Исключена', 'is:suspended', { dot: '#e8d96b' }), item('Отложена', 'is:buried', { dot: '#a0522d' })]));
    // колоды
    const deckItems = [item('Текущая колода', 'deck:current')];
    for (const { deck, depth, short } of S.deckList({ all: true })) {
      deckItems.push(item(short, `deck:${q(deck.name)}`, { depth: depth + 1, onctx: (e) => deckMenu(deck.id, { x: e.clientX, y: e.clientY, onChange: () => refresh() }) }));
    }
    sec('Колоды', icon('search', 12), f(deckItems));
    // типы записей
    const ntItems = [];
    for (const nt of S.noteTypes()) {
      ntItems.push(item(nt.name, `note:${q(nt.name)}`, { onctx: (e) => popupMenu([{ label: 'Управление типами записей', onClick: async () => (await import('./notetypes.js')).openManageTypes(() => refresh()) }], { x: e.clientX, y: e.clientY }) }));
      if (nt.kind !== 'cloze') nt.templates.forEach((t, i) => ntItems.push(item(t.name, `note:${q(nt.name)} card:${i + 1}`, { depth: 2 })));
    }
    sec('Типы записей', icon('search', 12), f(ntItems));
    // метки
    const tagItems = [item('Без метки', 'tag:none')];
    for (const t of S.allTags()) {
      const parts = t.split('::');
      tagItems.push(item(parts.at(-1), `tag:${q(t)}`, { depth: parts.length, onctx: (e) => popupMenu([
        { label: 'Переименовать…', onClick: async () => { const n = await promptDialog({ title: 'Переименовать метку', label: 'Новое имя:', value: t }); if (n?.trim()) renameTag(t, n.trim()); } },
        { label: 'Удалить метку', onClick: async () => { if (await confirmDialog({ title: 'Удалить метку', danger: true, okText: 'Удалить', message: `Убрать метку «${t}» у всех записей?` })) { S.removeTags(Object.values(col.notes).filter((n) => n.tags.includes(t)).map((n) => n.id), [t]); } } },
      ], { x: e.clientX, y: e.clientY }) }));
    }
    sec('Метки', icon('tag', 12), f(tagItems));
  }
  function renameTag(from, to) {
    const ids = Object.values(col.notes).filter((n) => n.tags.some((t) => t === from || t.startsWith(from + '::'))).map((n) => n.id);
    ids.forEach((id) => { const n = col.notes[id]; n.tags = n.tags.map((t) => (t === from ? to : t.startsWith(from + '::') ? to + t.slice(from.length) : t)); n.mod = Date.now(); });
    S.commit();
  }

  /* ---------- операции ---------- */
  const need = (n = 1) => { if (sel.size < n) { toast('Сначала выберите карточки'); return false; } return true; };

  const ops = {
    async add() { (await import('./add.js')).openAdd({}); },
    duplicate() { if (!need()) return; selNotes().forEach((id) => S.duplicateNote(id)); toast('Копии созданы'); },
    async addTags() {
      if (!need()) return;
      const v = await promptDialog({ title: 'Добавить метки', label: 'Метки (через пробел):' });
      if (v?.trim()) S.addTags(selNotes(), v.trim().split(/\s+/));
    },
    async removeTags() {
      if (!need()) return;
      const v = await promptDialog({ title: 'Удалить метки', label: 'Метки (через пробел):' });
      if (v?.trim()) S.removeTags(selNotes(), v.trim().split(/\s+/));
    },
    mark() { if (need()) S.toggleMark(selNotes()); },
    async del() {
      if (!need()) return;
      const n = selNotes().length;
      if (await confirmDialog({ title: 'Удаление', danger: true, okText: 'Удалить', message: `Удалить ${n} ${plural(n, 'запись', 'записи', 'записей')} со всеми карточками?` })) {
        S.deleteNotes(selNotes()); sel.clear(); toast('Удалено. Можно отменить (Ctrl+Z).');
      }
    },
    async changeDeck() {
      if (!need()) return;
      const id = await chooserDialog({ title: 'Выбрать колоду', selected: selCards()[0].did, items: S.deckList({ all: true }).map(({ deck }) => ({ id: deck.id, label: deck.name })),
        extra: [{ label: 'Добавить', onClick: async () => { const n = await promptDialog({ title: 'Новая колода', label: 'Название:' }); if (n?.trim()) { const nid = S.createDeck(n); S.moveCards(selCards().map((c) => c.id), nid); } } }] });
      if (id != null) S.moveCards(selCards().map((c) => c.id), id);
    },
    async setDue() {
      if (!need()) return;
      const v = await promptDialog({ title: 'Задать срок', label: 'Через сколько дней показать (0 — сегодня; 3–7 — случайно; 3! — сбросить интервал):', value: '0', validate: (x) => (/^\s*\d+(\s*-\s*\d+)?\s*!?\s*$/.test(x) ? '' : 'Введите число, диапазон или число с «!»') });
      if (v != null) S.setDue(selCards().map((c) => c.id), v);
    },
    async forget() {
      if (!need()) return;
      if (await confirmDialog({ title: 'Сбросить', okText: 'Сбросить', message: 'Вернуть выбранные карточки в очередь новых и обнулить их статистику?' })) S.forgetCards(selCards().map((c) => c.id));
    },
    suspend() { if (!need()) return; const cs = selCards(); S.setSuspended(cs.map((c) => c.id), !cs.every((c) => c.susp)); },
    bury() { if (!need()) return; const cs = selCards(); const all = cs.every((c) => c.buried === S.dayOf()); (all ? S.unburyCards : S.buryCards)(cs.map((c) => c.id)); },
    flag(n) { if (!need()) return; const cs = selCards(); S.setFlag(cs.map((c) => c.id), cs.every((c) => c.flag === n) ? 0 : n); },
    async info() { if (!need()) return; (await import('./info.js')).openCardInfo(selCards()[0].id); },
    async preview() { if (!need()) return; (await import('./preview.js')).openPreview(selCards().map((c) => c.id), 0); },
    async exportSel() { if (!need()) return; (await import('./io.js')).openExport(null, selNotes()); },
    async manageTypes() { (await import('./notetypes.js')).openManageTypes(() => refresh()); },
    findDupes, findReplace,
    toggleMode() { mode = mode === 'cards' ? 'notes' : 'cards'; S.C().config.browserMode = mode; renderMode(); runSearch(query); },
    selectAll() { rows.forEach((r) => sel.add(r.key)); selChanged(); },
    invert() { rows.forEach((r) => { if (sel.has(r.key)) sel.delete(r.key); else sel.add(r.key); }); selChanged(); },
  };

  async function findDupes() {
    const types = S.noteTypes();
    const typeSel = h('select', { class: 'input' }, types.map((t) => h('option', { value: t.id }, t.name)));
    const fieldSel = h('select', { class: 'input' });
    const fill = () => { clear(fieldSel).append(...S.noteType(typeSel.value).fields.map((f, i) => h('option', { value: i }, f))); };
    typeSel.onchange = fill; fill();
    const out = h('div', { style: { maxHeight: '240px', overflow: 'auto', fontSize: '.85rem' } });
    const w = openWindow({
      title: 'Поиск дубликатов', width: 480, className: 'dlg',
      body: h('div', { class: 'dlg-body' }, h('label', {}, 'Тип записи'), typeSel, h('label', {}, 'Поле'), fieldSel, out,
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: go }, 'Найти'), h('button', { class: 'btn', onclick: () => w.close() }, 'Закрыть'))),
    });
    function go() {
      const idx = +fieldSel.value;
      const groups = new Map();
      for (const n of Object.values(col.notes)) {
        if (n.tid !== typeSel.value) continue;
        const k = stripHtml(n.fields[idx]).toLowerCase();
        if (!k) continue;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(n.id);
      }
      const d = [...groups.entries()].filter(([, ids]) => ids.length > 1);
      clear(out);
      if (!d.length) out.append(h('p', {}, 'Дубликатов не найдено.'));
      d.forEach(([k, ids]) => out.append(h('div', { style: { display: 'flex', gap: '8px', padding: '3px 0', alignItems: 'center' } },
        h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, `${k} (${ids.length})`),
        h('button', { class: 'btn sm', onclick: () => { runSearch(`nid:${ids.join(',')}`); } }, 'Показать'))));
    }
  }

  function findReplace() {
    const targets = selNotes();
    const find = h('input', { class: 'input', type: 'text' }), rep = h('input', { class: 'input', type: 'text' });
    const nt0 = [...new Set(selItems().map((i) => i.nt))];
    const fieldNames = [...new Set((nt0.length ? nt0 : S.noteTypes()).flatMap((t) => t.fields))];
    const inSel = h('select', { class: 'input' }, h('option', { value: '*' }, 'Все поля'), h('option', { value: '__tags' }, 'Метки'), fieldNames.map((f) => h('option', { value: f }, f)));
    const onlySel = h('input', { type: 'checkbox', checked: targets.length > 0 });
    const ic = h('input', { type: 'checkbox', checked: true }), rx = h('input', { type: 'checkbox' });
    const w = openWindow({
      title: 'Найти и заменить', width: 440, className: 'dlg',
      body: h('div', { class: 'dlg-body' }, h('label', {}, 'Найти:'), find, h('label', {}, 'Заменить на:'), rep, h('label', {}, 'В:'), inSel,
        h('label', { class: 'chk' }, onlySel, 'Только в выбранных записях'), h('label', { class: 'chk' }, ic, 'Игнорировать регистр'), h('label', { class: 'chk' }, rx, 'Регулярное выражение'),
        h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: go }, 'OK'), h('button', { class: 'btn', onclick: () => w.close() }, 'Отмена'))),
    });
    setTimeout(() => find.focus(), 0);
    function go() {
      if (!find.value) return;
      let re;
      try { re = new RegExp(rx.checked ? find.value : find.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), ic.checked ? 'gi' : 'g'); } catch { toast('Некорректное выражение'); return; }
      const ids = onlySel.checked ? targets : [...new Set(rows.map((r) => r.note.id))];
      let count = 0;
      const before = ids.map((id) => [id, [...col.notes[id].fields], [...col.notes[id].tags]]);
      for (const id of ids) {
        const n = col.notes[id], nt = S.noteType(n.tid);
        let ch = false;
        if (inSel.value === '__tags') {
          const nt2 = n.tags.map((t) => t.replace(re, rep.value));
          if (nt2.join() !== n.tags.join()) { n.tags = nt2; ch = true; }
        } else {
          n.fields = n.fields.map((f, i) => {
            if (inSel.value !== '*' && nt.fields[i] !== inSel.value) return f;
            const nf = f.replace(re, rep.value);
            if (nf !== f) ch = true;
            return nf;
          });
        }
        if (ch) { n.mod = Date.now(); count++; }
      }
      S.pushUndo('Найти и заменить', () => before.forEach(([id, f, t]) => { if (col.notes[id]) { col.notes[id].fields = f; col.notes[id].tags = t; } }));
      S.commit();
      w.close(true);
      toast(`Изменено записей: ${count}`);
    }
  }

  function searchHelp() {
    openWindow({
      title: 'Поиск: справка', width: 640, height: 520, maximizable: true,
      body: h('div', { style: { padding: '12px 16px', overflow: 'auto' } }, h('table', { class: 'help-table' }, SEARCH_HELP.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b))))),
    });
  }

  /* ---------- меню ---------- */
  const flagSub = () => [...FLAGS.map((f, i) => ({ label: FLAG_NAMES[i], shortcut: `Ctrl+${i + 1}`, onClick: () => ops.flag(i + 1) }))];
  const noteMenuItems = () => [
    { label: 'Добавить записи…', shortcut: 'Ctrl+E', onClick: ops.add },
    { label: 'Создать копию', disabled: !sel.size, onClick: ops.duplicate },
    { label: 'Экспортировать записи…', disabled: !sel.size, onClick: ops.exportSel },
    { sep: true },
    { label: 'Добавить метки…', shortcut: 'Ctrl+Shift+A', disabled: !sel.size, onClick: ops.addTags },
    { label: 'Удалить метки…', shortcut: 'Ctrl+Alt+Shift+A', disabled: !sel.size, onClick: ops.removeTags },
    { label: 'Отметить / снять отметку', shortcut: 'Ctrl+K', disabled: !sel.size, onClick: ops.mark },
    { sep: true },
    { label: 'Найти дубликаты…', onClick: ops.findDupes },
    { label: 'Найти и заменить…', shortcut: 'Ctrl+Alt+F', onClick: ops.findReplace },
    { label: 'Управление типами записей', onClick: ops.manageTypes },
    { sep: true },
    { label: 'Удалить', shortcut: 'Ctrl+Del', disabled: !sel.size, onClick: ops.del },
  ];
  const cardMenuItems = () => [
    { label: 'В другую колоду…', shortcut: 'Ctrl+D', disabled: !sel.size, onClick: ops.changeDeck },
    { label: 'Задать срок…', shortcut: 'Ctrl+Shift+D', disabled: !sel.size, onClick: ops.setDue },
    { label: 'Сбросить…', shortcut: 'Ctrl+Alt+N', disabled: !sel.size, onClick: ops.forget },
    { sep: true },
    { label: 'Исключить / включить', shortcut: 'Ctrl+J', disabled: !sel.size, onClick: ops.suspend },
    { label: 'Отложить / вернуть', shortcut: 'Ctrl+Shift+J', disabled: !sel.size, onClick: ops.bury },
    { label: 'Флажок', disabled: !sel.size, submenu: flagSub() },
    { sep: true },
    { label: 'Просмотр', shortcut: 'Ctrl+Shift+P', disabled: !sel.size, onClick: ops.preview },
    { label: 'Информация', shortcut: 'Ctrl+Shift+I', disabled: !sel.size, onClick: ops.info },
  ];
  function rowMenu(e) { popupMenu([...cardMenuItems(), { sep: true }, ...noteMenuItems().filter((x) => !['Добавить записи…', 'Управление типами записей', 'Найти дубликаты…'].includes(x.label))], { x: e.clientX, y: e.clientY }); }

  const menuDefs = [
    ['Правка', () => [
      { label: S.undoLabel() ? `Отменить: ${S.undoLabel()}` : 'Отменить', shortcut: 'Ctrl+Z', disabled: !S.undoLabel(), onClick: () => S.undo() },
      { sep: true }, { label: 'Выделить всё', shortcut: 'Ctrl+A', onClick: ops.selectAll }, { label: 'Инвертировать выделение', shortcut: 'Ctrl+Alt+S', onClick: ops.invert },
    ]],
    ['Вид', () => [
      { label: mode === 'cards' ? 'Показать записи' : 'Показать карточки', shortcut: 'Ctrl+Alt+T', onClick: ops.toggleMode },
      { label: 'Боковая панель', checked: sideVisible, shortcut: 'Ctrl+Shift+R', onClick: toggleSide },
      { sep: true },
      { label: 'Расположение: авто', checked: layout === 'auto', onClick: () => { layout = 'auto'; applyLayout(); } },
      { label: 'Редактор справа', checked: layout === 'horiz', onClick: () => { layout = 'horiz'; applyLayout(); } },
      { label: 'Редактор снизу', checked: layout === 'vert', onClick: () => { layout = 'vert'; applyLayout(); } },
    ]],
    ['Записи', noteMenuItems],
    ['Карточки', cardMenuItems],
    ['Перейти', () => [
      { label: 'Найти', shortcut: 'Ctrl+F', onClick: () => { searchInput.focus(); searchInput.select(); } },
      { label: 'Фильтр боковой панели', shortcut: 'Ctrl+Shift+F', onClick: () => { sideVisible = true; side.classList.remove('hidden'); sideFilterInput.focus(); } },
      { sep: true },
      { label: 'Первая карточка', shortcut: 'Home', onClick: () => moveSel(-1e9) }, { label: 'Предыдущая', shortcut: '↑', onClick: () => moveSel(-1) },
      { label: 'Следующая', shortcut: '↓', onClick: () => moveSel(1) }, { label: 'Последняя', shortcut: 'End', onClick: () => moveSel(1e9) },
    ]],
    ['Справка', () => [{ label: 'Синтаксис поиска', onClick: searchHelp }]],
  ];
  menuDefs.forEach(([label, items]) => {
    const b = h('button', { type: 'button', onclick: (e) => { popupMenu(items(), { anchor: e.currentTarget }); } }, label);
    menubar.append(b);
  });
  function toggleSide() { sideVisible = !sideVisible; side.classList.toggle('hidden', !sideVisible); }

  function renderMode() {
    clear(modeBtn).append(
      h('button', { class: mode === 'cards' ? 'on' : '', onclick: () => mode !== 'cards' && ops.toggleMode() }, 'Карточки'),
      h('button', { class: mode === 'notes' ? 'on' : '', onclick: () => mode !== 'notes' && ops.toggleMode() }, 'Записи'));
  }

  /* ---------- клавиши ---------- */
  win.el.addEventListener('keydown', (e) => {
    const t = e.target;
    const inField = t.matches('input, textarea, select, [contenteditable]');
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'f' && !e.shiftKey && !e.altKey) { e.preventDefault(); searchInput.focus(); searchInput.select(); return; }
    if (ctrl && e.shiftKey && k === 'f') { e.preventDefault(); sideFilterInput.focus(); return; }
    if (ctrl && e.altKey && k === 't') { e.preventDefault(); ops.toggleMode(); return; }
    if (ctrl && e.shiftKey && k === 'r') { e.preventDefault(); toggleSide(); return; }
    if (ctrl && k === 'e' && !e.shiftKey) { e.preventDefault(); ops.add(); return; }
    if (inField && !(ctrl && (e.key === 'Delete' || /^[1-7]$/.test(e.key) || ['k', 'd', 'j'].includes(k) || e.altKey || e.shiftKey))) return;
    if (ctrl && e.key === 'Delete') { e.preventDefault(); ops.del(); }
    else if (ctrl && /^[1-7]$/.test(e.key)) { e.preventDefault(); ops.flag(+e.key); }
    else if (ctrl && k === 'k') { e.preventDefault(); ops.mark(); }
    else if (ctrl && !e.shiftKey && !e.altKey && k === 'd') { e.preventDefault(); ops.changeDeck(); }
    else if (ctrl && e.shiftKey && !e.altKey && k === 'd') { e.preventDefault(); ops.setDue(); }
    else if (ctrl && e.altKey && !e.shiftKey && k === 'n') { e.preventDefault(); ops.forget(); }
    else if (ctrl && !e.shiftKey && k === 'j') { e.preventDefault(); ops.suspend(); }
    else if (ctrl && e.shiftKey && k === 'j') { e.preventDefault(); ops.bury(); }
    else if (ctrl && e.shiftKey && !e.altKey && k === 'a') { e.preventDefault(); ops.addTags(); }
    else if (ctrl && e.shiftKey && e.altKey && k === 'a') { e.preventDefault(); ops.removeTags(); }
    else if (ctrl && e.altKey && k === 'f') { e.preventDefault(); ops.findReplace(); }
    else if (ctrl && e.shiftKey && k === 'i') { e.preventDefault(); ops.info(); }
    else if (ctrl && e.shiftKey && k === 'p') { e.preventDefault(); ops.preview(); }
    else if (ctrl && !e.shiftKey && k === 'a' && !inField) { e.preventDefault(); ops.selectAll(); }
    else if (ctrl && !e.shiftKey && k === 'z' && !inField) { e.preventDefault(); S.undo(); }
    else if (!inField && e.key === 'ArrowDown') { e.preventDefault(); moveSel(1, e.shiftKey); }
    else if (!inField && e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1, e.shiftKey); }
    else if (!inField && e.key === 'PageDown') { e.preventDefault(); moveSel(15, e.shiftKey); }
    else if (!inField && e.key === 'PageUp') { e.preventDefault(); moveSel(-15, e.shiftKey); }
    else if (!inField && e.key === 'Home') { e.preventDefault(); moveSel(-1e9, e.shiftKey); }
    else if (!inField && e.key === 'End') { e.preventDefault(); moveSel(1e9, e.shiftKey); }
  });

  side.classList.toggle('hidden', !sideVisible);
  renderMode();
  renderSide();
  runSearch(query);
  setTimeout(() => { searchInput.focus(); searchInput.select(); }, 30);
  return win;
}
