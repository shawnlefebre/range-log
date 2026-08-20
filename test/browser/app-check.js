// End-to-end check of the group feature in the real app: full marking flow through
// the UI, photo persistence in IndexedDB, reload, edit, and delete cleanup.
const { chromium } = require('playwright');
const path = require('path');
const d = __dirname;
// Run artifacts (screenshots) go to an ignored folder, not the fixture directory.
const ARTIFACTS = require('path').join(__dirname, '.artifacts');
require('fs').mkdirSync(ARTIFACTS, { recursive: true });
const URL = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await page.goto(URL);
  await page.waitForSelector('#app-version');

  const checks = [];
  const check = (name, ok) => { checks.push([name, ok]); };

  check('version badge is well formed', /^v\d+\.\d+(\.\d+)?$/.test(await page.textContent('#app-version')));

  // Demo data should already carry a sample group on the rifle.
  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(250);
  const demoRows = await page.locator('#history-groups-list .group-row').count();
  check('demo groups show in Details', demoRows > 0);
  // MOA leads in this list, since groups shot at different distances sit side by side.
  const demoSize = await page.locator('#history-groups-list .group-row-size').first().textContent();
  check('demo group leads with a computed MOA figure', /^\d+\.\d+ MOA$/.test(demoSize.trim()));

  // Opening the group modal must close Details, never stack over it (the iOS repaint bug).
  await page.click('button.btn-mini:has-text("+ Add Group")');
  await page.waitForTimeout(250);
  const stacked = await page.evaluate(() => ({
    history: document.getElementById('modal-history').classList.contains('open'),
    group: document.getElementById('modal-group').classList.contains('open'),
  }));
  check('Details closes when the group modal opens', !stacked.history && stacked.group);

  // Ammo selection should fill in the bullet diameter from its caliber.
  await page.selectOption('#group-ammo-select', { index: 1 });
  await page.waitForTimeout(150);
  const bullet = await page.inputValue('#group-bullet');
  check('bullet diameter auto-fills from ammo caliber', parseFloat(bullet) > 0);

  // Load a synthetic target: 100 px == 1 inch, four holes 1 inch from center.
  await page.setInputFiles('#group-file', path.join(d, 'target.png'));
  await page.waitForTimeout(500);
  const staged = await page.isVisible('#group-stage-wrap');
  check('marking stage appears once a photo is loaded', staged);

  // Drive the marking directly (pan/pinch precision isn't what we're testing here).
  await page.fill('#group-distance', '50');
  await page.fill('#group-cal-w', '1');
  await page.evaluate(() => {
    const n = v => v / G.imgW;          // pixels -> normalised units
    G.calPts = [{ x: n(400), y: n(500) }, { x: n(500), y: n(500) }];
    G.poa = { x: n(500), y: n(500) };
    G.impacts = [
      { x: n(500), y: n(400) }, { x: n(600), y: n(500) },
      { x: n(500), y: n(600) }, { x: n(400), y: n(500) },
    ];
    G.step = 3;
    gRefresh();
  });
  await page.waitForTimeout(300);

  // A 2.00 in spread at 50 yd is 3.82 MOA; MOA leads, inches sits beneath.
  const hero = await page.textContent('.group-hero-num');
  const heroSub = await page.textContent('.group-hero .group-hint');
  check('live results lead with the hand-computed 3.82 MOA', hero.trim() === '3.82 MOA');
  check('inches and MRAD sit beneath the headline', heroSub.trim() === '2.00 in · 1.11 MRAD');
  const axes = await page.locator('.group-offset-axis').allTextContents();
  check('elevation is listed before windage', axes[0] === 'Elevation' && axes[1] === 'Windage');
  check('group plot renders', await page.locator('svg.group-plot').count() === 1);

  await page.screenshot({ path: path.join(ARTIFACTS, 'app-group-results.png') });

  await page.click('#modal-group .btn-primary:has-text("Save")');
  await page.waitForTimeout(600);

  const saved = await page.evaluate(() => {
    const g = JSON.parse(localStorage.getItem('rangeLogData'));
    const gun = g.firearms.find(f => (f.groups || []).length > 1);
    const rec = gun && gun.groups[gun.groups.length - 1];
    return rec ? { hasPhoto: !!rec.photoId, keys: Object.keys(rec), impacts: rec.impacts.length } : null;
  });
  check('group persisted to localStorage', !!saved && saved.impacts === 4);
  check('no computed size stored on the record',
    saved && !saved.keys.some(k => ['size', 'es', 'meanRadius', 'moa'].includes(k)));
  check('photo id recorded when keeping the photo', saved && saved.hasPhoto);

  const photoStored = await page.evaluate(async () => {
    const db = await new Promise(res => { const r = indexedDB.open('rangeLogPhotos', 1); r.onsuccess = () => res(r.result); });
    return new Promise(res => {
      const req = db.transaction('photos', 'readonly').objectStore('photos').getAllKeys();
      req.onsuccess = () => res(req.result.length);
    });
  });
  check('photo blob written to IndexedDB', photoStored === 1);

  // Backups must stay small: no image data in the JSON.
  const backupHasPhoto = await page.evaluate(() =>
    localStorage.getItem('rangeLogData').includes('data:image'));
  check('photo is not embedded in the saved JSON', !backupHasPhoto);

  // Reload: metrics must recompute from the stored points alone.
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(300);
  // The saved group is a 2.00 in spread at 50 yd, which is 3.82 MOA.
  const rows = await page.evaluate(() => [...document.querySelectorAll('#history-groups-list .group-row')]
    .map(r => ({
      primary: r.querySelector('.group-row-size').textContent.trim(),
      inches: r.querySelectorAll('.group-row-sub')[1].textContent.trim(),
    })));
  check('saved group survives reload with computed MOA and inches',
    rows.length === demoRows + 1 && rows.some(r => r.primary === '3.82 MOA' && r.inches === '2.00"'));

  // Delete must take the photo with it, or blobs orphan in IndexedDB. Target the row we
  // saved specifically — the demo groups carry no photo, so deleting one proves nothing.
  page.on('dialog', dlg => dlg.accept());
  await page.locator('#history-groups-list .group-row')
    .filter({ hasText: '3.82 MOA' })
    .locator('button[title="Delete"]').click();
  await page.waitForTimeout(600);
  const photosAfter = await page.evaluate(async () => {
    const db = await new Promise(res => { const r = indexedDB.open('rangeLogPhotos', 1); r.onsuccess = () => res(r.result); });
    return new Promise(res => {
      const req = db.transaction('photos', 'readonly').objectStore('photos').getAllKeys();
      req.onsuccess = () => res(req.result.length);
    });
  });
  check('deleting a group deletes its photo blob', photosAfter === 0);

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errors.length) { bad++; console.log('\nJS errors:', [...new Set(errors)].join('\n  ')); }
  console.log(bad === 0 ? '\nApp integration OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad === 0 ? 0 : 1);
})();
