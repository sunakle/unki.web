// Озвучка английского текста через речевой синтез браузера (Web Speech API):
// кнопка «Прослушать», как в Google Переводчике. Звук создаётся на устройстве, текст никуда не отправляется.
// Настройки хранятся в localStorage этого браузера: набор голосов у каждого устройства свой.

const KEY = 'unki:tts';
const DEFAULTS = { enabled: true, autoQ: false, autoA: false, accent: 'en-US', voice: '', rate: 1 };
export const ACCENTS = [['en-US', 'Американский (en-US)'], ['en-GB', 'Британский (en-GB)'], ['en-AU', 'Австралийский (en-AU)']];

let cache = null;
export function ttsSettings() {
  if (!cache) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* хранилище недоступно */ }
    cache = { ...DEFAULTS, ...saved };
  }
  return cache;
}
export function setTtsSettings(patch) {
  cache = { ...ttsSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* хранилище недоступно */ }
  return cache;
}

export const ttsSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
/** Озвучка включена и доступна в этом браузере. */
export const ttsActive = () => ttsSupported() && ttsSettings().enabled;

/* ---------- голоса ---------- */
export const getVoices = () => (ttsSupported() ? speechSynthesis.getVoices() : []);

/** Chrome отдаёт список голосов не сразу: ждём событие voiceschanged (но не дольше 1,5 с). */
export function whenVoices() {
  return new Promise((resolve) => {
    if (!ttsSupported()) return resolve([]);
    const v = getVoices();
    if (v.length) return resolve(v);
    let done = false;
    const finish = () => { if (done) return; done = true; speechSynthesis.removeEventListener?.('voiceschanged', finish); resolve(getVoices()); };
    speechSynthesis.addEventListener?.('voiceschanged', finish);
    setTimeout(finish, 1500);
  });
}
if (ttsSupported()) getVoices(); // запускает загрузку списка
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY) cache = null; }); // настройки изменены в другой вкладке

const normLang = (l) => String(l || '').replace('_', '-').toLowerCase();

function voiceScore(v) {
  let s = 0;
  if (/natural|online/i.test(v.name)) s += 4;
  if (/google/i.test(v.name)) s += 3;
  if (/microsoft|samantha|daniel|karen|moira|serena|alex|siri/i.test(v.name)) s += 1;
  return s;
}

/** Лучший голос для языка; saved — выбранный пользователем (только для английского). */
export function pickVoice(lang, saved) {
  const voices = getVoices();
  if (!voices.length) return null;
  if (saved) { const v = voices.find((x) => x.voiceURI === saved); if (v) return v; }
  const want = normLang(lang);
  let list = voices.filter((v) => normLang(v.lang) === want);
  if (!list.length) list = voices.filter((v) => normLang(v.lang).split('-')[0] === want.split('-')[0]);
  return list.sort((a, b) => voiceScore(b) - voiceScore(a))[0] || null;
}

export function englishVoices() {
  return getVoices().filter((v) => normLang(v.lang).startsWith('en')).sort((a, b) => normLang(a.lang).localeCompare(normLang(b.lang)) || voiceScore(b) - voiceScore(a));
}

/** Для английского всегда действует произношение из настроек (en_US в шаблоне — лишь значение по умолчанию). */
function resolveLang(lang) {
  const l = normLang(lang || 'en');
  if (l === 'en' || l.startsWith('en-')) return ttsSettings().accent;
  const [a, b] = String(lang).replace('_', '-').split('-');
  return b ? `${a.toLowerCase()}-${b.toUpperCase()}` : a.toLowerCase();
}

/* ---------- воспроизведение ---------- */
let token = 0;
const keep = []; // ссылки на реплики: иначе Chrome может потерять события onend
let warnedNoVoice = false;

export function stopSpeech() {
  token++;
  if (ttsSupported()) { try { speechSynthesis.cancel(); } catch { /* ничего */ } }
}

