# Chrome Popup Extension Playbook
> Based on SyncZone v1.4.1 development. Use this as the starting template for every new popup extension.

---

## Core Philosophy

- **Popup-only = simplest possible architecture.** No background worker, no content scripts, no host permissions. Fastest review, highest trust from users.
- **Show real UI in every marketing asset.** Users should be able to evaluate the tool in 2 seconds from the promo tile alone.
- **Free tier is the product. Pro tier is the business.** Design free to be genuinely useful; design Pro to be obviously worth it.

---

## 1. Folder Structure

```
my-extension/
├── chrome-extension/           # Extension source (what gets zipped)
│   ├── manifest.json
│   ├── popup.html
│   ├── popup.js
│   ├── popup.css
│   ├── twemoji.min.js          # Only if you need emoji rendering
│   └── icons/
│       ├── icon.svg            # Master vector
│       ├── icon16.png
│       ├── icon32.png
│       ├── icon48.png
│       └── icon128.png
│
├── api/                        # Vercel serverless functions
│   ├── health.js
│   ├── verify-pro.js           # If monetized
│   └── [your-core-api].js
│
├── store-assets/
│   └── mockups/                # HTML source files for screenshots
│       ├── ss1-overview.html
│       ├── ss2-[feature].html
│       ├── ss3-[feature].html
│       ├── ss4-[feature].html
│       ├── ss5-pro.html        # Always end with Pro pitch
│       ├── promo-small.html    # 440×280
│       └── promo-marquee.html  # 1400×560
│
├── SyncZone_Production_Package/ # Final deliverable (gitignored or tagged)
│   ├── extension/              # Copied from chrome-extension/
│   └── store_assets/           # Generated PNGs
│
├── generate-screenshots.js     # Puppeteer screenshot script
├── package.json
└── .gitignore
```

---

## 2. manifest.json Template (MV3)

```json
{
  "manifest_version": 3,
  "name": "ExtensionName — Tagline",
  "version": "1.0.0",
  "description": "One sentence. What it does, who it's for.",
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16":  "icons/icon16.png",
      "32":  "icons/icon32.png",
      "48":  "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "permissions": ["storage"],
  "icons": {
    "16":  "icons/icon16.png",
    "48":  "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https:;"
  }
}
```

**Permission rules:**
- Start with just `storage`. Add only what you actually use.
- Every extra permission = longer review + lower install conversion.
- `tabs` is often avoidable (use `chrome.action` instead).

---

## 3. popup.html Structure

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700;800&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="popup.css">
</head>
<body>

  <!-- HEADER: brand mark + settings/pro badge -->
  <header id="header">...</header>

  <!-- MAIN CONTENT: the core tool UI -->
  <main id="main">...</main>

  <!-- MODAL: add/edit items -->
  <div id="modal" class="modal-overlay hidden">
    <div class="modal-box">...</div>
  </div>

  <!-- UPGRADE MODAL: Pro pitch -->
  <div id="upgrade-modal" class="modal-overlay hidden">
    <div class="modal-box">
      <div id="upgrade-pitch">...</div>
      <div id="upgrade-activate" class="hidden">...</div>
    </div>
  </div>

  <!-- TOAST -->
  <div id="toast" class="toast hidden"></div>

  <script src="popup.js"></script>
</body>
</html>
```

---

## 4. popup.js Skeleton

```js
// ── CONSTANTS ──────────────────────────────────────────────
const MAX_FREE = 4;                    // Free tier limit
const STORAGE_KEY = 'myext-data';      // Main data key
const API_BASE = 'https://yourapp.vercel.app';

// ── STATE ──────────────────────────────────────────────────
let items = [];
let isPro = false;
let tickTimer = null;

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  await loadProStatus();
  render();
  startTick();
  bindEvents();
  applyLanguage();
});

// ── STORAGE ────────────────────────────────────────────────
async function loadData() {
  const r = await chrome.storage.sync.get(STORAGE_KEY);
  items = r[STORAGE_KEY] || getDefaults();
}

async function saveData() {
  await chrome.storage.sync.set({ [STORAGE_KEY]: items });
}

// ── PRO ────────────────────────────────────────────────────
async function loadProStatus() {
  const r = await chrome.storage.sync.get('myext-pro');
  isPro = r['myext-pro'] === true;
  updateProUI();
}

