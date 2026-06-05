// ── STATE ─────────────────────────────────────────────────────
let wordBook   = [];
let settings   = { geminiKey:'', reminderEnabled:false, reminderTime:'09:00', musicEnabled:true };
let streak     = 0;
let lastReview = 0;

let sessionQueue = [];
let sessionIdx   = 0;
let sessionDone  = 0;
let isFlipped    = false;

let currentTab = 'review';
let ambient    = null;

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  bindNav();
  bindHeader();
  bindReviewButtons();
  bindWordsTab();
  bindSettingsTab();
  renderHeader();
  showReviewState();
  if (settings.musicEnabled) startMusic();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'WORD_ADDED') {
      loadAll().then(() => {
        showToast(`"${msg.word}" added ☕`);
        if (currentTab === 'words') renderWordBook();
        if (currentTab === 'review') showReviewState();
      });
    }
  });
});

// ── DATA ──────────────────────────────────────────────────────
async function loadAll() {
  const r = await chrome.storage.local.get(['sip-words','sip-settings','sip-streak','sip-last-review']);
  wordBook   = r['sip-words']       ?? [];
  settings   = { ...settings, ...(r['sip-settings'] ?? {}) };
  streak     = r['sip-streak']      ?? 0;
  lastReview = r['sip-last-review'] ?? 0;
}

async function saveWords()    { await chrome.storage.local.set({ 'sip-words': wordBook }); }
async function saveSettings() { await chrome.storage.local.set({ 'sip-settings': settings }); }

