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

  // --- 3. Editing the demo group (which has no photo) must show its data ---
  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(250);
  await page.locator('#history-groups-list button[title="Edit"]').first().click();
  await page.waitForTimeout(400);

  check('edit modal is titled Edit Group', (await page.textContent('#group-modal-title')).startsWith('Edit Group'));
  // Compare against what the record actually holds rather than a hardcoded date, so
  // changing the demo data doesn't turn this into a false failure.
  // The list renders newest first and the click above took the top row, so the date to
  // expect is the most recent group's — not whichever one happens to sit first in storage.
  const storedDate = await page.evaluate(() =>
    buildDefaultData().firearms.find(g => g.groups.length)
      .groups.map(g => g.date).sort().pop());
  check('date loads from the saved group', (await page.inputValue('#group-date')) === storedDate);
  check('distance loads from the saved group', (await page.inputValue('#group-distance')) === '50');
  const heroVisible = await page.locator('.group-hero-num').count();
  check('measurements render with no photo', heroVisible === 1);
  const heroTxt = heroVisible ? (await page.textContent('.group-hero-num')).trim() : '';
  check('group size is a real number', /^\d+\.\d+/.test(heroTxt));
  const note = await page.locator('#group-results .group-hint').first().textContent().catch(() => '');
  check('explains why impacts cannot be re-marked', /can.t be re-marked/.test(note));
  check('plot renders from stored points', await page.locator('svg.group-plot').count() === 1);

  // Offsets are what you dial from, so they must carry both angular units — a MOA turret
  // and a mil turret each need to read this without the app knowing which scope is fitted.
  // The demo rifle is set to mils, so its offsets must headline MRAD with MOA beneath —
  // and all three units are present either way.
  const offsetSubs = await page.locator('.group-offset-sub').allTextContents();
  const offsetVals = await page.locator('.group-offset-val').allTextContents();
  check('offsets lead with the firearm\'s own optic unit',
    offsetVals.length === 2 && offsetVals.every(t => /MRAD/.test(t)));
  check('the other two units sit beneath',
    offsetSubs.length === 2 && offsetSubs.every(t => /in ·.*MOA/.test(t)));
  // Group size must stay MOA regardless, so it remains comparable between rifles.
  check('group size stays MOA even on a mil rifle',
    /MOA/.test(await page.textContent('.group-hero-num')));

  // With the unit unset, offsets fall back to MOA rather than guessing.
  await page.evaluate(() => {
    data.firearms.forEach(g => { g.opticUnit = null; });
    save(data); gRefresh();
  });
  await page.waitForTimeout(300);
  const fallback = await page.locator('.group-offset-val').allTextContents();
  check('an unset optic unit falls back to MOA', fallback.every(t => /MOA/.test(t)));
  await page.evaluate(() => { data.firearms[0].opticUnit = 'mrad'; save(data); gRefresh(); });
  await page.waitForTimeout(250);

  // --- 2. Backdrop click must not discard the modal ---
  await page.mouse.click(8, 450);
  await page.waitForTimeout(200);
  check('clicking the backdrop does not close the modal',
    await page.evaluate(() => document.getElementById('modal-group').classList.contains('open')));

  await page.click('#modal-group .btn-secondary:has-text("Cancel")');
  await page.waitForTimeout(300);
  check('Cancel still closes it',
    await page.evaluate(() => !document.getElementById('modal-group').classList.contains('open')));
  // Canceling returns to Details rather than dumping you on the dashboard.
  check('Cancel returns to the Details view',
    await page.evaluate(() => document.getElementById('modal-history').classList.contains('open')));

  // --- 1. Rectangle width and height share a row in perspective mode ---
  await page.click('button.btn-mini:has-text("+ Add Group")');
  await page.waitForTimeout(250);
  const singleBefore = await page.evaluate(() =>
    document.getElementById('group-cal-row').classList.contains('single'));
  check('linear mode gives the known-distance field the full row', singleBefore);

  await page.selectOption('#group-cal-mode', 'perspective');
  await page.waitForTimeout(200);
  const rowTops = await page.evaluate(() => {
    const w = document.getElementById('group-cal-w').getBoundingClientRect();
    const h = document.getElementById('group-cal-h').getBoundingClientRect();
    return { sameRow: Math.abs(w.top - h.top) < 2, side: w.left < h.left };
  });
  check('width and height sit on the same row', rowTops.sameRow && rowTops.side);

  // --- 4. Step tags navigate once their prerequisites exist ---
  await page.setInputFiles('#group-file', path.join(d, 'target.png'));
  await page.waitForTimeout(600);
  await page.selectOption('#group-cal-mode', 'linear');
  await page.waitForTimeout(200);
  await page.fill('#group-distance', '50');
  await page.evaluate(() => {
    const n = v => v / G.imgW;
    G.calPts = [{ x: n(400), y: n(500) }, { x: n(500), y: n(500) }];
    G.poa = { x: n(500), y: n(500) };
    G.impacts = [
      { x: n(500), y: n(400) }, { x: n(600), y: n(500) },
      { x: n(500), y: n(600) }, { x: n(400), y: n(500) },
    ];
    G.step = 3;
    gRefresh();
  });
  await page.waitForTimeout(250);

  const clickable = await page.locator('#group-steps .group-step.clickable').count();
  check('completed steps are marked clickable', clickable === 3);

  await page.click('#group-steps [data-step="1"]');
  await page.waitForTimeout(250);
  check('clicking a step jumps to it', await page.evaluate(() => G.step) === 1);
  check('marking controls return when jumping back',
    await page.isVisible('.group-actions'));

  await page.click('#group-steps [data-step="2"]');
  await page.waitForTimeout(200);
  check('can move on to impacts', await page.evaluate(() => G.step) === 2);
  check('existing marks survive step navigation',
    await page.evaluate(() => G.impacts.length) === 4);

  await page.locator('#group-results').scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(ARTIFACTS, 'fixes.png') });

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errors.length) { bad++; console.log('JS errors:', [...new Set(errors)].join(' | ')); }
  console.log(bad === 0 ? '\nAll fixes verified.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
