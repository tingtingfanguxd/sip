let streamAudio = null;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'STREAM_PLAY' && msg.url) {
    if (streamAudio) { streamAudio.pause(); streamAudio = null; }
    streamAudio = new Audio(msg.url);
    streamAudio.loop = true;
    streamAudio.volume = Math.max(0, Math.min(1, msg.volume ?? 0.4));
    streamAudio.play().catch(e => console.error('[Sip stream]', e));
  }

  if (msg.type === 'STREAM_STOP') {
    if (streamAudio) { streamAudio.pause(); streamAudio.src = ''; streamAudio = null; }
  }

  if (msg.type === 'STREAM_VOLUME' && streamAudio) {
    streamAudio.volume = Math.max(0, Math.min(1, msg.volume));
  }
});
