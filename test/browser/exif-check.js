// Reproduces: choosing a photo whose EXIF date matches exactly one logged session should
// link that session automatically.
const { chromium } = require('playwright');
const path = require('path');
const d = __dirname;
const { execFileSync } = require('child_process');
const os = require('os');
const fsp = require('fs');
// Generated fixtures go to a temp dir so test runs never dirty the repo.
const TMP = fsp.mkdtempSync(require('path').join(os.tmpdir(), 'rl-exif-'));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:430,height:900}, serviceWorkers:'block' });
  const page = await ctx.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto((process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html'));
  await page.waitForSelector('#app-version');

  // Pick a real demo session that is the only one on its date, and mint a photo dated to it.
  const target = await page.evaluate(() => {
    const counts = {};
    data.sessions.forEach(s => counts[s.date] = (counts[s.date] || 0) + 1);
    const s = data.sessions.find(x => counts[x.date] === 1 && x.date !== today());
    return { id: s.id, date: s.date };
  });
  const mkPhoto = (name, date) => {
    const f = path.join(TMP, name);
    execFileSync('python3', [path.join(d,'make-exif.py'), f, date.replace(/-/g,':') + ' 09:30:00']);
    return f;
  };
  const photo = mkPhoto('exif-match.jpg', target.date);

  const checks=[]; const ck=(n,ok)=>checks.push([n,ok]);

  await page.click('button.btn-clean:has-text("View Details")');
  await page.waitForTimeout(250);
  await page.click('button.btn-mini:has-text("+ Add Group")');
  await page.waitForTimeout(350);
  await page.setInputFiles('#group-file', photo);
  await page.waitForTimeout(900);

  const r = await page.evaluate(() => ({
    date: document.getElementById('group-date').value,
    session: document.getElementById('group-session').value,
    hint: document.getElementById('group-session-hint').textContent.trim(),
  }));
  console.log('session date:', target.date, '| form date:', r.date);
  console.log('linked session:', r.session || '(none)', '| expected:', target.id);
  console.log('hint:', JSON.stringify(r.hint));

  ck('date comes from EXIF', r.date === target.date);
  ck('the single session on that date is linked', r.session === target.id);

  // A deliberate pick must not be overwritten by a later photo choice.
  await page.selectOption('#group-session', '');
  await page.waitForTimeout(200);
  const other = await page.evaluate(() => {
    const opts = [...document.getElementById('group-session').options].filter(o=>o.value);
    return opts[opts.length-1].value;
  });
  await page.selectOption('#group-session', other);
  await page.waitForTimeout(250);
  await page.setInputFiles('#group-file', photo);
  await page.waitForTimeout(900);
  const kept = await page.evaluate(() => document.getElementById('group-session').value);
  ck('a session you chose yourself survives picking another photo', kept === other);

  // No session on the photo's date: say so rather than linking something arbitrary.
  const noSessionDate = '2019-03-07';
  const photoNone = mkPhoto('exif-none.jpg', noSessionDate);
  await page.click('#group-cancel');           // Cancel back to Details
  await page.waitForTimeout(350);
  await page.click('button.btn-mini:has-text("+ Add Group")');
  await page.waitForTimeout(350);
  await page.setInputFiles('#group-file', photoNone);
  await page.waitForTimeout(900);
  const none = await page.evaluate(() => ({
    session: document.getElementById('group-session').value,
    hint: document.getElementById('group-session-hint').textContent.trim(),
  }));
  ck('no session on that date leaves it unlinked', none.session === '');
  ck('and says why', /No session logged on that date/i.test(none.hint));

  // Two sessions that day: ambiguous, so ask rather than guess.
  // Demo data has no duplicate dates, so make one rather than let this branch skip.
  const dupDate = await page.evaluate(() => {
    const base = data.sessions[0];
    data.sessions.push({ ...base, id: 'dup-session', rounds: {}, totalRounds: 0 });
    save(data);
    return base.date;
  });
  if (dupDate) {
    const photoDup = mkPhoto('exif-dup.jpg', dupDate);
    await page.setInputFiles('#group-file', photoDup);
    await page.waitForTimeout(900);
    const amb = await page.evaluate(() => ({
      session: document.getElementById('group-session').value,
      hint: document.getElementById('group-session-hint').textContent.trim(),
    }));
    console.log('ambiguous hint:', JSON.stringify(amb.hint), '| date:', dupDate);
    ck('two sessions that day are not guessed between', amb.session === '');
    ck('and it asks you to pick', /pick the right one/i.test(amb.hint));
  }

  // Editing a group that already has a link: changing the date must not re-point it.
  await page.click('#group-cancel');
  await page.waitForTimeout(400);
  await page.locator('#history-groups-list button[title="Edit"]').first().click();
  await page.waitForTimeout(500);
  const linked = await page.evaluate(() => document.getElementById('group-session').value);
  await page.evaluate(() => {
    const el = document.getElementById('group-date');
    el.value = '2024-02-02';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const stillLinked = await page.evaluate(() => document.getElementById('group-session').value);
  ck('a saved link survives editing the date', !!linked && stillLinked === linked);

  let bad=0;
  checks.forEach(([n,ok])=>{ if(!ok) bad++; console.log(`${ok?'ok  ':'FAIL'} ${n}`); });
  if (errs.length) { bad++; console.log('ERRORS '+[...new Set(errs)].join(' | ')); }
  console.log(bad===0 ? '\nEXIF session linking OK.' : `\n${bad} PROBLEM(S)`);
  await browser.close();
  process.exit(bad?1:0);
})();
