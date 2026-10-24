// Поиск карточек в синтаксисе Anki: слова, "фразы", -исключение, or, (скобки),
// deck:, tag:, note:, card:, is:, flag:, added:, edited:, rated:, prop:, поле:значение, re:, nid:, cid:
import * as S from './store.js';
import { stripHtml, fieldMap } from './models.js';

const textCache = new WeakMap();
function noteText(note, nt) {
  let t = textCache.get(note);
  if (!t || t.mod !== note.mod || t.fields !== note.fields) {
    const fields = note.fields.map((f) => stripHtml(f).toLowerCase());
    t = { mod: note.mod, fields: note.fields, list: fields, all: fields.join('\x1f') };
    textCache.set(note, t);
  }
  void nt;
  return t;
}

const escRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
function globToRe(s, full) {
  const body = escRe(s).replace(/\\\*/g, '*').replace(/\*/g, '.*').replace(/_/g, '.');
  return new RegExp(full ? `^${body}$` : body, 'is');
}

function tokenize(q) {
  const out = [];
  let i = 0;
  while (i < q.length) {
    const ch = q[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '(' || ch === ')') { out.push({ t: ch }); i++; continue; }
    let neg = false;
    if (ch === '-' && i + 1 < q.length && !/\s/.test(q[i + 1])) { neg = true; i++; }
    let s = '';
    let quoted = false;
    while (i < q.length && !/\s/.test(q[i]) && q[i] !== '(' && q[i] !== ')') {
      if (q[i] === '"') {
        quoted = true; i++;
        while (i < q.length && q[i] !== '"') { if (q[i] === '\\' && i + 1 < q.length) i++; s += q[i++]; }
        i++;
      } else { if (q[i] === '\\' && i + 1 < q.length) i++; s += q[i++]; }
    }
    if (!quoted && !neg && /^(or|and)$/i.test(s)) out.push({ t: s.toLowerCase() });
    else out.push({ t: 'term', v: s, neg, quoted });
  }
  return out;
}

function parse(tokens) {
  let p = 0;
  const peek = () => tokens[p];
  function orExpr() {
    const parts = [andExpr()];
    while (peek()?.t === 'or') { p++; parts.push(andExpr()); }
    return parts.length === 1 ? parts[0] : (ctx) => parts.some((f) => f(ctx));
  }
  function andExpr() {
    const parts = [];
    while (p < tokens.length && peek().t !== 'or' && peek().t !== ')') {
      if (peek().t === 'and') { p++; continue; }
      parts.push(unary());
    }
    if (!parts.length) return () => true;
    return parts.length === 1 ? parts[0] : (ctx) => parts.every((f) => f(ctx));
  }
  function unary() {
    const t = tokens[p++];
    if (t.t === '(') {
      const e = orExpr();
      if (peek()?.t === ')') p++;
      return e;
    }
    if (t.t === 'term') {
      const f = compileTerm(t.v);
      return t.neg ? (ctx) => !f(ctx) : f;
    }
    return () => true;
  }
  const e = orExpr();
  return e;
}

function cmp(a, op, b) {
  switch (op) {
    case '>=': return a >= b; case '<=': return a <= b; case '>': return a > b;
    case '<': return a < b; case '!=': return a !== b; default: return a === b;
  }
}

function compileTerm(v) {
  const m = /^([^:\s]+?):(.*)$/s.exec(v);
  if (m) {
    const key = m[1].toLowerCase();
    const val = m[2];
    const special = termByKey(key, val);
    if (special) return special;
    // поле:значение
    const fre = globToRe(val, true);
    const kre = globToRe(m[1], true);
    return ({ note, nt }) => {
      for (let i = 0; i < nt.fields.length; i++) {
        if (kre.test(nt.fields[i])) {
          const t = stripHtml(note.fields[i] || '');
          if (fre.test(t)) return true;
        }
      }
      return false;
    };
  }
  if (v === '') return () => true;
  if (v === '*') return () => true;
  const re = globToRe(v, false);
  return ({ note, nt }) => re.test(noteText(note, nt).all.replace(/\x1f/g, ' '));
}

