// Редактор записи: поля с форматированием, метки, выбор типа и колоды.
import * as S from './store.js';
import { h, icon, chooserDialog, toast, readDataUrl, pickFile, clear } from './ui.js';
import { clozeNumbers, sanitizeHtml, isEmptyField } from './models.js';

const ALLOWED = new Set(['B', 'I', 'U', 'STRONG', 'EM', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI', 'SUP', 'SUB', 'A', 'IMG', 'SPAN', 'CODE', 'PRE', 'BLOCKQUOTE', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'H1', 'H2', 'H3', 'HR', 'S', 'STRIKE', 'AUDIO', 'FONT']);
const KEEP_STYLE = ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration'];

export function cleanPasted(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitizeHtml(html);
  const walk = (node) => {
    for (const el of [...node.children]) {
      walk(el);
      if (!ALLOWED.has(el.tagName)) { el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        if (n === 'style') {
          const keep = a.value.split(';').map((s) => s.trim()).filter((s) => KEEP_STYLE.includes(s.split(':')[0].trim().toLowerCase()));
          if (keep.length) el.setAttribute('style', keep.join('; ')); else el.removeAttribute('style');
        } else if (!['href', 'src', 'alt', 'colspan', 'rowspan', 'controls'].includes(n)) el.removeAttribute(a.name);
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

const normalize = (html) => (/^(\s|<br\s*\/?>|&nbsp;|<div>(<br\s*\/?>)?<\/div>)*$/i.test(html) && !/<img|<audio/i.test(html) ? '' : html);

async function downscale(file, max = 1200) {
  const url = await readDataUrl(file);
  if (!/^data:image\/(png|jpe?g|webp)/.test(url)) return url;
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      if (k === 1 && file.size < 400000) return res(url);
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      res(cv.toDataURL(file.type === 'image/png' && file.size < 600000 ? 'image/png' : 'image/jpeg', 0.85));
    };
    img.onerror = () => res(url);
    img.src = url;
  });
}

export function createEditor({ mode = 'edit', typeId, did, note, onChange, onSubmit }) {
  const col = S.C();
  let nt = S.noteType(typeId || note?.tid || col.config.lastType) || S.noteTypes()[0];
  let curDid = did ?? col.config.curDeck;
  let tags = [];
  const pinned = new Set(JSON.parse(JSON.stringify(col.config.pinned?.[nt.id] || [])));
  const root = h('div', { class: 'editor' });
  let fieldEls = [];
  let lastFocus = 0;
  let dirty = false;
  const api = {
    el: root,
    get typeId() { return nt.id; },
    get deckId() { return curDid; },
    getFields: () => fieldEls.map((f) => normalize(f.get())),
    getTags: () => { commitTagInput(); return [...tags]; },
    get dirty() { return dirty; },
    markClean() { dirty = false; },
    focus(i = 0) { fieldEls[i]?.body.focus(); },
    setNote,
    clearFields,
    onTypeChange: null,
    onDeckChange: null,
    destroy() { root.remove(); },
  };
  const changed = () => { dirty = true; onChange?.(); };

  /* ---- верхняя строка (добавление) ---- */
  const typeBtn = h('button', { class: 'pickbtn', title: 'Тип записи', onclick: pickType }, nt.name);
  const deckBtn = h('button', { class: 'pickbtn', title: 'Колода', onclick: pickDeck }, S.deckName(curDid));
  const top = mode === 'add'
    ? h('div', { class: 'ed-top' }, h('span', {}, 'Тип'), typeBtn, h('span', {}, 'Колода'), deckBtn)
    : null;

  async function pickType() {
    const id = await chooserDialog({
      title: 'Выбрать тип записи', selected: nt.id,
      items: S.noteTypes().map((t) => ({ id: t.id, label: t.name })),
      extra: [{ label: 'Управление', onClick: async () => (await import('./notetypes.js')).openManageTypes(() => rebuild()) }],
    });
    if (id != null && id !== nt.id) changeType(id);
  }
  async function pickDeck() {
    const id = await chooserDialog({
      title: 'Выбрать колоду', selected: curDid,
      items: S.deckList({ all: true }).map(({ deck }) => ({ id: deck.id, label: deck.name })),
      extra: [{ label: 'Добавить', onClick: async () => {
        const { promptDialog } = await import('./ui.js');
        const name = await promptDialog({ title: 'Новая колода', label: 'Название колоды:' });
        if (name?.trim()) { const nid = S.createDeck(name); setDeck(nid); }
      } }],
    });
    if (id != null) setDeck(id);
  }
  function setDeck(id) {
    curDid = id;
    deckBtn.textContent = S.deckName(id);
    col.config.lastDeck = id;
    api.onDeckChange?.(id);
  }
  function changeType(id) {
    const old = api.getFields();
    nt = S.noteType(id);
    S.setConfig({ lastType: id });
    pinned.clear();
    (col.config.pinned?.[id] || []).forEach((i) => pinned.add(i));
    typeBtn.textContent = nt.name;
    if (col.config.defaultDeckMode === 'type' && col.config.typeDeck?.[id] != null && col.decks[col.config.typeDeck[id]]) setDeck(col.config.typeDeck[id]);
    build(old);
    api.onTypeChange?.(nt);
  }
  function rebuild() {
    nt = S.noteType(nt.id) || S.noteTypes()[0];
    typeBtn.textContent = nt.name;
    build(api.getFields());
  }

  /* ---- панель инструментов ---- */
  const exec = (cmd, val) => { document.execCommand(cmd, false, val); changed(); };
  const tb = (content, title, fn, cls = '') => h('button', { class: `tb ${cls}`, type: 'button', title, onmousedown: (e) => e.preventDefault(), onclick: fn }, content);
  const colorBtn = (title, cmd, def, glyph) => {
    const bar = h('i', { style: { background: def } });
    const inp = h('input', { type: 'color', value: def, title, oninput: () => { bar.style.background = inp.value; } });
    inp.addEventListener('change', () => { restoreSel(); exec(cmd, inp.value); });
    return h('span', { class: 'tb colorbtn', title, onmousedown: () => saveSel() }, glyph, bar, inp);
  };
  let savedRange = null;
  const saveSel = () => { const s = getSelection(); if (s.rangeCount) savedRange = s.getRangeAt(0).cloneRange(); };
  const restoreSel = () => { if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); } };

  function curBody() { return fieldEls[lastFocus]?.body; }

  async function attach() {
    const f = await pickFile('image/*,audio/*,video/*');
    if (!f) return;
    const b = curBody();
    if (!b) return;
    b.focus();
    if (f.type.startsWith('image/')) {
      const url = await downscale(f);
      exec('insertImage', url);
    } else if (f.type.startsWith('audio/')) {
      if (f.size > 8e6) return toast('Файл слишком большой (больше 8 МБ)');
      exec('insertHTML', `<audio controls src="${await readDataUrl(f)}"></audio>`);
    } else toast('Поддерживаются изображения и аудио');
  }

  let rec = null;
  const micBtn = tb(icon('mic'), 'Записать звук', async () => {
    if (rec) { rec.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const mr = new MediaRecorder(stream);
      rec = mr;
      micBtn.classList.add('on');
      mr.ondataavailable = (e) => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        micBtn.classList.remove('on');
        rec = null;
        const url = await readDataUrl(new Blob(chunks, { type: mr.mimeType }));
        curBody()?.focus();
        exec('insertHTML', `<audio controls src="${url}"></audio>`);
      };
      mr.start();
      toast('Идёт запись. Нажмите микрофон ещё раз, чтобы остановить.');
    } catch { toast('Нет доступа к микрофону'); }
  });

  function wrapCloze(sameNumber) {
    const b = curBody();
    if (!b) return;
    const all = fieldEls.map((f) => f.get()).join(' ');
    const nums = clozeNumbers(all);
    const n = sameNumber ? (nums.at(-1) || 1) : (nums.at(-1) || 0) + 1;
    const sel = getSelection().toString();
    b.focus();
    exec('insertText', `{{c${n}::${sel}}}`);
  }

  const toolbar = h('div', { class: 'ed-toolbar' });
  function buildToolbar() {
    clear(toolbar);
    toolbar.append(
      h('button', { class: 'tb txt', type: 'button', onclick: async () => (await import('./notetypes.js')).openFieldsDialog(nt.id, rebuild) }, 'Поля…'),
      h('button', { class: 'tb txt', type: 'button', onclick: async () => (await import('./notetypes.js')).openCardsDialog(nt.id, rebuild, note ? { note } : null) }, 'Карточки…'),
      h('span', { class: 'gap' }),
      tb(icon('gear'), 'Настройки редактора', (e) => togglePlain(e.currentTarget)),
      h('span', { class: 'gap' }),
      tb(h('b', {}, 'B'), 'Жирный (Ctrl+B)', () => exec('bold')),
      tb(h('i', {}, 'I'), 'Курсив (Ctrl+I)', () => exec('italic')),
      tb(h('u', {}, 'U'), 'Подчёркнутый (Ctrl+U)', () => exec('underline')),
      tb(h('span', { html: 'x<sup>2</sup>' }), 'Верхний индекс (Ctrl+Shift+=)', () => exec('superscript')),
      tb(h('span', { html: 'x<sub>2</sub>' }), 'Нижний индекс (Ctrl+=)', () => exec('subscript')),
      colorBtn('Цвет текста', 'foreColor', '#4a7bff', h('span', { style: { fontWeight: 700 } }, 'A')),
      colorBtn('Цвет выделения', 'hiliteColor', '#ffd24a', icon('pin', 13)),
      tb(icon('eraser'), 'Убрать форматирование (Ctrl+R)', () => exec('removeFormat')),
      h('span', { class: 'gap' }),
      tb(h('span', { html: '&bull;&#8201;&equiv;' }), 'Маркированный список', () => exec('insertUnorderedList')),
      tb(h('span', { html: '1.&#8201;&equiv;' }), 'Нумерованный список', () => exec('insertOrderedList')),
      tb(h('span', { html: '&#9776;' }), 'Выравнивание по центру', () => exec('justifyCenter')),
      h('span', { class: 'gap' }),
      tb(icon('clip'), 'Вложить изображение или звук (F3)', attach),
      micBtn,
      tb(h('i', {}, 'f', h('sub', {}, 'x')), 'Формула LaTeX: \\( … \\)', () => { const s = getSelection().toString(); curBody()?.focus(); exec('insertText', `\\(${s}\\)`); }),
    );
    if (nt.kind === 'cloze') {
      toolbar.append(h('span', { class: 'gap' }),
        tb('[…]', 'Пропуск (Ctrl+Shift+C)', () => wrapCloze(false), 'txt'),
        tb('[…]=', 'Пропуск с тем же номером (Ctrl+Alt+Shift+C)', () => wrapCloze(true), 'txt'));
    }
  }
  function togglePlain(btn) {
    const on = !col.config.pastePlain;
    S.setConfig({ pastePlain: on });
    toast(on ? 'Вставка без форматирования включена' : 'Вставка с форматированием включена');
    btn.classList.toggle('on', on);
  }

  /* ---- поля ---- */
  const fieldsBox = h('div', { class: 'fields', style: { display: 'flex', flexDirection: 'column', gap: '4px' } });

  function build(values) {
    values = values || [];
    buildToolbar();
    clear(fieldsBox);
    fieldEls = nt.fields.map((name, i) => makeField(name, i, values[i] ?? ''));
    fieldEls.forEach((f) => fieldsBox.append(f.el));
  }

  function makeField(name, i, value) {
    const body = h('div', { class: 'field-body', contenteditable: 'true', role: 'textbox', 'aria-label': name, 'data-ph': '', tabindex: 0 });
    body.innerHTML = sanitizeHtml(value);
    const ta = h('textarea', { class: 'field-html hidden', spellcheck: 'false' });
    let htmlMode = false;
    const toggleHtml = h('button', { type: 'button', title: 'Редактор HTML (Ctrl+Shift+X)', onclick: () => setHtml(!htmlMode) }, icon('code', 14));
    const pin = mode === 'add' ? h('button', { type: 'button', class: pinned.has(i) ? 'on' : '', title: 'Закрепить содержимое поля после добавления', onclick: () => {
      if (pinned.has(i)) pinned.delete(i); else pinned.add(i);
      pin.classList.toggle('on', pinned.has(i));
      col.config.pinned = { ...(col.config.pinned || {}), [nt.id]: [...pinned] };
      S.commit();
    } }, icon('pin', 14)) : null;
    const arrow = h('button', { type: 'button', title: 'Свернуть поле', onclick: () => {
      const hide = !wrap.classList.contains('collapsed');
      wrap.classList.toggle('collapsed', hide);
      body.classList.toggle('hidden', hide);
      if (hide) ta.classList.add('hidden'); else if (htmlMode) ta.classList.remove('hidden');
      arrow.style.transform = hide ? 'rotate(-90deg)' : '';
    } }, icon('chevron', 14));
    const head = h('div', { class: 'field-head' }, arrow, h('span', { class: 'fname' }, name), pin, toggleHtml);
    const wrap = h('div', { class: 'field' }, head, body, ta);

    function setHtml(on) {
      htmlMode = on;
      toggleHtml.classList.toggle('on', on);
      if (on) { ta.value = body.innerHTML; ta.classList.remove('hidden'); ta.focus(); }
      else { ta.classList.add('hidden'); body.focus(); }
    }
    ta.addEventListener('input', () => { body.innerHTML = sanitizeHtml(ta.value); changed(); });
    body.addEventListener('input', () => {
      if (body.innerHTML === '<br>') body.innerHTML = '';
      if (htmlMode) ta.value = body.innerHTML;
      changed();
    });
    body.addEventListener('focus', () => { lastFocus = i; });
    body.addEventListener('paste', async (e) => {
      const dt = e.clipboardData;
      if (!dt) return;
      const imgFile = [...dt.files].find((f) => f.type.startsWith('image/'));
      if (imgFile) { e.preventDefault(); exec('insertImage', await downscale(imgFile)); return; }
      const html = dt.getData('text/html');
      if (html && !col.config.pastePlain && !e.shiftKey) { e.preventDefault(); exec('insertHTML', cleanPasted(html)); return; }
      e.preventDefault();
      exec('insertText', dt.getData('text/plain'));
    });
    body.addEventListener('drop', async (e) => {
      const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
      if (f) { e.preventDefault(); body.focus(); exec('insertImage', await downscale(f)); }
    });
    body.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); onSubmit?.(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && k === 'c' && nt.kind === 'cloze') { e.preventDefault(); wrapCloze(false); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.altKey && k === 'c' && nt.kind === 'cloze') { e.preventDefault(); wrapCloze(true); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && k === 'x') { e.preventDefault(); setHtml(!htmlMode); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'r') { e.preventDefault(); exec('removeFormat'); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); exec('superscript'); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === '=') { e.preventDefault(); exec('subscript'); }
      else if (e.key === 'F3') { e.preventDefault(); attach(); }
    });
    return {
      el: wrap, body,
      get: () => (htmlMode ? ta.value : body.innerHTML),
      set: (v) => { body.innerHTML = sanitizeHtml(v); ta.value = v; },
    };
  }

  /* ---- метки ---- */
  const tagInput = h('input', { type: 'text', placeholder: 'Метки', 'aria-label': 'Метки', autocomplete: 'off' });
  const tagChips = h('span', { style: { display: 'contents' } });
  const tagPop = h('div', { class: 'tagpop hidden' });
  const tagsWrap = h('div', { class: 'tags-wrap' }, icon('tag', 14), tagChips, tagInput, tagPop);
  let popSel = -1;

  function renderChips() {
    clear(tagChips);
    for (const t of tags) {
      tagChips.append(h('span', { class: 'chip', style: { background: 'var(--btn)', borderRadius: '10px', padding: '1px 8px', fontSize: '.8rem', display: 'inline-flex', gap: '4px', alignItems: 'center' } },
        t, h('button', { type: 'button', 'aria-label': 'Убрать метку', style: { background: 'none', border: 0, padding: 0, color: 'var(--muted)', lineHeight: 1 }, onclick: () => { tags = tags.filter((x) => x !== t); renderChips(); changed(); } }, '×')));
    }
    tagInput.placeholder = tags.length ? '' : 'Метки';
  }
  function commitTagInput() {
    const parts = tagInput.value.split(/[\s,]+/).filter(Boolean);
    if (parts.length) { tags = [...new Set([...tags, ...parts])]; tagInput.value = ''; renderChips(); }
    hidePop();
  }
  function hidePop() { tagPop.classList.add('hidden'); popSel = -1; }
  function showPop() {
    const q = tagInput.value.trim().toLowerCase();
    const opts = S.allTags().filter((t) => !tags.includes(t) && (!q || t.toLowerCase().includes(q))).slice(0, 30);
    if (!opts.length || !q) return hidePop();
    clear(tagPop);
    opts.forEach((t, i) => tagPop.append(h('div', { class: i === popSel ? 'sel' : '', onmousedown: (e) => { e.preventDefault(); tagInput.value = t; commitTagInput(); tagInput.focus(); } }, t)));
    tagPop.classList.remove('hidden');
    tagPop._opts = opts;
  }
  tagInput.addEventListener('input', () => { if (/[\s,]$/.test(tagInput.value)) { commitTagInput(); changed(); } else { popSel = -1; showPop(); } });
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (popSel >= 0 && tagPop._opts?.[popSel]) tagInput.value = tagPop._opts[popSel];
      if (tagInput.value.trim()) { commitTagInput(); changed(); } else if ((e.ctrlKey || e.metaKey)) onSubmit?.();
    } else if (e.key === 'Backspace' && !tagInput.value && tags.length) { tags.pop(); renderChips(); changed(); }
    else if (e.key === 'ArrowDown' && !tagPop.classList.contains('hidden')) { e.preventDefault(); popSel = Math.min(popSel + 1, tagPop._opts.length - 1); showPop(); }
    else if (e.key === 'ArrowUp' && !tagPop.classList.contains('hidden')) { e.preventDefault(); popSel = Math.max(popSel - 1, 0); showPop(); }
  });
  tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) { commitTagInput(); changed(); } hidePop(); });

  /* ---- общее ---- */
  root.append(...[top, toolbar, fieldsBox, h('div', { class: 'ed-section-label' }, 'Метки'), tagsWrap].filter(Boolean));

  function setNote(n) {
    note = n;
    nt = S.noteType(n.tid);
    typeBtn.textContent = nt.name;
    tags = [...n.tags];
    build(n.fields);
    renderChips();
    dirty = false;
  }

  function clearFields() {
    fieldEls.forEach((f, i) => { if (!pinned.has(i)) f.set(''); });
    dirty = false;
  }

  build(note ? note.fields : []);
  if (note) { tags = [...note.tags]; renderChips(); }
  return api;
}

export { isEmptyField };
