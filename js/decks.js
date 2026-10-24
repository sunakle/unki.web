// Экран «Колоды» и экран отдельной колоды.
import * as S from './store.js';
import * as sched from './sched.js';
import { h, icon, clear, popupMenu, promptDialog, confirmDialog, openWindow, toast, fmtNum, plural } from './ui.js';
import { sanitizeHtml } from './models.js';

function todayLine() {
  const col = S.C();
  const start = S.dayStartTs(S.dayOf()) * 1000;
  let n = 0, ms = 0;
  for (let i = col.revlog.length - 1; i >= 0; i--) {
    const r = col.revlog[i];
    if (r.id < start) break;
    n++; ms += r.time;
  }
  const sec = Math.round(ms / 1000);
  const per = n ? (sec / n).toFixed(1).replace('.', ',') : '0';
  const span = sec < 60
    ? `${sec} ${plural(sec, 'секунду', 'секунды', 'секунд')}`
    : `${Math.round(sec / 60)} ${plural(Math.round(sec / 60), 'минуту', 'минуты', 'минут')}`;
  return `Сегодня ${n} ${plural(n, 'карточка', 'карточки', 'карточек')} за ${span} (${per} с/карт.)`;
}

export function deckMenu(did, { onChange, anchor, x, y } = {}) {
  return popupMenu([
    { label: 'Переименовать', onClick: async () => {
      const name = await promptDialog({ title: 'Переименовать колоду', label: 'Новое название:', value: S.deckName(did) });
      if (name?.trim()) {
        if (!S.renameDeck(did, name)) toast('Колода с таким названием уже есть');
        onChange?.();
      }
    } },
    { label: 'Параметры', onClick: async () => (await import('./options.js')).openDeckOptions(did) },
    { label: 'Экспортировать…', onClick: async () => (await import('./io.js')).openExport(did) },
    { label: 'Удалить', onClick: async () => {
      const n = sched.deckCounts()[did]?.total || 0;
      const ok = await confirmDialog({ title: 'Удалить колоду', danger: true, okText: 'Удалить', message: `Удалить колоду «${S.deckName(did)}»${n ? ` и ${fmtNum(n)} ${plural(n, 'карточку', 'карточки', 'карточек')} в ней` : ''}?\nДействие можно отменить через Правка → Отменить (Ctrl+Z).` });
      if (ok) { S.deleteDeck(did); toast('Колода удалена. Можно отменить (Ctrl+Z).'); onChange?.(); }
    } },
  ], { anchor, x, y, align: 'right' });
}

export function renderDecks(main, bottom, nav) {
  const col = S.C();
  const counts = sched.deckCounts();
  const list = S.deckList();
  const hideDefault = (counts[1]?.total || 0) === 0 && Object.keys(col.decks).length > 1;
  const rows = list.filter(({ deck }) => !(hideDefault && deck.id === 1));

  const table = h('div', { class: 'deck-table', role: 'table', 'aria-label': 'Колоды' },
    h('div', { class: 'deck-head', role: 'row' }, h('span', {}, 'Колода'), h('span', {}, 'Новые'), h('span', {}, 'Изучаемые'), h('span', {}, 'К повторению'), h('span')));
  for (const { deck, depth, short, hasChildren } of rows) {
    const c = counts[deck.id] || { new: 0, lrn: 0, rev: 0 };
    const num = (k) => h('span', { class: `deck-num ${k}${c[k] ? ' nz' : ''}` }, fmtNum(c[k]));
    const gear = h('button', { class: 'gear-btn', title: 'Параметры колоды', 'aria-label': `Параметры колоды ${short}`, onclick: (e) => { e.stopPropagation(); deckMenu(deck.id, { anchor: e.currentTarget, onChange: () => nav.refresh() }); } }, icon('gear', 15));
    const toggle = hasChildren
      ? h('button', { class: `collapse${deck.collapsed ? ' closed' : ''}`, 'aria-label': deck.collapsed ? 'Развернуть' : 'Свернуть', onclick: (e) => { e.stopPropagation(); S.setDeckCollapsed(deck.id, !deck.collapsed); } }, icon('chevron', 14))
      : h('span', { style: { width: '16px', flex: 'none' } });
    const row = h('div', { class: `deck-row${deck.id === col.config.curDeck ? ' cur' : ''}`, role: 'row', oncontextmenu: (e) => { e.preventDefault(); deckMenu(deck.id, { x: e.clientX, y: e.clientY, onChange: () => nav.refresh() }); } },
      h('span', { class: 'deck-name', style: { paddingLeft: depth * 16 + 'px' } }, toggle,
        h('a', { href: `#/deck/${deck.id}`, title: deck.name, onclick: (e) => { e.preventDefault(); nav.openDeck(deck.id); } }, short)),
      num('new'), num('lrn'), num('rev'), gear);
    table.append(row);
  }
  const empty = Object.keys(col.cards).length === 0;
  const welcome = empty ? h('div', { class: 'welcome' },
    h('h2', {}, 'Добро пожаловать в Unki'),
    h('p', {}, 'Пока здесь нет ни одной карточки. Добавьте первые записи или импортируйте колоду из файла.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'bbtn primary', onclick: async () => (await import('./add.js')).openAdd({ deckId: col.config.curDeck }) }, 'Добавить карточки'),
      h('button', { class: 'bbtn', onclick: async () => (await import('./io.js')).openImport() }, 'Импортировать'))) : null;
  clear(main).append(h('div', { class: 'decks-wrap' }, table, h('div', { class: 'today-line' }, todayLine()), welcome));

  clear(bottom).append(
    h('button', { class: 'bbtn', onclick: () => window.open('https://ankiweb.net/shared/decks', '_blank', 'noopener') }, 'Скачать колоду'),
    h('button', { class: 'bbtn', onclick: async () => {
      const name = await promptDialog({ title: 'Создать колоду', label: 'Название новой колоды (вложенные: Родитель::Дочерняя):', placeholder: 'Название' });
      if (name?.trim()) { const id = S.createDeck(name); S.setConfig({ curDeck: id }); toast('Колода создана'); }
    } }, 'Создать колоду'),
    h('button', { class: 'bbtn', onclick: async () => (await import('./io.js')).openImport() }, 'Импортировать'));
}

