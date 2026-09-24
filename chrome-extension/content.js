// ── STATE ─────────────────────────────────────────────────────
let cardHost      = null;
let selTimer      = null;
let hoverTimer    = null;
let currentWord   = '';
let currentRect   = null;
let currentContext = '';
let currentLang   = 'en';
let prefetch      = null;   // { word, lang, done, result, handlers[] }
let cardAutoSaved = false;  // true when card opened via selection (auto-saved)

// ── LANGUAGE DETECTION ────────────────────────────────────────
function detectLang(word) {
  const w = word.toLowerCase();
  if (/[ñ]/.test(w)) return 'es';
  if (/[å]/.test(w)) return 'sv';
  if (/[äö]/.test(w)) {
    const pg = (document.documentElement.lang || '').toLowerCase().split('-')[0];
    return pg === 'sv' ? 'sv' : 'fi';
  }
  if (/[áéíóú]/.test(w)) return 'es';
  const pg = (document.documentElement.lang || '').toLowerCase().split('-')[0];
  if (pg === 'es' || pg === 'fi' || pg === 'sv') return pg;
  return 'en';
}

function extractSentence(sel) {
  try {
    const range = sel.getRangeAt(0);
    const node  = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return '';
    const full  = node.textContent || '';
    const start = range.startOffset;
    let sStart = 0;
    for (let i = start - 1; i >= 0; i--) {
      if ('.!?'.includes(full[i])) { sStart = i + 1; break; }
    }
    let sEnd = full.length;
    for (let i = start; i < full.length; i++) {
      if ('.!?'.includes(full[i])) { sEnd = i + 1; break; }
    }
    return full.slice(sStart, sEnd).trim().replace(/\s+/g, ' ').slice(0, 200);
  } catch (_) { return ''; }
}

// ── SELECTION DETECTION ───────────────────────────────────────
document.addEventListener('mouseup', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(onSelectionChange, 80);
});

// ── HOVER DETECTION ───────────────────────────────────────────
document.addEventListener('mousemove', (e) => {
  clearTimeout(hoverTimer);
  if (cardHost) return;
  hoverTimer = setTimeout(() => triggerHoverLookup(e.clientX, e.clientY), 700);
}, { capture: true, passive: true });

document.addEventListener('mousedown', () => clearTimeout(hoverTimer), { capture: true });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideCard(); }
});

function onSelectionChange() {
  const sel  = window.getSelection();
  const text = sel?.toString().trim() ?? '';

  if (!text || text.length < 2 || text.length > 60 || /[\s\n]{2,}/.test(text) || /[0-9]/.test(text)) {
    return;
  }
  const active = document.activeElement?.tagName;
  if (active === 'INPUT' || active === 'TEXTAREA' || document.activeElement?.isContentEditable) {
    return;
  }
  const range = sel.getRangeAt(0);
  const rect  = range.getBoundingClientRect();
  const ctx   = extractSentence(sel);
  const lang  = detectLang(text);
  currentContext = ctx;
  currentWord    = text;
  currentRect    = rect;
  currentLang    = lang;

  // Pre-fetch starts immediately; lookupWord reuses result if it arrives first
  const pending = { word: text, lang, done: false, result: null, handlers: [] };
  prefetch = pending;
  try {
    chrome.runtime.sendMessage({ type: 'LOOKUP', word: text, lang }, (result) => {
      pending.done = true;
      pending.result = result ?? null;
      pending.handlers.forEach(h => h(result));
      pending.handlers = [];
    });
  } catch (_) { pending.done = true; }

  // Auto-save immediately; show card already in saved state
  chrome.runtime.sendMessage({ type: 'SAVE_WORD', wordData: { word: text, lang } });
  lookupWord(text, rect, {
    lang,
    autoSaved: true,
    onReady: (result) => {
      const enriched = ctx ? { ...result, contextSentence: ctx, lang } : { ...result, lang };
      chrome.runtime.sendMessage({ type: 'UPDATE_WORD', wordData: enriched });
    },
  });
}

