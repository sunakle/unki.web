// Импорт, экспорт, резервные копии, окно «Синхронизация».
import * as S from './store.js';
import { h, openWindow, clear, toast, alertDialog, confirmDialog, pickFile, readText, downloadFile, plural, fmtNum, fmtDateTime } from './ui.js';
import { stripHtml, cardOrds, esc } from './models.js';

const stamp = () => new Date().toISOString().slice(0, 10);
const safeName = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'unki';

/* ---------- резервные копии ---------- */
export function downloadBackup() {
  const col = S.C();
  downloadFile(`unki-backup-${stamp()}.json`, JSON.stringify({ format: 'unki-backup', version: 1, exported: Date.now(), collection: col }));
  toast('Резервная копия сохранена');
}

export async function restoreBackup(file) {
  file ||= await pickFile('.json,application/json');
  if (!file) return;
  let obj;
  try { obj = JSON.parse(await readText(file)); } catch { return alertDialog('Файл не похож на резервную копию Unki.'); }
  if (obj?.format !== 'unki-backup' || !obj.collection?.v) return alertDialog('Это не резервная копия Unki. Для импорта колод используйте «Импортировать».');
  const c = obj.collection;
  const n = Object.keys(c.cards || {}).length;
  const ok = await confirmDialog({
    title: 'Восстановить из копии', danger: true, okText: 'Заменить данные',
    message: `Копия от ${fmtDateTime(obj.exported)}: ${fmtNum(n)} ${plural(n, 'карточка', 'карточки', 'карточек')}.\n\nВсе текущие данные будут заменены. Сначала сохраните копию текущих данных, если они нужны.`,
  });
  if (!ok) return;
  S.replaceCollection(c);
  toast('Данные восстановлены');
}

/* ---------- экспорт ---------- */
function collectSubset({ did, nids, sched }) {
  const col = S.C();
  let cards;
  if (nids) { const set = new Set(nids); cards = Object.values(col.cards).filter((c) => set.has(c.nid)); }
  else if (did != null) { const ids = new Set(S.deckSubtree(did)); cards = Object.values(col.cards).filter((c) => ids.has(c.did)); }
  else cards = Object.values(col.cards);
  const noteIds = new Set(cards.map((c) => c.nid));
  const notes = [...noteIds].map((id) => col.notes[id]).filter(Boolean);
  const types = [...new Set(notes.map((n) => n.tid))].map((id) => col.noteTypes[id]);
  const deckIds = new Set(cards.map((c) => c.did));
  const decks = [...deckIds].map((id) => col.decks[id]).filter(Boolean);
  const cardIds = new Set(cards.map((c) => c.id));
  return {
    format: 'unki-deck', version: 1, exported: Date.now(), includesScheduling: sched,
    decks: decks.map((d) => ({ id: d.id, name: d.name, desc: d.desc })),
    noteTypes: types, notes,
    cards: cards.map((c) => (sched ? c : { ...c, type: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0, due: 0 })),
    revlog: sched ? col.revlog.filter((r) => cardIds.has(r.cid)) : [],
  };
}

function toText(notes, { tags, html }) {
  const lines = ['#separator:tab', `#html:${html}`];
  const maxF = notes.reduce((m, n) => Math.max(m, n.fields.length), 0);
  if (tags) lines.push(`#tags column:${maxF + 1}`);
  for (const n of notes) {
    const cells = n.fields.map((f) => {
      const v = html ? f : stripHtml(f);
      return v.replace(/\t/g, ' ').replace(/\r?\n/g, html ? '<br>' : ' ');
    });
    while (cells.length < maxF) cells.push('');
    if (tags) cells.push(n.tags.join(' '));
    lines.push(cells.join('\t'));
  }
  return lines.join('\n') + '\n';
}

