// The point-of-impact plot zooms with two fingers and leaves one finger to the page. Both
// halves need a real browser: touch-action, multi-touch, and whether the Stats pane still
// scrolls with a finger on the plot are invisible to jsdom.
const { chromium } = require('playwright');
const path = require('path');
const ARTIFACTS = path.join(__dirname, '.artifacts');
require('fs').mkdirSync(ARTIFACTS, { recursive: true });
const URL = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';

const SVG = '#poi-svg';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 760 },
    serviceWorkers: 'block', hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const checks = []; const ck = (n, ok) => checks.push([n, ok]);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(URL);
  await page.waitForSelector('#app-version');
  await page.evaluate(() => loadDemoData());
  await page.waitForTimeout(300);

  // A tight cluster near aim plus one group far out: the outlier sets the scale and squeezes
  // the rest into the middle, which is the case zooming exists for. Dated up to today only.
  const gunId = await page.evaluate(() => {
    showTab('stats'); showStatsSection('groups');
    const g = [...data.firearms].sort((a, b) =>
      (b.groups || []).length - (a.groups || []).length)[0];
    const seed = g.groups.find(x => x.aim) || g.groups[0];
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const shifts = [[0.004, 0.002], [0.006, -0.003], [0.003, 0.004], [0.005, 0.001],
                    [0.006, 0.0], [0.004, -0.002], [0.12, 0.09]];
    g.groups = shifts.map(([sx, sy], i) => {
      const d = new Date(today); d.setDate(d.getDate() - i * 3);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
        `${String(d.getDate()).padStart(2, '0')}`;
      return Object.assign({}, seed, { id: 'pz_' + i, date: iso,
        impacts: seed.impacts.map(p => ({ x: p.x + sx, y: p.y + sy })) });
    });
    save(data);
    return g.id;
  });
  await page.selectOption('#stats-firearm', gunId);
  await page.selectOption('#stats-range', 'all');
  await page.waitForTimeout(400);
  await page.locator(SVG).scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);

  const state = () => page.evaluate(sel => {
    const svg = document.querySelector(sel);
    if (!svg) return null;
    const dots = [...svg.querySelectorAll('circle[r="4"]')]
      .map(c => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    const xs = dots.map(d => d[0]).sort((a, b) => a - b);
    return {
      dots: dots.length,
      // Spread of the clustered dots, i.e. everything but the outlier.
      spread: xs[xs.length - 2] - xs[0],
      rings: svg.querySelectorAll('circle[fill="none"]').length,
      labels: svg.querySelectorAll('text').length,
      chip: document.getElementById('poi-zoom').textContent,
      zoom: poiView ? poiView.zoom : 1,
      scrollY: window.scrollY,
    };
  }, SVG);

  const fit = await state();
  ck('the plot draws every group', fit && fit.dots === 7);
  ck('it starts at Fit', fit && fit.chip === '1.0×');

  const box = await page.locator(SVG).boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });

  // Two fingers spreading apart around the middle.
  await touch('touchStart', [[cx - 20, cy], [cx + 20, cy]]);
  for (let s = 1; s <= 10; s++)
    await touch('touchMove', [[cx - 20 - s * 9, cy], [cx + 20 + s * 9, cy]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(150);
  const zoomed = await state();
  ck(`a two-finger spread zooms in (${zoomed.chip})`, zoomed.zoom > 2.5);
  ck('the clustered dots spread apart', zoomed.spread > fit.spread * 2.5);
  ck('dots keep their size', zoomed.dots >= 6);
  ck('rings re-step rather than thinning out', zoomed.rings >= 2);
  ck('the page itself did not zoom', await page.evaluate(() =>
    !window.visualViewport || Math.abs(window.visualViewport.scale - 1) < 0.01));

  // One finger is the page's: a vertical swipe over the plot scrolls rather than panning.
  // Swiped downward, scrolling the page up, since the plot sits near the bottom of Stats.
  const before = await state();
  await touch('touchStart', [[cx, cy - 60]]);
  for (let s = 1; s <= 10; s++) await touch('touchMove', [[cx, cy - 60 + s * 15]]);
  await touch('touchEnd', []);
  await page.waitForTimeout(500);
  const after = await state();
  ck(`one finger scrolls the page (${before.scrollY} → ${after.scrollY})`,
    after.scrollY < before.scrollY - 20);
  ck('and leaves the zoom alone', after.zoom === before.zoom);

  await page.locator('#stats-groups-poi').screenshot(
    { path: path.join(ARTIFACTS, 'poi-zoomed.png') });

  await page.click('#poi-reset');
  await page.waitForTimeout(100);
  const reset = await state();
  ck('Reset view returns to Fit', reset.chip === '1.0×' &&
    Math.abs(reset.spread - fit.spread) < 0.5);

  // Desktop: a trackpad pinch is a ctrl-wheel; a plain wheel must still scroll the page.
  await page.mouse.move(cx, cy);
  await page.evaluate(sel => document.querySelector(sel).dispatchEvent(new WheelEvent('wheel',
    { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true })), SVG);
  ck('a ctrl-wheel zooms', (await state()).zoom > 1.5);
  const plain = await page.evaluate(sel => {
    const e = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
    document.querySelector(sel).dispatchEvent(e);
    return e.defaultPrevented;
  }, SVG);
  ck('a plain wheel is left to the page', !plain);

  // A re-render (here: changing what the plot is colored by) starts again at Fit.
  await page.evaluate(() => renderStats && renderStats());
  await page.waitForTimeout(200);
  ck('a fresh render starts at Fit', (await state()).chip === '1.0×');

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS ' + [...new Set(errs)].join(' | ')); }
  console.log(bad === 0 ? '\nPOI zoom OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
