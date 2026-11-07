// "Keep the photo" sits right under the marking buttons, so a missed tap unchecks it, and a
// group saved without its photo can never be re-marked. Saving that way is asked about
// first — on Done and on Save, with Keep photo as the answer that undoes the slip.
const { chromium } = require('playwright');
const path = require('path');
const d = __dirname;
const ARTIFACTS = path.join(__dirname, '.artifacts');
require('fs').mkdirSync(ARTIFACTS, { recursive: true });
const URL = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', dlg => dlg.accept());
  await page.goto(URL);
  await page.waitForSelector('#app-version');
  const checks = []; const ck = (n, ok) => checks.push([n, ok]);

  const gunWithGroups = () => page.evaluate(() =>
    data.firearms.find(g => (g.groups || []).length));
  const groupCount = async () => (await gunWithGroups()).groups.length;
  const asking = () => page.locator('#group-photo-confirm .photo-drop-confirm').isVisible();
  const uncheck = () => page.evaluate(() => {
    document.getElementById('group-keep-photo').checked = false;
  });

  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(250);
  const before = await groupCount();

  const openNew = async () => {
    await page.click('button.btn-mini:has-text("+ Add Group")');
    await page.waitForTimeout(300);
    await page.setInputFiles('#group-file', path.join(d, 'target.png'));
    await page.waitForTimeout(700);
    await page.fill('#group-distance', '100');
    await page.fill('#group-cal-w', '1');
  };
  const markGroup = (cx, cy) => page.evaluate(([cx, cy]) => {
    const n = v => v / G.imgW;
    if (!G.calPts.length) G.calPts = [{ x: n(400), y: n(500) }, { x: n(500), y: n(500) }];
    G.poa = { x: n(cx), y: n(cy) };
    G.impacts = [{ x: n(cx), y: n(cy - 40) }, { x: n(cx + 40), y: n(cy) },
                 { x: n(cx), y: n(cy + 40) }];
    G.step = 2;
    gRefresh();
  }, [cx, cy]);

  // ── checked: no question at all ──────────────────────────────────────────
  await openNew();
  await markGroup(300, 300);
  await page.click('#group-next');
  await page.waitForTimeout(600);
  ck('with the box checked, Done saves without asking',
    !(await asking()) && await page.evaluate(() => G.saved.length) === 1);

  // ── unchecked, Done: asked, and Keep photo saves with it ─────────────────
  await page.click('#group-another');
  await page.waitForTimeout(300);
  await markGroup(600, 300);
  await uncheck();
  await page.click('#group-next');
  await page.waitForTimeout(400);
  ck('unchecked, Done asks before saving', await asking());
  ck('and has not saved yet', await page.evaluate(() => G.saved.length) === 1);
  await page.locator('#group-photo-confirm').screenshot(
    { path: path.join(ARTIFACTS, 'keep-photo-confirm.png') });
  await page.click('#group-photo-confirm button:has-text("Keep photo")');
  await page.waitForTimeout(600);
  const kept = await page.evaluate(() => {
    const gun = data.firearms.find(g => g.id === G.gunId);
    const rec = gun.groups.find(g => g.id === G.saved[G.saved.length - 1]);
    return { saved: G.saved.length, photo: rec && rec.photoId,
             box: document.getElementById('group-keep-photo').checked };
  });
  ck('Keep photo saves the group', kept.saved === 2);
  ck('with its photo', !!kept.photo);
  ck('and re-checks the box', kept.box);
  ck('the question goes away', !(await asking()));

  // ── unchecked, Save: asked, and Save without photo honors it ─────────────
  await page.click('#group-another');
  await page.waitForTimeout(300);
  await markGroup(300, 600);
  await uncheck();
  await page.click('#group-save');
  await page.waitForTimeout(400);
  ck('unchecked, Save asks too', await asking());
  ck('the form stays open while it asks',
    await page.evaluate(() => document.getElementById('modal-group').classList.contains('open')));
  await page.click('#group-photo-confirm button:has-text("Save without photo")');
  await page.waitForTimeout(700);
  ck('Save without photo closes the form',
    !(await page.evaluate(() => document.getElementById('modal-group').classList.contains('open'))));
  const gun = await gunWithGroups();
  const newest = gun.groups.slice(-3);
  ck('all three groups were written', (await groupCount()) === before + 3);
  ck('the last was saved without a photo', newest[2].photoId === null);
  ck('the first two keep theirs, and the stored photo survives',
    !!newest[0].photoId && newest[0].photoId === newest[1].photoId &&
    (await page.evaluate(() => allPhotoKeys())).includes(newest[0].photoId));

  // ── re-checking by hand clears a pending question ─────────────────────────
  await openNew();
  await markGroup(300, 300);
  await uncheck();
  await page.click('#group-next');
  await page.waitForTimeout(400);
  await page.click('#group-keep-photo');
  await page.waitForTimeout(100);
  ck('re-checking the box by hand withdraws the question', !(await asking()));

  // ── a group with no photo loaded has nothing to lose ─────────────────────
  const noPhoto = await page.evaluate(async () => {
    const gun = data.firearms.find(g => (g.groups || []).some(x => !x.photoId));
    const grp = gun.groups.find(x => !x.photoId);
    await openLogGroup(gun.id, grp.id);
    if (G.readOnly) groupEnterEdit();
    return { gun: gun.id, id: grp.id };
  });
  await page.waitForTimeout(300);
  await page.click('#group-save');
  await page.waitForTimeout(500);
  ck('a group without a photo saves without asking',
    !(await asking()) &&
    !(await page.evaluate(() => document.getElementById('modal-group').classList.contains('open'))));

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS ' + [...new Set(errs)].join(' | ')); }
  console.log(bad === 0 ? '\nKeep photo OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