export function openExport(did, nids) {
  const scope = nids ? 'selected' : did != null ? 'deck' : 'all';
  const fmt = h('select', { class: 'input' },
    h('option', { value: 'json' }, 'Unki: колода или коллекция (.json)'),
    h('option', { value: 'txt' }, 'Записи в виде текста (.txt, совместимо с Anki)'));
  const sched = h('input', { type: 'checkbox', checked: true });
  const tags = h('input', { type: 'checkbox', checked: true });
  const html = h('input', { type: 'checkbox', checked: true });
  const deckSel = h('select', { class: 'input' }, h('option', { value: '' }, 'Все колоды'), S.deckList({ all: true }).map(({ deck }) => h('option', { value: deck.id, selected: deck.id === did }, deck.name)));
  const schedRow = h('label', { class: 'chk' }, sched, 'Включить расписание и историю повторений');
  const txtRows = h('div', { class: 'hidden' }, h('label', { class: 'chk' }, tags, 'Включить метки'), h('label', { class: 'chk' }, html, 'Сохранить HTML-разметку'));
  fmt.onchange = () => { schedRow.classList.toggle('hidden', fmt.value !== 'json'); txtRows.classList.toggle('hidden', fmt.value !== 'txt'); };
  const w = openWindow({
    title: 'Экспорт', width: 460, className: 'dlg',
    body: h('div', { class: 'dlg-body' },
      h('label', {}, 'Формат:'), fmt,
      scope === 'selected' ? h('div', { class: 'msg' }, `Будет сохранено записей: ${nids.length}`) : [h('label', {}, 'Что экспортировать:'), deckSel],
      schedRow, txtRows,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn primary', onclick: go }, 'Экспорт'),
        h('button', { class: 'btn', onclick: () => w.close() }, 'Отмена'))),
  });
  function go() {
    const d = scope === 'selected' ? null : deckSel.value === '' ? null : +deckSel.value;
    const base = scope === 'selected' ? 'selected' : d != null ? safeName(S.deckName(d)) : 'collection';
    if (fmt.value === 'json') {
      const data = collectSubset({ did: d, nids: scope === 'selected' ? nids : null, sched: sched.checked });
      if (!data.cards.length) { toast('Нечего экспортировать: нет карточек'); return; }
      downloadFile(`${base}.unki.json`, JSON.stringify(data));
    } else {
      const data = collectSubset({ did: d, nids: scope === 'selected' ? nids : null, sched: false });
      if (!data.notes.length) { toast('Нечего экспортировать: нет записей'); return; }
      downloadFile(`${base}.txt`, toText(data.notes, { tags: tags.checked, html: html.checked }), 'text/plain;charset=utf-8');
    }
    w.close(true);
    toast('Файл сохранён');
  }
  return w;
}

/* ---------- импорт ---------- */
export async function openImport(file) {
  file ||= await pickFile('.json,.txt,.csv,.tsv,.apkg,.colpkg,.unki');
  if (!file) return;
  const name = file.name.toLowerCase();
  if (/\.(apkg|colpkg)$/.test(name)) {
    return alertDialog('Файлы .apkg и .colpkg пока не поддерживаются.\n\nКак перенести колоду из Anki:\n1. В Anki откройте «Файл → Экспортировать…».\n2. Формат: «Записи в виде простого текста (*.txt)», включите «Включить HTML и медиа-ссылки» и «Включить метки».\n3. Импортируйте полученный .txt здесь.\n\nИстория повторений при таком способе не переносится.', 'Формат не поддерживается');
  }
  const text = await readText(file);
  if (/\.(json|unki)$/.test(name) || text.trimStart().startsWith('{')) {
    let obj;
    try { obj = JSON.parse(text); } catch { return alertDialog('Не удалось прочитать файл: это не JSON.'); }
    if (obj?.format === 'unki-backup') return restoreBackup(file);
    if (obj?.format === 'unki-deck') return importDeckJson(obj);
    return alertDialog('Неизвестный формат файла.');
  }
  return openTextImport(text, file.name);
}

