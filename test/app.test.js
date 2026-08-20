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

// Rendered copy wraps across lines in the source, so matching a phrase against textContent
// fails on the newline and indentation. Collapse whitespace before asserting on wording.
function flat(el) {
  return (typeof el === 'string' ? el : el.textContent).replace(/\s+/g, ' ').trim();
}

function ready(dom) {
  return new Promise(resolve => {
    dom.window.onload = () => resolve(dom.window);
  });
}

// ── SCHEMA MIGRATION ────────────────────────────────────────────────

describe('schema migration', () => {
  let win;
  // Asserted against the version fresh data is created at rather than a hardcoded number:
  // migrated data must land exactly where buildDefaultData() lands, and that stays true
  // across future bumps without editing four assertions.
  let CURRENT;
  before(async () => {
    win = await ready(loadApp());
    CURRENT = win.buildDefaultData().schemaVersion;
  });

  test('v1 data (lastCleaned string) migrates to current schema', () => {
    const v1 = {
      schemaVersion: 1,
      firearms: [{ id: 'g1', name: 'Old Gun', caliber: '.22 LR', cleanThreshold: 300, totalRounds: 10, lastCleaned: '2024-01-01' }],
      locations: [], sellers: [], sessions: [], ammo: [],
    };
    const migrated = win.migrateData(JSON.parse(JSON.stringify(v1)));
    assert.strictEqual(migrated.schemaVersion, CURRENT);
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
    assert.strictEqual(migrated.schemaVersion, CURRENT);
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
    assert.strictEqual(migrated.schemaVersion, CURRENT);
    assert.strictEqual(migrated.firearms[0].notes, '', 'missing notes should default to empty string');
    assert.strictEqual(migrated.firearms[1].notes, 'Torque: 20 in-lbs', 'existing notes must survive migration untouched');
  });

  test('v9 groups link to a session only when the date is unambiguous', () => {
    const v9 = {
      schemaVersion: 9,
      isDemo: false,
      firearms: [{
        id: 'g1', name: 'Rifle', type: 'rifle', calibers: ['.223 Rem'], cleanThreshold: 500,
        totalRounds: 0, cleanings: [], zeros: [], notes: '',
        groups: [
          { id: 'a', date: '2026-05-01', distance: 50, distanceUnit: 'yd', calMode: 'linear',
            calInches: 1, calPts: [{ x: 0.4, y: 0.5 }, { x: 0.41, y: 0.5 }],
            poa: { x: 0.5, y: 0.5 }, impacts: [{ x: 0.5, y: 0.49 }, { x: 0.51, y: 0.5 }] },
          { id: 'b', date: '2026-05-02', distance: 50, distanceUnit: 'yd', calMode: 'linear',
            calInches: 1, calPts: [{ x: 0.4, y: 0.5 }, { x: 0.41, y: 0.5 }],
            poa: { x: 0.5, y: 0.5 }, impacts: [{ x: 0.5, y: 0.49 }, { x: 0.51, y: 0.5 }] },
          { id: 'c', date: '2026-05-03', distance: 50, distanceUnit: 'yd', calMode: 'linear',
            calInches: 1, calPts: [{ x: 0.4, y: 0.5 }, { x: 0.41, y: 0.5 }],
            poa: { x: 0.5, y: 0.5 }, impacts: [{ x: 0.5, y: 0.49 }, { x: 0.51, y: 0.5 }] },
        ],
      }],
      locations: [], sellers: [], ammo: [],
      sessions: [
        { id: 's1', date: '2026-05-01', rounds: {}, totalRounds: 0 },
        { id: 's2', date: '2026-05-02', rounds: {}, totalRounds: 0 },
        { id: 's3', date: '2026-05-02', rounds: {}, totalRounds: 0 },
      ],
    };
    const groups = win.migrateData(JSON.parse(JSON.stringify(v9))).firearms[0].groups;
    assert.strictEqual(groups[0].sessionId, 's1', 'one session that day should be linked');
    assert.strictEqual(groups[1].sessionId, null, 'two sessions that day is ambiguous — must not guess');
    assert.strictEqual(groups[2].sessionId, null, 'no session that day should stay unlinked');
  });

  test('v10 groups gain an empty tags array', () => {
    const v10 = {
      schemaVersion: 10, isDemo: false, locations: [], sellers: [], sessions: [], ammo: [],
      firearms: [{
        id: 'g1', name: 'Rifle', type: 'rifle', calibers: ['.223 Rem'], cleanThreshold: 500,
        totalRounds: 0, cleanings: [], zeros: [], notes: '',
        groups: [
          { id: 'a', date: '2026-05-01', sessionId: null, distance: 50, distanceUnit: 'yd',
            calMode: 'linear', calInches: 1, calPts: [{ x: 0.4, y: 0.5 }, { x: 0.41, y: 0.5 }],
            poa: { x: 0.5, y: 0.5 }, impacts: [{ x: 0.5, y: 0.49 }, { x: 0.51, y: 0.5 }] },
          { id: 'b', date: '2026-05-02', sessionId: null, distance: 50, distanceUnit: 'yd',
            calMode: 'linear', calInches: 1, calPts: [{ x: 0.4, y: 0.5 }, { x: 0.41, y: 0.5 }],
            poa: { x: 0.5, y: 0.5 }, impacts: [{ x: 0.5, y: 0.49 }, { x: 0.51, y: 0.5 }],
            tags: ['prone'] },
        ],
      }],
    };
    const groups = win.migrateData(JSON.parse(JSON.stringify(v10))).firearms[0].groups;
    // Spread first: arrays from the jsdom realm have a different prototype, so
    // deepStrictEqual against a plain [] fails even when the contents match.
    assert.deepStrictEqual([...groups[0].tags], [], 'a group without tags gets an empty array');
    assert.deepStrictEqual([...groups[1].tags], ['prone'], 'existing tags survive untouched');
  });

  test('v11 firearms gain an unset optic unit', () => {
    const v11 = {
      schemaVersion: 11, isDemo: false, locations: [], sellers: [], sessions: [], ammo: [],
      firearms: [
        { id: 'g1', name: 'No Optic', type: 'rifle', calibers: ['.223 Rem'], cleanThreshold: 500,
          totalRounds: 0, cleanings: [], zeros: [], notes: '', groups: [] },
        { id: 'g2', name: 'Has Optic', type: 'rifle', calibers: ['.308 Win'], cleanThreshold: 500,
          totalRounds: 0, cleanings: [], zeros: [], notes: '', groups: [], opticUnit: 'mrad' },
      ],
    };
    const guns = win.migrateData(JSON.parse(JSON.stringify(v11))).firearms;
    assert.strictEqual(guns[0].opticUnit, null, 'unset rather than assumed');
    assert.strictEqual(guns[1].opticUnit, 'mrad', 'an existing setting survives');
  });

  test('v12 data gains an empty dope array without disturbing existing tables', () => {
    const v12 = {
      schemaVersion: 12, isDemo: false, locations: [], sellers: [], sessions: [], ammo: [],
      firearms: [
        { id: 'g1', name: 'No Dope', type: 'rifle', calibers: ['.223 Rem'], cleanThreshold: 500,
          totalRounds: 0, cleanings: [], zeros: [], notes: '', groups: [], opticUnit: null },
      ],
    };
    const guns = win.migrateData(JSON.parse(JSON.stringify(v12))).firearms;
    assert.deepStrictEqual([...guns[0].dope], [], 'every firearm gets the array');
  });

  test('v13 purchases default to range ammo', () => {
    const v13 = {
      schemaVersion: 13, isDemo: false, firearms: [], locations: [], sellers: [], sessions: [],
      ammo: [
        { id: 'a1', date: '2026-01-01', caliber: '9mm', quantity: 500, totalPrice: 120 },
        { id: 'a2', date: '2026-01-02', caliber: '9mm', quantity: 20, totalPrice: 30, rangeAmmo: false },
      ],
    };
    const out = win.migrateData(JSON.parse(JSON.stringify(v13)));
    assert.strictEqual(out.ammo[0].rangeAmmo, true,
      'everything logged before the flag existed was bought to shoot');
    assert.strictEqual(out.ammo[1].rangeAmmo, false, 'an existing setting survives');
  });

  test('the Settings schema badge matches the actual schema version', async () => {
    const badge = win.document.body.textContent.match(/Data schema v(\d+)/);
    assert.ok(badge, 'schema badge not found in Settings');
    assert.strictEqual(Number(badge[1]), CURRENT,
      'the badge in index.html was not bumped alongside SCHEMA_VERSION');
  });

  test('already-current data passes through without modification', () => {
    const current = win.buildDefaultData();
    const migrated = win.migrateData(JSON.parse(JSON.stringify(current)));
    assert.strictEqual(migrated.schemaVersion, CURRENT);
    assert.strictEqual(migrated.firearms.length, current.firearms.length);
  });
});

// ── CALIBER MERGE + DISCLAIMER ──────────────────────────────────────

