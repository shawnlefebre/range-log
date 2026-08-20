// Tags are freeform, so the only thing keeping them useful for comparison later is that
// "Prone" and "prone" never become two different tags. That's what this guards.
const { chromium } = require('playwright');
const path = require('path');
const d = __dirname;
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

  // Existing tags show on the list rows.
  ck('tags appear on group rows', await page.locator('#history-groups-list .tag-pill').count() > 0);

  // Read-only view shows them but offers no way to change them.
  await page.locator('#history-groups-list .group-row').first().click({ position:{x:60,y:20} });
  await page.waitForTimeout(500);
  const viewing = await page.evaluate(() => ({
    chips: document.querySelectorAll('#group-tags-chips .chip').length,
    removable: document.querySelectorAll('#group-tags-chips .remove-x').length,
    addDisabled: document.getElementById('group-tag-add-select').disabled,
  }));
  // isVisible walks ancestors; getComputedStyle would report the select's own display
  // even when the row containing it is hidden.
  viewing.addHidden = !(await page.isVisible('#group-tag-add-select'));
  ck('view mode shows the tags', viewing.chips > 0);
  ck('view mode offers no remove control', viewing.removable === 0);
  ck('view mode disables adding', viewing.addDisabled && viewing.addHidden);

  // Switching to edit brings the controls back.
  await page.click('#group-edit');
  await page.waitForTimeout(400);
  ck('editing restores remove controls',
    await page.locator('#group-tags-chips .remove-x').count() > 0);

  // The picker once lived in the zero modal. Every id-based check still passed, because
  // ids are global — only "is it actually on screen with the group modal open" catches it.
  ck('the tag picker is visible while the group modal is open',
    await page.isVisible('#group-tag-add-select'));
  ck('the picker is inside the group modal, not another overlay',
    await page.evaluate(() =>
      document.getElementById('group-tag-add-select').closest('.modal-overlay').id === 'modal-group'));

  // The important one: differing case must not create a rival tag.
  const before = await page.evaluate(() => allKnownTags());
  await page.evaluate(() => {
    groupModalTags = [];
    renderGroupTagChips();
    document.getElementById('group-tag-add-select').value = '__custom__';
    document.getElementById('group-tag-custom').value = 'PRONE';
    addGroupTagFromSelect();
  });
  await page.waitForTimeout(250);
  const added = await page.evaluate(() => [...groupModalTags]);
  ck('a differently-cased tag reuses the existing spelling',
    added.length === 1 && before.includes(added[0]) && added[0] !== 'PRONE');

  // Adding the same tag twice does nothing.
  await page.evaluate(t => {
    document.getElementById('group-tag-add-select').value = '__custom__';
    document.getElementById('group-tag-custom').value = t;
    addGroupTagFromSelect();
  }, added[0]);
  await page.waitForTimeout(200);
  ck('adding a tag already present is a no-op',
    (await page.evaluate(() => groupModalTags.length)) === 1);

  // A brand-new tag is kept as typed, and persists through save.
  await page.evaluate(() => {
    document.getElementById('group-tag-add-select').value = '__custom__';
    document.getElementById('group-tag-custom').value = '  windy   day ';
    addGroupTagFromSelect();
  });
  await page.waitForTimeout(200);
  const normalised = await page.evaluate(() => groupModalTags[groupModalTags.length-1]);
  ck('a new tag is trimmed and inner whitespace collapsed', normalised === 'windy day');

  await page.click('#group-save');
  await page.waitForTimeout(700);
  const saved = await page.evaluate(() => {
    const g = JSON.parse(localStorage.getItem('rangeLogData'));
    const grp = g.firearms.flatMap(f => f.groups || []).find(x => (x.tags||[]).includes('windy day'));
    return grp ? [...grp.tags] : null;
  });
  ck('tags persist to storage', !!saved && saved.includes('windy day'));

  await page.locator('#history-groups-list').screenshot({ path: path.join(ARTIFACTS,'tags.png') });

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nGroup tags OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
