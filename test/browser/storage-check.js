const { chromium } = require('playwright');
const path = require('path');
const d = __dirname;
// Run artifacts (screenshots) go to an ignored folder, not the fixture directory.
const ARTIFACTS = path.join(__dirname, '.artifacts');
require('fs').mkdirSync(ARTIFACTS, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ viewport:{width:430,height:900}, deviceScaleFactor:2, serviceWorkers:'block' });
  const p = await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('dialog', dlg => dlg.accept());
  await p.goto((process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html'));
  await p.waitForSelector('#app-version');
  const checks=[]; const ck=(n,ok)=>checks.push([n,ok]);
  const keyCount = () => p.evaluate(() => allPhotoKeys().then(k => k.length));

  await p.click('button.btn-clean:has-text("View Details")');
  await p.waitForTimeout(250);
  await p.click('button.btn-mini:has-text("+ Add Group")');
  await p.waitForTimeout(300);
  await p.setInputFiles('#group-file', path.join(d, 'target.png'));
  await p.waitForTimeout(700);
  await p.fill('#group-distance','50');
  await p.evaluate(() => {
    const n = v => v / G.imgW;
    G.calPts=[{x:n(400),y:n(500)},{x:n(500),y:n(500)}];
    G.poa={x:n(500),y:n(500)};
    G.impacts=[{x:n(500),y:n(400)},{x:n(600),y:n(500)},{x:n(500),y:n(600)},{x:n(400),y:n(500)}];
    G.step=3; gRefresh();
  });
  await p.click('#modal-group .btn-primary:has-text("Save")');
  await p.waitForTimeout(900);
  ck('a photo is stored', await keyCount() === 1);

  // Saving returns to Details, so close it before leaving the tab.
  await p.evaluate(() => { restoreHistoryGunId = null; closeModal('modal-history'); });
  await p.waitForTimeout(300);

  await p.click('button[onclick="showTab(\'settings\')"]');
  await p.waitForTimeout(800);
  const nums = await p.locator('.photo-stat-num').allTextContents();
  ck('readout shows the stored photo', nums[0].trim() === '1' && /\d/.test(nums[1]));
  await p.locator('#photo-storage').screenshot({ path: ARTIFACTS + '/photo-storage.png' });

  await p.evaluate(() => wipeAllData());
  await p.waitForTimeout(800);
  ck('wiping all data clears photos too', await keyCount() === 0);

  await p.evaluate(() => putPhoto('orphan-1', new Blob(['x'.repeat(2048)])));
  await p.waitForTimeout(400);
  const stats = await p.evaluate(() => photoStoreStats());
  ck('an unattached photo is counted as an orphan', stats.orphans === 1);
  await p.evaluate(() => renderPhotoStorage());
  await p.waitForTimeout(400);
  ck('orphans are surfaced in Settings', await p.locator('.photo-orphans').count() === 1);
  await p.evaluate(() => reclaimOrphanedPhotos());
  await p.waitForTimeout(600);
  ck('reclaim removes the orphan', await keyCount() === 0);

  await p.evaluate(async () => {
    await putPhoto('keepme', new Blob(['y'.repeat(1024)]));
    await putPhoto('dropme', new Blob(['z'.repeat(1024)]));
    data = { schemaVersion: SCHEMA_VERSION, isDemo: false, locations: [], sellers: [],
      sessions: [], ammo: [],
      firearms: [{ id:'g1', name:'R', type:'rifle', calibers:['.223 Rem'], cleanThreshold:500,
        totalRounds:0, cleanings:[], zeros:[], notes:'',
        groups:[{ id:'gr1', date:'2026-01-01', sessionId:null, distance:50, distanceUnit:'yd',
          calMode:'linear', calInches:1, calPts:[{x:0.4,y:0.5},{x:0.41,y:0.5}],
          poa:{x:0.5,y:0.5}, impacts:[{x:0.5,y:0.49},{x:0.51,y:0.5}], photoId:'keepme' }] }] };
    save(data);
    await sweepOrphanedPhotos();
  });
  await p.waitForTimeout(600);
  const remaining = await p.evaluate(() => allPhotoKeys());
  ck('sweep keeps a referenced photo', remaining.includes('keepme'));
  ck('sweep drops the unreferenced one', !remaining.includes('dropme'));

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS ' + [...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nStorage handling OK.' : `\n${bad} PROBLEM(S)`);
  await b.close();
  process.exit(bad?1:0);
})();