describe('caliber merge and disclaimer', () => {
  test('shared-signature calibers get a merged entry, without losing the individual ones', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    const sel = win.document.getElementById('stats-caliber');
    const options = Array.from(sel.options).map(o => o.textContent);

    // Demo data: Example Rifle is the only gun with .223 Rem AND 5.56 NATO, so they merge.
    // The merged entry exists because rounds fired through that rifle cannot be attributed to
    // one token or the other.
    assert.ok(options.includes('.223 Rem / 5.56 NATO'), 'the merged option should exist');

    // But the individual tokens stay, because a purchase always names exactly one caliber and
    // .223 match is a different product from bulk 5.56. Merging them on Money would compare
    // products rather than prices.
    assert.ok(options.includes('.223 Rem'), 'individual calibers must remain selectable');
    assert.ok(options.includes('5.56 NATO'), 'individual calibers must remain selectable');

    const mergedOpt = Array.from(sel.options).find(o => o.textContent === '.223 Rem / 5.56 NATO');
    assert.strictEqual(mergedOpt.parentElement.tagName, 'OPTGROUP',
      'the merged entries are grouped so they read as a different kind of choice');
    assert.strictEqual(mergedOpt.parentElement.label, 'Shared chambers');
  });

  test('a caliber that shares no chamber is listed once, not twice', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    const options = Array.from(win.document.getElementById('stats-caliber').options)
      .map(o => o.textContent);
    const nine = options.filter(o => o === '9mm');
    assert.strictEqual(nine.length, 1,
      'a single-token group would just duplicate the individual entry above it');
  });

  test('selecting a merged caliber group returns the same total as the firearm-only filter', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.document.getElementById('stats-range').value = '12months';

    const gunSelect = win.document.getElementById('stats-firearm');
    const calSelect = win.document.getElementById('stats-caliber');
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
    const calSelect = win.document.getElementById('stats-caliber');
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
    const calSelect = win.document.getElementById('stats-caliber');
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
    win.document.getElementById('stats-range').value = '12months';

    const gunSelect = win.document.getElementById('stats-firearm');
    const calSelect = win.document.getElementById('stats-caliber');
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
    win.document.getElementById('stats-range').value = '12months';

    const gunSelect = win.document.getElementById('stats-firearm');
    const calSelect = win.document.getElementById('stats-caliber');
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

    win.document.getElementById('stats-range').value = 'month';
    win.renderStats();
    let title = win.document.getElementById('stats-rf-chart').innerHTML.match(/stats-chart-title">([^<]+)</)[1];
    assert.strictEqual(title, 'Rounds per Week');

    win.document.getElementById('stats-range').value = '12months';
    win.renderStats();
    title = win.document.getElementById('stats-rf-chart').innerHTML.match(/stats-chart-title">([^<]+)</)[1];
    assert.strictEqual(title, 'Rounds per Month');
  });

  test('100-day custom range uses weekly, 101-day uses monthly (threshold boundary)', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    const isoMinusDays = d => { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt.toISOString().slice(0, 10); };
    const todayStr = new Date().toISOString().slice(0, 10);

    win.document.getElementById('stats-range').value = 'custom';
    win.handleStatsRangeChange();
    win.document.getElementById('stats-start').value = isoMinusDays(100);
    win.document.getElementById('stats-end').value = todayStr;
    win.renderStats();
    let title = win.document.getElementById('stats-rf-chart').innerHTML.match(/stats-chart-title">([^<]+)</)[1];
    assert.strictEqual(title, 'Rounds per Week');

    win.document.getElementById('stats-start').value = isoMinusDays(101);
    win.renderStats();
    title = win.document.getElementById('stats-rf-chart').innerHTML.match(/stats-chart-title">([^<]+)</)[1];
    assert.strictEqual(title, 'Rounds per Month');
  });

  test('weekly charts with more than 8 bars alternate labels; monthly charts never do', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');

    win.document.getElementById('stats-range').value = '3months';
    win.renderStats();
    let chartHtml = win.document.getElementById('stats-rf-chart').innerHTML;
    const barCount = (chartHtml.match(/stats-bar-col/g) || []).length;
    const hiddenCount = (chartHtml.match(/hidden-label/g) || []).length;
    if (barCount > 8) assert.ok(hiddenCount > 0, 'dense weekly charts should thin out labels');

    win.document.getElementById('stats-range').value = '12months';
    win.renderStats();
    chartHtml = win.document.getElementById('stats-rf-chart').innerHTML;
    assert.strictEqual((chartHtml.match(/hidden-label/g) || []).length, 0, 'monthly charts (max 12 bars) should never hide labels');
  });

  test('"Avg / Month" reflects a true calendar-month average regardless of chart bucket granularity', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.document.getElementById('stats-range').value = 'month';
    win.document.getElementById('stats-location').value = '';
    win.document.getElementById('stats-firearm').value = '';
    win.document.getElementById('stats-caliber').value = '';
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

// ── GROUP ↔ SESSION LINKING ─────────────────────────────────────────

describe('groups linked to sessions', () => {
  test('demo groups attach to a real session and the scorecard reports them', async () => {
    const win = await ready(loadApp());
    const gun = win.buildDefaultData().firearms.find(g => g.groups.length);
    const sessionId = gun.groups[0].sessionId;
    assert.ok(sessionId, 'demo groups should be linked to a session');
    assert.ok(gun.groups.every(g => g.sessionId === sessionId), 'all demo groups share one session');

    win.showTab('sessions');
    const html = win.document.getElementById('sessions-list').innerHTML;
    assert.ok(html.includes('Groups this session'), 'the linked session should show a scorecard');
    assert.ok(/best \d+\.\d+ · avg \d+\.\d+ MOA/.test(html), 'scorecard shows best and average MOA');
  });

  test('sessions without groups show no scorecard at all', async () => {
    const win = await ready(loadApp());
    win.showTab('sessions');
    const cards = [...win.document.querySelectorAll('.session-card')];
    const withScorecard = cards.filter(c => c.querySelector('.scorecard'));
    assert.ok(withScorecard.length >= 1, 'at least one session has groups');
    assert.ok(withScorecard.length < cards.length, 'sessions without groups stay clean');
  });

  test('deleting a session unlinks its groups instead of leaving them dangling', async () => {
    const win = await ready(loadApp());
    // Demo ids are deterministic, so a fresh build names the same session the live data uses.
    const sessionId = win.buildDefaultData().firearms.find(g => g.groups.length).groups[0].sessionId;

    const linked = win.groupsForSession(sessionId);
    assert.ok(linked.length > 0, 'demo data should have groups on this session');
    const unlinkedBefore = win.groupsForSession(null).length;

    win.deleteSession(sessionId);

    assert.strictEqual(win.groupsForSession(sessionId).length, 0,
      'nothing may still point at a deleted session');
    assert.strictEqual(win.groupsForSession(null).length, unlinkedBefore + linked.length,
      'the groups themselves must survive the session being deleted, just unlinked');
  });
});

// ── GROUP TAGS ──────────────────────────────────────────────────────

describe('group tags', () => {
  test('known tags are gathered across every group, deduped case-insensitively', async () => {
    const win = await ready(loadApp());
    const tags = win.allKnownTags();
    assert.ok(tags.length > 0, 'demo groups should carry tags');
    const lower = tags.map(t => t.toLowerCase());
    assert.strictEqual(new Set(lower).size, lower.length, 'no tag should appear twice');
  });

  test('demo groups carry tags that differ, so they are worth comparing', async () => {
    const win = await ready(loadApp());
    const gun = win.buildDefaultData().firearms.find(g => g.groups.length);
    const sets = gun.groups.map(g => (g.tags || []).join(','));
    assert.ok(sets.every(s => s.length), 'every demo group is tagged');
    assert.ok(new Set(sets).size > 1, 'not all demo groups share the same tags');
  });
});

// ── STATS · GROUPS PANE ─────────────────────────────────────────────

describe('stats groups pane', () => {
  const gunWithGroups = win => win.buildDefaultData().firearms.find(g => (g.groups || []).length);
  const pick = (win, gunId, range = 'all') => {
    win.showTab('stats');
    win.showStatsSection('groups');
    win.document.getElementById('stats-firearm').value = gunId || '';
    win.renderStats();
    if (range) {
      win.document.getElementById('stats-range').value = range;
      win.renderStats();
    }
  };

  test('with no firearm chosen it explains itself instead of drawing an empty chart', async () => {
    const win = await ready(loadApp());
    pick(win, '', null);
    const prompt = win.document.getElementById('stats-groups-prompt').textContent;
    assert.match(prompt, /Pick a firearm/i);
    assert.match(prompt, /comparable/i, 'it should say why this view is single-firearm');
    assert.strictEqual(win.document.getElementById('stats-groups-body').style.display, 'none');
  });

  test('choosing a firearm shows its groups and hides the prompt', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    pick(win, gun.id);
    assert.strictEqual(win.document.getElementById('stats-groups-prompt').textContent.trim(), '');
    assert.notStrictEqual(win.document.getElementById('stats-groups-body').style.display, 'none');
    const { groups } = win.groupsInScope();
    assert.strictEqual(groups.length, gun.groups.length);
  });

  test('group size is recomputed, never read from the record', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    pick(win, gun.id);
    const before = win.groupsInScope().groups[0].mrMOA;

    // Tell the app the scale reference is twice the real size it was. The marked points are
    // untouched, but each one now stands for twice as many inches, so the same holes
    // describe a group twice as large.
    win.openLogGroup(gun.id, gun.groups[0].id);
    const cal = win.document.getElementById('group-cal-w');
    cal.value = String(parseFloat(cal.value) * 2);
    win.saveGroup();

    pick(win, gun.id);
    const after = win.groupsInScope().groups[0].mrMOA;
    assert.ok(Math.abs(after - before * 2) < 1e-6,
      `doubling the reference should double the measured group (${before} -> ${after})`);
  });

  test('a zero anchor appears only on Groups, and only with a firearm chosen', async () => {
    const win = await ready(loadApp());
    const gun = win.buildDefaultData().firearms[0];
    // Demo firearms ship no zeros, so add one through the app.
    win.openLogZero(gun.id);
    win.document.getElementById('zero-date').value = '2026-01-15';
    win.document.getElementById('zero-distance').value = '50';
    win.saveZero();

    const anchors = () => [...win.document.getElementById('stats-range').options]
      .filter(o => o.value.startsWith('zero:'));

    pick(win, gun.id, null);
    assert.strictEqual(anchors().length, 1, 'Groups with a firearm offers its zeros');

    pick(win, '', null);
    assert.strictEqual(anchors().length, 0, 'no firearm, no anchors');

    win.document.getElementById('stats-firearm').value = gun.id;
    win.showStatsSection('practice');
    assert.strictEqual(anchors().length, 0, 'a zero anchor is meaningless on Practice');
  });

  test('groups dated the same day as a zero count as after it', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    const dates = [...new Set(gun.groups.map(g => g.date))].sort();
    const anchorDate = dates[dates.length - 1];

    win.openLogZero(gun.id);
    win.document.getElementById('zero-date').value = anchorDate;
    win.document.getElementById('zero-distance').value = '50';
    win.saveZero();

    pick(win, gun.id, null);
    const anchor = [...win.document.getElementById('stats-range').options]
      .find(o => o.value.startsWith('zero:'));
    win.document.getElementById('stats-range').value = anchor.value;
    win.renderStats();

    const inScope = win.groupsInScope().groups;
    const sameDay = gun.groups.filter(g => g.date === anchorDate).length;
    assert.ok(sameDay > 0, 'precondition: groups share the zero date');
    assert.strictEqual(inScope.length, sameDay,
      'same-day groups are kept (counted as after the zero), earlier ones dropped');
    assert.ok(inScope.every(g => g.date >= anchorDate));
  });

  test('an anchor from another firearm is dropped rather than silently kept', async () => {
    const win = await ready(loadApp());
    const [a, b] = win.buildDefaultData().firearms;
    win.openLogZero(a.id);
    win.document.getElementById('zero-date').value = '2026-01-15';
    win.document.getElementById('zero-distance').value = '50';
    win.saveZero();

    pick(win, a.id, null);
    const anchor = [...win.document.getElementById('stats-range').options]
      .find(o => o.value.startsWith('zero:'));
    win.document.getElementById('stats-range').value = anchor.value;
    win.renderStats();

    win.document.getElementById('stats-firearm').value = b.id;
    win.renderStats();
    assert.strictEqual(win.document.getElementById('stats-range').value, '12months',
      "the other firearm's zero is not a range this firearm can be measured against");
  });

  test('the trend joins one point per range day, not one per group', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    pick(win, gun.id);
    const svg = win.document.querySelector('#stats-groups-trend svg');
    assert.ok(svg, 'the chart renders');

    const days = new Set(gun.groups.map(g => g.date)).size;
    const line = svg.querySelector('polyline');
    assert.strictEqual(line.getAttribute('points').trim().split(/\s+/).length, days,
      'the median line has one vertex per range day');
    // Every group is still drawn behind it.
    assert.ok(svg.querySelectorAll('circle').length >= gun.groups.length + days,
      'individual groups are plotted as well as the medians');
  });

  test('re-zero marks are drawn even when the range is not anchored to one', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    const mid = [...new Set(gun.groups.map(g => g.date))].sort()[0];
    win.openLogZero(gun.id);
    win.document.getElementById('zero-date').value = mid;
    win.document.getElementById('zero-distance').value = '50';
    win.saveZero();

    pick(win, gun.id, 'all');            // plain calendar range, not a zero anchor
    const svg = win.document.querySelector('#stats-groups-trend svg');
    assert.match(svg.innerHTML, /re-zero/,
      'hiding the boundary unless you filtered by it is how you read straight through one');
  });

  test('a firearm with no groups says so rather than rendering a broken chart', async () => {
    const win = await ready(loadApp());
    const bare = win.buildDefaultData().firearms.find(g => !(g.groups || []).length);
    assert.ok(bare, 'demo data has a firearm without groups');
    pick(win, bare.id);
    assert.match(win.document.getElementById('stats-groups-stats').textContent, /No measurable groups/i);
    assert.strictEqual(win.document.getElementById('stats-groups-trend').innerHTML, '');
  });
});

// ── STATS · COMPARE BY ──────────────────────────────────────────────
// Prone vs bench is the same chart as Norma vs CCI, so it is one view with a grouping
// control. These guard the grouping itself and the caveats the chart has to state.

