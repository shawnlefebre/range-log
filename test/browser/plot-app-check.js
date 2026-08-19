const { chromium } = require('playwright');
const path = require('path');
const d = __dirname;
// Run artifacts (screenshots) go to an ignored folder, not the fixture directory.
const ARTIFACTS = require('path').join(__dirname, '.artifacts');
require('fs').mkdirSync(ARTIFACTS, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto((process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html'));
  await page.waitForSelector('#app-version');

  const checks = [];
  const check = (n, ok) => checks.push([n, ok]);

  // The demo group has no photo — the data-only case this is really for.
  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(250);
  await page.locator('#history-groups-list button[title="Edit"]').first().click();
  await page.waitForTimeout(400);

  const read = () => page.evaluate(() => {
    const svg = document.getElementById('group-plot-svg');
    const t = svg && svg.querySelector('text[data-fs]');
    return svg ? {
      vb: svg.getAttribute('viewBox'),
      fs: t ? Number(t.getAttribute('font-size')) : null,
      chip: (document.getElementById('group-plot-zoom') || {}).textContent,
    } : null;
  });

  const start = await read();
  check('plot renders on a photoless group', !!start);
  check('starts at full view', start && start.vb === '0 0 300 300');
  check('labels start at base size', start && Math.abs(start.fs - 8) < 0.01);

  await page.locator('#group-plot-svg').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  const box = await page.locator('#group-plot-svg').boundingBox();

  // Wheel-zoom over the plot center.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100);
  await page.waitForTimeout(250);
  const zoomed = await read();
  check('zoom shrinks the viewBox', Number(zoomed.vb.split(' ')[2]) < 300);
  check('labels counter-scale so they stay readable', zoomed.fs < start.fs);
  check('zoom chip reports above 1x', parseFloat(zoomed.chip) > 1);

  // Drag to pan.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 40, box.y + box.height / 2 - 30, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const panned = await read();
  check('drag pans the plot', panned.vb !== zoomed.vb);

  await page.screenshot({ path: path.join(ARTIFACTS, 'plot-zoomed.png') });

  // Zoom must survive an unrelated edit re-rendering the results.
  await page.fill('#group-distance', '75');
  await page.waitForTimeout(300);
  const afterEdit = await read();
  check('zoom survives a re-render',
    Number(afterEdit.vb.split(' ')[2]) === Number(panned.vb.split(' ')[2]));

  await page.click('#group-plot-reset');
  await page.waitForTimeout(200);
  check('reset restores full view', (await read()).vb === '0 0 300 300');

  // Reopening a different group should not inherit a zoom.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -300);
  await page.waitForTimeout(200);
  await page.click('#modal-group .btn-secondary:has-text("Cancel")');
  await page.waitForTimeout(300);
  await page.click('button.btn-mini:has-text("+ Add Group")');
  await page.waitForTimeout(300);
  check('a freshly opened group starts unzoomed',
    await page.evaluate(() => gPlotVB === null));

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errors.length) { bad++; console.log('JS errors:', [...new Set(errors)].join(' | ')); }
  console.log(bad === 0 ? '\nPlot pan/zoom OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
