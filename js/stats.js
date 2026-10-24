// Окно «Статистика»: те же блоки, что в Anki, графики рисуются в SVG.
import * as S from './store.js';
import { searchCards } from './search.js';
import { h, openWindow, clear, chooserDialog, fmtNum, fmtDur, plural } from './ui.js';
import { esc } from './models.js';

const COLORS = {
  new: '#6aa7ff', learn: '#ff9f43', relearn: '#ff6b6b', young: '#7bd88f', mature: '#2e9e5b',
  susp: '#e8d96b', buried: '#a0522d', again: '#ff6b6b', hard: '#ff9f43', good: '#7bd88f', easy: '#6aa7ff',
};
let win = null;

/* ---------- графики ---------- */
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * p;
}

function barChart(el, { labels, series, stacked = true, xLabel, tip, every, yFmt }) {
  const n = labels.length;
  const W = 820, H = 260, m = { l: 48, r: 12, t: 10, b: 36 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const totals = labels.map((_, i) => (stacked ? series.reduce((s, x) => s + (x.values[i] || 0), 0) : Math.max(...series.map((x) => x.values[i] || 0))));
  const max = niceMax(Math.max(...totals, 0));
  if (!totals.some((t) => t > 0)) { el.innerHTML = '<div class="nodata">Нет данных</div>'; return; }
  const bw = iw / n;
  let out = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" style="max-width:${W}px;display:block;margin:0 auto">`;
  for (let t = 0; t <= 5; t++) {
    const v = (max / 5) * t, y = m.t + ih - (v / max) * ih;
    out += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="currentColor" stroke-opacity="${t ? 0.12 : 0.4}"/>`;
    out += `<text x="${m.l - 6}" y="${y + 4}" text-anchor="end">${esc(yFmt ? yFmt(v) : fmtNum(v, v % 1 ? 1 : 0))}</text>`;
  }
  const step = every || Math.max(1, Math.ceil(n / 12));
  labels.forEach((lb, i) => {
    const cx = m.l + bw * i + bw / 2;
    if (i % step === 0 || i === n - 1) out += `<text x="${cx}" y="${H - m.b + 14}" text-anchor="middle">${esc(lb)}</text>`;
  });
  if (xLabel) out += `<text x="${m.l + iw / 2}" y="${H - 4}" text-anchor="middle">${esc(xLabel)}</text>`;
  labels.forEach((lb, i) => {
    const x0 = m.l + bw * i;
    const tipText = tip ? tip(i) : '';
    if (stacked) {
      let acc = 0;
      series.forEach((s) => {
        const v = s.values[i] || 0;
        if (!v) return;
        const hh = (v / max) * ih, y = m.t + ih - ((acc + v) / max) * ih;
        out += `<rect x="${x0 + bw * 0.1}" y="${y}" width="${Math.max(1, bw * 0.8)}" height="${hh}" fill="${s.color}" data-tip="${esc(tipText)}"/>`;
        acc += v;
      });
    } else {
      const k = series.length, w = (bw * 0.8) / k;
      series.forEach((s, j) => {
        const v = s.values[i] || 0;
        if (!v) return;
        const hh = (v / max) * ih;
        out += `<rect x="${x0 + bw * 0.1 + w * j}" y="${m.t + ih - hh}" width="${Math.max(1, w - 1)}" height="${hh}" fill="${s.color}" data-tip="${esc(tipText)}"/>`;
      });
    }
    out += `<rect x="${x0}" y="${m.t}" width="${bw}" height="${ih}" fill="transparent" data-tip="${esc(tipText)}"/>`;
  });
  out += '</svg>';
  if (series.length > 1 || series[0].name) {
    out += `<div class="st-legend" style="grid-template-columns:repeat(${Math.min(series.length, 5)},auto)">${series.filter((s) => s.name).map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }
  el.innerHTML = out;
  attachTips(el);
}

let tipEl = null;
function attachTips(root) {
  root.addEventListener('mousemove', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t || !t.dataset.tip) { if (tipEl) tipEl.style.display = 'none'; return; }
    if (!tipEl) { tipEl = h('div', { class: 'st-tip' }); document.body.append(tipEl); }
    tipEl.textContent = t.dataset.tip;
    tipEl.style.display = 'block';
    tipEl.style.left = Math.min(e.clientX + 12, innerWidth - tipEl.offsetWidth - 6) + 'px';
    tipEl.style.top = (e.clientY + 14) + 'px';
  });
  root.addEventListener('mouseleave', () => { if (tipEl) tipEl.style.display = 'none'; });
}

