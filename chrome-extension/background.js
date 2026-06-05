// ── SETUP ────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'sip-lookup',
    title: 'Sip this word ☕',
    contexts: ['selection'],
  });
  chrome.alarms.create('sip-daily-reminder', { periodInMinutes: 1440 });
});

// ── CONTEXT MENU ─────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'sip-lookup' || !info.selectionText) return;
  const word = info.selectionText.trim().split(/\s+/)[0]; // first word only
  if (!word) return;
  chrome.tabs.sendMessage(tab.id, { type: 'CONTEXT_LOOKUP', word });
});

// ── DAILY REMINDER ───────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'sip-daily-reminder') return;
  const r = await chrome.storage.local.get(['sip-settings', 'sip-words']);
  const settings = r['sip-settings'] || {};
  if (!settings.reminderEnabled) return;
  const words = r['sip-words'] || [];
  const due = words.filter(w => !w.nextReview || w.nextReview <= Date.now()).length;
  if (due === 0) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Sip ☕ — Time to review!',
    message: `You have ${due} word${due !== 1 ? 's' : ''} ready. Take 5 minutes to brew! ☕`,
  });
});

// ── MESSAGE ROUTER ────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'LOOKUP')      { handleLookup(msg.word).then(sendResponse);         return true; }
  if (msg.type === 'AI_EXAMPLE')  { handleAiExample(msg).then(sendResponse);           return true; }
  if (msg.type === 'SAVE_WORD')   { handleSaveWord(msg.wordData).then(sendResponse);   return true; }
  if (msg.type === 'CHECK_SAVED') { handleCheckSaved(msg.word).then(sendResponse);     return true; }
});

// ── DICTIONARY LOOKUP ─────────────────────────────────────────
async function handleLookup(rawWord) {
  const word = rawWord.toLowerCase().trim();
  try {
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`);
    if (!res.ok) return { error: `"${rawWord}" wasn't found. Try a simpler form of the word.` };

    const [entry] = await res.json();
    const meaning   = entry.meanings?.[0] ?? {};
    const def       = meaning.definitions?.[0] ?? {};
    const phonetics = entry.phonetics ?? [];
    const phonetic  = phonetics.find(p => p.text)?.text ?? entry.phonetic ?? '';
    const audioUrl  = phonetics.find(p => p.audio && p.audio.startsWith('http'))?.audio ?? '';
    const synonyms  = [
      ...(def.synonyms ?? []),
      ...(meaning.synonyms ?? []),
    ].filter(Boolean).slice(0, 5);

    const r = await chrome.storage.local.get('sip-settings');
    const geminiKeySet = !!(r['sip-settings']?.geminiKey);

    return {
      word: entry.word,
      phonetic,
      audioUrl,
      pos:        meaning.partOfSpeech ?? '',
      definition: def.definition ?? '',
      example:    def.example ?? '',
      synonyms,
      geminiKeySet,
    };
  } catch (e) {
    return { error: `Network error. Check your connection and try again.` };
  }
}

// ── GEMINI AI EXAMPLE ─────────────────────────────────────────
async function handleAiExample({ word, pos, definition }) {
  try {
    const r = await chrome.storage.local.get('sip-settings');
    const key = r['sip-settings']?.geminiKey;
    if (!key) return { example: null };

    const prompt = `Write one warm, memorable example sentence using the English word "${word}" (${pos}: ${definition}). Make it natural, slightly creative, and easy to remember — like a line from a good novel. Return only the sentence, no quotes, no explanation.`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    );
    const data = await res.json();
    const example = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
    return { example };
  } catch {
    return { example: null };
  }
}

// ── SAVE WORD ─────────────────────────────────────────────────
async function handleSaveWord(wordData) {
  const r = await chrome.storage.local.get('sip-words');
  const words = r['sip-words'] ?? [];

  if (words.some(w => w.word.toLowerCase() === wordData.word.toLowerCase())) {
    return { saved: false, reason: 'already_exists' };
  }

  const newWord = {
    ...wordData,
    id:          crypto.randomUUID(),
    addedAt:     Date.now(),
    repetitions: 0,
    easeFactor:  2.5,
    interval:    0,
    nextReview:  Date.now(),
  };

  words.unshift(newWord);
  await chrome.storage.local.set({ 'sip-words': words });

  // Notify popup if open
  chrome.runtime.sendMessage({ type: 'WORD_ADDED', word: newWord.word }).catch(() => {});

  return { saved: true };
}

async function handleCheckSaved(word) {
  const r = await chrome.storage.local.get('sip-words');
  const words = r['sip-words'] ?? [];
  return { saved: words.some(w => w.word.toLowerCase() === word.toLowerCase()) };
}
