// The point of capping is a Details modal that stays a reasonable height. jsdom can count
// rows but has no layout, so only a real browser can show that expanding a long list
// doesn't grow the modal past the viewport.
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
  page.on('dialog', d => d.accept());
  await page.goto(URL);
  await page.waitForSelector('#app-version');
  const checks=[]; const ck=(n,ok)=>checks.push([n,ok]);

  // Give the demo rifle a realistic pile of groups by cloning the ones it ships with.
  // The total is read back rather than hardcoded, so changing how many groups the sample
  // data carries can't turn this into a false failure.
  const total = await page.evaluate(() => {
    const gun = data.firearms.find(g => (g.groups || []).length);
    const seed = gun.groups[0];
    for (let i = 0; i < 44; i++) {
      const d = new Date(2026, 7, 2); d.setDate(d.getDate() - i * 8);
      gun.groups.push({ ...seed, id: 'bulk_' + i, date: d.toISOString().slice(0,10) });
    }
    save(data);
    return gun.groups.length;
  });

  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(400);

  const rowCount = () => page.locator('#history-groups-list > div').count();
  ck('groups land capped at 5', await rowCount() === 5);
  ck('the control names the full count',
    new RegExp(`Show all ${total}`).test(await page.locator('#show-all-groups').textContent()));

  const modalH = () => page.evaluate(() =>
    document.querySelector('#modal-history .modal').getBoundingClientRect().height);
  const capped = await modalH();
  await page.locator('#modal-history .modal').screenshot({ path: path.join(ARTIFACTS,'details-capped.png') });

  await page.click('#show-all-groups');
  await page.waitForTimeout(400);
  ck('expanding renders every group', await rowCount() === total);
  ck('the control offers the way back',
    /Show fewer/.test(await page.locator('#show-all-groups').textContent()));

  const expanded = await modalH();
  // Dozens of rows at ~64px each would add thousands of px if the modal simply grew.
  ck('expanding does not stretch the modal past the viewport', expanded < 900 * 1.6);
  ck('the expanded section is a scroll panel', await page.evaluate(() =>
    document.getElementById('history-groups-list').classList.contains('list-scroll')));

  const panel = await page.evaluate(() => {
    const b = document.getElementById('history-groups-list');
    return { client: b.clientHeight, scroll: b.scrollHeight, atEnd: b.classList.contains('at-end') };
  });
  ck('the panel is bounded, with content beyond it', panel.scroll > panel.client && panel.client > 100);
  ck('the fade is showing while there is more below', panel.atEnd === false);
  await page.locator('#modal-history .modal').screenshot({ path: path.join(ARTIFACTS,'details-expanded.png') });

  // Scrolling to the bottom must lift the fade.
  await page.evaluate(() => {
    const b = document.getElementById('history-groups-list');
    b.scrollTop = b.scrollHeight;
  });
  await page.waitForTimeout(250);
  ck('the fade lifts at the end of the list', await page.evaluate(() =>
    document.getElementById('history-groups-list').classList.contains('at-end')));

  // Collapsing puts it back.
  await page.click('#show-all-groups');
  await page.waitForTimeout(300);
  ck('collapsing returns to the cap', await rowCount() === 5);
  ck('collapsing drops the panel', await page.evaluate(() =>
    !document.getElementById('history-groups-list').classList.contains('list-scroll')));
  ck('the modal returns to its capped height', Math.abs(await modalH() - capped) < 4);

  // Reopening resets it.
  await page.click('#show-all-groups');
  await page.waitForTimeout(250);
  await page.click('#modal-history .btn-secondary:has-text("Close")');
  await page.waitForTimeout(300);
  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(400);
  ck('reopening Details lands capped again', await rowCount() === 5);

  // Sections at or under their cap are untouched.
  ck('a short section offers no control',
    !(await page.isVisible('#show-all-zeros')) || await page.evaluate(() =>
      document.getElementById('show-all-zeros').style.display === 'none'));

  // The expanded panel is meant to be a mini view: clearly a fraction of the screen so the
  // page still scrolls around it, but tall enough to read several rows without scrolling
  // inside it for every one. Checked at the default text size, where rows are tallest for
  // the size most people will actually use.
  await page.click('#show-all-groups');
  await page.waitForTimeout(350);
  const miniView = await page.evaluate(() => {
    const l = document.getElementById('history-groups-list');
    const rows = [...l.querySelectorAll('.group-row')];
    const h = l.clientHeight;
    let visible = 0, acc = 0;
    rows.forEach(r => { const rh = r.getBoundingClientRect().height + 6;
      if (acc + rh <= h) { visible++; acc += rh; } });
    return { h, visible, vh: window.innerHeight,
             rowH: Math.round(rows[0].getBoundingClientRect().height) };
  });
  ck('the panel is a fraction of the screen, not all of it',
    miniView.h < miniView.vh * 0.7 && miniView.h > miniView.vh * 0.4);
  ck('several rows are readable without scrolling inside it', miniView.visible >= 3);
  if (miniView.visible < 3) {
    console.log(`     only ${miniView.visible} rows fit (${miniView.rowH}px each)`);
  }

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nCapped Details lists OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
