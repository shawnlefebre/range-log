// Range Log — regression test suite
//
// Run with: npm test
// Requires: Node 18+ (built-in test runner) and jsdom (npm install)
//
// Expects the app file at repo root named `index.html` (the deployed GitHub
// Pages convention). If you're testing a differently-named copy locally,
// either rename it or edit APP_PATH below.

const { test, describe, before } = require('node:test');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

const APP_PATH = path.join(__dirname, '..', 'index.html');
const CSS_PATH = path.join(__dirname, '..', 'app.css');
const JS_PATH = path.join(__dirname, '..', 'app.js');

// The app ships as index.html + app.css + app.js. jsdom won't fetch external assets, so
// we splice them back inline — the app then runs exactly as it does in a browser, with
// no network or resource loading involved.
function buildDocument(mutateJs) {
  for (const [label, p] of [['index.html', APP_PATH], ['app.css', CSS_PATH], ['app.js', JS_PATH]]) {
    if (!fs.existsSync(p)) throw new Error(`Could not find ${label} at ${p}.`);
  }
  const html = fs.readFileSync(APP_PATH, 'utf8');
  const css = fs.readFileSync(CSS_PATH, 'utf8');
  let js = fs.readFileSync(JS_PATH, 'utf8');
  if (mutateJs) js = mutateJs(js);

  // Replacer functions, not strings: the source is full of `${...}` template literals and
  // String.replace would otherwise interpret those $ sequences as substitution patterns.
  const withCss = html.replace('<link rel="stylesheet" href="app.css">', () => `<style>\n${css}\n</style>`);
  assert.notStrictEqual(withCss, html, 'app.css link tag not found — update the splice in buildDocument');
  const withJs = withCss.replace('<script src="app.js"></script>', () => `<script>\n${js}\n</script>`);
  assert.notStrictEqual(withJs, withCss, 'app.js script tag not found — update the splice in buildDocument');
  return withJs;
}

function loadApp(mutateJs) {
  const dom = new JSDOM(buildDocument(mutateJs), {
    runScripts: 'dangerously',
    url: 'https://example.com/',
    pretendToBeVisual: true,
  });
  dom.window.alert = () => {};
  dom.window.confirm = () => true;
  return dom;
}

function ready(dom) {
  return new Promise(resolve => {
    dom.window.onload = () => resolve(dom.window);
  });
}

// ── SCHEMA MIGRATION ────────────────────────────────────────────────

describe('schema migration', () => {
  let win;
  before(async () => { win = await ready(loadApp()); });

  test('v1 data (lastCleaned string) migrates to current schema', () => {
    const v1 = {
      schemaVersion: 1,
      firearms: [{ id: 'g1', name: 'Old Gun', caliber: '.22 LR', cleanThreshold: 300, totalRounds: 10, lastCleaned: '2024-01-01' }],
      locations: [], sellers: [], sessions: [], ammo: [],
    };
    const migrated = win.migrateData(JSON.parse(JSON.stringify(v1)));
    assert.strictEqual(migrated.schemaVersion, 9);
    assert.strictEqual(migrated.isDemo, false, 'migrated real data must never be flagged as demo');
    assert.deepStrictEqual([...migrated.firearms[0].calibers], ['.22 LR']);
    assert.strictEqual(migrated.firearms[0].cleanings.length, 1);
    assert.strictEqual(migrated.firearms[0].cleanings[0].type, 'deep');
    assert.strictEqual(migrated.firearms[0].type, null, 'type should default to unset, not crash');
    assert.strictEqual(migrated.firearms[0].notes, '', 'notes should default to empty string, not crash');
  });

  test('v6 data (pre-isDemo) migrates and stays non-demo', () => {
    const v6 = {
      schemaVersion: 6,
      firearms: [{ id: 'g1', name: 'Real Gun', type: 'pistol', calibers: ['9mm'], cleanThreshold: 500, totalRounds: 50, cleanings: [], zeros: [] }],
      locations: [{ id: 'l1', name: 'Real Range' }], sellers: [], sessions: [], ammo: [],
    };
    const migrated = win.migrateData(JSON.parse(JSON.stringify(v6)));
    assert.strictEqual(migrated.schemaVersion, 9);
    assert.strictEqual(migrated.isDemo, false);
    assert.strictEqual(migrated.firearms[0].name, 'Real Gun', 'existing data must survive migration untouched');
  });

  test('v7 data (pre-notes) migrates and preserves existing notes untouched', () => {
    const v7 = {
      schemaVersion: 7,
      isDemo: false,
      firearms: [
        { id: 'g1', name: 'No Notes Gun', type: 'rifle', calibers: ['.223 Rem'], cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [] },
        { id: 'g2', name: 'Has Notes Gun', type: 'pistol', calibers: ['9mm'], cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [], notes: 'Torque: 20 in-lbs' },
      ],
      locations: [], sellers: [], sessions: [], ammo: [],
    };
    const migrated = win.migrateData(JSON.parse(JSON.stringify(v7)));
    assert.strictEqual(migrated.schemaVersion, 9);
    assert.strictEqual(migrated.firearms[0].notes, '', 'missing notes should default to empty string');
    assert.strictEqual(migrated.firearms[1].notes, 'Torque: 20 in-lbs', 'existing notes must survive migration untouched');
  });

  test('already-current data passes through without modification', () => {
    const current = win.buildDefaultData();
    const migrated = win.migrateData(JSON.parse(JSON.stringify(current)));
    assert.strictEqual(migrated.schemaVersion, 9);
    assert.strictEqual(migrated.firearms.length, current.firearms.length);
  });
});

