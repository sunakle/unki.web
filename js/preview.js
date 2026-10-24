// Окно просмотра карточек (вопрос/ответ), без влияния на расписание.
import * as S from './store.js';
import { h, openWindow } from './ui.js';
import { renderQA } from './models.js';
import { cardFrame } from './cardview.js';

export function openPreview(cids, start = 0, before) {
  before?.();
  let i = Math.min(Math.max(0, start), cids.length - 1);
  let showA = false;
  const label = h('span', { style: { fontSize: '.8rem', color: 'var(--muted)' } });
  const onKey = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'PageDown') go(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
    else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); showA = !showA; render(); }
  };
  const frame = cardFrame({ onKey });
  const prev = h('button', { class: 'btn', onclick: () => go(-1) }, '‹ Назад');
  const next = h('button', { class: 'btn', onclick: () => go(1) }, 'Вперёд ›');
  const flip = h('button', { class: 'btn primary', onclick: () => { showA = !showA; render(); } }, 'Показать ответ');
  const w = openWindow({
    title: 'Просмотр', width: 640, height: 480, maximizable: true,
    body: h('div', { style: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, padding: '8px', gap: '8px' } },
      frame.el,
      h('div', { class: 'btn-row', style: { justifyContent: 'center', alignItems: 'center' } }, prev, flip, next, label)),
  });
  function go(d) { const n = i + d; if (n >= 0 && n < cids.length) { i = n; showA = false; render(); } }
  function render() {
    const c = S.C().cards[cids[i]];
    if (!c) { w.close(true); return; }
    const note = S.C().notes[c.nid];
    const nt = S.noteType(note.tid);
    const qa = renderQA(nt, note, c.ord, { deck: S.deckName(c.did) });
    frame.show(showA ? qa.a : qa.q, qa.css);
    flip.textContent = showA ? 'Показать вопрос' : 'Показать ответ';
    prev.disabled = i === 0;
    next.disabled = i === cids.length - 1;
    label.textContent = cids.length > 1 ? `${i + 1} из ${cids.length}` : '';
  }
  render();
  return w;
}
