// Параметры колоды (наборы настроек) и общие настройки программы.
import * as S from './store.js';
import { h, openWindow, clear, popupMenu, promptDialog, confirmDialog, toast, applyAppearance, plural, icon } from './ui.js';

/* ---------- шаги: "1m 10m 1h 1d" <-> минуты ---------- */
export function parseSteps(s) {
  const out = [];
  for (const t of s.trim().split(/\s+/).filter(Boolean)) {
    const m = /^(\d+(?:[.,]\d+)?)\s*([smhd]?)$/i.exec(t);
    if (!m) return null;
    const n = parseFloat(m[1].replace(',', '.'));
    const u = (m[2] || 'm').toLowerCase();
    const min = u === 's' ? n / 60 : u === 'm' ? n : u === 'h' ? n * 60 : n * 1440;
    if (!(min > 0)) return null;
    out.push(min);
  }
  for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1]) { /* Anki предупреждает, но разрешает */ }
  return out;
}
export function fmtSteps(arr) {
  return arr.map((m) => (m % 1440 === 0 ? `${m / 1440}d` : m % 60 === 0 ? `${m / 60}h` : m < 1 ? `${Math.round(m * 60)}s` : `${+m.toFixed(2)}m`)).join(' ');
}

const SECTIONS = [
  { title: 'Ежедневный лимит', rows: [
    { k: 'newPerDay', label: 'Новых карточек в день', t: 'int', min: 0, max: 99999 },
    { k: 'revPerDay', label: 'Максимум повторяемых в день', t: 'int', min: 0, max: 99999 },
  ] },
  { title: 'Новые карточки', rows: [
    { k: 'learnSteps', label: 'Шаги изучаемых', t: 'steps', hint: 'Через пробел: 1m 10m 1h 1d (минуты, часы, дни).' },
    { k: 'graduatingIvl', label: 'Интервал перевода', t: 'int', min: 1, hint: 'Дней до первого повторения после последнего шага.' },
    { k: 'easyIvl', label: 'Интервал лёгких', t: 'int', min: 1, hint: 'Дней, если нажать «Легко» на новой карточке.' },
    { k: 'newOrder', label: 'Порядок добавления', t: 'select', opts: [['due', 'Последовательный (сначала старые)'], ['random', 'Случайный']] },
  ] },
  { title: 'Забыто', rows: [
    { k: 'relearnSteps', label: 'Шаги переучиваемых', t: 'steps', hint: 'Пусто — сразу вернуть в повторения.' },
    { k: 'minIvl', label: 'Минимальный интервал', t: 'int', min: 1, hint: 'Дней после ошибки.' },
    { k: 'leechThreshold', label: 'Порог для «пиявок»', t: 'int', min: 0, hint: '0 — выключено.' },
    { k: 'leechAction', label: 'Что делать с «пиявками»', t: 'select', opts: [['tag', 'Только пометить'], ['suspend', 'Исключить карточку']] },
  ] },
  { title: 'Порядок показа', rows: [
    { k: 'newMix', label: 'Порядок новых (к повторяемым)', t: 'select', opts: [['mix', 'Перемешивать с повторяемыми'], ['after', 'Показывать после повторяемых'], ['before', 'Показывать до повторяемых']] },
    { k: 'revOrder', label: 'Порядок повторяемых', t: 'select', opts: [['due-random', 'По сроку, потом случайный'], ['due', 'По сроку, потом по добавлению'], ['random', 'Случайный'], ['ivl-asc', 'По возрастанию интервала'], ['ivl-desc', 'По убыванию интервала']] },
  ] },
  { title: 'Откладывание', rows: [
    { k: 'buryNew', label: 'Откладывать новые связанные до завтра', t: 'bool' },
    { k: 'buryRev', label: 'Откладывать повторяемые связанные до завтра', t: 'bool' },
  ] },
  { title: 'Таймер', rows: [
    { k: 'maxTime', label: 'Максимум секунд для ответа', t: 'int', min: 5, max: 3600 },
    { k: 'showTimer', label: 'Показывать время ответа', t: 'bool' },
    { k: 'stopTimer', label: 'Остановить таймер при ответе', t: 'bool' },
  ] },
  { title: 'Дополнительные', rows: [
    { k: 'maxIvl', label: 'Максимальный интервал', t: 'int', min: 1, max: 36500, hint: 'В днях.' },
    { k: 'startEase', label: 'Начальная лёгкость', t: 'float', min: 1.31, max: 5 },
    { k: 'easyBonus', label: 'Множитель для «Легко»', t: 'float', min: 1, max: 5 },
    { k: 'ivlMod', label: 'Модификатор интервала', t: 'float', min: 0.5, max: 2 },
    { k: 'hardIvl', label: 'Интервал для «Трудно»', t: 'float', min: 0.5, max: 1.3 },
    { k: 'newIvl', label: 'Новый интервал после ошибки', t: 'float', min: 0, max: 1, hint: 'Доля прежнего интервала (0 — начать сначала).' },
  ] },
];

