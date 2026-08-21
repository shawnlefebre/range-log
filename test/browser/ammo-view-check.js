// A purchase is reference you scan far more often than you edit, so tapping it must read
// rather than open an editor. This drives the real card and modal.
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

  await page.evaluate(() => showTab('ammo'));
  await page.waitForTimeout(300);
  ck('purchases render', await page.locator('.ammo-card').count() > 0);

  // Tap the body of the card, away from its buttons.
  await page.locator('.ammo-card').first().click({ position: { x: 60, y: 18 } });
  await page.waitForTimeout(350);
  ck('tapping a purchase opens it read-only', await page.evaluate(() =>
    document.getElementById('modal-ammo').classList.contains('viewing')));
  ck('view mode really disables the fields', await page.evaluate(() =>
    ['ammo-date','ammo-quantity','ammo-price','ammo-status','ammo-not-range','ammo-notes']
      .every(id => document.getElementById(id).disabled)));
  ck('view mode offers Edit rather than Save', await page.evaluate(() => {
    const t = document.getElementById('ammo-buttons').textContent;
    return /Edit/.test(t) && !/Save/.test(t);
  }));
  await page.locator('#modal-ammo .modal').screenshot({ path: path.join(ARTIFACTS,'ammo-view.png') });

  await page.click('#ammo-buttons .btn-primary');
  await page.waitForTimeout(300);
  ck('Edit unlocks the fields', await page.evaluate(() =>
    !document.getElementById('modal-ammo').classList.contains('viewing') &&
    !document.getElementById('ammo-quantity').disabled));
  await page.click('#ammo-buttons .btn-secondary');
  await page.waitForTimeout(300);

  // The card's own buttons must not also trigger the card.
  const before = await page.locator('.ammo-card').first().textContent();
  await page.locator('.ammo-card').first().locator('.btn-mini', { hasText: /Mark/ }).click();
  await page.waitForTimeout(350);
  ck('a card button acts without opening the view',
    !(await page.isVisible('#modal-ammo')) &&
    before !== await page.locator('.ammo-card').first().textContent());

  await page.locator('.ammo-card').first().locator('.btn-mini', { hasText: 'Edit' }).click();
  await page.waitForTimeout(350);
  ck('the Edit button goes straight to editing', await page.evaluate(() =>
    !document.getElementById('modal-ammo').classList.contains('viewing')));
  await page.click('#ammo-buttons .btn-secondary');
  await page.waitForTimeout(250);

  await page.click('#tab-ammo button:has-text("+ Log Purchase")');
  await page.waitForTimeout(300);
  ck('adding after viewing is not stuck inert', await page.evaluate(() =>
    !document.getElementById('modal-ammo').classList.contains('viewing') &&
    !document.getElementById('ammo-date').disabled));

  // The previous section leaves the add form open; a modal overlay swallows card clicks.
  await page.click('#ammo-buttons .btn-secondary');
  await page.waitForTimeout(250);

  // The mis-tap sequence, driven through the actual buttons.
  await page.selectOption('#ammo-filter-stock', 'all');
  await page.waitForTimeout(250);
  const card = () => page.locator('.ammo-card').first();
  const pill = async () => (await card().locator('.ammo-status-pill').textContent()).trim();

  // Get the first card into a known in-stock state.
  if (/Used up/.test(await pill())) {
    await card().locator('.btn-mini', { hasText: /Mark in stock/ }).click();
    await page.waitForTimeout(300);
  }
  await card().locator('.btn-mini', { hasText: /Mark used up/ }).click();
  await page.waitForTimeout(300);
  const stamped = await pill();
  ck('marking used up records the date', /Used up \w/.test(stamped));

  // Mis-tap back, then correct it. The date must be the original, not today's re-stamp.
  await card().locator('.btn-mini', { hasText: /Mark in stock/ }).click();
  await page.waitForTimeout(300);
  await card().locator('.btn-mini', { hasText: /Mark used up/ }).click();
  await page.waitForTimeout(300);
  ck('correcting a mis-tap keeps the original date', (await pill()) === stamped);

  // And the date field only appears against a used-up lot.
  await card().locator('.btn-mini', { hasText: 'Edit' }).click();
  await page.waitForTimeout(300);
  ck('the used-up date field is shown for a used-up lot',
    await page.isVisible('#ammo-usedup-field'));
  await page.selectOption('#ammo-status', 'instock');
  await page.waitForTimeout(200);
  ck('and hidden once it is back in stock', !(await page.isVisible('#ammo-usedup-field')));
  await page.click('#ammo-buttons .btn-secondary');
  await page.waitForTimeout(250);

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nAmmo view/edit OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