function termByKey(key, val) {
  const vl = val.toLowerCase();
  switch (key) {
    case 'deck': {
      if (vl === 'current') return ({ card }) => S.deckSubtree(S.C().config.curDeck).includes(card.did);
      const re = globToRe(val, true);
      return ({ card }) => {
        const n = S.deckName(card.did);
        if (re.test(n)) return true;
        const parts = n.split('::');
        for (let i = 1; i < parts.length; i++) if (re.test(parts.slice(0, i).join('::'))) return true;
        return false;
      };
    }
    case 'tag': {
      if (vl === 'none') return ({ note }) => note.tags.length === 0;
      const re = globToRe(val, true);
      return ({ note }) => note.tags.some((t) => re.test(t) || t.toLowerCase().startsWith(vl + '::'));
    }
    case 'note': { const re = globToRe(val, true); return ({ nt }) => re.test(nt.name); }
    case 'card': {
      if (/^\d+$/.test(val)) return ({ card }) => card.ord === +val - 1;
      const re = globToRe(val, true);
      return ({ card, nt }) => re.test(nt.kind === 'cloze' ? `Cloze ${card.ord + 1}` : nt.templates[card.ord]?.name || '');
    }
    case 'is': {
      const day = S.dayOf();
      switch (vl) {
        case 'new': return ({ card }) => card.type === 0;
        case 'learn': return ({ card }) => card.type === 1 || card.type === 3;
        case 'review': return ({ card }) => card.type === 2 || card.type === 3;
        case 'due': return ({ card }) => (card.type === 2 && card.due <= day) || ((card.type === 1 || card.type === 3) && card.due < S.cutoffTs());
        case 'suspended': return ({ card }) => card.susp;
        case 'buried': return ({ card }) => card.buried === day;
        case 'marked': return ({ note }) => note.tags.includes('marked');
        case 'leech': return ({ note }) => note.tags.includes('leech');
        default: return () => false;
      }
    }
    case 'flag': return ({ card }) => card.flag === +val;
    case 'added': return ({ card }) => card.created >= (S.dayStartTs(S.dayOf() - (+val - 1))) * 1000;
    case 'edited': return ({ note }) => note.mod >= (S.dayStartTs(S.dayOf() - (+val - 1))) * 1000;
    case 'introduced': {
      const first = new Map();
      for (const r of S.C().revlog) if (!first.has(r.cid)) first.set(r.cid, r.id);
      const lim = S.dayStartTs(S.dayOf() - (+val - 1)) * 1000;
      return ({ card }) => (first.get(card.id) ?? 0) >= lim;
    }
    case 'rated': {
      const [days, ease] = val.split(':').map(Number);
      const lim = S.dayStartTs(S.dayOf() - (days - 1)) * 1000;
      const set = new Set();
      for (let i = S.C().revlog.length - 1; i >= 0; i--) {
        const r = S.C().revlog[i];
        if (r.id < lim) break;
        if (!ease || r.ease === ease) set.add(r.cid);
      }
      return ({ card }) => set.has(card.id);
    }
    case 'prop': {
      const pm = /^(ivl|due|ease|reps|lapses|pos)\s*(>=|<=|!=|>|<|=)\s*(-?[\d.]+)$/i.exec(val);
      if (!pm) return () => false;
      const [, prop, op, numS] = pm;
      const num = parseFloat(numS);
      return ({ card }) => {
        switch (prop.toLowerCase()) {
          case 'ivl': return card.type === 2 && cmp(card.ivl, op, num);
          case 'due': return card.type === 2 && cmp(card.due - S.dayOf(), op, num);
          case 'ease': return card.type !== 0 && cmp(card.factor / 1000, op, num);
          case 'reps': return cmp(card.reps, op, num);
          case 'lapses': return cmp(card.lapses, op, num);
          case 'pos': return card.type === 0 && cmp(card.due, op, num);
          default: return false;
        }
      };
    }
    case 're': {
      let re;
      try { re = new RegExp(val, 'i'); } catch { return () => false; }
      return ({ note }) => re.test(noteText(note).all.replace(/\x1f/g, ' '));
    }
    case 'nid': { const ids = new Set(val.split(',').map(Number)); return ({ note }) => ids.has(note.id); }
    case 'cid': { const ids = new Set(val.split(',').map(Number)); return ({ card }) => ids.has(card.id); }
    default: return null;
  }
}

export function compile(query) {
  const q = (query || '').trim();
  if (!q) return () => true;
  return parse(tokenize(q));
}

/* Найти карточки по запросу */
export function searchCards(query) {
  const col = S.C();
  const f = compile(query);
  const out = [];
  for (const card of Object.values(col.cards)) {
    const note = col.notes[card.nid];
    if (!note) continue;
    const nt = col.noteTypes[note.tid];
    if (f({ card, note, nt })) out.push(card);
  }
  return out;
}

export const SEARCH_HELP = [
  ['слово', 'записи, где встречается слово (в любом поле)'],
  ['"точная фраза"', 'фраза целиком'],
  ['дог*', '* — любое число символов, _ — один символ'],
  ['-кот', 'исключить совпадения (минус перед словом)'],
  ['кот or собака', 'любое из двух; скобки группируют: (a or b) c'],
  ['deck:Англ', 'карточки колоды и вложенных колод; deck:current — текущая'],
  ['tag:глагол', 'метка (tag:none — без меток)'],
  ['note:Простая', 'тип записи'],
  ['card:2', 'номер или название вида карточки'],
  ['is:new  is:learn  is:review  is:due', 'по состоянию'],
  ['is:suspended  is:buried  is:marked  is:leech', 'исключённые, отложенные, отмеченные, «пиявки»'],
  ['flag:1', 'флажок (1–7, 0 — без флажка)'],
  ['added:7', 'добавлено за последние 7 дней (edited:, introduced:)'],
  ['rated:3  rated:3:1', 'отвечали за 3 дня; оценка 1 = «Снова»'],
  ['prop:ivl>=21', 'свойства: ivl, due, ease, reps, lapses, pos'],
  ['"лицевая сторона:кот"', 'поле равно «кот» ("поле:*кот*" — содержит)'],
  ['re:\\d{3}', 'регулярное выражение'],
  ['nid:123,456  cid:789', 'по номерам записей и карточек'],
];

export { fieldMap };