export function openDeckOptions(did) {
  const col = S.C();
  const deck = col.decks[did];
  if (!deck) return null;
  let presetId = deck.preset;
  const edits = {};          // правки и новые наборы (пока не сохранены)
  const removed = new Set(); // наборы, помеченные на удаление
  let dirty = false;
  const getWork = () => (edits[presetId] ||= structuredClone(col.presets[presetId]));
  const presetIds = () => [...new Set([...Object.keys(col.presets), ...Object.keys(edits)].map(Number))].filter((id) => !removed.has(id));
  const usage = (id) => Object.values(col.decks).filter((d) => d.id !== did && d.preset === id && !removed.has(id)).length + (id === presetId ? 1 : 0);

  const sel = h('select', { class: 'input', 'aria-label': 'Набор параметров', onchange: () => { presetId = +sel.value; renderBody(); } });
  const scroll = h('div', { class: 'opt-scroll' });
  const err = h('div', { class: 'err', style: { padding: '0 14px' } });

  function fillSel() {
    clear(sel);
    for (const id of presetIds()) {
      const name = (edits[id] || col.presets[id]).name;
      const n = usage(id);
      sel.append(h('option', { value: id, selected: id === presetId }, `${name} (используется ${n} ${plural(n, 'колодой', 'колодами', 'колодами')})`));
    }
  }

  function renderBody() {
    fillSel();
    const w = getWork();
    clear(scroll);
    for (const sec of SECTIONS) {
      const box = h('section', { class: 'opt-sec' }, h('h3', {}, sec.title));
      for (const r of sec.rows) {
        let ctl;
        const v = w[r.k];
        if (r.t === 'bool') {
          const cb = h('input', { type: 'checkbox', checked: !!v, onchange: () => { w[r.k] = cb.checked; dirty = true; } });
          ctl = h('label', { class: 'sw' }, cb, h('span'));
        } else if (r.t === 'select') {
          ctl = h('select', { class: 'input', onchange: (e) => { w[r.k] = e.target.value; dirty = true; } }, r.opts.map(([val, t]) => h('option', { value: val, selected: val === v }, t)));
        } else if (r.t === 'steps') {
          ctl = h('input', { class: 'input', type: 'text', value: fmtSteps(v), onchange: (e) => {
            const p = parseSteps(e.target.value);
            if (!p) { e.target.style.borderColor = '#e55'; err.textContent = 'Шаги записываются так: 1m 10m 1h 1d'; return; }
            e.target.style.borderColor = ''; err.textContent = ''; w[r.k] = p; dirty = true; e.target.value = fmtSteps(p);
          } });
        } else {
          ctl = h('input', { class: 'input', type: 'number', step: r.t === 'float' ? '0.01' : '1', min: r.min, max: r.max, value: r.t === 'float' ? String(v).replace(',', '.') : v, onchange: (e) => {
            let n = r.t === 'float' ? parseFloat(String(e.target.value).replace(',', '.')) : parseInt(e.target.value, 10);
            if (Number.isNaN(n)) n = v;
            n = Math.min(r.max ?? Infinity, Math.max(r.min ?? -Infinity, n));
            w[r.k] = n; e.target.value = n; dirty = true;
          } });
        }
        box.append(h('div', { class: 'opt-row' }, h('label', {}, r.label), ctl, r.hint ? h('div', { class: 'hint' }, r.hint) : null));
      }
      scroll.append(box);
    }
  }

  function applyEdits() {
    for (const id of removed) { delete col.presets[id]; for (const d of Object.values(col.decks)) if (d.preset === id) d.preset = 1; }
    for (const [id, p] of Object.entries(edits)) if (!removed.has(+id)) col.presets[id] = p;
  }

  function save(closeAfter = true) {
    applyEdits();
    deck.preset = presetId;
    S.commit();
    dirty = false;
    if (closeAfter) w.close(true);
    toast('Параметры сохранены');
  }

  const moreBtn = h('button', { class: 'btn primary', 'aria-label': 'Ещё действия', style: { padding: '0 6px' }, onclick: (e) => {
    popupMenu([
      { label: 'Добавить набор', onClick: async () => {
        const name = await promptDialog({ title: 'Добавить набор', label: 'Название набора:' });
        if (name?.trim()) { const id = S.uid(); edits[id] = S.defaultPreset(id, name.trim()); presetId = id; dirty = true; renderBody(); }
      } },
      { label: 'Клонировать набор', onClick: async () => {
        const name = await promptDialog({ title: 'Клонировать набор', label: 'Название копии:', value: getWork().name + ' копия' });
        if (name?.trim()) { const id = S.uid(); edits[id] = { ...structuredClone(getWork()), id, name: name.trim() }; presetId = id; dirty = true; renderBody(); }
      } },
      { label: 'Переименовать набор', onClick: async () => {
        const name = await promptDialog({ title: 'Переименовать набор', label: 'Новое название:', value: getWork().name });
        if (name?.trim()) { getWork().name = name.trim(); dirty = true; renderBody(); }
      } },
      { label: 'Удалить набор', disabled: presetId === 1, onClick: async () => {
        if (await confirmDialog({ title: 'Удалить набор', danger: true, okText: 'Удалить', message: `Удалить набор «${getWork().name}»? Колоды с ним перейдут на набор по умолчанию.` })) {
          removed.add(presetId); delete edits[presetId]; presetId = 1; dirty = true; renderBody();
        }
      } },
      { sep: true },
      { label: 'Сохранить для всех колод', onClick: () => { applyEdits(); for (const d of Object.values(col.decks)) d.preset = presetId; S.commit(); w.close(true); toast('Набор применён ко всем колодам'); } },
    ], { anchor: e.currentTarget, align: 'right' });
  } }, icon('chevron', 14));

  const w = openWindow({
    title: `Параметры: ${deck.name}`, width: 680, height: '86vh', maximizable: true, className: 'opts-win',
    onClose: async () => (dirty ? confirmDialog({ title: 'Закрыть без сохранения', okText: 'Закрыть', cancelText: 'Продолжить', message: 'Есть несохранённые изменения. Закрыть и отменить их?' }) : true),
    body: h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } },
      h('div', { class: 'opt-head' }, sel, h('button', { class: 'btn primary', onclick: () => save(true) }, 'Сохранить'), moreBtn),
      err, scroll),
  });
  renderBody();
  return w;
}

