// Показ карточки в изолированном iframe (без скриптов): безопасно для импортированных колод.
import { h } from './ui.js';
import { sanitizeHtml } from './models.js';

function themeVars() {
  const cs = getComputedStyle(document.documentElement);
  const dark = document.documentElement.dataset.theme !== 'light';
  return {
    dark,
    bg: cs.getPropertyValue('--card-bg').trim() || (dark ? '#2c2c2c' : '#fff'),
    fg: cs.getPropertyValue('--card-fg').trim() || (dark ? '#fff' : '#000'),
  };
}

export function frameDoc(bodyHtml, css) {
  const { dark, bg, fg } = themeVars();
  const cls = dark ? 'nightMode night_mode' : '';
  return `<!doctype html><html class="${cls}"><head><meta charset="utf-8"><meta name="color-scheme" content="${dark ? 'dark' : 'light'}">
<style>
html,body{margin:0;padding:0}
body{padding:20px 20px 40px;background:${bg};color:${fg};overflow-wrap:anywhere;word-wrap:break-word;font-family:arial,"Segoe UI",sans-serif;font-size:20px;text-align:center}
img{max-width:100%;max-height:95vh}
a{color:${dark ? '#8ab4ff' : '#1a56c4'}}
hr#answer{border:0;border-top:1px solid ${dark ? '#666' : '#bbb'};margin:18px 0}
input.typeans{width:100%;max-width:640px;font:inherit;padding:6px 10px;box-sizing:border-box;border:1px solid ${dark ? '#777' : '#999'};background:transparent;color:inherit;border-radius:5px;text-align:center}
input.typeans:focus{outline:2px solid #4a7bff;border-color:transparent}
code#typeans{font-family:Consolas,monospace;font-size:inherit;white-space:pre-wrap}
.typeGood{background:#a5f0a5;color:#000}.typeBad{background:#ffb0b0;color:#000}.typeMissed{background:#ccc;color:#000}
details.hint summary{cursor:pointer;color:${dark ? '#8ab4ff' : '#1a56c4'}}
table{margin:0 auto;border-collapse:collapse}td,th{padding:2px 8px}
.unki-error{color:#e55}
audio{max-width:100%}
</style><style>${(css || '').replace(/<\/style/gi, '')}</style></head>
<body class="card ${cls}">${sanitizeHtml(bodyHtml)}</body></html>`;
}

export function cardFrame({ onKey, onReady } = {}) {
  const f = h('iframe', { class: 'card-frame', sandbox: 'allow-same-origin', title: 'Карточка' });
  let last = null;
  f.addEventListener('load', () => {
    const d = f.contentDocument;
    if (!d) return;
    d.addEventListener('keydown', (e) => onKey?.(e, d));
    onReady?.(d);
  });
  return {
    el: f,
    show(html, css) { last = [html, css]; f.srcdoc = frameDoc(html, css); },
    refresh() { if (last) f.srcdoc = frameDoc(...last); },
    get doc() { return f.contentDocument; },
    scrollToAnswer() { f.contentDocument?.getElementById('answer')?.scrollIntoView({ block: 'start' }); },
    focusInput() { const i = f.contentDocument?.getElementById('typeans'); if (i && i.tagName === 'INPUT') { i.focus(); return true; } return false; },
    typed() { const i = f.contentDocument?.getElementById('typeans'); return i && i.tagName === 'INPUT' ? i.value : ''; },
  };
}