async function activatePro(email) {
  const res = await fetch(`${API_BASE}/api/verify-pro?email=${encodeURIComponent(email)}`);
  const { pro } = await res.json();
  if (pro) {
    isPro = true;
    await chrome.storage.sync.set({ 'myext-pro': true });
    updateProUI();
    showToast('Pro activated!');
  } else {
    showToast('Email not found — check your Stripe receipt');
  }
}

// ── RENDER ─────────────────────────────────────────────────
function render() {
  // Build DOM from items[]
}

// ── TICK (if you need live updates) ───────────────────────
function startTick() {
  tickTimer = setInterval(() => {
    updateLiveElements();
  }, 1000);
}

// ── MODALS ─────────────────────────────────────────────────
function openModal()    { document.getElementById('modal').classList.remove('hidden'); }
function closeModal()   { document.getElementById('modal').classList.add('hidden'); }
function openUpgrade()  { document.getElementById('upgrade-modal').classList.remove('hidden'); }
function closeUpgrade() { document.getElementById('upgrade-modal').classList.add('hidden'); }

// ── TOAST ──────────────────────────────────────────────────
function showToast(msg, duration = 2500) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), duration);
}

// ── I18N ───────────────────────────────────────────────────
const TR = {
  en: { addItem: 'Add', title: 'My Extension' },
  zh: { addItem: '添加', title: '我的扩展' },
  // ... more languages
};
let lang = 'en';

function applyLanguage() {
  document.querySelectorAll('[data-t]').forEach(el => {
    const key = el.dataset.t;
    if (TR[lang]?.[key]) el.textContent = TR[lang][key];
  });
}

// ── EVENTS (all delegated here, no inline handlers) ────────
function bindEvents() {
  document.getElementById('add-btn').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('upgrade-btn').addEventListener('click', openUpgrade);
  document.getElementById('activate-btn').addEventListener('click', () => {
    activatePro(document.getElementById('email-input').value.trim());
  });
  // ...
}
```

---

## 5. popup.css Design System

```css
/* ── ROOT TOKENS ── */
:root {
  --bg-deep:     #09082a;
  --bg-card:     rgba(255,255,255,.05);
  --border:      rgba(255,255,255,.1);
  --text-primary: #f8fafc;
  --text-muted:  rgba(241,245,249,.45);
  --accent:      #a78bfa;
  --accent-glow: rgba(167,139,250,.25);
  --green:       #4ade80;
  --amber:       #fbbf24;
  --radius-card: 12px;
  --radius-btn:  8px;
}

/* ── AURORA BACKGROUND ── */
body {
  width: 400px;          /* Adjust to your popup width */
  background: radial-gradient(ellipse 140% 110% at 30% -5%, #120828 0%, #07051a 55%, #020210 100%);
  font-family: 'Space Grotesk', sans-serif;
  -webkit-font-smoothing: antialiased;
  position: relative; overflow: hidden;
}
.blob {
  position: absolute; border-radius: 50%;
  mix-blend-mode: screen; filter: blur(80px); pointer-events: none;
}

/* ── GLASSMORPHISM CARD ── */
.card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-card);
  backdrop-filter: blur(8px);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 4px 16px rgba(0,0,0,.3);
}