function donut(el, slices) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (!total) { el.innerHTML = '<div class="nodata" style="padding:30px 0">Нет данных</div>'; return; }
  const R = 80, r = 48, cx = 100, cy = 100;
  let a0 = -Math.PI / 2, out = `<svg viewBox="0 0 200 200" width="200" height="200" style="display:block;margin:0 auto">`;
  for (const s of slices) {
    if (!s.value) continue;
    const a1 = a0 + (s.value / total) * Math.PI * 2;
    if (s.value === total) {
      out += `<circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${s.color}" stroke-width="${R - r}"/>`;
    } else {
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a, rad) => `${cx + Math.cos(a) * rad},${cy + Math.sin(a) * rad}`;
      out += `<path d="M${p(a0, R)} A${R},${R} 0 ${large} 1 ${p(a1, R)} L${p(a1, r)} A${r},${r} 0 ${large} 0 ${p(a0, r)} Z" fill="${s.color}" data-tip="${esc(s.name)}: ${fmtNum(s.value)}"/>`;
    }
    a0 = a1;
  }
  el.innerHTML = out + '</svg>';
  attachTips(el);
}

function heatmap(el, counts, year) {
  const first = new Date(year, 0, 1);
  const cell = 13, gap = 2, left = 28, top = 18;
  const startDow = (first.getDay() + 6) % 7;
  const days = (new Date(year + 1, 0, 1) - first) / 86400000;
  const weeks = Math.ceil((startDow + days) / 7);
  const vals = Object.values(counts).filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] || 1;
  const th = [q(0.25), q(0.5), q(0.75)];
  const shades = ['rgba(128,128,128,.18)', '#2b5a8a', '#3b82c4', '#6aa7ff', '#a9ccff'];
  let out = `<svg class="heat" viewBox="0 0 ${left + weeks * (cell + gap)} ${top + 7 * (cell + gap) + 4}" width="100%" style="max-width:${left + weeks * (cell + gap)}px;display:block;margin:0 auto">`;
  ['Пн', 'Ср', 'Пт'].forEach((d, i) => { out += `<text x="0" y="${top + i * 2 * (cell + gap) + cell - 2}" style="font-size:9px">${d}</text>`; });
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  let lastM = -1;
  for (let i = 0; i < days; i++) {
    const d = new Date(year, 0, 1 + i);
    const idx = startDow + i, wk = Math.floor(idx / 7), dow = idx % 7;
    if (d.getMonth() !== lastM && (dow === 0 || i === 0 || d.getDate() <= 7)) { if (d.getMonth() !== lastM) { out += `<text x="${left + wk * (cell + gap)}" y="10" style="font-size:9px">${months[d.getMonth()]}</text>`; lastM = d.getMonth(); } }
    const key = S.dayOf(d.getTime() + 12 * 3600000);
    const v = counts[key] || 0;
    const lvl = !v ? 0 : v <= th[0] ? 1 : v <= th[1] ? 2 : v <= th[2] ? 3 : 4;
    out += `<rect x="${left + wk * (cell + gap)}" y="${top + dow * (cell + gap)}" width="${cell}" height="${cell}" rx="2" fill="${shades[lvl]}" data-tip="${d.toLocaleDateString('ru-RU')}: ${v} ${plural(v, 'повторение', 'повторения', 'повторений')}"/>`;
  }
  el.innerHTML = out + '</svg>';
  attachTips(el);
}

