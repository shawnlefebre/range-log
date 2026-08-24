// Shared target photos: one blob, several groups.
//
// A photo is stored once per target and referenced by every group marked on it. That makes
// releasing it a reference-count problem, and getting it wrong is silent: the groups keep
// their measurements, so nothing looks broken until you open one to re-mark and the image
// is gone. jsdom cannot see any of this — it is all IndexedDB.
//
//   node test/browser/run.js photo-share-check

const { chromium } = require('playwright');

const BASE = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';

const SHARED = 'ph_shared';
const seed = photoId => `
  data = { schemaVersion: buildDefaultData().schemaVersion, isDemo: false,
    firearms: [{ id:'g1', name:'R', type:'rifle', calibers:['.223 Rem'], opticUnit:'moa',
      cleanThreshold:500, totalRounds:0, notes:'', cleanings:[], zeros:[], dope:[], groups:[
      { id:'A', date:'2026-06-01', ammo:'x', tags:[], distance:50, distanceUnit:'yd',
        calMode:'linear', calInches:1, calPts:[{x:.4,y:.5},{x:.41,y:.5}], poa:{x:.5,y:.5},
        impacts:[{x:.5,y:.5},{x:.501,y:.5},{x:.5,y:.501}], photoId:${JSON.stringify(photoId)} },
      { id:'B', date:'2026-06-01', ammo:'x', tags:[], distance:50, distanceUnit:'yd',
        calMode:'linear', calInches:1, calPts:[{x:.4,y:.5},{x:.41,y:.5}], poa:{x:.5,y:.5},
        impacts:[{x:.52,y:.52},{x:.521,y:.52},{x:.52,y:.521}], photoId:${JSON.stringify(photoId)} },
      { id:'C', date:'2026-06-02', ammo:'x', tags:[], distance:50, distanceUnit:'yd',
        calMode:'linear', calInches:1, calPts:[{x:.4,y:.5},{x:.41,y:.5}], poa:{x:.5,y:.5},
        impacts:[{x:.6,y:.6},{x:.601,y:.6},{x:.6,y:.601}], photoId:null }]}],
    locations: [], sellers: [], sessions: [], ammo: [] };
  save(data);`;

