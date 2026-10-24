// Инструменты и справка: проверка базы, пустые карточки, горячие клавиши, о программе.
import * as S from './store.js';
import { h, openWindow, toast, alertDialog, confirmDialog, fmtNum, plural } from './ui.js';
import { cardOrds, stripHtml } from './models.js';
import { SEARCH_HELP } from './search.js';

export const VERSION = '0.1.0';
export const REPO = 'https://github.com/sunakle/unki.web';

/* ---------- проверка базы ---------- */
export async function checkDatabase() {
  const col = S.C();
  const log = [];
  let changed = false;
  const note = (n, text) => { if (n) { log.push(`${text}: ${fmtNum(n)}`); changed = true; } };

  // карточки без записи
  let n = 0;
  for (const c of Object.values(col.cards)) if (!col.notes[c.nid]) { delete col.cards[c.id]; n++; }
  note(n, 'Удалено карточек без записи');

  // записи с несуществующим типом
  n = 0;
  for (const nt of Object.values(col.notes)) if (!col.noteTypes[nt.tid]) {
    for (const c of Object.values(col.cards)) if (c.nid === nt.id) delete col.cards[c.id];
    delete col.notes[nt.id]; n++;
  }
  note(n, 'Удалено записей с неизвестным типом');

  // число полей
  n = 0;
  for (const nt of Object.values(col.notes)) {
    const t = col.noteTypes[nt.tid];
    while (nt.fields.length < t.fields.length) { nt.fields.push(''); n++; }
    if (nt.fields.length > t.fields.length) { nt.fields.length = t.fields.length; n++; }
  }
  note(n, 'Исправлено записей с неверным числом полей');

  // вложенные колоды без родителей
  const before = Object.keys(col.decks).length;
  for (const d of Object.values(col.decks)) {
    const parts = d.name.split('::');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('::');
      if (!S.findDeck(parent)) S.createDeck(parent);
    }
  }
  note(Object.keys(col.decks).length - before, 'Создано пропущенных родительских колод');

  // колода по умолчанию и наборы настроек
  if (!col.decks[1]) { col.decks[1] = { id: 1, name: 'По умолчанию', preset: 1, desc: '', collapsed: false, created: Date.now() }; log.push('Восстановлена колода «По умолчанию»'); changed = true; }
  n = 0;
  for (const d of Object.values(col.decks)) if (!col.presets[d.preset]) { d.preset = 1; n++; }
  note(n, 'Колод с неверным набором параметров');

  // карточки в несуществующих колодах и с неверными значениями
  n = 0;
  let bad = 0;
  for (const c of Object.values(col.cards)) {
    if (!col.decks[c.did]) { c.did = 1; n++; }
    if (![0, 1, 2, 3].includes(c.type) || !Number.isFinite(c.due) || !Number.isFinite(c.ivl) || !Number.isFinite(c.factor)) {
      Object.assign(c, { type: 0, due: S.C().nextPos++, ivl: 0, factor: 0, step: 0 });
      bad++;
    }
  }
  note(n, 'Карточек перенесено в колоду по умолчанию');
  note(bad, 'Карточек со сломанным расписанием сброшено');

  // записи без карточек
  let added = 0;
  for (const t of Object.keys(col.noteTypes)) added += S.syncCards(t);
  note(added, 'Создано недостающих карточек');

  if (changed) S.commit();
  await alertDialog(log.length ? `Найдены и исправлены проблемы:\n\n${log.join('\n')}` : 'Проблем не найдено.', 'Проверка базы данных');
}

/* ---------- пустые карточки ---------- */
export function findEmptyCards() {
  const col = S.C();
  const byNote = new Map();
  for (const c of Object.values(col.cards)) {
    if (!byNote.has(c.nid)) byNote.set(c.nid, []);
    byNote.get(c.nid).push(c);
  }
  const res = [];
  for (const [nid, cards] of byNote) {
    const note = col.notes[nid];
    if (!note) continue;
    const want = new Set(cardOrds(col.noteTypes[note.tid], note));
    const empty = cards.filter((c) => !want.has(c.ord));
    if (!empty.length) continue;
    // у записи всегда остаётся хотя бы одна карточка
    if (empty.length === cards.length) empty.sort((a, b) => a.ord - b.ord).shift();
    for (const c of empty) res.push(c);
  }
  return res;
}

