// Serves the app on the local network so a change can be tried on a phone before it is
// deployed. Dev tooling only — the app itself still needs nothing but a static host.
//
//   npm run serve            # then open the printed URL on a phone on the same Wi-Fi
//   npm run serve -- 9000    # a different port
//
// It serves an explicit list of files rather than a directory, because the repo root also
// holds `local_data/` — real backups, deliberately gitignored — and `python3 -m http.server`
// from here would hand those to anyone on the network. Adding a runtime file to the app
// means adding it to RUNTIME below, or it will 404 here while working fine in production.
//
// Two things behave differently over a LAN address than they do on the deployed site:
//
//  - The service worker will not register. A plain http:// origin that isn't localhost is
//    not a secure context, so registration fails (the app logs it and carries on). Offline
//    mode and the update banner can only be tested on the deployed site — everything else,
//    including IndexedDB photo storage, works normally.
//  - Storage is per origin, so this instance starts empty rather than sharing the data on
//    the deployed app. Load a photo and mark it, or import a backup from Settings.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8456);

// Everything the app needs to run, and nothing else.
const RUNTIME = [
  'index.html', 'app.css', 'app.js', 'sw.js', 'manifest.json',
  'icon.svg', 'icon-32.png', 'icon-180.png', 'icon-192.png', 'icon-512.png',
];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  if (!RUNTIME.includes(name)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Not served: ${name}\nThis server exposes only the app's runtime files.\n`);
    return;
  }
  fs.readFile(path.join(ROOT, name), (err, body) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Missing on disk: ${name}\n`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(name)] || 'application/octet-stream',
      // Edit, pull to refresh, see the change. Without this a phone will happily sit on a
      // cached app.js for the rest of the session and the change will look like it failed.
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(body);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
  const version = (() => {
    const m = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8').match(/APP_VERSION = '([^']+)'/);
    return m ? m[1] : '?';
  })();

  console.log(`\nRange Log v${version} — serving ${RUNTIME.length} runtime files\n`);
  console.log(`  this machine   http://localhost:${PORT}/`);
  addrs.forEach(a => console.log(`  on the Wi-Fi   http://${a}:${PORT}/`));
  if (!addrs.length) console.log('  (no network interface found — localhost only)');
  console.log('\nThe phone has to be on the same network. Ctrl-C to stop.\n');
});