describe('group comparison', () => {
  const gunWithGroups = win => win.buildDefaultData().firearms.find(g => (g.groups || []).length);
  const open = (win, gunId, dim) => {
    win.showTab('stats');
    win.showStatsSection('groups');
    win.document.getElementById('stats-firearm').value = gunId;
    win.document.getElementById('stats-range').value = 'all';
    if (dim) win.document.getElementById('stats-groups-compare-by').value = dim;
    win.renderStats();
  };
  const rowLabels = win => [...win.document.querySelectorAll('#stats-groups-compare .cmp-name-t')]
    .map(t => t.textContent.trim());
  const medians = win => [...win.document.querySelectorAll('#stats-groups-compare .cmp-med')]
    .map(t => Number(t.textContent));

  test('distances are normalised, so 25 ft and 8.333 yd are one bucket', async () => {
    const win = await ready(loadApp());
    // Pure helpers, tested directly — building two groups at the same distance expressed
    // two ways would take more scaffolding than the thing under test.
    assert.strictEqual(win.groupDistanceLabel({ distance: 25, distanceUnit: 'ft' }), '8.3 yd');
    assert.strictEqual(win.groupDistanceLabel({ distance: 8.333, distanceUnit: 'yd' }), '8.3 yd');
    assert.strictEqual(win.groupDistanceLabel({ distance: 50, distanceUnit: 'yd' }), '50 yd');
    assert.ok(Math.abs(win.groupDistanceYards({ distance: 100, distanceUnit: 'm' }) - 109.361) < 0.01);
  });

  test('long load names are shortened for display, never in storage', async () => {
    const win = await ready(loadApp());
    const full = 'CCI Standard Velocity 22LR Ammo 40 Grain Round Nose';
    assert.strictEqual(win.shortLoadName(full), 'CCI Standard Velocity 22LR 40gr');
    assert.strictEqual(win.shortLoadName('Federal Champion FMJ 115 grain'),
      'Federal Champion FMJ 115gr');
    // A trailing SKU goes, but only when it is actually trailing — a hyphen inside the
    // product name is part of the name.
    assert.strictEqual(
      win.shortLoadName('New Republic Training and Range 9mm Ammo 124 Grain Full Metal Jacket - NR912450'),
      'New Republic Training and Range 9mm 124gr');
    assert.strictEqual(win.shortLoadName('Norma Tac-22'), 'Norma Tac-22',
      'a hyphenated calibre is part of the name, not a SKU');
    assert.strictEqual(
      win.shortLoadName('CCI Mini-Mag 22 Long Rifle Ammo 40 Grain Copper Plated Round Nose - 3050CC'),
      'CCI Mini-Mag 22 Long Rifle 40gr',
      'a hyphen mid-name survives while the trailing SKU goes');

    // Nothing recognisable to strip: leave it alone rather than return an empty label.
    assert.strictEqual(win.shortLoadName('BPS FMJ M193 55 grain'), 'BPS FMJ M193 55gr');
    assert.strictEqual(win.shortLoadName(''), '');
  });

  test('buckets are ranked best-first by median', async () => {
    const win = await ready(loadApp());
    // Demo groups all fall on one range day, so tag is the dimension with several buckets.
    open(win, gunWithGroups(win).id, 'tag');
    const meds = medians(win);
    assert.ok(meds.length >= 2, 'demo groups carry more than one tag');
    meds.forEach((m, i) => {
      if (i) assert.ok(m >= meds[i - 1], `rows must run best-first (${meds.join(', ')})`);
    });
  });

  test('untagged groups get their own bucket rather than vanishing', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    open(win, gun.id, 'tag');
    const labels = rowLabels(win);
    const tagged = gun.groups.filter(g => (g.tags || []).length).length;
    const untagged = gun.groups.length - tagged;
    if (untagged > 0 && tagged > 0) {
      assert.ok(labels.includes('Untagged'), 'untagged groups are still counted somewhere');
    }
    // Whatever the split, every group must land in at least one bucket.
    const ns = [...win.document.querySelectorAll('#stats-groups-compare .cmp-name span:not(.cmp-name-t)')]
      .map(t => parseInt(t.textContent.replace(/^n=/, ''), 10));
    assert.ok(ns.reduce((a, b) => a + b, 0) >= gun.groups.length);
  });

  test('a dimension with one bucket says so instead of drawing a one-row chart', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    // Demo groups are all at one distance, so this is the real single-bucket case.
    const distances = new Set(gun.groups.map(g =>
      win.groupDistanceLabel({ distance: g.distance, distanceUnit: g.distanceUnit })));
    assert.strictEqual(distances.size, 1, 'precondition: demo groups share a distance');
    open(win, gun.id, 'distance');
    const el = win.document.getElementById('stats-groups-compare');
    assert.match(flat(el), /nothing to compare/i);
    assert.strictEqual(el.querySelector('.cmp-chart'), null, 'no chart for a single bucket');
  });

  test('a bucket drawn from one afternoon is flagged, not presented as a result', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    open(win, gun.id, 'tag');
    const note = flat(win.document.getElementById('stats-groups-compare'));

    // Whether the warning should fire is a property of the data, so derive it rather than
    // assuming: it fires only when every bucket sits on a single range day.
    const byTag = {};
    gun.groups.forEach(g => ((g.tags || []).length ? g.tags : ['Untagged'])
      .forEach(t => (byTag[t] = byTag[t] || []).push(g)));
    const everyBucketOneDay = Object.values(byTag)
      .every(gs => new Set(gs.map(g => g.date)).size === 1);

    if (everyBucketOneDay) {
      assert.match(note, /compares afternoons/i,
        'a bucket from one afternoon is evidence about that afternoon, not about the tag');
      assert.match(note, /range day/i, 'and it should name the cross-check');
    } else {
      assert.doesNotMatch(note, /compares afternoons/i,
        'the warning must not fire when buckets span several days');
    }
  });

  test('comparing by range day never warns about afternoons — that is the axis', async () => {
    const win = await ready(loadApp());
    open(win, gunWithGroups(win).id, 'day');
    assert.doesNotMatch(flat(win.document.getElementById('stats-groups-compare')),
      /compares afternoons/i);
  });

  test('the tag view warns that a group can sit in two rows', async () => {
    const win = await ready(loadApp());
    open(win, gunWithGroups(win).id, 'tag');
    assert.match(flat(win.document.getElementById('stats-groups-compare')),
      /multi-valued/i, 'bucket counts not adding up needs explaining, not hiding');
    open(win, gunWithGroups(win).id, 'ammo');
    assert.doesNotMatch(flat(win.document.getElementById('stats-groups-compare')),
      /multi-valued/i, 'ammo is single-valued, so the caveat would be noise');
  });

  test('every grouping renders without throwing, including on a firearm with no groups', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    const bare = win.buildDefaultData().firearms.find(g => !(g.groups || []).length);
    ['ammo', 'tag', 'day', 'distance'].forEach(dim => {
      assert.doesNotThrow(() => open(win, gun.id, dim), `${dim} threw`);
      assert.doesNotThrow(() => open(win, bare.id, dim), `${dim} threw on an empty firearm`);
    });
  });
});

// ── STATS · POINT OF IMPACT ─────────────────────────────────────────
// Group size says what the firearm can do; this says whether it is pointed where you think.
// The sign convention is the thing most worth guarding: getting it backwards would tell you
// to dial the wrong way.

describe('point of impact map', () => {
  const gunWithGroups = win => win.buildDefaultData().firearms.find(g => (g.groups || []).length);
  const open = (win, gunId, dim) => {
    win.showTab('stats');
    win.showStatsSection('groups');
    win.document.getElementById('stats-firearm').value = gunId;
    win.document.getElementById('stats-range').value = 'all';
    if (dim) win.document.getElementById('stats-groups-compare-by').value = dim;
    win.renderStats();
  };
  const poi = win => win.document.getElementById('stats-groups-poi');

  test('up is up and right is right', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    open(win, gun.id, 'ammo');
    const svg = poi(win).querySelector('svg');
    assert.ok(svg, 'the map renders');

    const { groups } = win.groupsInScope();
    const dots = [...svg.querySelectorAll('circle')].filter(c => c.getAttribute('r') === '4');
    assert.strictEqual(dots.length, groups.length, 'one dot per group');

    // The viewBox is square and centred on point of aim.
    const [, , vw] = svg.getAttribute('viewBox').split(' ').map(Number);
    const C = vw / 2;
    const highest = groups.reduce((a, b) => (a.offYMOA > b.offYMOA ? a : b));
    const rightmost = groups.reduce((a, b) => (a.offXMOA > b.offXMOA ? a : b));

    const ys = dots.map(d => Number(d.getAttribute('cy')));
    const xs = dots.map(d => Number(d.getAttribute('cx')));
    if (highest.offYMOA > 0) {
      assert.ok(Math.min(...ys) < C,
        'a group above aim must plot above centre — screen y is inverted');
    }
    if (rightmost.offXMOA > 0) {
      assert.ok(Math.max(...xs) > C, 'a group right of aim must plot right of centre');
    }
  });

  test('the summary names the direction the data actually shows', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    open(win, gun.id, 'ammo');
    const { groups } = win.groupsInScope();
    const my = win.statsMedian(groups.map(g => g.offYMOA));
    const mx = win.statsMedian(groups.map(g => g.offXMOA));
    const note = flat(poi(win).querySelector('.stats-note'));

    if (Math.abs(my) >= 0.05) {
      assert.match(note, my > 0 ? /high/ : /low/,
        `median elevation ${my} should be described as ${my > 0 ? 'high' : 'low'}`);
      assert.doesNotMatch(note, my > 0 ? /\blow\b/ : /\bhigh\b/);
    }
    if (Math.abs(mx) >= 0.05) {
      assert.match(note, mx > 0 ? /right/ : /left/);
    }
  });

  test('fewer than two groups draws nothing rather than a lone dot', async () => {
    const win = await ready(loadApp());
    const bare = win.buildDefaultData().firearms.find(g => !(g.groups || []).length);
    open(win, bare.id, 'ammo');
    assert.strictEqual(poi(win).innerHTML, '');
  });

  test('colour is capped at the four the palette was validated for', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);

    open(win, gun.id, 'ammo');   // demo groups share one ammo → a single bucket
    const oneBucket = poi(win).querySelectorAll('.poi-legend span').length;
    assert.strictEqual(oneBucket, 0, 'one bucket needs no legend');
    assert.strictEqual(poi(win).querySelectorAll('.poi-centre').length, 0,
      'and no per-row median cross');

    open(win, gun.id, 'tag');    // demo groups carry several tags
    const names = new Set();
    win.groupsInScope().groups.forEach(g =>
      (g.tags.length ? g.tags : ['Untagged']).forEach(t => names.add(t)));
    const legend = poi(win).querySelectorAll('.poi-legend span').length;
    if (names.size >= 2 && names.size <= 4) {
      assert.strictEqual(legend, names.size, 'each bucket is named beside its colour');
      assert.strictEqual(poi(win).querySelectorAll('.poi-centre').length, names.size);
    } else {
      assert.strictEqual(legend, 0,
        'beyond four buckets the palette cannot separate them, so it stops colouring');
    }
  });

  test('a re-zero inside the visible range is called out', async () => {
    const win = await ready(loadApp());
    const gun = gunWithGroups(win);
    const dates = [...new Set(gun.groups.map(g => g.date))].sort();

    open(win, gun.id, 'ammo');
    assert.doesNotMatch(flat(poi(win)), /re-zero falls inside/i,
      'no zeros logged yet, so nothing to warn about');

    // A zero dated after the earliest group and on or before the latest sits inside the span.
    const inside = dates[dates.length - 1];
    win.openLogZero(gun.id);
    win.document.getElementById('zero-date').value = inside;
    win.document.getElementById('zero-distance').value = '50';
    win.saveZero();
    open(win, gun.id, 'ammo');

    const spans = inside > dates[0];
    if (spans) {
      assert.match(flat(poi(win)), /re-zero falls inside/i,
        'averaging point of impact across a zero change describes neither side');
    } else {
      assert.doesNotMatch(flat(poi(win)), /re-zero falls inside/i,
        'a zero on or before the first group does not split the data');
    }
  });
});