/* ---------- экран колоды ---------- */

export function renderOverview(main, bottom, did, nav) {
  const col = S.C();
  const deck = col.decks[did];
  if (!deck) { nav.go('decks'); return; }
  S.C().config.curDeck = did;
  const q = sched.buildQueue(did);
  const total = q.counts.new + q.counts.lrn + q.counts.rev;
  const wrap = h('div', { class: total ? 'overview' : 'congrats' });
  clear(main).append(wrap);

  const descHtml = deck.desc ? h('div', { class: 'ov-desc', html: sanitizeHtml(deck.desc) }) : null;

  if (total > 0) {
    wrap.append(
      h('h1', {}, deck.name.split('::').pop()),
      h('div', { class: 'ov-counts' },
        h('span', { class: 'new' }, 'Новые:'), h('b', { class: 'new' }, fmtNum(q.counts.new)),
        h('span', { class: 'lrn' }, 'Изучаемые:'), h('b', { class: 'lrn' }, fmtNum(q.counts.lrn)),
        h('span', { class: 'rev' }, 'К повторению:'), h('b', { class: 'rev' }, fmtNum(q.counts.rev))),
      h('div', {}, h('button', { class: 'bbtn big primary', id: 'study-btn', onclick: () => nav.study(did) }, 'Учить сейчас')),
      descHtml);
  } else {
    const nextLater = q.later[0];
    wrap.append(
      h('h1', {}, 'Ура! На сегодня всё.'),
      nextLater ? h('p', {}, `Следующая изучаемая карточка будет доступна через ${sched.fmtSpan(nextLater.due - S.nowSec())}.`) : null,
      h('p', {}, 'Если вы хотите заниматься вне расписания, начните ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); customStudy(did, () => nav.refresh()); } }, 'допзанятие'), '.'),
      descHtml);
  }

  clear(bottom).append(
    h('button', { class: 'bbtn', onclick: async () => (await import('./options.js')).openDeckOptions(did) }, 'Параметры'),
    total === 0 ? h('button', { class: 'bbtn', onclick: () => customStudy(did, () => nav.refresh()) }, 'Учить ещё') : null,
    h('button', { class: 'bbtn', onclick: () => editDescription(did, () => nav.refresh()) }, 'Описание'));
  setTimeout(() => { if (!document.querySelector('.win-overlay')) document.getElementById('study-btn')?.focus(); }, 0);
}

function editDescription(did, done) {
  const deck = S.C().decks[did];
  const ta = h('textarea', { class: 'input', rows: 10, value: deck.desc || '', placeholder: 'Описание колоды (можно использовать HTML)' });
  const w = openWindow({
    title: `Описание: ${deck.name}`, width: 520, className: 'dlg',
    body: h('div', { class: 'dlg-body' }, ta,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => { deck.desc = ta.value; S.commit(); w.close(true); done?.(); } }, 'Сохранить'),
        h('button', { class: 'btn', onclick: () => w.close() }, 'Отмена'))),
  });
  setTimeout(() => ta.focus(), 0);
}

/* Допзанятие: увеличить дневные лимиты */
export function customStudy(did, done) {
  const q = sched.buildQueue(did);
  const ids = new Set(S.deckSubtree(did));
  const day = S.dayOf();
  let newAvail = 0, revAvail = 0;
  for (const c of Object.values(S.C().cards)) {
    if (!ids.has(c.did) || c.susp || c.buried === day) continue;
    if (c.type === 0) newAvail++;
    else if (c.type === 2 && c.due <= day) revAvail++;
  }
  newAvail = Math.max(0, newAvail - q.counts.new);
  revAvail = Math.max(0, revAvail - q.counts.rev);
  const nIn = h('input', { class: 'input', type: 'number', min: 0, value: Math.min(10, newAvail), style: { width: '90px' } });
  const rIn = h('input', { class: 'input', type: 'number', min: 0, value: Math.min(10, revAvail), style: { width: '90px' } });
  const w = openWindow({
    title: `Допзанятие: ${S.deckName(did)}`, width: 460, className: 'dlg',
    body: h('div', { class: 'dlg-body' },
      h('div', { class: 'msg' }, 'Увеличьте сегодняшние лимиты, чтобы позаниматься сверх плана.'),
      h('div', { class: 'row' }, h('label', { style: { flex: 1 } }, `Увеличить лимит новых карточек на (доступно ${newAvail}):`), nIn),
      h('div', { class: 'row' }, h('label', { style: { flex: 1 } }, `Увеличить лимит повторений на (доступно ${revAvail}):`), rIn),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: () => {
          const a = Math.max(0, Math.min(+nIn.value || 0, newAvail)), b = Math.max(0, Math.min(+rIn.value || 0, revAvail));
          if (!a && !b) { toast('Нечего добавлять'); return; }
          sched.extendLimits(did, a, b);
          w.close(true); done?.();
        } }, 'OK'),
        h('button', { class: 'btn', onclick: () => w.close() }, 'Отмена'))),
  });
}
