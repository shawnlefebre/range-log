const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const c = await b.newContext({ serviceWorkers:'block', acceptDownloads:true });
  const p = await c.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  p.on('dialog', d => d.accept());
  await p.goto((process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html'));
  await p.waitForSelector('#app-version');
  const checks=[]; const ck=(n,ok)=>checks.push([n,ok]);

  // One referenced photo, one orphan.
  await p.evaluate(async () => {
    await clearAllPhotos();
    await putPhoto('keepme', new Blob(['hello world'], { type:'image/jpeg' }));
    await putPhoto('orphan', new Blob(['junk'], { type:'image/jpeg' }));
    data = { schemaVersion: SCHEMA_VERSION, isDemo:false, locations:[], sellers:[], sessions:[], ammo:[],
      firearms:[{ id:'g1', name:'R', type:'rifle', calibers:['.223 Rem'], cleanThreshold:500,
        totalRounds:0, cleanings:[], zeros:[], notes:'',
        groups:[{ id:'gr1', date:'2026-01-01', sessionId:null, distance:50, distanceUnit:'yd',
          calMode:'linear', calInches:1, calPts:[{x:0.4,y:0.5},{x:0.41,y:0.5}],
          poa:{x:0.5,y:0.5}, impacts:[{x:0.5,y:0.49},{x:0.51,y:0.5}], photoId:'keepme' }] }] };
    save(data);
  });

  const dl = await Promise.all([p.waitForEvent('download'), p.evaluate(() => exportPhotos())]).then(r => r[0]);
  const fs = require('fs');
  const tmp = '/tmp/bundle-out.json';
  await dl.saveAs(tmp);
  const payload = JSON.parse(fs.readFileSync(tmp,'utf8'));
  ck('bundle has the right type', payload.type === 'range-log-photos');
  ck('bundle contains both stored photos', Object.keys(payload.photos).length === 2);
  ck('photos are data URLs', Object.values(payload.photos).every(v => v.startsWith('data:')));

  // Wipe the store, then restore from the bundle.
  await p.evaluate(() => clearAllPhotos());
  await p.waitForTimeout(300);
  await p.setInputFiles('#import-photos-file', tmp);
  await p.waitForTimeout(900);

  const after = await p.evaluate(() => allPhotoKeys());
  ck('referenced photo restored', after.includes('keepme'));
  ck('orphan not restored', !after.includes('orphan'));
  const blob = await p.evaluate(async () => {
    const b = await getPhoto('keepme');
    return b ? await b.text() : null;
  });
  ck('restored content is intact', blob === 'hello world');

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nPhoto bundle OK.' : `\n${bad} PROBLEM(S)`);
  fs.unlinkSync(tmp);
  await b.close();
  process.exit(bad?1:0);
})();
