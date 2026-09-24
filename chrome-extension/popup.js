// ── STATE ─────────────────────────────────────────────────────
let wordBook   = [];
let settings   = { apiUrl:'', apiKey:'', apiModel:'', reminderEnabled:false, reminderTime:'09:00', musicEnabled:true, streamUrl:'', volume:0.4 };
let streak     = 0;
let lastReview = 0;

let sessionQueue = [];
let sessionIdx   = 0;
let sessionDone  = 0;
let isFlipped    = false;
let isAnimating  = false;

let currentTab    = 'review';
let detailWord    = null;
let dueRing       = null;
let totalRing     = null;
let deleteConfirmTimer = null;
let clearConfirmTimer  = null;

let activeTimeFilter   = '';
let activePosFilter    = '';
let activeDomainFilter = '';
let activeLangFilter   = '';

let sessionGrades  = {};         // grade counts for current session { 0:n, 1:n, 3:n, 5:n }
let sessionLang    = '';         // '' = all languages
let sessionWeakIds = new Set();  // IDs graded Again/Hard in current real session
let isPractice     = false;      // true during re-brew practice (no SRS/streak updates)

const LANG_LABELS = { en: 'EN', es: 'ES', fi: 'FI', sv: 'SV' };
const LANG_NAMES  = { en: 'English', es: 'Español', fi: 'Suomi', sv: 'Svenska' };

// ── SPRING ────────────────────────────────────────────────────
class Spring {
  constructor(k = 200, d = 20) {
    this.k = k; this.d = d;
    this.pos = 0; this.vel = 0; this.target = 0;
  }
  tick(dt) {
    const f = -this.k * (this.pos - this.target) - this.d * this.vel;
    this.vel += f * dt;
    this.pos += this.vel * dt;
  }
  impulse(v) { this.vel += v; }
  snap(v)    { this.pos = v; this.vel = 0; this.target = v; }
}

// ── COFFEE BUDDY ──────────────────────────────────────────────
class CoffeeBuddy {
  constructor(canvas) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.W  = canvas.width;   // 120
    this.H  = canvas.height;  // 134

    this.sY   = new Spring(130, 11);   // vertical bounce
    this.sRot = new Spring(260, 20);   // rotation shake
    this.sSc  = new Spring(280, 22);   // scale impulse
    this.sSqX = new Spring(260, 20);   // squash X
    this.sSqY = new Spring(260, 20);   // squash Y

    this.eyeOpen  = 1;
    this.eyeCurve = 0;    // -1 sad, 0 neutral, 1 happy
    this.pupilX   = 0;    // gaze direction
    this.pupilY   = 0;
    this.tgtPX    = 0;
    this.tgtPY    = 0;

    this.t        = 0;
    this.blinkT   = 0;
    this.blinkInt = 2 + Math.random() * 2.5;
    this.gazeT    = 0;
    this.gazeInt  = 3 + Math.random() * 3;

