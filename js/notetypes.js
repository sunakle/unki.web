// Управление типами записей: список, поля, шаблоны карточек со стилем и предпросмотром.
import * as S from './store.js';
import { h, openWindow, promptDialog, confirmDialog, alertDialog, chooserDialog, clear, plural, toast } from './ui.js';
import { builtinNoteTypes, renderQA, clozeNumbers } from './models.js';
import { cardFrame } from './cardview.js';

const notesOf = (tid) => Object.values(S.C().notes).filter((n) => n.tid === tid);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function renameFieldRefs(src, from, to) {
  const re = new RegExp(`\\{\\{([#^/]?)((?:[^{}:]+:)*)\\s*${escRe(from)}\\s*\\}\\}`, 'g');
  return src.replace(re, (_, k, f) => `{{${k}${f}${to}}}`);
}
function removeFieldRefs(src, name) {
  const re = new RegExp(`\\{\\{(?:[#^/])?(?:[^{}:]+:)*\\s*${escRe(name)}\\s*\\}\\}`, 'g');
  return src.replace(re, '');
}

/* ---------- список типов ---------- */
export function openManageTypes(onDone) {
  let sel = S.noteTypes()[0]?.id;
  const list = h('div', { class: 'chooser-list', style: { height: '300px' } });
  const render = () => {
    clear(list);
    for (const t of S.noteTypes()) {
      const n = notesOf(t.id).length;
      list.append(h('div', { class: `chooser-row${t.id === sel ? ' sel' : ''}`, onclick: () => { sel = t.id; render(); } }, `${t.name} [${n} ${plural(n, 'запись', 'записи', 'записей')}]`));
    }
  };
  const btn = (label, fn) => h('button', { class: 'btn', style: { width: '100%' }, onclick: fn }, label);
  const w = openWindow({
    title: 'Типы записей', width: 560, className: 'dlg',
    onClose: () => onDone?.(),
    body: h('div', { class: 'dlg-body' },
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 150px', gap: '12px' } },
        list,
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          btn('Добавить…', async () => {
            const items = [
              ...builtinNoteTypes().map((t) => ({ id: 'add:' + t.id, label: `Добавить: ${t.name}` })),
              ...S.noteTypes().map((t) => ({ id: 'clone:' + t.id, label: `Клонировать: ${t.name}` })),
            ];
            const pick = await chooserDialog({ title: 'Добавить тип записи', items, filter: false, selected: items[0].id, okText: 'OK' });
            if (!pick) return;
            const [kind, id] = pick.split(':');
            const base = kind === 'add' ? builtinNoteTypes().find((t) => t.id === id) : S.noteType(id);
            const name = await promptDialog({ title: 'Название типа записи', label: 'Название:', value: kind === 'add' ? base.name + '-копия' : base.name + ' копия' });
            if (!name?.trim()) return;
            const nid = 'nt' + S.uid();
            S.C().noteTypes[nid] = { ...structuredClone(base), id: nid, name: name.trim(), builtin: false };
            S.commit(); sel = nid; render();
          }),
          btn('Переименовать…', async () => {
            const t = S.noteType(sel);
            const name = await promptDialog({ title: 'Переименовать тип записи', label: 'Новое название:', value: t.name });
            if (name?.trim()) { t.name = name.trim(); S.commit(); render(); }
          }),
          btn('Удалить', async () => {
            if (S.noteTypes().length < 2) return alertDialog('Нужно оставить хотя бы один тип записи.');
            const n = notesOf(sel);
            const ok = await confirmDialog({ title: 'Удаление типа', danger: true, okText: 'Удалить', message: `Удалить тип «${S.noteType(sel).name}» вместе с ${n.length} ${plural(n.length, 'записью', 'записями', 'записями')}?` });
            if (!ok) return;
            S.deleteNotes(n.map((x) => x.id));
            delete S.C().noteTypes[sel];
            S.commit();
            sel = S.noteTypes()[0].id; render();
          }),
          h('div', { style: { height: '10px' } }),
          btn('Поля…', () => openFieldsDialog(sel, render)),
          btn('Карточки…', () => openCardsDialog(sel, render)),
        )),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => w.close() }, 'Закрыть'))),
  });
  render();
  return w;
}