/* ---------- общие настройки ---------- */
export function openPrefs() {
  const col = S.C();
  const cfg = () => col.config;
  const set = (patch) => { S.setConfig(patch); applyAppearance(col.config); };
  const tabs = ['Внешний вид', 'Учёба', 'Редактирование', 'Данные'];
  let cur = 0;
  const pane = h('div', { class: 'tabpane' });
  const bar = h('div', { class: 'tabs' });

  const chk = (label, key, extra) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!cfg()[key], onchange: (e) => set({ [key]: e.target.checked }) }), label, extra);
  const row = (label, ctl) => h('div', { class: 'opt-row' }, h('label', {}, label), ctl);

  const panes = [
    () => [
      h('fieldset', {}, h('legend', {}, 'Интерфейс'),
        row('Тема', h('select', { class: 'input', onchange: (e) => set({ theme: e.target.value }) }, [['system', 'Как в системе'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([v, t]) => h('option', { value: v, selected: cfg().theme === v }, t)))),
        row('Размер интерфейса', h('select', { class: 'input', onchange: (e) => set({ zoom: +e.target.value }) }, [80, 90, 100, 110, 125, 150, 175, 200].map((z) => h('option', { value: z, selected: cfg().zoom === z }, z + '%'))))),
      h('fieldset', {}, h('legend', {}, 'Отвлекающие факторы'), chk('Скрывать верхнюю панель во время повторения', 'hideTop'),
        chk('Скрывать нижнюю панель во время повторения (появляется при наведении)', 'hideBottom')),
    ],
    () => [
      h('fieldset', {}, h('legend', {}, 'Расписание'),
        row('Начало следующего дня', h('select', { class: 'input', onchange: (e) => set({ rollover: +e.target.value }) }, Array.from({ length: 24 }, (_, i) => h('option', { value: i, selected: cfg().rollover === i }, i === 0 ? 'в полночь' : `${i} ч. после полуночи`)))),
        row('Лимит опережения', h('input', { class: 'input', type: 'number', min: 0, max: 1440, value: cfg().learnAhead, onchange: (e) => set({ learnAhead: Math.max(0, Math.min(1440, +e.target.value || 0)) }) })),
        h('div', { class: 'hint', style: { color: 'var(--muted)', fontSize: '.75rem' } }, 'Минут: столько вперёд показываются изучаемые карточки, если больше нечего повторять.')),
      h('fieldset', {}, h('legend', {}, 'Учёба'),
        chk('Показывать количество оставшихся', 'showRemaining'),
        chk('Показывать время повторения над кнопками ответа', 'showTimes'),
        chk('Пробел или Enter для оценки «Хорошо» после ответа', 'spaceEnter')),
    ],
    () => [
      h('fieldset', {}, h('legend', {}, 'Редактирование'),
        chk('Вставка из буфера без форматирования (иначе — Shift+вставка)', 'pastePlain'),
        row('Колода по умолчанию', h('select', { class: 'input', onchange: (e) => set({ defaultDeckMode: e.target.value }) }, [['current', 'Добавлять в текущую колоду'], ['last', 'Колода последней добавленной записи'], ['type', 'Колода, выбранная для этого типа записи']].map(([v, t]) => h('option', { value: v, selected: cfg().defaultDeckMode === v }, t))))),
      h('fieldset', {}, h('legend', {}, 'Просмотр'),
        row('Поиск по умолчанию', h('input', { class: 'input', type: 'text', value: cfg().defaultSearch, placeholder: 'например, deck:current', onchange: (e) => set({ defaultSearch: e.target.value }) }))),
    ],
    () => [
      h('fieldset', {}, h('legend', {}, 'Хранение данных'),
        h('div', { style: { fontSize: '.85rem', lineHeight: 1.5 } }, `Все данные хранятся в этом браузере (${{ idb: 'IndexedDB', localStorage: 'localStorage', memory: 'только в памяти' }[S.storageMode]}). Делайте резервные копии: очистка данных сайта удалит коллекцию.`),
        h('div', { class: 'btn-row', style: { justifyContent: 'flex-start', marginTop: '10px' } },
          h('button', { class: 'btn', onclick: async () => (await import('./io.js')).downloadBackup() }, 'Скачать копию'),
          h('button', { class: 'btn', onclick: async () => (await import('./io.js')).restoreBackup() }, 'Восстановить…'))),
    ],
  ];

  function render() {
    clear(bar).append(...tabs.map((t, i) => h('button', { class: i === cur ? 'on' : '', onclick: () => { cur = i; render(); } }, t)));
    clear(pane).append(...panes[cur]());
  }
  const w = openWindow({
    title: 'Настройки', width: 600, height: 520, maximizable: true,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 } }, bar, pane,
      h('div', { class: 'ed-foot' }, h('button', { class: 'btn', onclick: () => w.close() }, 'Закрыть'))),
  });
  render();
  return w;
}
