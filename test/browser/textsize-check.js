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

  let bad = 0;
  checks.forEach(([n, ok]) => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS ' + [...new Set(errs)].join(' | ')); }
  console.log(bad === 0 ? '\nText size OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
