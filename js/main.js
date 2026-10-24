// Точка входа: строка меню, верхняя панель, переходы между экранами, горячие клавиши.
import * as S from './store.js';
import { h, clear, popupMenu, closeMenu, toast, chooserDialog, alertDialog, applyAppearance } from './ui.js';
import { renderDecks, renderOverview } from './decks.js';
import { renderReview } from './review.js';

const $menubar = document.getElementById('menubar');
const $topnav = document.getElementById('topnav');
const $main = document.getElementById('main');
const $bottom = document.getElementById('bottombar');
const $app = document.getElementById('app');

/* ---------- маршруты: #/decks, #/deck/<id>, #/review/<id> ---------- */
let view = { name: 'decks', did: null };
let cleanup = null;

const hashFor = (name, did) => (name === 'decks' ? '#/decks' : `#/${name}/${did}`);

export const nav = {
  go(name, did) {
    const next = hashFor(name, did);
    if (location.hash === next) route();
    else location.hash = next;
  },
  openDeck(did) { nav.go('deck', did); },
  study(did) { nav.go('review', did); },
  refresh() { route(); },
};

function parseHash() {
  const m = /^#\/(decks|deck|review)(?:\/(\d+))?$/.exec(location.hash);
  if (!m) return { name: 'decks', did: null };
  if (m[1] === 'decks') return { name: 'decks', did: null };
  const did = +m[2];
  if (!S.C().decks[did]) return { name: 'decks', did: null };
  return { name: m[1], did };
}

function route(keepScroll = false) {
  const prevScroll = $main.scrollTop;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  closeMenu();
  view = parseHash();
  $bottom.className = '';
  clear($bottom);
  const cfg = S.C().config;
  $app.classList.toggle('rv-hide-top', view.name === 'review' && !!cfg.hideTop);
  $app.classList.toggle('rv-hide-bottom', view.name === 'review' && !!cfg.hideBottom);
  if (view.name === 'decks') {
    renderDecks($main, $bottom, nav);
    document.title = 'Unki — колоды';
  } else if (view.name === 'deck') {
    renderOverview($main, $bottom, view.did, nav);
    document.title = `Unki — ${S.deckName(view.did).split('::').pop()}`;
  } else {
    cleanup = renderReview($main, $bottom, view.did, nav);
    document.title = `Unki — учёба: ${S.deckName(view.did).split('::').pop()}`;
  }
  renderNav();
  $main.scrollTop = keepScroll && view.name !== 'review' ? prevScroll : 0;
}

/* ---------- верхняя панель ---------- */
function renderNav() {
  const items = [
    ['decks', 'Колоды', () => nav.go('decks')],
    ['add', 'Добавить', openAdd],
    ['browse', 'Список', openBrowser],
    ['stats', 'Статистика', openStats],
    ['sync', 'Синхронизация', openSync],
  ];
  clear($topnav).append(h('div', { class: 'pill' }, items.map(([id, label, fn]) =>
    h('button', { class: id === 'decks' ? 'on' : '', onclick: fn, 'aria-current': id === 'decks' ? 'page' : null }, label))));
}

/* ---------- действия окон ---------- */
const curDeck = () => (S.C().decks[S.C().config.curDeck] ? S.C().config.curDeck : 1);
async function openAdd() { (await import('./add.js')).openAdd({ deckId: view.did ?? curDeck() }); }
async function openBrowser() { (await import('./browser.js')).openBrowser({}); }
async function openStats() { (await import('./stats.js')).openStats({ deckId: view.did ?? undefined }); }
async function openSync() { (await import('./io.js')).openSync(); }
async function openPrefs() { (await import('./options.js')).openPrefs(); }
async function openImport() { (await import('./io.js')).openImport(); }
async function openExport() { (await import('./io.js')).openExport(view.did ?? curDeck()); }
async function manageTypes() { (await import('./notetypes.js')).openManageTypes(); }
const tools = () => import('./tools.js');

async function studyDeckChooser() {
  const items = S.deckList().map(({ deck }) => ({ id: deck.id, label: deck.name }));
  const id = await chooserDialog({ title: 'Учить колоду', items, selected: curDeck(), okText: 'Учить' });
  if (id != null) nav.study(id);
}

