// Мелкие помощники интерфейса: DOM, окна, меню, диалоги, уведомления.

// Встроенные append()/prepend() превращают null и false в текст «null»/«false».
// Фильтруем такие значения, чтобы условные элементы (`cond ? el : null`) просто пропускались.
for (const proto of [Element.prototype, DocumentFragment.prototype]) {
  for (const m of ['append', 'prepend']) {
    const orig = proto[m];
    proto[m] = function (...kids) { return orig.apply(this, kids.filter((k) => k != null && k !== false)); };
  }
}

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'selected', 'disabled', 'indeterminate'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = (el) => { el.textContent = ''; return el; };

/* ---------- иконки ---------- */
const ICONS = {
  gear: 'M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.3 7.3 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6a7.3 7.3 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.7 7.7 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.3.4.5.4h4c.2 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z',
  chevron: 'M7 10l5 5 5-5z',
  right: 'M10 7l5 5-5 5z',
  flag: 'M5 3v18h2v-7h5l1 2h6V5h-5l-1-2H5z',
  tag: 'M21.4 11.6l-9-9A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .5.2 1 .6 1.4l9 9a2 2 0 0 0 2.8 0l7-7a2 2 0 0 0 0-2.8ZM6.5 8A1.5 1.5 0 1 1 6.5 5a1.5 1.5 0 0 1 0 3Z',
  clip: 'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6z',
  mic: 'M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-3.1A7 7 0 0 0 19 11h-2Z',
  search: 'M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z',
  pin: 'M16 9V4h1V2H7v2h1v5l-2 3v2h5.2v7h1.6v-7H18v-2l-2-3Z',
  code: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4Zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4Z',
  close: 'M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z',
  max: 'M5 5h14v14H5V5Zm2 2v10h10V7H7Z',
  restore: 'M8 3h13v13h-3V6H8V3ZM3 8h13v13H3V8Zm2 2v9h9v-9H5Z',
  min: 'M5 19h14v-2H5z',
  eraser: 'M16.2 3.6a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L11 17.2H7.4L3.6 13.4a2 2 0 0 1 0-2.8l12.6-7ZM9 19h12v2H9z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z',
};
export function icon(name, size = 16) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('class', 'ic');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || '');
  p.setAttribute('fill', 'currentColor');
  s.append(p);
  return s;
}

export const FLAGS = [
  { color: '#ff5a5a' }, { color: '#ff9d3a' }, { color: '#3ad07a' }, { color: '#4a8bff' },
  { color: '#ff7ad5' }, { color: '#2ad0c5' }, { color: '#a56bff' },
];
export const FLAG_NAMES = ['Красный', 'Оранжевый', 'Зелёный', 'Синий', 'Розовый', 'Бирюзовый', 'Фиолетовый'];

