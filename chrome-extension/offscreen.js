// Offscreen document — reserved for future background audio
// (ambient music currently runs in popup via Web Audio API)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  // Future: play notification sounds, TTS, etc.
});