// ── WORD AT POINT (for hover) ─────────────────────────────────
function wordAtPoint(x, y) {
  const range = document.caretRangeFromPoint?.(x, y);
  if (!range) return null;
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  if (node.parentElement?.closest('a,button,input,textarea,select,[contenteditable],[role="button"]')) return null;

  const text   = node.textContent;
  const isLetter = /[a-zA-ZÀ-ÖØ-öø-ÿ]/;
  let s = range.startOffset;
  let e = s;
  while (s > 0 && isLetter.test(text[s - 1])) s--;
  while (e < text.length && isLetter.test(text[e])) e++;
  const word = text.slice(s, e);
  if (!word || word.length < 2 || word.length > 60) return null;

  const wr = document.createRange();
  wr.setStart(node, s);
  wr.setEnd(node, e);
  const rect = wr.getBoundingClientRect();
  // Only apply bounds check when rect is valid (some nodes return zero rect)
  if (rect.width > 0 && (x < rect.left - 6 || x > rect.right + 6 || y < rect.top - 6 || y > rect.bottom + 6)) return null;
  return { word, rect };
}

function triggerHoverLookup(x, y) {
  const active = document.activeElement?.tagName;
  if (active === 'INPUT' || active === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
  const hit = wordAtPoint(x, y);
  if (!hit) return;
  const lang     = detectLang(hit.word);
  currentWord    = hit.word;
  currentRect    = hit.rect;
  currentContext = '';
  currentLang    = lang;
  lookupWord(hit.word, hit.rect, { lang });
}

// ── LOOKUP ────────────────────────────────────────────────────
function handlePostLookup(result) {
  if (result.aiAvailable) {
    chrome.runtime.sendMessage(
      { type: 'AI_EXAMPLE', word: result.word, pos: result.pos, definition: result.definition },
      (ai) => {
        if (chrome.runtime.lastError) return;
        if (ai?.example) updateCardAiExample(ai.example);
        else if (!result.example) insertNoExample('No example available for this word.');
      }
    );
  } else if (!result.example) {
    insertNoExample('No example available for this word.');
  }
}

function lookupWord(word, rect, { onReady, autoSaved = false, lang = 'en' } = {}) {
  const cached = (prefetch?.word === word && prefetch?.lang === lang) ? prefetch : null;
  prefetch = null;

  // Result already arrived — show instantly, no loading state
  if (cached?.done) {
    const result = cached.result;
    if (!result || result.error) {
      showCard({ error: true, word, message: result?.error || 'Something went wrong.' }, rect, { autoSaved });
    } else {
      showCard(result, rect, { autoSaved });
      handlePostLookup(result);
      onReady?.(result);
    }
    return;
  }

  // Show loading skeleton; hook into in-flight pre-fetch or start fresh
  showCard({ word, loading: true }, rect, { autoSaved });

  const safetyTimer = setTimeout(() => {
    updateCardState({ error: true, word, message: 'Request timed out — reload the page and try again.' });
  }, 12000);

  const onResult = (result) => {
    clearTimeout(safetyTimer);
    if (chrome.runtime.lastError || !result || result.error) {
      const msg = chrome.runtime.lastError?.message?.includes('context')
        ? 'Reload the page to reconnect the extension.'
        : (result?.error || 'Something went wrong.');
      updateCardState({ error: true, word, message: msg });
      return;
    }
    updateCardState(result);
    handlePostLookup(result);
    onReady?.(result);
  };

  if (cached) {
    cached.handlers.push(onResult);
  } else {
    try {
      chrome.runtime.sendMessage({ type: 'LOOKUP', word, lang }, onResult);
    } catch (e) {
      clearTimeout(safetyTimer);
      updateCardState({ error: true, word, message: 'Reload the page to reconnect the extension.' });
    }
  }
}

// ── CARD POSITIONING ─────────────────────────────────────────
// Returns a CSS rule string; used in shadow adoptedStyleSheets (no inline style needed)
function cardPositionCSS(rect) {
  const W = 316, PAD = 10;
  if (!rect) {
    return `.card{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:${W}px;pointer-events:all}`;
  }
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = (rect.left + rect.width / 2) - W / 2;
  left = Math.max(PAD, Math.min(left, vw - W - PAD));
  let top = rect.bottom + 8;
  if (top + 380 > vh) top = Math.max(PAD, rect.top - 380 - 8);
  return `.card{position:fixed;top:${top}px;left:${left}px;width:${W}px;pointer-events:all}`;
}

// Cached static card stylesheet (parsed once, reused every showCard call)
let _cardSheet = null;
function getCardSheet() {
  if (!_cardSheet) {
    _cardSheet = new CSSStyleSheet();
    _cardSheet.replaceSync(CARD_CSS);
  }
  return _cardSheet;
}

// Inject host positioning into document.adoptedStyleSheets once.
// CSSStyleSheet constructed in JS is exempt from page CSP style-src.
let _docSheet = null;
function ensureDocSheet() {
  if (_docSheet) return;
  try {
    _docSheet = new CSSStyleSheet();
    _docSheet.replaceSync('#sip-card-host{position:fixed;top:0;left:0;z-index:2147483646;pointer-events:none}');
    document.adoptedStyleSheets = [...(document.adoptedStyleSheets ?? []), _docSheet];
  } catch (_) {}
}

// ── CARD CSS ──────────────────────────────────────────────────
// @import removed — fonts loaded via <link> in shadow DOM instead
const CARD_CSS = `
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }

  .card {
    background: #FFFFFF;
    border: 1.5px solid #E7E5E4;
    border-top: 3px solid #F59E0B;
    box-shadow: 0 12px 40px rgba(0,0,0,.16), 0 4px 12px rgba(0,0,0,.08);
    z-index: 2147483646;
    overflow: hidden;
    font-family: 'Plus Jakarta Sans', 'Helvetica Neue', sans-serif;
    color: #1C1917;
    animation: cardIn .22s cubic-bezier(.34,1.3,.64,1);
    max-height: 420px; overflow-y: auto;
  }
  @keyframes cardIn {
    from { opacity:0; transform: translateY(10px) scale(.97); }
    to   { opacity:1; transform: translateY(0)    scale(1); }
  }

  /* Loading */
  .loading-body { padding:20px 18px 22px; background:#FFFFFF; }
  .loading-word { font-family:'Playfair Display',Georgia,serif; font-size:26px; font-weight:700; margin-bottom:16px; color:#1C1917; }
  .skel { height:10px; background:linear-gradient(90deg,#F5F3EF 25%,#EDE9E3 50%,#F5F3EF 75%); background-size:200% 100%; animation:shimmer 1.4s infinite; margin-bottom:8px; }
  .skel.w60{width:60%} .skel.w80{width:80%} .skel.w45{width:45%} .skel.mt{margin-top:14px}
  @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

  /* Header band */
  .card-head {
    padding:16px 18px 13px;
    background:linear-gradient(145deg,#FEF3C7 0%,#FEFCE8 100%);
    border-bottom:1.5px solid rgba(245,158,11,.18);
    position:relative;
  }
  .card-head::before {
    content:''; position:absolute; left:0; top:0; bottom:0; width:4px;
    background:#F59E0B;
  }
  .close-btn {
    position:absolute; top:12px; right:13px;
    background:#F5F3EF; border:1.5px solid #E7E5E4;
    width:24px; height:24px; cursor:pointer; color:#A8A29E;
    font-size:11px; display:flex; align-items:center; justify-content:center;
    transition:all .15s; line-height:1;
  }
  .close-btn:hover { background:#FFF1F2; border-color:#F43F5E; color:#F43F5E; }
  .card-word { font-family:'Playfair Display',Georgia,serif; font-size:27px; font-weight:700; line-height:1.15; padding-right:34px; margin-bottom:7px; color:#1C1917; }
  .card-meta { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
  .phonetic { font-family:'DM Mono',monospace; font-size:11px; color:#A8A29E; }
  .play-btn {
    background:#FEF3C7; border:1px solid rgba(245,158,11,.4);
    width:24px; height:24px; cursor:pointer;
    color:#D97706; font-size:11px; display:flex; align-items:center; justify-content:center;
    transition:all .15s; flex-shrink:0;
  }
  .play-btn:hover { background:#F59E0B; color:#fff; }
  .pos-tag { font-size:10px; font-weight:600; letter-spacing:.5px; text-transform:uppercase; background:#FEF3C7; border:1px solid rgba(245,158,11,.3); padding:2px 9px; color:#D97706; }

  /* Body */
  .card-body { padding:13px 18px 16px; background:#FFFFFF; }
  .definition { font-size:13px; line-height:1.65; color:#57534E; margin-bottom:10px; }
  .example-wrap { border-left:2.5px solid #F59E0B; padding-left:10px; margin-bottom:12px; }
  .example { font-size:12px; line-height:1.7; color:#A8A29E; font-style:italic; font-family:'DM Mono',monospace; }
  .ai-badge { display:inline-block; font-size:9px; font-weight:700; letter-spacing:.5px; text-transform:uppercase; color:#15803D; background:#DCFCE7; border:1px solid rgba(34,197,94,.3); padding:1px 7px; margin-left:5px; vertical-align:middle; font-style:normal; }
  .synonyms { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:13px; }
  .syn {
    font-size:11px; background:#F5F3EF; border:1px solid #E7E5E4;
    padding:3px 10px; color:#78716C; cursor:pointer; transition:all .15s;
  }
  .syn:hover { background:#FEF3C7; border-color:rgba(245,158,11,.4); color:#D97706; }

  /* Add button */
  .add-btn {
    width:100%; padding:11px 14px; border:none;
    background:#F59E0B; color:#fff;
    font-family:'Plus Jakarta Sans',sans-serif; font-size:13px; font-weight:800;
    cursor:pointer; box-shadow:0 4px 0 #92400E;
    display:flex; align-items:center; justify-content:center; gap:7px;
    transition:transform .08s, box-shadow .08s;
  }
  .add-btn:hover  { transform:translateY(-1px); box-shadow:0 5px 0 #92400E; }
  .add-btn:active { transform:translateY(3px);  box-shadow:0 1px 0 #92400E; }
  .add-btn.done   { background:#22C55E; box-shadow:0 4px 0 #15803D; }
  .add-btn.exists { background:#F5F3EF; color:#A8A29E; box-shadow:none; cursor:default; }
  .add-btn.exists:hover  { transform:none; box-shadow:none; }
  .add-btn.exists:active { transform:none; }

  /* No-example fallback */
  .no-example {
    font-size:11.5px; color:#A8A29E; font-style:italic;
    padding:0 0 12px; line-height:1.6;
  }
  .no-example .hint-key {
    color:#D97706; font-weight:700; font-style:normal; cursor:pointer;
    text-decoration:underline; text-decoration-color:rgba(245,158,11,.4);
  }

  /* Error */
  .error-body { padding:28px 18px 20px; text-align:center; background:#FFFFFF; }
  .error-icon { font-size:36px; margin-bottom:10px; }
  .error-title { font-size:14px; font-weight:700; color:#1C1917; margin-bottom:5px; }
  .error-sub { font-size:12px; color:#A8A29E; line-height:1.55; margin-bottom:16px; }
  .error-body .add-btn { margin-top:0; }

  /* Remove link */
  .remove-link {
    text-align:center; font-size:11px; color:#A8A29E;
    cursor:pointer; padding:6px 0 2px;
    text-decoration:underline; text-decoration-color:rgba(168,162,158,.35);
    transition:color .15s;
  }
  .remove-link:hover { color:#F43F5E; text-decoration-color:rgba(244,63,94,.4); }
`;

// ── SHOW CARD ─────────────────────────────────────────────────
// Uses CSSStyleSheet / adoptedStyleSheets throughout — no <style> blocks,
// no element.style assignments — both are blocked by page CSP style-src.
function showCard(data, rect, { autoSaved = false } = {}) {
  cardHost?.remove();
  cardHost = null;
  cardAutoSaved = autoSaved;

  ensureDocSheet();

  const host = document.createElement('div');
  host.id = 'sip-card-host';
  document.body.appendChild(host);
  cardHost = host;

  const shadow = host.attachShadow({ mode: 'open' });

  // Google Fonts via <link> — external stylesheet, allowed by CSP (fonts.googleapis.com is in style-src)
  const fontLink = document.createElement('link');
  fontLink.rel  = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=DM+Mono:wght@400;500&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap';
  shadow.appendChild(fontLink);

  // Dynamic position sheet (per-show); static card styles reused from cache
  const posSheet = new CSSStyleSheet();
  posSheet.replaceSync(cardPositionCSS(rect));
  shadow.adoptedStyleSheets = [getCardSheet(), posSheet];

  // Card element (no <style> tag in innerHTML)
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'card';
  card.innerHTML = data.loading ? renderLoading(data.word) : renderFull(data);
  shadow.appendChild(card);

  bindCardButtons(shadow, data);
  bindOutsideClick();
}

// Dismiss when clicking outside the card
function bindOutsideClick() {
  const handler = (e) => {
    if (!cardHost) { document.removeEventListener('mousedown', handler, true); return; }
    const path = e.composedPath();
    if (!path.includes(cardHost)) {
      hideCard();
      document.removeEventListener('mousedown', handler, true);
    }
  };
  // Delay so the current click doesn't immediately close it
  setTimeout(() => document.addEventListener('mousedown', handler, true), 80);
}

function renderLoading(word) {
  return `
    <div class="loading-body">
      <div class="loading-word">${esc(word)}</div>
      <div class="skel w80"></div>
      <div class="skel w60"></div>
      <div class="skel w45 mt"></div>
    </div>`;
}

function renderFull(data) {
  if (data.error) {
    return `
      <div class="error-body">
        <div class="error-icon">🍵</div>
        <div class="error-title">${data.word ? esc(data.word) : 'Word not found'}</div>
        <div class="error-sub">${esc(data.message)}</div>
        <button class="add-btn" id="add-btn">☕ SIP IT ANYWAY</button>
      </div>`;
  }

  const syns = (data.synonyms ?? []).map(s => `<span class="syn" data-word="${esc(s)}">${esc(s)}</span>`).join('');
  const exampleHtml = data.example
    ? `<div class="example-wrap"><div class="example">"${esc(data.example)}"</div></div>`
    : '';

  return `
    <div class="card-head">
      <button class="close-btn" id="close-btn">✕</button>
      <div class="card-word">${esc(data.word)}</div>
      <div class="card-meta">
        ${data.phonetic ? `<span class="phonetic">${esc(data.phonetic)}</span>` : ''}
        <button class="play-btn" id="play-btn" title="Pronounce"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg></button>
        ${data.pos ? `<span class="pos-tag">${esc(data.pos)}</span>` : ''}
      </div>
    </div>
    <div class="card-body">
      ${data.definition ? `<div class="definition">${esc(data.definition)}</div>` : ''}
      ${exampleHtml}
      ${syns ? `<div class="synonyms">${syns}</div>` : ''}
      <button class="add-btn" id="add-btn">☕ SIP IT</button>
    </div>`;
}

const LANG_BCP47 = { en: 'en-US', es: 'es-ES', fi: 'fi-FI', sv: 'sv-SE' };

function speakWord(word, lang = 'en') {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utt  = new SpeechSynthesisUtterance(word);
  utt.lang   = LANG_BCP47[lang] || 'en-US';
  utt.rate   = 0.85;
  utt.pitch  = 1;
  speechSynthesis.speak(utt);
}

function bindCardButtons(shadow, data) {
  shadow.getElementById('close-btn')?.addEventListener('click', hideCard);

  shadow.getElementById('play-btn')?.addEventListener('click', () => {
    const lang = data.lang || currentLang || 'en';
    if (data.audioUrl) new Audio(data.audioUrl).play().catch(() => speakWord(data.word, lang));
    else speakWord(data.word, lang);
  });

  shadow.querySelectorAll('.syn').forEach(el => {
    el.addEventListener('click', () => {
      const w = el.dataset.word;
      if (w) { hideCard(); currentWord = w; lookupWord(w, currentRect); }
    });
  });

  const addBtn = shadow.getElementById('add-btn');
  if (addBtn) {
    const wordLang = data.lang || currentLang || 'en';
    if (cardAutoSaved) {
      // Word was auto-saved on selection — show saved state immediately
      markSaved(shadow, addBtn, data.word);
    } else {
      chrome.runtime.sendMessage({ type: 'CHECK_SAVED', word: data.word, lang: wordLang }, (r) => {
        if (r?.saved) markSaved(shadow, addBtn, data.word);
      });

      addBtn.addEventListener('click', () => {
        if (addBtn.classList.contains('exists') || addBtn.classList.contains('done')) return;
        const wordData = data.error
          ? { word: data.word, lang: wordLang }
          : (currentContext ? { ...data, lang: wordLang, contextSentence: currentContext } : { ...data, lang: wordLang });
        chrome.runtime.sendMessage({ type: 'SAVE_WORD', wordData }, (r) => {
          if (r?.saved || r?.reason === 'already_exists') markSaved(shadow, addBtn, data.word);
        });
      });
    }
  }
}

function markSaved(shadow, addBtn, word) {
  addBtn.textContent = 'Saved ✓';
  addBtn.classList.remove('done');
  addBtn.classList.add('exists');
  if (shadow.getElementById('remove-link')) return;
  const link = document.createElement('div');
  link.id        = 'remove-link';
  link.className = 'remove-link';
  link.textContent = 'Remove from word book';
  link.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'REMOVE_WORD', word }, (r) => {
      if (r?.removed) {
        cardAutoSaved = false;
        addBtn.textContent = '☕ SIP IT';
        addBtn.classList.remove('exists', 'done');
        link.remove();
      }
    });
  });
  addBtn.insertAdjacentElement('afterend', link);
}