/* ---------- форматирование ---------- */
const pad = (n) => String(n).padStart(2, '0');
export const fmtDate = (ms) => { const d = new Date(ms); return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`; };
export const fmtDateTime = (ms) => { const d = new Date(ms); return `${fmtDate(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtNum = (n, d = 0) => Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
export function fmtDur(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec} с`;
  if (sec < 3600) return `${Math.floor(sec / 60)} мин ${sec % 60} с`.replace(/ 0 с$/, '');
  return `${Math.floor(sec / 3600)} ч ${Math.floor((sec % 3600) / 60)} мин`;
}

/* ---------- окна ---------- */
let zTop = 100;
const wins = [];

export function openWindow({ title = '', body, width = 600, height, maxWidth, maximizable = false, className = '', onClose, startMax = false, buttons }) {
  const root = document.getElementById('windows');
  const prevFocus = document.activeElement; // вернём фокус сюда после закрытия
  const overlay = h('div', { class: 'win-overlay' });
  const titleEl = h('span', { class: 'win-title' }, title);
  const bodyWrap = h('div', { class: 'win-body' });
  const maxBtn = maximizable ? h('button', { class: 'win-btn', title: 'Развернуть', onclick: () => toggleMax() }, icon('max', 12)) : null;
  const closeBtn = h('button', { class: 'win-btn win-close', title: 'Закрыть', onclick: () => api.close() }, icon('close', 14));
  const bar = h('div', { class: 'win-bar' }, h('span', { class: 'win-ico' }), titleEl, h('span', { class: 'sp' }), maxBtn, closeBtn);
  const win = h('div', { class: `win ${className}`, role: 'dialog', 'aria-label': title }, bar, bodyWrap);
  if (width) win.style.width = typeof width === 'number' ? width + 'px' : width;
  if (height) win.style.height = typeof height === 'number' ? height + 'px' : height;
  if (maxWidth) win.style.maxWidth = maxWidth;
  if (body) add(bodyWrap, [body]);
  if (buttons) bodyWrap.append(buttons);
  overlay.append(win);
  overlay.style.zIndex = ++zTop;
  root.append(overlay);

  let maximized = false;
  function toggleMax(v) {
    maximized = v ?? !maximized;
    win.classList.toggle('max', maximized);
    if (maxBtn) { clear(maxBtn).append(icon(maximized ? 'restore' : 'max', 12)); }
    win.style.transform = '';
    off.x = off.y = 0;
  }
  if (startMax) toggleMax(true);

  // перетаскивание за заголовок
  const off = { x: 0, y: 0 };
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button') || maximized || e.button !== 0) return;
    const sx = e.clientX - off.x, sy = e.clientY - off.y;
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => { off.x = ev.clientX - sx; off.y = ev.clientY - sy; win.style.transform = `translate(${off.x}px,${off.y}px)`; };
    const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
  });
  bar.addEventListener('dblclick', (e) => { if (maximizable && !e.target.closest('button')) toggleMax(); });
  overlay.addEventListener('mousedown', () => { overlay.style.zIndex = ++zTop; const i = wins.indexOf(api); if (i >= 0) { wins.splice(i, 1); wins.push(api); } });

  const api = {
    el: win, body: bodyWrap, overlay,
    setTitle: (t) => { titleEl.textContent = t; },
    toggleMax,
    async close(force) {
      if (!force && onClose) { const r = await onClose(); if (r === false) return; }
      const i = wins.indexOf(api);
      if (i >= 0) wins.splice(i, 1);
      overlay.remove();
      api.closed = true;
      if (prevFocus && prevFocus !== document.body && prevFocus.isConnected && !document.activeElement?.closest?.('.win')) prevFocus.focus?.({ preventScroll: true });
      api.onclosed?.();
    },
  };
  wins.push(api);
  return api;
}

export const topWindow = () => wins.at(-1);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    if (closeMenu()) return;
    const w = wins.at(-1);
    if (w) { e.preventDefault(); w.close(); }
  }
});

/* ---------- меню ---------- */
let openMenuEl = null;
export function closeMenu() {
  if (!openMenuEl) return false;
  openMenuEl.remove();
  openMenuEl = null;
  return true;
}
document.addEventListener('mousedown', (e) => { if (openMenuEl && !e.target.closest('.menu')) closeMenu(); }, true);
window.addEventListener('blur', closeMenu);

function buildMenu(items, close) {
  const m = h('div', { class: 'menu', role: 'menu' });
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { m.append(h('div', { class: 'menu-sep' })); continue; }
    const row = h('div', {
      class: `menu-item${it.disabled ? ' disabled' : ''}${it.checked ? ' checked' : ''}`, role: 'menuitem',
    }, h('span', { class: 'mi-check' }, it.checked ? icon('check', 12) : null),
    h('span', { class: 'mi-label' }, it.label),
    h('span', { class: 'mi-key' }, it.shortcut || ''),
    it.submenu ? h('span', { class: 'mi-sub' }, icon('right', 12)) : null);
    if (it.submenu) {
      let sub = null;
      row.addEventListener('mouseenter', () => {
        if (it.disabled) return;
        sub?.remove();
        sub = buildMenu(it.submenu, close);
        sub.classList.add('submenu');
        document.body.append(sub);
        const r = row.getBoundingClientRect();
        const w = sub.offsetWidth;
        sub.style.left = (r.right + w > innerWidth ? r.left - w : r.right - 2) + 'px';
        sub.style.top = Math.min(r.top - 4, innerHeight - sub.offsetHeight - 4) + 'px';
        m._subs = (m._subs || []).concat(sub);
      });
      row.addEventListener('mouseleave', (e) => { if (!e.relatedTarget?.closest?.('.submenu')) { sub?.remove(); sub = null; } });
    } else if (!it.disabled) {
      row.addEventListener('click', () => { close(); it.onClick?.(); });
    }
    m.append(row);
  }
  return m;
}

export function popupMenu(items, { x, y, anchor, align = 'left' } = {}) {
  closeMenu();
  const close = () => { closeMenu(); document.querySelectorAll('.submenu').forEach((s) => s.remove()); };
  const m = buildMenu(items, close);
  document.body.append(m);
  openMenuEl = m;
  const origRemove = m.remove.bind(m);
  m.remove = () => { document.querySelectorAll('.submenu').forEach((s) => s.remove()); origRemove(); };
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = align === 'right' ? r.right - m.offsetWidth : r.left;
    y = r.bottom + 2;
  }
  x = Math.max(4, Math.min(x ?? 0, innerWidth - m.offsetWidth - 4));
  y = Math.max(4, Math.min(y ?? 0, innerHeight - m.offsetHeight - 4));
  m.style.left = x + 'px';
  m.style.top = y + 'px';
  return m;
}

/* ---------- диалоги ---------- */
function btnRow(...btns) { return h('div', { class: 'btn-row' }, ...btns); }

export function promptDialog({ title = '', label = '', value = '', placeholder = '', okText = 'OK', multiline = false, width = 420, validate }) {
  return new Promise((resolve) => {
    const input = multiline
      ? h('textarea', { class: 'input', rows: 4, value, placeholder })
      : h('input', { class: 'input', type: 'text', value, placeholder });
    const err = h('div', { class: 'err' });
    let done = false;
    const finish = (v) => { if (done) return; done = true; w.close(true); resolve(v); };
    const ok = () => {
      const v = input.value;
      const msg = validate?.(v);
      if (msg) { err.textContent = msg; return; }
      finish(v);
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); ok(); } });
    const w = openWindow({
      title, width, className: 'dlg',
      onClose: () => { if (!done) { done = true; resolve(null); } },
      body: h('div', { class: 'dlg-body' }, label ? h('label', {}, label) : null, input, err,
        btnRow(h('button', { class: 'btn primary', onclick: ok }, okText), h('button', { class: 'btn', onclick: () => finish(null) }, 'Отмена'))),
    });
    setTimeout(() => { input.focus(); input.select?.(); }, 0);
  });
}

export function confirmDialog({ title = 'Unki', message, okText = 'Да', cancelText = 'Отмена', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; w.close(true); resolve(v); };
    const okBtn = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => finish(true) }, okText);
    const w = openWindow({
      title, width: 420, className: 'dlg',
      onClose: () => { if (!done) { done = true; resolve(false); } },
      body: h('div', { class: 'dlg-body' }, h('div', { class: 'msg' }, message), btnRow(okBtn, h('button', { class: 'btn', onclick: () => finish(false) }, cancelText))),
    });
    setTimeout(() => okBtn.focus(), 0);
  });
}

export function alertDialog(message, title = 'Unki') {
  return new Promise((resolve) => {
    const okBtn = h('button', { class: 'btn primary', onclick: () => w.close() }, 'OK');
    const w = openWindow({
      title, width: 420, className: 'dlg', onClose: () => resolve(),
      body: h('div', { class: 'dlg-body' }, h('div', { class: 'msg' }, message), btnRow(okBtn)),
    });
    setTimeout(() => okBtn.focus(), 0);
  });
}

/* Выбор из списка с фильтром (тип записи, колода) */
export function chooserDialog({ title, items, selected, filter = true, okText = 'Выбрать', extra = [] }) {
  return new Promise((resolve) => {
    let done = false, sel = selected;
    const finish = (v) => { if (done) return; done = true; w.close(true); resolve(v); };
    const list = h('div', { class: 'chooser-list', tabindex: 0 });
    const input = h('input', { class: 'input', type: 'text', placeholder: '' });
    const render = () => {
      const q = input.value.trim().toLowerCase();
      clear(list);
      const shown = items.filter((i) => !q || i.label.toLowerCase().includes(q));
      if (!shown.some((i) => i.id === sel)) sel = shown[0]?.id;
      for (const it of shown) {
        const row = h('div', { class: `chooser-row${it.id === sel ? ' sel' : ''}`, onclick: () => { sel = it.id; render(); }, ondblclick: () => finish(it.id) }, it.label);
        list.append(row);
        if (it.id === sel) setTimeout(() => row.scrollIntoView({ block: 'nearest' }), 0);
      }
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', (e) => {
      const q = items.filter((i) => !input.value || i.label.toLowerCase().includes(input.value.trim().toLowerCase()));
      const idx = q.findIndex((i) => i.id === sel);
      if (e.key === 'ArrowDown') { sel = q[Math.min(q.length - 1, idx + 1)]?.id; render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = q[Math.max(0, idx - 1)]?.id; render(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); if (sel != null) finish(sel); }
    });
    const w = openWindow({
      title, width: 380, className: 'dlg',
      onClose: () => { if (!done) { done = true; resolve(null); } },
      body: h('div', { class: 'dlg-body' },
        filter ? h('div', { class: 'row' }, h('label', {}, 'Фильтр:'), input) : null,
        list,
        btnRow(h('button', { class: 'btn primary', onclick: () => sel != null && finish(sel) }, okText),
          ...extra.map((x) => h('button', { class: 'btn', onclick: () => { finish(null); x.onClick(); } }, x.label)),
          h('button', { class: 'btn', onclick: () => finish(null) }, 'Отмена'))),
    });
    render();
    setTimeout(() => input.focus(), 0);
  });
}

/* ---------- уведомления ---------- */
export function toast(msg, ms = 2600) {
  const root = document.getElementById('toasts');
  const t = h('div', { class: 'toast' }, msg);
  while (root.children.length >= 3) root.firstChild.remove();
  root.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

/* ---------- файлы ---------- */
export function downloadFile(name, data, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function pickFile(accept = '*') {
  return new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, style: { display: 'none' } });
    inp.addEventListener('change', () => { resolve(inp.files[0] || null); inp.remove(); });
    inp.addEventListener('cancel', () => { resolve(null); inp.remove(); });
    document.body.append(inp);
    inp.click();
  });
}

export const readText = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsText(file);
});
export const readDataUrl = (file) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(file);
});

/* ---------- внешний вид: тема и размер интерфейса ---------- */
export function applyAppearance(cfg = {}) {
  const theme = cfg.theme || 'system';
  const dark = theme === 'dark' || (theme === 'system' && !matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.fontSize = (15 * (cfg.zoom || 100) / 100) + 'px';
  try { localStorage.setItem('unki:theme', JSON.stringify(theme)); } catch { /* хранилище недоступно */ }
}
