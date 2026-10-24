// Хранилище коллекции: колоды, записи, карточки, журнал повторений.
// Всё живёт в памяти и сохраняется в IndexedDB (запасной вариант — localStorage).
import { builtinNoteTypes, cardOrds } from './models.js';

const DB = 'unki', STORE = 'kv', KEY = 'collection';

let col = null;
let lastId = 0;
let saveTimer = 0;
let dirty = false;
let dbp = null;
export let storageMode = 'memory';
const subs = new Set();
const undoStack = [];

export const C = () => col;
export const nowSec = () => Math.floor(Date.now() / 1000);

export function uid() {
  let t = Date.now();
  if (t <= lastId) t = lastId + 1;
  lastId = t;
  return t;
}

export function onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
function emit() { for (const f of subs) { try { f(); } catch (e) { console.error(e); } } }

export function commit() {
  col.mod = Date.now();
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
  emit();
}

/* ---------- сохранение ---------- */

function openDb() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('blocked'));
  });
}
const getDb = () => dbp || (dbp = openDb());

async function readRaw() {
  try {
    const db = await getDb();
    const v = await new Promise((res, rej) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    storageMode = 'idb';
    return v;
  } catch {
    try {
      const s = localStorage.getItem('unki:' + KEY);
      storageMode = 'localStorage';
      return s ? JSON.parse(s) : undefined;
    } catch { storageMode = 'memory'; return undefined; }
  }
}

async function writeRaw(v) {
  try {
    const db = await getDb();
    await new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(v, KEY);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
      tx.onabort = () => rej(tx.error);
    });
    storageMode = 'idb';
  } catch {
    try { localStorage.setItem('unki:' + KEY, JSON.stringify(v)); storageMode = 'localStorage'; }
    catch { storageMode = 'memory'; }
  }
}

export async function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !col) return;
  dirty = false;
  await writeRaw(col);
}

/* ---------- создание и загрузка ---------- */

export function defaultPreset(id, name) {
  return {
    id, name,
    newPerDay: 20, revPerDay: 200,
    learnSteps: [1, 10], graduatingIvl: 1, easyIvl: 4, newOrder: 'due',
    relearnSteps: [10], minIvl: 1, leechThreshold: 8, leechAction: 'tag',
    newMix: 'mix', revOrder: 'due-random',
    buryNew: false, buryRev: false,
    maxTime: 60, showTimer: false, stopTimer: false,
    startEase: 2.5, easyBonus: 1.3, ivlMod: 1.0, hardIvl: 1.2, newIvl: 0, maxIvl: 36500,
  };
}

function defaultConfig() {
  return {
    rollover: 4, learnAhead: 20,
    theme: 'system', zoom: 100,
    showRemaining: true, showTimes: true, spaceEnter: true,
    defaultDeckMode: 'current', pastePlain: false, defaultSearch: '',
    curDeck: 1, lastDeck: 1, lastType: 'basic', typeDeck: {},
    browserMode: 'cards', browserSort: { col: 'sfld', desc: false },
    browserCols: ['sfld', 'cardType', 'due', 'deck'],
  };
}

function createCollection() {
  const now = Date.now();
  const c = {
    v: 1, created: now, mod: now, nextPos: 1,
    config: defaultConfig(),
    decks: { 1: { id: 1, name: 'По умолчанию', preset: 1, desc: '', collapsed: false, created: now } },
    presets: { 1: defaultPreset(1, 'По умолчанию') },
    noteTypes: {}, notes: {}, cards: {}, revlog: [],
    counts: { day: 0, new: {}, rev: {} },
    savedSearches: {},
  };
  return c;
}

function migrate(c) {
  const d = createCollection();
  for (const k of Object.keys(d)) if (!(k in c)) c[k] = d[k];
  c.config = { ...defaultConfig(), ...c.config };
  for (const p of Object.values(c.presets)) Object.assign(p, { ...defaultPreset(p.id, p.name), ...p });
  return c;
}

function ensureBuiltins() {
  for (const nt of builtinNoteTypes()) if (!col.noteTypes[nt.id]) col.noteTypes[nt.id] = nt;
}

export async function load() {
  const raw = await readRaw();
  col = raw && raw.v ? migrate(raw) : createCollection();
  ensureBuiltins();
  let mx = 0;
  for (const part of [col.notes, col.cards, col.decks, col.presets]) {
    for (const k of Object.keys(part)) { const n = +k; if (n > mx) mx = n; }
  }
  for (const r of col.revlog.slice(-50)) if (r.id > mx) mx = r.id;
  lastId = mx;
  if (!raw) { dirty = true; await flush(); }
  const bye = () => { flush(); };
  window.addEventListener('pagehide', bye);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') bye(); });
  return col;
}

