// Планировщик в духе Anki (SM-2): шаги изучения, интервалы, лёгкость, ошибки, дневные лимиты.
import * as S from './store.js';

/* ---------- вспомогательное ---------- */

function rnd(id, salt = 0) {
  let x = ((id >>> 0) ^ (Math.floor(id / 4294967296) * 40503) ^ Math.imul(salt + 1, 2654435761)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

const trim1 = (n) => n.toFixed(1).replace('.', ',').replace(/,0$/, '');

export function fmtSpan(sec) {
  sec = Math.round(sec);
  if (sec < 60) return '<1 мин';
  if (sec < 3600) return `${Math.round(sec / 60)} мин`;
  if (sec < 86400) return `${trim1(sec / 3600)} ч`;
  const d = sec / 86400;
  if (d < 30) return `${Math.round(d)} д`;
  if (d < 365) return `${trim1(d / 30)} мес.`;
  return `${trim1(d / 365)} г.`;
}

function fuzzRange(ivl) {
  if (ivl < 2) return [1, 1];
  if (ivl === 2) return [2, 3];
  let f;
  if (ivl < 7) f = Math.floor(ivl * 0.25);
  else if (ivl < 30) f = Math.max(2, Math.floor(ivl * 0.15));
  else f = Math.max(4, Math.floor(ivl * 0.05));
  f = Math.max(f, 1);
  return [ivl - f, ivl + f];
}

/* ---------- вычисление ответа (без изменения карточки) ---------- */

function isLeech(lapses, p) {
  const t = p.leechThreshold;
  return t > 0 && lapses >= t && (lapses - t) % Math.max(Math.floor(t / 2), 1) === 0;
}

export function computeAnswer(card, ease, p, fuzz) {
  const now = S.nowSec(), day = S.dayOf();
  const c = { ...card };
  const res = { card: c, leech: false, delay: 0 };
  const setDelay = (sec) => { c.due = now + Math.round(sec); res.delay = sec; };

  if (c.type === 0) {
    c.type = 1; c.step = 0; c.factor = Math.round(p.startEase * 1000);
  }

  if (c.type === 1 || c.type === 3) {
    const steps = (c.type === 1 ? p.learnSteps : p.relearnSteps).map((m) => m * 60);
    const graduate = (easy) => {
      if (c.type === 1) c.ivl = Math.max(1, easy ? p.easyIvl : p.graduatingIvl);
      else c.ivl = Math.max(1, easy ? c.ivl + 1 : c.ivl);
      c.type = 2; c.step = 0; c.due = day + c.ivl; res.delay = c.ivl * 86400;
    };
    if (!steps.length) graduate(ease === 4);
    else if (ease === 1) { c.step = 0; setDelay(steps[0]); }
    else if (ease === 2) {
      let d;
      if (c.step === 0) d = steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[0] * 1.5;
      else d = steps[Math.min(c.step, steps.length - 1)];
      setDelay(d);
    } else if (ease === 3) {
      c.step++;
      if (c.step >= steps.length) graduate(false); else setDelay(steps[c.step]);
    } else graduate(true);
    return res;
  }

  // повторение
  const late = Math.max(0, day - c.due);
  if (ease === 1) {
    c.lapses++;
    c.factor = Math.max(1300, c.factor - 200);
    c.ivl = Math.max(1, p.minIvl, Math.floor(c.ivl * p.newIvl));
    res.leech = isLeech(c.lapses, p);
    if (p.relearnSteps.length) { c.type = 3; c.step = 0; setDelay(p.relearnSteps[0] * 60); }
    else { c.due = day + c.ivl; res.delay = c.ivl * 86400; }
    return res;
  }
  const fct = c.factor / 1000;
  const constrain = (ivl, prev) => {
    ivl = Math.floor(ivl * p.ivlMod);
    if (fuzz) { const [lo, hi] = fuzzRange(ivl); ivl = lo + Math.floor(Math.random() * (hi - lo + 1)); }
    return Math.min(Math.max(ivl, prev + 1, 1), p.maxIvl);
  };
  const ivl2 = constrain((c.ivl + Math.floor(late / 4)) * p.hardIvl, c.ivl);
  const ivl3 = constrain((c.ivl + Math.floor(late / 2)) * fct, ivl2);
  const ivl4 = constrain((c.ivl + late) * fct * p.easyBonus, ivl3);
  if (ease === 2) { c.factor = Math.max(1300, c.factor - 150); c.ivl = ivl2; }
  else if (ease === 3) { c.ivl = ivl3; }
  else { c.factor += 150; c.ivl = ivl4; }
  c.due = day + c.ivl;
  res.delay = c.ivl * 86400;
  return res;
}

export function previews(card) {
  const p = S.presetOf(card.did);
  return [1, 2, 3, 4].map((e) => fmtSpan(computeAnswer(card, e, p, false).delay));
}

/* ---------- очередь ---------- */

const isActive = (c, day) => !c.susp && c.buried !== day;

export function buildQueue(did) {
  const col = S.C();
  const day = S.dayOf(), now = S.nowSec(), cutoff = S.cutoffTs();
  const ahead = col.config.learnAhead * 60;
  const ids = new Set(S.deckSubtree(did));
  const cnt = S.counts();
  const lrn = [], news = [], revs = [];
  for (const c of Object.values(col.cards)) {
    if (!ids.has(c.did) || !isActive(c, day)) continue;
    if (c.type === 1 || c.type === 3) { if (c.due < cutoff) lrn.push(c); }
    else if (c.type === 0) news.push(c);
    else if (c.type === 2 && c.due <= day) revs.push(c);
  }
  const root = S.presetOf(did);

  const rev = revs.sort((a, b) => {
    switch (root.revOrder) {
      case 'due': return a.due - b.due || a.id - b.id;
      case 'random': return rnd(a.id, day) - rnd(b.id, day);
      case 'ivl-asc': return a.ivl - b.ivl;
      case 'ivl-desc': return b.ivl - a.ivl;
      default: return a.due - b.due || rnd(a.id, day) - rnd(b.id, day);
    }
  });
  news.sort((a, b) => (root.newOrder === 'random' ? rnd(a.id, day) - rnd(b.id, day) : a.due - b.due));

  // дневные лимиты по всей цепочке колод
  const pathCache = new Map();
  const path = (d) => { let p = pathCache.get(d); if (!p) { p = [d, ...S.deckAncestors(d)]; pathCache.set(d, p); } return p; };
  const remNew = new Map(), remRev = new Map();
  const left = (map, d, limitKey, cntKey) => {
    if (!map.has(d)) map.set(d, S.presetOf(d)[limitKey] - (cnt[cntKey][d] || 0));
    return map.get(d);
  };
  const take = (list, map, limitKey, cntKey) => {
    const out = [];
    for (const c of list) {
      const p = path(c.did);
      if (p.every((d) => left(map, d, limitKey, cntKey) > 0)) {
        p.forEach((d) => map.set(d, map.get(d) - 1));
        out.push(c);
      }
    }
    return out;
  };
  const revB = take(rev, remRev, 'revPerDay', 'rev');
  const newB = take(news, remNew, 'newPerDay', 'new');

  let main;
  if (root.newMix === 'after') main = [...revB, ...newB];
  else if (root.newMix === 'before') main = [...newB, ...revB];
  else {
    main = [];
    const total = revB.length + newB.length;
    if (!newB.length) main = revB;
    else if (!revB.length) main = newB;
    else {
      const spacing = total / newB.length;
      let ni = 0, ri = 0;
      for (let i = 0; i < total; i++) {
        if (ni < newB.length && (i >= Math.floor((ni + 1) * spacing) - 1 || ri >= revB.length)) main.push(newB[ni++]);
        else main.push(revB[ri++]);
      }
    }
  }
  lrn.sort((a, b) => a.due - b.due);
  return {
    lrn: lrn.filter((c) => c.due <= now),
    main,
    ahead: lrn.filter((c) => c.due > now && c.due <= now + ahead),
    later: lrn.filter((c) => c.due > now + ahead),
    counts: { new: newB.length, lrn: lrn.length, rev: revB.length },
  };
}

export function nextCard(did) {
  const q = buildQueue(did);
  const card = q.lrn[0] || q.main[0] || q.ahead[0] || null;
  // какой счётчик подсвечивать (как в Anki)
  let kind = null;
  if (card) kind = card.type === 0 ? 'new' : card.type === 2 ? 'rev' : 'lrn';
  return { card, kind, counts: q.counts, later: q.later };
}

/* Количества для списка колод (с вложенными колодами и лимитами) */
export function deckCounts() {
  const col = S.C();
  const day = S.dayOf(), cutoff = S.cutoffTs();
  const cnt = S.counts();
  const own = {};
  const o = (d) => (own[d] ||= { new: 0, lrn: 0, rev: 0, total: 0 });
  for (const c of Object.values(col.cards)) {
    const x = o(c.did);
    x.total++;
    if (!isActive(c, day)) continue;
    if (c.type === 0) x.new++;
    else if (c.type === 1 || c.type === 3) { if (c.due < cutoff) x.lrn++; }
    else if (c.due <= day) x.rev++;
  }
  const names = Object.values(col.decks);
  const children = (id) => {
    const pre = col.decks[id].name + '::';
    return names.filter((d) => d.name.startsWith(pre) && !d.name.slice(pre.length).includes('::')).map((d) => d.id);
  };
  const out = {};
  const walk = (id, newCap, revCap) => {
    const p = S.presetOf(id);
    const newLeft = Math.max(0, Math.min(newCap, p.newPerDay - (cnt.new[id] || 0)));
    const revLeft = Math.max(0, Math.min(revCap, p.revPerDay - (cnt.rev[id] || 0)));
    const x = o(id);
    let n = x.new, r = x.rev, l = x.lrn, t = x.total;
    for (const ch of children(id)) {
      const cr = walk(ch, newLeft, revLeft);
      n += cr.new; r += cr.rev; l += cr.lrn; t += cr.total;
    }
    out[id] = { new: Math.min(n, newLeft), rev: Math.min(r, revLeft), lrn: l, total: t };
    return out[id];
  };
  for (const d of names) {
    if (!d.name.includes('::')) walk(d.id, Infinity, Infinity);
  }
  return out;
}

/* ---------- ответ ---------- */

function bumpCounts(card, kind) {
  const cnt = S.counts();
  for (const d of [card.did, ...S.deckAncestors(card.did)]) cnt[kind][d] = (cnt[kind][d] || 0) + 1;
}

export function answerCard(cid, ease, timeMs = 0) {
  const col = S.C();
  const card = col.cards[cid];
  if (!card) return null;
  const note = col.notes[card.nid];
  const p = S.presetOf(card.did);
  const day = S.dayOf();
  const before = { ...card };
  const cntSnap = structuredClone(S.counts());
  const tagsBefore = [...note.tags];
  const revLen = col.revlog.length;
  const siblingsBefore = [];

  const wasNew = card.type === 0;
  const wasRev = card.type === 2;
  const res = computeAnswer(card, ease, p, true);
  Object.assign(card, res.card);
  card.reps++;
  card.mod = Date.now();

  const learning = card.type === 1 || card.type === 3;
  col.revlog.push({
    id: S.uid(), cid, ease,
    type: before.type === 0 || before.type === 1 ? 0 : before.type === 2 ? 1 : 2,
    ivl: learning ? -Math.round(res.delay) : card.ivl,
    lastIvl: before.type === 0 ? 0 : (before.type === 1 || before.type === 3) ? -60 : before.ivl,
    factor: card.factor, time: Math.min(timeMs, p.maxTime * 1000),
  });

  if (wasNew) bumpCounts(card, 'new');
  else if (wasRev) bumpCounts(card, 'rev');

  if ((wasNew && p.buryNew) || (wasRev && p.buryRev)) {
    for (const s of S.cardsOfNote(card.nid)) {
      if (s.id === card.id) continue;
      if ((wasNew && s.type === 0) || (wasRev && s.type === 2)) { siblingsBefore.push({ ...s }); s.buried = day; }
    }
  }

  let leech = false;
  if (res.leech) {
    leech = true;
    if (!note.tags.includes('leech')) note.tags.push('leech');
    if (p.leechAction === 'suspend') card.susp = true;
  }

  S.pushUndo('Ответ', () => {
    Object.assign(col.cards[cid], before);
    col.revlog.length = revLen;
    col.counts = cntSnap;
    note.tags = tagsBefore;
    siblingsBefore.forEach((s) => Object.assign(col.cards[s.id], s));
  });
  S.commit();
  return { leech, card };
}

/* Отложить родственные карточки (кнопка «Ещё → Отложить запись») */
export function buryNote(nid) {
  S.buryCards(S.cardsOfNote(nid).map((c) => c.id));
}

/* ---------- информация о карточке ---------- */

export function cardInfo(cid) {
  const col = S.C();
  const c = col.cards[cid];
  if (!c) return null;
  const log = col.revlog.filter((r) => r.cid === cid);
  const day = S.dayOf();
  let due = null;
  if (c.type === 0) due = `Новая, позиция ${c.due}`;
  else if (c.type === 2) due = new Date(S.dayStartTs(c.due) * 1000);
  else due = new Date(c.due * 1000);
  return {
    card: c, log, due,
    added: new Date(c.created),
    first: log[0] ? new Date(log[0].id) : null,
    last: log.at(-1) ? new Date(log.at(-1).id) : null,
    totalTime: log.reduce((s, r) => s + r.time, 0),
    daysUntil: c.type === 2 ? c.due - day : null,
  };
}

/* Допзанятие: увеличить сегодняшние лимиты */
export function extendLimits(did, newN, revN) {
  const cnt = S.counts();
  for (const d of [did, ...S.deckAncestors(did)]) {
    if (newN) cnt.new[d] = (cnt.new[d] || 0) - newN;
    if (revN) cnt.rev[d] = (cnt.rev[d] || 0) - revN;
  }
  S.commit();
}
