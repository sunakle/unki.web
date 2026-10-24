// Информация о карточке: даты, интервал, лёгкость, история ответов.
import * as S from './store.js';
import * as sched from './sched.js';
import { h, openWindow, fmtDate, fmtDateTime, fmtDur, fmtNum } from './ui.js';
import { stripHtml, fieldMap, renderQA } from './models.js';

const CARD_TYPES = ['Новая', 'Изучаемая', 'Повторяемая', 'Переучиваемая'];
const REV_TYPES = ['Изучение', 'Повторение', 'Переучивание', 'Досрочно'];
const EASE = ['', 'Снова', 'Трудно', 'Хорошо', 'Легко'];

export function openCardInfo(cid) {
  const info = sched.cardInfo(cid);
  if (!info) return null;
  const { card: c } = info;
  const note = S.C().notes[c.nid];
  const nt = S.noteType(note.tid);
  let front = '';
  try { front = stripHtml(renderQA(nt, note, c.ord, { deck: S.deckName(c.did) }).q).trim(); } catch { /* шаблон сломан */ }
  if (!front) front = stripHtml(fieldMap(nt, note)[nt.fields[nt.sortField || 0]]);
  if (front.length > 120) front = front.slice(0, 117) + '…';
  const dueText = c.type === 0 ? info.due : (info.due instanceof Date ? fmtDate(info.due.getTime()) : '');
  const rows = [
    ['Добавлена', fmtDate(info.added)],
    info.first ? ['Первое повторение', fmtDate(info.first)] : null,
    info.last ? ['Последнее повторение', fmtDate(info.last)] : null,
    c.type !== 0 ? ['Срок', dueText + (info.daysUntil != null ? ` (через ${info.daysUntil} дн.)` : '')] : ['Позиция в очереди новых', String(c.due)],
    c.type === 2 || c.type === 3 ? ['Интервал', `${fmtNum(c.ivl)} дн.`] : null,
    c.factor ? ['Лёгкость', `${Math.round(c.factor / 10)}%`] : null,
    ['Повторений', fmtNum(c.reps)],
    ['Ошибок', fmtNum(c.lapses)],
    info.log.length ? ['Среднее время', fmtDur(info.totalTime / info.log.length / 1000)] : null,
    info.log.length ? ['Общее время', fmtDur(info.totalTime / 1000)] : null,
    ['Тип карточки', `${nt.kind === 'cloze' ? `Пропуск ${c.ord + 1}` : nt.templates[c.ord]?.name || ''}`],
    ['Тип записи', nt.name],
    ['Колода', S.deckName(c.did)],
    ['Состояние', c.susp ? 'Исключена' : c.buried === S.dayOf() ? 'Отложена' : CARD_TYPES[c.type]],
    ['ID карточки', String(c.id)],
  ].filter(Boolean);

  const log = info.log.length ? h('table', { class: 'revlog' },
    h('thead', {}, h('tr', {}, ['Дата', 'Тип', 'Оценка', 'Интервал', 'Лёгкость', 'Время'].map((t) => h('th', {}, t)))),
    h('tbody', {}, [...info.log].reverse().map((r) => h('tr', {},
      h('td', {}, fmtDateTime(r.id)), h('td', {}, REV_TYPES[r.type] || ''), h('td', {}, EASE[r.ease] || ''),
      h('td', {}, r.ivl < 0 ? sched.fmtSpan(-r.ivl) : `${r.ivl} д`), h('td', {}, r.factor ? `${Math.round(r.factor / 10)}%` : ''),
      h('td', {}, fmtDur(r.time / 1000)))))) : h('p', { style: { color: 'var(--muted)' } }, 'Повторений пока не было.');

  return openWindow({
    title: 'Информация о карточке', width: 560, height: 520, maximizable: true,
    body: h('div', { style: { padding: '12px 16px', overflow: 'auto' } },
      h('h3', { style: { margin: '0 0 10px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' } }, front || '(пусто)'),
      h('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      h('h4', { style: { margin: '16px 0 4px' } }, 'История повторений'), log),
  });
}
