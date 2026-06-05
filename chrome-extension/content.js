// ── STATE ─────────────────────────────────────────────────────
let tipHost  = null;
let cardHost = null;
let selTimer = null;
let currentWord = '';

// ── SELECTION DETECTION ───────────────────────────────────────
document.addEventListener('mouseup', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(onSelectionChange, 280);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { hideTip(); hideCard(); }
});

function onSelectionChange() {
  const sel  = window.getSelection();
  const text = sel?.toString().trim() ?? '';

  if (!text || text.length < 2 || text.length > 60 || /[\s\n]{2,}/.test(text) || /[0-9]/.test(text)) {
    hideTip(); return;
  }
  const active = document.activeElement?.tagName;
  if (active === 'INPUT' || active === 'TEXTAREA' || document.activeElement?.isContentEditable) {
    hideTip(); return;
  }
  const range = sel.getRangeAt(0);
  const rect  = range.getBoundingClientRect();
  showTip(text, rect);
}

// ── TIP BUTTON ────────────────────────────────────────────────
function showTip(word, rect) {
  hideTip();
  const host = document.createElement('div');
  host.id = 'sip-tip-host';
  const top = Math.max(rect.top - 46, 8);
  Object.assign(host.style, {
    position:  'fixed',
    zIndex:    '2147483647',
    left:      `${rect.left + rect.width / 2}px`,
    top:       `${top}px`,
    transform: 'translateX(-50%)',
    pointerEvents: 'none',
  });

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700&display=swap');
      .tip {
        background: #1c1710;
        border: 1px solid rgba(245,158,11,.45);
        border-radius: 20px;
        padding: 6px 14px 6px 10px;
        font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
        font-size: 12px; font-weight: 700;
        color: #f59e0b;
        cursor: pointer; pointer-events: all;
        white-space: nowrap;
        box-shadow: 0 4px 20px rgba(0,0,0,.55), 0 0 0 1px rgba(245,158,11,.15);
        animation: tipIn .18s cubic-bezier(.34,1.56,.64,1) forwards;
        user-select: none; display: flex; align-items: center; gap: 5px;
      }
      .tip:hover { background: #261e14; border-color: rgba(245,158,11,.7); }
      .tip:active { transform: scale(.96); }
      @keyframes tipIn {
        from { opacity:0; transform: translateY(6px) scale(.88); }
        to   { opacity:1; transform: translateY(0)  scale(1); }
      }
    </style>
    <div class="tip" id="btn">☕ Sip it</div>
  `;

  shadow.getElementById('btn').addEventListener('click', (e) => {
    e.stopPropagation();
    currentWord = word;
    hideTip();
    lookupWord(word);
  });

  document.body.appendChild(host);
  tipHost = host;
  setTimeout(() => { if (tipHost === host) hideTip(); }, 6000);
}

function hideTip() { tipHost?.remove(); tipHost = null; }

// ── LOOKUP ────────────────────────────────────────────────────
function lookupWord(word) {
  showCard({ word, loading: true });
  chrome.runtime.sendMessage({ type: 'LOOKUP', word }, (result) => {
    if (!result || result.error) {
      updateCardState({ error: true, word, message: result?.error ?? 'Something went wrong.' });
    } else {
      updateCardState(result);
      if (result.geminiKeySet) {
        chrome.runtime.sendMessage(
          { type: 'AI_EXAMPLE', word: result.word, pos: result.pos, definition: result.definition },
          (ai) => { if (ai?.example) updateCardAiExample(ai.example); }
        );
      }
    }
  });
}

// ── CARD ──────────────────────────────────────────────────────
const CARD_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Plus+Jakarta+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
  *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }
  .backdrop {
    position:fixed; inset:0; z-index:2147483645;
    background:rgba(0,0,0,.42); backdrop-filter:blur(3px);
    animation:fadeIn .2s ease;
  }
  .card {
    position:fixed; top:50%; left:50%;
    transform:translate(-50%,-50%);
    width:340px;
    background:linear-gradient(160deg,#1e1810,#110d08);
    border:1px solid rgba(245,158,11,.22);
    border-radius:20px;
    box-shadow:0 28px 90px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.05),0 0 50px rgba(245,158,11,.07);
    z-index:2147483646;
    overflow:hidden;
    font-family:'Plus Jakarta Sans',system-ui,sans-serif;
    color:#fef9ee;
    animation:cardIn .28s cubic-bezier(.34,1.3,.64,1);
  }
  @keyframes fadeIn { from{opacity:0} to{opacity:1} }
  @keyframes cardIn {
    from{opacity:0;transform:translate(-50%,calc(-50% + 18px)) scale(.93)}
    to  {opacity:1;transform:translate(-50%,-50%) scale(1)}
  }

  /* Loading */
  .loading-body { padding:28px 22px 24px; }
  .loading-word { font-family:'Playfair Display',Georgia,serif; font-size:26px; font-weight:700; margin-bottom:18px; }
  .skel { height:11px; border-radius:6px; background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.1) 50%,rgba(255,255,255,.05) 75%); background-size:200% 100%; animation:shimmer 1.4s infinite; margin-bottom:8px; }
  .skel.w60{width:60%} .skel.w80{width:80%} .skel.w45{width:45%}
  @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

  /* Header */
  .card-head { padding:18px 18px 14px; border-bottom:1px solid rgba(255,237,190,.07); position:relative; }
  .close-btn {
    position:absolute; top:14px; right:14px;
    background:rgba(255,255,255,.06); border:none; border-radius:50%;
    width:26px; height:26px; cursor:pointer; color:rgba(254,249,238,.45);
    font-size:13px; display:flex; align-items:center; justify-content:center;
    transition:all .15s; line-height:1;
  }
  .close-btn:hover { background:rgba(255,255,255,.12); color:#fef9ee; }
  .card-word { font-family:'Playfair Display',Georgia,serif; font-size:28px; font-weight:700; line-height:1.15; padding-right:36px; margin-bottom:8px; }
  .card-meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .phonetic { font-family:'DM Mono','Courier New',monospace; font-size:11.5px; color:rgba(254,249,238,.4); }
  .play-btn {
    background:rgba(245,158,11,.14); border:1px solid rgba(245,158,11,.3);
    border-radius:50%; width:22px; height:22px; cursor:pointer;
    color:#f59e0b; font-size:10px; display:flex; align-items:center; justify-content:center;
    transition:all .15s; flex-shrink:0;
  }
  .play-btn:hover { background:rgba(245,158,11,.28); }
  .pos-tag { font-size:9px; font-weight:700; letter-spacing:.9px; text-transform:uppercase; background:rgba(245,158,11,.12); border:1px solid rgba(245,158,11,.22); border-radius:20px; padding:2px 8px; color:#f59e0b; }

  /* Body */
  .card-body { padding:14px 18px 18px; }
  .definition { font-size:13px; line-height:1.65; color:rgba(254,249,238,.88); margin-bottom:12px; }
  .example-wrap { border-left:2px solid rgba(245,158,11,.28); padding-left:10px; margin-bottom:14px; }
  .example { font-size:12px; line-height:1.7; color:rgba(254,249,238,.5); font-style:italic; }
  .ai-badge { display:inline-block; font-size:8px; font-weight:700; letter-spacing:.7px; text-transform:uppercase; color:rgba(110,231,183,.65); background:rgba(110,231,183,.1); border:1px solid rgba(110,231,183,.2); border-radius:10px; padding:1px 6px; margin-left:5px; vertical-align:middle; font-style:normal; }
  .synonyms { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:16px; }
  .syn { font-size:11px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1); border-radius:20px; padding:3px 10px; color:rgba(254,249,238,.6); cursor:pointer; transition:all .15s; }
  .syn:hover { background:rgba(245,158,11,.12); border-color:rgba(245,158,11,.3); color:#f59e0b; }

  /* Add button */
  .add-btn {
    width:100%; padding:10px 14px; border:none; border-radius:12px;
    background:linear-gradient(135deg,#92400e,#f59e0b);
    color:#fff; font-family:inherit; font-size:13px; font-weight:700; cursor:pointer;
    box-shadow:0 4px 18px rgba(245,158,11,.28);
    display:flex; align-items:center; justify-content:center; gap:7px;
    transition:all .2s;
  }
  .add-btn:hover { filter:brightness(1.1); transform:translateY(-1px); box-shadow:0 6px 24px rgba(245,158,11,.38); }
  .add-btn:active { transform:translateY(0); }
  .add-btn.done { background:linear-gradient(135deg,#065f46,#6ee7b7); box-shadow:0 4px 18px rgba(110,231,183,.25); }
  .add-btn.exists { background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.12); box-shadow:none; cursor:default; transform:none; }

  /* Error */
  .error-body { padding:28px 22px 24px; text-align:center; }
  .error-icon { font-size:36px; margin-bottom:12px; }
  .error-title { font-size:14px; font-weight:600; color:rgba(254,249,238,.8); margin-bottom:5px; }
  .error-sub { font-size:12px; color:rgba(254,249,238,.38); line-height:1.5; }
`;

function showCard(data) {
  hideCard();
  const host = document.createElement('div');
  host.id = 'sip-card-host';
  document.body.appendChild(host);
  cardHost = host;

  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${CARD_CSS}</style>
    <div class="backdrop" id="backdrop"></div>
    <div class="card" id="card">${data.loading ? renderLoading(data.word) : renderFull(data)}</div>`;

  shadow.getElementById('backdrop').addEventListener('click', hideCard);
  bindCardButtons(shadow, data);
}

function renderLoading(word) {
  return `
    <div class="loading-body">
      <div class="loading-word">${esc(word)}</div>
      <div class="skel w80"></div>
      <div class="skel w60"></div>
      <div class="skel w45" style="margin-top:14px"></div>
    </div>`;
}

function renderFull(data) {
  if (data.error) {
    return `
      <div class="error-body">
        <div class="error-icon">🍵</div>
        <div class="error-title">Word not found</div>
        <div class="error-sub">${esc(data.message)}</div>
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
        ${data.audioUrl ? `<button class="play-btn" id="play-btn" title="Play pronunciation">♪</button>` : ''}
        ${data.pos ? `<span class="pos-tag">${esc(data.pos)}</span>` : ''}
      </div>
    </div>
    <div class="card-body">
      ${data.definition ? `<div class="definition">${esc(data.definition)}</div>` : ''}
      ${exampleHtml}
      ${syns ? `<div class="synonyms">${syns}</div>` : ''}
      <button class="add-btn" id="add-btn">Add to Sip ☕</button>
    </div>`;
}

function bindCardButtons(shadow, data) {
  shadow.getElementById('close-btn')?.addEventListener('click', hideCard);

  shadow.getElementById('play-btn')?.addEventListener('click', () => {
    if (data.audioUrl) new Audio(data.audioUrl).play().catch(() => {});
  });

  shadow.querySelectorAll('.syn').forEach(el => {
    el.addEventListener('click', () => {
      const w = el.dataset.word;
      if (w) { hideCard(); currentWord = w; lookupWord(w); }
    });
  });

  const addBtn = shadow.getElementById('add-btn');
  if (addBtn && !data.error) {
    chrome.runtime.sendMessage({ type: 'CHECK_SAVED', word: data.word }, (r) => {
      if (r?.saved) {
        addBtn.textContent = 'Already in your book ✓';
        addBtn.classList.add('exists');
      }
    });

    addBtn.addEventListener('click', () => {
      if (addBtn.classList.contains('exists') || addBtn.classList.contains('done')) return;
      chrome.runtime.sendMessage({ type: 'SAVE_WORD', wordData: data }, (r) => {
        if (r?.saved) {
          addBtn.textContent = 'Added! ✓';
          addBtn.classList.add('done');
          setTimeout(hideCard, 900);
        } else if (r?.reason === 'already_exists') {
          addBtn.textContent = 'Already in your book ✓';
          addBtn.classList.add('exists');
        }
      });
    });
  }
}

function updateCardState(data) {
  const shadow = cardHost?.shadowRoot;
  if (!shadow) return;
  const card = shadow.getElementById('card');
  if (!card) return;
  card.innerHTML = renderFull(data);
  bindCardButtons(shadow, data);
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

function hideCard() { cardHost?.remove(); cardHost = null; }

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ── MESSAGES FROM BACKGROUND ──────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CONTEXT_LOOKUP') {
    currentWord = msg.word;
    hideTip();
    lookupWord(msg.word);
  }
});