export function cleanSpeechText(t) {
  return String(t ?? '').replace(/\[sound:[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Читает фрагменты по очереди. Возвращает:
 * 'ok' | 'unsupported' | 'empty' | 'novoice' (речь всё равно запущена голосом по умолчанию).
 */
export function speakSegments(segs) {
  if (!ttsSupported()) return 'unsupported';
  const list = (segs || []).map((s) => ({ text: cleanSpeechText(s.text), lang: s.lang, rate: s.rate })).filter((s) => s.text);
  if (!list.length) return 'empty';
  stopSpeech();
  const my = token;
  const st = ttsSettings();
  const run = (i) => {
    if (my !== token || i >= list.length) return;
    const seg = list[i];
    const lang = resolveLang(seg.lang);
    const isEn = lang.startsWith('en');
    const u = new SpeechSynthesisUtterance(seg.text);
    u.lang = lang;
    const voice = pickVoice(lang, isEn ? st.voice : '');
    if (voice) { u.voice = voice; u.lang = voice.lang || lang; }
    const rate = Number(seg.rate) || st.rate || 1;
    u.rate = Math.min(2, Math.max(0.3, rate));
    const next = () => { const k = keep.indexOf(u); if (k >= 0) keep.splice(k, 1); run(i + 1); };
    u.onend = next;
    u.onerror = (e) => { if (e?.error === 'canceled' || e?.error === 'interrupted') return; next(); };
    keep.push(u);
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(u);
  };
  // Chrome иногда «съедает» речь, если speak() вызван сразу после cancel()
  setTimeout(() => run(0), 40);
  const first = resolveLang(list[0].lang);
  return !pickVoice(first, first.startsWith('en') ? st.voice : '') && getVoices().length ? 'novoice' : 'ok';
}

/** Озвучить с подсказкой пользователю, если звука не будет. */
export function speakWithHint(segs, toast) {
  const r = speakSegments(segs);
  if (r === 'unsupported') toast?.('Этот браузер не умеет озвучивать текст. Откройте сайт в Chrome, Edge или Safari.');
  else if (r === 'empty') toast?.('На карточке нет английского текста для озвучки');
  else if (r === 'novoice' && !warnedNoVoice) { warnedNoVoice = true; toast?.('В системе не найден подходящий голос — звук может быть другим или отсутствовать'); }
  return r;
}

/* ---------- какой текст озвучивать ---------- */
const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'TR', 'TD', 'TH', 'TABLE', 'BR', 'HR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'CENTER', 'DETAILS', 'SUMMARY', 'PRE']);
const SKIP = new Set(['SCRIPT', 'STYLE', 'AUDIO', 'VIDEO', 'SVG', 'INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);
const BREAK = '\u0001';

function textBlocks(html, hideCloze) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const out = [];
  let cur = '';
  const flush = () => { if (cur.trim()) out.push(cur); cur = ''; };
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { cur += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      const tag = c.tagName.toUpperCase();
      if (SKIP.has(tag) || c.hasAttribute?.('data-tts-text') || c.id === 'typeans') continue;
      if (hideCloze && c.classList?.contains('cloze')) { cur += ` ${BREAK} `; continue; }
      const blk = BLOCK.has(tag);
      if (blk) flush();
      walk(c);
      if (blk) flush();
    }
  };
  walk(tpl.content);
  flush();
  return out;
}

const isLatinToken = (t) => /[A-Za-z]/.test(t) && !/[Ѐ-ӿ]/.test(t);
const isCyrToken = (t) => /[Ѐ-ӿ]/.test(t);

/** Из строки вынимает подряд идущие английские слова: «run out of — исчерпать» → «run out of». */
export function englishRuns(text) {
  const runs = [];
  let run = [];
  let pendingNeutral = [];
  const close = () => { if (run.length) runs.push(run.join(' ')); run = []; pendingNeutral = []; };
  for (const tok of String(text).split(/\s+/).filter(Boolean)) {
    if (tok === BREAK || isCyrToken(tok)) close();
    else if (isLatinToken(tok)) { if (run.length && pendingNeutral.length) run.push(...pendingNeutral); pendingNeutral = []; run.push(tok); }
    else if (run.length) pendingNeutral.push(tok); // цифры и знаки: оставляем только между английскими словами
  }
  close();
  return runs.map((r) => r.replace(/^[^A-Za-z0-9]+|[\s\-–—,;:/]+$/g, '').trim()).filter((r) => /[A-Za-z]/.test(r));
}

const ANSWER_HR = /<hr\s+id=["']?answer["']?[^>]*>/i;

/** Есть ли в HTML карточки явные кнопки озвучки {{tts …}}. */
export const hasInlineTts = (html) => /data-tts-text=/.test(html || '');

/**
 * Фрагменты речи для стороны карточки.
 * side: 'q' — вопрос; 'a' — ответ; part: 'full' (вся сторона, для повтора) или 'answer' (только то, что после линии ответа).
 * Если в шаблоне есть теги {{tts …}}, читаются они; иначе — английский текст стороны.
 */
export function cardSegments(qa, side, part = 'full') {
  if (!qa) return [];
  let html = side === 'a' ? qa.a : qa.q;
  if (side === 'a' && part === 'answer') { const m = ANSWER_HR.exec(html); if (m) html = html.slice(m.index + m[0].length); }
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  const tags = [...tpl.content.querySelectorAll('[data-tts-text]')];
  if (tags.length) return tags.map((el) => ({ text: el.getAttribute('data-tts-text'), lang: el.getAttribute('data-tts-lang') || 'en', rate: el.getAttribute('data-tts-rate') }));
  const segs = [];
  for (const b of textBlocks(html, side === 'q')) for (const r of englishRuns(b)) segs.push({ text: r, lang: 'en' });
  if (side === 'a' && qa.typeExpected) for (const r of englishRuns(qa.typeExpected)) segs.push({ text: r, lang: 'en' });
  return segs;
}

/** Выделенный мышью текст — озвучиваем, только если он английский. */
export function selectionSegments(text) {
  const t = cleanSpeechText(text);
  if (!t || t.length > 300) return [];
  return englishRuns(t).length && !/[Ѐ-ӿ]/.test(t) ? [{ text: t, lang: 'en' }] : [];
}

/** HTML кнопки для тега {{tts en_US:Поле}} в шаблоне. */
const SPEAKER_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12ZM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77Z"/></svg>';
export function ttsButtonHtml(text, spec, esc) {
  const plain = cleanSpeechText(text);
  if (!plain) return '';
  let lang = 'en_US', rate = '';
  for (const tok of String(spec).trim().split(/\s+/).slice(1)) {
    const m = /^(\w+)=(.*)$/.exec(tok);
    if (m) { if (m[1] === 'speed') rate = m[2]; } else lang = tok;
  }
  return `<a href="#" class="tts-btn" role="button" data-tts-text="${esc(plain)}" data-tts-lang="${esc(lang)}"${rate ? ` data-tts-rate="${esc(rate)}"` : ''} title="Озвучить" aria-label="Озвучить">${SPEAKER_SVG}</a>`;
}