export async function emptyCardsDialog() {
  const col = S.C();
  const list = findEmptyCards();
  if (!list.length) return alertDialog('Пустых карточек нет.', 'Пустые карточки');
  const lines = list.slice(0, 40).map((c) => {
    const n = col.notes[c.nid];
    const nt = col.noteTypes[n.tid];
    return `${stripHtml(n.fields[0] || '').slice(0, 50) || '(пусто)'} — ${nt.templates?.[c.ord]?.name || 'Карточка ' + (c.ord + 1)}`;
  });
  const ok = await confirmDialog({
    title: 'Пустые карточки', danger: true, okText: 'Удалить',
    message: `Найдено ${fmtNum(list.length)} ${plural(list.length, 'пустая карточка', 'пустые карточки', 'пустых карточек')}: у них нет текста на лицевой стороне.\n\n${lines.join('\n')}${list.length > lines.length ? '\n…' : ''}`,
  });
  if (!ok) return;
  const saved = list.map((c) => ({ ...c }));
  for (const c of list) delete col.cards[c.id];
  S.pushUndo('Удаление пустых карточек', () => { for (const c of saved) col.cards[c.id] = c; });
  S.commit();
  toast(`Удалено карточек: ${fmtNum(saved.length)}`);
}

/* ---------- справка ---------- */
const SHORTCUTS = [
  ['Главное окно', [
    ['D', 'колоды'], ['A', 'добавить записи'], ['B', 'список карточек'], ['T', 'статистика'], ['Y', 'синхронизация и копии'],
    ['/', 'выбрать колоду и начать учить'], ['S', 'начать учить (на экране колоды)'],
    ['Ctrl+Z', 'отменить'], ['Ctrl+P', 'настройки'], ['Ctrl+E', 'экспорт'], ['Ctrl+Shift+I', 'импорт'], ['Ctrl+Shift+N', 'типы записей'],
    ['Ctrl+= / Ctrl+- / Ctrl+0', 'размер интерфейса'],
  ]],
  ['Повторение', [
    ['Пробел / Enter', 'показать ответ; затем — «Хорошо»'], ['1  2  3  4', 'Снова, Трудно, Хорошо, Легко'], ['Z', 'отменить ответ'],
    ['E', 'изменить запись'], ['I', 'информация о карточке'], ['O', 'параметры колоды'],
    ['*', 'отметить запись'], ['F1–F7 / Ctrl+1–7', 'флажок'], ['-', 'отложить карточку'], ['=', 'отложить запись'], ['@', 'исключить карточку'], ['!', 'исключить запись'], ['Ctrl+Del', 'удалить запись'],
  ]],
  ['Окно «Добавить» и «Изменить»', [
    ['Ctrl+Enter', 'добавить / сохранить'], ['Ctrl+B / I / U', 'жирный, курсив, подчёркнутый'], ['Ctrl+Shift+C', 'ячейка закрытия (cloze)'], ['Ctrl+Shift+Alt+C', 'cloze с тем же номером'], ['Esc', 'закрыть'],
  ]],
  ['Список карточек', [
    ['Ctrl+F', 'поиск'], ['Ctrl+A', 'выделить всё'], ['Ctrl+E', 'добавить запись'], ['Ctrl+D', 'сменить колоду'], ['Ctrl+Shift+D', 'изменить срок'], ['Ctrl+Alt+N', 'забыть'],
    ['Ctrl+Shift+A / Ctrl+Alt+Shift+A', 'добавить / убрать метки'], ['Ctrl+Del', 'удалить записи'], ['Ctrl+J', 'исключить / вернуть'], ['Ctrl+Shift+J', 'отложить'],
    ['Ctrl+K', 'отметить'], ['Ctrl+1–7', 'флажок'], ['Ctrl+Shift+I', 'информация'], ['Ctrl+Shift+P', 'просмотр'], ['Ctrl+Alt+F', 'найти и заменить'],
  ]],
];

