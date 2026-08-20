// A target usually carries several groups. Scale is marked once, aim and impacts repeat,
// and each group is written as it's finished. The photo is shared, which is where the
// dangerous bug lives: deleting one group must not take the image from the others.
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
  const photoKeys = () => page.evaluate(() => allPhotoKeys());

  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(250);
  const before = await page.locator('#history-groups-list .group-row').count();
  await page.click('button.btn-mini:has-text("+ Add Group")');
  await page.waitForTimeout(300);
  await page.setInputFiles('#group-file', path.join(d, 'target.png'));
  await page.waitForTimeout(700);
  await page.fill('#group-distance', '100');
  await page.fill('#group-cal-w', '1');

  // Scale once, then three groups at different aim points on the same photo.
  const markGroup = async (cx, cy) => page.evaluate(([cx, cy]) => {
    const n = v => v / G.imgW;
    if (!G.calPts.length) G.calPts = [{ x: n(400), y: n(500) }, { x: n(500), y: n(500) }];
    G.poa = { x: n(cx), y: n(cy) };
    G.impacts = [
      { x: n(cx), y: n(cy - 40) }, { x: n(cx + 40), y: n(cy) },
      { x: n(cx), y: n(cy + 40) }, { x: n(cx - 40), y: n(cy) },
    ];
    G.step = 2;
    gRefresh();
  }, [cx, cy]);

  await markGroup(300, 300);
  await page.click('#group-next');            // Done → writes group 1
  await page.waitForTimeout(600);
  ck('finishing a group writes it immediately', await page.evaluate(() => G.saved.length) === 1);
  ck('one photo stored after the first group', (await photoKeys()).length === 1);
  ck('the marked list appears', await page.locator('#group-marked .marked-row').count() === 1);

  const calAfter = await page.evaluate(() => G.calPts.length);
  await page.click('#group-another');
  await page.waitForTimeout(300);
  ck('marking another keeps the scale', await page.evaluate(() => G.calPts.length) === calAfter);
  ck('marking another clears the aim point', await page.evaluate(() => G.poa === null));
  ck('it returns to the aim step', await page.evaluate(() => G.step) === 1);

  await markGroup(700, 300);
  await page.click('#group-next');
  await page.waitForTimeout(600);
  await page.click('#group-another');
  await page.waitForTimeout(250);
  await markGroup(500, 700);
  await page.click('#group-next');
  await page.waitForTimeout(600);

  ck('three groups marked on one photo', await page.evaluate(() => G.saved.length) === 3);
  ck('still only one photo stored', (await photoKeys()).length === 1);
  await page.locator('#group-marked').screenshot({ path: path.join(ARTIFACTS, 'multigroup.png') });

  // Correcting a shared field must reach the groups already written.
  await page.fill('#group-distance', '200');
  await page.waitForTimeout(500);
  const distances = await page.evaluate(() => {
    const gun = data.firearms.find(x => x.id === G.gunId);
    return G.saved.map(id => gun.groups.find(g => g.id === id).distance);
  });
  ck('a corrected distance reaches every group from this photo',
    distances.length === 3 && distances.every(v => v === 200));

  await page.click('#group-cancel');
  await page.waitForTimeout(500);
  // The list caps at 5 rows, so expand it before counting — otherwise this measures the
  // cap rather than whether the groups were written.
  if (await page.isVisible('#show-all-groups')) {
    await page.click('#show-all-groups');
    await page.waitForTimeout(300);
  }
  const after = await page.locator('#history-groups-list .group-row').count();
  ck('all three appear in the firearm\'s list', after === before + 3);

  // The dangerous one: deleting a group that shares its photo.
  await page.locator('#history-groups-list .group-row').filter({ hasText: '📷' })
    .first().locator('button[title="Delete"]').click();
  await page.waitForTimeout(700);
  ck('deleting one shared-photo group keeps the photo for the rest',
    (await photoKeys()).length === 1);

  // Removing the last one should finally release it.
  for (let i = 0; i < 2; i++) {
    const row = page.locator('#history-groups-list .group-row').filter({ hasText: '📷' }).first();
    if (await row.count()) { await row.locator('button[title="Delete"]').click(); await page.waitForTimeout(600); }
  }
  ck('the photo is released once the last group referencing it goes',
    (await photoKeys()).length === 0);

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nSeveral groups per photo OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
