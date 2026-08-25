// Runs the browser regression suites against a throwaway static server.
//
// These cover what jsdom cannot see — canvas rendering, IndexedDB, real file inputs,
// pointer gestures and layout — which is where most real bugs in this app have been.
// They are deliberately NOT part of `npm test`, so CI stays fast and dependency-free.
//
//   npm run test:browser
//
// Requires a one-time browser download:  npx playwright install chromium
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.RANGE_LOG_PORT || 8455);
const BASE = `http://localhost:${PORT}/index.html`;

const SUITES = [
  ['app-check', 'group capture, persistence, IndexedDB, reload, delete'],
  ['fixes-check', 'editing, modal dismissal, step navigation, layout'],
  ['plot-app-check', 'group plot pan and zoom'],
  ['autoadvance-check', 'scale and aim auto-advance, undo across steps'],
  ['storage-check', 'photo storage leaks, orphan detection and reclaim'],
  ['bundle-check', 'photo bundle export and import round trip'],
  ['exif-check', 'EXIF date reading and session auto-linking'],
  ['tags-check', 'group tags: entry, case-insensitive dedup, view mode'],
  ['multigroup-check', 'several groups on one photo, shared calibration and photo'],
  ['photo-share-check', 'shared photo reference counting, camera icon, restoring a lost photo'],
  ['impact-remove-check', 'removing one impact: crosshair targeting, undo, zoom precision'],
  ['dope-check', 'dope tables: unit conversion, view mode, persistence, card cap'],
  ['zero-check', 'zeros: tap to view read-only, edit, add without inheriting view mode'],
  ['ammo-view-check', 'ammo purchases: tap to view, edit, card buttons stay independent'],
  ['demo-check', 'load demo data: guard scaling, photo clearing, banner return'],
  ['details-cap-check', 'capped Details lists: caps, expansion, scroll panel, reset'],
  ['stats-tabs-check', 'Stats sub-tabs: pane switching, moved charts, Upkeep ranking'],
  ['textsize-check', 'text size: every step scales without clipping or overflow'],
  ['trend-zoom-check', 'group trend: zoom, drag-to-pan, pinned axis, tap a point for its range day'],
  ['install-check', 'manifest and icons resolve, and are the sizes they claim'],
];

const waitForServer = () => new Promise((resolve, reject) => {
  const started = Date.now();
  const poll = () => {
    http.get(BASE, res => { res.resume(); resolve(); })
      .on('error', () => {
        if (Date.now() - started > 10000) return reject(new Error('server did not start'));
        setTimeout(poll, 200);
      });
  };
  poll();
});

(async () => {
  try {
    require.resolve('playwright');
  } catch {
    console.error('Playwright is not installed.\n\n  npm install\n  npx playwright install chromium\n');
    process.exit(1);
  }

  const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
  const stop = () => { try { server.kill(); } catch {} };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });

  try {
    await waitForServer();
  } catch (e) {
    stop();
    console.error(e.message);
    process.exit(1);
  }

  // Named suites run alone: rerunning one after a fix should not cost the whole set.
  const wanted = process.argv.slice(2).map(a => a.replace(/\.js$/, ''));
  const unknown = wanted.filter(w => !SUITES.some(([n]) => n === w));
  if (unknown.length) {
    stop();
    console.error(`unknown suite: ${unknown.join(', ')}\nknown: ${SUITES.map(([n]) => n).join(', ')}`);
    process.exit(1);
  }
  const running = wanted.length ? SUITES.filter(([n]) => wanted.includes(n)) : SUITES;

  let failed = 0;
  for (const [name, what] of running) {
    process.stdout.write(`\n── ${name} — ${what}\n`);
    const r = spawnSync(process.execPath, [path.join(__dirname, `${name}.js`)], {
      stdio: 'inherit',
      env: { ...process.env, RANGE_LOG_URL: BASE, NODE_PATH: path.join(ROOT, 'node_modules') },
    });
    if (r.status !== 0) failed++;
  }

  stop();
  const n = running.length;
  console.log(failed
    ? `\n${failed} of ${n} browser suite${n === 1 ? '' : 's'} FAILED`
    : n === 1 ? `\n${running[0][0]} passed.` : `\nAll ${n} browser suites passed.`);
  process.exit(failed ? 1 : 0);
})();