/* ---------- поля ---------- */
export function openFieldsDialog(typeId, onDone) {
  const nt = S.noteType(typeId);
  const items = nt.fields.map((name, i) => ({ name, from: i }));
  let sortIdx = nt.sortField || 0;
  let sel = 0;
  const list = h('div', { class: 'chooser-list', style: { height: '230px' } });
  const sortChk = h('input', { type: 'checkbox', onchange: () => { if (sortChk.checked) sortIdx = sel; render(); } });
  const render = () => {
    clear(list);
    items.forEach((it, i) => list.append(h('div', { class: `chooser-row${i === sel ? ' sel' : ''}`, onclick: () => { sel = i; render(); } }, `${i + 1}: ${it.name}`)));
    sortChk.checked = sel === sortIdx;
  };
  const btn = (label, fn) => h('button', { class: 'btn', style: { width: '100%' }, onclick: fn }, label);
  const w = openWindow({
    title: `Поля для ${nt.name}`, width: 460, className: 'dlg',
    body: h('div', { class: 'dlg-body' },
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 140px', gap: '12px' } },
        list,
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
          btn('Добавить', async () => {
            const name = await promptDialog({ title: 'Новое поле', label: 'Название поля:', validate: (v) => (!v.trim() ? 'Введите название' : items.some((x) => x.name.toLowerCase() === v.trim().toLowerCase()) ? 'Такое поле уже есть' : '') });
            if (name?.trim()) { items.push({ name: name.trim(), from: -1 }); sel = items.length - 1; render(); }
          }),
          btn('Удалить', async () => {
            if (items.length < 2) return alertDialog('В типе должно остаться хотя бы одно поле.');
            const it = items[sel];
            if (it.from >= 0) {
              const n = notesOf(typeId).length;
              if (n && !(await confirmDialog({ title: 'Удалить поле', danger: true, okText: 'Удалить', message: `Удалить поле «${it.name}» у ${n} ${plural(n, 'записи', 'записей', 'записей')}? Данные поля пропадут при сохранении.` }))) return;
            }
            items.splice(sel, 1);
            if (sortIdx === sel) sortIdx = 0; else if (sortIdx > sel) sortIdx--;
            sel = Math.max(0, sel - 1); render();
          }),
          btn('Переименовать', async () => {
            const name = await promptDialog({ title: 'Переименовать поле', label: 'Новое название:', value: items[sel].name, validate: (v) => (!v.trim() ? 'Введите название' : items.some((x, i) => i !== sel && x.name.toLowerCase() === v.trim().toLowerCase()) ? 'Такое поле уже есть' : '') });
            if (name?.trim()) { items[sel].name = name.trim(); render(); }
          }),
          btn('Вверх', () => { if (sel > 0) { [items[sel - 1], items[sel]] = [items[sel], items[sel - 1]]; if (sortIdx === sel) sortIdx--; else if (sortIdx === sel - 1) sortIdx++; sel--; render(); } }),
          btn('Вниз', () => { if (sel < items.length - 1) { [items[sel + 1], items[sel]] = [items[sel], items[sel + 1]]; if (sortIdx === sel) sortIdx++; else if (sortIdx === sel + 1) sortIdx--; sel++; render(); } }),
        )),
      h('label', { class: 'chk' }, sortChk, 'Использовать это поле для сортировки'),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: save }, 'Сохранить'),
        h('button', { class: 'btn', onclick: () => w.close() }, 'Отмена'))),
  });
  render();

  function save() {
    const oldNames = nt.fields;
    const oldNotes = notesOf(typeId);
    // шаблоны: переименования и удаления; временные имена исключают конфликты при перестановках
    const tmpNames = oldNames.map((n, i) => `\u0001${i}\u0001`);
    nt.templates.forEach((t) => {
      let q = t.qfmt, a = t.afmt;
      oldNames.forEach((n, i) => { q = renameFieldRefs(q, n, tmpNames[i]); a = renameFieldRefs(a, n, tmpNames[i]); });
      items.forEach((it) => {
        if (it.from >= 0) { q = renameFieldRefs(q, tmpNames[it.from], it.name); a = renameFieldRefs(a, tmpNames[it.from], it.name); }
      });
      oldNames.forEach((n, i) => { if (!items.some((it) => it.from === i)) { q = removeFieldRefs(q, tmpNames[i]); a = removeFieldRefs(a, tmpNames[i]); } });
      t.qfmt = q; t.afmt = a;
    });
    oldNotes.forEach((n) => { n.fields = items.map((it) => (it.from >= 0 ? n.fields[it.from] ?? '' : '')); n.mod = Date.now(); });
    nt.fields = items.map((it) => it.name);
    nt.sortField = Math.min(sortIdx, nt.fields.length - 1);
    S.syncCards(typeId);
    S.commit();
    w.close(true);
    onDone?.();
    toast('Поля сохранены');
  }
  return w;
}

