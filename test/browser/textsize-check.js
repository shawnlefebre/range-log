// Text size is a layout question, not a data one: the risk is that scaling everything up
// clips a control, wraps a row, or pushes the page sideways. Only a real browser can say.
const { chromium } = require('playwright');
const path = require('path');
const ARTIFACTS = path.join(__dirname, '.artifacts');
require('fs').mkdirSync(ARTIFACTS, { recursive: true });
const URL = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';
const TABS = ['dashboard', 'log', 'sessions', 'ammo', 'stats', 'settings'];

(async () => {
  const browser = await chromium.launch();
  const checks = []; const ck = (n, ok) => checks.push([n, ok]);
  const errs = [];

  // The narrowest phone worth caring about, so anything wider is covered too.
  for (const size of ['normal', 'large', 'larger', 'largest']) {
    const ctx = await browser.newContext({ viewport:{width:375,height:812}, serviceWorkers:'block' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    await page.addInitScript(s => localStorage.setItem('rangeLogTextSize', s), size);
    await page.goto(URL);
    await page.waitForSelector('#app-version');
    await page.waitForTimeout(350);

    const problems = [];
    for (const tab of TABS) {
      await page.evaluate(t => showTab(t), tab);
      if (tab === 'stats') {
        for (const sec of ['groups', 'practice', 'money', 'upkeep']) {
          await page.evaluate(s => showStatsSection(s), sec);
          await page.waitForTimeout(120);
          problems.push(...await scan(page, `${tab}/${sec}`));
        }
      } else {
        await page.waitForTimeout(120);
        problems.push(...await scan(page, tab));
      }
    }
    ck(`${size}: no clipping, wrapping or sideways scroll`, problems.length === 0);
    if (problems.length) console.log('     ' + [...new Set(problems)].slice(0, 5).join(' | '));

    // The bar charts size their text in rem but used to reserve its space in px, so at the
    // larger steps the month labels were clipped away below the fold and the round counts
    // ran into each other. Both failures are invisible to the scan above: one is vertical,
    // the other is overlap rather than truncation.
    const bars = await barCharts(page);
    ck(`${size}: bar chart labels are not cut off below the plot`,
      bars.every(c => c.clipped === 0));
    ck(`${size}: no two visible bar labels overlap`,
      bars.every(c => c.overlap === 0));
    ck(`${size}: every bar still has a value and a label reserved`,
      bars.every(c => c.labels === c.cols && c.vals === c.cols));
    bars.filter(c => c.clipped || c.overlap).forEach(c =>
      console.log(`     ${c.id}: clipped ${c.clipped}px, ${c.overlap} overlapping`));

    // The y-axis gutter is measured from its own ticks, so it has to grow with the text or
    // the numbers get clipped; and each line has to sit where its own label claims it does.
    ck(`${size}: every gridline sits at the value it is labelled with`,
      bars.every(c => c.misaligned <= 1.5));
    ck(`${size}: the axis gutter fits its widest tick`,
      bars.every(c => c.gutter >= c.widestTick + 2));
    bars.filter(c => c.misaligned > 1.5 || c.gutter < c.widestTick + 2).forEach(c =>
      console.log(`     ${c.id}: gridline off by ${c.misaligned}px, gutter ${c.gutter} vs tick ${c.widestTick}`));

    // The nav is sticky beneath a sticky header; its offset has to track the header height
    // or it rides over the content at larger sizes.
    const stick = await page.evaluate(() => {
      const h = document.querySelector('header').getBoundingClientRect();
      const n = document.querySelector('nav').getBoundingClientRect();
      return Math.abs(n.top - h.bottom);
    });
    ck(`${size}: the nav sits flush under the header`, stick <= 1);

    if (size === 'largest') {
      await page.evaluate(() => showTab('stats'));
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(ARTIFACTS, 'textsize-largest.png') });
    }
    await ctx.close();
  }

  async function scan(page, where) {
    return page.evaluate(w => {
      const out = [];
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
        out.push(`${w}: page scrolls sideways`);
      }
      // Controls and labels that must not lose their text.
      document.querySelectorAll('button, .btn-mini, .breakdown-name, .bar-lab, .cmp-med, .stats-stat-num')
        .forEach(el => {
          if (el.offsetParent === null) return;
          // nav scrolls on purpose, so its buttons are allowed to sit outside the viewport
          if (el.closest('nav')) return;
          if (el.scrollWidth > el.clientWidth + 2) {
            out.push(`${w}: clipped "${(el.textContent || '').trim().slice(0, 16)}"`);
          }
        });
      return out;
    }, where);
  }

  // Measures each rendered bar chart: vertical overflow, and whether any two labels that are
  // actually showing collide. Thinned labels keep their box (visibility, not display) so the
  // columns stay aligned — those are skipped, since an invisible label cannot collide.
  async function barCharts(page) {
    const ids = ['stats-rf-chart', 'stats-rt-chart', 'stats-as-chart'];
    const out = [];
    for (const [sec, id] of [['practice','stats-rf-chart'], ['practice','stats-rt-chart'],
                             ['money','stats-as-chart']]) {
      await page.evaluate(s => { showTab('stats'); showStatsSection(s); }, sec);
      await page.waitForTimeout(150);
      const r = await page.evaluate(i => {
        const c = document.querySelector('#' + i + ' .stats-bar-chart');
        if (!c) return null;
        const shown = [...c.querySelectorAll('.stats-bar-label')]
          .filter(e => getComputedStyle(e).visibility !== 'hidden')
          .map(e => e.getBoundingClientRect());
        let overlap = 0;
        for (let n = 1; n < shown.length; n++) {
          if (shown[n].left < shown[n - 1].right) overlap++;
        }
        // Read the axis back off the DOM and check it against its own geometry.
        const plot = c.closest('.stats-bar-plot');
        const track = c.querySelector('.stats-bar-track').getBoundingClientRect();
        const num = e => Number((e.textContent || '').replace(/[^0-9.]/g, ''));
        const gls = [...plot.querySelectorAll('.stats-bar-gl')];
        const ceiling = gls.length ? num(gls[gls.length - 1].querySelector('.stats-bar-tick')) : 0;
        let misaligned = 0, widestTick = 0;
        gls.forEach(g => {
          const tick = g.querySelector('.stats-bar-tick');
          widestTick = Math.max(widestTick, tick.getBoundingClientRect().width);
          if (!ceiling) return;
          const want = track.bottom - (num(tick) / ceiling) * track.height;
          misaligned = Math.max(misaligned, Math.abs(g.getBoundingClientRect().top - want));
        });
        return {
          id: i,
          clipped: c.scrollHeight - c.clientHeight,
          overlap,
          cols: c.querySelectorAll('.stats-bar-col').length,
          labels: c.querySelectorAll('.stats-bar-label').length,
          vals: c.querySelectorAll('.stats-bar-val').length,
          misaligned: +misaligned.toFixed(2),
          widestTick: +widestTick.toFixed(2),
          gutter: parseFloat(getComputedStyle(plot).getPropertyValue('--gutter')) || 0,
        };
      }, id);
      if (r) out.push(r);
    }
    return out;
  }

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS ' + [...new Set(errs)].join(' | ')); }
  console.log(bad === 0 ? '\nText size OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
