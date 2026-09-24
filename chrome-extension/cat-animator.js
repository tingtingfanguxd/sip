// ── CAT ANIMATOR ───────────────────────────────────────────────
// State-driven cat animation controller.
// Designed for Rive drop-in: when cat.riv is available, RiveCatController
// takes over from CatAnimator. Both expose the same setState() API.
//
// Rive state machine inputs expected in cat.riv:
//   StateMachine: "CatFSM"
//   Boolean inputs: "isSleeping", "isCelebrating"
//   Number input:   "mood"  (0=neutral, 1=happy, 2=very-happy, 3=curious)
//   Trigger input:  "blink", "earTwitch", "whiskerTwitch"

// ── CSS INJECTION ─────────────────────────────────────────────
const CAT_ANIM_CSS = `
  @keyframes catBlink {
    0%,100% { transform: scaleY(1); }
    45%      { transform: scaleY(0.08); }
    55%      { transform: scaleY(0.08); }
  }
  @keyframes catEarTwitch {
    0%,100% { transform: rotate(0deg); }
    30%      { transform: rotate(-12deg) translateY(-2px); }
    60%      { transform: rotate(6deg); }
  }
  @keyframes catWhiskerTwitch {
    0%,100% { transform: rotate(0deg); }
    40%      { transform: rotate(-8deg); }
    70%      { transform: rotate(4deg); }
  }
  @keyframes catBreathIdle {
    0%,100% { transform: scaleY(1) scaleX(1); }
    50%      { transform: scaleY(1.025) scaleX(.985); }
  }
  @keyframes catBreathSleep {
    0%,100% { transform: scaleY(1) scaleX(1) rotate(-2deg); }
    50%      { transform: scaleY(1.04) scaleX(.97) rotate(2deg); }
  }
  @keyframes catCelebrateBounce {
    from { transform: translateY(0) scale(1) rotate(-3deg); }
    to   { transform: translateY(-10px) scale(1.07) rotate(3deg); }
  }
  @keyframes catHappyPulse {
    0%,100% { transform: scale(1); }
    50%      { transform: scale(1.03); }
  }

  .cat-anim-idle       { animation: catBreathIdle 3.2s ease-in-out infinite; transform-origin: center bottom; }
  .cat-anim-sleep      { animation: catBreathSleep 4.5s ease-in-out infinite; transform-origin: center bottom; }
  .cat-anim-celebrate  { animation: catCelebrateBounce .5s ease-in-out infinite alternate; transform-origin: center bottom; }
  .cat-anim-happy      { animation: catHappyPulse 1.8s ease-in-out infinite; transform-origin: center bottom; }

  .cat-eye-blink { animation: catBlink .22s ease-in-out; transform-origin: center center; }
  .cat-ear-twitch { animation: catEarTwitch .38s ease-in-out; }
  .cat-whisker-twitch { animation: catWhiskerTwitch .32s ease-in-out; }
`;

(function injectCatStyles() {
  if (document.getElementById('sip-cat-anim-styles')) return;
  const s = document.createElement('style');
  s.id = 'sip-cat-anim-styles';
  s.textContent = CAT_ANIM_CSS;
  document.head.appendChild(s);
})();

// ── CAT ANIMATOR CLASS ────────────────────────────────────────
class CatAnimator {
  /**
   * @param {string} svgId  — id of the root <svg> element
   * @param {'idle'|'happy'|'sleeping'|'celebrating'} initState
   */
  constructor(svgId, initState = 'idle') {
    this.svg   = document.getElementById(svgId);
    this.state = null;
    this._blinkTimer   = null;
    this._earTimer     = null;
    this._whiskerTimer = null;
    this._alive = true;

    if (this.svg) this.setState(initState);
  }