/* Заменить всю коллекцию (восстановление из копии) */
export function replaceCollection(obj) {
  col = migrate(obj);
  ensureBuiltins();
  undoStack.length = 0;
  commit();
}

export async function wipeAll() {
  col = createCollection();
  ensureBuiltins();
  undoStack.length = 0;
  commit();
  await flush();
}

/* ---------- время ---------- */

export function dayOf(ms = Date.now()) {
  const off = -new Date(ms).getTimezoneOffset() * 60;
  return Math.floor((ms / 1000 + off - col.config.rollover * 3600) / 86400);
}
export function dayStartTs(day) {
  const off = -new Date().getTimezoneOffset() * 60;
  return day * 86400 + col.config.rollover * 3600 - off;
}
export const cutoffTs = () => dayStartTs(dayOf() + 1);

export function counts() {
  const day = dayOf();
  if (col.counts.day !== day) col.counts = { day, new: {}, rev: {} };
  return col.counts;
}

/* ---------- отмена ---------- */

export function pushUndo(label, fn) {
  undoStack.push({ label, fn });
  if (undoStack.length > 50) undoStack.shift();
}
export const undoLabel = () => undoStack.at(-1)?.label || null;
export function undo() {
  const u = undoStack.pop();
  if (!u) return null;
  u.fn();
  commit();
  return u.label;
}

/* ---------- колоды ---------- */

export const normDeckName = (n) => String(n || '').split('::').map((s) => s.trim()).filter(Boolean).join('::');
export const findDeck = (name) => {
  const lc = normDeckName(name).toLowerCase();
  return Object.values(col.decks).find((d) => d.name.toLowerCase() === lc) || null;
};
export const deckName = (id) => col.decks[id]?.name || '(нет колоды)';
export const deckPath = (id) => deckName(id).split('::');

export function createDeck(name) {
  name = normDeckName(name);
  if (!name) return null;
  let cur = '', id = null;
  for (const p of name.split('::')) {
    cur = cur ? cur + '::' + p : p;
    const d = findDeck(cur);
    if (d) id = d.id;
    else {
      id = uid();
      col.decks[id] = { id, name: cur, preset: 1, desc: '', collapsed: false, created: Date.now() };
    }
  }
  commit();
  return id;
}

export function deckDescendants(id) {
  const pre = deckName(id) + '::';
  return Object.values(col.decks).filter((d) => d.name.startsWith(pre)).map((d) => d.id);
}
export function deckAncestors(id) {
  const parts = deckName(id).split('::');
  const out = [];
  for (let i = 1; i < parts.length; i++) {
    const d = findDeck(parts.slice(0, i).join('::'));
    if (d) out.push(d.id);
  }
  return out;
}
export const deckSubtree = (id) => [id, ...deckDescendants(id)];

export function renameDeck(id, newName) {
  newName = normDeckName(newName);
  const d = col.decks[id];
  if (!d || !newName) return false;
  const ex = findDeck(newName);
  if (ex && ex.id !== id) return false;
  const old = d.name;
  const changed = [];
  for (const x of Object.values(col.decks)) {
    if (x.id === id || x.name.startsWith(old + '::')) {
      changed.push([x.id, x.name]);
      x.name = newName + x.name.slice(old.length);
    }
  }
  pushUndo('Переименование колоды', () => changed.forEach(([i, n]) => { col.decks[i].name = n; }));
  // родители нового имени должны существовать
  const parts = newName.split('::');
  let cur = '';
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur ? cur + '::' + parts[i] : parts[i];
    if (!findDeck(cur)) { const nid = uid(); col.decks[nid] = { id: nid, name: cur, preset: 1, desc: '', collapsed: false, created: Date.now() }; }
  }
  commit();
  return true;
}

export function deleteDeck(id) {
  const ids = new Set(deckSubtree(id));
  const decks = [...ids].map((i) => col.decks[i]).filter(Boolean);
  const cards = Object.values(col.cards).filter((c) => ids.has(c.did));
  const nids = new Set(cards.map((c) => c.nid));
  const still = new Set(Object.values(col.cards).filter((c) => !ids.has(c.did)).map((c) => c.nid));
  const notes = [...nids].filter((n) => !still.has(n)).map((n) => col.notes[n]).filter(Boolean);
  cards.forEach((c) => delete col.cards[c.id]);
  notes.forEach((n) => delete col.notes[n.id]);
  const keepDefault = ids.has(1);
  decks.forEach((d) => { if (!(keepDefault && d.id === 1)) delete col.decks[d.id]; });
  if (!col.decks[col.config.curDeck]) col.config.curDeck = 1;
  pushUndo('Удаление колоды', () => {
    decks.forEach((d) => { col.decks[d.id] = d; });
    cards.forEach((c) => { col.cards[c.id] = c; });
    notes.forEach((n) => { col.notes[n.id] = n; });
  });
  commit();
  return cards.length;
}

