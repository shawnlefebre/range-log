// Regenerates the app icon PNGs from icon.svg.
//
//   node tools/make-icons.js
//
// Dev tooling, not part of the app — it uses the Playwright Chromium that the browser test
// suite already installs, so there is no new dependency and nothing to install for someone
// who only wants to host the app. Edit icon.svg and rerun this; never hand-edit a PNG.
//
// The sizes are not arbitrary:
//   512 — manifest, and what Android scales down from
//   192 — manifest, the Android home screen size
//   180 — apple-touch-icon, iOS home screen at 3x
//    32 — favicon fallback for browsers that ignore the SVG one

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SIZES = [512, 192, 180, 32];

(async () => {
  const svg = fs.readFileSync(path.join(ROOT, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  const page = await browser.newPage();

  for (const size of SIZES) {
    // Inline rather than <img src>, so the SVG renders at the device pixel size instead of
    // being rasterized once and scaled — the rings stay crisp at 32px that way.
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`
      <style>
        html, body { margin: 0; padding: 0; }
        svg { display: block; width: ${size}px; height: ${size}px; }
      </style>
      ${svg.replace(/<\?xml[^>]*\?>/, '')}
    `);
    const out = path.join(ROOT, `icon-${size}.png`);
    await page.screenshot({ path: out, omitBackground: false });
    console.log(`wrote icon-${size}.png`);
  }

  await browser.close();
})();