/* ── GRADIENT BUTTON ── */
.btn-primary {
  background: linear-gradient(135deg, #7c3aed, #a855f7);
  border: none; border-radius: var(--radius-btn);
  color: #fff; font-weight: 700; cursor: pointer;
  box-shadow: 0 4px 14px rgba(124,58,237,.4);
  transition: opacity .15s;
}
.btn-primary:hover { opacity: .88; }

/* ── MODAL ── */
.modal-overlay {
  position: fixed; inset: 0; z-index: 100;
  background: rgba(0,0,0,.65); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
}
.modal-overlay.hidden { display: none; }

/* ── TOAST ── */
.toast {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
  background: rgba(255,255,255,.12); backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,.15); border-radius: 20px;
  padding: 8px 18px; font-size: 12px; color: #f8fafc; z-index: 200;
  white-space: nowrap;
}
.toast.hidden { display: none; }
```

---

## 6. API Endpoints (Vercel)

### health.js
```js
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ ok: true, ts: new Date().toISOString() });
}
```

### verify-pro.js
```js
import Stripe from 'stripe';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://yourapp.online');
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email required' });

  // Check registered customers
  const customers = await stripe.customers.list({ email, limit: 5 });
  for (const c of customers.data) {
    const subs = await stripe.subscriptions.list({ customer: c.id, status: 'active', limit: 1 });
    const charges = await stripe.charges.list({ customer: c.id, limit: 5 });
    const hasPaid = charges.data.some(ch => ch.paid && ch.amount > 0);
    if (subs.data.length > 0 || hasPaid) return res.json({ pro: true });
  }

  // Check guest checkouts (no Stripe account)
  let starting_after;
  do {
    const sessions = await stripe.checkout.sessions.list({
      limit: 100,
      status: 'complete',
      ...(starting_after ? { starting_after } : {}),
    });
    for (const s of sessions.data) {
      if (s.customer_details?.email?.toLowerCase() === email.toLowerCase()) {
        return res.json({ pro: true });
      }
    }
    starting_after = sessions.has_more ? sessions.data.at(-1).id : null;
  } while (starting_after);

  res.json({ pro: false });
}
```

---

## 7. Icon Generation Workflow

1. Design the icon in Figma (use a single concept — a clock, a cursor, a lens)
2. Export as `icon.svg` to `chrome-extension/icons/`
3. Open `icons/generate-icons.html` in browser → it renders SVG at 16/32/48/128 → right-click save each
4. Or use ImageMagick: `convert -background none icon.svg -resize 128x128 icon128.png`

**Icon rules:**
- Must work on both light and dark OS backgrounds
- Recognizable at 16×16 (no text, no fine detail)
- Use brand accent color as fill, transparent background

---

## 8. Store Asset Strategy

### What each screenshot should show:
| # | What to show | Goal |
|---|---|---|
| ss1 | Main UI with realistic data | "I get it immediately" |
| ss2 | Your most unique feature | "Oh, it does THAT?" |
| ss3 | Result / output / value moment | "This is the payoff" |
| ss4 | Customization / add flow | "I can set this up easily" |
| ss5 | Pro tier features | "Worth upgrading" |
| promo-small | Real popup + tagline | "One glance, I understand" |
| promo-marquee | Full hero layout | "This is a real product" |

### Design rules for mockups:
- Use the same visual language as the extension (same fonts, colors, blur effects)
- Show **real UI**, not abstract illustrations — users must recognize what they'll get
- For promo-small (440×280): left copy panel + vertical divider + right UI mock
- For promo-marquee (1400×560): left headline + features list + right popup frame
- Always include realistic fake data (real city names, real times, real results)

### Puppeteer screenshot command:
```bash
node generate-screenshots.js
```

Generates all 7 PNGs to `SyncZone_Production_Package/store_assets/`.

---

## 9. generate-screenshots.js Template

```js
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ASSETS = [
  { file: 'ss1-overview.html',     out: 'screenshot-1-overview.png',     w: 1280, h: 800 },
  { file: 'ss2-feature.html',      out: 'screenshot-2-feature.png',      w: 1280, h: 800 },
  { file: 'ss3-result.html',       out: 'screenshot-3-result.png',       w: 1280, h: 800 },
  { file: 'ss4-customize.html',    out: 'screenshot-4-customize.png',    w: 1280, h: 800 },
  { file: 'ss5-pro.html',          out: 'screenshot-5-pro.png',          w: 1280, h: 800 },
  { file: 'promo-small.html',      out: 'promo-small.png',               w: 440,  h: 280 },
  { file: 'promo-marquee.html',    out: 'promo-marquee.png',             w: 1400, h: 560 },
];