// ── SHARED STATS FILTER BAR ─────────────────────────────────────────
// Stats used to carry three independent filter sets, so setting a firearm in Rounds Fired
// left Ammo Spend reporting every caliber you own with nothing on screen saying so. One bar
// now drives all four panes; these guard the parts that were previously unfiltered.

describe('shared stats filter bar', () => {
  const setFilter = (win, id, value) => {
    const el = win.document.getElementById(id);
    el.value = value;
    win.renderStats();
  };
  const num = (win, id) => {
    const el = win.document.getElementById(id);
    const box = el.querySelector('.stats-stat-num');
    return box ? box.textContent.replace(/[$,]/g, '') : null;
  };

  test('there is exactly one of each filter control', async () => {
    const win = await ready(loadApp());
    ['stats-range', 'stats-location', 'stats-firearm', 'stats-caliber'].forEach(id => {
      assert.ok(win.document.getElementById(id), `${id} missing`);
    });
    ['stats-rf-range', 'stats-rt-range', 'stats-as-range', 'stats-rf-caliber', 'stats-as-caliber']
      .forEach(id => assert.strictEqual(win.document.getElementById(id), null,
        `${id} should be gone — a leftover control means two sources of truth`));
  });

  test('a firearm filter now reaches Range Trips, which previously ignored it', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    setFilter(win, 'stats-range', 'all');
    const allTrips = Number(num(win, 'stats-rt-stats'));
    assert.ok(allTrips > 0);

    const gun = win.buildDefaultData().firearms.find(g => g.name === 'Example Shotgun');
    setFilter(win, 'stats-firearm', gun.id);
    const scoped = Number(num(win, 'stats-rt-stats'));
    assert.ok(scoped < allTrips,
      `trips should narrow to the ones this firearm was shot on (${scoped} vs ${allTrips})`);
    assert.ok(scoped > 0, 'the demo shotgun is shot on some trips');
  });

  test('a firearm filter reaches Ammo Spend, scoped to that firearm\'s calibers', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    setFilter(win, 'stats-range', 'all');
    const allSpend = Number(num(win, 'stats-as-stats'));

    const gun = win.buildDefaultData().firearms.find(g => g.name === 'Example Shotgun');
    setFilter(win, 'stats-firearm', gun.id);
    const scoped = Number(num(win, 'stats-as-stats'));
    assert.ok(scoped < allSpend, 'spend narrows to the calibers this firearm uses');

    // And it must say what it did, because the number is weaker than it looks. Collapse
    // whitespace first — the copy wraps in the source and would otherwise defeat the match.
    const note = win.document.getElementById('stats-as-scope-note')
      .textContent.replace(/\s+/g, ' ');
    assert.match(note, /calibers/i);
    assert.match(note, /not what it consumed/i,
      'the limit of the inference has to be on screen, not just in a comment');
  });

  test('clearing the firearm filter removes the scope note', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    const gun = win.buildDefaultData().firearms[0];
    setFilter(win, 'stats-firearm', gun.id);
    assert.ok(win.document.getElementById('stats-as-scope-note').textContent.length > 0);
    setFilter(win, 'stats-firearm', '');
    assert.strictEqual(win.document.getElementById('stats-as-scope-note').textContent.trim(), '');
  });

  test('filters that cannot apply are disabled and explained, not silently ignored', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');

    win.showStatsSection('practice');
    ['range', 'location', 'firearm', 'caliber'].forEach(k =>
      assert.strictEqual(win.document.getElementById('stats-' + k).disabled, false,
        `${k} should be live on Practice`));

    win.showStatsSection('money');
    assert.strictEqual(win.document.getElementById('stats-location').disabled, true,
      'purchases have a seller, not a location');
    assert.ok(win.document.getElementById('statsf-location').classList.contains('na'));
    assert.match(win.document.getElementById('stats-filter-note').textContent, /seller/);

    win.showStatsSection('upkeep');
    assert.strictEqual(win.document.getElementById('stats-range').disabled, true,
      'rounds since clean is a state now, not a period');
    assert.match(win.document.getElementById('stats-filter-note').textContent, /state now/);
  });

  test('the caliber filter uses merged groups everywhere, including Money', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    const opts = [...win.document.getElementById('stats-caliber').options].map(o => o.value);
    // A merged group's value joins its tokens; a raw single caliber has no separator.
    assert.ok(opts.some(v => v.includes('||')),
      'demo data has a firearm with two calibers, so a merged option must exist');
  });

  test('Upkeep narrows to the filtered firearm', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.showStatsSection('upkeep');
    const count = () => win.document.querySelectorAll('#stats-upkeep-cleaning .breakdown-row').length;
    const all = count();
    const gun = win.buildDefaultData().firearms[0];
    setFilter(win, 'stats-firearm', gun.id);
    assert.strictEqual(count(), 1, `one firearm selected, ${all} shown before`);
  });
});

// ── INDIVIDUAL vs MERGED CALIBERS ON MONEY ──────────────────────────
// The merged group exists because rounds fired through a .223/5.56 rifle cannot be
// attributed to one token. Purchases have no such ambiguity, and the two chamberings are
// different products at different prices — so both must stay selectable, and picking one
// must not quietly return the combined figure.

describe('picking an individual caliber on Money', () => {
  // Adds a purchase through the app's own save path rather than patching demo data, so the
  // test exercises the same code the user does.
  function addPurchase(win, { caliber, quantity, totalPrice, date = '2026-03-01' }) {
    win.openAddAmmo();
    win.document.getElementById('ammo-date').value = date;
    const sel = win.document.getElementById('ammo-caliber-select');
    const known = Array.from(sel.options).find(o => o.value === caliber);
    if (known) { sel.value = caliber; } else {
      sel.value = '__custom__';
      win.handleCaliberSelectChange();
      win.document.getElementById('ammo-caliber-custom').value = caliber;
    }
    win.document.getElementById('ammo-manufacturer').value = 'Test';
    win.document.getElementById('ammo-model').value = caliber + ' load';
    win.document.getElementById('ammo-quantity').value = String(quantity);
    win.document.getElementById('ammo-price').value = String(totalPrice);
    win.saveAmmo();
  }

  // Give the demo rifle both chamberings so a merged group exists for them.
  const bothChamberings = js => {
    const patched = js.replace(
      /(\{ id: g1,[^}]*?calibers: )\['\.223 Rem', '5\.56 NATO'\]/,
      "$1['.223 Rem', '5.56 NATO']"
    );
    return patched;
  };

  const spend = win => parseFloat(win.document.querySelector('#stats-as-stats .stats-stat-num')
    .textContent.replace(/[$,]/g, ''));
  const cpr = win => parseFloat([...win.document.querySelectorAll('#stats-as-stats .stats-stat-box')]
    .find(b => /CPR/i.test(b.textContent))
    .querySelector('.stats-stat-num').textContent.replace('$', ''));

  test('one token returns that token alone, and the merged entry returns the sum', async () => {
    const win = await ready(loadApp(bothChamberings));
    // Bulk 5.56 at $0.40/rd against match .223 already in demo data at $0.35/rd — priced
    // differently on purpose, which is the entire reason not to merge them here.
    addPurchase(win, { caliber: '5.56 NATO', quantity: 1000, totalPrice: 400 });

    win.showTab('stats');
    win.showStatsSection('money');
    win.document.getElementById('stats-range').value = 'all';
    const sel = win.document.getElementById('stats-caliber');

    const opt223 = Array.from(sel.options).find(o => o.value === '.223 Rem');
    const opt556 = Array.from(sel.options).find(o => o.value === '5.56 NATO');
    const optBoth = Array.from(sel.options).find(o => o.value.includes('||'));
    assert.ok(opt223 && opt556 && optBoth, 'all three options should be offered');

    sel.value = opt223.value; win.renderStats(); const a = spend(win), aRate = cpr(win);
    sel.value = opt556.value; win.renderStats(); const b = spend(win), bRate = cpr(win);
    sel.value = optBoth.value; win.renderStats(); const both = spend(win), bothRate = cpr(win);

    assert.ok(a > 0 && b > 0, 'both chamberings have purchases in this scenario');
    assert.ok(Math.abs(both - (a + b)) < 0.02,
      `merged should total its parts (${a} + ${b} vs ${both})`);
    assert.notStrictEqual(a, both, 'picking .223 must not return the combined figure');
    assert.notStrictEqual(b, both, 'picking 5.56 must not return the combined figure');

    // And the blended rate describes neither product, which is the point.
    assert.ok(Math.abs(aRate - bRate) > 0.001, 'the two are priced differently');
    const lo = Math.min(aRate, bRate), hi = Math.max(aRate, bRate);
    assert.ok(bothRate > lo && bothRate < hi,
      `the merged rate (${bothRate}) sits between ${lo} and ${hi}, matching neither`);
  });
});

// ── NON-RANGE AMMO ──────────────────────────────────────────────────
// A 20-round box of carry ammo at five times the price says nothing about what practice
// costs. Totals still count it — the money was spent — but per-round figures must not.

