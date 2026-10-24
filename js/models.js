// Типы записей, шаблоны карточек и их отрисовка (как в Anki).
// Модуль не зависит от хранилища: только чистые функции.

export const BASE_CSS = `.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
}
`;
export const CLOZE_CSS = `${BASE_CSS}
.cloze {
  font-weight: bold;
  color: blue;
}
.nightMode .cloze {
  color: lightblue;
}
`;

const ANS = '{{FrontSide}}\n\n<hr id=answer>\n\n';

export function builtinNoteTypes() {
  return [
    {
      id: 'basic', name: 'Простая', kind: 'normal', builtin: true,
      fields: ['Лицевая сторона', 'Оборотная сторона'], sortField: 0, css: BASE_CSS,
      templates: [{ name: 'Карточка 1', qfmt: '{{Лицевая сторона}}', afmt: ANS + '{{Оборотная сторона}}' }],
    },
    {
      id: 'basic-typing', name: 'Простая (с вводом ответа)', kind: 'normal', builtin: true,
      fields: ['Лицевая сторона', 'Оборотная сторона'], sortField: 0, css: BASE_CSS,
      templates: [{
        name: 'Карточка 1',
        qfmt: '{{Лицевая сторона}}\n\n{{type:Оборотная сторона}}',
        afmt: '{{Лицевая сторона}}\n\n<hr id=answer>\n\n{{type:Оборотная сторона}}',
      }],
    },
    {
      id: 'basic-reversed', name: 'Простая (с обратной карточкой)', kind: 'normal', builtin: true,
      fields: ['Лицевая сторона', 'Оборотная сторона'], sortField: 0, css: BASE_CSS,
      templates: [
        { name: 'Карточка 1', qfmt: '{{Лицевая сторона}}', afmt: ANS + '{{Оборотная сторона}}' },
        { name: 'Карточка 2', qfmt: '{{Оборотная сторона}}', afmt: ANS + '{{Лицевая сторона}}' },
      ],
    },
    {
      id: 'basic-optional', name: 'Простая (с обратной по выбору)', kind: 'normal', builtin: true,
      fields: ['Лицевая сторона', 'Оборотная сторона', 'Добавить обратную'], sortField: 0, css: BASE_CSS,
      templates: [
        { name: 'Карточка 1', qfmt: '{{Лицевая сторона}}', afmt: ANS + '{{Оборотная сторона}}' },
        { name: 'Карточка 2', qfmt: '{{#Добавить обратную}}{{Оборотная сторона}}{{/Добавить обратную}}', afmt: ANS + '{{Лицевая сторона}}' },
      ],
    },
    {
      id: 'cloze', name: 'Задание с пропусками', kind: 'cloze', builtin: true,
      fields: ['Текст', 'Дополнение'], sortField: 0, css: CLOZE_CSS,
      templates: [{ name: 'Пропуск', qfmt: '{{cloze:Текст}}', afmt: '{{cloze:Текст}}<br>\n{{Дополнение}}' }],
    },
  ];
}

/* ---------- утилиты текста ---------- */