const MOCKUP_DIR = path.join(__dirname, 'store-assets/mockups');
const OUT_DIR    = path.join(__dirname, 'MyExtension_Production_Package/store_assets');

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=none'],
  });
  for (const a of ASSETS) {
    const page = await browser.newPage();
    await page.setViewport({ width: a.w, height: a.h, deviceScaleFactor: 1 });
    await page.goto(`file://${path.join(MOCKUP_DIR, a.file)}`, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise(r => setTimeout(r, 800));   // Let fonts/blurs render
    await page.screenshot({ path: path.join(OUT_DIR, a.out), type: 'png', omitBackground: false });
    console.log(`✓  ${a.out}`);
    await page.close();
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
```

---

## 10. Production Package & Versioning

```bash
# 1. Bump version in manifest.json (semver)
# 2. Copy extension source to production package
cp -r chrome-extension/. MyExt_Production_Package/extension/
# 3. Generate screenshots
node generate-screenshots.js
# 4. Create zip (exclude hidden files)
cd MyExt_Production_Package/extension
zip -r ../../myext-extension-v1.0.0.zip . -x "*.DS_Store"
# 5. Commit + tag
git add -A && git commit -m "release v1.0.0"
git tag v1.0.0
```

Keep versioned zips at root (e.g. `myext-extension-v1.0.0.zip`, `v1.1.0.zip`...). Never delete old versions — Chrome Web Store review may request rollback comparison.

---

## 11. Chrome Web Store Submission Checklist

- [ ] `manifest.json` version bumped
- [ ] Permissions justified (one-line explanation for each in store listing)
- [ ] All 7 store assets regenerated as PNG (not JPEG)
- [ ] Extension zip created from the `chrome-extension/` folder root
- [ ] Privacy policy URL set (required for any storage use)
- [ ] Store listing description: first 132 chars are critical (shown in search)
- [ ] Category selected correctly (Productivity vs Tools)
- [ ] At least 1 screenshot uploaded (5 recommended)
- [ ] Both promo tiles uploaded (small 440×280, marquee 1400×560)
- [ ] Support email set

---

## 12. Vercel Deployment Checklist

- [ ] `STRIPE_SECRET_KEY` environment variable set in Vercel dashboard
- [ ] CORS origin in `verify-pro.js` matches your production domain
- [ ] `vercel.json` routes configured if needed
- [ ] Health endpoint returns `{ ok: true }` at `/api/health`
- [ ] `find-overlap.js` (or your core API) tested with sample payload

---

## 13. Stripe Setup Checklist

- [ ] Product created in Stripe dashboard (one-time payment or subscription)
- [ ] Checkout link embedded in popup (Pro upgrade modal)
- [ ] Success URL redirects back to extension install page or thank-you page
- [ ] Customer email is collected on checkout (required for `verify-pro.js` to work)
- [ ] Webhook (optional) for real-time activation vs. polling on extension open

---

## 14. Development Workflow Per Feature

```
1. Plan
   - Define the user problem in one sentence
   - Sketch the popup UI (pen/paper or Figma)
   - Decide: free or pro tier?
   - Define data model (what goes in chrome.storage.sync)

2. Build
   - HTML structure first (no styles)
   - CSS: tokens → layout → components → animations
   - JS: data model → render() → interactions → storage → API calls

3. Test
   - Load unpacked from chrome-extension/ in chrome://extensions
   - Test with multiple Chrome profiles (free + pro)
   - Test storage persistence (close/reopen popup)
   - Test edge cases: 0 items, max items, API failure

4. Store assets
   - Write mockup HTMLs showing real UI with realistic data
   - Run generate-screenshots.js
   - Review PNGs — would a stranger understand the product in 2s?

5. Ship
   - Bump version, create zip, upload to Chrome Web Store
   - Deploy API changes to Vercel
   - Commit + tag git
```

---

## 15. Common Gotchas

| Problem | Fix |
|---|---|
| Popup too tall | Chrome caps popup height at ~600px; test at exact px |
| Fonts missing in screenshots | Add 800ms delay after `networkidle0` in Puppeteer |
| CSP blocks Google Fonts | Add `style-src ... https://fonts.googleapis.com` to manifest |
| `chrome.storage` not available in dev | Load as unpacked extension, not just open HTML |
| `deviceScaleFactor: 2` makes PNGs 2× too large | Always use `deviceScaleFactor: 1` for store assets |
| Review rejection: "excessive permissions" | Remove any permission you don't actively use |
| Pro email not found | Guest Stripe checkouts require pagination through all sessions |
| Extension icon looks bad on light OS | Test with macOS set to Light mode; use outline variant |

---

## 16. Tech Stack Summary

| Layer | Choice | Why |
|---|---|---|
| Extension | Vanilla JS + HTML + CSS | No build step, instant iteration |
| Fonts | Space Grotesk + DM Mono | Modern, legible, free |
| Storage | `chrome.storage.sync` | Syncs across user's devices automatically |
| Backend | Vercel serverless | Zero infra, free tier sufficient |
| Payments | Stripe | Best checkout UX, easy email lookup |
| Icons | SVG → PNG via canvas or ImageMagick | Source stays editable |
| Screenshots | Puppeteer | Pixel-perfect, reproducible, scriptable |
| Emoji | twemoji.min.js | Consistent cross-OS rendering |

---

*Last updated: 2026-06-05 — based on SyncZone v1.4.1*