describe('non-range ammo', () => {
  const openMoney = (win, range = 'all') => {
    win.showTab('stats');
    win.showStatsSection('money');
    win.document.getElementById('stats-range').value = range;
    win.renderStats();
  };
  const stat = (win, label) => {
    const box = [...win.document.querySelectorAll('#stats-as-stats .stats-stat-box')]
      .find(b => new RegExp(label, 'i').test(b.querySelector('.stats-stat-label').textContent));
    return box ? parseFloat(box.querySelector('.stats-stat-num').textContent.replace(/[$,]/g, '')) : null;
  };

  test('the flag round-trips through the form', async () => {
    const win = await ready(loadApp());
    win.openAddAmmo();
    assert.strictEqual(win.document.getElementById('ammo-not-range').checked, false,
      'the common case must be the default, or the flag is a chore');

    win.document.getElementById('ammo-date').value = '2026-03-01';
    win.document.getElementById('ammo-caliber-select').value = '__custom__';
    win.handleCaliberSelectChange();
    win.document.getElementById('ammo-caliber-custom').value = '9mm';
    win.document.getElementById('ammo-manufacturer').value = 'Test';
    win.document.getElementById('ammo-model').value = 'Carry JHP';
    win.document.getElementById('ammo-quantity').value = '20';
    win.document.getElementById('ammo-price').value = '30';
    win.document.getElementById('ammo-not-range').checked = true;
    win.saveAmmo();

    const saved = JSON.parse(win.localStorage.getItem('rangeLogData')).ammo
      .find(a => a.model === 'Carry JHP');
    assert.ok(saved);
    assert.strictEqual(saved.rangeAmmo, false, 'checked means not range ammo');

    win.openEditAmmo(saved.id);
    assert.strictEqual(win.document.getElementById('ammo-not-range').checked, true,
      'reopening shows what was saved');
  });

  test('spend counts every purchase; price per round counts only range ammo', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const stored = win.buildDefaultData().ammo;
    const carry = stored.filter(a => a.rangeAmmo === false);
    assert.ok(carry.length, 'demo data includes a non-range purchase');

    const totalSpend = stored.reduce((s2, a) => s2 + a.totalPrice, 0);
    const totalRounds = stored.reduce((s2, a) => s2 + a.quantity, 0);
    const rangeSpend = stored.filter(a => a.rangeAmmo !== false)
      .reduce((s2, a) => s2 + a.totalPrice, 0);
    const rangeRounds = stored.filter(a => a.rangeAmmo !== false)
      .reduce((s2, a) => s2 + a.quantity, 0);

    assert.ok(Math.abs(stat(win, 'Total Spend') - totalSpend) < 0.02,
      'the money was spent either way');
    assert.ok(Math.abs(stat(win, 'Rounds Bought') - totalRounds) < 1);

    const shown = stat(win, 'CPR');
    assert.ok(Math.abs(shown - rangeSpend / rangeRounds) < 0.0006,
      `per-round should be the range-only figure (${shown} vs ${(rangeSpend/rangeRounds).toFixed(4)})`);
    assert.ok(Math.abs(shown - totalSpend / totalRounds) > 0.0001,
      'and it should differ from the blended figure, or the exclusion is doing nothing');
  });

  test('it says how many purchases it left out', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const note = flat(win.document.getElementById('stats-as-stats'));
    assert.match(note, /non-range purchase/i);
    assert.match(note, /still include/i, 'and that the totals are unaffected');
  });

  test('with nothing flagged there is no note and no relabelling', async () => {
    const win = await ready(loadApp());
    // Clear the flag on the demo carry purchase and the exclusion should disappear entirely.
    const carryId = win.buildDefaultData().ammo.find(a => a.rangeAmmo === false).id;
    win.openEditAmmo(carryId);
    win.document.getElementById('ammo-not-range').checked = false;
    win.saveAmmo();
    openMoney(win);
    const el = flat(win.document.getElementById('stats-as-stats'));
    assert.doesNotMatch(el, /non-range purchase/i);
    assert.doesNotMatch(el, /Avg CPR · range/i, 'no exclusion, no qualifier on the label');
  });

  test('store prices exclude non-range ammo too, while store spend does not', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    // Narrow to the caliber the carry load is in, which is when per-round prices appear.
    const stored = win.buildDefaultData().ammo;
    const carry = stored.find(a => a.rangeAmmo === false);
    const sel = win.document.getElementById('stats-caliber');
    const opt = [...sel.options].find(o => o.value === carry.caliber);
    assert.ok(opt, 'the caliber of the carry load is selectable');
    sel.value = opt.value;
    win.renderStats();

    const seller = win.buildDefaultData().sellers.find(x => x.id === carry.sellerId);
    const row = [...win.document.querySelectorAll('#stats-as-seller-breakdown .breakdown-row')]
      .find(r => r.querySelector('.breakdown-name').textContent === seller.name);
    assert.ok(row, 'the store that sold the carry load is listed');

    const sameStore = stored.filter(a => a.sellerId === carry.sellerId && a.caliber === carry.caliber);
    const spend = sameStore.reduce((s2, a) => s2 + a.totalPrice, 0);
    const shownSpend = parseFloat(row.querySelector('.breakdown-val').textContent.replace('$', ''));
    assert.ok(Math.abs(shownSpend - spend) < 0.02, 'store spend includes the carry box');

    const rangeAt = sameStore.filter(a => a.rangeAmmo !== false);
    const cprText = row.querySelector('.breakdown-pct').textContent.match(/\$([\d.]+)\/rd/);
    if (rangeAt.length && cprText) {
      const expect = rangeAt.reduce((s2, a) => s2 + a.totalPrice, 0)
        / rangeAt.reduce((s2, a) => s2 + a.quantity, 0);
      assert.ok(Math.abs(parseFloat(cprText[1]) - expect) < 0.0011,
        'one defensive box must not make a shop look dear');
    }
  });
});

// ── VIEWING AN AMMO PURCHASE ────────────────────────────────────────
// Reading a purchase and changing one are different intentions, the same argument that put
// zeros, groups and dope tables behind a read-only view.

describe('viewing an ammo purchase', () => {
  const firstAmmoId = win => win.buildDefaultData().ammo[0].id;

  test('tapping a purchase opens it inert, with Edit rather than Save', async () => {
    const win = await ready(loadApp());
    win.openViewAmmo(firstAmmoId(win));

    assert.ok(win.document.getElementById('modal-ammo').classList.contains('viewing'));
    ['ammo-date', 'ammo-caliber-select', 'ammo-manufacturer', 'ammo-model', 'ammo-quantity',
     'ammo-price', 'ammo-seller', 'ammo-status', 'ammo-not-range', 'ammo-notes'].forEach(id =>
      assert.strictEqual(win.document.getElementById(id).disabled, true, `${id} should be inert`));

    const buttons = flat(win.document.getElementById('ammo-buttons'));
    assert.match(buttons, /Edit/);
    assert.doesNotMatch(buttons, /Save/);
    assert.match(win.document.getElementById('ammo-modal-title').textContent, /^Ammo Purchase$/);
  });

  test('the values shown are the ones stored', async () => {
    const win = await ready(loadApp());
    const a = win.buildDefaultData().ammo.find(x => x.rangeAmmo === false);
    win.openViewAmmo(a.id);
    assert.strictEqual(win.document.getElementById('ammo-quantity').value, String(a.quantity));
    assert.strictEqual(win.document.getElementById('ammo-price').value, String(a.totalPrice));
    assert.strictEqual(win.document.getElementById('ammo-not-range').checked, true,
      'the flag has to be visible without entering edit mode');
  });

  test('Edit unlocks the fields', async () => {
    const win = await ready(loadApp());
    win.openViewAmmo(firstAmmoId(win));
    win.ammoEnterEdit();
    assert.strictEqual(win.document.getElementById('modal-ammo').classList.contains('viewing'), false);
    assert.strictEqual(win.document.getElementById('ammo-quantity').disabled, false);
    assert.match(flat(win.document.getElementById('ammo-buttons')), /Save/);
    assert.match(win.document.getElementById('ammo-modal-title').textContent, /Edit/);
  });

  test('the pencil goes straight to editing, skipping the read-only view', async () => {
    const win = await ready(loadApp());
    win.openEditAmmo(firstAmmoId(win));
    assert.strictEqual(win.document.getElementById('modal-ammo').classList.contains('viewing'), false);
    assert.match(flat(win.document.getElementById('ammo-buttons')), /Save/);
  });

  test('adding a purchase after viewing one is not stuck inert', async () => {
    const win = await ready(loadApp());
    win.openViewAmmo(firstAmmoId(win));
    win.openAddAmmo();
    assert.strictEqual(win.document.getElementById('modal-ammo').classList.contains('viewing'), false,
      'the add form must not inherit view mode from a previous tap');
    assert.strictEqual(win.document.getElementById('ammo-date').disabled, false);
    assert.match(flat(win.document.getElementById('ammo-buttons')), /Save/);
  });

  test('the row buttons still work without also opening the view', async () => {
    const win = await ready(loadApp());
    win.showTab('ammo');
    const card = win.document.querySelector('.ammo-card');
    assert.ok(card, 'purchases render as cards');
    assert.ok(card.classList.contains('tappable'));
    [...card.querySelectorAll('.ammo-actions .btn-mini')].forEach(b =>
      assert.match(b.getAttribute('onclick'), /event\.stopPropagation\(\)/,
        'a control inside a tappable card must not also trigger the card'));
  });
});

// ── COST OF SHOOTING ────────────────────────────────────────────────
// Total spend is what left the wallet; this is what actually got fired. It is the reason the
// "not range ammo" flag exists, so the link between the two is what matters most here.

describe('cost of shooting', () => {
  const openMoney = (win, range = 'all') => {
    win.showTab('stats');
    win.showStatsSection('money');
    win.document.getElementById('stats-range').value = range;
    win.renderStats();
  };
  const rows = win => [...win.document.querySelectorAll('#stats-as-cost .breakdown-row')]
    .map(r => ({
      name: r.querySelector('.breakdown-name').textContent,
      cost: parseFloat(r.querySelector('.breakdown-val').textContent.replace('$', '')),
      cpr: parseFloat(r.querySelector('.breakdown-pct').textContent.match(/\$([\d.]+)\/rd/)[1]),
      rounds: parseInt(r.querySelector('.breakdown-pct').textContent.replace(/,/g, ''), 10),
    }));
  const tile = (win, label) => {
    const box = [...win.document.querySelectorAll('#stats-as-cost .stats-stat-box')]
      .find(b => new RegExp(label, 'i').test(b.querySelector('.stats-stat-label').textContent));
    return box ? parseFloat(box.querySelector('.stats-stat-num').textContent.replace(/[$,]/g, '')) : null;
  };

  test('each firearm is priced at its own chambering, times what it fired', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const d = win.buildDefaultData();
    const fired = {};
    d.sessions.forEach(s => Object.entries(s.rounds || {})
      .forEach(([g, n]) => fired[g] = (fired[g] || 0) + n));

    rows(win).forEach(r => {
      const gun = d.firearms.find(g => g.name === r.name);
      assert.ok(gun, `${r.name} is a real firearm`);
      assert.strictEqual(r.rounds, fired[gun.id], 'rounds come from the session log');
      assert.ok(Math.abs(r.cost - r.rounds * r.cpr) < 0.02, 'cost is rounds times price');
    });
  });

  test('the total is the sum of the rows, and per-trip divides by trips', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const sum = rows(win).reduce((x, r) => x + r.cost, 0);
    assert.ok(Math.abs(tile(win, 'Rounds Fired') - sum) < 0.05);
    const trips = win.buildDefaultData().sessions.length;
    assert.ok(Math.abs(tile(win, 'Per Range Trip') - sum / trips) < 0.05,
      'per-trip is the fired cost over trips, not total spend over trips');
  });

  test('what got fired is measured separately from what got bought', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const d = win.buildDefaultData();
    const bought = d.ammo.reduce((x, a) => x + a.totalPrice, 0);
    const firedCost = tile(win, 'Rounds Fired');

    // Not a direction: rounds fired can exceed rounds bought, because ammo bought before the
    // app existed was never logged — that is the user's actual situation. What matters is
    // that the two come from different sources and are never conflated.
    assert.notStrictEqual(Number(firedCost.toFixed(2)), Number(bought.toFixed(2)));

    const fired = {};
    d.sessions.forEach(s => Object.entries(s.rounds || {})
      .forEach(([g, n]) => fired[g] = (fired[g] || 0) + n));
    const roundsFired = Object.values(fired).reduce((a, b) => a + b, 0);
    const roundsBought = d.ammo.reduce((x, a) => x + a.quantity, 0);
    assert.notStrictEqual(roundsFired, roundsBought,
      'precondition: the demo shoots a different number of rounds than it buys');

    // The fired figure has to track the session log, so shooting more must cost more.
    const before = tile(win, 'Rounds Fired');
    win.document.getElementById('stats-range').value = 'month';
    win.renderStats();
    const narrowed = tile(win, 'Rounds Fired');
    assert.ok(narrowed === null || narrowed <= before + 0.01,
      'a shorter window cannot cost more than the whole record');
  });

  test('flagging ammo as not-range changes what shooting is estimated to cost', async () => {
    const win = await ready(loadApp());
    // Start from a state where nothing is flagged, so the change is attributable.
    const carryId = win.buildDefaultData().ammo.find(a => a.rangeAmmo === false).id;
    win.openEditAmmo(carryId);
    win.document.getElementById('ammo-not-range').checked = false;
    win.saveAmmo();
    openMoney(win);
    const blended = rows(win);

    win.openEditAmmo(carryId);
    win.document.getElementById('ammo-not-range').checked = true;
    win.saveAmmo();
    openMoney(win);
    const rangeOnly = rows(win);

    const carry = win.buildDefaultData().ammo.find(a => a.id === carryId);
    const affected = rangeOnly.filter(r => {
      const gun = win.buildDefaultData().firearms.find(g => g.name === r.name);
      return gun && gunCaliberMatch(gun, carry.caliber);
    });
    function gunCaliberMatch(gun, cal) { return (gun.calibers || []).includes(cal); }

    assert.ok(affected.length, 'some firearm shoots the flagged chambering');
    affected.forEach(r => {
      const before = blended.find(b => b.name === r.name);
      assert.ok(r.cpr < before.cpr,
        `${r.name}: excluding a pricier carry box should lower its per-round estimate ` +
        `(${before.cpr} -> ${r.cpr})`);
    });
  });

  test('it says it is an estimate, and why it has to be', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const note = flat(win.document.querySelector('#stats-as-cost .stats-note'));
    assert.match(note, /estimated/i);
    assert.match(note, /per firearm/i);
    assert.match(note, /carry ammo excluded/i,
      'the reason the flag matters belongs on the view it affects');
  });

  test('rounds with no ammo logged for their chambering are reported, not dropped', async () => {
    const win = await ready(loadApp());
    // Remove every purchase for one firearm's chambering; its rounds become unpriceable.
    const d = win.buildDefaultData();
    const gun = d.firearms.find(g => g.calibers.some(c => d.ammo.some(a => a.caliber === c)));
    const doomed = d.ammo.filter(a => gun.calibers.includes(a.caliber));
    win.confirm = () => true;
    doomed.forEach(a => win.deleteAmmo(a.id));

    openMoney(win);
    assert.strictEqual(rows(win).some(r => r.name === gun.name), false,
      'a firearm with no priceable ammo drops out of the ranking');
    assert.match(flat(win.document.getElementById('stats-as-cost')), /aren't priced here/i,
      'but its rounds are accounted for in words rather than silently ignored');
  });
});