function updateCardState(data) {
  const shadow = cardHost?.shadowRoot;
  if (!shadow) return;
  const card = shadow.getElementById('card');
  if (!card) return;
  card.innerHTML = renderFull(data);
  bindCardButtons(shadow, data);
}

function insertNoExample(html) {
  const shadow = cardHost?.shadowRoot;
  if (!shadow) return;
  if (shadow.querySelector('.example-wrap') || shadow.querySelector('.no-example')) return;
  const anchor = shadow.querySelector('.synonyms') ?? shadow.querySelector('.add-btn');
  if (!anchor) return;
  const el = document.createElement('div');
  el.className = 'no-example';
  el.innerHTML = html;
  el.querySelector('.hint-key')?.addEventListener('click', hideCard);
  anchor.parentNode.insertBefore(el, anchor);
}

function updateCardAiExample(example) {
  const shadow = cardHost?.shadowRoot;
  if (!shadow) return;
  const wrap = shadow.querySelector('.example-wrap');
  if (wrap) {
    wrap.querySelector('.example').innerHTML =
      `"${esc(example)}" <em class="ai-badge">AI</em>`;
  } else {
    const defEl = shadow.querySelector('.definition');
    if (defEl) {
      const newWrap = document.createElement('div');
      newWrap.className = 'example-wrap';
      newWrap.innerHTML = `<div class="example">"${esc(example)}" <em class="ai-badge">AI</em></div>`;
      defEl.insertAdjacentElement('afterend', newWrap);
    }
  }
}

function hideCard() { cardHost?.remove(); cardHost = null; cardAutoSaved = false; }

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ── MESSAGES FROM BACKGROUND ──────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CONTEXT_LOOKUP') {
    const lang  = detectLang(msg.word);
    currentWord = msg.word;
    currentLang = lang;
    lookupWord(msg.word, null, { lang });
  }
});
