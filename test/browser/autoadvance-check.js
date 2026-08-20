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
  page.on('dialog', dlg => dlg.accept());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto((process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html'));
  await page.waitForSelector('#app-version');

  const checks = [];
  const check = (n, ok) => checks.push([n, ok]);
  const step = () => page.evaluate(() => G.step);
  const nextShown = () => page.isVisible('#group-next');

  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(200);
  await page.click('button.btn-mini:has-text("+ Add Group")');
  await page.waitForTimeout(250);
  await page.setInputFiles('#group-file', path.join(d, 'target.png'));
  await page.waitForTimeout(600);
  // Done now writes the group rather than just advancing, so the required fields have to
  // be present or it will refuse — which is the point of them being required.
  await page.fill('#group-distance', '50');
  await page.fill('#group-cal-w', '1');

  check('starts on the scale step', await step() === 0);
  check('no Done button while scaling', !(await nextShown()));

  // Two-point scale: the first point stays put, the second finishes the step.
  await page.click('#group-set');
  await page.waitForTimeout(150);
  check('still scaling after the first point', await step() === 0);
  await page.click('#group-set');
  await page.waitForTimeout(200);
  check('advances to aim once both scale points are placed', await step() === 1);
  check('still no Done button while aiming', !(await nextShown()));

  // Aim takes exactly one point.
  await page.click('#group-set');
  await page.waitForTimeout(200);
  check('advances to impacts once the aim point is placed', await step() === 2);
  check('Done appears for impacts', await nextShown());
  check('Done is disabled below two impacts',
    await page.evaluate(() => document.getElementById('group-next').disabled));

  // Undo must reach back across the boundary the auto-advance crossed.
  await page.click('#group-undo');
  await page.waitForTimeout(200);
  check('undo from an empty impacts step removes the aim point and steps back',
    await step() === 1 && await page.evaluate(() => G.poa === null));

  await page.click('#group-undo');
  await page.waitForTimeout(200);
  check('undo again removes the last scale point and steps back',
    await step() === 0 && await page.evaluate(() => G.calPts.length) === 1);

  // Re-place and confirm impacts still need an explicit Done.
  await page.click('#group-set'); await page.waitForTimeout(150);
  await page.click('#group-set'); await page.waitForTimeout(150);
  await page.click('#group-set'); await page.waitForTimeout(150);
  check('back on impacts', await step() === 2);
  await page.click('#group-set'); await page.waitForTimeout(120);
  await page.click('#group-set'); await page.waitForTimeout(150);
  check('impacts do not auto-advance', await step() === 2);
  check('Done enables at two impacts',
    !(await page.evaluate(() => document.getElementById('group-next').disabled)));
  await page.click('#group-next');
  await page.waitForTimeout(700);
  check('Done finishes marking and writes the group', await step() === 3);

  // Four-corner mode needs four points before advancing.
  await page.evaluate(() => { G.calPts = []; G.poa = null; G.impacts = []; G.step = 0; gRefresh(); });
  await page.selectOption('#group-cal-mode', 'perspective');
  await page.waitForTimeout(200);
  for (let i = 0; i < 3; i++) { await page.click('#group-set'); await page.waitForTimeout(120); }
  check('four-corner mode stays on scale after three corners', await step() === 0);
  await page.click('#group-set');
  await page.waitForTimeout(200);
  check('four-corner mode advances on the fourth corner', await step() === 1);

  await page.screenshot({ path: path.join(ARTIFACTS, 'autoadvance.png') });

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errors.length) { bad++; console.log('JS errors:', [...new Set(errors)].join(' | ')); }
  console.log(bad === 0 ? '\nAuto-advance OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
