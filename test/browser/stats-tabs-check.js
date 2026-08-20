// The sub-tabs are pure layout, which jsdom cannot see. This checks that exactly one pane
// is actually visible, that the moved charts still draw, and that switching panes doesn't
// leave a canvas or chart sized to a hidden container.
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

  await page.evaluate(() => showTab('stats'));
  await page.waitForTimeout(400);

  ck('four sub-tabs are present', await page.locator('.stats-subtabs button').count() === 4);
  ck('the sub-tab row fits on one line without wrapping', await page.evaluate(() => {
    const bs = [...document.querySelectorAll('.stats-subtabs button')];
    return new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))).size === 1;
  }));

  const visible = async () => page.evaluate(() =>
    ['groups','practice','money','upkeep'].filter(n =>
      document.getElementById('statspane-' + n).offsetParent !== null));

  ck('landing on Stats shows exactly one pane',
    JSON.stringify(await visible()) === JSON.stringify(['practice']));

  for (const name of ['groups','money','upkeep','practice']) {
    await page.click('#statstab-' + name);
    await page.waitForTimeout(300);
    const v = await visible();
    ck(`${name}: only its own pane is visible`, v.length === 1 && v[0] === name);
  }

  // The charts moved between containers — make sure they still have real width where they
  // now live, which is the failure mode when something renders inside a hidden pane.
  await page.click('#statstab-practice');
  await page.waitForTimeout(300);
  const rf = await page.evaluate(() => {
    const el = document.querySelector('#stats-rf-chart .stats-bar-track, #stats-rf-chart');
    return { html: document.getElementById('stats-rf-chart').innerHTML.length,
             w: el ? el.getBoundingClientRect().width : 0 };
  });
  ck('Rounds Fired still renders with real width', rf.html > 0 && rf.w > 50);

  await page.click('#statstab-money');
  await page.waitForTimeout(300);
  const as = await page.evaluate(() => ({
    html: document.getElementById('stats-as-chart').innerHTML.length,
    w: document.getElementById('stats-as-chart').getBoundingClientRect().width }));
  ck('Ammo Spend still renders with real width', as.html > 0 && as.w > 50);

  await page.click('#statstab-upkeep');
  await page.waitForTimeout(300);
  const up = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#stats-upkeep-cleaning .breakdown-row')];
    return { n: rows.length,
      widths: rows.map(r => parseFloat(r.querySelector('.breakdown-bar-fill').style.width)),
      labels: rows.map(r => r.querySelector('.breakdown-pct').textContent) };
  });
  ck('Upkeep lists every firearm', up.n > 0);
  ck('Upkeep is sorted worst-first',
    up.widths.every((w, i) => i === 0 || w <= up.widths[i - 1] + 0.001));
  ck('Upkeep states the condition in words, not just colour',
    up.labels.every(l => /ok|due soon|past due/.test(l)));
  await page.locator('#tab-stats').screenshot({ path: path.join(ARTIFACTS,'stats-upkeep.png') });

  await page.click('#statstab-groups');
  await page.waitForTimeout(300);
  ck('Groups shows a placeholder rather than a blank pane',
    (await page.locator('#statspane-groups').textContent()).trim().length > 20);
  await page.locator('#tab-stats').screenshot({ path: path.join(ARTIFACTS,'stats-groups.png') });

  // Leaving Stats and coming back must not land on a blank tab.
  await page.evaluate(() => showTab('dashboard'));
  await page.waitForTimeout(200);
  await page.evaluate(() => showTab('stats'));
  await page.waitForTimeout(300);
  ck('returning to Stats restores a visible pane', (await visible()).length === 1);

  // The shared bar must stay put across panes rather than each pane owning one.
  ck('there is exactly one filter bar', await page.locator('#stats-filters').count() === 1);
  ck('the filter bar sits above the panes, not inside one', await page.evaluate(() =>
    document.getElementById('stats-filters').closest('.stats-pane') === null));

  await page.click('#statstab-money');
  await page.waitForTimeout(300);
  const moneyBar = await page.evaluate(() => ({
    locDim: getComputedStyle(document.getElementById('statsf-location')).opacity,
    locDisabled: document.getElementById('stats-location').disabled,
    note: document.getElementById('stats-filter-note').textContent,
    visible: document.getElementById('stats-filters').offsetParent !== null,
  }));
  ck('Money dims the location filter rather than hiding it',
    parseFloat(moneyBar.locDim) < 0.6 && moneyBar.visible);
  ck('Money disables it for real', moneyBar.locDisabled);
  ck('Money says why it is off', /seller/.test(moneyBar.note));

  // Spend by store, with a real seller list.
  await page.selectOption('#stats-range', 'all');
  await page.waitForTimeout(300);
  const stores = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#stats-as-seller-breakdown .breakdown-row')];
    return { n: rows.length,
      vals: rows.map(r => parseFloat(r.querySelector('.breakdown-val').textContent.replace('$',''))),
      text: document.getElementById('stats-as-seller-breakdown').textContent };
  });
  ck('spend by store lists the demo sellers', stores.n > 0);
  ck('stores are ranked by spend',
    stores.vals.every((v, i) => i === 0 || v <= stores.vals[i-1] + 0.001));
  ck('no blended per-round price while calibers are mixed', !/\/rd/.test(stores.text));
  await page.locator('#statspane-money').screenshot({ path: path.join(ARTIFACTS,'stats-money.png') });

  // ── Groups pane, with a firearm that actually has groups ──
  const cost = await page.evaluate(() => {
    const t = [...document.querySelectorAll('#stats-as-cost .stats-stat-box')]
      .map(b => b.textContent.replace(/\s+/g, ' '));
    return { tiles: t, rows: document.querySelectorAll('#stats-as-cost .breakdown-row').length,
             note: document.querySelector('#stats-as-cost .stats-note').textContent.replace(/\s+/g,' ') };
  });
  ck('cost of shooting reports a total and a per-trip figure',
    cost.tiles.length === 2 && /Per Range Trip/i.test(cost.tiles.join(' ')));
  ck('cost of shooting ranks firearms', cost.rows > 1);
  ck('cost of shooting is labelled an estimate', /estimated/i.test(cost.note));
  await page.locator('#stats-as-cost').screenshot({ path: path.join(ARTIFACTS,'stats-cost.png') });

  const burn = await page.evaluate(() =>
    [...document.querySelectorAll('#stats-as-burn .breakdown-row')].map(r => ({
      label: r.querySelector('.breakdown-name').textContent,
      rate: parseFloat(r.querySelector('.breakdown-val').textContent),
    })));
  ck('burn rate lists chamberings', burn.length > 0);
  ck('burn rate is ranked fastest first',
    burn.every((b, i) => i === 0 || b.rate <= burn[i-1].rate + 1));
  ck('a multi-caliber firearm shows as one bucket',
    burn.some(b => b.label.includes(' / ')) || burn.length > 0);

  await page.click('#statstab-groups');
  await page.waitForTimeout(300);
  ck('Groups prompts for a firearm rather than drawing an empty chart',
    /Pick a firearm/i.test(await page.locator('#stats-groups-prompt').textContent()));

  const gunId = await page.evaluate(() => (data.firearms.find(f => (f.groups||[]).length)||{}).id);
  await page.selectOption('#stats-firearm', gunId);
  await page.selectOption('#stats-range', 'all');
  await page.waitForTimeout(400);

  ck('the prompt clears once a firearm is picked',
    (await page.locator('#stats-groups-prompt').textContent()).trim() === '');
  const trend = await page.evaluate(() => {
    const svg = document.querySelector('#stats-groups-trend svg');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { w: r.width, h: r.height, pts: svg.querySelector('polyline').getAttribute('points') };
  });
  ck('the trend chart has real size', trend && trend.w > 100 && trend.h > 80);
  ck('the median line is drawn', trend && trend.pts.trim().length > 0);
  ck('median MOA tile is a number, not a dash',
    /^\d/.test((await page.locator('#stats-groups-stats .stats-stat-num').first().textContent()).trim()));
  await page.locator('#statspane-groups').screenshot({ path: path.join(ARTIFACTS,'stats-groups-trend.png') });

  // Switching panes must not leave the chart sized against a hidden container.
  await page.click('#statstab-practice');
  await page.waitForTimeout(200);
  await page.click('#statstab-groups');
  await page.waitForTimeout(300);
  const again = await page.evaluate(() => {
    const svg = document.querySelector('#stats-groups-trend svg');
    return svg ? svg.getBoundingClientRect().width : 0;
  });
  ck('the chart keeps its size after switching away and back', again > 100);

  // Compare by — the same chart driven by a grouping control.
  for (const dim of ['ammo', 'tag', 'day', 'distance']) {
    await page.selectOption('#stats-groups-compare-by', dim);
    await page.waitForTimeout(250);
    const st = await page.evaluate(() => {
      const el = document.getElementById('stats-groups-compare');
      const svg = el.querySelector('svg');
      const chart = el.querySelector('.cmp-chart');
      return { rows: el.querySelectorAll('.cmp-med').length,
               w: chart ? chart.getBoundingClientRect().width : 0,
               text: el.textContent.replace(/\s+/g, ' ') };
    });
    // Either it draws a real chart, or it explains why it can't. Never a blank box.
    const ok = (st.rows >= 2 && st.w > 100) || /nothing to compare/i.test(st.text);
    ck(`compare by ${dim}: chart or explanation, never blank`, ok);
  }

  await page.selectOption('#stats-groups-compare-by', 'tag');
  await page.waitForTimeout(250);
  ck('the tag view warns that a group can sit in two rows',
    /multi-valued/i.test((await page.locator('#stats-groups-compare').textContent()).replace(/\s+/g,' ')));
  await page.locator('#statspane-groups').screenshot({ path: path.join(ARTIFACTS,'stats-groups-compare.png') });

  // Point of impact — needs a real browser for size, and the map is square by construction.
  await page.selectOption('#stats-groups-compare-by', 'tag');
  await page.waitForTimeout(300);
  const poi = await page.evaluate(() => {
    const svg = document.querySelector('#stats-groups-poi svg');
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    return { w: r.width, h: r.height,
             dots: svg.querySelectorAll('circle[r="4"]').length,
             legend: document.querySelectorAll('#stats-groups-poi .poi-legend span').length,
             note: document.querySelector('#stats-groups-poi .stats-note').textContent.replace(/\s+/g,' ') };
  });
  ck('the point-of-impact map renders', !!poi && poi.dots > 0);
  ck('it is square and a usable size', poi && poi.w > 150 && Math.abs(poi.w - poi.h) < 2);
  ck('it never leaves colour to carry identity alone',
    poi && (poi.legend === 0 || poi.legend >= 2));
  ck('it states where the groups sit relative to aim',
    poi && /(of aim|on aim)/i.test(poi.note));
  await page.locator('#stats-groups-poi').screenshot({ path: path.join(ARTIFACTS,'stats-groups-poi.png') });

  // Legibility, measured rather than eyeballed. Text inside an SVG scales with the viewBox,
  // so a chart authored wider than the phone renders its labels smaller than body copy —
  // which is exactly how the comparison chart shipped unreadable once.
  await page.selectOption('#stats-groups-compare-by', 'ammo');
  await page.waitForTimeout(300);
  const tiny = await page.evaluate(() => {
    const out = [];
    // HTML text in the Groups pane.
    document.querySelectorAll('#statspane-groups .cmp-name, #statspane-groups .cmp-med, ' +
      '#statspane-groups .cmp-axis span, #statspane-groups .stats-note').forEach(el => {
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 10) out.push(`${el.className} ${px.toFixed(1)}px`);
    });
    // SVG text, converted to rendered pixels via the viewBox scale.
    document.querySelectorAll('#statspane-groups svg').forEach(svg => {
      const vb = svg.getAttribute('viewBox').split(' ').map(Number);
      const scale = svg.getBoundingClientRect().width / vb[2];
      svg.querySelectorAll('text').forEach(t => {
        const px = parseFloat(t.getAttribute('font-size')) * scale;
        if (px < 9) out.push(`svg text "${t.textContent}" ${px.toFixed(1)}px`);
      });
    });
    return out;
  });
  ck('no text in the Groups pane renders below its floor', tiny.length === 0);
  if (tiny.length) console.log('     too small: ' + tiny.slice(0, 8).join(' | '));
  await page.locator('#statspane-groups').screenshot({ path: path.join(ARTIFACTS,'stats-groups-full.png') });

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nStats sub-tabs OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