// ── SM-2 ──────────────────────────────────────────────────────
function sm2(card, grade) {
  const c = { ...card };
  if (grade >= 3) {
    if (c.repetitions === 0)      c.interval = 1;
    else if (c.repetitions === 1) c.interval = 6;
    else                          c.interval = Math.round(c.interval * c.easeFactor);
    c.repetitions++;
  } else {
    c.repetitions = 0;
    c.interval    = 1;
  }
  c.easeFactor  = Math.max(1.3, c.easeFactor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  c.nextReview  = Date.now() + c.interval * 86_400_000;
  return c;
}

function getDue() {
  return wordBook.filter(w => !w.nextReview || w.nextReview <= Date.now());
}

// ── NAVIGATION ────────────────────────────────────────────────
function bindNav() {
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tab}`);
    p.classList.toggle('hidden', p.id !== `tab-${tab}`);
  });
  if (tab === 'words')    renderWordBook();
  if (tab === 'settings') renderSettings();
}

// ── HEADER ────────────────────────────────────────────────────
function renderHeader() {
  document.getElementById('streak-num').textContent = streak;
  const musicBtn = document.getElementById('music-btn');
  musicBtn.classList.toggle('active', settings.musicEnabled);
}

function bindHeader() {
  document.getElementById('music-btn').addEventListener('click', () => {
    settings.musicEnabled = !settings.musicEnabled;
    saveSettings();
    renderHeader();
    settings.musicEnabled ? startMusic() : stopMusic();
  });
}

// ── REVIEW STATE MACHINE ──────────────────────────────────────
function showReviewState() {
  hide('state-onboard'); hide('state-prestart');
  hide('state-caught-up'); hide('state-session'); hide('state-done');

  if (wordBook.length === 0) {
    show('state-onboard'); return;
  }
  const due = getDue();
  if (due.length === 0) {
    document.getElementById('total-words-count').textContent = wordBook.length;
    show('state-caught-up'); return;
  }
  document.getElementById('due-badge').textContent = `${due.length} word${due.length !== 1 ? 's' : ''} due`;
  show('state-prestart');
}

function bindReviewButtons() {
  document.getElementById('start-btn').addEventListener('click', startSession);
  document.getElementById('done-again-btn').addEventListener('click', () => {
    showReviewState();
  });

  document.getElementById('flip-card').addEventListener('click', () => {
    if (!isFlipped) flipCard();
  });

  document.querySelectorAll('.grade-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      gradeCard(parseInt(btn.dataset.grade));
    });
  });

  document.getElementById('flip-play-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const card = sessionQueue[sessionIdx];
    if (card?.audioUrl) new Audio(card.audioUrl).play().catch(() => {});
  });
}

function startSession() {
  const due = getDue();
  sessionQueue = due.slice(0, 20);
  sessionIdx   = 0;
  sessionDone  = 0;

  updateProgress();
  hide('state-prestart');
  show('state-session');
  showSessionCard();
}

function showSessionCard() {
  const card = sessionQueue[sessionIdx];
  isFlipped   = false;

  document.getElementById('flip-inner').classList.remove('flipped');
  document.getElementById('grade-row').classList.add('hidden');

  // Front
  document.getElementById('flip-context').textContent  = card.sourceUrl
    ? new URL(card.sourceUrl).hostname.replace('www.','')
    : '';
  document.getElementById('flip-word').textContent     = card.word;
  document.getElementById('flip-pos-front').textContent = card.pos ?? '';

  // Back
  document.getElementById('flip-word-back').textContent  = card.word;
  document.getElementById('flip-phonetic').textContent   = card.phonetic ?? '';
  document.getElementById('flip-definition').textContent = card.definition ?? '';

  const exEl = document.getElementById('flip-example');
  exEl.textContent = card.aiExample
    ? `"${card.aiExample}"`
    : card.example ? `"${card.example}"` : '';

  const synEl = document.getElementById('flip-synonyms');
  synEl.innerHTML = (card.synonyms ?? []).slice(0,4)
    .map(s => `<span class="syn-chip">${esc(s)}</span>`).join('');

  const playBtn = document.getElementById('flip-play-btn');
  playBtn.style.display = card.audioUrl ? 'flex' : 'none';

  updateProgress();
}

function flipCard() {
  isFlipped = true;
  document.getElementById('flip-inner').classList.add('flipped');
  setTimeout(() => document.getElementById('grade-row').classList.remove('hidden'), 300);
}

function gradeCard(grade) {
  const card    = sessionQueue[sessionIdx];
  const updated = sm2(card, grade);
  const idx     = wordBook.findIndex(w => w.id === card.id);
  if (idx >= 0) wordBook[idx] = updated;
  saveWords();

  sessionDone++;
  sessionIdx++;

  if (sessionIdx >= sessionQueue.length) {
    endSession();
  } else {
    const inner = document.getElementById('flip-inner');
    inner.style.transition = 'none';
    inner.style.opacity    = '0';
    setTimeout(() => {
      inner.style.transition = '';
      inner.style.opacity    = '1';
      showSessionCard();
    }, 180);
  }
}

function updateProgress() {
  const total = sessionQueue.length;
  const done  = sessionIdx;
  const pct   = total > 0 ? (done / total) * 100 : 0;
  document.getElementById('progress-fill').style.width  = `${pct}%`;
  document.getElementById('progress-label').textContent = `${done} / ${total}`;
}

function endSession() {
  updateStreak();
  hide('state-session');
  document.getElementById('done-count').textContent  = sessionDone;
  document.getElementById('done-streak').textContent = streak;
  show('state-done');
}

async function updateStreak() {
  const now     = Date.now();
  const oneDay  = 86_400_000;
  const today   = Math.floor(now / oneDay);
  const lastDay = Math.floor(lastReview / oneDay);
  if (today - lastDay === 1)     streak++;
  else if (today - lastDay > 1)  streak = 1;
  lastReview = now;
  await chrome.storage.local.set({ 'sip-streak': streak, 'sip-last-review': lastReview });
  document.getElementById('streak-num').textContent = streak;
}

// ── WORD BOOK ─────────────────────────────────────────────────
function renderWordBook() {
  const query = document.getElementById('search-input').value.toLowerCase();
  const sort  = document.getElementById('sort-select').value;
  const now   = Date.now();

  let words = wordBook.filter(w =>
    !query || w.word.toLowerCase().includes(query) || (w.definition ?? '').toLowerCase().includes(query)
  );

  if (sort === 'az')   words.sort((a,b) => a.word.localeCompare(b.word));
  if (sort === 'due')  words.sort((a,b) => (a.nextReview ?? 0) - (b.nextReview ?? 0));
  if (sort === 'recent') words.sort((a,b) => b.addedAt - a.addedAt);

  const list  = document.getElementById('word-list');
  const empty = document.getElementById('word-empty');

  if (words.length === 0) {
    list.innerHTML = ''; show('word-empty'); return;
  }
  hide('word-empty');

  list.innerHTML = words.map(w => {
    const due   = !w.nextReview || w.nextReview <= now;
    const soon  = !due && w.nextReview - now < 3 * 86_400_000;
    const badge = due  ? '<span class="word-item-badge badge-due">Due</span>'
                : soon ? '<span class="word-item-badge badge-soon">Soon</span>'
                       : '';
    return `
      <div class="word-item" data-id="${w.id}">
        <span class="word-item-word">${esc(w.word)}</span>
        <span class="word-item-def">${esc(w.definition ?? '')}</span>
        ${badge}
      </div>`;
  }).join('');
}

function bindWordsTab() {
  document.getElementById('search-input').addEventListener('input', renderWordBook);
  document.getElementById('sort-select').addEventListener('change', renderWordBook);
  document.getElementById('word-list').addEventListener('click', (e) => {
    const item = e.target.closest('.word-item');
    if (!item) return;
    const word = wordBook.find(w => w.id === item.dataset.id);
    if (word) openWordDetail(word);
  });
}

function openWordDetail(word) {
  showToast(`${word.word} — interval: ${word.interval}d`);
}

// ── SETTINGS ─────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('gemini-key-input').value =
    settings.geminiKey ? '•'.repeat(12) : '';
  document.getElementById('key-status').textContent =
    settings.geminiKey ? '✓ API key saved — AI examples enabled' : '';
  document.getElementById('reminder-toggle').checked  = settings.reminderEnabled;
  document.getElementById('reminder-time').value      = settings.reminderTime ?? '09:00';
  document.getElementById('music-toggle').checked     = settings.musicEnabled;
}

function bindSettingsTab() {
  document.getElementById('save-key-btn').addEventListener('click', async () => {
    const val = document.getElementById('gemini-key-input').value.trim();
    if (!val || val.startsWith('•')) return;
    settings.geminiKey = val;
    await saveSettings();
    document.getElementById('key-status').textContent = '✓ API key saved — AI examples enabled';
    document.getElementById('gemini-key-input').value = '•'.repeat(12);
    showToast('API key saved ✓');
  });

  document.getElementById('reminder-toggle').addEventListener('change', async (e) => {
    settings.reminderEnabled = e.target.checked;
    await saveSettings();
    if (settings.reminderEnabled) {
      await chrome.notifications.requestPermission?.();
    }
  });

  document.getElementById('reminder-time').addEventListener('change', async (e) => {
    settings.reminderTime = e.target.value;
    await saveSettings();
  });

  document.getElementById('music-toggle').addEventListener('change', async (e) => {
    settings.musicEnabled = e.target.checked;
    await saveSettings();
    renderHeader();
    settings.musicEnabled ? startMusic() : stopMusic();
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(wordBook, null, 2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url; a.download = 'sip-words.json'; a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('clear-btn').addEventListener('click', async () => {
    if (!confirm('Delete all words? This cannot be undone.')) return;
    wordBook = [];
    await saveWords();
    showReviewState();
    renderWordBook();
    showToast('Word book cleared');
  });
}

// ── AMBIENT MUSIC ─────────────────────────────────────────────
class AmbientPlayer {
  constructor() { this.ctx = null; this.gain = null; this.running = false; this.nextNote = 0; this.timer = null; }

  start() {
    if (this.running) return;
    this.ctx     = new AudioContext();
    this.gain    = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(this.ctx.destination);
    this.gain.gain.linearRampToValueAtTime(0.35, this.ctx.currentTime + 2);

    // Delay reverb
    const delay = this.ctx.createDelay(2);
    const fb    = this.ctx.createGain();
    const lp    = this.ctx.createBiquadFilter();
    delay.delayTime.value = 0.4;
    fb.gain.value         = 0.3;
    lp.frequency.value    = 1200;
    delay.connect(lp); lp.connect(fb); fb.connect(delay);
    this.gain.connect(delay); delay.connect(this.ctx.destination);

    this.reverbIn = delay;
    this.running  = true;
    this.nextNote = this.ctx.currentTime + 0.5;
    this.schedule();
  }

  schedule() {
    if (!this.running) return;
    const now  = this.ctx.currentTime;
    const SCALE = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33];

    while (this.nextNote < now + 3) {
      if (this.nextNote < now) this.nextNote = now + 0.1;
      const freq     = SCALE[Math.floor(Math.random() * SCALE.length)];
      const oct      = Math.random() > 0.72 ? 0.5 : 1;
      const dur      = 1.8 + Math.random() * 2.2;
      const vel      = 0.04 + Math.random() * 0.06;
      this.playNote(freq * oct, this.nextNote, dur, vel);
      this.nextNote += 1.0 + Math.random() * 2.8;
    }
    this.timer = setTimeout(() => this.schedule(), 600);
  }

  playNote(freq, t, dur, vel) {
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const lp  = this.ctx.createBiquadFilter();
    osc.type                  = 'triangle';
    osc.frequency.value       = freq;
    lp.type                   = 'lowpass';
    lp.frequency.value        = 700 + freq * 0.4;
    lp.Q.value                = 0.4;
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.06);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(lp); lp.connect(env); env.connect(this.gain);
    osc.start(t); osc.stop(t + dur + 0.1);
  }

  stop() {
    clearTimeout(this.timer);
    this.running = false;
    if (this.gain) {
      this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      setTimeout(() => this.ctx?.close().catch(()=>{}), 1500);
    }
  }
}

function startMusic() { if (!ambient) ambient = new AmbientPlayer(); ambient.start(); }
function stopMusic()  { ambient?.stop(); ambient = null; }

// ── HELPERS ───────────────────────────────────────────────────
function show(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('hidden'); el.style.display = ''; }
}
function hide(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function showToast(msg, ms = 2400) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
