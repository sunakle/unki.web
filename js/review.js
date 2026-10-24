// Экран повторения: вопрос, ответ, оценка, горячие клавиши.
import * as S from './store.js';
import * as sched from './sched.js';
import { h, clear, popupMenu, toast, confirmDialog, fmtNum, icon, FLAGS, FLAG_NAMES } from './ui.js';
import { renderQA } from './models.js';
import { cardFrame } from './cardview.js';
import { ttsSupported, ttsActive, ttsSettings, setTtsSettings, cardSegments, hasInlineTts, speakSegments, speakWithHint, stopSpeech } from './tts.js';

export function renderReview(main, bottom, did, nav) {
  const col = S.C();
  col.config.curDeck = did;
  let cur = null, kind = null, answered = false, qa = null, t0 = 0;
  let counts = { new: 0, lrn: 0, rev: 0 };
  const lastAnswered = [];
  let timerId = 0;

  const star = h('div', { class: 'hidden', style: { position: 'absolute', right: '14px', top: '8px', color: '#ffd24a', fontSize: '1.4rem', pointerEvents: 'none', zIndex: 2 }, title: 'Запись отмечена' }, '★');
  const frame = cardFrame({
    onKey: (e) => handleKey(e),
    onReady: () => {
      if (!qa) return;
      if (answered) frame.scrollToAnswer();
      else if (qa.hasType) frame.focusInput();
    },
  });
  const speak = h('button', { class: 'tts-fab hidden', title: 'Озвучить (R)', 'aria-label': 'Озвучить', onclick: () => replay() }, icon('speaker', 22));
  const wrap = h('div', { class: 'review' }, frame.el, star, speak);
  clear(main).append(wrap);
  bottom.className = 'rv';

  /* ---------- показ ---------- */
  function loadNext(forceCid) {
    stopSpeech();
    if (forceCid && col.cards[forceCid]) {
      cur = col.cards[forceCid];
      kind = cur.type === 0 ? 'new' : cur.type === 2 ? 'rev' : 'lrn';
      counts = sched.buildQueue(did).counts;
    } else {
      const r = sched.nextCard(did);
      if (!r.card) { nav.go('deck', did); return; }
      cur = r.card; kind = r.kind; counts = r.counts;
    }
    showQuestion();
  }

  function decorate() {
    const note = col.notes[cur.nid];
    star.classList.toggle('hidden', !note.tags.includes('marked'));
    const f = FLAGS[cur.flag - 1];
    frame.el.style.outline = f ? `3px solid ${f.color}` : '';
    frame.el.style.outlineOffset = f ? '-3px' : '';
  }

  function render(typed) {
    const note = col.notes[cur.nid];
    const nt = S.noteType(note.tid);
    qa = renderQA(nt, note, cur.ord, { deck: S.deckName(cur.did), typed });
    frame.show(answered ? qa.a : qa.q, qa.css);
    decorate();
    renderBottom();
    // плавающая кнопка озвучки: только если на карточке нет своих кнопок {{tts …}}
    speak.classList.toggle('hidden', !(ttsActive() && !hasInlineTts(answered ? qa.a : qa.q) && cardSegments(qa, answered ? 'a' : 'q').length));
  }

  /* ---------- озвучка ---------- */
  function replay() {
    if (!qa) return;
    if (!ttsSupported()) { speakWithHint([{ text: 'x' }], toast); return; }
    if (!ttsSettings().enabled) { toast('Озвучка выключена: Настройки → Озвучка'); return; }
    speakWithHint(cardSegments(qa, answered ? 'a' : 'q'), toast);
  }
  function autoplay() {
    if (!qa || !ttsActive()) return;
    const st = ttsSettings();
    if (!(answered ? st.autoA : st.autoQ)) return;
    const segs = cardSegments(qa, answered ? 'a' : 'q', answered ? 'answer' : 'full');
    if (segs.length) speakSegments(segs);
  }
  function toggleAuto(key) {
    setTtsSettings({ [key]: !ttsSettings()[key] });
    toast(ttsSettings()[key] ? 'Автопроизношение включено' : 'Автопроизношение выключено');
  }

  function showQuestion() {
    answered = false;
    t0 = performance.now();
    render();
    startTimer();
    autoplay();
  }

  function showAnswer() {
    if (answered || !cur) return;
    const typed = frame.typed();
    answered = true;
    render(typed);
    if (S.presetOf(cur.did).stopTimer) clearInterval(timerId);
    autoplay();
  }

  function reloadCurrent() {
    if (!cur || !col.cards[cur.id]) { loadNext(); return; }
    cur = col.cards[cur.id];
    if (cur.susp || cur.buried === S.dayOf()) { loadNext(); return; }
    render(undefined);
  }

  function answer(ease) {
    if (!answered || !cur) return;
    const ms = performance.now() - t0;
    const r = sched.answerCard(cur.id, ease, ms);
    lastAnswered.push(cur.id);
    if (r?.leech) toast('Карточка стала «пиявкой»: слишком много ошибок');
    loadNext();
  }

  function undo() {
    const lbl = S.undoLabel();
    if (!lbl) { toast('Нечего отменять'); return; }
    S.undo();
    toast(`Отменено: ${lbl}`);
    if (lbl === 'Ответ' && lastAnswered.length) loadNext(lastAnswered.pop());
    else reloadCurrent();
  }

  /* ---------- действия ---------- */
  const noteCards = () => S.cardsOfNote(cur.nid).map((c) => c.id);
  const actions = {
    mark() { S.toggleMark([cur.nid]); decorate(); toast(col.notes[cur.nid].tags.includes('marked') ? 'Запись отмечена' : 'Отметка снята'); },
    bury() { S.buryCards([cur.id]); toast('Карточка отложена до завтра'); loadNext(); },
    buryNote() { sched.buryNote(cur.nid); toast('Запись отложена до завтра'); loadNext(); },
    suspend() { S.setSuspended([cur.id], true); toast('Карточка исключена'); loadNext(); },
    suspendNote() { S.setSuspended(noteCards(), true); toast('Запись исключена'); loadNext(); },
    flag(n) { S.setFlag([cur.id], cur.flag === n ? 0 : n); cur = col.cards[cur.id]; decorate(); },
    async del() {
      if (await confirmDialog({ title: 'Удаление записи', danger: true, okText: 'Удалить', message: 'Удалить эту запись со всеми её карточками?' })) {
        S.deleteNotes([cur.nid]); toast('Запись удалена'); loadNext();
      }
    },
    async info() { (await import('./info.js')).openCardInfo(cur.id); },
    async edit() {
      const w = (await import('./add.js')).openEditNote(cur.nid);
      if (w) w.onclosed = () => reloadCurrent();
    },
    async options() { const w = (await import('./options.js')).openDeckOptions(did); w.onclosed = () => reloadCurrent(); },
  };

  function moreMenu(anchor) {
    const flagsSub = FLAGS.map((f, i) => ({ label: FLAG_NAMES[i], shortcut: `Ctrl+${i + 1}`, checked: cur.flag === i + 1, onClick: () => actions.flag(i + 1) }));
    popupMenu([
      { label: 'Отменить', shortcut: 'Z', disabled: !S.undoLabel(), onClick: undo },
      { sep: true },
      ...(ttsSupported() ? [
        { label: 'Озвучить', shortcut: 'R', onClick: replay },
        { label: 'Произносить вопрос сам', checked: ttsSettings().autoQ, onClick: () => toggleAuto('autoQ') },
        { label: 'Произносить ответ сам', checked: ttsSettings().autoA, onClick: () => toggleAuto('autoA') },
        { sep: true },
      ] : []),
      { label: 'Отметить запись', shortcut: '*', checked: col.notes[cur.nid].tags.includes('marked'), onClick: actions.mark },
      { label: 'Флажок', submenu: flagsSub },
      { sep: true },
      { label: 'Отложить карточку', shortcut: '-', onClick: actions.bury },
      { label: 'Отложить запись', shortcut: '=', onClick: actions.buryNote },
      { label: 'Исключить карточку', shortcut: '@', onClick: actions.suspend },
      { label: 'Исключить запись', shortcut: '!', onClick: actions.suspendNote },
      { sep: true },
      { label: 'Информация о карточке', shortcut: 'I', onClick: actions.info },
      { label: 'Параметры колоды', shortcut: 'O', onClick: actions.options },
      { label: 'Удалить запись', shortcut: 'Ctrl+Del', onClick: actions.del },
    ], { anchor, align: 'right' });
  }

  /* ---------- нижняя панель ---------- */
  const timerEl = h('span', { class: 'rev-timer' });
  function startTimer() {
    clearInterval(timerId);
    timerEl.textContent = '';
    if (!S.presetOf(cur.did).showTimer) return;
    const tick = () => { timerEl.textContent = Math.floor((performance.now() - t0) / 1000) + ' с'; };
    tick();
    timerId = setInterval(tick, 500);
  }

  function renderBottom() {
    const cfg = col.config;
    const cnt = h('div', { class: 'rev-counts', title: 'Осталось: новые + изучаемые + к повторению' },
      ['new', 'lrn', 'rev'].map((k) => h('span', { class: `${k}${kind === k ? ' cur' : ''}`, title: { new: 'Новые', lrn: 'Изучаемые', rev: 'К повторению' }[k] }, fmtNum(counts[k]))));
    const left = h('div', { class: 'left' },
      h('button', { class: 'bbtn', onclick: actions.edit, title: 'Изменить запись (E)' }, 'Изменить'));
    const right = h('div', { class: 'right' },
      h('button', { class: 'bbtn', onclick: (e) => moreMenu(e.currentTarget) }, 'Ещё ▾'));
    let mid;
    if (!answered) {
      mid = h('div', { class: 'mid' }, cfg.showRemaining ? cnt : null,
        h('button', { class: 'bbtn big primary', id: 'show-ans', onclick: showAnswer, title: 'Пробел или Enter' }, 'Показать ответ'), timerEl);
    } else {
      const pv = sched.previews(cur);
      const labels = ['Снова', 'Трудно', 'Хорошо', 'Легко'];
      mid = h('div', { class: 'mid' }, cfg.showRemaining ? cnt : null,
        h('div', { class: 'ans-btns' }, labels.map((l, i) => h('button', { class: `ans-btn${i === 2 ? ' good' : ''}`, title: `Клавиша ${i + 1}`, onclick: () => answer(i + 1) },
          h('small', {}, cfg.showTimes ? pv[i] : ''), l))), timerEl);
    }
    clear(bottom).append(h('div', { class: 'rev-bar' }, left, mid, right));
  }

  /* ---------- клавиши ---------- */
  function handleKey(e) {
    const t = e.target;
    const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (typing) {
      if (e.key === 'Enter' && !answered && t.id === 'typeans') { e.preventDefault(); showAnswer(); }
      return;
    }
    if (document.querySelector('.win-overlay')) return;
    const k = e.key;
    if (e.ctrlKey || e.metaKey) {
      if (/^[1-7]$/.test(k)) { e.preventDefault(); actions.flag(+k); }
      else if (k === 'Delete') { e.preventDefault(); actions.del(); }
      else if ((k === 'z' || k === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); }
      return;
    }
    if (e.altKey) return;
    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
      if (!answered) showAnswer();
      else if (col.config.spaceEnter) answer(3);
    } else if (/^[1-4]$/.test(k)) { if (answered) { e.preventDefault(); answer(+k); } }
    else if (k === 'z' || k === 'я') undo();
    else if (k === '*') actions.mark();
    else if (k === '-') actions.bury();
    else if (k === '=') actions.buryNote();
    else if (k === '@') actions.suspend();
    else if (k === '!') actions.suspendNote();
    else if (k === 'r' || k === 'к') replay();
    else if (k === 'e' || k === 'у') actions.edit();
    else if (k === 'o' || k === 'щ') actions.options();
    else if (k === 'i' || k === 'ш') actions.info();
    else if (/^F[1-7]$/.test(k)) { e.preventDefault(); actions.flag(+k.slice(1)); }
  }
  const docKey = (e) => handleKey(e);
  document.addEventListener('keydown', docKey);

  loadNext();

  return () => {
    clearInterval(timerId);
    stopSpeech();
    document.removeEventListener('keydown', docKey);
    bottom.className = '';
  };
}