    this.steam    = [];
    this.sparkles = [];
    this.state    = 'idle';
    this.raf      = null;
    this.alive    = true;
    this._start();
  }

  setState(s) {
    this.state = s;
    if (s === 'good') {
      this.eyeCurve = 1;
      this.sY.impulse(-13);
      this.sSc.impulse(0.55);
      setTimeout(() => { this.eyeCurve = 0; if (this.state === 'good') this.state = 'idle'; }, 1400);
    }
    if (s === 'bad') {
      this.eyeCurve = -1;
      [0, 110, 220, 330].forEach((ms, i) =>
        setTimeout(() => this.sRot.impulse(i % 2 === 0 ? -0.24 : 0.24), ms));
      setTimeout(() => { this.eyeCurve = 0; if (this.state === 'bad') this.state = 'idle'; }, 1700);
    }
    if (s === 'celebrate') {
      this.eyeCurve = 1;
      this._celebPulse(0);
    }
  }

  _celebPulse(n) {
    if (!this.alive || this.state !== 'celebrate' || n > 5) return;
    this.sY.impulse(-17);
    this.sSc.impulse(0.65);
    this.sRot.impulse(n % 2 === 0 ? 0.32 : -0.32);
    this._spawnSparkles();
    setTimeout(() => this._celebPulse(n + 1), 420);
  }

  _spawnSparkles() {
    const cx = this.W / 2, cy = this.H * 0.5;
    const cols = ['#FFE033','#FF2D6B','#00DC82','#0099FF','#8B5CF6','#FF6B1A'];
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1.8 + Math.random() * 2.2;
      this.sparkles.push({
        x: cx + (Math.random()-0.5)*22,
        y: cy - 10 + (Math.random()-0.5)*14,
        vx: Math.cos(a)*s, vy: Math.sin(a)*s - 1.2,
        r: 2.2 + Math.random()*2,
        life: 1,
        col: cols[Math.floor(Math.random()*cols.length)],
      });
    }
  }

  _tick(dt) {
    this.t += dt;

    this.sY.target = Math.sin(this.t * 0.68) * 2.5;  // breathing
    this.sY.tick(dt);
    this.sRot.tick(dt);
    this.sSc.tick(dt);

    // Squash & stretch driven by vertical velocity
    this.sSqX.target =  this.sY.vel * 0.013;
    this.sSqY.target = -this.sY.vel * 0.013;
    this.sSqX.tick(dt);
    this.sSqY.tick(dt);

    // Blink
    this.blinkT += dt;
    if (this.blinkT > this.blinkInt) {
      this.blinkT = 0;
      this.blinkInt = 1.8 + Math.random() * 3.2;
      this._blink();
    }

    // Gaze wander
    this.gazeT += dt;
    if (this.gazeT > this.gazeInt) {
      this.gazeT = 0;
      this.gazeInt = 2.2 + Math.random() * 3.8;
      this.tgtPX = (Math.random()-0.5) * 1.6;
      this.tgtPY = (Math.random()-0.5) * 0.9;
    }
    this.pupilX += (this.tgtPX - this.pupilX) * dt * 3.5;
    this.pupilY += (this.tgtPY - this.pupilY) * dt * 3.5;

    // Steam particles
    if (Math.random() < 0.25) this._spawnSteam();
    for (let i = this.steam.length-1; i >= 0; i--) {
      const p = this.steam[i];
      p.x += Math.sin(p.w)*0.52 + p.vx;
      p.y -= p.vy;  p.w += 0.036;  p.life -= p.dec;  p.r += 0.038;
      if (p.life <= 0) this.steam.splice(i, 1);
    }

    // Sparkles
    for (let i = this.sparkles.length-1; i >= 0; i--) {
      const s = this.sparkles[i];
      s.x += s.vx;  s.y += s.vy;  s.vy += 0.09;
      s.life -= 0.026;
      if (s.life <= 0) this.sparkles.splice(i, 1);
    }
  }

  _blink() {
    this.eyeOpen = 0.05;
    setTimeout(() => { this.eyeOpen = 0.5; },  55);
    setTimeout(() => { this.eyeOpen = 1.0; }, 120);
  }

  _spawnSteam() {
    const cx   = this.W / 2;
    const topY = this.H * 0.37 + this.sY.pos;  // above cup rim
    [-7, 1, 8].forEach(ox => {
      if (Math.random() < 0.5) return;
      this.steam.push({
        x: cx+ox+(Math.random()-0.5)*4, y: topY,
        vx: (Math.random()-0.5)*0.26, vy: 0.46+Math.random()*0.38,
        w: Math.random()*Math.PI*2,
        life: 1, dec: 0.009+Math.random()*0.007, r: 2.5+Math.random()*2,
      });
    });
  }

  _draw() {
    const { cx, W, H } = this;
    cx.clearRect(0, 0, W, H);

    const oy  = this.sY.pos;
    const rot = this.sRot.pos;
    const scI = Math.max(-0.4, Math.min(1, this.sSc.pos));
    const sc  = 1 + scI * 0.13;
    const sqX = Math.max(0.82, 1 + this.sSqX.pos * 0.42);
    const sqY = Math.max(0.82, 1 + this.sSqY.pos * 0.42);

    const py = H * 0.52 + oy;

    cx.save();
    cx.translate(W/2, py);
    cx.rotate(rot);
    cx.scale(sc * sqX, sc * sqY);
    cx.translate(-W/2, -py);

    this._drawShadow(cx, W/2, H * 0.87);
    this._drawSaucer(cx, W/2, py + 28);
    this._drawCup(cx, W/2, py);
    this._drawSteam(cx);

    cx.restore();
    this._drawSparkles(cx);
  }

  _drawSteam(cx) {
    for (const p of this.steam) {
      const a = p.life > 0.72
        ? (1 - p.life) / 0.28 * 0.16
        : p.life < 0.28 ? p.life / 0.28 * 0.16 : 0.16;
      cx.beginPath();
      cx.arc(p.x, p.y, p.r, 0, Math.PI*2);
      cx.fillStyle = `rgba(245,158,11,${a.toFixed(3)})`;
      cx.fill();
    }
  }

  _drawSparkles(cx) {
    for (const s of this.sparkles) {
      cx.globalAlpha = Math.max(0, s.life);
      cx.beginPath();
      cx.arc(s.x, s.y, s.r, 0, Math.PI*2);
      cx.fillStyle = s.col;
      cx.fill();
    }
    cx.globalAlpha = 1;
  }

  _drawShadow(cx, x, y) {
    const g = cx.createRadialGradient(x, y, 3, x, y, 42);
    g.addColorStop(0, 'rgba(0,0,0,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    cx.beginPath();
    cx.ellipse(x, y, 42, 7, 0, 0, Math.PI*2);
    cx.fillStyle = g;
    cx.fill();
  }

  _drawSaucer(cx, x, y) {
    cx.beginPath();
    cx.ellipse(x, y, 40, 7, 0, 0, Math.PI*2);
    cx.fillStyle = '#E7E5E4';
    cx.fill();
    cx.beginPath();
    cx.ellipse(x, y, 40, 7, 0, 0, Math.PI*2);
    cx.strokeStyle = 'rgba(245,158,11,0.5)';
    cx.lineWidth = 1; cx.stroke();
    cx.beginPath();
    cx.ellipse(x-4, y-2, 20, 2.5, -0.15, Math.PI, Math.PI*2);
    cx.strokeStyle = 'rgba(245,158,11,0.2)';
    cx.lineWidth = 1; cx.stroke();
  }

  _drawCup(cx, x, y) {
    const W2 = 66, H2 = 50, R = 4;   // flat corners = pixel look
    const l = x - W2/2, t = y - H2/2;

    // Body — warm cream
    cx.beginPath(); this._rrect(cx, l, t, W2, H2, R);
    cx.fillStyle = '#FEF3C7'; cx.fill();

    // Amber border
    cx.beginPath(); this._rrect(cx, l, t, W2, H2, R);
    cx.strokeStyle = 'rgba(245,158,11,0.8)';
    cx.lineWidth = 1.5; cx.stroke();

    // Left-edge highlight
    cx.beginPath();
    cx.moveTo(l+R, t+4); cx.lineTo(l+2, t+16); cx.lineTo(l+2, t+H2-R);
    cx.strokeStyle = 'rgba(245,158,11,0.15)';
    cx.lineWidth = 3; cx.lineCap = 'round'; cx.stroke();

    // Rim
    cx.beginPath();
    cx.ellipse(x, t+2, W2/2-0.5, 5.5, 0, 0, Math.PI*2);
    cx.fillStyle = '#FDE68A'; cx.fill();
    cx.beginPath();
    cx.ellipse(x, t+2, W2/2-0.5, 5.5, 0, 0, Math.PI*2);
    cx.strokeStyle = 'rgba(245,158,11,0.6)';
    cx.lineWidth = 1; cx.stroke();

    // Coffee inside — warm brown
    cx.beginPath();
    cx.ellipse(x, t+14, W2/2-7, 4.5, 0, 0, Math.PI*2);
    cx.fillStyle = '#92400E'; cx.fill();
    cx.beginPath();
    cx.ellipse(x-5, t+13, 11, 2, -0.2, 0, Math.PI*2);
    cx.fillStyle = 'rgba(255,255,255,0.35)'; cx.fill();

    // Specular highlight
    cx.beginPath();
    cx.ellipse(l+W2*0.68, t+H2*0.22, 10, 6, 0.4, 0, Math.PI*2);
    cx.fillStyle = 'rgba(255,255,255,0.45)'; cx.fill();

    // Handle
    cx.beginPath();
    cx.arc(l+W2-4, y-7, 14, -0.45, Math.PI*0.52);
    cx.arc(l+W2-4, y-7,  8, Math.PI*0.52, -0.45, true);
    cx.closePath();
    cx.fillStyle = '#FEF3C7'; cx.fill();
    cx.strokeStyle = 'rgba(245,158,11,0.6)';
    cx.lineWidth = 1; cx.stroke();

    // Face ambient glow — warm tint
    const fg = cx.createRadialGradient(x, y+3, 0, x, y+3, 22);
    fg.addColorStop(0, 'rgba(245,158,11,0.08)');
    fg.addColorStop(1, 'rgba(245,158,11,0)');
    cx.beginPath();
    cx.ellipse(x, y+3, 22, 19, 0, 0, Math.PI*2);
    cx.fillStyle = fg; cx.fill();

    // Eyes
    this._drawEyes(cx, x, y+2);
  }

  _drawEyes(cx, x, y) {
    const lx = x - 13, rx = x + 13, ey = y + 1;
    this._drawEye(cx, lx, ey, false);
    this._drawEye(cx, rx, ey, true);

    // Happy blush — cyan pixel blocks
    if (this.eyeCurve > 0.5) {
      cx.globalAlpha = this.eyeCurve * 0.28;
      for (const [bx, sign] of [[lx-2, 1],[rx+2,-1]]) {
        cx.beginPath();
        cx.ellipse(bx, ey+8, 7, 3.5, sign*0.2, 0, Math.PI*2);
        cx.fillStyle = '#FDA4AF'; cx.fill();
      }
      cx.globalAlpha = 1;
    }
  }

  _drawEye(cx, x, y, isRight) {
    const r   = 5.5;
    const op  = this.eyeOpen;
    const cur = this.eyeCurve;

    if (op < 0.08) {
      // Closed — amber line
      cx.beginPath();
      cx.moveTo(x-r+1, y); cx.lineTo(x+r-1, y);
      cx.strokeStyle = 'rgba(245,158,11,0.8)';
      cx.lineWidth = 2; cx.lineCap = 'round'; cx.stroke();
      return;
    }

    if (cur > 0.6) {
      // Happy arc
      cx.beginPath();
      cx.arc(x, y+r*0.34, r, Math.PI+0.22, -0.22);
      cx.strokeStyle = '#D97706';
      cx.lineWidth = 2.2; cx.lineCap = 'round'; cx.stroke();
      cx.beginPath();
      cx.arc(Math.round(x+r*0.38), Math.round(y-r*0.08), 1.5, 0, Math.PI*2);
      cx.fillStyle = 'rgba(255,255,255,0.9)'; cx.fill();
    } else if (cur < -0.6) {
      // Sad arc
      cx.beginPath();
      cx.arc(x, y-r*0.34, r, 0.22, Math.PI-0.22);
      cx.strokeStyle = '#FF2D6B';
      cx.lineWidth = 2.2; cx.lineCap = 'round'; cx.stroke();
      if (!isRight) {
        cx.beginPath(); cx.arc(x-1, y+r+2.5, 2.2, 0, Math.PI*2);
        cx.fillStyle = 'rgba(147,197,253,0.75)'; cx.fill();
        cx.beginPath(); cx.arc(x-0.5, y+r+5.5, 1.4, 0, Math.PI*2);
        cx.fillStyle = 'rgba(147,197,253,0.5)'; cx.fill();
      }
    } else {
      // Normal oval
      const eyeH = r * Math.max(0.1, op);
      cx.beginPath();
      cx.ellipse(x, y, r, eyeH, 0, 0, Math.PI*2);
      cx.fillStyle = 'rgba(255,255,255,0.95)'; cx.fill();

      const px2 = x + this.pupilX * 2;
      const py2 = y + this.pupilY * 1.2;
      const pr  = r * 0.52 * op;
      cx.beginPath();
      cx.ellipse(px2, py2, pr, pr, 0, 0, Math.PI*2);
      cx.fillStyle = '#1C1917'; cx.fill();

      // Pixel shine — 2×2 square
      cx.beginPath();
      cx.rect(Math.round(px2+pr*0.36)-1, Math.round(py2-pr*0.38)-1, 2, 2);
      cx.fillStyle = 'rgba(255,255,255,0.95)'; cx.fill();

      // Upper lid shadow
      if (op > 0.4) {
        const ls = cx.createLinearGradient(x, y-eyeH, x, y-eyeH*0.3);
        ls.addColorStop(0, 'rgba(6,6,15,0.4)');
        ls.addColorStop(1, 'rgba(6,6,15,0)');
        cx.beginPath();
        cx.ellipse(x, y, r, eyeH, 0, 0, Math.PI*2);
        cx.fillStyle = ls; cx.fill();
      }
    }
  }

  _rrect(cx, x, y, w, h, r) {
    cx.moveTo(x+r, y);
    cx.lineTo(x+w-r, y);   cx.arcTo(x+w, y,   x+w, y+r,   r);
    cx.lineTo(x+w, y+h-r); cx.arcTo(x+w, y+h, x+w-r, y+h, r);
    cx.lineTo(x+r, y+h);   cx.arcTo(x, y+h,   x, y+h-r,   r);
    cx.lineTo(x, y+r);     cx.arcTo(x, y,     x+r, y,      r);
    cx.closePath();
  }

  _start() {
    let last = performance.now();
    const loop = (now) => {
      if (!this.alive) return;
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      this._tick(dt);
      this._draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() { this.alive = false; cancelAnimationFrame(this.raf); }
}

// ── DUE RING ──────────────────────────────────────────────────
class DueRing {
  constructor(canvas, count) {
    this.cv    = canvas;
    this.cx    = canvas.getContext('2d');
    this.count = count;
    this.W     = canvas.width;
    this.H     = canvas.height;
    this.t     = 0;
    this.alive = true;
    this._start();
  }

  _draw() {
    const { cx, W, H, t } = this;
    const ox = W / 2, oy = H / 2;
    const R  = W / 2 - 8;

    cx.clearRect(0, 0, W, H);

    // Outer halo
    const halo = cx.createRadialGradient(ox, oy, R - 2, ox, oy, R + 18);
    halo.addColorStop(0, 'rgba(255,45,107,.18)');
    halo.addColorStop(1, 'rgba(255,45,107,0)');
    cx.beginPath(); cx.arc(ox, oy, R + 18, 0, Math.PI * 2);
    cx.fillStyle = halo; cx.fill();

    // Track ring
    cx.beginPath(); cx.arc(ox, oy, R, 0, Math.PI * 2);
    cx.strokeStyle = 'rgba(255,45,107,.15)';
    cx.lineWidth = 10; cx.stroke();

    // Lit ring
    cx.shadowBlur = 14; cx.shadowColor = 'rgba(255,45,107,.4)';
    cx.beginPath(); cx.arc(ox, oy, R, 0, Math.PI * 2);
    cx.strokeStyle = '#FF2D6B';
    cx.lineWidth = 8; cx.stroke();
    cx.shadowBlur = 0;

    // Inner fill — white
    const iR = R - 7;
    cx.beginPath(); cx.arc(ox, oy, iR, 0, Math.PI * 2);
    cx.fillStyle = '#FFFFFF'; cx.fill();

    // Wave fill
    cx.save();
    cx.beginPath(); cx.arc(ox, oy, iR, 0, Math.PI * 2); cx.clip();
    const wY = oy + iR * 0.3;
    for (const [alpha, phaseOff, ampA, ampB] of [
      [.09, 0,   4.5, 2.5],
      [.06, 1.3, 3.5, 2.0],
    ]) {
      cx.beginPath();
      cx.moveTo(ox - iR, wY);
      for (let x = -iR; x <= iR; x += 2) {
        const y = wY
          + ampA * Math.sin(x / 24 + t * 2.2 + phaseOff)
          + ampB * Math.sin(x / 14 + t * 3.1 + phaseOff * 0.7);
        cx.lineTo(ox + x, y);
      }
      cx.lineTo(ox + iR, H); cx.lineTo(ox - iR, H); cx.closePath();
      cx.fillStyle = `rgba(255,45,107,${alpha})`; cx.fill();
    }
    cx.restore();

    // Count number
    cx.font = 'bold 52px "Plus Jakarta Sans",sans-serif';
    cx.fillStyle = '#111111';
    cx.textAlign = 'center'; cx.textBaseline = 'alphabetic';
    cx.fillText(this.count, ox, oy + 18);

    // Label
    cx.font = '800 10px "Plus Jakarta Sans",sans-serif';
    cx.fillStyle = '#FF2D6B';
    cx.textBaseline = 'top';
    cx.fillText('WORDS DUE', ox, oy + 25);
  }

  _start() {
    let last = performance.now();
    const loop = (now) => {
      if (!this.alive) return;
      this.t += Math.min((now - last) / 1000, 0.05);
      last = now;
      this._draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  destroy() { this.alive = false; cancelAnimationFrame(this.raf); }
}

// ── TOTAL RING (blue — all caught up) ─────────────────────────
class TotalRing {
  constructor(canvas, count) {
    this.cv = canvas; this.cx = canvas.getContext('2d');
    this.count = count; this.W = canvas.width; this.H = canvas.height;
    this.t = 0; this.alive = true; this._start();
  }
  _start() {
    let last = performance.now();
    const loop = (now) => {
      if (!this.alive) return;
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      this.t += dt; this._draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  _draw() {
    const { cx, W, H, t, count } = this;
    cx.clearRect(0, 0, W, H);
    const cx_ = W / 2, cy_ = H / 2, oR = 72, iR = 58, lW = 7;
    // outer halo
    cx.save(); cx.shadowBlur = 20; cx.shadowColor = 'rgba(0,220,130,.18)';
    cx.beginPath(); cx.arc(cx_, cy_, oR + 4, 0, Math.PI * 2);
    cx.strokeStyle = 'rgba(0,220,130,.08)'; cx.lineWidth = 10; cx.stroke(); cx.restore();
    // track
    cx.beginPath(); cx.arc(cx_, cy_, oR, 0, Math.PI * 2);
    cx.strokeStyle = 'rgba(0,220,130,.12)'; cx.lineWidth = lW; cx.stroke();
    // lit ring
    cx.save(); cx.shadowBlur = 14; cx.shadowColor = 'rgba(0,220,130,.35)';
    cx.beginPath(); cx.arc(cx_, cy_, oR, -Math.PI / 2, Math.PI * 1.5);
    cx.strokeStyle = '#00DC82'; cx.lineWidth = lW;
    cx.lineCap = 'round'; cx.stroke(); cx.restore();
    // inner fill + wave clip
    cx.save(); cx.beginPath(); cx.arc(cx_, cy_, iR, 0, Math.PI * 2); cx.clip();
    cx.fillStyle = '#FFFFFF'; cx.fillRect(cx_ - iR, cy_ - iR, iR * 2, iR * 2);
    const fill = 0.55, baseY = cy_ + iR * (1 - fill * 2);
    for (const [alpha, pOff, aA, aB] of [
      [.10, 0,   4.5, 2.5],
      [.07, 1.3, 3.5, 2.0],
    ]) {
      cx.beginPath(); cx.moveTo(cx_ - iR, cy_ + iR);
      for (let x = -iR; x <= iR; x += 2) {
        const y = baseY + aA * Math.sin(x / 24 + t * 2.0 + pOff)
                        + aB * Math.sin(x / 14 + t * 2.8 + pOff * 0.7);
        x === -iR ? cx.moveTo(cx_ + x, y) : cx.lineTo(cx_ + x, y);
      }
      cx.lineTo(cx_ + iR, cy_ + iR); cx.lineTo(cx_ - iR, cy_ + iR); cx.closePath();
      cx.fillStyle = `rgba(0,220,130,${alpha})`; cx.fill();
    }
    cx.restore();
    // count
    cx.textAlign = 'center';
    cx.font = 'bold 44px "Plus Jakarta Sans",system-ui'; cx.fillStyle = '#111111';
    cx.shadowBlur = 0;
    cx.fillText(count, cx_, cy_ + 14);
    cx.font = '800 10px "Plus Jakarta Sans",sans-serif'; cx.fillStyle = '#00DC82';
    cx.fillText('WORDS SIPPED', cx_, cy_ + 30);
  }
  destroy() { this.alive = false; cancelAnimationFrame(this.raf); }
}

// ── CARD TILT ─────────────────────────────────────────────────
function initCardTilt() {
  const card = document.getElementById('flip-card');
  const MAX  = 9;

  card.addEventListener('mousemove', e => {
    if (isFlipped || isAnimating) return;
    const r  = card.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width  - .5) * 2;
    const ny = ((e.clientY - r.top)  / r.height - .5) * 2;
    card.style.transform  = `rotateY(${nx * MAX}deg) rotateX(${-ny * MAX}deg)`;
    card.style.transition = 'transform .08s linear';
  });

  card.addEventListener('mouseleave', () => {
    card.style.transform  = '';
    card.style.transition = 'transform .5s ease-out';
  });
}

// ── CAT ANIMATORS ─────────────────────────────────────────────
let catIdle, catSleeping, catCelebrate;
function initCatAnimators() {
  catIdle      = new CatAnimator('cat-idle',      'idle');
  catSleeping  = new CatAnimator('cat-sleep',     'sleeping');
  catCelebrate = new CatAnimator('cat-celebrate', 'celebrating');
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadAll();
  bindNav();
  bindHeader();
  bindReviewButtons();
  bindWordsTab();
  bindDetailOverlay();
  bindSettingsTab();
  bindBrewStory();
  bindKeyboard();
  renderHeader();
  showReviewState();
  initCardTilt();
  if (typeof CatAnimator !== 'undefined') initCatAnimators();
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
  const saved = r['sip-settings'] ?? {};
  settings   = { ...settings, ...saved };

  // Migrate from old multi-provider format (one-time)
  if (!settings.apiUrl) {
    if (saved.deepseekKey) {
      settings.apiUrl   = 'https://api.deepseek.com';
      settings.apiKey   = saved.deepseekKey;
      settings.apiModel = 'deepseek-chat';
      await saveSettings();
    } else if (saved.localApiUrl) {
      settings.apiUrl   = saved.localApiUrl;
      settings.apiKey   = '';
      settings.apiModel = saved.localApiModel || '';
      await saveSettings();
    } else if (saved.geminiKey) {
      // Gemini native → prompt user to switch to OpenRouter
      settings.apiUrl = '';
      await saveSettings();
    }
  }

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

function getDue(lang = '') {
  const now = Date.now();
  return wordBook.filter(w =>
    (!w.nextReview || w.nextReview <= now) &&
    (!lang || (w.lang || 'en') === lang)
  );
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
  document.getElementById('streak-pill').classList.toggle('hidden', streak === 0);
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
  dueRing?.destroy();   dueRing   = null;
  totalRing?.destroy(); totalRing = null;
  hide('state-onboard'); hide('state-prestart');
  hide('state-caught-up'); hide('state-session'); hide('state-done');

  if (wordBook.length === 0) {
    show('state-onboard'); return;
  }
  const allDue = getDue('');
  if (allDue.length === 0) {
    show('state-caught-up');
    totalRing = new TotalRing(document.getElementById('ring-caught'), wordBook.length);
    return;
  }

  // Build language picker (only when 2+ languages have due words)
  const langCounts = {};
  for (const w of allDue) { const l = w.lang || 'en'; langCounts[l] = (langCounts[l] || 0) + 1; }
  const dueLangs = Object.keys(langCounts);
  const picker   = document.getElementById('lang-picker');

  if (dueLangs.length > 1) {
    // Validate sessionLang still has due words; fall back to all
    if (sessionLang && !langCounts[sessionLang]) sessionLang = '';
    picker.innerHTML = [
      `<button class="lang-pill${sessionLang === '' ? ' active' : ''}" data-lang="">All (${allDue.length})</button>`,
      ...dueLangs.sort().map(l =>
        `<button class="lang-pill${sessionLang === l ? ' active' : ''}" data-lang="${l}">${LANG_NAMES[l] || l.toUpperCase()} (${langCounts[l]})</button>`
      )
    ].join('');
    picker.classList.remove('hidden');
  } else {
    sessionLang = '';
    picker.innerHTML = '';
    picker.classList.add('hidden');
  }

  show('state-prestart');
  dueRing = new DueRing(document.getElementById('ring-prestart'), getDue(sessionLang).length);
}

function bindReviewButtons() {
  document.getElementById('start-btn').addEventListener('click', startSession);
  document.getElementById('done-again-btn').addEventListener('click', () => {
    sessionLang = '';
    isPractice  = false;
    showReviewState();
  });

  document.getElementById('rebrew-btn').addEventListener('click', () => {
    startWeakSession();
  });

  document.getElementById('lang-picker').addEventListener('click', (e) => {
    const pill = e.target.closest('.lang-pill');
    if (!pill) return;
    sessionLang = pill.dataset.lang;
    dueRing?.destroy();
    dueRing = new DueRing(document.getElementById('ring-prestart'), getDue(sessionLang).length);
    document.querySelectorAll('#lang-picker .lang-pill').forEach(p =>
      p.classList.toggle('active', p.dataset.lang === sessionLang)
    );
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
    if (card) speakWord(card.word, card.audioUrl, card.lang);
  });
}

function startSession() {
  isPractice     = false;
  sessionWeakIds = new Set();
  document.getElementById('practice-banner').classList.add('hidden');
  dueRing?.destroy();   dueRing   = null;
  totalRing?.destroy(); totalRing = null;
  const due = getDue(sessionLang);
  sessionQueue  = due.slice(0, 20);
  sessionIdx    = 0;
  sessionDone   = 0;
  sessionGrades = { 0: 0, 1: 0, 3: 0, 5: 0 };

  updateProgress();
  hide('state-prestart');
  show('state-session');
  showSessionCard();
}

function startWeakSession() {
  const weakWords = wordBook.filter(w => sessionWeakIds.has(w.id));
  if (weakWords.length === 0) return;
  isPractice     = true;
  sessionWeakIds = new Set();
  dueRing?.destroy();   dueRing   = null;
  totalRing?.destroy(); totalRing = null;
  sessionQueue  = weakWords;
  sessionIdx    = 0;
  sessionDone   = 0;
  sessionGrades = { 0: 0, 1: 0, 3: 0, 5: 0 };
  document.getElementById('practice-banner').classList.remove('hidden');
  updateProgress();
  hide('state-done');
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
  const wordEl = document.getElementById('flip-word');
  wordEl.textContent = card.word;
  wordEl.className = 'flip-word' + (card.word.length >= 13 ? ' long' : card.word.length >= 9 ? ' mid' : '');
  document.getElementById('flip-pos-front').textContent = card.pos ?? '';

  // Back
  document.getElementById('flip-word-back').textContent  = card.word;
  document.getElementById('flip-phonetic').textContent   = card.phonetic ?? '';
  document.getElementById('flip-pos-back').textContent   = card.pos ?? '';
  document.getElementById('flip-definition').textContent = card.definition ?? '';

  const exEl = document.getElementById('flip-example');
  exEl.textContent = card.aiExample
    ? `"${card.aiExample}"`
    : card.example ? `"${card.example}"` : '';

  const synEl = document.getElementById('flip-synonyms');
  synEl.innerHTML = (card.synonyms ?? []).slice(0,4)
    .map(s => `<span class="syn-chip">${esc(s)}</span>`).join('');

  const antEl = document.getElementById('flip-antonyms');
  const antonyms = card.antonyms ?? [];
  antEl.innerHTML = antonyms.length
    ? antonyms.map(a => `<span class="syn-chip antonym-chip">${esc(a)}</span>`).join('')
    : '';
  antEl.classList.toggle('hidden', antonyms.length === 0);

  const ctxEl = document.getElementById('flip-context-sentence');
  if (card.contextSentence) {
    ctxEl.textContent = `"${card.contextSentence}"`;
    ctxEl.classList.remove('hidden');
  } else {
    ctxEl.classList.add('hidden');
  }

  const quizEl = document.getElementById('flip-quiz');
  if (card.contextSentence) {
    const blanked = card.contextSentence.replace(
      new RegExp('\\b' + escapeRegex(card.word) + '\\w*', 'gi'), '______'
    );
    quizEl.textContent = `"${blanked}"`;
    quizEl.classList.remove('hidden');
  } else {
    quizEl.classList.add('hidden');
  }

  const playBtn = document.getElementById('flip-play-btn');
  playBtn.style.display = 'flex';

  updateProgress();

  // Fetch and cache AI example if missing
  if (!card.aiExample) {
    fetchAndCacheAiExample(card).then(example => {
      if (!example) return;
      if (sessionQueue[sessionIdx]?.id !== card.id) return;
      document.getElementById('flip-example').textContent = `"${example}"`;
    });
  }
}

function flipCard() {
  isFlipped = true;
  document.getElementById('flip-inner').classList.add('flipped');
  setTimeout(() => document.getElementById('grade-row').classList.remove('hidden'), 300);
  const card = sessionQueue[sessionIdx];
  if (card) speakWord(card.word, card.audioUrl, card.lang);
}

const LANG_BCP47 = { en: 'en-US', es: 'es-ES', fi: 'fi-FI', sv: 'sv-SE' };

function speakWord(word, audioUrl, lang = 'en') {
  if (audioUrl) {
    new Audio(audioUrl).play().catch(() => {});
    return;
  }
  if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
    const utt  = new SpeechSynthesisUtterance(word);
    utt.lang   = LANG_BCP47[lang] || 'en-US';
    utt.rate   = 0.88;
    utt.pitch  = 1;
    speechSynthesis.speak(utt);
  }
}

function gradeCard(grade) {
  if (isAnimating) return;
  isAnimating = true;

  const card    = sessionQueue[sessionIdx];
  sessionGrades[grade] = (sessionGrades[grade] || 0) + 1;
  if (!isPractice && grade <= 1) sessionWeakIds.add(card.id);
  if (grade === 0) sessionQueue.push({ ...card });
  if (!isPractice) {
    const updated = sm2(card, grade);
    const idx     = wordBook.findIndex(w => w.id === card.id);
    if (idx >= 0) wordBook[idx] = updated;
    saveWords();
  }

  sessionDone++;
  sessionIdx++;

  const flipCardEl = document.getElementById('flip-card');
  const flyMap     = { 0:'flyLeft', 1:'flyDown', 3:'flyUp', 5:'flyRight' };
  flipCardEl.style.transition = 'none';
  flipCardEl.style.animation  = `${flyMap[grade] ?? 'flyUp'} .32s ease-in forwards`;

  setTimeout(() => {
    flipCardEl.style.animation = '';
    flipCardEl.style.transform = '';
    if (sessionIdx >= sessionQueue.length) {
      isAnimating = false;
      endSession();
    } else {
      showSessionCard();
      flipCardEl.style.animation = 'cardIn .28s cubic-bezier(.2,0,.2,1)';
      setTimeout(() => {
        flipCardEl.style.animation = '';
        isAnimating = false;
      }, 280);
    }
  }, 320);
}

function updateProgress() {
  const total = sessionQueue.length;
  const done  = sessionIdx;
  const pct   = total > 0 ? (done / total) * 100 : 0;
  document.getElementById('progress-fill').style.width  = `${pct}%`;
  document.getElementById('progress-label').textContent = `${done} / ${total}`;
}

function endSession() {
  if (!isPractice) updateStreak();
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
  hide('state-session');
  document.getElementById('done-title').textContent  = isPractice ? 'Practice complete!' : 'Brew complete!';
  document.getElementById('done-count').textContent  = sessionDone;
  document.getElementById('done-streak').textContent = streak;

  // Grade breakdown
  const GRADES = [
    { g: 0, label: 'Again', emoji: '😿', cls: 'g-again' },
    { g: 1, label: 'Hard',  emoji: '😅', cls: 'g-hard'  },
    { g: 3, label: 'Good',  emoji: '😸', cls: 'g-good'  },
    { g: 5, label: 'Easy',  emoji: '🚀', cls: 'g-easy'  },
  ];
  const total   = Object.values(sessionGrades).reduce((a, b) => a + b, 0);
  const correct = (sessionGrades[3] || 0) + (sessionGrades[5] || 0);
  const pct     = total > 0 ? Math.round(correct / total * 100) : 0;
  document.getElementById('grade-breakdown').innerHTML =
    `<div class="gbr-chips">${GRADES.map(({ g, label, emoji, cls }) =>
      `<div class="gbr-chip ${cls}"><span class="gbr-count">${sessionGrades[g] || 0}</span><em>${label} ${emoji}</em></div>`
    ).join('')}</div>` +
    `<div class="gbr-accuracy">${pct}% correct</div>`;

  const rebrewBtn = document.getElementById('rebrew-btn');
  const weakCount = sessionWeakIds.size;
  if (!isPractice && weakCount > 0) {
    rebrewBtn.textContent = `Re-brew ${weakCount} weak word${weakCount !== 1 ? 's' : ''} ⚡`;
    rebrewBtn.classList.remove('hidden');
  } else {
    rebrewBtn.classList.add('hidden');
  }

  show('state-done');
  confettiPop(document.getElementById('state-done'));
  if (!isPractice) loadBrewStory('brew-story-done');
}

async function updateStreak() {
  const now     = Date.now();
  const oneDay  = 86_400_000;
  const today   = Math.floor(now / oneDay);
  const lastDay = Math.floor(lastReview / oneDay);
  const gap     = today - lastDay;

  if (gap === 1) {
    streak++;
  } else if (gap === 2) {
    const fr = await chrome.storage.local.get('sip-freeze');
    const lastFreeze = fr['sip-freeze'] ?? 0;
    if (Math.floor((now - lastFreeze) / oneDay) >= 30) {
      streak++;
      await chrome.storage.local.set({ 'sip-freeze': now });
      showToast('Streak saved by a freeze! ❄️', 3000);
    } else {
      streak = 1;
    }
  } else if (gap > 2) {
    streak = 1;
  }
  // gap === 0: same-day review, no increment

  lastReview = now;
  await chrome.storage.local.set({ 'sip-streak': streak, 'sip-last-review': lastReview });
  document.getElementById('streak-num').textContent = streak;

  const pill = document.getElementById('streak-pill');
  pill.style.animation = 'none';
  pill.offsetHeight;
  pill.style.animation = 'streakBounce .6s cubic-bezier(.2,.8,.3,1.2)';
  setTimeout(() => { pill.style.animation = ''; }, 600);
}

// ── FILTER CHIPS ──────────────────────────────────────────────
function renderFilterChips() {
  const row = document.getElementById('filter-chips-row');
  if (!row) return;

  const domainCounts = {};
  for (const w of wordBook) {
    if (!w.sourceUrl) continue;
    try {
      const host = new URL(w.sourceUrl).hostname.replace('www.', '');
      domainCounts[host] = (domainCounts[host] || 0) + 1;
    } catch (_) {}
  }
  const topDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d]) => d);

  const makeChip = (label, ft, fv, active, extra = '') =>
    `<button class="filter-chip${active ? ' active' : ''}${extra}" data-ft="${ft}" data-fv="${esc(fv)}">${label}</button>`;

  const timeGroup = [
    makeChip('Today',     'time', 'today', activeTimeFilter === 'today'),
    makeChip('This Week', 'time', 'week',  activeTimeFilter === 'week'),
    makeChip('Older',     'time', 'older', activeTimeFilter === 'older'),
  ].join('');

  const posGroup = [
    makeChip('Noun', 'pos', 'noun', activePosFilter === 'noun'),
    makeChip('Verb', 'pos', 'verb', activePosFilter === 'verb'),
    makeChip('Adj',  'pos', 'adj',  activePosFilter === 'adj'),
  ].join('');

  const domainGroup = topDomains
    .map(d => makeChip(d, 'domain', d, activeDomainFilter === d, ' filter-chip--domain'))
    .join('');

  const langCounts = {};
  for (const w of wordBook) { const l = w.lang || 'en'; langCounts[l] = (langCounts[l] || 0) + 1; }
  const langs      = Object.keys(langCounts).filter(l => langCounts[l] > 0);
  const langGroup  = langs.length > 1
    ? langs.sort().map(l => makeChip(LANG_LABELS[l] || l.toUpperCase(), 'lang', l, activeLangFilter === l, ` filter-chip--lang filter-chip--lang-${l}`)).join('')
    : '';

  row.innerHTML =
    `<div class="filter-group">${timeGroup}</div>` +
    `<div class="filter-group">${posGroup}</div>` +
    (langGroup ? `<div class="filter-group">${langGroup}</div>` : '') +
    (domainGroup ? `<div class="filter-group">${domainGroup}</div>` : '');
}

// ── WORD BOOK ─────────────────────────────────────────────────
function renderWordBook() {
  renderFilterChips();

  const query = document.getElementById('search-input').value.toLowerCase();
  const sort  = document.getElementById('sort-select').value;
  const now   = Date.now();

  const statsRow = document.getElementById('words-stats-row');
  if (statsRow && wordBook.length > 0) {
    const total   = wordBook.length;
    const due     = wordBook.filter(w => !w.nextReview || w.nextReview <= now).length;
    const mature  = wordBook.filter(w => (w.interval ?? 0) > 21).length;
    const newW    = wordBook.filter(w => (w.repetitions ?? 0) === 0).length;
    statsRow.innerHTML = `
      <span class="ws-chip ws-total">${total} total</span>
      <span class="ws-chip ws-due">${due} due</span>
      <span class="ws-chip ws-mature">${mature} mature</span>
      <span class="ws-chip ws-new">${newW} new</span>`;
    statsRow.classList.remove('hidden');
  } else if (statsRow) {
    statsRow.classList.add('hidden');
  }

  let words = wordBook.filter(w =>
    !query || w.word.toLowerCase().includes(query) || (w.definition ?? '').toLowerCase().includes(query)
  );

  if (sort === 'az')   words.sort((a,b) => a.word.localeCompare(b.word));
  if (sort === 'due')  words.sort((a,b) => (a.nextReview ?? 0) - (b.nextReview ?? 0));
  if (sort === 'recent') words.sort((a,b) => b.addedAt - a.addedAt);

  // Apply filter chips
  if (activeTimeFilter) {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const weekAgo  = now - 7 * 86_400_000;
    if (activeTimeFilter === 'today') words = words.filter(w => w.addedAt >= midnight.getTime());
    if (activeTimeFilter === 'week')  words = words.filter(w => w.addedAt >= weekAgo && w.addedAt < midnight.getTime());
    if (activeTimeFilter === 'older') words = words.filter(w => w.addedAt < weekAgo);
  }
  if (activePosFilter) {
    words = words.filter(w => {
      const p = (w.pos ?? '').toLowerCase();
      if (activePosFilter === 'noun') return p.includes('noun');
      if (activePosFilter === 'verb') return p.includes('verb');
      if (activePosFilter === 'adj')  return p.includes('adj') || p.includes('adv');
      return true;
    });
  }
  if (activeDomainFilter) {
    words = words.filter(w => {
      try { return new URL(w.sourceUrl).hostname.replace('www.', '') === activeDomainFilter; }
      catch (_) { return false; }
    });
  }
  if (activeLangFilter) {
    words = words.filter(w => (w.lang || 'en') === activeLangFilter);
  }

  const list  = document.getElementById('word-list');
  const empty = document.getElementById('word-empty');

  if (words.length === 0) {
    list.innerHTML = ''; show('word-empty'); return;
  }
  hide('word-empty');

  list.innerHTML = words.map(w => {
    const due      = !w.nextReview || w.nextReview <= now;
    const soon     = !due && w.nextReview - now < 3 * 86_400_000;
    const daysLeft = due ? 0 : Math.ceil((w.nextReview - now) / 86_400_000);
    const status   = due ? 'due' : soon ? 'soon' : 'ok';
    const badge    = due  ? '<span class="word-item-badge badge-due">DUE</span>'
                  : soon  ? `<span class="word-item-badge badge-soon">${daysLeft}d</span>`
                          : `<span class="word-item-badge badge-ok">${daysLeft}d</span>`;
    const posHtml  = w.pos ? `<span class="word-item-pos">${esc(w.pos)}</span>` : '';
    const interval = w.interval ? `${w.interval}d interval` : 'new';
    const defText  = (w.definition ?? '').slice(0, 90);
    const wLang    = w.lang || 'en';
    const langHtml = wLang !== 'en'
      ? `<span class="word-item-lang word-item-lang--${wLang}">${LANG_LABELS[wLang] || wLang.toUpperCase()}</span>`
      : '';
    return `
      <div class="word-item word-item--${status}" data-id="${w.id}">
        <div class="word-item-head">
          <span class="word-item-word">${esc(w.word)}</span>
          ${langHtml}${posHtml}
        </div>
        <div class="word-item-body">
          <div class="word-item-def">${esc(defText)}</div>
        </div>
        <div class="word-item-foot">
          ${badge}
          <span class="word-item-interval">${interval}</span>
          <span class="word-item-chevron">›</span>
        </div>
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
  document.getElementById('filter-chips-row').addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    const ft = chip.dataset.ft;
    const fv = chip.dataset.fv;
    if (ft === 'time')   activeTimeFilter   = activeTimeFilter   === fv ? '' : fv;
    if (ft === 'pos')    activePosFilter    = activePosFilter    === fv ? '' : fv;
    if (ft === 'domain') activeDomainFilter = activeDomainFilter === fv ? '' : fv;
    if (ft === 'lang')   activeLangFilter   = activeLangFilter   === fv ? '' : fv;
    renderWordBook();
  });
}

function openWordDetail(word) {
  detailWord = word;
  const $ = id => document.getElementById(id);

  $('detail-word').textContent      = word.word;
  $('detail-phonetic').textContent  = word.phonetic ?? '';
  $('detail-pos').textContent       = word.pos ?? '';
  $('detail-definition').textContent = word.definition ?? '';

  const exEl       = $('detail-example');
  const aiLoadEl   = $('detail-ai-loading');
  const exampleTxt = word.aiExample || word.example;
  if (exampleTxt) {
    exEl.textContent = `"${exampleTxt}"`;
    exEl.classList.remove('hidden');
    aiLoadEl.classList.add('hidden');
  } else {
    exEl.textContent = '';
    exEl.classList.add('hidden');
    aiLoadEl.classList.add('hidden');
  }

  $('detail-synonyms').innerHTML = (word.synonyms ?? []).slice(0, 5)
    .map(s => `<span class="syn-chip">${esc(s)}</span>`).join('');

  const antonyms = word.antonyms ?? [];
  const antEl2 = $('detail-antonyms');
  if (antEl2) {
    antEl2.innerHTML = antonyms.map(a => `<span class="syn-chip antonym-chip">${esc(a)}</span>`).join('');
    antEl2.classList.toggle('hidden', antonyms.length === 0);
  }

  const ctxEl2 = $('detail-context-sentence');
  if (ctxEl2) {
    if (word.contextSentence) {
      ctxEl2.textContent = `"${word.contextSentence}"`;
      ctxEl2.classList.remove('hidden');
    } else {
      ctxEl2.classList.add('hidden');
    }
  }

  $('detail-play-btn').style.display = 'flex';
  // Auto-play pronunciation when detail panel opens
  speakWord(word.word, word.audioUrl, word.lang);

  const now        = Date.now();
  const overdue    = !word.nextReview || word.nextReview <= now;
  const daysUntil  = overdue ? 0 : Math.ceil((word.nextReview - now) / 86_400_000);
  $('detail-meta-badge').textContent = overdue ? '⏰ Due for review' : `Next in ${daysUntil}d`;

  $('detail-stats-row').innerHTML = `
    <div class="detail-stat"><span>${word.repetitions ?? 0}</span><em>reviews</em></div>
    <div class="detail-stat"><span>${word.interval ?? 0}d</span><em>interval</em></div>
    <div class="detail-stat"><span>${overdue ? 'now' : daysUntil + 'd'}</span><em>next</em></div>`;

  $('detail-review-btn').classList.toggle('hidden', !overdue);
  $('word-detail-overlay').classList.remove('hidden');

  if (!word.aiExample) {
    aiLoadEl.classList.remove('hidden');
    fetchAndCacheAiExample(word).then(example => {
      if (!example) { aiLoadEl.classList.add('hidden'); return; }
      if (detailWord?.id !== word.id) return;
      exEl.textContent = `"${example}"`;
      exEl.classList.remove('hidden');
      aiLoadEl.classList.add('hidden');
    });
  }

  // AI features: memory hook + word roots (only when AI is configured)
  const hookEl  = $('detail-memory-hook');
  const rootsEl = $('detail-word-roots');
  hookEl.classList.add('hidden');
  rootsEl.classList.add('hidden');

  if (settings.apiUrl) {
    if (word.memoryHook) {
      $('detail-memory-hook-text').textContent = word.memoryHook;
      hookEl.classList.remove('hidden');
    } else {
      fetchAndCacheMemoryHook(word).then(hook => {
        if (!hook || detailWord?.id !== word.id) return;
        $('detail-memory-hook-text').textContent = hook;
        hookEl.classList.remove('hidden');
      });
    }

    if (word.wordRoots?.length) {
      renderWordRoots($('detail-roots-chips'), word.wordRoots);
      rootsEl.classList.remove('hidden');
    } else {
      fetchAndCacheWordRoots(word).then(roots => {
        if (!roots?.length || detailWord?.id !== word.id) return;
        renderWordRoots($('detail-roots-chips'), roots);
        rootsEl.classList.remove('hidden');
      });
    }
  }
}

function closeWordDetail() {
  const overlay = document.getElementById('word-detail-overlay');
  if (overlay.classList.contains('hidden') || overlay.classList.contains('closing')) return;
  clearTimeout(deleteConfirmTimer);
  const deleteBtn = document.getElementById('detail-delete-btn');
  deleteBtn.dataset.confirm = '';
  deleteBtn.textContent = 'Remove word';
  overlay.classList.add('closing');
  setTimeout(() => {
    overlay.classList.remove('closing');
    overlay.classList.add('hidden');
    detailWord = null;
  }, 220);
}

function bindDetailOverlay() {
  document.getElementById('detail-close-btn').addEventListener('click', closeWordDetail);
  document.getElementById('word-detail-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeWordDetail();
  });
  document.getElementById('detail-play-btn').addEventListener('click', () => {
    if (detailWord) speakWord(detailWord.word, detailWord.audioUrl, detailWord.lang);
  });
  document.getElementById('detail-review-btn').addEventListener('click', () => {
    closeWordDetail();
    switchTab('review');
    showReviewState();
    if (getDue().length > 0) startSession();
  });
  document.getElementById('detail-delete-btn').addEventListener('click', async () => {
    if (!detailWord) return;
    const btn = document.getElementById('detail-delete-btn');
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = 'Tap again to remove';
      clearTimeout(deleteConfirmTimer);
      deleteConfirmTimer = setTimeout(() => {
        btn.dataset.confirm = '';
        btn.textContent = 'Remove word';
      }, 2000);
      return;
    }
    clearTimeout(deleteConfirmTimer);
    btn.dataset.confirm = '';
    btn.textContent = 'Remove word';
    const word = detailWord;
    wordBook = wordBook.filter(w => w.id !== word.id);
    await saveWords();
    chrome.runtime.sendMessage({ type: 'UPDATE_BADGE' }).catch(() => {});
    closeWordDetail();
    renderWordBook();
    showToast(`"${word.word}" removed`);
    if (currentTab === 'review') showReviewState();
  });
}

async function fetchAndCacheAiExample(word) {
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'AI_EXAMPLE',
      word: word.word,
      pos: word.pos,
      definition: word.definition,
    });
    if (!r?.example) return null;
    const idx = wordBook.findIndex(w => w.id === word.id);
    if (idx >= 0) {
      wordBook[idx].aiExample = r.example;
      await saveWords();
    }
    return r.example;
  } catch (e) {
    return null;
  }
}

async function fetchAndCacheMemoryHook(word) {
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'MEMORY_HOOK',
      word: word.word,
      pos: word.pos,
      definition: word.definition,
      lang: word.lang || 'en',
    });
    if (!r?.hook) return null;
    const idx = wordBook.findIndex(w => w.id === word.id);
    if (idx >= 0) { wordBook[idx].memoryHook = r.hook; await saveWords(); }
    return r.hook;
  } catch (_) { return null; }
}

async function fetchAndCacheWordRoots(word) {
  try {
    const r = await chrome.runtime.sendMessage({
      type: 'WORD_ROOTS',
      word: word.word,
      definition: word.definition,
    });
    if (!r?.roots?.length) return null;
    const idx = wordBook.findIndex(w => w.id === word.id);
    if (idx >= 0) { wordBook[idx].wordRoots = r.roots; await saveWords(); }
    return r.roots;
  } catch (_) { return null; }
}

function renderWordRoots(container, roots) {
  container.innerHTML = roots.map(r =>
    `<span class="root-chip"><strong>${esc(r.part)}</strong><em>${esc(r.origin)} · ${esc(r.meaning)}</em></span>`
  ).join('');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── AI PROVIDER HELPERS ───────────────────────────────────────
function detectProviderName(url) {
  if (!url) return '';
  const u = url.toLowerCase();
  if (u.includes('deepseek'))   return 'DeepSeek';
  if (u.includes('openrouter')) return 'OpenRouter';
  if (u.includes('openai'))     return 'OpenAI';
  if (u.includes('groq'))       return 'Groq';
  if (u.includes('together'))   return 'Together AI';
  if (u.includes('anthropic'))  return 'Anthropic';
  if (u.includes('localhost') || u.includes('127.0.0.1')) return 'Local Model';
  return 'Custom';
}

function setAiStatus(state, detail = '') {
  const el = document.getElementById('ai-status');
  if (!el) return;
  el.className = `ai-status ai-status--${state}`;
  el.textContent = {
    idle:    'Not configured — add a URL to enable AI examples',
    testing: 'Connecting…',
    ok:      `✓ ${detail}`,
    error:   `✗ ${detail}`,
  }[state] ?? detail;
}

let _aiTestTimer = null;
async function runAiTest(url, key, model, autoFill = false) {
  setAiStatus('testing');
  const r = await chrome.runtime.sendMessage({ type: 'TEST_AI', url, key, model });
  if (r?.ok) {
    const name = detectProviderName(url);
    const mod  = r.modelUsed || model || '';
    setAiStatus('ok', `${name}${mod ? ' · ' + mod : ''}`);
    if (autoFill && r.modelUsed) {
      const el = document.getElementById('api-model-input');
      if (el && !el.value.trim()) el.value = r.modelUsed;
    }
  } else {
    setAiStatus('error', r?.error || 'Connection failed');
  }
}

// ── SETTINGS ─────────────────────────────────────────────────
function renderSettings() {
  document.getElementById('reminder-toggle').checked = settings.reminderEnabled;
  document.getElementById('reminder-time').value     = settings.reminderTime ?? '09:00';
  document.getElementById('music-toggle').checked    = settings.musicEnabled;

  const vol = Math.round((settings.volume ?? 0.4) * 100);
  document.getElementById('volume-slider').value = vol;
  document.getElementById('volume-val').textContent = `${vol}%`;

  document.getElementById('stream-url-input').value = settings.streamUrl || '';

  document.getElementById('api-url-input').value   = settings.apiUrl   || '';
  document.getElementById('api-key-input').value   = settings.apiKey   || '';
  document.getElementById('api-model-input').value = settings.apiModel || '';

  if (settings.apiUrl) {
    runAiTest(settings.apiUrl, settings.apiKey || '', settings.apiModel || '');
  } else {
    setAiStatus('idle');
  }
}

function bindSettingsTab() {
  document.getElementById('reminder-toggle').addEventListener('change', async (e) => {
    settings.reminderEnabled = e.target.checked;
    await saveSettings();
    if (settings.reminderEnabled) {
      await chrome.notifications.requestPermission?.();
    }
    chrome.runtime.sendMessage({ type: 'RESCHEDULE_REMINDER' }).catch(() => {});
  });

  document.getElementById('reminder-time').addEventListener('change', async (e) => {
    const t = e.target.value;
    if (!/^\d{2}:\d{2}$/.test(t)) return;
    settings.reminderTime = t;
    await saveSettings();
    chrome.runtime.sendMessage({ type: 'RESCHEDULE_REMINDER' }).catch(() => {});
  });

  document.getElementById('music-toggle').addEventListener('change', async (e) => {
    settings.musicEnabled = e.target.checked;
    await saveSettings();
    renderHeader();
    settings.musicEnabled ? startMusic() : stopMusic();
  });

  document.getElementById('volume-slider').addEventListener('input', async (e) => {
    const pct = parseInt(e.target.value);
    document.getElementById('volume-val').textContent = `${pct}%`;
    settings.volume = pct / 100;
    await saveSettings();
    chrome.runtime.sendMessage({ type: 'MUSIC_VOLUME', volume: settings.volume }).catch(() => {});
  });

  document.getElementById('save-stream-btn').addEventListener('click', async () => {
    const url = document.getElementById('stream-url-input').value.trim();
    if (!url) return;
    settings.streamUrl = url;
    await saveSettings();
    showToast('Stream URL saved ✓');
    if (settings.musicEnabled) {
      chrome.runtime.sendMessage({ type: 'MUSIC_STREAM_STOP' }).catch(() => {});
      setTimeout(() => chrome.runtime.sendMessage({ type: 'MUSIC_STREAM_START', url }), 300);
    }
  });


  // ── AI Provider section ──────────────────────────────────────
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('api-url-input').value   = btn.dataset.url   ?? '';
      document.getElementById('api-model-input').value = btn.dataset.model ?? '';
      // Auto-test immediately after preset
      const url   = btn.dataset.url ?? '';
      const key   = document.getElementById('api-key-input').value.trim();
      const model = btn.dataset.model ?? '';
      if (url) runAiTest(url, key, model, true);
    });
  });

  // Auto-test on URL / key blur (debounced)
  ['api-url-input', 'api-key-input'].forEach(id => {
    document.getElementById(id).addEventListener('blur', () => {
      clearTimeout(_aiTestTimer);
      const url = document.getElementById('api-url-input').value.trim();
      if (!url) { setAiStatus('idle'); return; }
      _aiTestTimer = setTimeout(() => {
        runAiTest(
          url,
          document.getElementById('api-key-input').value.trim(),
          document.getElementById('api-model-input').value.trim(),
          true,
        );
      }, 400);
    });
  });

  document.getElementById('save-ai-btn').addEventListener('click', async () => {
    settings.apiUrl   = document.getElementById('api-url-input').value.trim().replace(/\/$/, '');
    settings.apiKey   = document.getElementById('api-key-input').value.trim();
    settings.apiModel = document.getElementById('api-model-input').value.trim();
    await saveSettings();
    showToast('AI settings saved ✓');
    if (settings.apiUrl) runAiTest(settings.apiUrl, settings.apiKey, settings.apiModel, true);
    else setAiStatus('idle');
  });

  document.getElementById('test-ai-btn').addEventListener('click', () => {
    const url   = document.getElementById('api-url-input').value.trim();
    const key   = document.getElementById('api-key-input').value.trim();
    const model = document.getElementById('api-model-input').value.trim();
    if (!url) { setAiStatus('idle'); return; }
    runAiTest(url, key, model, true);
  });

  document.getElementById('export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(wordBook, null, 2)], { type:'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url; a.download = 'sip-words.json'; a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById('anki-export-btn').addEventListener('click', () => {
    const rows = wordBook.map(w => {
      const front = esc(w.word);
      const back  = [
        w.definition ? esc(w.definition) : '',
        w.phonetic   ? `[${esc(w.phonetic)}]` : '',
        w.pos        ? `(${esc(w.pos)})` : '',
        (w.aiExample || w.example) ? `<i>${esc(w.aiExample || w.example)}</i>` : '',
      ].filter(Boolean).join('<br>');
      const tags = 'sip-vocabulary';
      return `${front}\t${back}\t${tags}`;
    });
    const tsv  = rows.join('\n');
    const blob = new Blob([tsv], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url; a.download = 'sip-anki.txt'; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${rows.length} cards for Anki ✓`);
  });

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';
    try {
      const imported = JSON.parse(await file.text());
      if (!Array.isArray(imported)) { showToast('Invalid file — expected a JSON array'); return; }
      const existing = new Set(wordBook.map(w => w.word.toLowerCase()));
      const newWords = imported.filter(w => w.word && w.definition && !existing.has(w.word.toLowerCase()));
      if (newWords.length === 0) { showToast('No new words to import'); return; }
      wordBook.push(...newWords);
      await saveWords();
      renderWordBook();
      if (currentTab === 'review') showReviewState();
      showToast(`Imported ${newWords.length} word${newWords.length !== 1 ? 's' : ''} ✓`);
    } catch (_) {
      showToast('Could not read file');
    }
  });

  document.getElementById('clear-btn').addEventListener('click', async () => {
    const btn = document.getElementById('clear-btn');
    if (btn.dataset.confirm !== '1') {
      btn.dataset.confirm = '1';
      btn.textContent = 'Tap again to confirm';
      clearTimeout(clearConfirmTimer);
      clearConfirmTimer = setTimeout(() => {
        btn.dataset.confirm = '';
        btn.textContent = 'Clear all words';
      }, 2000);
      return;
    }
    clearTimeout(clearConfirmTimer);
    btn.dataset.confirm = '';
    btn.textContent = 'Clear all words';
    wordBook = [];
    await saveWords();
    showReviewState();
    renderWordBook();
    showToast('Word book cleared');
  });

}

