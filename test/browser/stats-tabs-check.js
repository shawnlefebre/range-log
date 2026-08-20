// The sub-tabs are pure layout, which jsdom cannot see. This checks that exactly one pane
// is actually visible, that the moved charts still draw, and that switching panes doesn't
// leave a canvas or chart sized to a hidden container.
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

  await page.evaluate(() => showTab('stats'));
  await page.waitForTimeout(400);

  ck('four sub-tabs are present', await page.locator('.stats-subtabs button').count() === 4);
  ck('the sub-tab row fits on one line without wrapping', await page.evaluate(() => {
    const bs = [...document.querySelectorAll('.stats-subtabs button')];
    return new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))).size === 1;
  }));

  const visible = async () => page.evaluate(() =>
    ['groups','practice','money','upkeep'].filter(n =>
      document.getElementById('statspane-' + n).offsetParent !== null));

  ck('landing on Stats shows exactly one pane',
    JSON.stringify(await visible()) === JSON.stringify(['practice']));

  for (const name of ['groups','money','upkeep','practice']) {
    await page.click('#statstab-' + name);
    await page.waitForTimeout(300);
    const v = await visible();
    ck(`${name}: only its own pane is visible`, v.length === 1 && v[0] === name);
  }

  // The charts moved between containers — make sure they still have real width where they
  // now live, which is the failure mode when something renders inside a hidden pane.
  await page.click('#statstab-practice');
  await page.waitForTimeout(300);
  const rf = await page.evaluate(() => {
    const el = document.querySelector('#stats-rf-chart .stats-bar-track, #stats-rf-chart');
    return { html: document.getElementById('stats-rf-chart').innerHTML.length,
             w: el ? el.getBoundingClientRect().width : 0 };
  });
  ck('Rounds Fired still renders with real width', rf.html > 0 && rf.w > 50);

  await page.click('#statstab-money');
  await page.waitForTimeout(300);
  const as = await page.evaluate(() => ({
    html: document.getElementById('stats-as-chart').innerHTML.length,
    w: document.getElementById('stats-as-chart').getBoundingClientRect().width }));
  ck('Ammo Spend still renders with real width', as.html > 0 && as.w > 50);

  await page.click('#statstab-upkeep');
  await page.waitForTimeout(300);
  const up = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#stats-upkeep-cleaning .breakdown-row')];
    return { n: rows.length,
      widths: rows.map(r => parseFloat(r.querySelector('.breakdown-bar-fill').style.width)),
      labels: rows.map(r => r.querySelector('.breakdown-pct').textContent) };
  });
  ck('Upkeep lists every firearm', up.n > 0);
  ck('Upkeep is sorted worst-first',
    up.widths.every((w, i) => i === 0 || w <= up.widths[i - 1] + 0.001));
  ck('Upkeep states the condition in words, not just colour',
    up.labels.every(l => /ok|due soon|past due/.test(l)));
  await page.locator('#tab-stats').screenshot({ path: path.join(ARTIFACTS,'stats-upkeep.png') });

  await page.click('#statstab-groups');
  await page.waitForTimeout(300);
  ck('Groups shows a placeholder rather than a blank pane',
    (await page.locator('#statspane-groups').textContent()).trim().length > 20);
  await page.locator('#tab-stats').screenshot({ path: path.join(ARTIFACTS,'stats-groups.png') });

  // Leaving Stats and coming back must not land on a blank tab.
  await page.evaluate(() => showTab('dashboard'));
  await page.waitForTimeout(200);
  await page.evaluate(() => showTab('stats'));
  await page.waitForTimeout(300);
  ck('returning to Stats restores a visible pane', (await visible()).length === 1);

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nStats sub-tabs OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
