// A zero is reference the rifle depends on, so reading one must not be a step away from
// changing it. This drives the tap-to-view path and the edit path that shares its modal.
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

  // Add one to look at.
  await page.click('.history-subsection:has-text("Zeros") .btn-mini');
  await page.waitForTimeout(300);
  ck('the add form opens ready to type',
    !(await page.evaluate(() => document.getElementById('modal-zero').classList.contains('viewing'))));
  await page.fill('#zero-date', '2026-07-12');
  await page.fill('#zero-distance', '100');
  await page.fill('#zero-notes', 'Winchester zero at -2.4 at 100 yards');
  await page.click('#zero-buttons .btn-primary');
  await page.waitForTimeout(500);

  ck('the zero lands in the list',
    (await page.locator('#history-zeros-list .cleaning-row').count()) > 0);

  // Tapping the row reads it; it must not open the editor.
  await page.locator('#history-zeros-list .cleaning-row').first().click({ position:{x:60,y:18} });
  await page.waitForTimeout(400);
  ck('tapping a zero opens it read-only', await page.evaluate(() =>
    document.getElementById('modal-zero').classList.contains('viewing')));
  ck('view mode really disables the fields', await page.evaluate(() =>
    ['zero-date','zero-distance','zero-distance-unit','zero-ammo-select','zero-optic-select','zero-notes']
      .every(id => document.getElementById(id).disabled)));
  ck('view mode offers Edit rather than Save',
    (await page.locator('#zero-buttons').textContent()).includes('Edit') &&
    !(await page.locator('#zero-buttons').textContent()).includes('Save'));
  ck('the notes are readable, not blank',
    (await page.inputValue('#zero-notes')).includes('Winchester'));
  await page.locator('#modal-zero .modal').screenshot({ path: path.join(ARTIFACTS,'zero-view.png') });

  // Edit from there.
  await page.click('#zero-buttons .btn-primary');
  await page.waitForTimeout(300);
  ck('Edit unlocks the fields', await page.evaluate(() =>
    !document.getElementById('modal-zero').classList.contains('viewing') &&
    !document.getElementById('zero-distance').disabled));
  await page.fill('#zero-distance', '200');
  await page.click('#zero-buttons .btn-primary');
  await page.waitForTimeout(500);
  ck('the edit saves', (await page.locator('#history-zeros-list').textContent()).includes('200 yd'));

  // The pencil must go straight to editing, not through the read-only view.
  await page.locator('#history-zeros-list .btn-icon[title="Edit"]').first().click();
  await page.waitForTimeout(400);
  ck('the pencil opens the editor directly', await page.evaluate(() =>
    !document.getElementById('modal-zero').classList.contains('viewing')));
  await page.click('#zero-buttons .btn-secondary');
  await page.waitForTimeout(400);

  // And adding a new one after viewing must not inherit view mode.
  await page.click('.history-subsection:has-text("Zeros") .btn-mini');
  await page.waitForTimeout(300);
  ck('adding after viewing is not stuck inert', await page.evaluate(() =>
    !document.getElementById('modal-zero').classList.contains('viewing') &&
    !document.getElementById('zero-date').disabled));

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nZero view/edit OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