function tableOf(rows) {
  return h('table', { class: 'help-table' }, rows.map(([a, b]) => h('tr', {}, h('td', {}, a), h('td', {}, b))));
}

export function openShortcuts() {
  return openWindow({
    title: 'Горячие клавиши', width: 560, height: 560, maximizable: true,
    body: h('div', { style: { padding: '8px 16px 16px', overflow: 'auto', flex: 1 } },
      SHORTCUTS.map(([title, rows]) => [h('h3', { style: { margin: '14px 0 6px', fontSize: '.95rem' } }, title), tableOf(rows)])),
  });
}

export function openGuide() {
  const sec = (title, ...kids) => h('section', { style: { marginBottom: '16px' } }, h('h3', { style: { margin: '0 0 6px', fontSize: '1rem' } }, title), ...kids);
  const p = (t) => h('p', { style: { margin: '6px 0', lineHeight: 1.55, fontSize: '.88rem' } }, t);
  return openWindow({
    title: 'Руководство', width: 640, height: 600, maximizable: true,
    body: h('div', { style: { padding: '12px 18px 18px', overflow: 'auto', flex: 1 } },
      sec('Как это работает',
        p('Unki — программа для интервальных повторений. Вы создаёте карточки с вопросом и ответом, а программа сама решает, когда показать каждую из них снова: хорошо знакомые — всё реже, трудные — чаще.'),
        p('Нажмите «Добавить», введите лицевую и обратную стороны, затем откройте колоду и нажмите «Учить сейчас».')),
      sec('Оценка ответа',
        p('Снова — не вспомнили: карточка вернётся в ближайшее время. Трудно — вспомнили с усилием. Хорошо — обычный ответ. Легко — вспомнили мгновенно, интервал вырастет сильнее. Под каждой кнопкой написано, когда карточка появится снова.')),
      sec('Типы записей',
        p('«Простая» — две стороны. «Простая (с обратной карточкой)» создаёт карточки в обе стороны, а «…с обратной по выбору» — только если заполнено поле «Добавить обратную». «Задание с пропусками» — текст с ячейками закрытия: выделите слово и нажмите Ctrl+Shift+C. «Простая (с вводом ответа)» просит набрать ответ и сравнивает его. Собственные типы и шаблоны — Инструменты → Управление типами записей.')),
      sec('Колоды',
        p('Название вида «Язык::Глаголы» создаёт вложенную колоду. У каждой колоды есть набор параметров: лимиты в день, шаги изучения, пороги «пиявок» (кнопка-шестерёнка → Параметры).')),
      sec('Поиск',
        p('В списке карточек (клавиша B) работает синтаксис, как в Anki:'),
        tableOf(SEARCH_HELP)),
      sec('Данные и копии',
        p('Все данные хранятся в вашем браузере. Это значит, что они не покидают устройство, но очистка данных сайта их удалит. Регулярно скачивайте резервную копию (Файл → Создать резервную копию) — её можно восстановить на другом устройстве.'),
        p('Импорт принимает текстовые файлы (TSV/CSV, в том числе экспорт «Записи в простом тексте» из Anki), файлы .unki.json и резервные копии. Файлы .apkg напрямую не читаются: в Anki выберите «Файл → Экспорт → Записи в простом тексте».'))),
  });
}

export function openAbout() {
  const w = openWindow({
    title: 'О программе', width: 420, className: 'dlg',
    body: h('div', { class: 'dlg-body', style: { alignItems: 'center', textAlign: 'center' } },
      h('div', { style: { fontSize: '1.7rem', fontWeight: 700 } }, 'Unki'),
      h('div', { style: { color: 'var(--muted)' } }, `версия ${VERSION}`),
      h('div', { class: 'msg' }, 'Веб-версия программы для интервальных повторений в стиле Anki. Работает без сервера, все данные хранятся в вашем браузере.\n\nUnki — самостоятельный проект и не связан с создателями Anki.'),
      h('a', { href: REPO, target: '_blank', rel: 'noopener' }, REPO),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: () => w.close() }, 'OK'))),
  });
  return w;
}