/* ---------- шаблоны карточек ---------- */
export function openCardsDialog(typeId, onDone, ctx) {
  const nt = S.noteType(typeId);
  const work = {
    css: nt.css,
    tpls: nt.templates.map((t, i) => ({ ...t, from: i })),
  };
  let ti = 0, view = 'front', side = 'q';
  const ta = h('textarea', { class: 'code', style: { flex: 1, minHeight: '220px' }, spellcheck: 'false' });
  const tabs = h('div', { class: 'tabs', style: { padding: 0, background: 'none' } });
  const viewSel = h('div', { class: 'seg' });
  const sideSel = h('div', { class: 'seg' });
  const frame = cardFrame({});
  frame.el.style.minHeight = '200px';

  const sample = () => {
    const n = ctx?.note?.tid === typeId ? ctx.note : notesOf(typeId)[0];
    if (n) return n;
    const fields = nt.kind === 'cloze'
      ? ['Столица {{c1::Франции}} — {{c2::Париж}}', 'Дополнение']
      : nt.fields.map((f) => `Пример: ${f}`);
    return { id: 0, tid: typeId, fields, tags: [] };
  };

  const curText = () => (view === 'style' ? work.css : view === 'front' ? work.tpls[ti].qfmt : work.tpls[ti].afmt);
  const setText = (v) => { if (view === 'style') work.css = v; else if (view === 'front') work.tpls[ti].qfmt = v; else work.tpls[ti].afmt = v; };

  function preview() {
    const tmp = { ...nt, templates: work.tpls, css: work.css };
    const note = sample();
    let ord = ti;
    if (nt.kind === 'cloze') { const nums = clozeNumbers(note.fields.join(' ')); ord = (nums[0] || 1) - 1; }
    const qa = renderQA(tmp, note, ord);
    frame.show(side === 'q' ? qa.q : qa.a, work.css);
  }
  function render() {
    clear(tabs);
    work.tpls.forEach((t, i) => tabs.append(h('button', { class: i === ti ? 'on' : '', onclick: () => { ti = i; render(); } }, t.name)));
    clear(viewSel);
    [['front', 'Лицевая сторона'], ['style', 'Стиль'], ['back', 'Оборотная сторона']].forEach(([k, label]) =>
      viewSel.append(h('button', { class: view === k ? 'on' : '', onclick: () => { view = k; if (k !== 'style') side = k === 'front' ? 'q' : 'a'; render(); } }, label)));
    clear(sideSel);
    [['q', 'Вопрос'], ['a', 'Ответ']].forEach(([k, label]) =>
      sideSel.append(h('button', { class: side === k ? 'on' : '', onclick: () => { side = k; preview(); render(); } }, label)));
    ta.value = curText();
    preview();
  }
  ta.addEventListener('input', () => { setText(ta.value); preview(); });

  const isCloze = nt.kind === 'cloze';
  const w = openWindow({
    title: `Карточки для ${nt.name}`, width: 920, height: 560, maximizable: true,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '10px', gap: '8px' } },
      h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } }, tabs, h('span', { class: 'sp' }),
        !isCloze ? h('button', { class: 'btn sm', onclick: () => {
          const base = work.tpls[ti];
          work.tpls.push({ name: `Card ${work.tpls.length + 1}`, qfmt: base.qfmt, afmt: base.afmt, from: -1 });
          ti = work.tpls.length - 1; render();
        } }, 'Добавить тип карточки') : null,
        !isCloze ? h('button', { class: 'btn sm', onclick: async () => {
          if (work.tpls.length < 2) return alertDialog('Нужен хотя бы один тип карточки.');
          if (await confirmDialog({ title: 'Удалить тип карточки', danger: true, okText: 'Удалить', message: `Удалить «${work.tpls[ti].name}»? Все карточки этого вида будут удалены при сохранении.` })) { work.tpls.splice(ti, 1); ti = Math.max(0, ti - 1); render(); }
        } }, 'Удалить') : null,
        !isCloze ? h('button', { class: 'btn sm', onclick: async () => {
          const name = await promptDialog({ title: 'Переименовать тип карточки', label: 'Новое название:', value: work.tpls[ti].name });
          if (name?.trim()) { work.tpls[ti].name = name.trim(); render(); }
        } }, 'Переименовать') : null),
      h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: '10px', flex: 1, minHeight: 0 } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 } }, viewSel, ta,
          h('div', { style: { fontSize: '.75rem', color: 'var(--muted)' } }, 'Поля: {{Поле}}, {{FrontSide}}, {{cloze:Текст}}, {{type:Поле}}, {{#Поле}}…{{/Поле}}, {{^Поле}}…{{/Поле}}')),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minHeight: 0 } }, sideSel, frame.el)),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: save }, 'Сохранить'),
        h('button', { class: 'btn', onclick: () => w.close() }, 'Отмена'))),
  });
  render();

  function save() {
    const col = S.C();
    const keep = new Map(work.tpls.filter((t) => t.from >= 0).map((t, ni) => [t.from, work.tpls.indexOf(t)]));
    // удалить карточки удалённых шаблонов и пересчитать номера
    const removed = [];
    for (const c of Object.values(col.cards)) {
      const n = col.notes[c.nid];
      if (!n || n.tid !== typeId || isCloze) continue;
      if (keep.has(c.ord)) c.ord = keep.get(c.ord); else removed.push(c.id);
    }
    removed.forEach((id) => delete col.cards[id]);
    nt.templates = work.tpls.map(({ name, qfmt, afmt }) => ({ name, qfmt, afmt }));
    nt.css = work.css;
    S.syncCards(typeId);
    S.commit();
    w.close(true);
    onDone?.();
    toast('Шаблоны сохранены');
  }
  return w;
}