function undo() {
  const lbl = S.undoLabel();
  if (!lbl) { toast('Нечего отменять'); return; }
  S.undo();
  toast(`Отменено: ${lbl}`);
}

function setZoom(z) {
  z = Math.max(70, Math.min(220, Math.round(z)));
  S.setConfig({ zoom: z });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

/* ---------- строка меню ---------- */
const MENUS = [
  ['Файл', () => [
    { label: 'Импортировать…', shortcut: 'Ctrl+Shift+I', onClick: openImport },
    { label: 'Экспортировать…', shortcut: 'Ctrl+E', onClick: openExport },
    { sep: true },
    { label: 'Создать резервную копию', onClick: async () => (await import('./io.js')).downloadBackup() },
    { label: 'Восстановить из копии…', onClick: async () => (await import('./io.js')).restoreBackup() },
  ]],
  ['Правка', () => {
    const lbl = S.undoLabel();
    return [
      { label: lbl ? `Отменить: ${lbl}` : 'Отменить', shortcut: 'Ctrl+Z', disabled: !lbl, onClick: undo },
      { sep: true },
      { label: 'Настройки…', shortcut: 'Ctrl+P', onClick: openPrefs },
    ];
  }],
  ['Вид', () => {
    const th = S.C().config.theme;
    return [
      { label: 'Во весь экран', shortcut: 'F11', checked: !!document.fullscreenElement, onClick: toggleFullscreen },
      { sep: true },
      { label: 'Увеличить', shortcut: 'Ctrl+=', onClick: () => setZoom(S.C().config.zoom + 10) },
      { label: 'Уменьшить', shortcut: 'Ctrl+-', onClick: () => setZoom(S.C().config.zoom - 10) },
      { label: 'Обычный размер', shortcut: 'Ctrl+0', onClick: () => setZoom(100) },
      { sep: true },
      { label: 'Тема', submenu: [
        { label: 'Как в системе', checked: th === 'system', onClick: () => S.setConfig({ theme: 'system' }) },
        { label: 'Светлая', checked: th === 'light', onClick: () => S.setConfig({ theme: 'light' }) },
        { label: 'Тёмная', checked: th === 'dark', onClick: () => S.setConfig({ theme: 'dark' }) },
      ] },
    ];
  }],
  ['Инструменты', () => [
    { label: 'Учить колоду…', shortcut: '/', onClick: studyDeckChooser },
    { sep: true },
    { label: 'Проверить базу данных', onClick: async () => (await tools()).checkDatabase() },
    { label: 'Пустые карточки…', onClick: async () => (await tools()).emptyCardsDialog() },
    { label: 'Управление типами записей…', shortcut: 'Ctrl+Shift+N', onClick: manageTypes },
  ]],
  ['Справка', () => [
    { label: 'Руководство', onClick: async () => (await tools()).openGuide() },
    { label: 'Горячие клавиши', onClick: async () => (await tools()).openShortcuts() },
    { sep: true },
    { label: 'О программе', onClick: async () => (await tools()).openAbout() },
  ]],
];

function buildMenubar() {
  let openIdx = -1;
  let toggleOff = false;
  const btns = MENUS.map(([label, items], i) => {
    const b = h('button', { role: 'menuitem', 'aria-haspopup': 'true' }, label);
    const open = () => {
      popupMenu(items(), { anchor: b });
      openIdx = i;
      btns.forEach((x, j) => x.classList.toggle('on', j === i));
    };
    b.addEventListener('pointerdown', () => { toggleOff = openIdx === i && !!document.querySelector('.menu:not(.submenu)'); });
    b.addEventListener('click', () => { if (toggleOff) { toggleOff = false; return; } open(); });
    b.addEventListener('mouseenter', () => { if (openIdx >= 0 && openIdx !== i && document.querySelector('.menu:not(.submenu)')) open(); });
    return b;
  });
  clear($menubar).append(h('span', { class: 'brand' }, 'Unki'), ...btns);
  // подсветка пропадает, когда меню закрылось
  new MutationObserver(() => {
    if (!document.querySelector('.menu:not(.submenu)')) { openIdx = -1; btns.forEach((x) => x.classList.remove('on')); }
  }).observe(document.body, { childList: true });
}

/* ---------- горячие клавиши ---------- */
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  const ctrl = e.ctrlKey || e.metaKey;
  const overlay = !!document.querySelector('.win-overlay');
  const code = e.code;

  if (ctrl && !e.altKey) {
    if (code === 'Equal' || code === 'NumpadAdd') { e.preventDefault(); setZoom(S.C().config.zoom + 10); return; }
    if (code === 'Minus' || code === 'NumpadSubtract') { e.preventDefault(); setZoom(S.C().config.zoom - 10); return; }
    if (code === 'Digit0' || code === 'Numpad0') { e.preventDefault(); setZoom(100); return; }
  }
  if (overlay) return;
  if (ctrl && !e.altKey) {
    if (code === 'KeyP' && !e.shiftKey) { e.preventDefault(); openPrefs(); return; }
    if (code === 'KeyE' && !e.shiftKey) { e.preventDefault(); openExport(); return; }
    if (code === 'KeyI' && e.shiftKey) { e.preventDefault(); openImport(); return; }
    if (code === 'KeyN' && e.shiftKey) { e.preventDefault(); manageTypes(); return; }
    if (code === 'KeyZ' && !e.shiftKey && !typing && view.name !== 'review') { e.preventDefault(); undo(); return; }
    return;
  }
  if (typing || ctrl || e.altKey || e.shiftKey && e.key !== '/') return;
  if (code === 'KeyD') { e.preventDefault(); nav.go('decks'); }
  else if (code === 'KeyA') { e.preventDefault(); openAdd(); }
  else if (code === 'KeyB') { e.preventDefault(); openBrowser(); }
  else if (code === 'KeyT') { e.preventDefault(); openStats(); }
  else if (code === 'KeyY') { e.preventDefault(); openSync(); }
  else if (e.key === '/' || code === 'Slash') { e.preventDefault(); studyDeckChooser(); }
  else if (code === 'KeyS' && view.name === 'deck') { e.preventDefault(); nav.study(view.did); }
});