  setState(state) {
    if (!this.svg || !this._alive) return;
    this.state = state;

    // Reset base animation class
    this.svg.classList.remove(
      'cat-anim-idle', 'cat-anim-sleep', 'cat-anim-celebrate', 'cat-anim-happy',
      'cat-sleep', 'cat-celebrate'
    );

    switch (state) {
      case 'idle':
        this.svg.classList.add('cat-anim-idle');
        this._startRandomBlink(2500, 6000);
        this._startRandomEarTwitch(5000, 12000);
        this._startRandomWhiskerTwitch(4000, 10000);
        break;

      case 'happy':
        this.svg.classList.add('cat-anim-happy');
        this._startRandomBlink(1800, 4000);
        this._startRandomEarTwitch(2000, 5000);
        this._stopWhiskerTwitch();
        break;

      case 'sleeping':
        this.svg.classList.add('cat-anim-sleep');
        this._stopBlink();
        this._stopEarTwitch();
        this._stopWhiskerTwitch();
        break;

      case 'celebrating':
        this.svg.classList.add('cat-anim-celebrate');
        this._stopBlink();
        this._stopEarTwitch();
        this._stopWhiskerTwitch();
        this._burstSparkles();
        break;
    }

    this._updateFacialExpression(state);
  }

  destroy() {
    this._alive = false;
    this._stopBlink();
    this._stopEarTwitch();
    this._stopWhiskerTwitch();
  }

  // ── FACIAL EXPRESSION ───────────────────────────────────────
  _updateFacialExpression(state) {
    const svg = this.svg;
    const mouthId  = svg.id ? `${svg.id}-mouth` : null;
    const eyeLId   = svg.id ? `${svg.id}-eye-l` : null;
    const eyeRId   = svg.id ? `${svg.id}-eye-r` : null;

    // Celebrate/happy: eyes become happy arcs, visible already in celebrating cat SVG
    // Sleep: eyes are already arcs in sleeping cat SVG
    // We swap mouth path for happy state
    if (mouthId) {
      const mouth = document.getElementById(mouthId);
      if (mouth) {
        if (state === 'happy' || state === 'celebrating') {
          mouth.setAttribute('d', 'M53,61 Q60,68 67,61');   // bigger smile
        } else if (state === 'sleeping') {
          mouth.setAttribute('d', 'M57,62 Q60,64 63,62');   // small neutral
        } else {
          mouth.setAttribute('d', 'M56,61 Q60,65 64,61');   // default smile
        }
      }
    }
  }

  // ── BLINK ───────────────────────────────────────────────────
  _startRandomBlink(minMs, maxMs) {
    this._stopBlink();
    const schedule = () => {
      if (!this._alive || this.state === 'sleeping' || this.state === 'celebrating') return;
      const delay = minMs + Math.random() * (maxMs - minMs);
      this._blinkTimer = setTimeout(() => {
        this._doBlink();
        schedule();
      }, delay);
    };
    schedule();
  }

  _doBlink() {
    const svg = this.svg;
    const targets = [
      svg.querySelector('[id$="-eye-l"]') || svg.querySelector('.cat-eye-l'),
      svg.querySelector('[id$="-eye-r"]') || svg.querySelector('.cat-eye-r'),
    ].filter(Boolean);

    targets.forEach(el => {
      el.classList.remove('cat-eye-blink');
      void el.offsetWidth; // reflow to restart animation
      el.classList.add('cat-eye-blink');
      el.addEventListener('animationend', () => el.classList.remove('cat-eye-blink'), { once: true });
    });
  }

  _stopBlink() {
    clearTimeout(this._blinkTimer);
    this._blinkTimer = null;
  }

  // ── EAR TWITCH ──────────────────────────────────────────────
  _startRandomEarTwitch(minMs, maxMs) {
    this._stopEarTwitch();
    const schedule = () => {
      if (!this._alive || this.state === 'sleeping') return;
      const delay = minMs + Math.random() * (maxMs - minMs);
      this._earTimer = setTimeout(() => {
        this._doEarTwitch();
        schedule();
      }, delay);
    };
    schedule();
  }

  _doEarTwitch() {
    const svg = this.svg;
    const ear = Math.random() > .5
      ? (svg.querySelector('[id$="-ear-l"]') || svg.querySelector('.cat-ear-l'))
      : (svg.querySelector('[id$="-ear-r"]') || svg.querySelector('.cat-ear-r'));
    if (!ear) return;
    ear.classList.remove('cat-ear-twitch');
    void ear.offsetWidth;
    ear.classList.add('cat-ear-twitch');
    ear.addEventListener('animationend', () => ear.classList.remove('cat-ear-twitch'), { once: true });
  }