// ── CALIBER MERGE + DISCLAIMER ──────────────────────────────────────

describe('caliber merge and disclaimer', () => {
  test('tokens with identical firearm signatures merge into one group', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    const options = Array.from(win.document.getElementById('stats-rf-caliber').options).map(o => o.textContent);
    // Demo data: Example Rifle is the only gun with .223 Rem AND 5.56 NATO, so they must merge.
    assert.ok(options.includes('.223 Rem / 5.56 NATO'), 'shared-signature calibers should merge into one option');
    assert.ok(!options.includes('.223 Rem'), 'merged tokens should not also appear as separate options');
  });

  test('selecting a merged caliber group returns the same total as the firearm-only filter', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.document.getElementById('stats-rf-range').value = '12months';

    const gunSelect = win.document.getElementById('stats-rf-firearm');
    const calSelect = win.document.getElementById('stats-rf-caliber');
    const rifleOpt = Array.from(gunSelect.options).find(o => o.textContent === 'Example Rifle');
    const mergedOpt = Array.from(calSelect.options).find(o => o.textContent === '.223 Rem / 5.56 NATO');

    gunSelect.value = rifleOpt.value;
    win.renderStats();
    const byFirearm = win.document.getElementById('stats-rf-stats').innerHTML.match(/stats-stat-num">([^<]+)</)[1];

    gunSelect.value = '';
    calSelect.value = mergedOpt.value;
    win.renderStats();
    const byCaliber = win.document.getElementById('stats-rf-stats').innerHTML.match(/stats-stat-num">([^<]+)</)[1];

    assert.strictEqual(byFirearm, byCaliber, 'merged caliber filter must match the equivalent firearm filter exactly');
  });

  test('disclaimer fires when a firearm carries a caliber outside the selected group', async () => {
    // Inject a firearm sharing .223/5.56 with Example Rifle but also carrying a unique
    // third caliber. Targets only the calibers array on the g2 line, so adding unrelated
    // fields to the demo firearms doesn't silently turn this into a no-op test.
    const win = await ready(loadApp(js => {
      const patched = js.replace(
        /(\{ id: g2,[^}]*?calibers: )\['9mm'\]/,
        "$1['.223 Rem', '5.56 NATO', '.300 BLK']"
      );
      assert.notStrictEqual(patched, js, 'demo-firearm injection failed to match — update the pattern');
      return patched;
    }));

    win.showTab('stats');
    const calSelect = win.document.getElementById('stats-rf-caliber');
    const mergedOpt = Array.from(calSelect.options).find(o => o.textContent === '.223 Rem / 5.56 NATO');
    calSelect.value = mergedOpt.value;
    win.renderStats();

    const disclaimer = win.document.getElementById('stats-rf-disclaimer').innerHTML;
    assert.ok(disclaimer.includes('Example Pistol'), 'disclaimer should name the firearm with the extra caliber');
    assert.ok(disclaimer.includes('.300 BLK'), 'disclaimer should show the full caliber list of the flagged firearm');
  });

  test('no disclaimer when no firearm in scope has extra calibers', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    const calSelect = win.document.getElementById('stats-rf-caliber');
    const mergedOpt = Array.from(calSelect.options).find(o => o.textContent === '.223 Rem / 5.56 NATO');
    calSelect.value = mergedOpt.value;
    win.renderStats();
    const disclaimer = win.document.getElementById('stats-rf-disclaimer').innerHTML.trim();
    assert.strictEqual(disclaimer, '', 'clean demo data should never show a false-positive disclaimer');
  });
});