function startMusic() {
  if (!settings.musicEnabled || !settings.streamUrl) return;
  chrome.runtime.sendMessage({ type: 'MUSIC_STREAM_START', url: settings.streamUrl });
}

function stopMusic() {
  chrome.runtime.sendMessage({ type: 'MUSIC_STREAM_STOP' }).catch(() => {});
}

// ── BREW STORY ────────────────────────────────────────────────
async function loadBrewStory(cardId, regenerate = false) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.add('hidden');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'BREW_STORY', regenerate });
    if (!r?.story) return;
    const bodyEl = card.querySelector('.brew-story-body');
    if (bodyEl) {
      bodyEl.innerHTML = r.story
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    }
    card.classList.remove('hidden');
  } catch (_) {}
}

function bindBrewStory() {
  document.getElementById('brew-done-copy-btn')?.addEventListener('click', () => {
    const text = document.getElementById('brew-story-done')?.querySelector('.brew-story-body')?.textContent;
    if (text) navigator.clipboard.writeText(text).then(() => showToast('Story copied ✓'));
  });
  document.getElementById('brew-done-regen-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('brew-done-regen-btn');
    btn.textContent = '…';
    btn.disabled = true;
    await loadBrewStory('brew-story-done', true);
    btn.textContent = '✦ New story';
    btn.disabled = false;
  });
}

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