// ── BURN RATE ───────────────────────────────────────────────────────
// Rounds fired come from the session log, which is complete. Bucketing by a firearm's whole
// chambering is what removes the attribution problem: a .357/.38 revolver cannot say which
// of the two it fired, so both live in one bucket and the question stops existing.

describe('burn rate', () => {
  const openMoney = (win, range = 'all') => {
    win.showTab('stats');
    win.showStatsSection('money');
    win.document.getElementById('stats-range').value = range;
    win.renderStats();
  };
  const rows = win => [...win.document.querySelectorAll('#stats-as-burn .breakdown-row')]
    .map(r => ({
      label: r.querySelector('.breakdown-name').textContent,
      rate: parseFloat(r.querySelector('.breakdown-val').textContent.replace(/[^\d.]/g, '')),
      rounds: parseInt(r.querySelector('.breakdown-pct').textContent.replace(/,/g, ''), 10),
    }));

  test('every round fired lands in exactly one bucket', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const shown = rows(win).reduce((sum, r) => sum + r.rounds, 0);
    const fired = win.buildDefaultData().sessions
      .reduce((sum, s) => sum + Object.values(s.rounds || {}).reduce((a, b) => a + b, 0), 0);
    assert.strictEqual(shown, fired,
      'bucket totals must equal rounds fired — nothing double-counted, nothing dropped');
  });

  test('a firearm chambered for two calibers gets one bucket, not two', async () => {
    // Give the demo rifle a second chambering; its rounds must not be split or duplicated.
    const win = await ready(loadApp(js => {
      const patched = js.replace(
        /(\{ id: g1,[^}]*?calibers: )\['\.223 Rem', '5\.56 NATO'\]/,
        "$1['.223 Rem', '5.56 NATO']"
      );
      return patched;
    }));
    openMoney(win);
    const gun = win.buildDefaultData().firearms.find(g => g.calibers.length > 1);
    assert.ok(gun, 'demo data has a multi-caliber firearm');

    const label = [...gun.calibers].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' })).join(' / ');
    const matching = rows(win).filter(r => r.label === label);
    assert.strictEqual(matching.length, 1, `expected one bucket named "${label}"`);

    const fired = win.buildDefaultData().sessions
      .reduce((sum, s) => sum + (s.rounds[gun.id] || 0), 0);
    assert.strictEqual(matching[0].rounds, fired,
      "the whole firearm's rounds sit in its one bucket");
    // And no bucket is named for just one of its chamberings.
    gun.calibers.forEach(c =>
      assert.strictEqual(rows(win).some(r => r.label === c), false,
        `"${c}" alone would imply an attribution the data cannot make`));
  });

  test('it is ranked by rate and reports the window it measured', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const r = rows(win);
    assert.ok(r.length >= 2);
    r.forEach((x, i) => {
      if (i) assert.ok(x.rate <= r[i - 1].rate + 1, 'fastest-burning first');
    });
    assert.match(win.document.getElementById('stats-as-burn').textContent, /rounds over/,
      'a rate means nothing without the span it was measured over');
  });

  test('it narrows to the filtered firearm', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const all = rows(win).length;
    const gun = win.buildDefaultData().firearms[0];
    win.document.getElementById('stats-firearm').value = gun.id;
    win.renderStats();
    const scoped = rows(win);
    assert.strictEqual(scoped.length, 1, `one firearm, one bucket (${all} unfiltered)`);
    const fired = win.buildDefaultData().sessions
      .reduce((sum, s) => sum + (s.rounds[gun.id] || 0), 0);
    assert.strictEqual(scoped[0].rounds, fired);
  });

  test('it says plainly that it is not inventory', async () => {
    const win = await ready(loadApp());
    openMoney(win);
    const note = flat(win.document.querySelector('#stats-as-burn .stats-note'));
    assert.match(note, /not inventory/i);
    assert.match(note, /before you started logging/i,
      'the reason inventory is uncomputable belongs on screen, not in a commit message');
  });

  test('too little history draws nothing rather than a rate from one session', async () => {
    const win = await ready(loadApp());
    win.wipeAllData();
    openMoney(win);
    assert.strictEqual(win.document.getElementById('stats-as-burn').innerHTML, '',
      'a rate needs a span; one point is not a span');
  });
});

// ── SPEND BY STORE ──────────────────────────────────────────────────

describe('spend by store', () => {
  test('purchases are grouped by seller and sorted by spend', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.document.getElementById('stats-range').value = 'all';
    win.renderStats();
    const el = win.document.getElementById('stats-as-seller-breakdown');
    const vals = [...el.querySelectorAll('.breakdown-val')]
      .map(v => parseFloat(v.textContent.replace('$', '')));
    assert.ok(vals.length > 0, 'demo purchases carry sellers');
    vals.forEach((v, i) => {
      if (i) assert.ok(v <= vals[i - 1] + 1e-9, 'stores are ranked by spend');
    });
  });

  test('price per round is withheld until a single caliber is in scope', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.document.getElementById('stats-range').value = 'all';
    win.renderStats();
    const el = () => win.document.getElementById('stats-as-seller-breakdown');

    // Mixed calibers: comparing $/rd between stores would compare products, not prices.
    assert.doesNotMatch(el().textContent, /\/rd/,
      'a blended per-round price across calibers is not a price comparison');
    assert.match(el().textContent, /single caliber/i, 'and it should say why');

    const merged = [...win.document.getElementById('stats-caliber').options]
      .find(o => o.value && !o.value.includes('||'));
    win.document.getElementById('stats-caliber').value = merged.value;
    win.renderStats();
    assert.match(el().textContent, /\/rd/,
      'one caliber in scope makes the stores comparable, so show it');
  });

  test('purchases with no seller are still counted, under a named bucket', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.document.getElementById('stats-range').value = 'all';
    win.renderStats();
    const total = [...win.document.querySelectorAll('#stats-as-seller-breakdown .breakdown-val')]
      .reduce((s, v) => s + parseFloat(v.textContent.replace('$', '')), 0);
    const headline = parseFloat(win.document.querySelector('#stats-as-stats .stats-stat-num')
      .textContent.replace(/[$,]/g, ''));
    assert.ok(Math.abs(total - headline) < 0.02,
      `store spend (${total.toFixed(2)}) must add up to total spend (${headline.toFixed(2)})`);
  });
});

// ── VERSION CONSISTENCY ─────────────────────────────────────────────
// index.html, app.js and sw.js each carry the app version, and they are deployed together.
// Bumping one without the others breaks the service worker's update detection — the banner
// either never appears or appears forever. Nothing caught that before this test.

describe('app version', () => {
  const readAll = () => ({
    html: fs.readFileSync(APP_PATH, 'utf8'),
    js: fs.readFileSync(JS_PATH, 'utf8'),
    sw: fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'),
  });

  test('all three files declare the same version', () => {
    const { html, js, sw } = readAll();
    const span = html.match(/<span id="app-version">v([\d.]+)<\/span>/);
    const inJs = js.match(/const APP_VERSION = '([\d.]+)';/);
    const inSw = sw.match(/const APP_VERSION = '([\d.]+)';/);
    assert.ok(span, 'no app-version span in index.html');
    assert.ok(inJs, 'no APP_VERSION in app.js');
    assert.ok(inSw, 'no APP_VERSION in sw.js');
    assert.strictEqual(inJs[1], span[1], 'app.js disagrees with the badge in index.html');
    assert.strictEqual(inSw[1], span[1], 'sw.js disagrees with the badge in index.html');
  });

  test('the version is major.minor with an optional patch', () => {
    const { js } = readAll();
    const v = js.match(/const APP_VERSION = '([\d.]+)';/)[1];
    assert.match(v, /^\d+\.\d+(\.\d+)?$/,
      `"${v}" is not a version the cache name and badge can both carry`);
  });
});

// ── CUSTOM-ENTRY SENTINEL ───────────────────────────────────────────
// Five pickers offer a "type your own" entry: firearm calibers, ammo calibers, the shared
// ammo dropdown, optics and tags. They used two different sentinel values, so two forms that
// look identical behaved differently. One constant now, and this keeps it that way.

describe('custom-entry sentinel', () => {
  const SOURCE = fs.readFileSync(JS_PATH, 'utf8');

  test('only one sentinel value exists in the source', () => {
    const literals = new Set((SOURCE.match(/'__[a-z]+__'|"__[a-z]+__"/g) || [])
      .map(x => x.slice(1, -1)));
    assert.deepStrictEqual([...literals], ['__custom__'],
      `found more than one sentinel: ${[...literals].join(', ')}`);
  });

  test('every "type your own" option carries that value', async () => {
    const win = await ready(loadApp());
    const gun = win.buildDefaultData().firearms[0];
    // Open each form so its dropdown is populated.
    win.openAddGun();
    win.openAddAmmo();
    win.openLogZero(gun.id);
    await win.openLogGroup(gun.id);

    const offers = [...win.document.querySelectorAll('option')]
      .filter(o => o.textContent.trim().startsWith('+'));
    assert.ok(offers.length >= 4, `expected several custom entries, found ${offers.length}`);
    offers.forEach(o => assert.strictEqual(o.value, '__custom__',
      `"${o.textContent.trim()}" offers a custom entry under a different value`));
  });

  test('selecting it reveals the free-text field in each form', async () => {
    const win = await ready(loadApp());
    const gun = win.buildDefaultData().firearms[0];

    win.openAddAmmo();
    win.document.getElementById('ammo-caliber-select').value = '__custom__';
    win.handleCaliberSelectChange();
    assert.strictEqual(win.document.getElementById('ammo-caliber-custom').style.display, 'block');

    win.openLogZero(gun.id);
    win.document.getElementById('zero-ammo-select').value = '__custom__';
    win.handleZeroAmmoSelectChange();
    assert.strictEqual(win.document.getElementById('zero-ammo-custom').style.display, 'block');

    win.document.getElementById('zero-optic-select').value = '__custom__';
    win.handleZeroOpticSelectChange();
    assert.strictEqual(win.document.getElementById('zero-optic-custom').style.display, 'block');
  });
});

