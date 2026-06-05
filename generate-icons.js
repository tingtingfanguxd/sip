const puppeteer = require('puppeteer');
const path = require('path');
const fs   = require('fs');

const SIZES = [16, 32, 48, 128];
const SVG   = path.join(__dirname, 'chrome-extension/icons/icon.svg');
const OUT   = path.join(__dirname, 'chrome-extension/icons');

(async () => {
  const svgContent = fs.readFileSync(SVG, 'utf8');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  for (const size of SIZES) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(`<!DOCTYPE html><html><head><style>*{margin:0;padding:0}body{width:${size}px;height:${size}px;overflow:hidden}</style></head><body>${svgContent}</body></html>`);
    await new Promise(r => setTimeout(r, 300));
    const outPath = path.join(OUT, `icon${size}.png`);
    await page.screenshot({ path: outPath, type: 'png', clip: { x:0, y:0, width:size, height:size } });
    console.log(`✓  icon${size}.png`);
    await page.close();
  }

  await browser.close();
  console.log(`\nIcons → ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