function confettiPop(container) {
  const colors = ['#FFE033','#FF2D6B','#00DC82','#0099FF','#8B5CF6','#FF6B1A'];
  for (let i = 0; i < 22; i++) {
    const dot   = document.createElement('span');
    dot.className = 'confetti-dot';
    const angle = (i / 22) * 360 + Math.random() * 16;
    const dist  = 30 + Math.random() * 70;
    const dx    = (Math.cos(angle * Math.PI / 180) * dist).toFixed(1);
    const dy    = (Math.sin(angle * Math.PI / 180) * dist).toFixed(1);
    const size  = (3 + Math.random() * 5).toFixed(1);
    dot.style.cssText = `--dx:${dx}px;--dy:${dy}px;background:${colors[i%colors.length]};width:${size}px;height:${size}px;`;
    container.appendChild(dot);
    setTimeout(() => dot.remove(), 750);
  }
}

function bindKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const overlay = document.getElementById('word-detail-overlay');
      if (!overlay.classList.contains('hidden') && !overlay.classList.contains('closing')) {
        closeWordDetail(); return;
      }
    }
    if (document.getElementById('state-session').classList.contains('hidden')) return;
    if ((e.code === 'Space' || e.code === 'Enter') && !isFlipped) {
      e.preventDefault(); flipCard(); return;
    }
    if (isFlipped && !document.getElementById('grade-row').classList.contains('hidden')) {
      if (e.key === '1') { e.preventDefault(); gradeCard(0); }
      if (e.key === '2') { e.preventDefault(); gradeCard(1); }
      if (e.key === '3') { e.preventDefault(); gradeCard(3); }
      if (e.key === '4') { e.preventDefault(); gradeCard(5); }
    }
  });
}
