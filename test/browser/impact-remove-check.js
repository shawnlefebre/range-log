// Removing one impact is canvas geometry: it depends on the view transform and on where the
// crosshair sits in a laid-out element. jsdom has neither, and the marking state lives in a
// top-level `let` that only page scope can see — so this belongs here.
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

  // A photo is required — you cannot re-mark a group without one, and the demo groups store
  // none. Load the synthetic target the other suites use and mark four holes on it.
  const gunId = await page.evaluate(() => data.firearms[0].id);
  await page.evaluate(async id => { await openLogGroup(id); }, gunId);
  await page.waitForTimeout(300);
  await page.setInputFiles('#group-file', path.join(__dirname, 'target.png'));
  await page.waitForTimeout(500);
  await page.fill('#group-distance', '50');
  await page.fill('#group-cal-w', '1');
  await page.evaluate(() => {
    const n = v => v / G.imgW;
    G.calPts = [{ x: n(400), y: n(500) }, { x: n(500), y: n(500) }];
    G.poa = { x: n(500), y: n(500) };
    G.impacts = [
      { x: n(500), y: n(400) }, { x: n(600), y: n(500) },
      { x: n(500), y: n(600) }, { x: n(400), y: n(500) },
    ];
    G.actions = [];
    G.step = 2;
    gRefresh();
  });
  await page.waitForTimeout(300);

  // Park the view so a chosen impact sits exactly under the crosshair.
  const centreOn = i => page.evaluate(idx => {
    G.step = 2;
    const cv = document.getElementById('group-canvas');
    const p = G.impacts[idx];
    G.view.ox = cv.clientWidth / 2 - p.x * G.imgW * G.view.scale;
    G.view.oy = cv.clientHeight / 2 - p.y * G.imgW * G.view.scale;
    gRefresh();
    return G.impacts.length;
  }, i);

  const total = await centreOn(0);
  ck('a saved group loads with its impacts', total >= 3);
  ck('the crosshair targets the impact under it',
    await page.evaluate(() => gImpactUnderCrosshair()) === 0);

  ck('the prompt names it and offers removal', await page.evaluate(() => {
    const t = document.getElementById('group-prompt').textContent.replace(/\s+/g, ' ');
    return /impact 1/i.test(t) && !!document.querySelector('#group-prompt .link-danger');
  }));
  await page.locator('#group-stage-wrap').screenshot({ path: path.join(ARTIFACTS,'impact-target.png') });

  // Pan clear of every impact: no target, and no destructive control left sitting there.
  await page.evaluate(() => { G.view.ox -= 4000; gDrawCanvas(); });
  await page.waitForTimeout(200);
  ck('nothing targeted once panned away',
    await page.evaluate(() => gImpactUnderCrosshair()) === -1);
  // Assert on the control itself: the idle hint mentions removing, so matching on words
  // would pass whether or not the button was actually gone.
  ck('and the prompt drops the Remove control', await page.evaluate(() =>
    !document.querySelector('#group-prompt .link-danger')));

  // Remove the first impact and confirm the others are untouched.
  await centreOn(0);
  const before = await page.evaluate(() => G.impacts.map(p => p.x + ',' + p.y));
  await page.evaluate(() => groupRemoveImpact());
  const after = await page.evaluate(() => G.impacts.map(p => p.x + ',' + p.y));
  ck('removing takes the targeted impact, not the newest',
    after.length === before.length - 1 &&
    JSON.stringify(after) === JSON.stringify(before.slice(1)));

  // Undo restores it at its original index.
  await page.evaluate(() => groupUndo());
  const restored = await page.evaluate(() => G.impacts.map(p => p.x + ',' + p.y));
  ck('undo puts it back where it was', JSON.stringify(restored) === JSON.stringify(before));

  // The trap: undo after a removal must not pop a good point instead.
  await centreOn(0);
  await page.evaluate(() => groupRemoveImpact());
  await page.evaluate(() => groupUndo());
  ck('undo after removal does not eat a good point',
    (await page.evaluate(() => G.impacts.length)) === before.length);

  // Zoom tightens the target, which is how two nearly-touching holes get separated.
  await centreOn(1);
  ck('centered on another impact targets that one',
    await page.evaluate(() => gImpactUnderCrosshair()) === 1);
  await page.evaluate(() => { G.view.scale *= 5;
    const cv = document.getElementById('group-canvas');
    const p = G.impacts[1];
    G.view.ox = cv.clientWidth / 2 - p.x * G.imgW * G.view.scale;
    G.view.oy = cv.clientHeight / 2 - p.y * G.imgW * G.view.scale;
    G.view.ox -= 40; gDrawCanvas(); });
  await page.waitForTimeout(200);
  ck('a small pan while zoomed in lets go of it',
    await page.evaluate(() => gImpactUnderCrosshair()) === -1);

  // The Remove control in the prompt actually works when tapped.
  await centreOn(2);
  const n0 = await page.evaluate(() => G.impacts.length);
  await page.click('#group-prompt .link-danger');
  await page.waitForTimeout(250);
  ck('tapping Remove in the prompt removes it',
    (await page.evaluate(() => G.impacts.length)) === n0 - 1);

  ck('Set point remains the primary action throughout',
    (await page.locator('#group-set').textContent()).trim() === 'Set point');

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nImpact removal OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