  _stopEarTwitch() {
    clearTimeout(this._earTimer);
    this._earTimer = null;
  }

  // ── WHISKER TWITCH ──────────────────────────────────────────
  _startRandomWhiskerTwitch(minMs, maxMs) {
    this._stopWhiskerTwitch();
    const schedule = () => {
      if (!this._alive || this.state !== 'idle') return;
      const delay = minMs + Math.random() * (maxMs - minMs);
      this._whiskerTimer = setTimeout(() => {
        this._doWhiskerTwitch();
        schedule();
      }, delay);
    };
    schedule();
  }

  _doWhiskerTwitch() {
    const svg = this.svg;
    const whi = Math.random() > .5
      ? (svg.querySelector('[id$="-whi-l"]') || svg.querySelector('.cat-whi-l'))
      : (svg.querySelector('[id$="-whi-r"]') || svg.querySelector('.cat-whi-r'));
    if (!whi) return;
    whi.classList.remove('cat-whisker-twitch');
    void whi.offsetWidth;
    whi.classList.add('cat-whisker-twitch');
    whi.addEventListener('animationend', () => whi.classList.remove('cat-whisker-twitch'), { once: true });
  }

  _stopWhiskerTwitch() {
    clearTimeout(this._whiskerTimer);
    this._whiskerTimer = null;
  }

  // ── SPARKLE BURST (celebrating) ──────────────────────────────
  _burstSparkles() {
    const svg = this.svg;
    const sparkles = svg.querySelectorAll('circle[style*="sparkle"]');
    sparkles.forEach((s, i) => {
      s.style.animationDelay = `${i * 0.15}s`;
      s.style.animationDuration = `${0.9 + Math.random() * 0.4}s`;
    });
  }
}

// ── RIVE INTEGRATION SCAFFOLD ─────────────────────────────────
// Drop in when cat.riv is ready. Requires @rive-app/canvas runtime.
// To activate: set RIVE_ENABLED = true and place cat.riv in icons/
//
// Rive file requirements:
//   - Artboard: "Cat"
//   - State Machine: "CatFSM"
//   - Boolean input: "isSleeping"   (triggers sleep state)
//   - Boolean input: "isCelebrating" (triggers celebrate state)
//   - Number  input: "mood"         (0=idle, 1=happy, 2=very-happy)
//   - Trigger input: "doBlink"
//   - Trigger input: "doEarTwitch"
//   - States: Idle → transitions on mood; Sleep; Celebrate; Happy

const RIVE_ENABLED = false;

class RiveCatController {
  constructor(canvasId, rivSrc = 'icons/cat.riv') {
    this.canvas = document.getElementById(canvasId);
    this.rive   = null;
    this.inputs = {};
    this.state  = 'idle';

    if (!RIVE_ENABLED || !this.canvas || typeof rive === 'undefined') {
      console.warn('[Sip] Rive not enabled or runtime not loaded. Using CSS fallback.');
      return;
    }

    this.rive = new rive.Rive({
      src:          rivSrc,
      canvas:       this.canvas,
      artboard:     'Cat',
      stateMachines: 'CatFSM',
      autoplay:     true,
      onLoad: () => {
        const allInputs = this.rive.stateMachineInputs('CatFSM');
        allInputs.forEach(inp => { this.inputs[inp.name] = inp; });
      },
    });
  }

  setState(state) {
    this.state = state;
    if (!this.rive || !Object.keys(this.inputs).length) return;

    const { isSleeping, isCelebrating, mood } = this.inputs;
    if (isSleeping)    isSleeping.value    = (state === 'sleeping');
    if (isCelebrating) isCelebrating.value = (state === 'celebrating');
    if (mood) {
      mood.value = { idle: 0, happy: 1, celebrating: 2, sleeping: 0 }[state] ?? 0;
    }
  }

  triggerBlink()   { this.inputs.doBlink?.fire(); }
  triggerEarTwitch(){ this.inputs.doEarTwitch?.fire(); }
}

// ── EXPORTS ───────────────────────────────────────────────────
window.CatAnimator       = CatAnimator;
window.RiveCatController = RiveCatController;