export function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function stripHtml(html) {
  if (!html) return '';
  const t = String(html)
    .replace(/<(br|\/div|\/p|\/li|\/tr)\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '');
  const ta = document.createElement('textarea');
  ta.innerHTML = t;
  return ta.value.replace(/\[sound:[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
}

export function isEmptyField(s) {
  if (s == null) return true;
  if (/<img|<audio|<video|<svg/i.test(s)) return false;
  return stripHtml(s) === '';
}

/* ---------- cloze ---------- */

export function clozeNumbers(text) {
  const set = new Set();
  const re = /\{\{c(\d+)::/g;
  let m;
  while ((m = re.exec(text || ''))) set.add(+m[1]);
  return [...set].sort((a, b) => a - b);
}

function findCloze(s, from) {
  const re = /\{\{c(\d+)::/g;
  re.lastIndex = from;
  const m = re.exec(s);
  if (!m) return null;
  let depth = 1;
  let j = m.index + m[0].length;
  while (j < s.length) {
    if (s.startsWith('{{', j)) { depth++; j += 2; }
    else if (s.startsWith('}}', j)) { depth--; if (depth === 0) break; j += 2; }
    else j++;
  }
  if (depth !== 0) return null;
  const inner = s.slice(m.index + m[0].length, j);
  // подсказка: первое "::" на верхнем уровне
  let d = 0, k = -1;
  for (let i = 0; i < inner.length; i++) {
    if (inner.startsWith('{{', i)) { d++; i++; }
    else if (inner.startsWith('}}', i)) { d--; i++; }
    else if (d === 0 && inner.startsWith('::', i)) { k = i; break; }
  }
  return {
    start: m.index, end: j + 2, n: +m[1],
    text: k >= 0 ? inner.slice(0, k) : inner,
    hint: k >= 0 ? inner.slice(k + 2) : '',
  };
}

export function clozeRender(s, ord, side) {
  let out = '', i = 0;
  while (i < s.length) {
    const c = findCloze(s, i);
    if (!c) { out += s.slice(i); break; }
    out += s.slice(i, c.start);
    if (c.n === ord) {
      out += side === 'q'
        ? `<span class="cloze" data-cloze="${c.n}">[${c.hint ? esc(c.hint) : '...'}]</span>`
        : `<span class="cloze" data-cloze="${c.n}">${clozeRender(c.text, ord, side)}</span>`;
    } else {
      out += clozeRender(c.text, ord, side);
    }
    i = c.end;
  }
  return out;
}

export function clozeAnswers(s, ord) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = findCloze(s, i);
    if (!c) break;
    if (c.n === ord) out.push(stripHtml(clozeRender(c.text, -1, 'a')));
    out.push(...clozeAnswers(c.text, ord));
    i = c.end;
  }
  return out;
}

/* ---------- шаблоны ---------- */

const parseCache = new Map();

function parseTemplate(src) {
  if (parseCache.has(src)) return parseCache.get(src);
  const root = [];
  const stack = [{ children: root }];
  const re = /\{\{([^{}]*?)\}\}/g;
  let last = 0, m;
  const top = () => stack[stack.length - 1];
  while ((m = re.exec(src))) {
    if (m.index > last) top().children.push({ t: 'text', v: src.slice(last, m.index) });
    last = re.lastIndex;
    const v = m[1].trim();
    if (v[0] === '#' || v[0] === '^') {
      const node = { t: 'sec', inv: v[0] === '^', name: v.slice(1).trim(), children: [] };
      top().children.push(node);
      stack.push(node);
    } else if (v[0] === '/') {
      if (stack.length > 1) stack.pop();
    } else if (v[0] === '!') {
      /* комментарий */
    } else {
      top().children.push({ t: 'field', v });
    }
  }
  if (last < src.length) top().children.push({ t: 'text', v: src.slice(last) });
  parseCache.set(src, root);
  return root;
}

function fieldValue(name, ctx) {
  switch (name) {
    case 'Tags': return ctx.tags || '';
    case 'Deck': return ctx.deck || '';
    case 'Subdeck': return (ctx.deck || '').split('::').pop();
    case 'Type': return ctx.typeName || '';
    case 'Card': return ctx.cardName || '';
    default: return ctx.fields[name];
  }
}

function renderNodes(nodes, ctx) {
  let out = '';
  for (const n of nodes) {
    if (n.t === 'text') out += n.v;
    else if (n.t === 'sec') {
      const has = !isEmptyField(fieldValue(n.name, ctx));
      if (n.inv ? !has : has) out += renderNodes(n.children, ctx);
    } else out += renderField(n.v, ctx);
  }
  return out;
}

function renderField(spec, ctx) {
  const parts = spec.split(':').map((s) => s.trim());
  const name = parts.pop();
  const filters = parts;
  if (name === 'FrontSide' && !filters.length) return ctx.frontSide || '';
  let val = fieldValue(name, ctx);
  if (val === undefined) return `<span class="unki-error">{unknown field ${esc(name)}}</span>`;
  if (!isEmptyField(val)) ctx.used = true;

  const isType = filters.includes('type');
  const isCloze = filters.includes('cloze');
  if (isType) {
    const expected = isCloze ? clozeAnswers(val, ctx.clozeOrd).join(', ') : stripHtml(val);
    ctx.typeExpected = expected;
    if (ctx.side === 'q') return '<center><input type="text" id="typeans" class="typeans" autocomplete="off" autocapitalize="off" spellcheck="false"></center>';
    return `<center>${typeDiff(ctx.typed || '', expected)}</center>`;
  }
  for (const f of [...filters].reverse()) {
    if (f === 'cloze') val = clozeRender(val, ctx.clozeOrd, ctx.side);
    else if (f === 'text') val = esc(stripHtml(val));
    else if (f === 'hint') {
      if (isEmptyField(val)) return '';
      val = `<details class="hint"><summary>${esc(name)}</summary>${val}</details>`;
    }
  }
  return val;
}

/* Сравнение введённого ответа с правильным (как «type:» в Anki) */
export function typeDiff(typed, expected) {
  if (typed === expected) return `<code id="typeans"><span class="typeGood">${esc(expected)}</span></code>`;
  const a = [...typed], b = [...expected];
  if (a.length > 400 || b.length > 400) {
    return `<code id="typeans"><span class="typeBad">${esc(typed)}</span><br><span id="typearrow">&darr;</span><br><span class="typeMissed">${esc(expected)}</span></code>`;
  }
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  let i = 0, j = 0, t = '', e = '';
  const wrap = (cls, ch) => `<span class="${cls}">${esc(ch)}</span>`;
  while (i < n && j < m) {
    if (a[i] === b[j]) { t += wrap('typeGood', a[i]); e += wrap('typeGood', b[j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { t += wrap('typeBad', a[i]); i++; }
    else { e += wrap('typeMissed', b[j]); j++; }
  }
  while (i < n) t += wrap('typeBad', a[i++]);
  while (j < m) e += wrap('typeMissed', b[j++]);
  return `<code id="typeans">${t}<br><span id="typearrow">&darr;</span><br>${e}</code>`;
}

export function fieldMap(nt, note) {
  const map = {};
  nt.fields.forEach((f, i) => { map[f] = note.fields[i] ?? ''; });
  return map;
}

/* Какие карточки должна иметь запись */
export function cardOrds(nt, note) {
  const fields = fieldMap(nt, note);
  if (nt.kind === 'cloze') {
    const nums = new Set();
    nt.fields.forEach((f) => clozeNumbers(fields[f]).forEach((n) => nums.add(n)));
    return [...nums].sort((a, b) => a - b).map((n) => n - 1);
  }
  const ords = [];
  nt.templates.forEach((t, i) => {
    const ctx = { fields, used: false, side: 'q', tags: '', deck: '', typeName: nt.name, cardName: t.name };
    renderNodes(parseTemplate(t.qfmt), ctx);
    if (ctx.used) ords.push(i);
  });
  return ords;
}

/* Вопрос и ответ карточки */
export function renderQA(nt, note, ord, opts = {}) {
  const fields = fieldMap(nt, note);
  const tplIdx = nt.kind === 'cloze' ? 0 : Math.min(ord, nt.templates.length - 1);
  const t = nt.templates[tplIdx];
  const base = {
    fields, tags: (note.tags || []).join(' '), deck: opts.deck || '', typeName: nt.name,
    cardName: nt.kind === 'cloze' ? `Cloze ${ord + 1}` : t.name, clozeOrd: ord + 1, typed: opts.typed || '',
  };
  const qctx = { ...base, side: 'q', used: false };
  const q = renderNodes(parseTemplate(t.qfmt), qctx);
  const actx = { ...base, side: 'a', used: false, frontSide: q };
  const a = renderNodes(parseTemplate(t.afmt), actx);
  return { q, a, css: nt.css || '', typeExpected: qctx.typeExpected, hasType: qctx.typeExpected !== undefined };
}

/* ---------- безопасность ---------- */

const BAD_TAGS = new Set(['SCRIPT', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META', 'BASE', 'FORM', 'STYLE', 'FRAME', 'FRAMESET', 'APPLET']);

export function sanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const walk = (node) => {
    for (const el of [...node.children]) {
      if (BAD_TAGS.has(el.tagName)) { el.remove(); continue; }
      for (const attr of [...el.attributes]) {
        const n = attr.name.toLowerCase();
        const v = attr.value.trim().toLowerCase();
        if (n.startsWith('on') || n === 'srcdoc') el.removeAttribute(attr.name);
        else if (['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'data'].includes(n)
          && (v.startsWith('javascript:') || v.startsWith('vbscript:') || (v.startsWith('data:') && !/^data:(image|audio|video)\//.test(v)))) {
          el.removeAttribute(attr.name);
        }
      }
      walk(el);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
