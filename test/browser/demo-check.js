// Loading demo data destroys whatever is stored, so the guard matters as much as the
// feature. This drives it through Settings the way it is actually reached.
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
  await page.goto(URL);
  await page.waitForSelector('#app-version');
  const checks=[]; const ck=(n,ok)=>checks.push([n,ok]);
  // One persistent handler with a counter: a `once` registered for a dialog that never
  // arrives stays armed and steals the next one.
  let dialogs = 0;
  page.on('dialog', d => { dialogs++; d.accept(); });

  // Give the app a photo, so we can prove the blob store is cleared with the records.
  await page.evaluate(async () => {
    await putPhoto('orphan_test', new Blob([new Uint8Array(2048)], { type:'image/jpeg' }));
  });
  ck('a photo is stored to begin with',
    (await page.evaluate(() => allPhotoKeys().then(ids => ids.length))) > 0);

  await page.click('nav button:has-text("Setup"), header button:has-text("Setup")').catch(()=>{});
  await page.evaluate(() => showTab('settings'));
  await page.waitForTimeout(300);
  ck('the Danger Zone offers Load Demo Data',
    await page.isVisible('button:has-text("Load Demo Data")'));

  // Populated app: a typed word is required, and no plain dialog may appear.
  await page.click('#tab-settings button:has-text("Load Demo Data")');
  await page.waitForTimeout(400);
  ck('a populated app opens the type-to-confirm modal',
    await page.isVisible('#modal-load-demo'));
  ck('a populated app is never offered a plain confirm', dialogs === 0);
  ck('the button starts inert', await page.evaluate(() =>
    getComputedStyle(document.getElementById('load-demo-confirm-btn')).pointerEvents === 'none'));

  await page.fill('#load-demo-confirm-input', 'demo');
  await page.waitForTimeout(150);
  ck('lowercase does not arm it', await page.evaluate(() =>
    getComputedStyle(document.getElementById('load-demo-confirm-btn')).pointerEvents === 'none'));

  await page.fill('#load-demo-confirm-input', 'DEMO');
  await page.waitForTimeout(150);
  ck('DEMO arms it', await page.evaluate(() =>
    getComputedStyle(document.getElementById('load-demo-confirm-btn')).pointerEvents === 'auto'));
  await page.locator('#modal-load-demo .modal').screenshot({ path: path.join(ARTIFACTS,'demo-confirm.png') });

  await page.click('#load-demo-confirm-btn');
  await page.waitForTimeout(700);

  ck('the modal closes', !(await page.isVisible('#modal-load-demo')));
  ck('it lands on the dashboard', await page.isVisible('#tab-dashboard'));
  ck('the demo banner is back', await page.isVisible('.demo-banner'));

  const after = await page.evaluate(async () => {
    const d = JSON.parse(localStorage.getItem('rangeLogData'));
    return { guns: d.firearms.length, sessions: d.sessions.length, isDemo: d.isDemo,
             photos: (await allPhotoKeys()).length };
  });
  ck('sample firearms and sessions are loaded', after.guns > 0 && after.sessions > 0);
  ck('the data is flagged as demo', after.isDemo === true);
  ck('stored photos are cleared, not orphaned', after.photos === 0);

  // Empty app: one plain confirm, no typing.
  await page.evaluate(() => { showTab('settings'); wipeAllData(); showTab('settings'); });
  await page.waitForTimeout(300);
  await page.click('#tab-settings button:has-text("Load Demo Data")');
  await page.waitForTimeout(700);
  ck('an empty app asks once and skips the modal',
    dialogs === 1 && !(await page.isVisible('#modal-load-demo')));
  ck('demo data loads from the plain confirm too', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('rangeLogData')).firearms.length > 0));

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nLoad demo data OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
