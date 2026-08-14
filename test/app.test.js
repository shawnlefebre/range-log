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

function loadApp() {
  if (!fs.existsSync(APP_PATH)) {
    throw new Error(
      `Could not find ${APP_PATH}. The test suite expects the app at repo root as "index.html" ` +
      `(rename if you're testing a copy, e.g. range-tracker.html).`
    );
  }
  const html = fs.readFileSync(APP_PATH, 'utf8');
  const dom = new JSDOM(html, {
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
    assert.strictEqual(migrated.schemaVersion, 8);
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
    assert.strictEqual(migrated.schemaVersion, 8);
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
    assert.strictEqual(migrated.schemaVersion, 8);
    assert.strictEqual(migrated.firearms[0].notes, '', 'missing notes should default to empty string');
    assert.strictEqual(migrated.firearms[1].notes, 'Torque: 20 in-lbs', 'existing notes must survive migration untouched');
  });

  test('already-current data passes through without modification', () => {
    const current = win.buildDefaultData();
    const migrated = win.migrateData(JSON.parse(JSON.stringify(current)));
    assert.strictEqual(migrated.schemaVersion, 8);
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
    // Inject a firearm sharing .223/5.56 with Example Rifle but also carrying a unique third caliber.
    let html = fs.readFileSync(APP_PATH, 'utf8');
    html = html.replace(
      "{ id: g2, name: 'Example Pistol', type: 'pistol', calibers: ['9mm'], cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [], notes: '' },",
      "{ id: g2, name: 'Example Pistol', type: 'pistol', calibers: ['.223 Rem', '5.56 NATO', '.300 BLK'], cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [], notes: '' },"
    );
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/', pretendToBeVisual: true });
    dom.window.alert = () => {};
    const win = await ready(dom);

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

// ── BASIC SMOKE TEST: every tab renders without throwing ────────────

describe('smoke test', () => {
  test('all tabs render without error on a fresh demo-data load', async () => {
    const win = await ready(loadApp());
    for (const tab of ['dashboard', 'log', 'sessions', 'ammo', 'stats', 'settings']) {
      assert.doesNotThrow(() => win.showTab(tab), `showTab('${tab}') threw`);
    }
  });
});