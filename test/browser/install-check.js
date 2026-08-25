// Installability is invisible until someone tries to install. A renamed icon, a manifest
// left out of a deploy, or a size that disagrees with what the manifest claims all fail
// silently — the app keeps working, and the only symptom is a home screen showing a
// screenshot of the dashboard instead of the icon. Nothing else in the suite would catch it.
//
// jsdom can't do this: it never fetches the manifest or the images, so it cannot tell a
// working <link> from one pointing at a 404.
const { chromium } = require('playwright');

const URL = process.env.RANGE_LOG_URL || 'http://localhost:8455/index.html';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const checks = []; const ck = (n, ok, extra) => checks.push([n, ok, extra]);

  await page.goto(URL);
  await page.waitForSelector('#app-version');

  const href = (sel) => page.getAttribute(sel, 'href');

  // --- the links the two platforms each depend on -------------------------------------
  const manifestHref = await href('link[rel="manifest"]');
  const appleHref    = await href('link[rel="apple-touch-icon"]');
  const svgHref      = await href('link[rel="icon"][type="image/svg+xml"]');
  ck('index.html links a manifest', !!manifestHref);
  ck('index.html links an apple-touch-icon', !!appleHref);
  ck('index.html links an SVG favicon', !!svgHref);

  // theme-color drives the Android status bar; without it the shell renders default blue.
  const themeColor = await page.getAttribute('meta[name="theme-color"]', 'content');
  ck('theme-color is the app background', themeColor === '#0e0e0e', themeColor);

  // --- the manifest itself -------------------------------------------------------------
  const base = new global.URL(URL);
  const resolve = (p) => new global.URL(p, base).href;

  const fetchStatus = (url) => page.evaluate(async u => {
    try { const r = await fetch(u); return r.status; } catch { return 0; }
  }, url);

  let manifest = null;
  if (manifestHref) {
    const url = resolve(manifestHref);
    ck('manifest.json is reachable', await fetchStatus(url) === 200);
    manifest = await page.evaluate(async u => {
      try { return await (await fetch(u)).json(); } catch { return null; }
    }, url);
    ck('manifest.json parses as JSON', !!manifest);
  }

  if (manifest) {
    ck('manifest declares standalone display', manifest.display === 'standalone', manifest.display);
    // A relative start_url is what lets a fork work from a project subpath on GitHub Pages.
    ck('start_url is relative', typeof manifest.start_url === 'string' &&
       !manifest.start_url.startsWith('/') && !/^https?:/.test(manifest.start_url),
       manifest.start_url);
    ck('background_color matches the app', manifest.background_color === '#0e0e0e');

    const icons = manifest.icons || [];
    ck('manifest lists icons', icons.length > 0);

    // Android needs a 192 and a 512 specifically; other sizes do not substitute.
    const sizes = new Set(icons.map(i => i.sizes));
    ck('manifest has a 192x192', sizes.has('192x192'));
    ck('manifest has a 512x512', sizes.has('512x512'));
    ck('manifest has a maskable icon',
       icons.some(i => (i.purpose || '').split(/\s+/).includes('maskable')));

    // Every icon must exist AND actually be the size it claims — a mismatch is how an icon
    // ends up blurry on a device nobody tested on.
    for (const icon of icons) {
      const url = resolve(icon.src);
      const dim = await page.evaluate(u => new Promise(res => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => res(null);
        img.src = u;
      }), url);
      const [w, h] = (icon.sizes || '').split('x').map(Number);
      ck(`icon ${icon.src} (${icon.purpose || 'any'}) loads at ${icon.sizes}`,
         !!dim && dim.w === w && dim.h === h,
         dim ? `${dim.w}x${dim.h}` : 'failed to load');
    }
  }

  // --- iOS: the apple-touch-icon must be a real 180px PNG ------------------------------
  if (appleHref) {
    const dim = await page.evaluate(u => new Promise(res => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res(null);
      img.src = u;
    }), resolve(appleHref));
    ck('apple-touch-icon loads at 180x180', !!dim && dim.w === 180 && dim.h === 180,
       dim ? `${dim.w}x${dim.h}` : 'failed to load');
  }

  if (svgHref) ck('icon.svg is reachable', await fetchStatus(resolve(svgHref)) === 200);

  await browser.close();

  let bad = 0;
  for (const [name, ok, extra] of checks) {
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} ${name}${!ok && extra ? ` — got ${extra}` : ''}`);
  }
  console.log(bad ? `Install check FAILED (${bad}).` : 'Install check OK.');
  process.exit(bad ? 1 : 0);
})();