export function setDeckCollapsed(id, v) { col.decks[id].collapsed = v; commit(); }

/* Плоский список колод для отображения (с учётом свёрнутых) */
export function deckList({ all = false } = {}) {
  const list = Object.values(col.decks).sort((a, b) =>
    a.name.localeCompare(b.name, 'ru', { numeric: true, sensitivity: 'base' }));
  const out = [];
  for (const d of list) {
    const parts = d.name.split('::');
    let hidden = false;
    if (!all) {
      for (let i = 1; i < parts.length; i++) {
        const p = findDeck(parts.slice(0, i).join('::'));
        if (p?.collapsed) { hidden = true; break; }
      }
    }
    if (hidden) continue;
    const pre = d.name + '::';
    out.push({ deck: d, depth: parts.length - 1, short: parts.at(-1), hasChildren: list.some((x) => x.name.startsWith(pre)) });
  }
  return out;
}

export const presetOf = (did) => col.presets[col.decks[did]?.preset] || col.presets[1];

/* ---------- типы записей ---------- */

export const noteTypes = () => Object.values(col.noteTypes)
  .sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
export const noteType = (id) => col.noteTypes[id];

/* ---------- записи и карточки ---------- */

function makeCard(nid, ord, did) {
  const id = uid();
  const c = {
    id, nid, ord, did, type: 0, due: col.nextPos++, ivl: 0, factor: 0, reps: 0, lapses: 0,
    step: 0, flag: 0, susp: false, buried: -1, mod: Date.now(), created: id,
  };
  col.cards[id] = c;
  return c;
}

export function addNote({ typeId, fields, tags = [], did }) {
  const nt = col.noteTypes[typeId];
  const note = { id: uid(), tid: typeId, fields: [...fields], tags: [...new Set(tags.filter(Boolean))], mod: Date.now() };
  col.notes[note.id] = note;
  const cards = cardOrds(nt, note).map((ord) => makeCard(note.id, ord, did));
  pushUndo('Добавление записи', () => {
    delete col.notes[note.id];
    cards.forEach((c) => delete col.cards[c.id]);
  });
  commit();
  return { note, cards };
}

/* Добавить недостающие карточки всем записям типа (после правки шаблонов) */
export function syncCards(typeId) {
  const nt = col.noteTypes[typeId];
  const byNote = new Map();
  for (const c of Object.values(col.cards)) {
    if (!byNote.has(c.nid)) byNote.set(c.nid, []);
    byNote.get(c.nid).push(c);
  }
  let added = 0;
  for (const n of Object.values(col.notes)) {
    if (n.tid !== typeId) continue;
    const mine = byNote.get(n.id) || [];
    const have = new Set(mine.map((c) => c.ord));
    const did = mine[0]?.did ?? col.config.curDeck;
    for (const ord of cardOrds(nt, n)) if (!have.has(ord)) { makeCard(n.id, ord, did); added++; }
  }
  return added;
}

export const cardsOfNote = (nid) => Object.values(col.cards).filter((c) => c.nid === nid).sort((a, b) => a.ord - b.ord);

export function updateNote(nid, fields, tags, { undo: withUndo = true } = {}) {
  const note = col.notes[nid];
  if (!note) return;
  const before = { fields: [...note.fields], tags: [...note.tags] };
  note.fields = [...fields];
  if (tags) note.tags = [...new Set(tags.filter(Boolean))];
  note.mod = Date.now();
  const nt = col.noteTypes[note.tid];
  const have = new Set(cardsOfNote(nid).map((c) => c.ord));
  const did = cardsOfNote(nid)[0]?.did ?? col.config.curDeck;
  const added = [];
  for (const ord of cardOrds(nt, note)) if (!have.has(ord)) added.push(makeCard(nid, ord, did));
  if (withUndo) {
    pushUndo('Правка записи', () => {
      note.fields = before.fields; note.tags = before.tags;
      added.forEach((c) => delete col.cards[c.id]);
    });
  }
  commit();
}

export function deleteNotes(nids) {
  const set = new Set(nids);
  const notes = [], cards = [];
  for (const id of set) { const n = col.notes[id]; if (n) { notes.push(n); delete col.notes[id]; } }
  for (const c of Object.values(col.cards)) if (set.has(c.nid)) { cards.push(c); delete col.cards[c.id]; }
  pushUndo('Удаление записей', () => {
    notes.forEach((n) => { col.notes[n.id] = n; });
    cards.forEach((c) => { col.cards[c.id] = c; });
  });
  commit();
  return notes.length;
}

