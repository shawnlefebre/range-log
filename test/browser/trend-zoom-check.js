// The group-size trend is a scrolling plot behind a pinned y-axis, which is exactly the kind
// of thing jsdom cannot see: scroll offsets, pointer drags, and whether tapping a point opens
// the right session and leaves you where you were looking afterwards.
const { chromium } = require('playwright');
const path = require('path');
const ARTIFACTS = path.join(__dirname, '.artifacts');
require('fs').mkdirSync(ARTIFACTS, { recursive: true });
const URL = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';

const PLOT = '#stats-groups-trend .trend-scroll svg';
const SCROLLER = '#stats-groups-trend .trend-scroll';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 900 },
    serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const checks = []; const ck = (n, ok) => checks.push([n, ok]);
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));

  await page.goto(URL);
  await page.waitForSelector('#app-version');
  await page.evaluate(() => loadDemoData());
  await page.waitForTimeout(300);

  // Demo data puts its handful of groups on a single day, which is fine for the app but
  // leaves nothing to zoom into. Seed a realistic spread — deterministic, and stopping at
  // today so nothing is dated in the future — onto the demo rifle.
  const gunId = await page.evaluate(() => {
    showTab('stats'); showStatsSection('groups');
    const g = [...data.firearms].sort((a, b) =>
      (b.groups || []).length - (a.groups || []).length)[0];
    const seed = g.groups[0];
    const today = new Date(); today.setHours(12, 0, 0, 0);
    g.groups = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i * 11);              // ~8 months back, every 11 days
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
        `${String(d.getDate()).padStart(2, '0')}`;
      // Spread the impacts a little differently each time so the trend actually moves.
      const spread = 0.006 + (i % 5) * 0.002;
      g.groups.push(Object.assign({}, seed, {
        id: 'tz_' + i,
        date: iso,
        impacts: seed.impacts.map((pt, n) => ({
          x: 0.5 + Math.cos(n * 1.7 + i) * spread,
          y: 0.5 + Math.sin(n * 1.7 + i) * spread,
        })),
      }));
    }
    save(data);
    return g.id;
  });
  await page.selectOption('#stats-firearm', gunId);
  await page.selectOption('#stats-range', 'all');
  await page.waitForTimeout(400);

  const geom = () => page.evaluate(([p, s]) => {
    const svg = document.querySelector(p);
    const sc = document.querySelector(s);
    const axis = document.querySelector('#stats-groups-trend .trend-axis');
    return svg ? {
      plotW: Math.round(svg.getBoundingClientRect().width),
      viewW: Math.round(sc.clientWidth),
      scrollW: sc.scrollWidth,
      left: Math.round(sc.scrollLeft),
      axisW: axis ? Math.round(axis.getBoundingClientRect().width) : 0,
      axisLeft: axis ? Math.round(axis.getBoundingClientRect().left) : 0,
      readout: (document.getElementById('trend-readout') || {}).textContent || '',
      points: svg.querySelectorAll('.trend-point').length,
    } : null;
  }, [PLOT, SCROLLER]);

  // ── zooming in has to make the plot wider than its window, or there is nothing to pan ──
  const fit = await geom();
  ck('at Fit the whole range is visible without scrolling', fit && fit.scrollW <= fit.viewW + 2);
  // A year of history once read "Aug 23 – Aug 25" — correct arithmetic, but both ends were
  // printed without a year, so two different years looked like a two-day window.
  ck('a span crossing a year names the years',
    fit && /\d{4}/.test(fit.readout));

  await page.click('#stats-groups-trend .trend-ctrl button:nth-child(4)');   // 1 mo
  await page.waitForTimeout(400);
  const zoomed = await geom();
  ck('zooming to 1 mo makes the plot wider than the window',
    zoomed && zoomed.scrollW > zoomed.viewW + 20);
  ck('the readout names the span actually on screen',
    zoomed && /\w{3}\s+\d/.test(zoomed.readout));
  ck('the y-axis stays pinned beside the plot, not scrolled with it',
    zoomed && zoomed.axisW > 20);

  // Zooming in lands at the recent end — the newest groups are the ones you want first.
  ck('zooming in shows the most recent groups, not the oldest',
    zoomed && zoomed.left > 0);

  // ── dragging anywhere in the plot pans it ────────────────────────────────
  // Zooming parks you at the recent end, so scrollLeft is already at its maximum: the drag
  // that can actually move is the one pulling earlier dates back into view.
  const box = await page.locator(SCROLLER).boundingBox();
  const before = (await geom()).left;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.85, box.y + box.height / 2, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = (await geom()).left;
  ck('dragging inside the chart pans it back through the history', dragged < before);

  const axisAfter = await geom();
  ck('panning does not drag the y-axis along with it',
    Math.abs(axisAfter.axisLeft - zoomed.axisLeft) <= 1);

  // ── tapping a point opens that range day, and hands off to the session ───
  // Zoomed in and panned, most points are off-screen — pick one actually under the window,
  // or the click lands on nothing. Still requires a session on the point: the day view no
  // longer needs one, but the handoff to the session view is what this then exercises.
  const target = await page.evaluate(([p, s]) => {
    const view = document.querySelector(s).getBoundingClientRect();
    for (const c of document.querySelectorAll(p + ' .trend-point')) {
      if (!c.dataset.session) continue;
      const svg = c.ownerSVGElement;
      const r = svg.getBoundingClientRect();
      const scale = r.width / Number(svg.getAttribute('width'));
      const x = r.left + Number(c.getAttribute('cx')) * scale;
      const y = r.top + Number(c.getAttribute('cy')) * scale;
      if (x > view.left + 8 && x < view.right - 8) {
        return { x, y, session: c.dataset.session, date: c.dataset.date };
      }
    }
    return null;
  }, [PLOT, SCROLLER]);
  ck('points carry the day they belong to', !!target);

  if (target) {
    const wasLeft = (await geom()).left;
    await page.mouse.click(target.x, target.y);
    await page.waitForTimeout(400);
    ck('tapping a point opens that range day', await page.isVisible('#modal-day'));
    ck('it opens the day the point sits on',
      await page.evaluate(() => dayViewDate) === target.date);

    // Every group that firearm shot that day, including any marked without a session —
    // the reason this is keyed on the date rather than on session id.
    const shown = await page.evaluate(() => ({
      rows: document.querySelectorAll('#day-groups .group-row').length,
      expected: (data.firearms.find(g => g.id === document.getElementById('stats-firearm').value)
        .groups || []).filter(g => g.date === dayViewDate).length,
    }));
    ck('it lists every group from that day', shown.rows === shown.expected && shown.rows > 0);

    ck('the day names the firearm and the group count',
      /\d+ group/.test(await page.textContent('#day-sub')));
    ck('and offers a way through to the full session',
      await page.isVisible('#day-buttons .btn-secondary'));

    // Handing off must not leave the two stacked.
    await page.click('#day-buttons .btn-secondary');
    await page.waitForTimeout(400);
    ck('opening the session from there closes the day view',
      await page.isVisible('#modal-session') && !(await page.isVisible('#modal-day')));
    ck('the session opens read-only rather than straight into an edit',
      await page.evaluate(() => document.getElementById('modal-session').classList.contains('viewing')));

    await page.click('#session-buttons .btn-secondary');
    await page.waitForTimeout(400);
    const back = await geom();
    ck('closing it returns to the chart', await page.isVisible('#stats-groups-trend'));
    ck('and to the same zoom and scroll position you left',
      !!back && Math.abs(back.left - wasLeft) <= 2 && back.scrollW > back.viewW + 20);
  }

  // A drag must not be read as a tap — otherwise panning keeps opening the day view.
  await page.evaluate(() => {
    if (typeof closeModal === 'function') { closeModal('modal-session'); closeModal('modal-day'); }
  });
  await page.waitForTimeout(200);
  const box2 = await page.locator(SCROLLER).boundingBox();
  const startY = target ? target.y : box2.y + box2.height / 2;
  await page.mouse.move(target ? target.x : box2.x + box2.width * 0.6, startY);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width * 0.25, startY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  ck('panning across a point does not open its day',
    !(await page.isVisible('#modal-day')) && !(await page.isVisible('#modal-session')));

  await page.locator('#stats-groups-trend').screenshot(
    { path: path.join(ARTIFACTS, 'trend-zoomed.png') });

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS ' + [...new Set(errs)].join(' | ')); }
  console.log(bad === 0 ? '\nTrend zoom OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