/* ---------- окно ---------- */
export function openStats({ deckId } = {}) {
  if (win && !win.closed) { win.overlay.style.zIndex = 9999; return win; }
  const col = S.C();
  let scope = 'deck';
  let period = 365;
  let query = 'deck:current';
  const opt = {}; // выбранные подпериоды у блоков
  if (deckId != null) { col.config.curDeck = deckId; }

  const scopeDeck = h('input', { type: 'radio', name: 'scope', checked: true, onchange: () => { scope = 'deck'; qIn.disabled = false; qIn.value = query; draw(); } });
  const scopeCol = h('input', { type: 'radio', name: 'scope', onchange: () => { scope = 'col'; qIn.disabled = true; draw(); } });
  const qIn = h('input', { class: 'input', type: 'text', value: query, onkeydown: (e) => { if (e.key === 'Enter') { query = qIn.value; draw(); } }, onblur: () => { if (qIn.value !== query) { query = qIn.value; draw(); } } });
  const p12 = h('input', { type: 'radio', name: 'per', checked: true, onchange: () => { period = 365; draw(); } });
  const pAll = h('input', { type: 'radio', name: 'per', onchange: () => { period = Infinity; draw(); } });
  const scroll = h('div', { class: 'st-scroll' });
  const deckBtn = h('button', { class: 'btn', onclick: async () => {
    const id = await chooserDialog({ title: 'Выбрать колоду', items: S.deckList({ all: true }).map(({ deck }) => ({ id: deck.id, label: deck.name })), selected: col.config.curDeck });
    if (id != null) { scope = 'deck'; scopeDeck.checked = true; qIn.disabled = false; query = `deck:"${S.deckName(id)}"`; qIn.value = query; draw(); }
  } }, S.deckName(col.config.curDeck));
  const body = h('div', { class: 'stats' },
    h('div', { class: 'st-top' },
      h('div', { class: 'grp' }, h('label', {}, scopeDeck, 'Колода'), h('label', {}, scopeCol, 'Коллекция'), qIn),
      h('div', { class: 'grp' }, h('label', {}, p12, 'За 12 месяцев'), h('label', {}, pAll, 'Вся история'))),
    scroll,
    h('div', { class: 'st-foot' }, h('span', {}, 'Колода'), deckBtn, h('span', { class: 'sp' }),
      h('button', { class: 'btn', onclick: () => { document.body.classList.add('printing'); win.overlay.classList.add('print-stats'); window.print(); setTimeout(() => { document.body.classList.remove('printing'); win.overlay.classList.remove('print-stats'); }, 500); } }, 'Сохранить в формате PDF'),
      h('button', { class: 'btn', onclick: () => win.close() }, 'Закрыть')));
  win = openWindow({ title: 'Статистика', width: 920, height: '86vh', maximizable: true, body, className: 'win-stats' });
  const unsub = S.onChange(() => draw());
  win.onclosed = () => { unsub(); win = null; if (tipEl) tipEl.style.display = 'none'; };

  function draw() {
    const top = scroll.scrollTop;
    const today = S.dayOf();
    const q = scope === 'col' ? '' : query;
    let cards;
    try { cards = searchCards(q); } catch { cards = []; }
    const ids = new Set(cards.map((c) => c.id));
    const startDay = Number.isFinite(period) ? today - period + 1 : -Infinity;
    const rev = col.revlog.filter((r) => (scope === 'col' || ids.has(r.cid)) && S.dayOf(r.id) >= startDay);
    const day = (r) => S.dayOf(r.id);
    deckBtn.textContent = S.deckName(col.config.curDeck);
    clear(scroll);

    const card = (title, ...kids) => { const c = h('section', { class: 'st-card' }, h('h2', {}, title), ...kids); scroll.append(c); return c; };
    const box = () => h('div');
    const radios = (key, labels, def, cb) => {
      opt[key] ??= def;
      return h('div', { class: 'opts' }, labels.map(([v, t]) => h('label', {}, h('input', { type: 'radio', name: key + Math.random(), checked: opt[key] === v, onchange: () => { opt[key] = v; cb(); } }), t)));
    };

    /* --- Сегодня --- */
    {
      const startTs = S.dayStartTs(today) * 1000;
      const todays = col.revlog.filter((r) => r.id >= startTs && (scope === 'col' || ids.has(r.cid)));
      const c = card('Сегодня');
      if (!todays.length) c.append(h('div', { class: 'today' }, 'Ни одна карточка не была повторена сегодня.'));
      else {
        const sec = todays.reduce((s, r) => s + r.time, 0) / 1000;
        const again = todays.filter((r) => r.ease === 1).length;
        const kinds = [0, 1, 2, 3].map((t) => todays.filter((r) => r.type === t).length);
        c.append(
          h('div', { class: 'today' }, `Повторено ${fmtNum(todays.length)} ${plural(todays.length, 'карточка', 'карточки', 'карточек')} за ${fmtDur(sec)} (${(sec / todays.length).toFixed(1).replace('.', ',')} с на карточку).`),
          h('div', { class: 'today' }, `Снова: ${again} (${fmtNum((again / todays.length) * 100, 1)}% верных ${fmtNum(100 - (again / todays.length) * 100, 1)}%)`),
          h('div', { class: 'today' }, `Изучение: ${kinds[0]} · Повторение: ${kinds[1]} · Переучивание: ${kinds[2]}`));
      }
    }

    /* --- Прогноз --- */
    {
      const el = box();
      const c = card('Прогноз повторений', h('div', { class: 'sub' }, 'Число повторяемых в последующие дни.'));
      const render = () => {
        const days = opt.fc === 'all' ? Math.max(30, ...cards.filter((x) => x.type === 2).map((x) => x.due - today + 1), 30) : opt.fc;
        const labels = Array.from({ length: days }, (_, i) => i);
        const lrn = new Array(days).fill(0), young = new Array(days).fill(0), mature = new Array(days).fill(0);
        let dueTotal = 0;
        for (const x of cards) {
          if (x.susp) continue;
          if (x.type === 2) {
            const d = Math.max(0, x.due - today);
            if (d < days) { (x.ivl >= 21 ? mature : young)[d]++; dueTotal++; }
          } else if (x.type === 1 || x.type === 3) {
            const d = Math.max(0, S.dayOf(x.due * 1000) - today);
            if (d < days) { lrn[d]++; dueTotal++; }
          }
        }
        barChart(el, {
          labels, every: days > 60 ? Math.ceil(days / 12) : undefined, xLabel: 'Дней',
          series: [{ name: 'Изучаемые', color: COLORS.learn, values: lrn }, { name: 'Свежие', color: COLORS.young, values: young }, { name: 'Закреплённые', color: COLORS.mature, values: mature }],
          tip: (i) => `${i === 0 ? 'Сегодня' : `Через ${i} дн.`}: ${lrn[i] + young[i] + mature[i]} повторений`,
        });
        if (dueTotal) el.append(h('div', { class: 'sub' }, `Всего: ${fmtNum(dueTotal)} · в среднем ${fmtNum(dueTotal / days, 1)} в день`));
      };
      c.append(radios('fc', [[30, '1 месяц'], [90, '3 месяца'], [365, '1 год'], ['all', 'всё время']], 30, render), el);
      render();
    }

    /* --- Календарь --- */
    {
      const counts = {};
      for (const r of col.revlog) if (scope === 'col' || ids.has(r.cid)) { const d = day(r); counts[d] = (counts[d] || 0) + 1; }
      opt.year ??= new Date().getFullYear();
      const el = box(), info = h('div', { class: 'sub' });
      const c = card('Календарь');
      const render = () => {
        yearLbl.textContent = opt.year;
        heatmap(el, counts, opt.year);
        const keys = Object.keys(counts).map(Number).sort((a, b) => a - b);
        const inYear = keys.filter((k) => new Date(S.dayStartTs(k) * 1000).getFullYear() === opt.year);
        const maxV = Math.max(0, ...inYear.map((k) => counts[k]));
        let longest = 0, run = 0, prev = null;
        for (const k of keys) { run = prev != null && k === prev + 1 ? run + 1 : 1; longest = Math.max(longest, run); prev = k; }
        let cur = 0; for (let d = counts[today] ? today : today - 1; counts[d]; d--) cur++;
        const total = inYear.reduce((s, k) => s + counts[k], 0);
        info.textContent = keys.length ? `Дней с повторениями: ${inYear.length} · Всего повторений: ${fmtNum(total)} · Максимум за день: ${fmtNum(maxV)} · Серия: ${cur} дн. (рекорд ${longest})` : 'Пока нет повторений.';
      };
      const yearLbl = h('span', { style: { minWidth: '50px', textAlign: 'center' } });
      c.append(h('div', { class: 'opts' }, h('button', { class: 'btn sm', 'aria-label': 'Предыдущий год', onclick: () => { opt.year--; render(); } }, '◀'), yearLbl, h('button', { class: 'btn sm', 'aria-label': 'Следующий год', onclick: () => { opt.year++; render(); } }, '▶')), el, info);
      render();
    }

    /* --- Повторения --- */
    {
      const el = box();
      const c = card('Повторения', h('div', { class: 'sub' }, 'Количество вопросов, на которые вы ответили.'));
      const render = () => {
        const D = opt.rvSpan;
        const labels = Array.from({ length: D }, (_, i) => i - D + 1);
        const mk = () => new Array(D).fill(0);
        const L = mk(), RL = mk(), Y = mk(), M = mk();
        const asTime = opt.rvMode === 'time';
        for (const r of rev) {
          const i = day(r) - today + D - 1;
          if (i < 0 || i >= D) continue;
          const v = asTime ? r.time / 60000 : 1;
          if (r.type === 0) L[i] += v; else if (r.type === 2) RL[i] += v; else if ((r.lastIvl || 0) >= 21) M[i] += v; else Y[i] += v;
        }
        barChart(el, {
          labels, xLabel: 'Дней', every: D > 60 ? Math.ceil(D / 12) : undefined, yFmt: asTime ? (v) => `${fmtNum(v, 0)} мин` : undefined,
          series: [{ name: 'Изучение', color: COLORS.learn, values: L }, { name: 'Переучивание', color: COLORS.relearn, values: RL }, { name: 'Свежие', color: COLORS.young, values: Y }, { name: 'Закреплённые', color: COLORS.mature, values: M }],
          tip: (i) => `${labels[i] === 0 ? 'Сегодня' : `${-labels[i]} дн. назад`}: ${asTime ? fmtNum(L[i] + RL[i] + Y[i] + M[i], 1) + ' мин' : fmtNum(L[i] + RL[i] + Y[i] + M[i]) + ' повторений'}`,
        });
        const all = rev.filter((r) => day(r) - today + D - 1 >= 0);
        if (all.length) {
          const studied = new Set(all.map(day)).size;
          el.append(h('div', { class: 'sub' }, `Дней с повторениями: ${studied} из ${D} · Всего: ${fmtNum(all.length)} · ${fmtDur(all.reduce((s, r) => s + r.time, 0) / 1000)} · Среднее за день учёбы: ${fmtNum(all.length / studied, 1)}`));
        }
      };
      opt.rvMode ??= 'count'; opt.rvSpan ??= 30;
      c.append(h('div', { class: 'opts' },
        h('label', {}, h('input', { type: 'radio', name: 'rvm', checked: opt.rvMode === 'time', onchange: () => { opt.rvMode = 'time'; render(); } }), 'Время'),
        h('label', {}, h('input', { type: 'radio', name: 'rvm', checked: opt.rvMode === 'count', onchange: () => { opt.rvMode = 'count'; render(); } }), 'Количество'),
        [[30, '1 месяц'], [90, '3 месяца'], [365, '1 год']].map(([v, t]) => h('label', {}, h('input', { type: 'radio', name: 'rvs', checked: opt.rvSpan === v, onchange: () => { opt.rvSpan = v; render(); } }), t))), el);
      render();
    }

    /* --- Количество карточек --- */
    {
      const el = box(), list = box();
      const c = card('Количество карточек');
      const render = () => {
        const sep = opt.sep !== false;
        const k = { new: 0, learn: 0, relearn: 0, young: 0, mature: 0, susp: 0, buried: 0 };
        for (const x of cards) {
          if (sep && x.susp) k.susp++;
          else if (sep && x.buried === today) k.buried++;
          else if (x.type === 0) k.new++;
          else if (x.type === 1) k.learn++;
          else if (x.type === 3) k.relearn++;
          else if (x.ivl >= 21) k.mature++;
          else k.young++;
        }
        const defs = [['new', 'Новые'], ['learn', 'Изучаемые'], ['relearn', 'Переучиваемые'], ['young', 'Свежие'], ['mature', 'Закреплённые'], ['susp', 'Исключённые'], ['buried', 'Отложенные']];
        const total = cards.length || 1;
        donut(el, defs.map(([id, name]) => ({ name, value: k[id], color: COLORS[id] })));
        list.innerHTML = `<div class="st-legend" style="grid-template-columns:auto auto auto auto">${defs.map(([id, name]) => `<span><i style="background:${COLORS[id]}"></i>${name}</span><span class="r">${fmtNum(k[id])}</span><span class="r">${fmtNum((k[id] / total) * 100, 0)}%</span><span></span>`).join('')}<span><b>Итого</b></span><span class="r"><b>${fmtNum(cards.length)}</b></span><span></span><span></span></div>`;
      };
      c.append(h('div', { class: 'opts' }, h('label', {}, h('input', { type: 'checkbox', checked: opt.sep !== false, onchange: (e) => { opt.sep = e.target.checked; render(); } }), 'Исключённые и отложенные отдельно')), el, list);
      render();
    }

    /* --- Интервалы --- */
    {
      const el = box();
      const c = card('Интервалы', h('div', { class: 'sub' }, 'Задержка до следующего повторения закреплённых и свежих карточек.'));
      const render = () => {
        const ivls = cards.filter((x) => x.type === 2).map((x) => x.ivl).sort((a, b) => a - b);
        if (!ivls.length) { el.innerHTML = '<div class="nodata">Нет данных</div>'; return; }
        let cap = opt.iv === 30 ? 30 : opt.iv === 50 ? ivls[Math.floor(ivls.length * 0.5)] : opt.iv === 95 ? ivls[Math.floor(ivls.length * 0.95)] : ivls.at(-1);
        cap = Math.max(cap, 1);
        const bins = cap > 120 ? Math.ceil(cap / 60) : 1;
        const n = Math.ceil((cap + 1) / bins);
        const vals = new Array(n).fill(0);
        ivls.forEach((v) => { if (v <= cap) vals[Math.floor(v / bins)]++; });
        barChart(el, { labels: vals.map((_, i) => i * bins), series: [{ name: '', color: COLORS.mature, values: vals }], xLabel: 'Дней', tip: (i) => `${i * bins}${bins > 1 ? `–${i * bins + bins - 1}` : ''} дн.: ${vals[i]} карточек` });
        el.append(h('div', { class: 'sub' }, `Средний интервал: ${fmtNum(ivls.reduce((s, v) => s + v, 0) / ivls.length, 1)} дн. · Самый длинный: ${fmtNum(ivls.at(-1))} дн.`));
      };
      opt.iv ??= 95;
      c.append(radios('iv', [[30, '1 месяц'], [50, '50%'], [95, '95%'], ['all', 'всё время']], 95, render), el);
      render();
    }

    /* --- Лёгкость --- */
    {
      const el = box();
      const c = card('Лёгкость карточки', h('div', { class: 'sub' }, 'Чем ниже лёгкость, тем чаще будет появляться карточка.'));
      const eases = cards.filter((x) => x.type === 2 && x.factor).map((x) => Math.round(x.factor / 10));
      if (!eases.length) el.innerHTML = '<div class="nodata">Нет данных</div>';
      else {
        const lo = 130, hi = Math.max(400, ...eases), step = 10;
        const n = Math.ceil((hi - lo) / step) + 1;
        const vals = new Array(n).fill(0);
        eases.forEach((e) => { vals[Math.min(n - 1, Math.max(0, Math.floor((e - lo) / step)))]++; });
        barChart(el, { labels: vals.map((_, i) => `${lo + i * step}%`), series: [{ name: '', color: COLORS.young, values: vals }], every: 5, tip: (i) => `${lo + i * step}%: ${vals[i]} карточек` });
        el.append(h('div', { class: 'sub' }, `Средняя лёгкость: ${fmtNum(eases.reduce((s, v) => s + v, 0) / eases.length, 0)}%`));
      }
      c.append(el);
    }

    /* --- Результативность (истинное удержание) --- */
    {
      const c = card('Результативность', h('div', { class: 'sub' }, 'Доля правильных ответов при повторении (без изучения).'));
      const periods = [['Сегодня', 0, 0], ['Вчера', 1, 1], ['На прошлой неделе', 0, 6], ['В прошлом месяце', 0, 29], ['В прошлом году', 0, 364]];
      const all = col.revlog.filter((r) => (scope === 'col' || ids.has(r.cid)) && r.type === 1);
      const pct = (a, b) => (b ? `${fmtNum((a / b) * 100, 1)}%` : 'N/A');
      const rows = periods.map(([name, from, to]) => {
        const sub = all.filter((r) => { const d = today - day(r); return d >= from && d <= to; });
        const y = sub.filter((r) => (r.lastIvl || 0) < 21), m = sub.filter((r) => (r.lastIvl || 0) >= 21);
        const ok = (a) => a.filter((r) => r.ease > 1).length;
        return h('tr', {}, h('td', {}, name), h('td', { style: { color: COLORS.young } }, pct(ok(y), y.length)), h('td', { style: { color: COLORS.mature } }, pct(ok(m), m.length)), h('td', {}, pct(ok(sub), sub.length)), h('td', { style: { color: 'var(--muted)' } }, String(sub.length)));
      });
      c.append(h('table', { class: 'simple' }, h('thead', {}, h('tr', {}, h('th'), h('th', { style: { color: COLORS.young } }, 'Свежие'), h('th', { style: { color: COLORS.mature } }, 'Закреплённые'), h('th', {}, 'Итого'), h('th', { style: { color: 'var(--muted)' } }, 'Кол-во'))), h('tbody', {}, rows)));
    }

    /* --- По часам --- */
    {
      const el = box();
      const c = card('По часам', h('div', { class: 'sub' }, 'Число ответов и доля правильных по времени суток.'));
      const render = () => {
        const lim = S.dayStartTs(today - opt.hr + 1) * 1000;
        const n = new Array(24).fill(0), ok = new Array(24).fill(0);
        for (const r of rev) { if (r.id < lim) continue; const hr = new Date(r.id).getHours(); n[hr]++; if (r.ease > 1) ok[hr]++; }
        barChart(el, { labels: n.map((_, i) => String(i)), series: [{ name: 'Правильно', color: COLORS.good, values: ok }, { name: 'Снова', color: COLORS.again, values: n.map((v, i) => v - ok[i]) }], xLabel: 'Час', every: 2, tip: (i) => `${i}:00 — ответов ${n[i]}${n[i] ? `, верных ${fmtNum((ok[i] / n[i]) * 100, 0)}%` : ''}` });
      };
      c.append(radios('hr', [[30, '1 месяц'], [90, '3 месяца'], [365, '1 год']], 365, render), el);
      render();
    }

    /* --- Кнопки ответа --- */
    {
      const el = box();
      const c = card('Кнопки ответа', h('div', { class: 'sub' }, 'Сколько раз нажимали каждую кнопку.'));
      const groups = [['Изучение', (r) => r.type !== 1], ['Свежие', (r) => r.type === 1 && (r.lastIvl || 0) < 21], ['Закреплённые', (r) => r.type === 1 && (r.lastIvl || 0) >= 21]];
      const mk = (e) => groups.map(([, f]) => rev.filter((r) => f(r) && r.ease === e).length);
      barChart(el, {
        labels: groups.map(([n]) => n), stacked: false, every: 1,
        series: [['Снова', COLORS.again, 1], ['Трудно', COLORS.hard, 2], ['Хорошо', COLORS.good, 3], ['Легко', COLORS.easy, 4]].map(([name, color, e]) => ({ name, color, values: mk(e) })),
        tip: (i) => `${groups[i][0]}: снова ${mk(1)[i]}, трудно ${mk(2)[i]}, хорошо ${mk(3)[i]}, легко ${mk(4)[i]}`,
      });
      c.append(el);
    }

    /* --- Добавленные --- */
    {
      const el = box();
      const c = card('Добавленные', h('div', { class: 'sub' }, 'Количество новых карточек.'));
      const render = () => {
        const D = opt.ad === 'all' ? Math.max(30, today - Math.min(today, ...cards.map((x) => S.dayOf(x.created))) + 1) : opt.ad;
        const vals = new Array(D).fill(0);
        for (const x of cards) { const i = S.dayOf(x.created) - today + D - 1; if (i >= 0 && i < D) vals[i]++; }
        const labels = vals.map((_, i) => i - D + 1);
        barChart(el, { labels, xLabel: 'Дней', series: [{ name: '', color: COLORS.new, values: vals }], every: D > 60 ? Math.ceil(D / 12) : undefined, tip: (i) => `${labels[i] === 0 ? 'Сегодня' : `${-labels[i]} дн. назад`}: ${vals[i]} карточек` });
      };
      c.append(radios('ad', [[30, '1 месяц'], [90, '3 месяца'], [365, '1 год'], ['all', 'всё время']], 30, render), el);
      render();
    }
    scroll.scrollTop = top;
  }
  draw();
  return win;
}
