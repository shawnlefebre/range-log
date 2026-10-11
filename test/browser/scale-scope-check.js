// A curled or wrinkled target isn't a plane, and no single transform — the 4-corner
// homography included — can rectify one. So a group whose cluster sits where the paper
// misbehaves can be measured against its own reference, marked beside it. The logic has
// unit cover; what needs a real browser is the part that only exists on screen: the panel
// that says which reference you are on, the button out of it, the dashed guide drawn over
// the photo while the new one is marked, and the list labels that make a divergence visible.
const { chromium } = require('playwright');
const path = require('path');
const d = __dirname;
const ARTIFACTS = path.join(__dirname, '.artifacts');
require('fs').mkdirSync(ARTIFACTS, { recursive: true });
const URL = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 },
    deviceScaleFactor: 2, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', dlg => dlg.accept());
  await page.goto(URL);
  await page.waitForSelector('#app-version');
  const checks = []; const ck = (n, ok) => checks.push([n, ok]);

  const gunId = await page.evaluate(() => data.firearms[0].id);
  await page.evaluate(async id => { await openLogGroup(id); }, gunId);
  await page.waitForTimeout(300);
  await page.setInputFiles('#group-file', path.join(d, 'target.png'));
  await page.waitForTimeout(600);
  await page.fill('#group-distance', '100');
  await page.fill('#group-cal-w', '1');

  const markGroup = (cx, cy) => page.evaluate(([cx, cy]) => {
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

  const finish = async () => { await page.click('#group-next'); await page.waitForTimeout(600); };
  const another = async () => { await page.click('#group-another'); await page.waitForTimeout(300); };
  const rows = () => page.evaluate(() =>
    [...document.querySelectorAll('#group-marked .marked-row')]
      .map(r => r.textContent.replace(/\s+/g, ' ').trim()));
  const stateText = () => page.evaluate(() => {
    const el = document.getElementById('group-scale-state');
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  });

  // One group: there is nothing to share a reference with, so the panel stays out of the way.
  await markGroup(300, 300);
  await finish();
  ck('no scale panel while the photo carries one group', (await stateText()) === '');

  // Three groups, all inheriting the reference marked for the first.
  await another(); await markGroup(700, 300); await finish();
  await another(); await markGroup(500, 700); await finish();
  ck('three groups written off one photo',
    await page.evaluate(() => G.saved.length) === 3);
  ck('the panel says the reference is shared, and by how many',
    /shared reference/i.test(await stateText()) && /3 groups/.test(await stateText()));
  ck('every row reports a shared scale',
    (await rows()).filter(t => /shared scale/.test(t)).length === 3);

  const sharedPts = await page.evaluate(() =>
    data.firearms[0].groups.find(g => g.id === G.saved[0]).calPts.map(p => p.x));

  // Break the third group out: its points clear, and the flow goes back to the scale step.
  await page.click('#group-scale-state button');
  await page.waitForTimeout(300);
  ck('breaking out returns to the scale step', await page.evaluate(() => G.step) === 0);
  ck('breaking out clears this group\'s marks', await page.evaluate(() => G.calPts.length) === 0);
  ck('the reference being replaced is kept to draw',
    await page.evaluate(() => (G.scaleInherited || []).length) === 2);
  ck('the panel switches to counting out the new marks',
    /0 of 2 placed/.test(await stateText()));

  // The dashed guide has to actually reach the canvas — a blank stage here would mean the
  // old reference vanished the moment you went to replace it.
  const painted = await page.evaluate(() => {
    const cv = document.getElementById('group-canvas');
    const ctx = cv.getContext('2d');
    const { data: px } = ctx.getImageData(0, 0, cv.width, cv.height);
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 40) lit++;
    return lit;
  });
  ck('the photo and the guide are still drawn while re-marking', painted > 1000);
  await page.locator('#group-stage-wrap').screenshot({ path: path.join(ARTIFACTS, 'scale-remark.png') });

  // Mark a reference beside this cluster and give it its own length.
  await page.evaluate(() => {
    const n = v => v / G.imgW;
    G.calPts = [{ x: n(430), y: n(760) }, { x: n(530), y: n(760) }];
    G.step = 3;
    gRefresh();
  });
  await page.fill('#group-cal-w', '2');
  await page.waitForTimeout(400);

  const scales = await page.evaluate(() => {
    const gun = data.firearms[0];
    return G.saved.map(id => {
      const g = gun.groups.find(x => x.id === id);
      return { inches: g.calInches, x0: g.calPts[0].x };
    });
  });
  ck('the group on its own reference takes the new length', scales[2].inches === 2);
  ck('the groups sharing the old one are untouched',
    scales[0].inches === 1 && scales[1].inches === 1);
  ck('and keep the points they were measured against',
    Math.abs(scales[0].x0 - sharedPts[0]) < 1e-9 && Math.abs(scales[1].x0 - sharedPts[0]) < 1e-9);
  ck('the broken-out group kept its own points', Math.abs(scales[2].x0 - scales[0].x0) > 1e-6);

  ck('the list now distinguishes the two', await (async () => {
    const t = await rows();
    return /own scale/.test(t[2]) && /shared scale/.test(t[0]) && /shared scale/.test(t[1]);
  })());
  ck('the panel offers the way back', /use shared/i.test(await stateText()));
  await page.locator('#group-marked').screenshot({ path: path.join(ARTIFACTS, 'scale-rows.png') });

  // Rejoining puts it back on the reference the rest of the photo uses.
  await page.click('#group-scale-state button');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const gun = data.firearms[0];
    return G.saved.map(id => gun.groups.find(x => x.id === id))
      .map(g => ({ inches: g.calInches, x0: g.calPts[0].x }));
  });
  ck('rejoining restores the shared length', after.every(s => s.inches === 1));
  ck('rejoining restores the shared points',
    after.every(s => Math.abs(s.x0 - sharedPts[0]) < 1e-9));
  ck('every row reads shared again',
    (await rows()).filter(t => /shared scale/.test(t)).length === 3);

  // Ammo is per group now; the distance is still the target's.
  await page.evaluate(() => {
    const sel = document.getElementById('group-ammo-select');
    sel.innerHTML = '<option value="77gr SMK">77gr SMK</option>';
    sel.value = '77gr SMK';
    handleGroupAmmoChange();
  });
  await page.waitForTimeout(300);
  await page.fill('#group-distance', '200');
  await page.waitForTimeout(400);
  const scoped = await page.evaluate(() => {
    const gun = data.firearms[0];
    const recs = G.saved.map(id => gun.groups.find(x => x.id === id));
    return { ammo: recs.map(r => r.ammo || ''), dist: recs.map(r => r.distance) };
  });
  ck('a load set on one group stays on that group',
    scoped.ammo[2] === '77gr SMK' && scoped.ammo[0] !== '77gr SMK');
  ck('a corrected distance still reaches every group',
    scoped.dist.every(v => v === 200));

  ck('no page errors', errs.length === 0);

  await browser.close();
  const bad = checks.filter(c => !c[1]);
  checks.forEach(([n, ok]) => console.log(`${ok ? '✔' : '✖'} ${n}`));
  if (errs.length) errs.forEach(e => console.log('  page error:', e));
  console.log(bad.length ? `✖ ${bad.length} failed` : `✔ all ${checks.length} passed`);
  process.exit(bad.length ? 1 : 0);
})();
