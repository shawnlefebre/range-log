// The photo stage tracks live fingers in a Map keyed by pointerId, and iOS does not always
// deliver the pointerup — a touch that ends off the element, or capture lost mid-gesture,
// leaves an entry behind. One ghost and the gesture inverts: a single finger reads as two, so
// dragging zooms instead of panning, and a real pinch reads as three fingers and does nothing
// at all. It survives every re-render and only a reload clears it, which is exactly how it was
// reported. jsdom has no layout and no pointer capture, so this has to run in a real browser.
const { chromium } = require('playwright');
const path = require('path');
const URL = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 },
    deviceScaleFactor: 2, serviceWorkers: 'block', hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(URL);
  await page.waitForSelector('#app-version');
  const checks = []; const ck = (n, ok) => checks.push([n, ok]);

  const gunId = await page.evaluate(() => data.firearms[0].id);
  await page.evaluate(async id => { await openLogGroup(id); }, gunId);
  await page.waitForTimeout(300);
  await page.setInputFiles('#group-file', path.join(__dirname, 'target.png'));
  await page.waitForTimeout(500);

  // Synthetic pointer events: the only way to produce a release the page never hears about.
  // The handlers read pointerId/isPrimary/clientX/clientY, so these drive the real code path.
  await page.evaluate(() => {
    window.__pt = (type, id, x, y, primary) => {
      const st = document.getElementById('group-stage');
      const r = st.getBoundingClientRect();
      st.dispatchEvent(new PointerEvent(type, { pointerId: id, isPrimary: primary,
        clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerType: 'touch' }));
    };
    window.__view = () => ({ ox: G.view.ox, oy: G.view.oy, scale: G.view.scale });
  });
  const pt = (t, id, x, y, p = false) => page.evaluate(a => window.__pt(...a), [t, id, x, y, p]);
  const view = () => page.evaluate(() => window.__view());

  // Two fingers down, then only one release arrives — pointer 2 is now a ghost.
  await pt('pointerdown', 1, 100, 400, true);
  await pt('pointerdown', 2, 300, 400);
  await pt('pointermove', 1, 120, 400);
  await pt('pointermove', 2, 320, 400);
  await pt('pointerup', 1, 120, 400);
  // (no pointerup for 2 — this is the dropped release)

  // A fresh single-finger drag must pan: offsets move by the drag delta, scale untouched.
  const before = await view();
  await pt('pointerdown', 3, 200, 400, true);
  await pt('pointermove', 3, 260, 450);
  await pt('pointerup', 3, 260, 450);
  const after = await view();

  ck('a single finger pans after a dropped release',
    Math.abs(after.ox - before.ox - 60) < 2 && Math.abs(after.oy - before.oy - 50) < 2);
  ck('a single finger does not zoom', Math.abs(after.scale - before.scale) < 1e-6);

  // And a genuine pinch still zooms rather than reading as a third finger.
  const pre = await view();
  await pt('pointerdown', 4, 180, 400, true);
  await pt('pointerdown', 5, 260, 400);
  await pt('pointermove', 4, 120, 400);
  await pt('pointermove', 5, 320, 400);
  const mid = await view();
  ck('two fingers still zoom', mid.scale > pre.scale * 1.5);
  await pt('pointerup', 4, 120, 400);
  await pt('pointerup', 5, 320, 400);

  // Dropping from three fingers to two re-arms the pinch instead of going dead.
  const p3 = await view();
  await pt('pointerdown', 6, 180, 400, true);
  await pt('pointerdown', 7, 260, 400);
  await pt('pointerdown', 8, 220, 500);
  await pt('pointerup', 8, 220, 500);
  await pt('pointermove', 6, 100, 400);
  await pt('pointermove', 7, 340, 400);
  const p3b = await view();
  ck('pinch recovers after a third finger lifts', p3b.scale > p3.scale * 1.2);
  await pt('pointerup', 6, 100, 400);
  await pt('pointerup', 7, 340, 400);

  // A release that lands outside the stage is heard on window, so it leaves no ghost.
  await pt('pointerdown', 9, 200, 400, true);
  await pt('pointerdown', 10, 300, 400);
  await page.evaluate(() => window.dispatchEvent(
    new PointerEvent('pointerup', { pointerId: 10, bubbles: true })));
  const w0 = await view();
  await pt('pointermove', 9, 240, 400);
  const w1 = await view();
  ck('a release outside the stage still clears the finger',
    Math.abs(w1.ox - w0.ox - 40) < 2 && Math.abs(w1.scale - w0.scale) < 1e-6);
  await pt('pointerup', 9, 240, 400);

  ck('no page errors', errs.length === 0);

  await browser.close();
  const bad = checks.filter(c => !c[1]);
  checks.forEach(([n, ok]) => console.log(`${ok ? '✔' : '✖'} ${n}`));
  if (errs.length) errs.forEach(e => console.log('  page error:', e));
  console.log(bad.length ? `✖ ${bad.length} failed` : `✔ all ${checks.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();