function importDeckJson(obj) {
  const col = S.C();
  const nCards = obj.cards?.length || 0;
  const nNotes = obj.notes?.length || 0;
  const skipChk = h('input', { type: 'checkbox', checked: true });
  const schedChk = h('input', { type: 'checkbox', checked: !!obj.includesScheduling, disabled: !obj.includesScheduling });
  const w = openWindow({
    title: 'Импорт колоды', width: 460, className: 'dlg',
    body: h('div', { class: 'dlg-body' },
      h('div', { class: 'msg' }, `В файле: ${fmtNum(nNotes)} ${plural(nNotes, 'запись', 'записи', 'записей')}, ${fmtNum(nCards)} ${plural(nCards, 'карточка', 'карточки', 'карточек')}, колод: ${obj.decks?.length || 0}.`),
      h('label', { class: 'chk' }, skipChk, 'Пропускать дубликаты (совпадает тип и первое поле)'),
      h('label', { class: 'chk' }, schedChk, 'Импортировать расписание и историю повторений'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: go }, 'Импортировать'), h('button', { class: 'btn', onclick: () => w.close() }, 'Отмена'))),
  });
  function go() {
    const useSched = schedChk.checked;
    // типы записей
    const typeMap = {};
    for (const t of obj.noteTypes || []) {
      const ex = col.noteTypes[t.id];
      if (ex && JSON.stringify(ex.fields) === JSON.stringify(t.fields)) typeMap[t.id] = t.id;
      else if (!ex) { col.noteTypes[t.id] = t; typeMap[t.id] = t.id; }
      else { const id = 'nt' + S.uid(); col.noteTypes[id] = { ...t, id, builtin: false }; typeMap[t.id] = id; }
    }
    const deckMap = {};
    for (const d of obj.decks || []) { const id = S.findDeck(d.name)?.id ?? S.createDeck(d.name); deckMap[d.id] = id; if (d.desc && !col.decks[id].desc) col.decks[id].desc = d.desc; }
    const firstKey = new Map();
    if (skipChk.checked) {
      for (const n of Object.values(col.notes)) { const nt = col.noteTypes[n.tid]; firstKey.set(n.tid + '|' + stripHtml(n.fields[nt.sortField || 0]).toLowerCase(), true); }
    }
    const noteMap = {}, cardMap = {};
    let addedNotes = 0, skipped = 0, addedCards = 0;
    for (const n of obj.notes || []) {
      const tid = typeMap[n.tid];
      const nt = col.noteTypes[tid];
      if (!nt) continue;
      const key = tid + '|' + stripHtml(n.fields[nt.sortField || 0] || '').toLowerCase();
      if (skipChk.checked && firstKey.has(key)) { skipped++; continue; }
      const id = S.uid();
      col.notes[id] = { id, tid, fields: [...n.fields], tags: [...(n.tags || [])], mod: n.mod || Date.now() };
      noteMap[n.id] = id; addedNotes++;
      firstKey.set(key, true);
    }
    for (const c of obj.cards || []) {
      const nid = noteMap[c.nid];
      if (!nid) continue;
      const id = S.uid();
      const base = { ...c, id, nid, did: deckMap[c.did] ?? 1, mod: Date.now(), buried: -1 };
      if (!useSched) Object.assign(base, { type: 0, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0, due: col.nextPos++ });
      else if (base.type === 0) base.due = col.nextPos++;
      col.cards[id] = base;
      cardMap[c.id] = id; addedCards++;
    }
    if (useSched) for (const r of obj.revlog || []) if (cardMap[r.cid]) col.revlog.push({ ...r, id: S.uid(), cid: cardMap[r.cid] });
    // карточки, которых не хватает (например, если шаблон изменился)
    for (const nid of Object.values(noteMap)) {
      const n = col.notes[nid], nt = col.noteTypes[n.tid];
      const have = new Set(Object.values(col.cards).filter((c) => c.nid === nid).map((c) => c.ord));
      const did = Object.values(col.cards).find((c) => c.nid === nid)?.did ?? 1;
      for (const ord of cardOrds(nt, n)) if (!have.has(ord)) { const id = S.uid(); col.cards[id] = { id, nid, ord, did, type: 0, due: col.nextPos++, ivl: 0, factor: 0, reps: 0, lapses: 0, step: 0, flag: 0, susp: false, buried: -1, mod: Date.now(), created: id }; addedCards++; }
    }
    S.commit();
    w.close(true);
    alertDialog(`Импорт завершён.\nДобавлено записей: ${addedNotes}\nДобавлено карточек: ${addedCards}${skipped ? `\nПропущено дубликатов: ${skipped}` : ''}`);
  }
}

/* Типы записей из Anki (английские и русские названия) */
const NT_ALIASES = {
  basic: 'basic', 'basic (and reversed card)': 'basic-reversed', 'basic (optional reversed card)': 'basic-optional',
  'basic (type in the answer)': 'basic-typing', cloze: 'cloze',
};
function findType(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  const id = NT_ALIASES[n];
  return (id && S.noteType(id)) || S.noteTypes().find((t) => t.name.toLowerCase() === n) || null;
}