export function duplicateNote(nid) {
  const n = col.notes[nid];
  const cards = cardsOfNote(nid);
  return addNote({ typeId: n.tid, fields: n.fields, tags: n.tags, did: cards[0]?.did ?? col.config.curDeck }).note;
}

export function moveCards(cids, did) {
  const prev = cids.map((id) => [id, col.cards[id].did]);
  cids.forEach((id) => { col.cards[id].did = did; col.cards[id].mod = Date.now(); });
  pushUndo('Смена колоды', () => prev.forEach(([id, d]) => { if (col.cards[id]) col.cards[id].did = d; }));
  commit();
}

function patchCards(cids, label, patch) {
  const prev = cids.map((id) => [id, { ...col.cards[id] }]);
  cids.forEach((id) => patch(col.cards[id]));
  pushUndo(label, () => prev.forEach(([id, c]) => { if (col.cards[id]) Object.assign(col.cards[id], c); }));
  commit();
}

export const setFlag = (cids, flag) => patchCards(cids, 'Флажок', (c) => { c.flag = flag; });
export const setSuspended = (cids, v) => patchCards(cids, v ? 'Исключение' : 'Возврат карточек', (c) => { c.susp = v; });
export const buryCards = (cids) => patchCards(cids, 'Откладывание', (c) => { c.buried = dayOf(); });
export const unburyCards = (cids) => patchCards(cids, 'Возврат отложенных', (c) => { c.buried = -1; });

/* Сбросить: вернуть в новые */
export function forgetCards(cids) {
  patchCards(cids, 'Сброс карточек', (c) => {
    Object.assign(c, { type: 0, due: col.nextPos++, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0 });
  });
}

/* Задать срок: "0" сегодня, "3" через 3 дня, "1-7" случайно, "3!" с обнулением интервала */
export function setDue(cids, spec) {
  const m = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*(!)?\s*$/.exec(spec);
  if (!m) return false;
  const lo = +m[1], hi = m[2] ? +m[2] : lo, reset = !!m[3];
  const day = dayOf();
  patchCards(cids, 'Задание срока', (c) => {
    const d = lo + Math.floor(Math.random() * (hi - lo + 1));
    if (c.type === 0) { c.type = 2; c.ivl = Math.max(1, d); c.factor = Math.round(presetOf(c.did).startEase * 1000); }
    else if (c.type !== 2) { c.type = 2; c.ivl = Math.max(1, c.ivl || d); }
    if (reset) c.ivl = Math.max(1, d);
    c.due = day + d;
  });
  return true;
}

/* ---------- метки ---------- */

export function allTags() {
  const s = new Set();
  for (const n of Object.values(col.notes)) n.tags.forEach((t) => s.add(t));
  return [...s].sort((a, b) => a.localeCompare(b, 'ru', { sensitivity: 'base' }));
}

function patchNotes(nids, label, fn) {
  const prev = nids.map((id) => [id, [...col.notes[id].tags]]);
  nids.forEach((id) => { fn(col.notes[id]); col.notes[id].mod = Date.now(); });
  pushUndo(label, () => prev.forEach(([id, t]) => { if (col.notes[id]) col.notes[id].tags = t; }));
  commit();
}
export const addTags = (nids, tags) => patchNotes(nids, 'Добавление меток', (n) => { n.tags = [...new Set([...n.tags, ...tags])]; });
export const removeTags = (nids, tags) => {
  const lc = tags.map((t) => t.toLowerCase());
  patchNotes(nids, 'Удаление меток', (n) => { n.tags = n.tags.filter((t) => !lc.includes(t.toLowerCase())); });
};
export function toggleMark(nids) {
  const allMarked = nids.every((id) => col.notes[id].tags.includes('marked'));
  if (allMarked) removeTags(nids, ['marked']); else addTags(nids, ['marked']);
}

/* ---------- настройки ---------- */

export function setConfig(patch) { Object.assign(col.config, patch); commit(); }

/* ---------- пресеты параметров колод ---------- */

export function savePreset(p) { col.presets[p.id] = p; commit(); }
export function addPreset(name, from) {
  const id = uid();
  col.presets[id] = { ...structuredClone(from || defaultPreset(id, name)), id, name };
  commit();
  return id;
}
export function deletePreset(id) {
  if (id === 1) return;
  delete col.presets[id];
  for (const d of Object.values(col.decks)) if (d.preset === id) d.preset = 1;
  commit();
}