(async () => {
  const checks = [];
  const ck = (name, ok) => checks.push([name, !!ok]);
  const errs = [];

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
  page.on('pageerror', e => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: 'networkidle' });

  const reset = async () => {
    await page.evaluate(async ([js, id]) => {
      await clearAllPhotos();
      eval(js);
      await putPhoto(id, new Blob(['image-bytes'], { type: 'image/png' }));
      await refreshAvailablePhotoIds();
    }, [seed(SHARED), SHARED]);
  };

  // ── dropping one group's photo must not blind its siblings ───────────────
  await reset();
  const drop = await page.evaluate(async () => {
    const before = (await allPhotoKeys()).length;
    await openLogGroup('g1', 'A');
    document.getElementById('group-keep-photo').checked = false;
    await groupPersist();
    return {
      before,
      after: (await allPhotoKeys()).length,
      aRef: data.firearms[0].groups.find(g => g.id === 'A').photoId,
      bRef: data.firearms[0].groups.find(g => g.id === 'B').photoId,
    };
  });
  ck('the photo starts out stored', drop.before === 1);
  ck('dropping it from one group leaves the blob alone', drop.after === 1);
  ck('that group releases its own reference', drop.aRef === null);
  ck('the sibling keeps its reference and can still re-mark', drop.bRef === SHARED);

  // The other half of the same rule: it must still go once nothing wants it.
  const last = await page.evaluate(async () => {
    await openLogGroup('g1', 'B');
    document.getElementById('group-keep-photo').checked = false;
    await groupPersist();
    return (await allPhotoKeys()).length;
  });
  ck('once the last group lets go, the blob is deleted rather than orphaned', last === 0);

  // ── deleting a group follows the same rule ───────────────────────────────
  await reset();
  const del = await page.evaluate(async () => {
    window.confirm = () => true;
    await deleteGroup('g1', 'A');
    const afterOne = (await allPhotoKeys()).length;
    await deleteGroup('g1', 'B');
    return { afterOne, afterBoth: (await allPhotoKeys()).length };
  });
  ck('deleting one of two groups on a target keeps the photo', del.afterOne === 1);
  ck('deleting the last one removes it', del.afterBoth === 0);

  // ── the camera icon tracks the blob, not the id ──────────────────────────
  await reset();
  const icons = await page.evaluate(async () => {
    const count = () => [...document.querySelectorAll('#history-groups-list .group-row-sub')]
      .filter(e => e.textContent.includes('📷')).length;
    openGunHistory('g1');
    const stored = count();
    await deletePhoto('ph_shared');
    await refreshAvailablePhotoIds();
    openGunHistory('g1');
    return { stored, gone: count() };
  });
  ck('groups with a stored photo show the camera', icons.stored === 2);
  ck('a group whose photo is gone does not claim to have one', icons.gone === 0);

  // ── the missing photo can be restored, for every group sharing it ────────
  await reset();
  const missing = await page.evaluate(async () => {
    await deletePhoto('ph_shared');
    await refreshAvailablePhotoIds();
    await openLogGroup('g1', 'A');
    const el = document.getElementById('group-photo-missing');
    return {
      shown: el.style.display !== 'none',
      names2: /2 groups/.test(el.textContent),
      hasButton: !!el.querySelector('label[for="group-restore-file"]'),
      // The marks must survive: they are what the restore exists to make visible again.
      impacts: G.impacts.length,
    };
  });
  ck('a missing photo is reported rather than passed over', missing.shown);
  ck('and says how many groups share it', missing.names2);
  ck('and offers a way to put it back', missing.hasButton);
  ck('the marks are still loaded, so restoring lines them up', missing.impacts === 3);

  // Drive the restore through the same path the file input uses.
  const restored = await page.evaluate(async () => {
    const png = Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mNk+M9QzzCKRsEoGgWjAAA' +
      'ZmwX9E4l0AAAAAElFTkSuQmCC'), c => c.charCodeAt(0));
    const file = new File([png], 'target.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.getElementById('group-restore-file');
    input.files = dt.files;
    await handleGroupRestoreFile(input);
    const impactsAfter = G.impacts.length;
    await groupPersist();
    return {
      impactsAfter,
      keys: await allPhotoKeys(),
      aRef: data.firearms[0].groups.find(g => g.id === 'A').photoId,
      bRef: data.firearms[0].groups.find(g => g.id === 'B').photoId,
      promptGone: document.getElementById('group-photo-missing').style.display === 'none',
    };
  });
  ck('restoring does not reset the marks', restored.impactsAfter === 3);
  ck('the image is written back under the id both groups share',
    restored.keys.length === 1 && restored.keys[0] === SHARED);
  ck('so the group that restored it is repaired', restored.aRef === SHARED);
  ck('and so is the sibling, without touching it', restored.bRef === SHARED);
  ck('the prompt clears once the photo is back', restored.promptGone);

  const back = await page.evaluate(async () => {
    openGunHistory('g1');
    return [...document.querySelectorAll('#history-groups-list .group-row-sub')]
      .filter(e => e.textContent.includes('📷')).length;
  });
  ck('and the camera icon returns for both', back === 2);

  // ── Settings reports the targets whose photos are gone ───────────────────
  await reset();
  const report = await page.evaluate(async () => {
    await deletePhoto('ph_shared');
    await refreshAvailablePhotoIds();
    showTab('settings');
    await renderPhotoStorage();
    const targets = missingPhotoTargets();
    return {
      rows: document.querySelectorAll('.photo-lost-row').length,
      targets: targets.length,
      groupsOnTarget: targets[0] && targets[0].groups.length,
      head: (document.querySelector('.photo-lost-head') || {}).textContent || '',
      opens: (document.querySelector('.photo-lost-row') || {}).getAttribute
        ? document.querySelector('.photo-lost-row').getAttribute('onclick') : '',
    };
  });
  // A and B share the target; C never had a photo and must not be reported as lost.
  ck('one shared target is reported once, not once per group', report.targets === 1);
  ck('and it says how many groups it covers', report.groupsOnTarget === 2);
  ck('a group that never had a photo is not called missing', report.rows === 1);
  ck('the heading counts targets', /1 target/.test(report.head));
  ck('the row opens a group on that target', /openLogGroup\('g1','[AB]'\)/.test(report.opens));

  // Following the row must land on the restore prompt, or the report is a dead end.
  const followed = await page.evaluate(async () => {
    const row = document.querySelector('.photo-lost-row');
    eval(row.getAttribute('onclick'));
    await new Promise(r => setTimeout(r, 300));
    const el = document.getElementById('group-photo-missing');
    return { open: document.getElementById('modal-group').classList.contains('open'),
             prompt: el.style.display !== 'none' };
  });
  ck('following it opens that group', followed.open);
  ck('and lands on the restore prompt', followed.prompt);

  // Once restored, the report must clear itself rather than keep listing a fixed target.
  const cleared = await page.evaluate(async () => {
    await putPhoto('ph_shared', new Blob(['image-bytes'], { type: 'image/png' }));
    await refreshAvailablePhotoIds();
    await renderPhotoStorage();
    return document.querySelectorAll('.photo-lost-row').length;
  });
  ck('a restored target drops off the report', cleared === 0);

  // ── the availability cache maintains itself ─────────────────────────────
  // It used to be refreshed by hand at six call sites. Any new write path that forgot would
  // silently bring back the lying camera icon, so the primitives own it now — checked here
  // by writing and deleting directly, with no refresh call anywhere near it.
  await reset();
  const selfMaintaining = await page.evaluate(async () => {
    const before = availablePhotoIds.has('ph_new');
    await putPhoto('ph_new', new Blob(['x'], { type: 'image/png' }));
    const afterPut = availablePhotoIds.has('ph_new');
    await deletePhoto('ph_new');
    const afterDelete = availablePhotoIds.has('ph_new');
    // And that it still agrees with the store itself, not just with itself.
    const keys = await allPhotoKeys();
    return { before, afterPut, afterDelete,
             agrees: keys.every(k => availablePhotoIds.has(k))
                     && availablePhotoIds.size === keys.length };
  });
  ck('a photo written straight to the store becomes available without a refresh call',
    !selfMaintaining.before && selfMaintaining.afterPut);
  ck('and deleting one drops it, again without a refresh call', !selfMaintaining.afterDelete);
  ck('the cache still matches what the store actually holds', selfMaintaining.agrees);

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS ' + [...new Set(errs)].join(' | ')); }
  console.log(bad === 0 ? '\nPhoto sharing OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad === 0 ? 0 : 1);
})();