/* Импорт текстовых файлов (TSV/CSV и экспорт Anki .txt) */
function parseDelimited(text, sep) {
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"' && cur === '') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

function openTextImport(raw, fileName) {
  const col = S.C();
  const headers = {};
  const body = [];
  for (const line of raw.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^#([a-z ]+):(.*)$/i.exec(line);
    if (m && !body.length) headers[m[1].trim().toLowerCase()] = m[2].trim();
    else body.push(line);
  }
  const sample = body.slice(0, 20).join('\n');
  const detect = () => {
    const sepH = headers.separator;
    if (sepH) return { tab: '\t', comma: ',', semicolon: ';', space: ' ', pipe: '|', colon: ':' }[sepH.toLowerCase()] || '\t';
    let best = '\t', bestN = 0;
    for (const c of ['\t', ';', ',', '|']) {
      const n = sample.split(c).length - 1;
      if (n > bestN) { best = c; bestN = n; }
    }
    return best;
  };
  let sep = detect();
  const typeSel = h('select', { class: 'input' }, S.noteTypes().map((t) => h('option', { value: t.id, selected: t.id === col.config.lastType }, t.name)));
  const fileDecks = !!(headers['deck column'] || headers.deck);
  const deckSel = h('select', { class: 'input' }, fileDecks ? h('option', { value: '' }, '— как указано в файле —') : null,
    S.deckList({ all: true }).map(({ deck }) => h('option', { value: deck.id, selected: !fileDecks && deck.id === col.config.curDeck }, deck.name)));
  const sepSel = h('select', { class: 'input', onchange: () => { sep = sepSel.value === 'tab' ? '\t' : sepSel.value; refresh(); } },
    [['tab', 'Табуляция'], [';', 'Точка с запятой'], [',', 'Запятая'], ['|', 'Вертикальная черта']].map(([v, t]) => h('option', { value: v, selected: (v === 'tab' ? '\t' : v) === sep }, t)));
  const htmlChk = h('input', { type: 'checkbox', checked: headers.html === 'true' });
  const skipChk = h('input', { type: 'checkbox', checked: true });
  const mapBox = h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', alignItems: 'center' } });
  const prev = h('div', { style: { fontSize: '.78rem', maxHeight: '140px', overflow: 'auto', background: 'var(--deep)', border: '1px solid var(--border-soft)', borderRadius: '4px', padding: '4px 8px', whiteSpace: 'pre' } });
  let rows = [], maps = [], tagsCol = '0';
  const tagCol = (headers['tags column'] ? headers['tags column'] : '0');

  let typeAuto = false;
  function refresh() {
    rows = parseDelimited(body.join('\n'), sep);
    if (!typeAuto) {
      typeAuto = true;
      const ntc = +headers['notetype column'];
      const guess = findType(ntc ? rows[0]?.[ntc - 1] : headers.notetype);
      if (guess) typeSel.value = guess.id;
    }
    const ncol = Math.max(1, ...rows.slice(0, 200).map((r) => r.length));
    const nt = S.noteType(typeSel.value);
    const opts = (sel) => [h('option', { value: '0' }, '— пропустить —'), ...Array.from({ length: ncol }, (_, i) => h('option', { value: i + 1, selected: sel === i + 1 }, `Колонка ${i + 1}`))];
    const reserved = new Set(['guid column', 'notetype column', 'deck column', 'tags column'].map((k) => +headers[k]).filter(Boolean));
    const free = Array.from({ length: ncol }, (_, i) => i + 1).filter((c) => !reserved.has(c));
    maps = nt.fields.map((f, i) => h('select', { class: 'input' }, opts(free[i] || 0)));
    const tc = h('select', { class: 'input' }, opts(+tagCol <= ncol ? +tagCol : 0));
    tagsCol = tc;
    clear(mapBox);
    nt.fields.forEach((f, i) => mapBox.append(h('label', {}, f), maps[i]));
    mapBox.append(h('label', {}, 'Метки'), tc);
    prev.textContent = rows.slice(0, 5).map((r) => r.map((c) => c.replace(/\s+/g, ' ').slice(0, 40)).join('  │  ')).join('\n') || '(пусто)';
  }
  typeSel.onchange = refresh;
  const w = openWindow({
    title: `Импорт: ${fileName}`, width: 560, className: 'dlg',
    body: h('div', { class: 'dlg-body' },
      h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px', alignItems: 'center' } },
        h('label', {}, 'Тип записи'), typeSel, h('label', {}, 'Колода'), deckSel, h('label', {}, 'Разделитель'), sepSel),
      h('label', { class: 'chk' }, htmlChk, 'Разрешить HTML в полях'),
      h('label', { class: 'chk' }, skipChk, 'Пропускать дубликаты (по первому полю)'),
      h('div', { class: 'ed-section-label' }, 'Соответствие колонок полям'), mapBox,
      h('div', { class: 'ed-section-label' }, 'Предпросмотр'), prev,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn primary', onclick: go }, 'Импортировать'), h('button', { class: 'btn', onclick: () => w.close() }, 'Отмена'))),
  });
  refresh();
  function go() {
    const nt = S.noteType(typeSel.value);
    const chosenDeck = deckSel.value === '' ? null : +deckSel.value;
    const deckCol = +headers['deck column'] || 0;
    const typeCol = +headers['notetype column'] || 0;
    const reserved = new Set(['guid column', 'notetype column', 'deck column', 'tags column'].map((k) => +headers[k]).filter(Boolean));
    const idx = maps.map((m) => +m.value);
    const tcol = +tagsCol.value;
    if (!idx.some((i) => i > 0)) { toast('Сопоставьте хотя бы одно поле'); return; }
    const seen = new Map();
    const keyOf = (tid, first) => tid + '|' + first;
    if (skipChk.checked) for (const n of Object.values(col.notes)) seen.set(keyOf(n.tid, stripHtml(n.fields[col.noteTypes[n.tid].sortField || 0]).toLowerCase()), true);
    let added = 0, skipped = 0, cardsN = 0;
    const toHtml = (s) => (htmlChk.checked ? s : esc(s).replace(/\n/g, '<br>'));
    const ncol = Math.max(0, ...rows.map((r) => r.length));
    const freeCols = Array.from({ length: ncol }, (_, i) => i + 1).filter((c) => !reserved.has(c) && c !== tcol);
    for (const r of rows) {
      // тип записи строки: из колонки файла (если указан) либо выбранный
      const rowType = (typeCol && findType(r[typeCol - 1])) || nt;
      const rowIdx = rowType.id === nt.id ? idx : rowType.fields.map((_, i) => freeCols[i] || 0);
      const fields = rowIdx.map((i) => (i > 0 ? toHtml(r[i - 1] ?? '') : ''));
      const first = stripHtml(fields[rowType.sortField || 0] || '').toLowerCase();
      if (!first && rowType.kind !== 'cloze') { skipped++; continue; }
      if (skipChk.checked && seen.has(keyOf(rowType.id, first))) { skipped++; continue; }
      seen.set(keyOf(rowType.id, first), true);
      const tags = tcol > 0 ? (r[tcol - 1] || '').split(/\s+/).filter(Boolean) : [];
      const deckName = chosenDeck == null ? ((deckCol && r[deckCol - 1]) || headers.deck || '') : '';
      const did = chosenDeck ?? (deckName ? S.createDeck(deckName) : col.config.curDeck);
      const { cards } = S.addNote({ typeId: rowType.id, fields, tags, did });
      if (cards.length) { added++; cardsN += cards.length; }
    }
    w.close(true);
    alertDialog(`Импорт завершён.\nДобавлено записей: ${added}\nСоздано карточек: ${cardsN}${skipped ? `\nПропущено: ${skipped}` : ''}`);
  }
}

/* ---------- окно «Синхронизация» ---------- */
export function openSync() {
  const col = S.C();
  const n = Object.keys(col.cards).length;
  const where = { idb: 'в базе браузера (IndexedDB)', localStorage: 'в localStorage браузера', memory: 'только в памяти: после закрытия вкладки данные пропадут' }[S.storageMode];
  const btn = (label, fn, cls = '') => h('button', { class: `btn ${cls}`, style: { width: '100%' }, onclick: fn }, label);
  const w = openWindow({
    title: 'Синхронизация и копии', width: 480, className: 'dlg',
    body: h('div', { class: 'dlg-body' },
      h('div', { class: 'msg' }, `Облачной синхронизации в Unki нет: все данные (${fmtNum(n)} ${plural(n, 'карточка', 'карточки', 'карточек')}) хранятся ${where}. Чтобы перенести их на другое устройство или не потерять при очистке браузера, сохраняйте резервные копии.`),
      btn('Скачать резервную копию', () => downloadBackup(), 'primary'),
      btn('Восстановить из копии…', () => { w.close(true); restoreBackup(); }),
      btn('Импортировать колоду или текст…', () => { w.close(true); openImport(); }),
      btn('Экспортировать…', () => { w.close(true); openExport(col.config.curDeck); }),
      h('hr', { style: { width: '100%', border: 0, borderTop: '1px solid var(--border-soft)' } }),
      btn('Удалить все данные…', async () => {
        const ok = await confirmDialog({ title: 'Удалить все данные', danger: true, okText: 'Удалить всё', message: 'Будут удалены все колоды, карточки и статистика на этом устройстве. Отменить это нельзя. Сначала скачайте резервную копию.' });
        if (ok) { await S.wipeAll(); w.close(true); toast('Все данные удалены'); }
      }, 'danger'),
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: () => w.close() }, 'Закрыть'))),
  });
  return w;
}