// ── FIREARM + CALIBER FILTER INTERSECTION (regression for a real reported bug) ──

describe('firearm + caliber filter intersection', () => {
  test('incompatible firearm+caliber combo returns zero, not the firearm-only total', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.document.getElementById('stats-rf-range').value = '12months';

    const gunSelect = win.document.getElementById('stats-rf-firearm');
    const calSelect = win.document.getElementById('stats-rf-caliber');
    const rifleOpt = Array.from(gunSelect.options).find(o => o.textContent === 'Example Rifle');
    const gaugeOpt = Array.from(calSelect.options).find(o => o.textContent === '12 Gauge');

    gunSelect.value = rifleOpt.value;
    calSelect.value = gaugeOpt.value;
    win.renderStats();

    const stats = [...win.document.getElementById('stats-rf-stats').innerHTML.matchAll(/stats-stat-num">([^<]+)</g)].map(m => m[1]);
    assert.deepStrictEqual(stats, ['0', '0', '0'], 'a firearm not tagged for the selected caliber must show zero results, not the firearm\'s full total');
  });

  test('compatible firearm+caliber combo still returns real data', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.document.getElementById('stats-rf-range').value = '12months';

    const gunSelect = win.document.getElementById('stats-rf-firearm');
    const calSelect = win.document.getElementById('stats-rf-caliber');
    const shotgunOpt = Array.from(gunSelect.options).find(o => o.textContent === 'Example Shotgun');
    const gaugeOpt = Array.from(calSelect.options).find(o => o.textContent === '12 Gauge');

    gunSelect.value = shotgunOpt.value;
    calSelect.value = gaugeOpt.value;
    win.renderStats();

    const total = win.document.getElementById('stats-rf-stats').innerHTML.match(/stats-stat-num">([^<]+)</)[1];
    assert.notStrictEqual(total, '0', 'a firearm tagged for the selected caliber must still return its data');
  });
});

// ── BUCKET GRANULARITY (weekly vs monthly) ──────────────────────────

describe('stats chart bucket granularity', () => {
  test('short ranges use weekly buckets, long ranges use monthly', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');

    win.document.getElementById('stats-rf-range').value = 'month';
    win.renderStats();
    let title = win.document.getElementById('stats-rf-chart').innerHTML.match(/stats-chart-title">([^<]+)</)[1];
    assert.strictEqual(title, 'Rounds per Week');

    win.document.getElementById('stats-rf-range').value = '12months';
    win.renderStats();
    title = win.document.getElementById('stats-rf-chart').innerHTML.match(/stats-chart-title">([^<]+)</)[1];
    assert.strictEqual(title, 'Rounds per Month');
  });

  test('100-day custom range uses weekly, 101-day uses monthly (threshold boundary)', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    const isoMinusDays = d => { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt.toISOString().slice(0, 10); };
    const todayStr = new Date().toISOString().slice(0, 10);

    win.document.getElementById('stats-rf-range').value = 'custom';
    win.handleStatsRangeChange('rf');
    win.document.getElementById('stats-rf-start').value = isoMinusDays(100);
    win.document.getElementById('stats-rf-end').value = todayStr;
    win.renderStats();
    let title = win.document.getElementById('stats-rf-chart').innerHTML.match(/stats-chart-title">([^<]+)</)[1];
    assert.strictEqual(title, 'Rounds per Week');

    win.document.getElementById('stats-rf-start').value = isoMinusDays(101);
    win.renderStats();
    title = win.document.getElementById('stats-rf-chart').innerHTML.match(/stats-chart-title">([^<]+)</)[1];
    assert.strictEqual(title, 'Rounds per Month');
  });

  test('weekly charts with more than 8 bars alternate labels; monthly charts never do', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');

    win.document.getElementById('stats-rf-range').value = '3months';
    win.renderStats();
    let chartHtml = win.document.getElementById('stats-rf-chart').innerHTML;
    const barCount = (chartHtml.match(/stats-bar-col/g) || []).length;
    const hiddenCount = (chartHtml.match(/hidden-label/g) || []).length;
    if (barCount > 8) assert.ok(hiddenCount > 0, 'dense weekly charts should thin out labels');

    win.document.getElementById('stats-rf-range').value = '12months';
    win.renderStats();
    chartHtml = win.document.getElementById('stats-rf-chart').innerHTML;
    assert.strictEqual((chartHtml.match(/hidden-label/g) || []).length, 0, 'monthly charts (max 12 bars) should never hide labels');
  });

  test('"Avg / Month" reflects a true calendar-month average regardless of chart bucket granularity', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.document.getElementById('stats-rf-range').value = 'month';
    win.document.getElementById('stats-rf-location').value = '';
    win.document.getElementById('stats-rf-firearm').value = '';
    win.document.getElementById('stats-rf-caliber').value = '';
    win.renderStats();
    const stats = [...win.document.getElementById('stats-rf-stats').innerHTML.matchAll(/stats-stat-num">([^<]+)</g)].map(m => m[1]);
    const total = parseInt(stats[0].replace(/,/g, ''), 10);
    const avg = parseInt(stats[1].replace(/,/g, ''), 10);
    // Early in a month, avg should be clamped near the total (not wildly extrapolated), and never exceed it by more than a small margin.
    assert.ok(avg <= total * 1.5 + 5, 'month-to-date average should not wildly overshoot the actual total this early in the month');
  });
});

// ── DEMO DATA GENERATOR ─────────────────────────────────────────────

describe('demo data generator', () => {
  test('never generates a session or purchase dated in the future', async () => {
    const win = await ready(loadApp());
    const demo = win.generateDemoData();
    const todayStr = new Date().toISOString().slice(0, 10);
    demo.sessions.forEach(s => assert.ok(s.date <= todayStr, `session dated ${s.date} is in the future`));
    demo.ammo.forEach(a => assert.ok(a.date <= todayStr, `ammo purchase dated ${a.date} is in the future`));
  });

  test('not every session includes every firearm', async () => {
    const win = await ready(loadApp());
    const demo = win.generateDemoData();
    const counts = demo.sessions.map(s => Object.keys(s.rounds).length);
    const allFour = counts.filter(c => c === 4).length;
    const solo = counts.filter(c => c === 1).length;
    assert.ok(solo > 0, 'expected at least some solo-firearm sessions');
    assert.ok(allFour < demo.sessions.length / 2, 'sessions with every firearm should be the exception, not the rule');
  });

  test('firearm totalRounds matches the sum of its own session rounds', async () => {
    const win = await ready(loadApp());
    const demo = win.generateDemoData();
    demo.firearms.forEach(gun => {
      const expected = demo.sessions.reduce((sum, s) => sum + (s.rounds[gun.id] || 0), 0);
      assert.strictEqual(gun.totalRounds, expected, `${gun.name} totalRounds should match its session data`);
    });
  });

  test('fresh load flags data as demo; deleting all data clears the flag and does not regenerate demo data', async () => {
    const win = await ready(loadApp());
    win.showTab('settings');
    win.openDeleteAllModal();
    win.document.getElementById('delete-all-confirm-input').value = 'DELETE';
    win.checkDeleteAllInput();
    win.confirmDeleteAll();

    const reloaded = win.load();
    assert.strictEqual(reloaded.firearms.length, 0, 'reload after delete should stay blank, not regenerate demo data');
    assert.strictEqual(reloaded.isDemo, false);
  });
});

// ── LOCATION / SELLER DELETE REFERENCE HANDLING ─────────────────────

describe('deleted reference display', () => {
  test('deleteLocation and deleteSeller both warn about broken references consistently', async () => {
    const win = await ready(loadApp());
    const locSrc = win.deleteLocation.toString();
    const sellerSrc = win.deleteSeller.toString();
    assert.ok(locSrc.includes('Unknown'), 'deleteLocation should warn about Unknown references, matching deleteSeller');
    assert.ok(sellerSrc.includes('Unknown'), 'deleteSeller warning text');
  });
});

// ── MODAL STACKING (regression: iOS Safari doesn't repaint stacked ──
// position:fixed overlays, so Details must close before Cleaning/Zero
// opens, and reopen — refreshed — once that sub-modal closes) ───────

describe('Details modal never stays open behind Cleaning/Zero modals', () => {
  test('opening Log Cleaning from Details closes Details, and Save reopens it', async () => {
    const win = await ready(loadApp());
    win.openGunHistory('dg1');
    assert.ok(win.document.getElementById('modal-history').classList.contains('open'));

    win.openLogCleaning('dg1');
    assert.ok(!win.document.getElementById('modal-history').classList.contains('open'), 'Details must close before Cleaning opens');
    assert.ok(win.document.getElementById('modal-cleaning').classList.contains('open'));

    win.saveCleaning();
    assert.ok(!win.document.getElementById('modal-cleaning').classList.contains('open'));
    assert.ok(win.document.getElementById('modal-history').classList.contains('open'), 'Details should reopen after saving');
  });

  test('opening Add Zero from Details closes Details, and Save reopens it', async () => {
    const win = await ready(loadApp());
    win.openGunHistory('dg1');
    win.openLogZero('dg1');
    assert.ok(!win.document.getElementById('modal-history').classList.contains('open'), 'Details must close before Zero opens');
    assert.ok(win.document.getElementById('modal-zero').classList.contains('open'));

    win.document.getElementById('zero-distance').value = '50';
    win.saveZero();
    assert.ok(!win.document.getElementById('modal-zero').classList.contains('open'));
    assert.ok(win.document.getElementById('modal-history').classList.contains('open'), 'Details should reopen after saving');
  });

  test('cancelling Log Cleaning (closeModal) also reopens Details', async () => {
    const win = await ready(loadApp());
    win.openGunHistory('dg1');
    win.openLogCleaning('dg1');
    win.closeModal('modal-cleaning');
    assert.ok(!win.document.getElementById('modal-cleaning').classList.contains('open'));
    assert.ok(win.document.getElementById('modal-history').classList.contains('open'), 'Cancel should return to Details, not drop the user with nothing open');
  });

  test('Log Cleaning opened directly (not via Details) does not touch Details modal', async () => {
    const win = await ready(loadApp());
    win.openLogCleaning('dg1');
    assert.ok(win.document.getElementById('modal-cleaning').classList.contains('open'));
    win.saveCleaning();
    assert.ok(!win.document.getElementById('modal-history').classList.contains('open'), 'Details was never open, so it must not appear now');
  });
});

// ── GROUP ANALYSIS ──────────────────────────────────────────────────
// Points are normalised by image width. Using 0.01 units == 1 inch throughout, so a
// shot 0.01 from the point of aim is exactly 1 inch out and results are hand-checkable.

describe('group analysis math', () => {
  let win;
  before(async () => { win = await ready(loadApp()); });

  // Four impacts 1 inch from the aim point, N/E/S/W.
  const impacts = [
    { x: 0.50, y: 0.49 }, { x: 0.51, y: 0.50 },
    { x: 0.50, y: 0.51 }, { x: 0.49, y: 0.50 },
  ];
  const linear = {
    calMode: 'linear', calInches: 1, distance: 50, distanceUnit: 'yd',
    calPts: [{ x: 0.40, y: 0.50 }, { x: 0.41, y: 0.50 }],
    poa: { x: 0.50, y: 0.50 },
    impacts,
  };

  test('linear scale returns hand-computed spread, mean radius and W/H', () => {
    const m = win.groupMetrics(win.groupToInches(linear));
    assert.strictEqual(+m.es.toFixed(4), 2, 'extreme spread is 2 inches');
    assert.strictEqual(+m.meanRadius.toFixed(4), 1, 'every shot is 1 inch from center');
    assert.strictEqual(+m.width.toFixed(4), 2);
    assert.strictEqual(+m.height.toFixed(4), 2);
    assert.strictEqual(+m.cx.toFixed(4), 0, 'symmetric group is centered on the aim point');
    assert.strictEqual(+m.cy.toFixed(4), 0);
  });

  test('angular conversions match the standard subtensions', () => {
    const dIn = win.groupDistanceInches(linear);
    assert.strictEqual(dIn, 1800, '50 yards is 1800 inches');
    // 1 MOA subtends 1.047 in at 100 yd; 1 mrad subtends 3.6 in at 100 yd.
    assert.strictEqual(+win.toMOA(2, dIn).toFixed(3), 3.820);
    assert.strictEqual(+win.toMRAD(2, dIn).toFixed(3), 1.111);
  });

  test('distance converts correctly from yards, feet and meters', () => {
    const at = (distance, distanceUnit) => win.groupDistanceInches({ distance, distanceUnit });
    assert.strictEqual(at(50, 'yd'), 1800, '50 yd is 1800 in');
    assert.strictEqual(at(50, 'ft'), 600, '50 ft is 600 in');
    assert.strictEqual(+at(50, 'm').toFixed(2), 1968.51, '50 m is 1968.51 in');
    // 25 yd and 75 ft are the same distance, so they must give identical angles.
    assert.strictEqual(at(25, 'yd'), at(75, 'ft'));
    assert.strictEqual(at(10, undefined), at(10, 'yd'), 'a missing unit falls back to yards');
    assert.strictEqual(at(0, 'yd'), null, 'no distance means no conversion');
  });

  test('the same group reads different MOA at different distances', () => {
    const g = { ...linear, distance: 50, distanceUnit: 'yd' };
    const m = win.groupMetrics(win.groupToInches(g));
    const moaAt50yd = win.toMOA(m.es, win.groupDistanceInches(g));
    const moaAt150ft = win.toMOA(m.es, win.groupDistanceInches({ ...g, distance: 150, distanceUnit: 'ft' }));
    assert.strictEqual(+moaAt50yd.toFixed(4), +moaAt150ft.toFixed(4), '50 yd and 150 ft are the same distance');
    const moaAt100yd = win.toMOA(m.es, win.groupDistanceInches({ ...g, distance: 100 }));
    assert.strictEqual(+(moaAt50yd / moaAt100yd).toFixed(4), 2, 'doubling the distance halves the MOA');
  });

  test('elevation is positive upward and windage positive to the right', () => {
    const pts = win.groupToInches({ ...linear, impacts: [{ x: 0.52, y: 0.49 }, { x: 0.50, y: 0.50 }] });
    assert.strictEqual(+pts[0].x.toFixed(4), 2, 'right of aim is positive windage');
    assert.strictEqual(+pts[0].y.toFixed(4), 1, 'above aim is positive elevation');
  });

  test('metrics need two impacts; one is not a group', () => {
    assert.strictEqual(win.groupMetrics(win.groupToInches({ ...linear, impacts: [impacts[0]] })), null);
  });

  test('an incomplete group yields no measurements rather than a wrong one', () => {
    assert.strictEqual(win.groupToInches({ ...linear, poa: null }), null, 'no aim point');
    assert.strictEqual(win.groupToInches({ ...linear, calPts: [] }), null, 'no scale reference');
    assert.strictEqual(win.groupToInches({ ...linear, calInches: 0 }), null, 'zero-length reference');
  });

  // The perspective path is the fragile maths, so it gets a genuinely warped target.
  const warp = p => {
    const [a, b, c, d, e, f, g, h] = [1, 0.15, 0, 0.1, 1, 0, 30, 20];
    const w = g * p.x + h * p.y + 1;
    return { x: (a * p.x + b * p.y + c) / w, y: (d * p.x + e * p.y + f) / w };
  };
  const square = [{ x: 0.46, y: 0.46 }, { x: 0.50, y: 0.46 }, { x: 0.50, y: 0.50 }, { x: 0.46, y: 0.50 }];

  test('perspective correction recovers true measurements from a warped target', () => {
    const g = {
      calMode: 'perspective', calInches: 4, calInchesH: 4, distance: 50, distanceUnit: 'yd',
      calPts: square.map(warp), poa: warp({ x: 0.50, y: 0.50 }), impacts: impacts.map(warp),
    };
    const m = win.groupMetrics(win.groupToInches(g));
    assert.strictEqual(+m.es.toFixed(3), 2, 'warp must not change the real group size');
    assert.strictEqual(+m.meanRadius.toFixed(3), 1);
  });

  test('corner marking order is irrelevant — all 24 permutations agree', () => {
    const permute = a => a.length <= 1 ? [a]
      : a.flatMap((v, i) => permute([...a.slice(0, i), ...a.slice(i + 1)]).map(r => [v, ...r]));
    const base = {
      calMode: 'perspective', calInches: 4, calInchesH: 4, distance: 50, distanceUnit: 'yd',
      poa: warp({ x: 0.50, y: 0.50 }), impacts: impacts.map(warp),
    };
    const results = permute([0, 1, 2, 3]).map(order => {
      const m = win.groupMetrics(win.groupToInches({ ...base, calPts: order.map(i => warp(square[i])) }));
      return `${m.es.toFixed(3)}/${m.meanRadius.toFixed(3)}`;
    });
    assert.strictEqual(results.length, 24);
    assert.strictEqual(new Set(results).size, 1, `every corner order must agree, got ${[...new Set(results)]}`);
  });

  test('a non-square reference stays correct in any corner order', () => {
    // 4 in wide x 2 in tall, marked as a 0.04 x 0.02 rectangle.
    const rect = [{ x: 0.46, y: 0.48 }, { x: 0.50, y: 0.48 }, { x: 0.50, y: 0.50 }, { x: 0.46, y: 0.50 }];
    const permute = a => a.length <= 1 ? [a]
      : a.flatMap((v, i) => permute([...a.slice(0, i), ...a.slice(i + 1)]).map(r => [v, ...r]));
    const seen = new Set(permute([0, 1, 2, 3]).map(order => {
      const m = win.groupMetrics(win.groupToInches({
        calMode: 'perspective', calInches: 4, calInchesH: 2, distance: 50, distanceUnit: 'yd',
        calPts: order.map(i => rect[i]), poa: { x: 0.50, y: 0.50 }, impacts,
      }));
      return `${m.es.toFixed(3)}/${m.width.toFixed(3)}/${m.height.toFixed(3)}`;
    }));
    assert.strictEqual(seen.size, 1, `non-square reference must not flip width and height, got ${[...seen]}`);
  });

  test('bullet diameter resolves from caliber and falls back rather than guessing', () => {
    assert.strictEqual(win.caliberDiameter('.223 Rem'), 0.224);
    assert.strictEqual(win.caliberDiameter('9MM'), 0.355, 'lookup is case-insensitive');
    assert.strictEqual(win.caliberDiameter('  12 Gauge '), 0.729, 'surrounding space is ignored');
    assert.strictEqual(win.caliberDiameter('.499 Wildcat'), null, 'unknown caliber must not be invented');
    assert.strictEqual(win.caliberDiameter(''), null);
    assert.strictEqual(win.caliberDiameter(undefined), null);
  });

  test('group size is derived, so editing the scale changes it without stored values', () => {
    const half = win.groupMetrics(win.groupToInches({ ...linear, calInches: 0.5 }));
    assert.strictEqual(+half.es.toFixed(4), 1, 'halving the reference length halves the group');
  });

  test('demo data ships a group whose size recomputes from its points alone', () => {
    // `data` is a let-binding so it isn't on window; build a fresh copy instead.
    const gun = win.buildDefaultData().firearms.find(g => (g.groups || []).length);
    assert.ok(gun, 'demo data should include a sample group');
    const size = win.groupSizeInches(gun.groups[0]);
    assert.ok(size > 0 && size < 3, `expected a plausible demo group size, got ${size}`);
    assert.ok(!('size' in gun.groups[0]), 'group size must never be stored on the record');
  });
});

// ── BASIC SMOKE TEST: every tab renders without throwing ────────────

describe('smoke test', () => {
  test('all tabs render without error on a fresh demo-data load', async () => {
    const win = await ready(loadApp());
    for (const tab of ['dashboard', 'log', 'sessions', 'ammo', 'stats', 'settings']) {
      assert.doesNotThrow(() => win.showTab(tab), `showTab('${tab}') threw`);
    }
  });
});