// ── STATS SUB-TABS ──────────────────────────────────────────────────

describe('stats sub-tabs', () => {
  const paneVisible = (win, n) =>
    win.document.getElementById('statspane-' + n).classList.contains('active');
  const tabActive = (win, n) =>
    win.document.getElementById('statstab-' + n).classList.contains('active');

  test('exactly one pane is showing at a time', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    ['groups', 'practice', 'money', 'upkeep'].forEach(target => {
      win.showStatsSection(target);
      const shown = ['groups', 'practice', 'money', 'upkeep'].filter(n => paneVisible(win, n));
      assert.deepStrictEqual(shown, [target], `showing ${shown.join()} after selecting ${target}`);
      assert.ok(tabActive(win, target), 'the tab reflects the pane');
    });
  });

  test('landing on Stats shows a pane rather than nothing', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    const shown = ['groups', 'practice', 'money', 'upkeep'].filter(n => paneVisible(win, n));
    assert.strictEqual(shown.length, 1, 'a bare showTab must not leave every pane hidden');
    assert.strictEqual(shown[0], 'practice');
  });

  test('an unknown section falls back rather than blanking the tab', async () => {
    const win = await ready(loadApp());
    win.showStatsSection('nonsense');
    assert.ok(paneVisible(win, 'practice'));
  });

  test('the existing Rounds Fired and Ammo Spend views survived the split', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.showStatsSection('practice');
    assert.ok(win.document.getElementById('stats-rf-chart').innerHTML.length > 0,
      'Rounds Fired still renders');
    assert.ok(win.document.getElementById('stats-rt-chart').innerHTML.length > 0,
      'Range Trips still renders');
    win.showStatsSection('money');
    assert.ok(win.document.getElementById('stats-as-chart').innerHTML.length > 0,
      'Ammo Spend still renders');
  });

  test('each moved view sits in the pane it was assigned to', async () => {
    const win = await ready(loadApp());
    const paneOf = id => win.document.getElementById(id).closest('.stats-pane').id;
    assert.strictEqual(paneOf('stats-rf-chart'), 'statspane-practice');
    assert.strictEqual(paneOf('stats-rt-chart'), 'statspane-practice');
    assert.strictEqual(paneOf('stats-as-chart'), 'statspane-money');
    assert.strictEqual(paneOf('stats-upkeep-cleaning'), 'statspane-upkeep');
  });

  test('Upkeep ranks firearms by how overdue they are, not by name', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.showStatsSection('upkeep');
    const el = win.document.getElementById('stats-upkeep-cleaning');
    const names = [...el.querySelectorAll('.breakdown-name')].map(n => n.textContent);
    assert.strictEqual(names.length, win.buildDefaultData().firearms.length,
      'every firearm appears');

    // Assert the invariant rather than recomputing the ranking: the bars must run
    // worst-first. Re-deriving the expected order here would just restate the
    // implementation and would pass even if both were wrong the same way.
    const widths = [...el.querySelectorAll('.breakdown-bar-fill')]
      .map(b => parseFloat(b.style.width));
    assert.strictEqual(widths.length, names.length);
    widths.forEach((w, i) => {
      if (i === 0) return;
      assert.ok(w <= widths[i - 1] + 1e-9,
        `row ${i} (${names[i]}, ${w}%) is more overdue than the row above it (${widths[i - 1]}%)`);
    });
    // And the ranking must be by fraction of each firearm's own threshold, not raw rounds:
    // a 300-round pistol at 250 outranks a 1000-round rifle at 400.
    assert.ok(widths[0] >= widths[widths.length - 1], 'sorted descending');
  });

  test('Upkeep pairs its status colour with a word, never colour alone', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    win.showStatsSection('upkeep');
    const el = win.document.getElementById('stats-upkeep-cleaning');
    [...el.querySelectorAll('.breakdown-pct')].forEach(p =>
      assert.match(p.textContent, /ok|due soon|past due/,
        'a colour-blind reader must still get the state'));
  });

  test('every tab renders without throwing, on demo data and on an empty app', async () => {
    const win = await ready(loadApp());
    win.showTab('stats');
    ['groups', 'practice', 'money', 'upkeep'].forEach(n =>
      assert.doesNotThrow(() => win.showStatsSection(n), `${n} threw with data`));
    win.wipeAllData();
    win.showTab('stats');
    ['groups', 'practice', 'money', 'upkeep'].forEach(n =>
      assert.doesNotThrow(() => win.showStatsSection(n), `${n} threw when empty`));
  });
});

// ── CAPPED DETAILS LISTS ────────────────────────────────────────────

describe('capped Details lists', () => {
  const rows = n => Array.from({ length: n }, (_, i) => `<div class="cleaning-row">row ${i}</div>`);
  const shown = win => win.document.querySelectorAll('#history-groups-list > div').length;
  const btn = win => win.document.getElementById('show-all-groups');

  test('a list longer than its cap renders the cap and offers the rest by count', async () => {
    const win = await ready(loadApp());
    win.paintHistorySection('groups', rows(47), '');
    assert.strictEqual(shown(win), 5, 'groups cap is 5');
    assert.strictEqual(btn(win).style.display, 'block');
    assert.match(btn(win).textContent, /Show all 47/,
      'the count has to be on the button — otherwise you tap to find out how much there is');
  });

  test('expanding renders everything and offers the way back', async () => {
    const win = await ready(loadApp());
    win.paintHistorySection('groups', rows(47), '');
    win.toggleHistorySection('groups');
    assert.strictEqual(shown(win), 47);
    assert.match(btn(win).textContent, /Show fewer/);
    win.toggleHistorySection('groups');
    assert.strictEqual(shown(win), 5, 'collapsing returns to the cap');
    assert.match(btn(win).textContent, /Show all 47/);
  });

  test('an expanded long list scrolls in its own panel instead of stretching the modal', async () => {
    const win = await ready(loadApp());
    const box = win.document.getElementById('history-groups-list');
    win.paintHistorySection('groups', rows(47), '');
    assert.strictEqual(box.classList.contains('list-scroll'), false, 'capped needs no panel');
    win.toggleHistorySection('groups');
    assert.ok(box.classList.contains('list-scroll'), 'expanded gets the panel');
    win.toggleHistorySection('groups');
    assert.strictEqual(box.classList.contains('list-scroll'), false, 'collapsing removes it');
  });

  test('a list at or under its cap looks exactly as it did before, with no control', async () => {
    const win = await ready(loadApp());
    const box = win.document.getElementById('history-groups-list');
    win.paintHistorySection('groups', rows(5), '');
    assert.strictEqual(shown(win), 5);
    assert.strictEqual(btn(win).style.display, 'none');
    assert.strictEqual(box.classList.contains('list-scroll'), false,
      'a short section must never become a scroll panel');
  });

  test('an empty section shows its empty state and no control', async () => {
    const win = await ready(loadApp());
    win.paintHistorySection('groups', [], '<div class="empty-state">No groups recorded yet.</div>');
    assert.match(win.document.getElementById('history-groups-list').textContent, /No groups/);
    assert.strictEqual(btn(win).style.display, 'none');
  });

  test('expansion resets when Details is reopened', async () => {
    const win = await ready(loadApp());
    // The demo firearms carry 4 cleanings against a cap of 3, so this runs on real data
    // through the real render path rather than synthetic rows.
    const gunId = win.buildDefaultData().firearms[0].id;
    const list = () => win.document.querySelectorAll('#history-cleanings-list > div').length;

    win.openGunHistory(gunId);
    assert.strictEqual(list(), 3, 'lands capped');
    assert.match(win.document.getElementById('show-all-cleanings').textContent, /Show all 4/);

    win.toggleHistorySection('cleanings');
    assert.strictEqual(list(), 4);

    win.closeModal('modal-history');
    win.openGunHistory(gunId);
    assert.strictEqual(list(), 3,
      'a section left open last time would defeat the point of capping it');
  });

  test('every capped section has a control wired to it', async () => {
    const win = await ready(loadApp());
    ['cleanings', 'zeros', 'dope', 'groups'].forEach(name => {
      const b = win.document.getElementById('show-all-' + name);
      assert.ok(b, `no control for ${name}`);
      assert.match(b.getAttribute('onclick'), new RegExp(`toggleHistorySection\\('${name}'\\)`));
    });
  });
});

// ── LOAD DEMO DATA ──────────────────────────────────────────────────

describe('loading demo data from Settings', () => {
  test('an empty app takes a plain confirm; a populated one demands the typed word', async () => {
    const win = await ready(loadApp());
    let confirmed = 0;
    win.confirm = () => { confirmed++; return false; };   // decline, so nothing is destroyed

    // Fresh load ships demo data, so the app is populated.
    win.openLoadDemoModal();
    assert.strictEqual(confirmed, 0, 'a populated app must not settle for a plain confirm');
    assert.ok(win.document.getElementById('modal-load-demo').classList.contains('open'));
    win.closeModal('modal-load-demo');

    win.wipeAllData();
    win.openLoadDemoModal();
    assert.strictEqual(confirmed, 1, 'an empty app should just ask once');
    assert.strictEqual(win.document.getElementById('modal-load-demo').classList.contains('open'), false,
      'no ceremony when there is nothing to lose');
  });

  test('the confirm button stays inert until DEMO is typed exactly', async () => {
    const win = await ready(loadApp());
    const input = win.document.getElementById('load-demo-confirm-input');
    const btn = win.document.getElementById('load-demo-confirm-btn');
    win.openLoadDemoModal();

    ['', 'demo', 'DEMOO', 'DEM'].forEach(v => {
      input.value = v;
      win.updateLoadDemoButtonState();
      assert.strictEqual(btn.style.pointerEvents, 'none', `"${v}" should not arm the button`);
    });
    input.value = 'DEMO';
    win.updateLoadDemoButtonState();
    assert.strictEqual(btn.style.pointerEvents, 'auto');
  });

  test('confirming replaces real data with sample data and flags it as demo', async () => {
    const win = await ready(loadApp());
    win.wipeAllData();
    const emptied = JSON.parse(win.localStorage.getItem('rangeLogData'));
    assert.strictEqual(emptied.firearms.length, 0, 'precondition: the app is empty');
    assert.strictEqual(emptied.isDemo, false, 'precondition: not flagged as demo');

    win.loadDemoData();
    const stored = JSON.parse(win.localStorage.getItem('rangeLogData'));
    assert.ok(stored.firearms.length > 0, 'sample firearms are loaded');
    assert.ok(stored.sessions.length > 0, 'sample sessions are loaded');
    assert.strictEqual(stored.isDemo, true,
      'the banner must return, since this is freshly generated sample data');
    assert.strictEqual(stored.schemaVersion, win.buildDefaultData().schemaVersion);
  });

  test('loaded demo data is dated no later than today, same as first launch', async () => {
    const win = await ready(loadApp());
    win.loadDemoData();
    const stored = JSON.parse(win.localStorage.getItem('rangeLogData'));
    const today = new Date().toISOString().slice(0, 10);
    stored.sessions.forEach(s =>
      assert.ok(s.date <= today, `session dated in the future: ${s.date}`));
    stored.ammo.forEach(a =>
      assert.ok(!a.date || a.date <= today, `purchase dated in the future: ${a.date}`));
    stored.firearms.flatMap(g => g.groups || []).forEach(g =>
      assert.ok(g.date <= today, `group dated in the future: ${g.date}`));
  });
});

// ── MODAL CONTROL PLACEMENT ─────────────────────────────────────────
// Element ids are global, so a control placed in the wrong overlay still resolves by id
// and every behavioural test keeps passing. That is exactly how the group tag picker
// shipped inside the zero modal: getElementById found it, the logic worked on it, and it
// was simply never on screen where it belonged. This asserts the structure itself.

