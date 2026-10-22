const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ASSETS = [
  { file: 'ss1-overview.html',    out: 'screenshot-1-overview.png',    w: 1280, h: 800 },
  { file: 'ss2-capture.html',     out: 'screenshot-2-capture.png',     w: 1280, h: 800 },
  { file: 'ss3-review.html',      out: 'screenshot-3-review.png',      w: 1280, h: 800 },
  { file: 'ss4-words.html',       out: 'screenshot-4-words.png',       w: 1280, h: 800 },
  { file: 'ss5-ai.html',          out: 'screenshot-5-ai.png',          w: 1280, h: 800 },
  { file: 'promo-small.html',     out: 'promo-small.png',              w: 440,  h: 280 },
  { file: 'promo-marquee.html',   out: 'promo-marquee.png',            w: 1400, h: 560 },
];

const MOCKUP_DIR = path.join(__dirname, 'store-assets/mockups');
const OUT_DIR    = path.join(__dirname, 'Sip_Production_Package/store_assets');

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
    await new Promise(r => setTimeout(r, 900));
    const outPath = path.join(OUT_DIR, a.out);
    await page.screenshot({ path: outPath, type: 'png', omitBackground: false });
    console.log(`✓  ${a.out}`);
    await page.close();
  }
  await browser.close();
  console.log(`\nAll assets → ${OUT_DIR}`);
})().catch(e => { console.error(e); process.exit(1); });
