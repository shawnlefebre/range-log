// Dope tables are read at the range and dialled onto a turret, so the failure that matters
// is a number that looks right and isn't. This drives the real UI: unit conversion,
// view-mode inertness, persistence and the card cap.
const { chromium } = require('playwright');
const path = require('path');
const ARTIFACTS = path.join(__dirname, '.artifacts');
require('fs').mkdirSync(ARTIFACTS, { recursive: true });
const URL = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:430,height:900}, deviceScaleFactor:2, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  page.on('dialog', dlg => dlg.accept());
  await page.goto(URL);
  await page.waitForSelector('#app-version');
  const checks=[]; const ck=(n,ok)=>checks.push([n,ok]);

  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(300);

  // The demo rifle ships one mil table.
  ck('the dope card renders in Details',
    await page.locator('#history-dope-list .dope-card').count() === 1);
  ck('the card shows its unit and zero',
    /MRAD .*zero 100 yd/.test(await page.locator('#history-dope-list .dope-meta').first().textContent()));
  await page.locator('#history-dope-list').screenshot({ path: path.join(ARTIFACTS,'dope-cards.png') });

  // Tapping the card opens the read-only view, not the editor.
  await page.locator('#history-dope-list .dope-card').first().click({ position:{x:60,y:20} });
  await page.waitForTimeout(400);
  ck('tapping a card opens it read-only', await page.evaluate(() =>
    document.getElementById('modal-dope').classList.contains('viewing')));
  ck('view mode really disables the fields', await page.evaluate(() =>
    [...document.querySelectorAll('#dope-entries input')].every(i => i.disabled) &&
    document.getElementById('dope-unit').disabled));
  ck('view mode offers Edit rather than Save',
    (await page.locator('#dope-buttons').textContent()).includes('Edit'));
  // The header once inherited the delete column's 34px width in view mode and wrapped
  // "COME-UP (MIL)" over three lines, knocking it out of line with the values below.
  const head = await page.evaluate(() => {
    const spans = document.querySelectorAll('#dope-entries .entry-head span');
    return { a: spans[0].getBoundingClientRect(), b: spans[1].getBoundingClientRect() };
  });
  ck('the two view-mode headers share the width evenly',
    Math.abs(head.a.width - head.b.width) < 2 && head.b.height < 24);
  await page.locator('#modal-dope .modal').screenshot({ path: path.join(ARTIFACTS,'dope-view.png') });

  // Edit, then flip the unit. The displayed numbers must change, not just the label.
  await page.click('#dope-buttons .btn-primary');
  await page.waitForTimeout(300);
  const before = await page.evaluate(() =>
    [...document.querySelectorAll('#dope-entries .entry-row')].map(r => parseFloat(r.querySelectorAll('input')[1].value)));
  await page.selectOption('#dope-unit', 'moa');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() =>
    [...document.querySelectorAll('#dope-entries .entry-row')].map(r => parseFloat(r.querySelectorAll('input')[1].value)));
  ck('switching to MOA converts every displayed come-up',
    before.length === after.length &&
    before.every((v, i) => Math.abs(after[i] - v * 3.437746) < 0.011));
  ck('the come-up column header follows the unit',
    (await page.locator('#dope-entries .entry-head').textContent()).includes('MOA'));
  await page.locator('#modal-dope .modal').screenshot({ path: path.join(ARTIFACTS,'dope-edit.png') });

  // Add a distance and save; it must survive a reload.
  await page.click('#dope-add-row');
  await page.waitForTimeout(200);
  const rows = await page.locator('#dope-entries .entry-row').count();
  const last = page.locator('#dope-entries .entry-row').nth(rows - 1);
  await last.locator('input').nth(0).fill('700');
  await last.locator('input').nth(1).fill('27.5');
  await page.click('#dope-buttons .btn-primary');
  await page.waitForTimeout(500);

  ck('saving returns to Details', await page.isVisible('#modal-history'));
  ck('the new distance shows on the card',
    (await page.locator('#history-dope-list').textContent()).includes('700'));

  await page.reload();
  await page.waitForSelector('#app-version');
  const persisted = await page.evaluate(() => {
    const t = JSON.parse(localStorage.getItem('rangeLogData'))
      .firearms.flatMap(f => f.dope || [])[0];
    return { unit: t.unit, last: t.entries[t.entries.length - 1], count: t.entries.length };
  });
  ck('the converted unit persists', persisted.unit === 'moa');
  ck('the added come-up persists', persisted.last.distance === 700 && persisted.last.come === 27.5);
  ck('entries stay sorted by distance', persisted.count === 6);

  // A long table must not push the rest of Details off screen.
  await page.evaluate(() => {
    const gun = data.firearms.find(g => (g.dope || []).length);
    gun.dope[0].entries = [200,300,400,500,600,700,800,900].map((d,i) => ({ distance:d, come:1+i }));
    save(data);
  });
  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(400);
  ck('the card caps at six distances',
    await page.locator('#history-dope-list .dope-row:not(.more)').count() === 6);
  ck('the card says how many are hidden',
    (await page.locator('#history-dope-list .dope-row.more').textContent()).includes('+2'));

  // Deleting must not disturb the groups sharing the firearm.
  const groupsBefore = await page.locator('#history-groups-list .group-row').count();
  await page.locator('#history-dope-list .btn-icon[title="Delete"]').first().click();
  await page.waitForTimeout(400);
  ck('deleting the table empties the section',
    (await page.locator('#history-dope-list').textContent()).includes('No dope tables yet'));
  ck('deleting a table leaves the groups alone',
    await page.locator('#history-groups-list .group-row').count() === groupsBefore);

  // A table in meters. This worked from the start and had no cover, which is how the
  // control ended up labeled so that nobody could find it — the distance unit sat as a
  // sidecar on "Zeroed at" and read as though it only applied to the zero.
  await page.click('button.btn-mini:has-text("+ Add Table")');
  await page.waitForTimeout(400);
  const ammoOpts = await page.evaluate(() =>
    [...document.querySelectorAll('#dope-ammo-select option')].map(o => o.value).filter(Boolean));
  await page.selectOption('#dope-ammo-select', ammoOpts[0]);
  await page.fill('#dope-zero-distance', '100');

  ck('a new table starts in yards', await page.inputValue('#dope-distance-unit') === 'yd');
  ck('the zero carries its own unit beside it',
    await page.inputValue('#dope-zero-unit') === 'yd');

  await page.selectOption('#dope-distance-unit', 'm');
  await page.waitForTimeout(250);
  ck('switching to meters relabels the distance column',
    (await page.locator('#dope-entries .entry-head span').first().textContent()).includes('(m)'));
  // The zero is a fact about the rifle, not about the rows, so changing the row unit must
   // leave it alone — the whole point of the two being separate.
  ck('changing the row unit leaves the zero unit alone',
    await page.inputValue('#dope-zero-unit') === 'yd');

  const dRow = page.locator('#dope-entries .entry-row input');
  await dRow.nth(0).fill('300'); await dRow.nth(0).dispatchEvent('change');
  await dRow.nth(1).fill('4.2'); await dRow.nth(1).dispatchEvent('change');
  // Switching the unit must relabel, never convert: a come-up is an angle and converts
  // exactly, but the distances are the ones you actually have dope for. Turning 300 into
  // 274.3 would be arithmetically right and useless at the bench.
  await page.selectOption('#dope-distance-unit', 'yd');
  await page.waitForTimeout(200);
  await page.selectOption('#dope-distance-unit', 'm');
  await page.waitForTimeout(200);
  ck('switching the unit relabels rather than converting the distances',
    await dRow.nth(0).inputValue() === '300');

  await page.click('#dope-buttons button:has-text("Save")');
  await page.waitForTimeout(500);
  const stored = await page.evaluate(() => {
    const t = data.firearms.find(g => (g.dope || []).length).dope.slice(-1)[0];
    return { du: t.distanceUnit, zu: t.zeroUnit, dist: t.entries[0].distance, zero: t.zeroDistance };
  });
  ck('a meters table stores its unit', stored.du === 'm');
  ck('and stores the zero\'s unit separately', stored.zu === 'yd');
  ck('and stores the distance as typed', stored.dist === 300 && stored.zero === 100);
  ck('the card reads the table back in meters', await page.evaluate(() => {
    const t = [...document.querySelectorAll('#history-dope-list .dope-card')].pop();
    const s = t.textContent.replace(/\s+/g, ' ');
    // Zeroed at 100 yards, come-ups listed in meters — the card must say both.
    return /zero 100 yd/.test(s) && /300 M/.test(s);
  }));

  // Reopening is where a unit most easily gets lost, since the field is populated from the
  // record and then re-rendered.
  await page.locator('#history-dope-list .dope-card').last().click({ position:{x:60,y:20} });
  await page.waitForTimeout(400);
  ck('reopening a meters table comes back in meters',
    await page.inputValue('#dope-distance-unit') === 'm');
  ck('and remembers the zero was in yards',
    await page.inputValue('#dope-zero-unit') === 'yd');
  ck('the distance unit is inert in view mode',
    await page.evaluate(() => document.getElementById('dope-distance-unit').disabled));
  await page.locator('#modal-dope .modal').screenshot({ path: path.join(ARTIFACTS,'dope-meters.png') });
  await page.click('#dope-buttons button:has-text("Close")');
  await page.waitForTimeout(300);

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nDope tables OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