/* ---------- запуск ---------- */
let renderTimer = 0;
let lastLook = '';

function onStoreChange() {
  const cfg = S.C().config;
  const look = `${cfg.theme}|${cfg.zoom}`;
  if (look !== lastLook) { lastLook = look; applyAppearance(cfg); }
  // экран повторения сам управляет собой; остальные экраны обновляем
  if (view.name === 'review') return;
  cancelAnimationFrame(renderTimer);
  renderTimer = requestAnimationFrame(() => {
    if (view.name === 'review') return;
    if (view.name === 'deck' && !S.C().decks[view.did]) { nav.go('decks'); return; }
    route(true);
  });
}

async function boot() {
  try {
    await S.load();
  } catch (e) {
    console.error(e);
    clear($main).append(h('div', { class: 'decks-wrap' }, h('h2', {}, 'Не удалось открыть хранилище'), h('p', {}, String(e?.message || e))));
    return;
  }
  const cfg = S.C().config;
  lastLook = `${cfg.theme}|${cfg.zoom}`;
  applyAppearance(cfg);
  matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => applyAppearance(S.C().config));
  buildMenubar();
  window.addEventListener('hashchange', () => route());
  S.onChange(onStoreChange);
  route();
  navigator.storage?.persist?.().catch(() => {});
  if (S.storageMode === 'memory') {
    alertDialog('Браузер не даёт сохранять данные для этого сайта (возможно, включён приватный режим). Всё, что вы создадите, пропадёт после закрытия вкладки. Скачивайте резервные копии: Файл → Создать резервную копию.', 'Хранилище недоступно');
  }
  // перерисовка после смены дня (граница дня — rollover часов)
  let day = S.dayOf();
  setInterval(() => { if (S.dayOf() !== day) { day = S.dayOf(); if (view.name !== 'review') route(); } }, 60000);
}

boot();