describe('modal control placement', () => {
  test('each prefixed control sits inside the modal that owns it', async () => {
    const win = await ready(loadApp());
    const owner = { zero: 'modal-zero', group: 'modal-group', dope: 'modal-dope' };
    const wrong = [];

    win.document.querySelectorAll('[id]').forEach(el => {
      const prefix = el.id.split('-')[0];
      if (!owner[prefix]) return;
      const overlay = el.closest('.modal-overlay');
      if (!overlay || overlay.id !== owner[prefix]) {
        wrong.push(`#${el.id} is in ${overlay ? '#' + overlay.id : 'no modal'}, expected #${owner[prefix]}`);
      }
    });

    assert.deepStrictEqual(wrong, [], 'controls found in the wrong modal');
  });

  test('the tag picker is in the group modal, where groups are actually logged', async () => {
    const win = await ready(loadApp());
    ['group-tags-chips', 'group-tag-add-select', 'group-tag-custom'].forEach(id => {
      const el = win.document.getElementById(id);
      assert.ok(el, `${id} missing`);
      assert.strictEqual(el.closest('.modal-overlay').id, 'modal-group');
    });
  });
});

// ── ZEROS: READ-ONLY VIEW ───────────────────────────────────────────

describe('viewing a zero', () => {
  const rifle = win => win.buildDefaultData().firearms.find(g => g.id);

  test('tapping a zero opens it inert, with Edit rather than Save', async () => {
    const win = await ready(loadApp());
    const gun = win.buildDefaultData().firearms[0];
    win.openLogZero(gun.id);                       // create one to view
    win.document.getElementById('zero-date').value = '2026-07-12';
    win.document.getElementById('zero-distance').value = '100';
    win.saveZero();

    const zeroId = JSON.parse(win.localStorage.getItem('rangeLogData'))
      .firearms.find(g => g.id === gun.id).zeros[0].id;

    win.openViewZero(gun.id, zeroId);
    assert.ok(win.document.getElementById('modal-zero').classList.contains('viewing'));
    ['zero-date', 'zero-distance', 'zero-distance-unit', 'zero-ammo-select',
     'zero-optic-select', 'zero-notes'].forEach(id => {
      assert.strictEqual(win.document.getElementById(id).disabled, true, `${id} should be inert`);
    });
    assert.match(win.document.getElementById('zero-buttons').textContent, /Edit/);
    assert.doesNotMatch(win.document.getElementById('zero-buttons').textContent, /Save/);

    win.zeroEnterEdit();
    assert.strictEqual(win.document.getElementById('modal-zero').classList.contains('viewing'), false);
    assert.strictEqual(win.document.getElementById('zero-distance').disabled, false);
    assert.match(win.document.getElementById('zero-buttons').textContent, /Save/);
  });

  test('opening a zero to add or edit is never inert', async () => {
    const win = await ready(loadApp());
    const gun = win.buildDefaultData().firearms[0];
    win.openLogZero(gun.id);
    assert.strictEqual(win.document.getElementById('modal-zero').classList.contains('viewing'), false,
      'the add form must not inherit view mode from a previous tap');
    assert.strictEqual(win.document.getElementById('zero-date').disabled, false);
    assert.match(win.document.getElementById('zero-buttons').textContent, /Save/);
  });
});

// ── DOPE TABLES ─────────────────────────────────────────────────────

describe('dope tables', () => {
  // Demo ids are deterministic, so a fresh build names the same table the live data holds.
  const demoRifle = win => win.buildDefaultData().firearms.find(g => (g.dope || []).length);
  // Reading back through localStorage rather than the in-memory object proves the table
  // actually persisted, which is the thing that matters when the app is reopened at the range.
  const storedDope = (win, gunId) =>
    JSON.parse(win.localStorage.getItem('rangeLogData')).firearms.find(g => g.id === gunId).dope;

  const rowCount = win => win.document.querySelectorAll('#dope-entries .entry-row').length;
  const comeUpsShown = win => [...win.document.querySelectorAll('#dope-entries .entry-row')]
    .map(r => parseFloat(r.querySelectorAll('input')[1].value));

  function setRows(win, rows) {
    while (rowCount(win)) win.removeDopeRow(0);
    rows.forEach(([d, c], i) => {
      win.addDopeRow();
      if (d != null) win.setDopeCell(i, 'distance', String(d));
      if (c != null) win.setDopeCell(i, 'come', String(c));
    });
  }
  function setAmmo(win, text) {
    win.document.getElementById('dope-ammo-select').value = '__custom__';
    win.document.getElementById('dope-ammo-custom').value = text;
  }

  test('switching the come-up unit converts the numbers instead of relabelling them', async () => {
    const win = await ready(loadApp());
    const rifle = demoRifle(win);
    const before = rifle.dope[0].entries.map(e => e.come);

    win.openDope(rifle.id, rifle.dope[0].id);
    assert.strictEqual(win.document.getElementById('dope-unit').value, 'mrad');
    win.document.getElementById('dope-unit').value = 'moa';
    win.handleDopeUnitChange();

    // 0.6 mil is 2.06 MOA. A table still reading 0.6 after the switch would put every
    // shot feet low at distance, and nothing on screen would say so.
    comeUpsShown(win).forEach((v, i) => {
      assert.ok(Math.abs(v - before[i] * 3.437746) < 0.011,
        `row ${i}: shows ${v}, should show ~${(before[i] * 3.437746).toFixed(2)} MOA`);
    });

    win.saveDope();
    const saved = storedDope(win, rifle.id)[0];
    assert.strictEqual(saved.unit, 'moa');
    saved.entries.forEach((e, i) => {
      assert.ok(Math.abs(e.come - before[i] * 3.437746) < 0.011, `stored row ${i} was not converted`);
    });
  });

  test('converting there and back leaves the table where it started', async () => {
    const win = await ready(loadApp());
    const rifle = demoRifle(win);
    const before = rifle.dope[0].entries.map(e => e.come);

    win.openDope(rifle.id, rifle.dope[0].id);
    win.document.getElementById('dope-unit').value = 'moa';
    win.handleDopeUnitChange();
    win.document.getElementById('dope-unit').value = 'mrad';
    win.handleDopeUnitChange();
    win.saveDope();

    const saved = storedDope(win, rifle.id)[0];
    assert.strictEqual(saved.unit, 'mrad');
    saved.entries.forEach((e, i) => {
      assert.ok(Math.abs(e.come - before[i]) < 0.02, `round trip drifted: ${before[i]} -> ${e.come}`);
    });
  });

  test('a half-filled row is dropped rather than saved with a hole in it', async () => {
    const win = await ready(loadApp());
    const rifle = demoRifle(win);

    win.openDope(rifle.id, rifle.dope[0].id);
    setRows(win, [[200, 0.6], [300, 1.5], [null, null], [700, null], [null, 9.9]]);
    win.saveDope();

    const saved = storedDope(win, rifle.id)[0];
    assert.deepStrictEqual(saved.entries.map(e => e.distance), [200, 300],
      'a distance with no come-up is not dope — reading it back at the range is worse than nothing');
    assert.ok(saved.entries.every(e => e.distance != null && e.come != null));
  });

  test('entries are stored sorted by distance however they were typed', async () => {
    const win = await ready(loadApp());
    const rifle = demoRifle(win);

    win.openDope(rifle.id);
    setAmmo(win, 'Out Of Order Load');
    setRows(win, [[500, 4.1], [200, 0.6], [300, 1.5]]);
    win.saveDope();

    const t = storedDope(win, rifle.id).find(x => x.ammo === 'Out Of Order Load');
    assert.ok(t, 'the new table was saved');
    assert.deepStrictEqual(t.entries.map(e => e.distance), [200, 300, 500]);
  });

  test('a table with no ammo or no usable rows is refused, not silently saved empty', async () => {
    const win = await ready(loadApp());
    const rifle = demoRifle(win);
    const before = rifle.dope.length;
    let alerts = 0;
    win.alert = () => { alerts++; };

    win.openDope(rifle.id);            // blank row, no ammo
    win.saveDope();
    setAmmo(win, 'Ammo But No Rows');  // ammo set, rows still blank
    win.saveDope();
    assert.strictEqual(alerts, 2, 'both refusals should say why rather than fail quietly');

    setAmmo(win, 'Actually Complete');
    setRows(win, [[200, 1.1]]);
    win.saveDope();

    const dope = storedDope(win, rifle.id);
    assert.strictEqual(dope.length, before + 1, 'only the complete table reached storage');
    assert.strictEqual(dope.some(t => t.ammo === 'Ammo But No Rows'), false);
  });

  test('viewing a table disables its fields rather than merely styling them', async () => {
    const win = await ready(loadApp());
    const rifle = demoRifle(win);
    win.openViewDope(rifle.id, rifle.dope[0].id);

    assert.ok(win.document.getElementById('modal-dope').classList.contains('viewing'));
    ['dope-ammo-select', 'dope-unit', 'dope-zero-distance', 'dope-conditions'].forEach(f => {
      assert.strictEqual(win.document.getElementById(f).disabled, true, `${f} should be inert`);
    });
    const inputs = win.document.querySelectorAll('#dope-entries .entry-row input');
    assert.ok(inputs.length > 0, 'the come-ups are still shown');
    assert.ok([...inputs].every(i => i.disabled), 'a stray tap must not alter a saved table');
    assert.strictEqual(win.document.querySelectorAll('#dope-entries .entry-del').length, 0,
      'the delete column is dropped entirely when viewing, not disabled');

    win.dopeEnterEdit();
    assert.strictEqual(win.document.getElementById('modal-dope').classList.contains('viewing'), false);
    assert.strictEqual(win.document.getElementById('dope-unit').disabled, false);
    assert.ok(win.document.querySelectorAll('#dope-entries .entry-del').length > 0);
  });

  test('a new table inherits the firearm turret unit instead of asking again', async () => {
    const win = await ready(loadApp());
    const fresh = win.buildDefaultData();
    const mil = fresh.firearms.find(g => g.opticUnit === 'mrad');
    const noOptic = fresh.firearms.find(g => !g.opticUnit);
    assert.ok(mil && noOptic, 'demo data should cover both cases');

    win.openDope(mil.id);
    assert.strictEqual(win.document.getElementById('dope-unit').value, 'mrad');
    win.openDope(noOptic.id);
    assert.strictEqual(win.document.getElementById('dope-unit').value, 'moa',
      'MOA is the fallback when no turret unit is recorded');
  });

  test('the Details card caps its distances and says how many are hidden', async () => {
    const win = await ready(loadApp());
    const rifle = demoRifle(win);

    win.openDope(rifle.id, rifle.dope[0].id);
    setRows(win, [200, 300, 400, 500, 600, 700, 800, 900].map((d, i) => [d, 0.6 + i]));
    win.saveDope();
    win.renderGunHistory(rifle.id);

    const list = win.document.getElementById('history-dope-list');
    assert.strictEqual(list.querySelectorAll('.dope-row:not(.more)').length, 6,
      'a long table must not push the rest of Details off screen');
    assert.match(list.querySelector('.dope-row.more').textContent, /\+2 more/);
  });

  test('deleting a table leaves the firearm and its groups intact', async () => {
    const win = await ready(loadApp());
    const rifle = demoRifle(win);
    const doomed = rifle.dope[0].id;

    win.deleteDope(rifle.id, doomed);

    const gun = JSON.parse(win.localStorage.getItem('rangeLogData')).firearms
      .find(g => g.id === rifle.id);
    assert.strictEqual((gun.dope || []).some(t => t.id === doomed), false);
    assert.strictEqual(gun.groups.length, rifle.groups.length, 'groups are untouched');
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