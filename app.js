// ── DATA SCHEMA v9 ──────────────────────────────────────────────
// v1: lastCleaned (single date) per gun
// v2: cleanings array per gun, each {id, date, type, notes}
//     type: 'quick' | 'deep' | 'detail'
//     deep & detail reset the deep-clean counter; quick does not
// v3: zeros array per gun, each {id, date, distance, distanceUnit, ammo, optic, notes}
// v4: top-level ammo array, each {id, date, caliber, manufacturer, model, quantity, totalPrice, notes}
// v5: gun.caliber becomes calibers array (multi-select); primary caliber = first entry
// v6: gun.type added — 'rifle' | 'pistol' | 'revolver' | 'shotgun' | null (unset)
// v7: top-level isDemo flag added — true only for freshly-generated sample data
// v8: gun.notes added — free-text notes per firearm (torque specs, maintenance reminders, etc.)
// v9: gun.groups array added — target group analyses, each
//     {id, date, distance, distanceUnit, ammo, bulletDia, calMode, calInches, calInchesH,
//      calPts[], poa, impacts[], photoId}
//     Marked points are normalised by image WIDTH on both axes (so aspect is preserved
//     and they stay valid at any resolution, with or without the photo). Group size,
//     mean radius, W/H and offsets are always recomputed, never stored.
// v10: group.sessionId added — links a group to the range session it was shot at, or
//      null when unlinked. Existing groups are auto-linked only where a single session
//      shares their date; anything ambiguous stays null rather than guessing.
// v11: group.tags added — freeform labels (prone, bench, bipod, wind...) so a group can
//      be described along whatever dimension matters, without a new field per idea.
const SCHEMA_VERSION = 11;

const CLEANING_TYPES = {
  quick: { label: 'Quick', resetsDeep: false },
  deep: { label: 'Deep', resetsDeep: true },
  detail: { label: 'Detail strip', resetsDeep: true },
};

const FIREARM_TYPES = {
  rifle: { label: 'Rifle' },
  pistol: { label: 'Pistol' },
  revolver: { label: 'Revolver' },
  shotgun: { label: 'Shotgun' },
};

// Bullet diameters in inches, used to draw impact marks at true size while marking a
// group. Calibers in this app are free text, so this is a best-effort lookup with a
// manual override in the group form for anything it doesn't recognise.
const CALIBER_DIAMETERS = {
  '.22 lr': 0.223, '.22lr': 0.223, '22 lr': 0.223,
  '.223 rem': 0.224, '.223': 0.224, '5.56 nato': 0.224, '5.56': 0.224, '5.56x45': 0.224,
  '.243 win': 0.243, '6mm arc': 0.243,
  '6.5 creedmoor': 0.264, '6.5 grendel': 0.264,
  '.270 win': 0.277,
  '7mm rem mag': 0.284, '.280 rem': 0.284,
  '.300 blk': 0.308, '.300 blackout': 0.308, '.308 win': 0.308, '.308': 0.308,
  '.30-06': 0.308, '.30-30': 0.308, '.300 win mag': 0.308,
  '7.62x39': 0.311, '7.62x54r': 0.311,
  '.338 lapua': 0.338,
  '9mm': 0.355, '9x19': 0.355, '.380 acp': 0.355, '.357 sig': 0.355,
  '.38 special': 0.357, '.357 mag': 0.357, '.357 magnum': 0.357,
  '.40 s&w': 0.400, '10mm': 0.400, '10mm auto': 0.400,
  '.44 mag': 0.429, '.44 magnum': 0.429, '.44 special': 0.429,
  '.45 acp': 0.451, '.45 colt': 0.452,
  '.50 ae': 0.500, '.50 bmg': 0.510,
  '28 gauge': 0.550, '20 gauge': 0.615, '16 gauge': 0.663, '12 gauge': 0.729, '10 gauge': 0.775,
};

// Resolves a caliber string to a bullet diameter, or null when it isn't recognised.
function caliberDiameter(caliber) {
  if (!caliber) return null;
  const key = String(caliber).trim().toLowerCase();
  return CALIBER_DIAMETERS[key] ?? null;
}

// Best guess for a group's bullet diameter: the chosen ammo's caliber first, then the
// firearm's primary caliber. Returns null when neither is recognised, leaving it to
// the manual field rather than inventing a number.
function guessBulletDiameter(gun, ammoLabel) {
  const match = (data.ammo || []).find(a => ammoDisplayLabel(a) === ammoLabel);
  return caliberDiameter(match && match.caliber) ?? caliberDiameter(gunCalibers(gun)[0]);
}

// Generates a full year of plausible demo data (firearms, sessions, cleanings, ammo)
// anchored to today's date, so it always looks current no matter when the app is loaded fresh.
function generateDemoData() {
  const g1 = 'dg1', g2 = 'dg2', g3 = 'dg3', g4 = 'dg4';
  const l1 = 'dl1', l2 = 'dl2';
  const s1 = 'ds1', s2 = 'ds2';

  const firearms = [
    { id: g1, name: 'Example Rifle', type: 'rifle', calibers: ['.223 Rem', '5.56 NATO'], cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [], groups: [], notes: 'Action screws: 65 in-lbs, front then rear.' },
    { id: g2, name: 'Example Pistol', type: 'pistol', calibers: ['9mm'], cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [], groups: [], notes: '' },
    { id: g3, name: 'Example Revolver', type: 'revolver', calibers: ['.357 Mag', '.38 Special'], cleanThreshold: 300, totalRounds: 0, cleanings: [], zeros: [], groups: [], notes: '' },
    { id: g4, name: 'Example Shotgun', type: 'shotgun', calibers: ['12 Gauge'], cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [], groups: [], notes: '' },
  ];
  const locations = [
    { id: l1, name: 'Example Range North' },
    { id: l2, name: 'Example Range South' },
  ];
  const sellers = [
    { id: s1, name: 'Example Store A' },
    { id: s2, name: 'Example Store B' },
  ];

  const sessions = [];
  const ammo = [];

  const pad2 = n => String(n).padStart(2, '0');
  const toISO = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;

  // Deterministic month "shape" (oldest -> newest, 12 months) so the chart has realistic variation
  const monthShape = [180, 420, 310, 95, 150, 510, 280, 340, 460, 220, 390, 475];
  const spendShape = [40, 180, 60, 0, 95, 140, 75, 110, 150, 55, 130, 165];
  // Which firearms (by index: 0=rifle,1=pistol,2=revolver,3=shotgun) go on each session —
  // real range trips rarely bring every gun, so this cycles through solo trips, pairs,
  // and occasional larger outings rather than splitting every session across all four.
  const sessionFirearmSets = [
    [0, 1], [2], [0], [1, 3], [0, 1, 2], [3], [1], [0, 3],
    [2, 3], [0, 1, 3], [1, 2], [0], [0, 1, 2, 3], [3], [0, 1],
    [2], [1], [0, 2], [0, 1, 3], [3], [1, 2, 3], [0], [1], [0, 1, 2],
  ];
  const ammoOptions = [
    { caliber: '9mm', manufacturer: 'Example Ammo Co', model: '115gr FMJ', cpr: 0.28 },
    { caliber: '.223 Rem', manufacturer: 'Example Ammo Co', model: '55gr FMJ', cpr: 0.35 },
    { caliber: '.357 Mag', manufacturer: 'Example Ammo Co', model: '125gr JHP', cpr: 0.55 },
    { caliber: '12 Gauge', manufacturer: 'Example Ammo Co', model: '00 Buck', cpr: 0.70 },
  ];
  const gunIds = [g1, g2, g3, g4];

  // Splits a session's round total evenly across whichever firearm indices went on that trip.
  function buildRoundsForSubset(amount, gunIndices) {
    if (!gunIndices.length) return {};
    const n = gunIndices.length;
    const base = Math.floor(amount / n);
    const remainder = amount - base * n;
    const rounds = {};
    gunIndices.forEach((idx, i) => {
      const r = base + (i < remainder ? 1 : 0);
      if (r > 0) rounds[gunIds[idx]] = r;
    });
    return rounds;
  }

  const now = new Date();
  const todayDate = now.getDate();
  let sessionCounter = 0;

  for (let i = 0; i < 12; i++) {
    const monthsBack = 11 - i;
    const anchor = new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    // For the current month, never generate a date past "today" — a demo session
    // logged in the future looks like a bug, not sample data.
    const dayCap = (monthsBack === 0) ? todayDate : daysInMonth;
    const day1 = Math.min(8, dayCap);
    const day2 = Math.min(22, dayCap);
    const loc1 = (i % 2 === 0) ? l1 : l2;
    const loc2 = (i % 2 === 0) ? l2 : l1;

    const total = monthShape[i];
    const s1total = Math.round(total * 0.6);
    const s2total = total - s1total;

    if (s1total > 0) {
      const subset1 = sessionFirearmSets[sessionCounter % sessionFirearmSets.length];
      sessionCounter++;
      const rounds1 = buildRoundsForSubset(s1total, subset1);
      sessions.push({
        id: `dsess_${i}_1`, date: toISO(year, month, day1), locationId: loc1,
        rounds: rounds1, notes: '',
        totalRounds: Object.values(rounds1).reduce((a, b) => a + b, 0),
        createdAt: new Date().toISOString(),
      });
    }
    if (s2total > 0 && day2 !== day1) {
      const subset2 = sessionFirearmSets[sessionCounter % sessionFirearmSets.length];
      sessionCounter++;
      const rounds2 = buildRoundsForSubset(s2total, subset2);
      sessions.push({
        id: `dsess_${i}_2`, date: toISO(year, month, day2), locationId: loc2,
        rounds: rounds2, notes: '',
        totalRounds: Object.values(rounds2).reduce((a, b) => a + b, 0),
        createdAt: new Date().toISOString(),
      });
    }

    const spend = spendShape[i];
    if (spend > 0) {
      const opt = ammoOptions[i % ammoOptions.length];
      const qty = Math.max(20, Math.round(spend / opt.cpr / 10) * 10);
      const totalPrice = Math.round(qty * opt.cpr * 100) / 100;
      ammo.push({
        id: `dammo_${i}`, date: toISO(year, month, day1), caliber: opt.caliber,
        manufacturer: opt.manufacturer, model: opt.model, quantity: qty, totalPrice,
        sellerId: (i % 2 === 0) ? s1 : s2, status: i < 9 ? 'usedup' : 'instock', notes: '',
      });
    }
  }

  // A handful of cleanings per firearm, roughly quarterly, mostly quick with an occasional deep
  const cleaningMonthsBack = [10, 7, 4, 1];
  firearms.forEach((gun, gi) => {
    cleaningMonthsBack.forEach((mb, ci) => {
      const d = new Date(now.getFullYear(), now.getMonth() - mb, 15);
      gun.cleanings.push({
        id: `dclean_${gi}_${ci}`,
        date: toISO(d.getFullYear(), d.getMonth(), d.getDate()),
        type: (ci % 3 === 2) ? 'deep' : 'quick',
        notes: '',
      });
    });
  });

  // Sample groups so the feature is discoverable on a fresh load. They hang off a real
  // session — one the rifle actually shot at — so the session scorecard has something to
  // show. Points are normalised by image width; 0.01 unit == 1 inch at this scale.
  {
    // Hang them off the most recent session the rifle shot at — sessions list newest
    // first, so a recent one is what you actually see.
    const host = [...sessions]
      .filter(s => (s.rounds[g1] || 0) > 0)
      .sort((a, b) => b.date.localeCompare(a.date))[0] || sessions[0];

    // Fixed seed so demo data stays identical run to run, but scattered like real
    // shooting rather than a perfect circle — including a slight high-right bias, since
    // a group sitting exactly on the aim point is not what a real target looks like.
    let seed = 20260817;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;

    // 0.10 normalised units == 1 inch at this scale; these land around 1-1.5 MOA at 50 yd.
    const spreads = [0.085, 0.075, 0.060];
    spreads.forEach((sd, gi) => {
      const impacts = [0, 1, 2, 3, 4].map(() => ({
        x: 0.5 + 0.012 + gauss() * sd,
        y: 0.5 - 0.010 + gauss() * sd,
      }));
      firearms[0].groups.push({
        id: `dgroup_${gi}`,
        date: host.date,
        sessionId: host.id,
        distance: 50,
        distanceUnit: 'yd',
        ammo: 'Example Ammo Co 55gr FMJ',
        tags: gi === 2 ? ['prone', 'bipod'] : ['bench', 'bags'],
        bulletDia: 0.224,
        calMode: 'linear',
        calInches: 1,
        calInchesH: 1,
        calPts: [{ x: 0.30, y: 0.50 }, { x: 0.40, y: 0.50 }],
        poa: { x: 0.50, y: 0.50 },
        impacts,
        photoId: null,
      });
    });
  }

  firearms.forEach(gun => {
    gun.totalRounds = sessions.reduce((sum, s) => sum + (s.rounds[gun.id] || 0), 0);
  });

  return { firearms, locations, sellers, sessions, ammo };
}

function buildDefaultData() {
  const demo = generateDemoData();
  return {
    schemaVersion: SCHEMA_VERSION,
    isDemo: true,
    firearms: demo.firearms,
    locations: demo.locations,
    sellers: demo.sellers,
    sessions: demo.sessions,
    ammo: demo.ammo,
  };
}

// ── STORAGE ──────────────────────────────────────────────────────
function load() {
  const raw = localStorage.getItem('rangeLogData');
  if (!raw) return buildDefaultData();
  try {
    const d = JSON.parse(raw);
    return migrateData(d);
  } catch { return buildDefaultData(); }
}

function migrateData(d) {
  if (!d.schemaVersion) d.schemaVersion = 1;

  // v1 -> v2: convert lastCleaned date to a 'deep' cleaning entry
  if (d.schemaVersion === 1) {
    d.firearms.forEach(gun => {
      if (!Array.isArray(gun.cleanings)) gun.cleanings = [];
      if (gun.lastCleaned) {
        // Migrate the single lastCleaned date as a Deep cleaning
        gun.cleanings.push({
          id: uid(),
          date: gun.lastCleaned,
          type: 'deep',
          notes: ''
        });
      }
      // Drop now-obsolete fields
      delete gun.lastCleaned;
      delete gun.roundsSinceClean;
    });
    d.schemaVersion = 2;
  }

  // v2 -> v3: add zeros array to each firearm
  if (d.schemaVersion === 2) {
    d.firearms.forEach(gun => {
      if (!Array.isArray(gun.zeros)) gun.zeros = [];
    });
    d.schemaVersion = 3;
  }

  // v3 -> v4: add top-level ammo array
  if (d.schemaVersion === 3) {
    if (!Array.isArray(d.ammo)) d.ammo = [];
    d.schemaVersion = 4;
  }

  // v4 -> v5: convert gun.caliber (string) to gun.calibers (array)
  if (d.schemaVersion === 4) {
    d.firearms.forEach(gun => {
      if (!Array.isArray(gun.calibers)) {
        gun.calibers = gun.caliber ? [gun.caliber] : [];
      }
      delete gun.caliber;
    });
    d.schemaVersion = 5;
  }

  // v5 -> v6: add type field to each firearm (defaults to null/unset)
  if (d.schemaVersion === 5) {
    d.firearms.forEach(gun => {
      if (gun.type === undefined) gun.type = null;
    });
    d.schemaVersion = 6;
  }

  // v6 -> v7: add isDemo flag. Anyone migrating existing data has real usage, never demo.
  if (d.schemaVersion === 6) {
    d.isDemo = false;
    d.schemaVersion = 7;
  }

  // v7 -> v8: add notes field to each firearm
  if (d.schemaVersion === 7) {
    d.firearms.forEach(gun => {
      if (gun.notes === undefined) gun.notes = '';
    });
    d.schemaVersion = 8;
  }

  // v8 -> v9: add groups array to each firearm
  if (d.schemaVersion === 8) {
    d.firearms.forEach(gun => {
      if (!Array.isArray(gun.groups)) gun.groups = [];
    });
    d.schemaVersion = 9;
  }

  // v9 -> v10: link existing groups to a session where it's unambiguous. A group logged
  // before this feature has only a date to go on, so we link it when exactly one session
  // shares that date and leave it unlinked otherwise — a wrong link would quietly
  // corrupt session scorecards, which is worse than no link at all.
  if (d.schemaVersion === 9) {
    d.firearms.forEach(gun => {
      (gun.groups || []).forEach(g => {
        if (g.sessionId !== undefined) return;
        const sameDay = (d.sessions || []).filter(s => s.date === g.date);
        g.sessionId = sameDay.length === 1 ? sameDay[0].id : null;
      });
    });
    d.schemaVersion = 10;
  }

  // v10 -> v11: add a tags array to every group
  if (d.schemaVersion === 10) {
    d.firearms.forEach(gun => {
      (gun.groups || []).forEach(g => { if (!Array.isArray(g.tags)) g.tags = []; });
    });
    d.schemaVersion = 11;
  }

  // Defensive: ensure every gun has cleanings + zeros + calibers arrays, and ammo + sellers exist
  d.firearms.forEach(gun => {
    if (!Array.isArray(gun.cleanings)) gun.cleanings = [];
    if (!Array.isArray(gun.zeros)) gun.zeros = [];
    if (!Array.isArray(gun.groups)) gun.groups = [];
    gun.groups.forEach(g => {
      if (g.sessionId === undefined) g.sessionId = null;
      if (!Array.isArray(g.tags)) g.tags = [];
    });
    if (!Array.isArray(gun.calibers)) gun.calibers = gun.caliber ? [gun.caliber] : [];
    if (gun.type === undefined) gun.type = null;
    if (gun.notes === undefined) gun.notes = '';
  });
  if (!Array.isArray(d.ammo)) d.ammo = [];
  if (!Array.isArray(d.sellers)) d.sellers = [];
  if (d.isDemo === undefined) d.isDemo = false;

  return d;
}

function save(d) {
  localStorage.setItem('rangeLogData', JSON.stringify(d));
}

let data = load();

// ── TARGET PHOTO STORE ────────────────────────────────────────────
// Group photos are far too big for localStorage, so they live in IndexedDB keyed by
// photoId. The split is deliberate: group records (points, scale, distance) stay in
// localStorage where they're small and durable, so if a photo is ever evicted or the
// store is unavailable, every measurement still recomputes. Photos are never written
// into the JSON backup — that keeps exports small and portable.
const PHOTO_DB = 'rangeLogPhotos';
const PHOTO_STORE = 'photos';

function photoDB() {
  return new Promise((resolve, reject) => {
    if (!self.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(PHOTO_DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(PHOTO_STORE)) req.result.createObjectStore(PHOTO_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function photoTx(mode, fn) {
  return photoDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, mode);
    const req = fn(tx.objectStore(PHOTO_STORE));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  }));
}

// All three swallow failure: a missing photo degrades the UI, it never breaks the data.
function putPhoto(id, blob) { return photoTx('readwrite', s => s.put(blob, id)).catch(() => null); }
function getPhoto(id) { return photoTx('readonly', s => s.get(id)).catch(() => null); }
function deletePhoto(id) { return photoTx('readwrite', s => s.delete(id)).catch(() => null); }

function allPhotoKeys() { return photoTx('readonly', s => s.getAllKeys()).then(k => k || []).catch(() => []); }
function clearAllPhotos() { return photoTx('readwrite', s => s.clear()).catch(() => null); }

// Every photoId currently referenced by a group. Anything in the store outside this set
// is unreachable — no screen can show it and nothing will ever delete it.
function referencedPhotoIds(d = data) {
  const ids = new Set();
  (d.firearms || []).forEach(gun => (gun.groups || []).forEach(g => {
    if (g.photoId) ids.add(g.photoId);
  }));
  return ids;
}

// Orphans accumulate whenever the dataset is replaced wholesale — importing a backup, or
// any path that drops groups without going through deleteGroup. Sweeping is precise: it
// removes only what nothing references, so re-importing your own backup on the same
// device keeps its photos, since those ids still match.
async function sweepOrphanedPhotos() {
  const keys = await allPhotoKeys();
  const keep = referencedPhotoIds();
  const orphans = keys.filter(k => !keep.has(k));
  for (const id of orphans) await deletePhoto(id);
  return orphans.length;
}

// Total bytes held by the photo store, so storage can be reported rather than guessed at.
async function photoStoreStats() {
  const keys = await allPhotoKeys();
  let bytes = 0;
  for (const id of keys) {
    const blob = await getPhoto(id);
    if (blob && typeof blob.size === 'number') bytes += blob.size;
  }
  const keep = referencedPhotoIds();
  return { count: keys.length, bytes, orphans: keys.filter(k => !keep.has(k)).length };
}

// ── UTILS ─────────────────────────────────────────────────────────
function uid() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }
function today() { return new Date().toISOString().slice(0,10); }

// Backwards-compatible caliber accessors: prefer calibers[] but fall back to legacy caliber field
function gunCalibers(gun) {
  if (Array.isArray(gun.calibers) && gun.calibers.length) return gun.calibers;
  if (gun.caliber) return [gun.caliber];
  return [];
}
function gunCaliberLabel(gun) {
  const cals = gunCalibers(gun);
  return cals.length ? cals.join(' / ') : '(no caliber)';
}
function gunAcceptsCaliber(gun, cal) {
  if (!cal) return false;
  const norm = String(cal).trim().toLowerCase();
  return gunCalibers(gun).some(c => c.trim().toLowerCase() === norm);
}

// Firearm type icon markup — pistol/revolver horizontal, rifle/shotgun diagonal,
// generic target icon shown when type is unset. All sized via width/height on the <svg>.
function typeIconSVG(type, size) {
  const s = size || 22;
  switch (type) {
    case 'pistol':
      return `<svg class="type-icon" width="${s}" height="${s}" viewBox="0 -6 44 44"><path fill="currentColor" d="M7.776 7.744l-0.512-0.512v-4l0.48-0.48h2.496l0.64-0.64h1.536l0.64 0.64h2.88l0.288 0.256h1.056l0.32-0.32h17.536v-0.352h1.024l0.416 0.416h1.472l0.32 0.32v1.088h0.672v2.432h-0.704v0.672l-0.288 0.288 0.256 0.256v1.984h-7.936l-0.608 0.992h-8.224l-0.256 0.8-0.096 0.96 0.032 1.088 0.192 1.12 0.064 0.32-0.544 0.192-0.448-1.024-0.352-1.568-0.096-1.44-0.032-0.448-0.48 0.064-0.544 0.736-0.352 0.8-0.128 0.992-0.064 1.056 0.32 0.96 0.8 0.832 0.608 0.384-0.192 0.448-1.28 0.288-0.864 0.416-0.768 0.8-0.48 0.896-0.16 1.248-0.576 0.352-0.576 0.8-0.512 1.184-0.512 1.504-0.416 1.44-0.032 0.992 0.032 0.672-0.32 0.128h-0.8l-7.424-1.888-1.152-0.608 0.064-0.864 1.696-0.096 0.096-1.728 0.48-2.24 1.056-2.496 1.664-2.464 0.992-1.376 0.832-1.568-0.096-0.64-0.992-0.96-0.864-0.544-0.352-0.096h-1.984l-0.384-0.352 0.736-1.44 0.96-0.352z"></path></svg>`;
    case 'revolver':
      return `<svg class="type-icon" width="${s}" height="${s}" viewBox="0 0 512 512"><g transform="translate(512,0) scale(-1,1)" fill="currentColor"><path d="M386.779,167.25c0.313,0.188,0.594,0.344,0.906,0.531c8.875-21.938,25.984-43.719,25.984-43.719l-11.219-8.547c-9.578,5.656-27.641,22.953-36.172,32.266C371.294,155.438,378.123,161.969,386.779,167.25z"/><path d="M511.356,394.5c-1.672-10.844-2.094-79.469-76.984-139.703c-15.781-15.828-17.828-32.609-17.515-49.141c0.156-7.875-0.438-8.422-0.438-8.422c0.141-2.266-1.297-4.328-3.438-4.922c0,0-0.891-0.594-8.766-3.438c-13.969-5.063-47.875-27.891-57.594-52.406c-2.234-5.625-3.328-13.594-3.328-13.594c-0.797-3.234-3.625-5.5-6.875-5.5h-12.031H165.263H62.498l-0.5-6.688L25.951,97H10.404v20.375H-0.002v42.719h15.547v21.078h94.891c22.922,0,39.344,39.172,44.859,68.984c0.75,4,1.156,6.984,1.156,6.984c1.875,7.703,6.297,11.891,13.531,11.891c0,0,6.703,0,16.875,0l20.281,35.234c5.672,9.859,15.984,15.891,27.109,15.891c0.094,0,0.203,0,0.281,0h83.297c41.063,0,53.156,23.625,56.5,76.031c0,10.828,14.406,18.813,22.734,18.813c8.313,0,97.078,0,105.968,0C511.903,415,513.013,405.313,511.356,394.5z M212.982,152.875h80.781c4.578,0,8.281,3.813,8.281,8.531c0,4.703-3.703,8.516-8.281,8.516h-80.781c-4.578,0-8.281-3.813-8.281-8.516C204.701,156.688,208.404,152.875,212.982,152.875z M212.982,200.594h80.781c4.578,0,8.281,3.813,8.281,8.516s-3.703,8.516-8.281,8.516h-80.781c-4.578,0-8.281-3.813-8.281-8.516S208.404,200.594,212.982,200.594z M234.498,303.922h-0.047h-0.203c-5.531,0-10.688-3-13.5-7.922l-15.516-26.969c24.438,0,55.328,0,71.016,0c-2.516,6.375-6.094,13.219-10.672,17.922c-2.719,2.797,2.734,9.359,7.297,6.547c2.297-1.406,13.344-4.953,20.797-21.813c9.641,5.156,18.25,17.438,22.078,32.234H234.498z"/></g></svg>`;
    case 'rifle':
      return `<svg class="type-icon" width="${s}" height="${s}" viewBox="-30 -30 570 570"><g fill="currentColor"><path d="M359.623,145.066l123.55-123.549L461.656,0l-23.268,23.268L422.78,7.66l-21.517,21.517l15.607,15.607l-78.764,78.764l-10.759,10.759l-52.197,52.199l-21.517,21.517L150.015,311.641l-21.517,21.517l-99.671,99.671L107.998,512l71.295-118.135l45.488,84.396l56.299-56.299l-21.281-39.483l31.798-31.797l-26.332-51.208l11.25-11.25l38.77,38.77l50.176-50.176l-38.77-38.77l62.957-62.957L359.623,145.066z M244.728,354.516l-12.085-22.421l10.024-10.024l11.718,22.788L244.728,354.516z"/><polygon points="204.647,154.46 183.129,175.977 191.391,184.24 84.529,291.101 76.267,282.838 54.75,304.357 92.792,342.398 114.309,320.881 106.047,312.618 212.909,205.757 221.171,214.018 242.688,192.501"/></g></svg>`;
    case 'shotgun':
      return `<svg class="type-icon" width="${s}" height="${s}" viewBox="5.54 -28.30 78.21 81.36"><g transform="rotate(-45, 49.5, 16)" fill="currentColor"><path d="M94.272 4.384h0.608v2.816h-0.512v2.848h-0.416v3.552h-0.416v1.152h-3.648l-0.32 0.352h-3.904l-0.16 0.832-0.192 0.416-0.352 0.16h-0.64l-0.64-0.128h-20.384l-0.736-0.128-0.128-0.384 0.288-0.416 0.416-0.64h-21.888l-0.192 0.48-0.064 0.512 0.064 0.48 0.064 0.416 0.224 0.416-0.256 0.256-0.512-0.48-0.384-0.768-0.224-0.8-0.032-0.608h-0.928l-0.192 0.576-0.192 0.672-0.096 0.672 0.032 0.512 0.448 0.384 0.512 0.256 0.16 0.256-0.032 0.352-0.224 0.352-0.48 0.16-0.736 0.128-0.352 0.192-0.288 0.288-0.32 0.608-0.096 0.48v0.576l-0.192 0.512-0.256 0.448-0.416 0.544-1.472 3.648 0.48 0.512v0.448l-0.576 0.608h-4.8l-0.832-0.224-0.032-0.736 0.128-0.288-0.224-0.864 0.256-1.952 0.704-2.208 0.896-1.888 1.056-1.568 0.672-0.672 0.416-0.48 0.224-0.672-0.064-0.512-0.384-0.672-0.64-0.48-0.64-0.256-0.896-0.16h-4.64l-0.32-0.16-0.928-0.864v-0.352h-0.256l-0.32 0.16-0.608 0.256-16.512 3.68-0.352 0.256-1.888 0.448-0.384-0.096-0.128-0.384-0.096-1.152 0.288-2.976 0.096-2.976-0.128-3.168-0.064-1.664 0.096-0.608 0.256-0.352 0.384-0.16 1.376-0.064h0.8l0.384 0.416 0.384-0.416h12.032l0.832 0.096 0.928 0.288 1.024 0.416 0.736 0.48 0.544 0.288 0.32 0.352 0.224-0.256h2.688l0.192-0.096 0.256-0.16 2.208-1.888 0.928-0.256h0.704l0.544-0.576h11.136l0.32 0.32 0.736 0.768h10.592l0.416-0.416h20.736l0.512 0.544h5.024l0.576-0.608h9.92v-0.608h0.96v1.024h0.64z"></path></g></svg>`;
    default:
      // Generic/unset: greyed-out target
      return `<svg class="type-icon generic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6" fill="var(--surface2)"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
  }
}
function fmtDate(d) {
  if (!d) return '';
  const [y,m,day] = d.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[+m-1]} ${+day}, ${y}`;
}
function totalRoundsAll() { return data.firearms.reduce((s,g) => s + (g.totalRounds||0), 0); }
function totalSessions() { return data.sessions.length; }

// Last deep clean = most recent cleaning whose type resets deep counter (deep or detail)
function lastDeepCleanDate(gun) {
  const resets = (gun.cleanings || []).filter(c => CLEANING_TYPES[c.type]?.resetsDeep);
  if (!resets.length) return null;
  return resets.reduce((latest, c) => c.date > latest ? c.date : latest, resets[0].date);
}

// Last cleaning of ANY kind (quick, deep, or detail) — a deep/detail clean also
// satisfies "at least a quick clean was done," so this is just the most recent entry overall.
function lastAnyCleanDate(gun) {
  const all = gun.cleanings || [];
  if (!all.length) return null;
  return all.reduce((latest, c) => c.date > latest ? c.date : latest, all[0].date);
}

// Shared: sum session rounds for this gun dated strictly after `sinceDate`.
// Same-day sessions don't count (assumes you cleaned after shooting). null sinceDate = count all.
function roundsSinceDate(gun, sinceDate) {
  return data.sessions.reduce((sum, s) => {
    if (sinceDate && s.date <= sinceDate) return sum;
    const r = s.rounds && typeof s.rounds === 'object' ? s.rounds[gun.id] || 0 : 0;
    return sum + r;
  }, 0);
}

// Rounds since clean = sum of session rounds for this gun where session.date > lastDeepCleanDate
// Same-day sessions don't count (assumes you cleaned after shooting)
function computeRoundsSinceClean(gun) {
  return roundsSinceDate(gun, lastDeepCleanDate(gun));
}

// Rounds since the last cleaning of any kind (quick, deep, or detail)
function computeRoundsSinceQuickClean(gun) {
  return roundsSinceDate(gun, lastAnyCleanDate(gun));
}

function cleanStatus(gun) {
  const rsc = computeRoundsSinceClean(gun);
  const pct = gun.cleanThreshold > 0 ? rsc / gun.cleanThreshold : 0;
  if (pct >= 1) return { label: `${rsc} / ${gun.cleanThreshold}`, cls: 'due', barColor: '#c0392b', pct: 1, rsc };
  if (pct >= 0.75) return { label: `${rsc} / ${gun.cleanThreshold}`, cls: 'warn', barColor: '#e67e22', pct, rsc };
  return { label: `${rsc} / ${gun.cleanThreshold}`, cls: 'ok', barColor: '#27ae60', pct, rsc };
}

// ── RENDER DASHBOARD ──────────────────────────────────────────────
// ── DEMO MODE ─────────────────────────────────────────────────────
function renderDemoBanner() {
  const container = document.getElementById('demo-banner-container');
  if (!container) return;
  if (!data.isDemo) { container.innerHTML = ''; return; }
  container.innerHTML = `
    <div class="demo-banner">
      <div class="demo-banner-title">📋 Demo Mode</div>
      <div class="demo-banner-text">
        You're viewing sample data so you can explore the app. Clear it to start fresh with your own firearms, or keep it and edit it into your real setup.
      </div>
      <div class="demo-banner-actions">
        <button class="btn-demo btn-demo-keep" onclick="keepDemoData()">Keep This Data</button>
        <button class="btn-demo btn-demo-clear" onclick="clearDemoData()">Clear &amp; Start Fresh</button>
      </div>
    </div>
  `;
}

function keepDemoData() {
  data.isDemo = false;
  save(data);
  renderDemoBanner();
}

function wipeAllData() {
  data = {
    schemaVersion: SCHEMA_VERSION,
    isDemo: false,
    firearms: [],
    locations: [],
    sellers: [],
    sessions: [],
    ammo: [],
  };
  save(data);
  // Without this every photo blob survives the wipe, unreachable and invisible — the app
  // looks empty while still holding every image it ever stored.
  clearAllPhotos();
  renderAll();
}

function clearDemoData() {
  if (!confirm('This will permanently delete all sample data (firearms, sessions, ammo, everything) and start you with a blank app. This cannot be undone. Continue?')) return;
  wipeAllData();
}

// ── DELETE ALL DATA (Settings, type-to-confirm) ────────────────────
function openDeleteAllModal() {
  const input = document.getElementById('delete-all-confirm-input');
  input.value = '';
  updateDeleteAllButtonState();
  openModal('modal-delete-all');
  setTimeout(() => input.focus(), 50);
}

function updateDeleteAllButtonState() {
  const input = document.getElementById('delete-all-confirm-input');
  const btn = document.getElementById('delete-all-confirm-btn');
  const match = input.value === 'DELETE';
  btn.style.opacity = match ? '1' : '0.4';
  btn.style.pointerEvents = match ? 'auto' : 'none';
}

function checkDeleteAllInput() {
  updateDeleteAllButtonState();
}

function confirmDeleteAll() {
  const input = document.getElementById('delete-all-confirm-input');
  if (input.value !== 'DELETE') return;
  wipeAllData();
  closeModal('modal-delete-all');
  alert('All data deleted.');
}

function renderDashboard() {
  renderDemoBanner();
  const stats = document.getElementById('summary-stats');
  stats.innerHTML = `
    <div class="stat-box">
      <div class="stat-number">${totalRoundsAll().toLocaleString()}</div>
      <div class="stat-label">Total Rounds</div>
    </div>
    <div class="stat-box">
      <div class="stat-number">${totalSessions()}</div>
      <div class="stat-label">Sessions</div>
    </div>
    <div class="stat-box">
      <div class="stat-number">${data.firearms.length}</div>
      <div class="stat-label">Firearms</div>
    </div>
  `;

  const cards = document.getElementById('gun-cards');
  if (!data.firearms.length) {
    cards.innerHTML = '<div class="empty-state">No firearms added yet.</div>';
    return;
  }
  cards.innerHTML = data.firearms.map(gun => {
    const cs = cleanStatus(gun);
    const cardCls = cs.pct >= 1 ? 'needs-clean' : cs.pct >= 0.75 ? 'warn-clean' : 'clean';
    const lastDeep = lastDeepCleanDate(gun);
    const lastCleanedStr = lastDeep ? `Last deep clean ${fmtDate(lastDeep)}` : 'No deep clean logged';
    return `
      <div class="gun-card ${cardCls}">
        <div>
          <div class="gun-name-row">
            ${typeIconSVG(gun.type, 22)}
            <div class="gun-name">${gun.name}</div>
          </div>
          <div class="gun-caliber">${gunCaliberLabel(gun)}</div>
          <div class="gun-stats">All-time <span>${(gun.totalRounds||0).toLocaleString()} rds</span> &nbsp;·&nbsp; ${lastCleanedStr}</div>
          <div class="clean-bar"><div class="clean-bar-fill" style="width:${Math.min(cs.pct*100,100)}%;background:${cs.barColor}"></div></div>
        </div>
        <div>
          <div class="gun-total">${(gun.totalRounds||0).toLocaleString()}</div>
          <div class="gun-total-label">rounds</div>
          <div class="clean-status ${cs.cls}" style="margin-top:8px;">${cs.label}</div>
        </div>
        <div class="gun-card-actions">
          <button class="btn-clean" onclick="openLogCleaning('${gun.id}')">+ Log Cleaning</button>
          <button class="btn-clean" onclick="openGunHistory('${gun.id}')">View Details</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── RENDER LOG SESSION ────────────────────────────────────────────
function renderLogForm() {
  document.getElementById('session-date').value = today();

  const locSel = document.getElementById('session-location');
  locSel.innerHTML = '<option value="">— Select location —</option>' +
    data.locations.map(l => `<option value="${l.id}">${l.name}</option>`).join('');

  const gunInputs = document.getElementById('gun-inputs');
  gunInputs.innerHTML = data.firearms.map(gun => `
    <div class="gun-row">
      <div>
        <label>${gun.name}</label>
        <div class="caliber-tag">${gunCaliberLabel(gun)}</div>
      </div>
      <input type="number" id="rounds-${gun.id}" min="0" placeholder="0" value="">
    </div>
  `).join('');
}

function saveSession() {
  const date = document.getElementById('session-date').value;
  const locId = document.getElementById('session-location').value;
  const notes = document.getElementById('session-notes').value.trim();

  const rounds = {};
  let total = 0;
  data.firearms.forEach(gun => {
    const val = parseInt(document.getElementById('rounds-' + gun.id)?.value || '0', 10) || 0;
    if (val > 0) { rounds[gun.id] = val; total += val; }
  });

  if (!date) { alert('Please select a date.'); return; }
  if (total === 0) { alert('Enter at least one round count.'); return; }

  const session = {
    id: uid(),
    date,
    locationId: locId || null,
    rounds,
    notes,
    totalRounds: total,
    createdAt: new Date().toISOString()
  };

  data.sessions.unshift(session);

  // Update firearm totals only — roundsSinceClean is now computed from session history
  data.firearms.forEach(gun => {
    const r = rounds[gun.id] || 0;
    gun.totalRounds = (gun.totalRounds || 0) + r;
  });

  save(data);
  document.getElementById('session-notes').value = '';
  data.firearms.forEach(gun => {
    const el = document.getElementById('rounds-' + gun.id);
    if (el) el.value = '';
  });

  alert('Session saved!');
  showTab('dashboard');
}

// ── RENDER SESSIONS ───────────────────────────────────────────────
function renderSessions() {
  const el = document.getElementById('sessions-list');
  if (!data.sessions.length) {
    el.innerHTML = '<div class="empty-state">No sessions logged yet.</div>';
    return;
  }
  const sorted = [...data.sessions].sort((a,b) => b.date.localeCompare(a.date));
  el.innerHTML = sorted.map(s => {
    const loc = data.locations.find(l => l.id === s.locationId);
    const rounds = s.rounds && typeof s.rounds === 'object' ? s.rounds : {};
    const pills = Object.entries(rounds).map(([gid, r]) => {
      const gun = data.firearms.find(g => g.id === gid);
      return `<div class="session-gun-pill">${gun ? gun.name : 'Unknown'} <span>${r}</span></div>`;
    }).join('');
    return `
      <div class="session-card">
        <div class="session-header">
          <div class="session-date">${fmtDate(s.date)}</div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="session-total">${s.totalRounds} rds</div>
            <button class="btn-icon" onclick="openEditSession('${s.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="deleteSession('${s.id}')" title="Delete">🗑</button>
          </div>
        </div>
        ${s.locationId ? `<div class="session-location">${loc ? loc.name : 'Unknown location'}</div>` : ''}
        <div class="session-rounds">${pills}</div>
        ${s.notes ? `<div class="session-notes">${s.notes}</div>` : ''}
        ${sessionScorecard(s.id)}
      </div>
    `;
  }).join('');
}

// Groups shot at a given session, newest first, with the firearm they belong to.
function groupsForSession(sessionId) {
  const out = [];
  (data.firearms || []).forEach(gun => {
    (gun.groups || []).forEach(g => {
      if (g.sessionId === sessionId) out.push({ gun, group: g });
    });
  });
  return out;
}

// A compact read of how the shooting actually went, shown inline on the session it
// belongs to. Everything here is recomputed from the marked points, never stored.
function sessionScorecard(sessionId) {
  const rows = groupsForSession(sessionId)
    .map(({ gun, group }) => {
      const size = groupSizeInches(group);
      const dIn = groupDistanceInches(group);
      return { gun, group, moa: size != null ? toMOA(size, dIn) : null };
    })
    .filter(r => r.moa != null)
    .sort((a, b) => a.moa - b.moa);

  if (!rows.length) return '';

  const best = rows[0].moa;
  const avg = rows.reduce((s, r) => s + r.moa, 0) / rows.length;
  // Beyond about a dozen rows the detail stops being scannable, so collapse to the
  // headline figures and let the firearm's own Details view carry the specifics.
  const DETAIL_LIMIT = 12;

  // Two lines per row rather than five columns — at phone width a single row would push
  // the MOA figure off the card, and that's the number worth reading.
  const detail = rows.length <= DETAIL_LIMIT ? rows.map(r => {
    const sub = [r.group.ammo, `${r.group.distance} ${r.group.distanceUnit || 'yd'}`,
                 `${(r.group.impacts || []).length} shots`].filter(Boolean).join(' · ');
    return `
      <div class="scorecard-row">
        <div class="scorecard-main">
          <div class="scorecard-gun">${r.gun.name}</div>
          <div class="scorecard-sub">${sub}</div>
        </div>
        <div class="scorecard-moa ${r.moa === best ? 'best' : ''}">${gFmt(r.moa)}<span> MOA</span></div>
      </div>`;
  }).join('') : `
    <div class="scorecard-more">${rows.length} groups &mdash; open a firearm's Details to see each one.</div>`;

  return `
    <div class="scorecard">
      <div class="scorecard-head">
        <span>Groups this session</span>
        <span class="scorecard-figs">best ${gFmt(best)} &middot; avg ${gFmt(avg)} MOA</span>
      </div>
      ${detail}
    </div>`;
}

// ── SETTINGS ──────────────────────────────────────────────────────
function renderSettings() {
  renderPhotoStorage();
  const gl = document.getElementById('guns-settings-list');
  gl.innerHTML = data.firearms.map((gun, idx) => {
    const isFirst = idx === 0;
    const isLast = idx === data.firearms.length - 1;
    return `
    <div class="list-item">
      <div class="reorder-controls">
        <button class="btn-icon reorder-btn" onclick="moveGun('${gun.id}', -1)" title="Move up" ${isFirst ? 'disabled' : ''}>▲</button>
        <button class="btn-icon reorder-btn" onclick="moveGun('${gun.id}', 1)" title="Move down" ${isLast ? 'disabled' : ''}>▼</button>
      </div>
      ${typeIconSVG(gun.type, 20)}
      <div class="list-item-text">
        <div class="list-item-name">${gun.name}</div>
        <div class="list-item-sub">${gunCaliberLabel(gun)} · Clean every ${gun.cleanThreshold} rds</div>
      </div>
      <button class="btn-icon" onclick="openEditGun('${gun.id}')" title="Edit">✏️</button>
      <button class="btn-icon" onclick="deleteGun('${gun.id}')" title="Delete">🗑</button>
    </div>
    `;
  }).join('') || '<div class="empty-state">No firearms.</div>';

  const ll = document.getElementById('locations-settings-list');
  ll.innerHTML = data.locations.map(loc => `
    <div class="list-item">
      <div class="list-item-text">
        <div class="list-item-name">${loc.name}</div>
      </div>
      <button class="btn-icon" onclick="deleteLocation('${loc.id}')" title="Delete">🗑</button>
    </div>
  `).join('') || '<div class="empty-state">No locations.</div>';

  const sl = document.getElementById('sellers-settings-list');
  const sellers = data.sellers || [];
  sl.innerHTML = sellers.map(seller => `
    <div class="list-item">
      <div class="list-item-text">
        <div class="list-item-name">${seller.name}</div>
      </div>
      <button class="btn-icon" onclick="deleteSeller('${seller.id}')" title="Delete">🗑</button>
    </div>
  `).join('') || '<div class="empty-state">No sellers.</div>';
}

// ── GUN CRUD ──────────────────────────────────────────────────────
let gunModalCalibers = []; // working set while modal is open

function renderGunCalibersChips() {
  const container = document.getElementById('gun-calibers-chips');
  if (!gunModalCalibers.length) {
    container.innerHTML = '<div class="chips-empty">NO CALIBERS SELECTED</div>';
  } else {
    container.innerHTML = gunModalCalibers.map((c, i) =>
      `<span class="chip">${c}<span class="remove-x" onclick="removeGunCaliber(${i})">×</span></span>`
    ).join('');
  }
  // Repopulate the add-select excluding already-added
  const sel = document.getElementById('gun-caliber-add-select');
  const known = allKnownCalibers().filter(c => !gunModalCalibers.some(x => x.trim().toLowerCase() === c.trim().toLowerCase()));
  sel.innerHTML =
    '<option value="">— Add caliber —</option>' +
    known.map(c => `<option value="${c}">${c}</option>`).join('') +
    '<option value="__new__">+ New caliber...</option>';
  // Reset custom input
  document.getElementById('gun-caliber-custom').style.display = 'none';
  document.getElementById('gun-caliber-custom').value = '';
}

function removeGunCaliber(idx) {
  gunModalCalibers.splice(idx, 1);
  renderGunCalibersChips();
}

function addGunCaliberFromSelect() {
  const sel = document.getElementById('gun-caliber-add-select');
  const custom = document.getElementById('gun-caliber-custom');
  let val = sel.value;
  if (val === '__new__') {
    val = custom.value.trim();
    if (!val) { custom.style.display = 'block'; custom.focus(); return; }
  }
  if (!val) return;
  if (gunModalCalibers.some(c => c.trim().toLowerCase() === val.trim().toLowerCase())) return;
  gunModalCalibers.push(val);
  renderGunCalibersChips();
}

// Show custom input when "+ New caliber..." picked
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'gun-caliber-add-select') {
    const custom = document.getElementById('gun-caliber-custom');
    if (e.target.value === '__new__') {
      custom.style.display = 'block';
      custom.focus();
    } else {
      custom.style.display = 'none';
      custom.value = '';
    }
  }
});

function openAddGun() {
  document.getElementById('modal-gun-title').textContent = 'Add Firearm';
  document.getElementById('gun-edit-id').value = '';
  document.getElementById('gun-name').value = '';
  document.getElementById('gun-type').value = '';
  document.getElementById('gun-threshold').value = '';
  document.getElementById('gun-notes').value = '';
  gunModalCalibers = [];
  renderGunCalibersChips();
  openModal('modal-gun');
}
function openEditGun(id) {
  const gun = data.firearms.find(g => g.id === id);
  if (!gun) return;
  document.getElementById('modal-gun-title').textContent = 'Edit Firearm';
  document.getElementById('gun-edit-id').value = id;
  document.getElementById('gun-name').value = gun.name;
  document.getElementById('gun-type').value = gun.type || '';
  document.getElementById('gun-threshold').value = gun.cleanThreshold;
  document.getElementById('gun-notes').value = gun.notes || '';
  gunModalCalibers = [...gunCalibers(gun)];
  renderGunCalibersChips();
  openModal('modal-gun');
}
function saveGun() {
  const id = document.getElementById('gun-edit-id').value;
  const name = document.getElementById('gun-name').value.trim();
  const type = document.getElementById('gun-type').value || null;
  const threshold = parseInt(document.getElementById('gun-threshold').value, 10);
  const notes = document.getElementById('gun-notes').value.trim();
  const calibers = [...gunModalCalibers];
  if (!name) { alert('Please enter a name.'); return; }
  if (!calibers.length) { alert('Please add at least one caliber.'); return; }
  if (!threshold) { alert('Please set a clean threshold.'); return; }
  if (id) {
    const gun = data.firearms.find(g => g.id === id);
    if (gun) { gun.name = name; gun.type = type; gun.calibers = calibers; gun.cleanThreshold = threshold; gun.notes = notes; delete gun.caliber; }
  } else {
    data.firearms.push({ id: uid(), name, type, calibers, cleanThreshold: threshold, notes, totalRounds: 0, cleanings: [], zeros: [], groups: [] });
  }
  save(data);
  closeModal('modal-gun');
  renderAll();
}
function deleteGun(id) {
  if (!confirm('Delete this firearm? Round history in sessions will remain.')) return;
  data.firearms = data.firearms.filter(g => g.id !== id);
  save(data);
  renderAll();
}
function moveGun(id, direction) {
  const idx = data.firearms.findIndex(g => g.id === id);
  if (idx < 0) return;
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= data.firearms.length) return;
  const [moved] = data.firearms.splice(idx, 1);
  data.firearms.splice(newIdx, 0, moved);
  save(data);
  renderSettings();
  renderDashboard();
}
// ── CLEANING CRUD ─────────────────────────────────────────────────
function openLogCleaning(gunId, cleaningId) {
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  document.getElementById('cleaning-gun-id').value = gunId;
  document.getElementById('cleaning-edit-id').value = cleaningId || '';
  document.getElementById('cleaning-modal-title').textContent =
    (cleaningId ? 'Edit Cleaning · ' : 'Log Cleaning · ') + gun.name;

  if (cleaningId) {
    const c = (gun.cleanings || []).find(c => c.id === cleaningId);
    if (c) {
      document.getElementById('cleaning-date').value = c.date;
      document.getElementById('cleaning-type').value = c.type;
      document.getElementById('cleaning-notes').value = c.notes || '';
    }
  } else {
    document.getElementById('cleaning-date').value = today();
    document.getElementById('cleaning-type').value = 'deep';
    document.getElementById('cleaning-notes').value = '';
  }
  if (document.getElementById('modal-history').classList.contains('open')) {
    restoreHistoryGunId = gunId;
    closeModal('modal-history');
  }
  openModal('modal-cleaning');
}

function saveCleaning() {
  const gunId = document.getElementById('cleaning-gun-id').value;
  const editId = document.getElementById('cleaning-edit-id').value;
  const date = document.getElementById('cleaning-date').value;
  const type = document.getElementById('cleaning-type').value;
  const notes = document.getElementById('cleaning-notes').value.trim();
  if (!date || !type) { alert('Please select a date and cleaning type.'); return; }

  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  if (!Array.isArray(gun.cleanings)) gun.cleanings = [];

  if (editId) {
    const c = gun.cleanings.find(c => c.id === editId);
    if (c) { c.date = date; c.type = type; c.notes = notes; }
  } else {
    gun.cleanings.push({ id: uid(), date, type, notes });
  }
  save(data);
  closeModal('modal-cleaning');
  renderDashboard();
}

function deleteCleaning(gunId, cleaningId) {
  if (!confirm('Delete this cleaning entry?')) return;
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  gun.cleanings = (gun.cleanings || []).filter(c => c.id !== cleaningId);
  save(data);
  if (currentHistoryGunId === gunId) renderGunHistory(gunId);
  renderDashboard();
}

let currentHistoryGunId = null;
function openGunHistory(gunId) {
  currentHistoryGunId = gunId;
  renderGunHistory(gunId);
  openModal('modal-history');
}

function renderGunHistory(gunId) {
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  document.getElementById('history-title').innerHTML = typeIconSVG(gun.type, 26) + gun.name + ' · Details';

  const rsc = computeRoundsSinceClean(gun);
  const lastDeep = lastDeepCleanDate(gun);
  const rsq = computeRoundsSinceQuickClean(gun);
  const lastQuick = lastAnyCleanDate(gun);
  document.getElementById('history-stats').innerHTML = `
    <div class="cleaning-meta">All-time: <span style="color:var(--text)">${(gun.totalRounds||0).toLocaleString()} rds</span></div>
    <div class="cleaning-meta" style="margin-top:4px;">
      Since deep clean: <span style="color:var(--text)">${rsc} rds</span>${lastDeep ? ` <span style="color:var(--text-dim)">(${fmtDate(lastDeep)})</span>` : ''}
    </div>
    <div class="cleaning-meta" style="margin-top:4px;">
      Since quick clean: <span style="color:var(--text)">${rsq} rds</span>${lastQuick ? ` <span style="color:var(--text-dim)">(${fmtDate(lastQuick)})</span>` : ''}
    </div>
  `;

  document.getElementById('history-notes').innerHTML = gun.notes
    ? `<div class="gun-notes-block">${gun.notes}</div>`
    : '';

  // Cleanings list
  const cleanings = [...(gun.cleanings || [])].sort((a,b) => b.date.localeCompare(a.date));
  const cList = document.getElementById('history-cleanings-list');
  if (!cleanings.length) {
    cList.innerHTML = '<div class="empty-state" style="padding:16px;">No cleanings logged yet.</div>';
  } else {
    cList.innerHTML = cleanings.map(c => {
      const typeLabel = CLEANING_TYPES[c.type]?.label || c.type;
      return `
        <div class="cleaning-row">
          <div class="cleaning-type-badge ${c.type}">${typeLabel}</div>
          <div>
            <div class="cleaning-meta-date">${fmtDate(c.date)}</div>
            ${c.notes ? `<div class="cleaning-meta-notes">${c.notes}</div>` : ''}
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn-icon" onclick="openLogCleaning('${gunId}','${c.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="deleteCleaning('${gunId}','${c.id}')" title="Delete">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Zeros list
  const zeros = [...(gun.zeros || [])].sort((a,b) => b.date.localeCompare(a.date));
  const zList = document.getElementById('history-zeros-list');
  if (!zeros.length) {
    zList.innerHTML = '<div class="empty-state" style="padding:16px;">No zeros recorded yet.</div>';
  } else {
    zList.innerHTML = zeros.map(z => {
      const distLabel = z.distance ? `${z.distance} ${z.distanceUnit || 'yd'}` : '—';
      const subParts = [];
      if (z.ammo) subParts.push(z.ammo);
      if (z.optic) subParts.push(z.optic);
      return `
        <div class="cleaning-row">
          <div class="cleaning-type-badge zero">${distLabel}</div>
          <div>
            <div class="cleaning-meta-date">${fmtDate(z.date)}${subParts.length ? ' · ' : ''}<span style="color:var(--text-muted);font-weight:normal;">${subParts.join(' · ')}</span></div>
            ${z.notes ? `<div class="cleaning-meta-notes">${z.notes}</div>` : ''}
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn-icon" onclick="openLogZero('${gunId}','${z.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="deleteZero('${gunId}','${z.id}')" title="Delete">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Groups list — sizes recomputed from the marked points on every render.
  const groups = [...(gun.groups || [])].sort((a, b) => b.date.localeCompare(a.date));
  const grList = document.getElementById('history-groups-list');
  if (!groups.length) {
    grList.innerHTML = '<div class="empty-state" style="padding:16px;">No groups recorded yet.</div>';
  } else {
    grList.innerHTML = groups.map(g => {
      const size = groupSizeInches(g);
      const dIn = groupDistanceInches(g);
      const moa = size != null ? toMOA(size, dIn) : null;
      // MOA leads here: these rows sit side by side across different distances, and
      // inches aren't comparable between them. Inches drops to the secondary line —
      // unless the distance is missing, in which case it's all we can honestly show.
      const primary = moa != null ? `${gFmt(moa)} MOA`
        : size != null ? `${gFmt(size)}"` : '—';
      const secondary = (moa != null && size != null) ? `${gFmt(size)}"` : '';
      const sub = [`${g.distance} ${g.distanceUnit || 'yd'}`, `${(g.impacts || []).length} shots`];
      if (g.ammo) sub.push(g.ammo);
      const tagLine = (g.tags || []).length
        ? `<div class="group-row-tags">${g.tags.map(t => `<span class="tag-pill">${t}</span>`).join('')}</div>`
        : '';
      return `
        <div class="group-row tappable" onclick="openViewGroup('${gunId}','${g.id}')"
             role="button" tabindex="0" title="View this group">
          <div>
            <div class="group-row-main">${fmtDate(g.date)}</div>
            <div class="group-row-sub">${sub.join(' · ')}${g.photoId ? ' · 📷' : ''}</div>
            ${tagLine}
          </div>
          <div style="text-align:right;">
            <div class="group-row-size">${primary}</div>
            <div class="group-row-sub">${secondary}</div>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn-icon" onclick="event.stopPropagation(); openLogGroup('${gunId}','${g.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="event.stopPropagation(); deleteGroup('${gunId}','${g.id}')" title="Delete">🗑</button>
          </div>
        </div>
      `;
    }).join('');
  }
}

// ── ZERO CRUD ─────────────────────────────────────────────────────
// Build the ammo label from a purchase entry
function ammoDisplayLabel(a) {
  return [a.manufacturer, a.model].filter(Boolean).join(' ') || '(unnamed)';
}

// Populate an ammo dropdown for a gun, scoped to that gun's calibers. Shared by the
// zero and group modals — they differ only in which elements they write into.
function populateAmmoDropdown(gun, selectedAmmoText, selectId, customId) {
  const sel = document.getElementById(selectId);
  const custom = document.getElementById(customId);
  const calibers = gunCalibers(gun).map(c => c.trim().toLowerCase());
  const ammoAll = (data.ammo || []).filter(a => calibers.includes((a.caliber || '').trim().toLowerCase()));

  const inStock = ammoAll
    .filter(a => (a.status || 'instock') === 'instock')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const usedUp = ammoAll
    .filter(a => (a.status || 'instock') === 'usedup')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Collect free-text entries from any zero or group whose text doesn't match a purchase label
  const purchaseLabels = new Set((data.ammo || []).map(a => ammoDisplayLabel(a)));
  const textOnlySet = new Set();
  (data.firearms || []).forEach(g => {
    [...(g.zeros || []), ...(g.groups || [])].forEach(entry => {
      if (entry.ammo && !purchaseLabels.has(entry.ammo)) textOnlySet.add(entry.ammo);
    });
  });
  const textOnly = [...textOnlySet].sort();

  let html = '<option value="">— Select ammo —</option>';
  if (inStock.length) {
    html += '<optgroup label="In stock">';
    inStock.forEach(a => {
      const label = ammoDisplayLabel(a);
      const sel = label === selectedAmmoText ? ' selected' : '';
      html += `<option value="${label.replace(/"/g, '&quot;')}"${sel}>${label}</option>`;
    });
    html += '</optgroup>';
  }
  if (usedUp.length) {
    html += '<optgroup label="Used up">';
    usedUp.forEach(a => {
      const label = ammoDisplayLabel(a);
      const sel = label === selectedAmmoText ? ' selected' : '';
      html += `<option value="${label.replace(/"/g, '&quot;')}"${sel}>${label}</option>`;
    });
    html += '</optgroup>';
  }
  if (textOnly.length) {
    html += '<optgroup label="◇ Text-only (from past entries)">';
    textOnly.forEach(t => {
      const sel = t === selectedAmmoText ? ' selected' : '';
      html += `<option value="${t.replace(/"/g, '&quot;')}"${sel}>${t}</option>`;
    });
    html += '</optgroup>';
  }
  html += '<option value="__custom__">+ Custom...</option>';
  sel.innerHTML = html;

  // If selected value doesn't match any option, use custom
  if (selectedAmmoText && sel.value !== selectedAmmoText) {
    sel.value = '__custom__';
    custom.value = selectedAmmoText;
    custom.style.display = 'block';
  } else {
    custom.value = '';
    custom.style.display = 'none';
  }
}

function handleAmmoSelectChange(selectId, customId) {
  const sel = document.getElementById(selectId);
  const custom = document.getElementById(customId);
  if (sel.value === '__custom__') {
    custom.style.display = 'block';
    custom.focus();
  } else {
    custom.style.display = 'none';
    custom.value = '';
  }
}

function getSelectedAmmo(selectId, customId) {
  const sel = document.getElementById(selectId);
  if (sel.value === '__custom__') return document.getElementById(customId).value.trim();
  return sel.value.trim();
}

// Zero-modal wrappers over the shared helpers above.
function populateZeroAmmoDropdown(gun, selectedAmmoText) {
  populateAmmoDropdown(gun, selectedAmmoText, 'zero-ammo-select', 'zero-ammo-custom');
}
function handleZeroAmmoSelectChange() {
  handleAmmoSelectChange('zero-ammo-select', 'zero-ammo-custom');
}
function getSelectedZeroAmmo() {
  return getSelectedAmmo('zero-ammo-select', 'zero-ammo-custom');
}

// Populate optic dropdown from that gun's past zero optics
function populateZeroOpticDropdown(gun, selectedOptic) {
  const sel = document.getElementById('zero-optic-select');
  const custom = document.getElementById('zero-optic-custom');
  const optics = [...new Set((gun.zeros || []).map(z => z.optic).filter(Boolean))].sort();
  let html = '<option value="">— Select optic —</option>';
  optics.forEach(o => {
    const s = o === selectedOptic ? ' selected' : '';
    html += `<option value="${o.replace(/"/g, '&quot;')}"${s}>${o}</option>`;
  });
  html += '<option value="__custom__">+ Custom...</option>';
  sel.innerHTML = html;
  if (selectedOptic && sel.value !== selectedOptic) {
    sel.value = '__custom__';
    custom.value = selectedOptic;
    custom.style.display = 'block';
  } else {
    custom.value = '';
    custom.style.display = 'none';
  }
}

function handleZeroOpticSelectChange() {
  const sel = document.getElementById('zero-optic-select');
  const custom = document.getElementById('zero-optic-custom');
  if (sel.value === '__custom__') {
    custom.style.display = 'block';
    custom.focus();
  } else {
    custom.style.display = 'none';
    custom.value = '';
  }
}

function getSelectedZeroOptic() {
  const sel = document.getElementById('zero-optic-select');
  if (sel.value === '__custom__') return document.getElementById('zero-optic-custom').value.trim();
  return sel.value.trim();
}

function openLogZero(gunId, zeroId) {
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  document.getElementById('zero-gun-id').value = gunId;
  document.getElementById('zero-edit-id').value = zeroId || '';
  document.getElementById('zero-modal-title').textContent =
    (zeroId ? 'Edit Zero · ' : 'Add Zero · ') + gun.name;

  let existingAmmo = '';
  let existingOptic = '';
  if (zeroId) {
    const z = (gun.zeros || []).find(x => x.id === zeroId);
    if (z) {
      document.getElementById('zero-date').value = z.date;
      document.getElementById('zero-distance').value = z.distance || '';
      document.getElementById('zero-distance-unit').value = z.distanceUnit || 'yd';
      document.getElementById('zero-notes').value = z.notes || '';
      existingAmmo = z.ammo || '';
      existingOptic = z.optic || '';
    }
  } else {
    document.getElementById('zero-date').value = today();
    document.getElementById('zero-distance').value = '';
    document.getElementById('zero-distance-unit').value = 'yd';
    document.getElementById('zero-notes').value = '';
  }
  populateZeroAmmoDropdown(gun, existingAmmo);
  populateZeroOpticDropdown(gun, existingOptic);
  if (document.getElementById('modal-history').classList.contains('open')) {
    restoreHistoryGunId = gunId;
    closeModal('modal-history');
  }
  openModal('modal-zero');
}

function saveZero() {
  const gunId = document.getElementById('zero-gun-id').value;
  const editId = document.getElementById('zero-edit-id').value;
  const date = document.getElementById('zero-date').value;
  const distance = parseFloat(document.getElementById('zero-distance').value) || null;
  const distanceUnit = document.getElementById('zero-distance-unit').value;
  const ammo = getSelectedZeroAmmo();
  const optic = getSelectedZeroOptic();
  const notes = document.getElementById('zero-notes').value.trim();
  if (!date) { alert('Please select a date.'); return; }
  if (!distance) { alert('Please enter a distance.'); return; }

  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  if (!Array.isArray(gun.zeros)) gun.zeros = [];

  if (editId) {
    const z = gun.zeros.find(x => x.id === editId);
    if (z) { z.date = date; z.distance = distance; z.distanceUnit = distanceUnit; z.ammo = ammo; z.optic = optic; z.notes = notes; }
  } else {
    gun.zeros.push({ id: uid(), date, distance, distanceUnit, ammo, optic, notes });
  }
  save(data);
  closeModal('modal-zero');
}

function deleteZero(gunId, zeroId) {
  if (!confirm('Delete this zero entry?')) return;
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  gun.zeros = (gun.zeros || []).filter(z => z.id !== zeroId);
  save(data);
  if (currentHistoryGunId === gunId) renderGunHistory(gunId);
}

// ── SESSION EDIT / DELETE ─────────────────────────────────────────
function openEditSession(id) {
  const s = data.sessions.find(s => s.id === id);
  if (!s) return;

  document.getElementById('session-edit-id').value = id;
  document.getElementById('session-edit-date').value = s.date;
  document.getElementById('session-edit-notes').value = s.notes || '';

  const locSel = document.getElementById('session-edit-location');
  locSel.innerHTML = '<option value="">— Select location —</option>' +
    data.locations.map(l => `<option value="${l.id}" ${l.id === s.locationId ? 'selected' : ''}>${l.name}</option>`).join('');

  const sessionRounds = s.rounds && typeof s.rounds === 'object' ? s.rounds : {};
  const gunInputs = document.getElementById('session-edit-gun-inputs');
  gunInputs.innerHTML = data.firearms.map(gun => `
    <div class="gun-row">
      <div>
        <label>${gun.name}</label>
        <div class="caliber-tag">${gunCaliberLabel(gun)}</div>
      </div>
      <input type="number" id="edit-rounds-${gun.id}" min="0" placeholder="0" value="${sessionRounds[gun.id] || ''}">
    </div>
  `).join('');

  openModal('modal-session');
}

function saveEditSession() {
  const id = document.getElementById('session-edit-id').value;
  const s = data.sessions.find(s => s.id === id);
  if (!s) return;

  const date = document.getElementById('session-edit-date').value;
  const locId = document.getElementById('session-edit-location').value;
  const notes = document.getElementById('session-edit-notes').value.trim();

  const newRounds = {};
  let total = 0;
  data.firearms.forEach(gun => {
    const val = parseInt(document.getElementById('edit-rounds-' + gun.id)?.value || '0', 10) || 0;
    if (val > 0) { newRounds[gun.id] = val; total += val; }
  });

  if (!date) { alert('Please select a date.'); return; }
  if (total === 0) { alert('Enter at least one round count.'); return; }

  // Reverse old round counts from firearm totals, apply new ones
  // roundsSinceClean is computed, so no need to track it manually
  const oldRounds = s.rounds && typeof s.rounds === 'object' ? s.rounds : {};
  data.firearms.forEach(gun => {
    const oldR = oldRounds[gun.id] || 0;
    const newR = newRounds[gun.id] || 0;
    const diff = newR - oldR;
    gun.totalRounds = Math.max(0, (gun.totalRounds || 0) + diff);
  });

  s.date = date;
  s.locationId = locId || null;
  s.notes = notes;
  s.rounds = newRounds;
  s.totalRounds = total;

  save(data);
  closeModal('modal-session');
  renderSessions();
  renderDashboard();
}

function deleteSession(id) {
  const s = data.sessions.find(s => s.id === id);
  if (!s) return;
  if (!confirm('Delete this session? Firearm round counts will be adjusted.')) return;

  // Reverse round counts (only totalRounds; roundsSinceClean is computed)
  const delRounds = s.rounds && typeof s.rounds === 'object' ? s.rounds : {};
  data.firearms.forEach(gun => {
    const r = delRounds[gun.id] || 0;
    gun.totalRounds = Math.max(0, (gun.totalRounds || 0) - r);
  });

  // Unlink any groups that pointed here, rather than leaving them referencing a session
  // that no longer exists. The groups themselves are kept — they're independent records.
  let unlinked = 0;
  data.firearms.forEach(gun => {
    (gun.groups || []).forEach(g => {
      if (g.sessionId === id) { g.sessionId = null; unlinked++; }
    });
  });

  data.sessions = data.sessions.filter(s => s.id !== id);
  save(data);
  if (unlinked) {
    alert(`${unlinked} group${unlinked > 1 ? 's are' : ' is'} no longer linked to a session. ` +
          `The group${unlinked > 1 ? 's' : ''} and all measurements are unchanged.`);
  }
  renderSessions();
  renderDashboard();
}

// ── LOCATION CRUD ─────────────────────────────────────────────────
function openAddLocation() {
  document.getElementById('loc-edit-id').value = '';
  document.getElementById('loc-name').value = '';
  openModal('modal-location');
}
function saveLocation() {
  const name = document.getElementById('loc-name').value.trim();
  if (!name) { alert('Enter a location name.'); return; }
  data.locations.push({ id: uid(), name });
  save(data);
  closeModal('modal-location');
  renderSettings();
}
function deleteLocation(id) {
  if (!confirm('Remove this location? Past sessions will retain a reference but show as Unknown.')) return;
  data.locations = data.locations.filter(l => l.id !== id);
  save(data);
  renderSettings();
}

// ── SELLER CRUD ───────────────────────────────────────────────────
function openAddSeller() {
  document.getElementById('seller-edit-id').value = '';
  document.getElementById('seller-name').value = '';
  openModal('modal-seller');
}
function saveSeller() {
  const name = document.getElementById('seller-name').value.trim();
  if (!name) { alert('Enter a seller name.'); return; }
  if (!Array.isArray(data.sellers)) data.sellers = [];
  data.sellers.push({ id: uid(), name });
  save(data);
  closeModal('modal-seller');
  renderSettings();
}
function deleteSeller(id) {
  if (!confirm('Remove this seller? Past purchases will retain a reference but show as Unknown.')) return;
  data.sellers = (data.sellers || []).filter(s => s.id !== id);
  save(data);
  renderSettings();
}

// ── AMMO CRUD ─────────────────────────────────────────────────────
function populateAmmoSellerDropdown(selectedId) {
  const sel = document.getElementById('ammo-seller');
  const sellers = data.sellers || [];
  sel.innerHTML = '<option value="">— Not specified —</option>' +
    sellers.map(s => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${s.name}</option>`).join('');
}

function allKnownCalibers() {
  // Gather unique calibers from firearms and ammo history
  const set = new Set();
  (data.firearms || []).forEach(g => gunCalibers(g).forEach(c => { if (c) set.add(c.trim()); }));
  (data.ammo || []).forEach(a => { if (a.caliber) set.add(a.caliber.trim()); });
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

// Groups individual caliber tokens that always map to the exact same set of firearms
// into one dropdown entry (e.g. ".223 Rem" and "5.56 NATO" merge if every firearm that
// has one also has the other). Used only for the Rounds Fired filter, since that's the
// only place caliber selection maps to firearms rather than a single fixed ammo record.
function getMergedFirearmCalibers() {
  const tokenToGuns = {};
  data.firearms.forEach(gun => {
    gunCalibers(gun).forEach(c => {
      const key = c.trim();
      if (!key) return;
      if (!tokenToGuns[key]) tokenToGuns[key] = new Set();
      tokenToGuns[key].add(gun.id);
    });
  });

  const sigToTokens = {};
  const sigToGunIds = {};
  Object.entries(tokenToGuns).forEach(([token, gunSet]) => {
    const sig = [...gunSet].sort().join(',');
    if (!sigToTokens[sig]) { sigToTokens[sig] = []; sigToGunIds[sig] = gunSet; }
    sigToTokens[sig].push(token);
  });

  const groups = Object.keys(sigToTokens).map(sig => {
    const tokens = sigToTokens[sig].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return { tokens, value: tokens.join('||'), label: tokens.join(' / '), gunIds: sigToGunIds[sig] };
  });

  groups.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }));
  return groups;
}

function populateAmmoCaliberDropdown(selectedCaliber) {
  const sel = document.getElementById('ammo-caliber-select');
  const custom = document.getElementById('ammo-caliber-custom');
  const known = allKnownCalibers();
  const isKnown = selectedCaliber && known.includes(selectedCaliber);

  sel.innerHTML =
    '<option value="">— Select caliber —</option>' +
    known.map(c => `<option value="${c}"${c === selectedCaliber ? ' selected' : ''}>${c}</option>`).join('') +
    '<option value="__new__">+ New caliber...</option>';

  if (selectedCaliber && !isKnown) {
    // Editing an entry with a caliber not in the current list — treat as custom
    sel.value = '__new__';
    custom.value = selectedCaliber;
    custom.style.display = 'block';
  } else {
    custom.value = '';
    custom.style.display = 'none';
  }
}

function handleCaliberSelectChange() {
  const sel = document.getElementById('ammo-caliber-select');
  const custom = document.getElementById('ammo-caliber-custom');
  if (sel.value === '__new__') {
    custom.style.display = 'block';
    custom.focus();
  } else {
    custom.style.display = 'none';
    custom.value = '';
  }
}

function getSelectedCaliber() {
  const sel = document.getElementById('ammo-caliber-select');
  if (sel.value === '__new__') {
    return document.getElementById('ammo-caliber-custom').value.trim();
  }
  return sel.value.trim();
}

function openAddAmmo() {
  document.getElementById('ammo-modal-title').textContent = 'Log Ammo Purchase';
  document.getElementById('ammo-edit-id').value = '';
  document.getElementById('ammo-date').value = today();
  document.getElementById('ammo-manufacturer').value = '';
  document.getElementById('ammo-model').value = '';
  document.getElementById('ammo-quantity').value = '';
  document.getElementById('ammo-price').value = '';
  document.getElementById('ammo-status').value = 'instock';
  document.getElementById('ammo-notes').value = '';
  populateAmmoSellerDropdown('');
  populateAmmoCaliberDropdown('');
  openModal('modal-ammo');
}

function openEditAmmo(id) {
  const a = (data.ammo || []).find(x => x.id === id);
  if (!a) return;
  document.getElementById('ammo-modal-title').textContent = 'Edit Ammo Purchase';
  document.getElementById('ammo-edit-id').value = id;
  document.getElementById('ammo-date').value = a.date || '';
  document.getElementById('ammo-manufacturer').value = a.manufacturer || '';
  document.getElementById('ammo-model').value = a.model || '';
  document.getElementById('ammo-quantity').value = a.quantity || '';
  document.getElementById('ammo-price').value = a.totalPrice || '';
  document.getElementById('ammo-status').value = a.status || 'instock';
  document.getElementById('ammo-notes').value = a.notes || '';
  populateAmmoSellerDropdown(a.sellerId || '');
  populateAmmoCaliberDropdown(a.caliber || '');
  openModal('modal-ammo');
}

function saveAmmo() {
  const id = document.getElementById('ammo-edit-id').value;
  const date = document.getElementById('ammo-date').value;
  const caliber = getSelectedCaliber();
  const manufacturer = document.getElementById('ammo-manufacturer').value.trim();
  const model = document.getElementById('ammo-model').value.trim();
  const quantity = parseInt(document.getElementById('ammo-quantity').value, 10);
  const totalPrice = parseFloat(document.getElementById('ammo-price').value);
  const sellerId = document.getElementById('ammo-seller').value || null;
  const status = document.getElementById('ammo-status').value;
  const notes = document.getElementById('ammo-notes').value.trim();

  if (!date) { alert('Please select a date.'); return; }
  if (!caliber) { alert('Please select or enter a caliber.'); return; }
  if (!quantity || quantity <= 0) { alert('Please enter a valid quantity.'); return; }
  if (isNaN(totalPrice) || totalPrice < 0) { alert('Please enter a valid total price.'); return; }

  if (!Array.isArray(data.ammo)) data.ammo = [];
  if (id) {
    const a = data.ammo.find(x => x.id === id);
    if (a) Object.assign(a, { date, caliber, manufacturer, model, quantity, totalPrice, sellerId, status, notes });
  } else {
    data.ammo.push({ id: uid(), date, caliber, manufacturer, model, quantity, totalPrice, sellerId, status, notes });
  }
  save(data);
  closeModal('modal-ammo');
  renderAmmo();
}

function deleteAmmo(id) {
  if (!confirm('Delete this ammo purchase?')) return;
  data.ammo = (data.ammo || []).filter(a => a.id !== id);
  save(data);
  renderAmmo();
}

function toggleAmmoStatus(id) {
  const a = (data.ammo || []).find(x => x.id === id);
  if (!a) return;
  a.status = a.status === 'usedup' ? 'instock' : 'usedup';
  save(data);
  renderAmmo();
}

// ── AMMO RENDER ───────────────────────────────────────────────────
function renderAmmo() {
  const ammo = data.ammo || [];

  // Populate caliber filter dropdown (preserve current selection)
  const calSel = document.getElementById('ammo-filter-caliber');
  const currentCal = calSel.value;
  const calibers = [...new Set(ammo.map(a => a.caliber).filter(Boolean))].sort();
  calSel.innerHTML = '<option value="">All calibers</option>' +
    calibers.map(c => `<option value="${c}"${c === currentCal ? ' selected' : ''}>${c}</option>`).join('');

  const filterCal = calSel.value;
  const filterStock = document.getElementById('ammo-filter-stock').value;

  // Apply filters
  let filtered = ammo;
  if (filterCal) filtered = filtered.filter(a => a.caliber === filterCal);
  if (filterStock === 'instock') filtered = filtered.filter(a => (a.status || 'instock') === 'instock');

  // Stats
  const statsEl = document.getElementById('ammo-stats');
  if (!filtered.length) {
    statsEl.innerHTML = '';
  } else {
    const totalRounds = filtered.reduce((s, a) => s + (a.quantity || 0), 0);
    const totalSpend = filtered.reduce((s, a) => s + (a.totalPrice || 0), 0);
    const cprs = filtered.filter(a => a.quantity > 0).map(a => a.totalPrice / a.quantity);
    const avgCPR = cprs.length ? (cprs.reduce((s, c) => s + c, 0) / cprs.length) : 0;
    const minCPR = cprs.length ? Math.min(...cprs) : 0;
    const maxCPR = cprs.length ? Math.max(...cprs) : 0;
    const rangeStr = cprs.length ? `$${minCPR.toFixed(2)} – $${maxCPR.toFixed(2)}` : '—';
    statsEl.innerHTML = `
      <div class="ammo-stat-grid">
        <div class="ammo-stat-box"><div class="ammo-stat-num">${totalRounds.toLocaleString()}</div><div class="ammo-stat-label">Rounds</div></div>
        <div class="ammo-stat-box"><div class="ammo-stat-num">$${totalSpend.toFixed(2)}</div><div class="ammo-stat-label">Spend</div></div>
        <div class="ammo-stat-box"><div class="ammo-stat-num">$${avgCPR.toFixed(3)}</div><div class="ammo-stat-label">Avg CPR</div></div>
        <div class="ammo-stat-box"><div class="ammo-stat-num" style="font-size:0.85rem;font-family:var(--font-mono);">${rangeStr}</div><div class="ammo-stat-label">CPR Range</div></div>
      </div>
    `;
  }

  // List
  const listEl = document.getElementById('ammo-list');
  if (!filtered.length) {
    listEl.innerHTML = '<div class="empty-state">' + (ammo.length ? 'No purchases match the current filter.' : 'No ammo purchases logged yet.') + '</div>';
    return;
  }

  const sorted = [...filtered].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  listEl.innerHTML = sorted.map(a => {
    const cpr = a.quantity > 0 ? a.totalPrice / a.quantity : 0;
    const isUsedUp = (a.status || 'instock') === 'usedup';
    const name = [a.manufacturer, a.model].filter(Boolean).join(' ') || '(unnamed)';
    const seller = a.sellerId ? (data.sellers || []).find(s => s.id === a.sellerId) : null;
    const sellerLabel = seller ? seller.name : (a.sellerId ? 'Unknown seller' : '');
    return `
      <div class="ammo-card ${isUsedUp ? 'used-up' : ''}">
        <div class="ammo-card-header">
          <div style="flex:1;min-width:0;">
            <div class="ammo-caliber-badge">${a.caliber}</div>
            <div class="ammo-name">${name}</div>
          </div>
          <div>
            <div class="ammo-cpr">$${cpr.toFixed(3)}</div>
            <div class="ammo-cpr-label">per round</div>
          </div>
        </div>
        <div class="ammo-meta">
          <span>${(a.quantity || 0).toLocaleString()}</span> rds &nbsp;·&nbsp;
          <span>$${(a.totalPrice || 0).toFixed(2)}</span> &nbsp;·&nbsp;
          ${fmtDate(a.date)}${sellerLabel ? ` &nbsp;·&nbsp; <span>${sellerLabel}</span>` : ''} &nbsp;·&nbsp;
          <span class="ammo-status-pill ${isUsedUp ? 'usedup' : ''}">${isUsedUp ? 'Used up' : 'In stock'}</span>
        </div>
        ${a.notes ? `<div class="ammo-notes">${a.notes}</div>` : ''}
        <div class="ammo-actions">
          <button class="btn-mini" onclick="toggleAmmoStatus('${a.id}')">${isUsedUp ? 'Mark in stock' : 'Mark used up'}</button>
          <button class="btn-mini" onclick="openEditAmmo('${a.id}')">Edit</button>
          <button class="btn-mini" onclick="deleteAmmo('${a.id}')">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

// ── STATS ─────────────────────────────────────────────────────────
function firstOfMonthISO(monthsAgo) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function firstOfYearISO() {
  return `${new Date().getFullYear()}-01-01`;
}

function getStatsRangeBounds(prefix) {
  const key = document.getElementById(`stats-${prefix}-range`).value;
  const end = today();
  switch (key) {
    case 'month': return { start: firstOfMonthISO(0), end };
    case '3months': return { start: firstOfMonthISO(2), end };
    case '12months': return { start: firstOfMonthISO(11), end };
    case 'year': return { start: firstOfYearISO(), end };
    case 'all': return { start: null, end: null };
    case 'custom': {
      const s = document.getElementById(`stats-${prefix}-start`).value || null;
      const e = document.getElementById(`stats-${prefix}-end`).value || null;
      return { start: s, end: e };
    }
    default: return { start: firstOfMonthISO(11), end };
  }
}

function handleStatsRangeChange(prefix) {
  const key = document.getElementById(`stats-${prefix}-range`).value;
  const customDiv = document.getElementById(`stats-${prefix}-custom-range`);
  const isCustom = key === 'custom';
  customDiv.style.display = isCustom ? 'flex' : 'none';
  if (isCustom) {
    const startEl = document.getElementById(`stats-${prefix}-start`);
    const endEl = document.getElementById(`stats-${prefix}-end`);
    if (!startEl.value) startEl.value = firstOfMonthISO(11);
    if (!endEl.value) endEl.value = today();
  }
  renderStats();
}

function populateStatsFilterDropdowns() {
  const allCals = allKnownCalibers();

  const rfLoc = document.getElementById('stats-rf-location');
  const curRfLoc = rfLoc.value;
  rfLoc.innerHTML = '<option value="">All Locations</option>' +
    data.locations.map(l => `<option value="${l.id}"${l.id === curRfLoc ? ' selected' : ''}>${l.name}</option>`).join('');

  const rfGun = document.getElementById('stats-rf-firearm');
  const curRfGun = rfGun.value;
  rfGun.innerHTML = '<option value="">All Firearms</option>' +
    data.firearms.map(g => `<option value="${g.id}"${g.id === curRfGun ? ' selected' : ''}>${g.name}</option>`).join('');

  const rfCal = document.getElementById('stats-rf-caliber');
  const curRfCal = rfCal.value;
  const mergedGroups = getMergedFirearmCalibers();
  rfCal.innerHTML = '<option value="">All Calibers</option>' +
    mergedGroups.map(g => `<option value="${g.value}"${g.value === curRfCal ? ' selected' : ''}>${g.label}</option>`).join('');

  const rtLoc = document.getElementById('stats-rt-location');
  const curRtLoc = rtLoc.value;
  rtLoc.innerHTML = '<option value="">All Locations</option>' +
    data.locations.map(l => `<option value="${l.id}"${l.id === curRtLoc ? ' selected' : ''}>${l.name}</option>`).join('');

  const asCal = document.getElementById('stats-as-caliber');
  const curAsCal = asCal.value;
  asCal.innerHTML = '<option value="">All Calibers</option>' +
    allCals.map(c => `<option value="${c}"${c === curAsCal ? ' selected' : ''}>${c}</option>`).join('');
}

// Builds an ordered list of calendar-month buckets spanning start..end (inclusive).
// If start is null, derives the earliest month from the provided items.
// Resolves the effective start date for bucketing: explicit start if given,
// otherwise the earliest date found in the items (matching monthBucketsFor's fallback).
function deriveRangeStart(items, dateField, start) {
  if (start) return start;
  const dates = items.map(it => it[dateField]).filter(Boolean).sort();
  return dates.length ? dates[0] : firstOfMonthISO(11);
}

function daysBetweenISO(startISO, endISO) {
  const [sy, sm, sd] = startISO.split('-').map(Number);
  const [ey, em, ed] = endISO.split('-').map(Number);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / msPerDay);
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth()+1).padStart(2,'0')}-${String(dt.getUTCDate()).padStart(2,'0')}`;
}

function monthBucketsFor(items, dateField, start, end) {
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const minDate = deriveRangeStart(items, dateField, start);
  const maxDate = end || today();
  const [sy, sm] = minDate.split('-').map(Number);
  const [ey, em] = maxDate.split('-').map(Number);
  const buckets = [];
  let y = sy, m = sm - 1;
  const endY = ey, endM = em - 1;
  let guard = 0;
  while ((y < endY || (y === endY && m <= endM)) && guard < 600) {
    buckets.push({ key: `${y}-${String(m+1).padStart(2,'0')}`, label: monthNames[m], value: 0, showLabel: true, isMonth: true });
    m++;
    if (m > 11) { m = 0; y++; }
    guard++;
  }
  return buckets;
}

// Rolling 7-day buckets, labeled by each week's start date in short M/D form.
// Used for shorter ranges (This Month, Last 3 Months, short Custom ranges) where
// monthly buckets would be too coarse to show real variation.
function weekBucketsFor(items, dateField, start, end) {
  const minDate = deriveRangeStart(items, dateField, start);
  const maxDate = end || today();
  const buckets = [];
  let cursor = minDate;
  let guard = 0;
  while (cursor <= maxDate && guard < 600) {
    const [, m, d] = cursor.split('-').map(Number);
    buckets.push({ key: cursor, label: `${m}/${d}`, value: 0, showLabel: true, isMonth: false, weekStart: cursor });
    cursor = addDaysISO(cursor, 7);
    guard++;
  }
  // Too many bars for every label to have breathing room — thin them out rather than
  // let adjacent labels collide. Round counts still show above every single bar.
  if (buckets.length > 8) {
    buckets.forEach((b, i) => { if (i % 2 === 1) b.showLabel = false; });
  }
  return buckets;
}

// Picks weekly buckets for short ranges, monthly for longer ones — one rule for
// every chart, regardless of which preset (or Custom range) produced the span.
function pickBuckets(items, dateField, start, end) {
  const effectiveStart = deriveRangeStart(items, dateField, start);
  const effectiveEnd = end || today();
  const span = daysBetweenISO(effectiveStart, effectiveEnd);
  return span <= 100
    ? weekBucketsFor(items, dateField, start, end)
    : monthBucketsFor(items, dateField, start, end);
}

// Given a date string, finds which bucket (monthly or weekly) it belongs to.
// Monthly buckets key by 'YYYY-MM'; weekly buckets key by their week-start date,
// so a date belongs to the latest week whose start is on or before it.
function getBucketKeyForDate(buckets, dateStr) {
  if (!buckets.length) return null;
  if (buckets[0].isMonth) return dateStr.slice(0, 7);
  let match = null;
  for (const b of buckets) {
    if (b.weekStart <= dateStr) match = b.key; else break;
  }
  return match;
}

function buildStatsBarChart(buckets, formatVal) {
  if (!buckets.length) return '<div class="stats-empty">No data for this range.</div>';
  const max = Math.max(...buckets.map(b => b.value), 1);
  const bars = buckets.map(b => {
    const pct = b.value > 0 ? Math.max((b.value / max) * 100, 3) : 1;
    const labelClass = b.showLabel === false ? 'stats-bar-label hidden-label' : 'stats-bar-label';
    return `
      <div class="stats-bar-col">
        <div class="stats-bar-val">${formatVal(b.value)}</div>
        <div class="stats-bar-track"><div class="stats-bar" style="height:${pct}%"></div></div>
        <div class="${labelClass}">${b.label}</div>
      </div>
    `;
  }).join('');
  return `<div class="stats-bar-chart">${bars}</div>`;
}

function renderStats() {
  populateStatsFilterDropdowns();
  renderRoundsFiredStats();
  renderRangeTripsStats();
  renderAmmoSpendStats();
}

function renderRoundsFiredStats() {
  const { start, end } = getStatsRangeBounds('rf');
  const locId = document.getElementById('stats-rf-location').value;
  const gunId = document.getElementById('stats-rf-firearm').value;
  const caliberValue = document.getElementById('stats-rf-caliber').value; // merged-group value, tokens joined by '||'

  const sessions = data.sessions.filter(s => {
    if (start && s.date < start) return false;
    if (end && s.date > end) return false;
    if (locId && s.locationId !== locId) return false;
    return true;
  });

  let scopedGunIds = null;
  let selectedTokens = null;
  let caliberGroup = null;
  if (caliberValue) {
    selectedTokens = new Set(caliberValue.split('||'));
    caliberGroup = getMergedFirearmCalibers().find(g => g.value === caliberValue);
  }

  if (gunId && caliberValue) {
    // Both filters set — intersect. Only include the firearm if it's actually
    // tagged with the selected caliber; otherwise there's genuinely nothing to show.
    const compatible = caliberGroup && caliberGroup.gunIds.has(gunId);
    scopedGunIds = compatible ? new Set([gunId]) : new Set();
  } else if (gunId) {
    scopedGunIds = new Set([gunId]);
  } else if (caliberValue) {
    scopedGunIds = caliberGroup ? caliberGroup.gunIds : new Set();
  }

  // Disclaimer: even after merging same-signature calibers, a firearm in scope might still
  // carry an ADDITIONAL caliber outside the selected group (e.g. tagged .223/5.56/.300 BLK
  // when only .223/5.56 was selected) — flag that residual ambiguity if it exists.
  const disclaimerEl = document.getElementById('stats-rf-disclaimer');
  if (selectedTokens && scopedGunIds && scopedGunIds.size) {
    const mixedGuns = [...scopedGunIds]
      .map(gid => data.firearms.find(g => g.id === gid))
      .filter(gun => gun && gunCalibers(gun).some(t => !selectedTokens.has(t.trim())));
    if (mixedGuns.length) {
      const parts = mixedGuns.map(g => `${g.name} (${gunCaliberLabel(g)})`);
      const joined = parts.length === 1 ? parts[0]
        : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
      const verb = mixedGuns.length === 1 ? 'is' : 'are';
      disclaimerEl.innerHTML = `
        <div class="caliber-disclaimer">
          <span class="icon">⚠</span>
          <span>${joined} ${verb} tagged for additional calibers beyond this selection — rounds shown may include any of them.</span>
        </div>
      `;
    } else {
      disclaimerEl.innerHTML = '';
    }
  } else {
    disclaimerEl.innerHTML = '';
  }

  function roundsInSession(s) {
    let total = 0;
    Object.entries(s.rounds || {}).forEach(([gid, r]) => {
      if (scopedGunIds && !scopedGunIds.has(gid)) return;
      total += r;
    });
    return total;
  }

  const totalRounds = sessions.reduce((sum, s) => sum + roundsInSession(s), 0);

  const buckets = pickBuckets(sessions, 'date', start, end);
  const bucketMap = {};
  buckets.forEach(b => bucketMap[b.key] = b);
  sessions.forEach(s => {
    const key = getBucketKeyForDate(buckets, s.date);
    if (bucketMap[key]) bucketMap[key].value += roundsInSession(s);
  });

  // "Avg / Month" is a genuine calendar-month average regardless of the chart's
  // bucket granularity (which may be weekly for short ranges) — computed separately
  // so the label stays accurate no matter how the bars above are grouped.
  const avgRangeStart = deriveRangeStart(sessions, 'date', start);
  const avgRangeEnd = end || today();
  const monthsSpanned = Math.max(1, daysBetweenISO(avgRangeStart, avgRangeEnd) / 30.44);
  const avgPerMonth = Math.round(totalRounds / monthsSpanned);

  const perFirearm = {};
  sessions.forEach(s => {
    Object.entries(s.rounds || {}).forEach(([gid, r]) => {
      if (scopedGunIds && !scopedGunIds.has(gid)) return;
      perFirearm[gid] = (perFirearm[gid] || 0) + r;
    });
  });
  const firearmsUsedCount = Object.keys(perFirearm).length;

  document.getElementById('stats-rf-stats').innerHTML = `
    <div class="stats-stat-grid">
      <div class="stats-stat-box"><div class="stats-stat-num">${totalRounds.toLocaleString()}</div><div class="stats-stat-label">Total Rounds</div></div>
      <div class="stats-stat-box"><div class="stats-stat-num">${avgPerMonth.toLocaleString()}</div><div class="stats-stat-label">Avg / Month</div></div>
      <div class="stats-stat-box"><div class="stats-stat-num">${firearmsUsedCount}</div><div class="stats-stat-label">Firearms Used</div></div>
    </div>
  `;

  document.getElementById('stats-rf-chart').innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title">Rounds per ${buckets[0]?.isMonth === false ? 'Week' : 'Month'}</div>
      ${buildStatsBarChart(buckets, v => v.toLocaleString())}
    </div>
  `;

  const breakdownEl = document.getElementById('stats-rf-breakdown');
  if (gunId) {
    breakdownEl.innerHTML = '';
  } else {
    const rows = Object.entries(perFirearm)
      .map(([gid, r]) => ({ r, gun: data.firearms.find(g => g.id === gid) }))
      .filter(x => x.gun)
      .sort((a, b) => b.r - a.r);
    const maxR = rows.length ? rows[0].r : 1;
    const rowsHtml = rows.map(x => {
      const pct = totalRounds > 0 ? Math.round((x.r / totalRounds) * 100) : 0;
      const barPct = Math.round((x.r / maxR) * 100);
      return `
        <div class="breakdown-row">
          <div class="breakdown-top"><span class="breakdown-name">${x.gun.name}</span><span class="breakdown-val">${x.r.toLocaleString()} rds</span></div>
          <div class="breakdown-bar-track"><div class="breakdown-bar-fill" style="width:${barPct}%"></div></div>
          <div class="breakdown-pct">${pct}% of total</div>
        </div>
      `;
    }).join('');
    breakdownEl.innerHTML = rows.length ? `
      <div class="stats-chart-card">
        <div class="stats-chart-title">Per-Firearm Breakdown</div>
        ${rowsHtml}
      </div>
    ` : '<div class="stats-empty">No rounds logged for this range.</div>';
  }
}

function renderRangeTripsStats() {
  const { start, end } = getStatsRangeBounds('rt');
  const locId = document.getElementById('stats-rt-location').value;

  const sessions = data.sessions.filter(s => {
    if (start && s.date < start) return false;
    if (end && s.date > end) return false;
    if (locId && s.locationId !== locId) return false;
    return true;
  });

  const totalTrips = sessions.length;
  const totalRounds = sessions.reduce((sum, s) => sum + (s.totalRounds || 0), 0);
  const avgRounds = totalTrips ? Math.round(totalRounds / totalTrips) : 0;

  document.getElementById('stats-rt-stats').innerHTML = `
    <div class="stats-stat-grid two">
      <div class="stats-stat-box"><div class="stats-stat-num">${totalTrips}</div><div class="stats-stat-label">Total Trips</div></div>
      <div class="stats-stat-box"><div class="stats-stat-num">${avgRounds.toLocaleString()}</div><div class="stats-stat-label">Avg Rounds / Trip</div></div>
    </div>
  `;

  const buckets = pickBuckets(sessions, 'date', start, end);
  const bucketMap = {};
  buckets.forEach(b => bucketMap[b.key] = b);
  sessions.forEach(s => {
    const key = getBucketKeyForDate(buckets, s.date);
    if (bucketMap[key]) bucketMap[key].value += 1;
  });

  document.getElementById('stats-rt-chart').innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title">Trips per ${buckets[0]?.isMonth === false ? 'Week' : 'Month'}</div>
      ${buildStatsBarChart(buckets, v => v.toString())}
    </div>
  `;
}

function renderAmmoSpendStats() {
  const { start, end } = getStatsRangeBounds('as');
  const caliber = document.getElementById('stats-as-caliber').value;

  const purchases = (data.ammo || []).filter(a => {
    if (start && a.date < start) return false;
    if (end && a.date > end) return false;
    if (caliber && a.caliber !== caliber) return false;
    return true;
  });

  const totalSpend = purchases.reduce((sum, a) => sum + (a.totalPrice || 0), 0);
  const totalRoundsBought = purchases.reduce((sum, a) => sum + (a.quantity || 0), 0);
  const avgCPR = totalRoundsBought > 0 ? (totalSpend / totalRoundsBought) : 0;

  document.getElementById('stats-as-stats').innerHTML = `
    <div class="stats-stat-grid">
      <div class="stats-stat-box"><div class="stats-stat-num">$${totalSpend.toFixed(2)}</div><div class="stats-stat-label">Total Spend</div></div>
      <div class="stats-stat-box"><div class="stats-stat-num">${totalRoundsBought.toLocaleString()}</div><div class="stats-stat-label">Rounds Bought</div></div>
      <div class="stats-stat-box"><div class="stats-stat-num">$${avgCPR.toFixed(3)}</div><div class="stats-stat-label">Avg CPR</div></div>
    </div>
  `;

  const buckets = pickBuckets(purchases, 'date', start, end);
  const bucketMap = {};
  buckets.forEach(b => bucketMap[b.key] = b);
  purchases.forEach(a => {
    const key = getBucketKeyForDate(buckets, a.date);
    if (bucketMap[key]) bucketMap[key].value += (a.totalPrice || 0);
  });

  document.getElementById('stats-as-chart').innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title">Spend per ${buckets[0]?.isMonth === false ? 'Week' : 'Month'}</div>
      ${buildStatsBarChart(buckets, v => '$' + Math.round(v))}
    </div>
  `;

  const spendBreakdownEl = document.getElementById('stats-as-breakdown');
  const roundsBreakdownEl = document.getElementById('stats-as-rounds-breakdown');
  if (caliber) {
    // Already filtered to one caliber — a breakdown of a single item is redundant.
    spendBreakdownEl.innerHTML = '';
    roundsBreakdownEl.innerHTML = '';
  } else {
    const perCaliber = {};
    purchases.forEach(a => {
      const key = a.caliber || '(unspecified)';
      if (!perCaliber[key]) perCaliber[key] = { spend: 0, rounds: 0 };
      perCaliber[key].spend += (a.totalPrice || 0);
      perCaliber[key].rounds += (a.quantity || 0);
    });
    const entries = Object.entries(perCaliber).map(([cal, v]) => ({ cal, spend: v.spend, rounds: v.rounds }));

    // Spend breakdown — sorted by spend
    const spendRows = [...entries].sort((a, b) => b.spend - a.spend);
    const maxSpend = spendRows.length ? spendRows[0].spend : 1;
    const spendRowsHtml = spendRows.map(x => {
      const pct = totalSpend > 0 ? Math.round((x.spend / totalSpend) * 100) : 0;
      const barPct = Math.round((x.spend / maxSpend) * 100);
      return `
        <div class="breakdown-row">
          <div class="breakdown-top"><span class="breakdown-name">${x.cal}</span><span class="breakdown-val">$${x.spend.toFixed(2)}</span></div>
          <div class="breakdown-bar-track"><div class="breakdown-bar-fill" style="width:${barPct}%"></div></div>
          <div class="breakdown-pct">${pct}% of total spend</div>
        </div>
      `;
    }).join('');
    spendBreakdownEl.innerHTML = spendRows.length ? `
      <div class="stats-chart-card">
        <div class="stats-chart-title">Per-Caliber Spend Breakdown</div>
        ${spendRowsHtml}
      </div>
    ` : '<div class="stats-empty">No purchases logged for this range.</div>';

    // Rounds breakdown — sorted independently by rounds, since CPR varies by caliber
    // this ranking can genuinely differ from the spend ranking above.
    const totalRoundsBought = entries.reduce((sum, x) => sum + x.rounds, 0);
    const roundsRows = [...entries].sort((a, b) => b.rounds - a.rounds);
    const maxRounds = roundsRows.length ? roundsRows[0].rounds : 1;
    const roundsRowsHtml = roundsRows.map(x => {
      const pct = totalRoundsBought > 0 ? Math.round((x.rounds / totalRoundsBought) * 100) : 0;
      const barPct = Math.round((x.rounds / maxRounds) * 100);
      return `
        <div class="breakdown-row">
          <div class="breakdown-top"><span class="breakdown-name">${x.cal}</span><span class="breakdown-val" style="color:#7a92a3;">${x.rounds.toLocaleString()} rds</span></div>
          <div class="breakdown-bar-track"><div class="breakdown-bar-fill" style="width:${barPct}%;background:#7a92a3;"></div></div>
          <div class="breakdown-pct">${pct}% of total rounds</div>
        </div>
      `;
    }).join('');
    roundsBreakdownEl.innerHTML = roundsRows.length ? `
      <div class="stats-chart-card">
        <div class="stats-chart-title">Per-Caliber Rounds Purchased</div>
        ${roundsRowsHtml}
      </div>
    ` : '';
  }
}

// ── GROUP ANALYSIS ────────────────────────────────────────────────
// Marked points are stored normalised by image WIDTH on both axes, so aspect ratio is
// preserved and the numbers stay meaningful at any resolution — and, critically, with
// or without the photo. Every metric below is derived on demand; nothing is stored.

const GROUP_STEPS = ['Scale', 'Aim', 'Impacts', 'Done'];

let G = null;   // live marking state, null when the modal is closed

function groupBlank(gunId) {
  return {
    gunId, editId: null, step: 0,
    img: null, imgW: 0, imgH: 0,
    photoBlob: null, photoId: null,
    view: { scale: 1, ox: 0, oy: 0 },
    calPts: [], poa: null, impacts: [],
  };
}

/* ---- geometry ---- */
function gDist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Corners may be marked in any order or winding. Sort into a cycle around the centroid
// (which also un-crosses a bowtie), then start from the corner nearest the top-left so
// the result is always [TL, TR, BR, BL].
function orderedQuad(quad, calW, calH) {
  if (!quad || quad.length !== 4) return quad;
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4;
  const cy = quad.reduce((s, p) => s + p.y, 0) / 4;
  const ring = [...quad].sort((a, b) =>
    Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));

  let start = 0, best = Infinity;
  ring.forEach((p, i) => { const s = p.x + p.y; if (s < best) { best = s; start = i; } });
  let out = [0, 1, 2, 3].map(i => ring[(start + i) % 4]);

  // For a non-square reference, prefer the assignment whose edge ratio matches the
  // declared width:height — settles which sides are "width" on a heavily rotated photo.
  if (calW > 0 && calH > 0 && Math.abs(calW - calH) > 1e-6) {
    const side = (a, b) => gDist(out[a], out[b]);
    const ratio = ((side(0, 1) + side(3, 2)) / 2) / ((side(0, 3) + side(1, 2)) / 2);
    const miss = r => Math.abs(Math.log(ratio / r));
    if (isFinite(ratio) && ratio > 0 && miss(calH / calW) < miss(calW / calH)) {
      out = [out[1], out[2], out[3], out[0]];
    }
  }
  return out;
}

function solve8(A, b) {
  const n = 8;
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
    if (Math.abs(A[piv][i]) < 1e-12) return null;
    [A[i], A[piv]] = [A[piv], A[i]];
    [b[i], b[piv]] = [b[piv], b[i]];
    const d = A[i][i];
    for (let c = i; c < n; c++) A[i][c] /= d;
    b[i] /= d;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i];
      if (!f) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }
  return b;
}

function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const h = solve8(A, b);
  return h ? [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1] : null;
}

function applyH(h, p) {
  const d = h[6] * p.x + h[7] * p.y + h[8];
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / d, y: (h[3] * p.x + h[4] * p.y + h[5]) / d };
}

// Converts a stored (or in-progress) group into impacts in inches relative to the point
// of aim: x = windage (+right), y = elevation (+high). Returns null when incomplete.
function groupToInches(g) {
  if (!g || !g.poa || !Array.isArray(g.impacts) || !g.impacts.length) return null;
  const calW = Number(g.calInches);
  if (!(calW > 0)) return null;

  if (g.calMode === 'perspective') {
    if (!g.calPts || g.calPts.length < 4) return null;
    const calH = Number(g.calInchesH);
    if (!(calH > 0)) return null;
    const h = homography(orderedQuad(g.calPts, calW, calH), [
      { x: 0, y: 0 }, { x: calW, y: 0 }, { x: calW, y: calH }, { x: 0, y: calH },
    ]);
    if (!h) return null;
    const poa = applyH(h, g.poa);
    return g.impacts.map(p => {
      const q = applyH(h, p);
      return { x: q.x - poa.x, y: -(q.y - poa.y) };
    });
  }

  if (!g.calPts || g.calPts.length < 2) return null;
  const per = gDist(g.calPts[0], g.calPts[1]) / calW;   // normalised units per inch
  if (!isFinite(per) || per <= 0) return null;
  return g.impacts.map(p => ({ x: (p.x - g.poa.x) / per, y: -(p.y - g.poa.y) / per }));
}

// Normalised units per inch, for drawing impact marks at true bullet size.
function groupUnitsPerInch(g) {
  const calW = Number(g.calInches);
  if (!(calW > 0)) return null;
  if (g.calMode === 'perspective') {
    if (!g.calPts || g.calPts.length < 4) return null;
    const q = orderedQuad(g.calPts, calW, Number(g.calInchesH));
    return (gDist(q[0], q[1]) + gDist(q[3], q[2])) / 2 / calW;
  }
  if (!g.calPts || g.calPts.length < 2) return null;
  return gDist(g.calPts[0], g.calPts[1]) / calW;
}

// Everything downstream works in inches, so distance converts once here. Unknown or
// missing units fall back to yards, which is what pre-existing records assumed.
const DISTANCE_UNIT_INCHES = { yd: 36, ft: 12, m: 39.3701 };

function groupDistanceInches(g) {
  const d = Number(g.distance);
  if (!(d > 0)) return null;
  return d * (DISTANCE_UNIT_INCHES[g.distanceUnit] || DISTANCE_UNIT_INCHES.yd);
}

const RAD_TO_MOA = 3437.746;
function toMOA(inches, distIn) { return distIn ? (inches / distIn) * RAD_TO_MOA : null; }
function toMRAD(inches, distIn) { return distIn ? (inches / distIn) * 1000 : null; }

// Group statistics, always recomputed from the marked points — never stored.
function groupMetrics(pts) {
  if (!pts || pts.length < 2) return null;
  const n = pts.length;
  const cx = pts.reduce((s, p) => s + p.x, 0) / n;
  const cy = pts.reduce((s, p) => s + p.y, 0) / n;

  let es = 0, esPair = null;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = gDist(pts[i], pts[j]);
      if (d > es) { es = d; esPair = [i, j]; }
    }
  }
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  return {
    n, cx, cy, es, esPair,
    meanRadius: pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n,
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

// Convenience for list rows: extreme spread of a stored group, or null.
function groupSizeInches(g) {
  const m = groupMetrics(groupToInches(g));
  return m ? m.es : null;
}

function gFmt(v, d = 2) { return v == null || !isFinite(v) ? '—' : v.toFixed(d); }

/* ---- EXIF: DateTimeOriginal, so the date defaults to when the shot was taken ---- */
async function readExifDate(file) {
  try {
    const buf = await file.slice(0, 256 * 1024).arrayBuffer();
    const dv = new DataView(buf);
    if (dv.getUint16(0) !== 0xFFD8) return null;
    let off = 2;
    while (off < dv.byteLength - 4) {
      const marker = dv.getUint16(off);
      if ((marker & 0xFF00) !== 0xFF00) break;
      const size = dv.getUint16(off + 2);
      if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) return parseExifTiff(dv, off + 10);
      off += 2 + size;
    }
  } catch (e) { /* unreadable EXIF just falls back to today */ }
  return null;
}

function parseExifTiff(dv, start) {
  const le = dv.getUint16(start) === 0x4949;
  const g16 = o => dv.getUint16(o, le);
  const g32 = o => dv.getUint32(o, le);
  if (g16(start + 2) !== 0x002A) return null;

  const readAscii = (valOff, count) => {
    const p = count > 4 ? start + g32(valOff) : valOff;
    let s = '';
    for (let i = 0; i < count - 1; i++) s += String.fromCharCode(dv.getUint8(p + i));
    return s;
  };
  const eachEntry = (ifdOff, cb) => {
    const n = g16(ifdOff);
    for (let i = 0; i < n; i++) {
      const e = ifdOff + 2 + i * 12;
      cb(g16(e), g32(e + 4), e + 8);
    }
  };

  let exifIfd = null, dt = null;
  eachEntry(start + g32(start + 4), (tag, count, valOff) => {
    if (tag === 0x8769) exifIfd = start + g32(valOff);
    if (tag === 0x0132 && !dt) dt = readAscii(valOff, count);
  });
  if (exifIfd) eachEntry(exifIfd, (tag, count, valOff) => {
    if (tag === 0x9003) dt = readAscii(valOff, count) || dt;
  });

  const m = dt && dt.match(/^(\d{4}):(\d{2}):(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/* ---- canvas view ---- */
// Points live in normalised units (x/imgW, y/imgW); these map to and from screen pixels.
function gCanvas() { return document.getElementById('group-canvas'); }
function gNormToScreen(p) {
  return { x: p.x * G.imgW * G.view.scale + G.view.ox, y: p.y * G.imgW * G.view.scale + G.view.oy };
}
function gScreenToNorm(p) {
  return { x: (p.x - G.view.ox) / (G.imgW * G.view.scale), y: (p.y - G.view.oy) / (G.imgW * G.view.scale) };
}
function gBaseScale() {
  const cv = gCanvas();
  return Math.min(cv.clientWidth / G.imgW, cv.clientHeight / G.imgH) || 1;
}
function gCrosshairPoint() {
  const cv = gCanvas();
  return gScreenToNorm({ x: cv.clientWidth / 2, y: cv.clientHeight / 2 });
}
function gFitImage() {
  const cv = gCanvas();
  const s = gBaseScale();
  G.view.scale = s;
  G.view.ox = (cv.clientWidth - G.imgW * s) / 2;
  G.view.oy = (cv.clientHeight - G.imgH * s) / 2;
}
// Refits the photo to the stage without disturbing any marks already placed.
function gResetPhotoView() {
  if (!G || !G.img) return;
  gFitImage();
  gDrawCanvas();
}

function gResizeCanvas() {
  const cv = gCanvas();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.round(cv.clientWidth * dpr);
  cv.height = Math.round(cv.clientHeight * dpr);
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}

function gVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Current form values, read live so edits recompute immediately.
function gFormGroup() {
  return {
    calMode: document.getElementById('group-cal-mode').value,
    calInches: parseFloat(document.getElementById('group-cal-w').value),
    calInchesH: parseFloat(document.getElementById('group-cal-h').value),
    distance: parseFloat(document.getElementById('group-distance').value),
    distanceUnit: document.getElementById('group-distance-unit').value,
    calPts: G.calPts, poa: G.poa, impacts: G.impacts,
  };
}

function gDrawCanvas() {
  if (!G || !G.img) return;
  const cv = gCanvas();
  const ctx = cv.getContext('2d');
  const w = cv.clientWidth, h = cv.clientHeight;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(G.img, G.view.ox, G.view.oy, G.imgW * G.view.scale, G.imgH * G.view.scale);

  // Dark halo under every mark keeps it legible over any photo.
  const halo = (fn, color, lw = 2) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineWidth = lw + 3;
    fn();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    fn();
  };

  const perspective = document.getElementById('group-cal-mode').value === 'perspective';
  if (G.calPts.length) {
    const outline = perspective && G.calPts.length === 4
      ? orderedQuad(G.calPts, parseFloat(document.getElementById('group-cal-w').value),
                    parseFloat(document.getElementById('group-cal-h').value))
      : G.calPts;
    const sp = outline.map(gNormToScreen);
    if (perspective && sp.length > 1) {
      halo(() => {
        ctx.beginPath();
        ctx.moveTo(sp[0].x, sp[0].y);
        for (let i = 1; i < sp.length; i++) ctx.lineTo(sp[i].x, sp[i].y);
        if (sp.length === 4) ctx.closePath();
        ctx.stroke();
      }, gVar('--mark-cal'));
    } else if (sp.length === 2) {
      halo(() => {
        ctx.beginPath();
        ctx.moveTo(sp[0].x, sp[0].y);
        ctx.lineTo(sp[1].x, sp[1].y);
        ctx.stroke();
      }, gVar('--mark-cal'));
    }
    sp.forEach(p => halo(() => {
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y); ctx.lineTo(p.x + 7, p.y);
      ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x, p.y + 7);
      ctx.stroke();
    }, gVar('--mark-cal')));
  }

  if (G.poa) {
    const p = gNormToScreen(G.poa);
    halo(() => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.moveTo(p.x - 20, p.y); ctx.lineTo(p.x - 5, p.y);
      ctx.moveTo(p.x + 5, p.y); ctx.lineTo(p.x + 20, p.y);
      ctx.moveTo(p.x, p.y - 20); ctx.lineTo(p.x, p.y - 5);
      ctx.moveTo(p.x, p.y + 5); ctx.lineTo(p.x, p.y + 20);
      ctx.stroke();
    }, gVar('--mark-poa'));
  }

  // Impacts drawn at true bullet diameter, so the ring should sit on the hole like a lid.
  const per = groupUnitsPerInch(gFormGroup());
  const bullet = parseFloat(document.getElementById('group-bullet').value);
  const ctxFont = getComputedStyle(document.body).getPropertyValue('--font-mono');
  G.impacts.forEach((ip, i) => {
    const p = gNormToScreen(ip);
    const r = (per && bullet > 0)
      ? Math.max(bullet * per * G.imgW * G.view.scale / 2, 4) : 9;
    halo(() => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); }, gVar('--mark-impact'));
    halo(() => {
      ctx.beginPath();
      ctx.moveTo(p.x - 3, p.y); ctx.lineTo(p.x + 3, p.y);
      ctx.moveTo(p.x, p.y - 3); ctx.lineTo(p.x, p.y + 3);
      ctx.stroke();
    }, gVar('--mark-impact'), 1.5);
    ctx.font = '600 11px ' + ctxFont;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(String(i + 1), p.x + r + 4, p.y - r - 2);
    ctx.fillStyle = gVar('--mark-impact');
    ctx.fillText(String(i + 1), p.x + r + 4, p.y - r - 2);
  });

  document.getElementById('group-zoom').textContent = (G.view.scale / gBaseScale()).toFixed(1) + '×';
  gDrawReticle();
}

// While marking impacts the ring is drawn at true bullet diameter and grows with zoom;
// elsewhere it's a plain fixed crosshair, since bullet size is irrelevant there.
function gReticleRadius() {
  if (!G || G.step !== 2) return 22;
  const per = groupUnitsPerInch(gFormGroup());
  const bullet = parseFloat(document.getElementById('group-bullet').value);
  if (!per || !(bullet > 0)) return 22;
  return Math.max(bullet * per * G.imgW * G.view.scale / 2, 6);
}

function gDrawReticle() {
  const svg = document.getElementById('group-reticle');
  const cv = gCanvas();
  const w = cv.clientWidth, h = cv.clientHeight;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const cx = w / 2, cy = h / 2, r = gReticleRadius();
  const inner = r + 6, outer = r + 20;
  const d = `M${cx - outer} ${cy}H${cx - inner}M${cx + inner} ${cy}H${cx + outer}` +
            `M${cx} ${cy - outer}V${cy - inner}M${cx} ${cy + inner}V${cy + outer}`;
  const c = gVar('--accent');
  svg.innerHTML =
    `<g stroke="#000" stroke-opacity="0.8" stroke-width="4" fill="none">
       <circle cx="${cx}" cy="${cy}" r="${r}"/><path d="${d}"/></g>
     <g stroke="${c}" stroke-width="1.5" fill="none">
       <circle cx="${cx}" cy="${cy}" r="${r}"/><path d="${d}"/></g>
     <circle cx="${cx}" cy="${cy}" r="1.5" fill="${c}"/>`;
}

/* ---- gestures ---- */
function gBindStage() {
  // These fields feed straight into the measurements — distance drives MOA and MRAD,
  // the reference length drives the scale, bullet diameter sizes the impact rings — so
  // editing one has to recompute immediately rather than leave stale numbers on screen.
  ['group-distance', 'group-distance-unit', 'group-cal-w', 'group-cal-h', 'group-bullet']
    .forEach(id => {
      const field = document.getElementById(id);
      if (field.dataset.bound) return;
      field.dataset.bound = '1';
      field.addEventListener('input', () => { if (G) gRefresh(); });
    });

  // Changing the date changes which session is the obvious match, so re-run the suggestion
  // — but only while the group is still unlinked, so it never overrides a deliberate pick.
  const dateField = document.getElementById('group-date');
  if (!dateField.dataset.bound) {
    dateField.dataset.bound = '1';
    dateField.addEventListener('change', () => {
      if (!G || G.sessionTouched) return;
      populateGroupSessionDropdown(null, dateField.value);
    });
  }

  // The reverse direction: picking a session sets the date to that session's, since a
  // group was shot on the day of the session it belongs to. Say so, because a field
  // changing on its own otherwise reads as a glitch. Clearing the link leaves the date be.
  const sessionField = document.getElementById('group-session');
  if (!sessionField.dataset.bound) {
    sessionField.dataset.bound = '1';
    sessionField.addEventListener('change', () => {
      // A real change event only fires for user interaction — programmatic .value
      // assignment doesn't — so this is a reliable "they chose it themselves" signal.
      if (G) G.sessionTouched = true;
      const s = (data.sessions || []).find(x => x.id === sessionField.value);
      const hint = document.getElementById('group-session-hint');
      if (!s) { hint.textContent = ''; return; }
      const dateEl = document.getElementById('group-date');
      const changed = dateEl.value !== s.date;
      dateEl.value = s.date;
      hint.textContent = changed ? `Date set to ${fmtDate(s.date)} to match the session.` : '';
      if (G) gRefresh();
    });
  }

  const steps = document.getElementById('group-steps');
  if (!steps.dataset.bound) {
    steps.dataset.bound = '1';
    steps.addEventListener('click', e => {
      const el = e.target.closest('[data-step]');
      if (!el || !G) return;
      const i = Number(el.dataset.step);
      if (gStepReachable(i)) { G.step = i; gRefresh(); }
    });
  }

  const stage = document.getElementById('group-stage');
  if (stage.dataset.bound) return;
  stage.dataset.bound = '1';

  const pointers = new Map();
  let pinch = null;
  const midInCanvas = (a, b) => {
    const r = gCanvas().getBoundingClientRect();
    return { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
  };

  // iOS scrolls the page from a touch that began here unless we swallow it outright.
  stage.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  stage.addEventListener('pointerdown', e => {
    if (!G || !G.img) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const mid = midInCanvas(a, b);
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: G.view.scale, norm: gScreenToNorm(mid) };
    }
  });

  stage.addEventListener('pointermove', e => {
    if (!G || !G.img || !pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      G.view.ox += e.clientX - prev.x;
      G.view.oy += e.clientY - prev.y;
      gDrawCanvas();
    } else if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      const base = gBaseScale();
      const next = Math.max(base * 0.5, Math.min(pinch.scale * (dd / pinch.d), base * 40));
      const mid = midInCanvas(a, b);
      G.view.scale = next;
      G.view.ox = mid.x - pinch.norm.x * G.imgW * next;
      G.view.oy = mid.y - pinch.norm.y * G.imgW * next;
      gDrawCanvas();
    }
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    stage.addEventListener(ev, e => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
    })
  );

  stage.addEventListener('wheel', e => {
    if (!G || !G.img) return;
    e.preventDefault();
    const r = gCanvas().getBoundingClientRect();
    const at = { x: e.clientX - r.left, y: e.clientY - r.top };
    const before = gScreenToNorm(at);
    const base = gBaseScale();
    const next = Math.max(base * 0.5, Math.min(G.view.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), base * 40));
    G.view.scale = next;
    G.view.ox = at.x - before.x * G.imgW * next;
    G.view.oy = at.y - before.y * G.imgW * next;
    gDrawCanvas();
  }, { passive: false });
}

/* ---- step flow ---- */
function gNeededCalPoints() {
  return document.getElementById('group-cal-mode').value === 'perspective' ? 4 : 2;
}

const GROUP_PROMPTS = [
  () => document.getElementById('group-cal-mode').value === 'perspective'
    ? `Put the crosshair on a <b>corner of a known rectangle</b> and Set point. Mark all four <b>in any order</b> — ${G.calPts.length}/4.`
    : `Put the crosshair on one end of a <b>known distance</b> and Set point, then the other end — ${G.calPts.length}/2. Spanning several grid squares tightens accuracy.`,
  () => `Put the crosshair on your <b>point of aim</b> and Set point.`,
  () => `Mark the <b>center of each hole</b> — ${G.impacts.length} so far. The ring is drawn at true bullet size, so it should sit on the hole like a lid.`,
  () => `Marking complete. Review below, then Save.`,
];

// A step can be jumped to once its prerequisites exist — which makes the rail a way to
// go back and re-do one part of an existing group without redoing the rest.
function gStepReachable(i) {
  if (!G || !G.img) return false;
  if (i === 0) return true;
  const calDone = G.calPts.length === gNeededCalPoints();
  if (i === 1) return calDone;
  if (i === 2) return calDone && !!G.poa;
  return calDone && !!G.poa && G.impacts.length >= 2;
}

function gRefresh() {
  if (!G) return;
  // Viewing keeps the marked-up photo on screen to inspect, but none of the marking
  // chrome — no steps, no prompt, no Set point.
  const marking = !!G.img && G.step < 3 && !G.readOnly;
  // The keep-photo checkbox sits inside the stage wrapper, so it appears and hides
  // with the photo it refers to — no separate toggle needed.
  document.getElementById('group-stage-wrap').style.display = G.img ? '' : 'none';
  document.getElementById('group-load').style.display = (G.img || G.readOnly) ? 'none' : '';
  document.getElementById('group-steps').style.display = G.readOnly ? 'none' : '';

  document.getElementById('group-steps').innerHTML = GROUP_STEPS.map((name, i) => {
    const state = i === G.step ? 'active' : i < G.step ? 'done' : '';
    const clickable = i !== G.step && gStepReachable(i) ? 'clickable' : '';
    return `<div class="group-step ${state} ${clickable}" data-step="${i}">${i + 1} ${name}</div>`;
  }).join('');

  document.getElementById('group-prompt').innerHTML = G.img ? GROUP_PROMPTS[G.step]() : '';
  document.querySelector('.group-actions').style.display = marking ? '' : 'none';
  document.getElementById('group-reticle').style.display = marking ? '' : 'none';

  const need = gNeededCalPoints();
  const canSet = G.step === 0 ? G.calPts.length < need : G.step === 1 ? true : G.step === 2;
  // Undo reaches back into the previous step, so it's live whenever any point exists.
  const canUndo = G.step === 0 ? G.calPts.length > 0
    : G.step === 1 ? (!!G.poa || G.calPts.length > 0)
    : (G.impacts.length > 0 || !!G.poa);
  document.getElementById('group-set').disabled = !canSet;
  document.getElementById('group-undo').disabled = !canUndo;

  // Only impacts need a confirm — the earlier steps advance themselves.
  const next = document.getElementById('group-next');
  next.style.display = G.step === 2 ? '' : 'none';
  next.textContent = 'Done';
  next.disabled = G.impacts.length < 2;
  document.querySelector('.group-actions').classList.toggle('no-next', G.step !== 2);

  gDrawCanvas();
  gRenderResults();
}

function groupSetPoint() {
  const p = gCrosshairPoint();
  // Scale and aim take a known number of points, so the step is finished the moment the
  // last one lands — no reason to make you confirm it. Impacts are open-ended, so that
  // one waits for Done.
  if (G.step === 0 && G.calPts.length < gNeededCalPoints()) {
    G.calPts.push(p);
    if (G.calPts.length === gNeededCalPoints()) G.step = 1;
  } else if (G.step === 1) {
    G.poa = p;
    G.step = 2;
  } else if (G.step === 2) {
    G.impacts.push(p);
  }
  gRefresh();
}

// Undo removes the last point you placed. Because steps advance on their own, that point
// may sit in the previous step — so when the current one is empty, step back and undo
// there rather than doing nothing.
function groupUndo() {
  if (G.step === 0) {
    G.calPts.pop();
  } else if (G.step === 1) {
    if (G.poa) G.poa = null;
    else if (G.calPts.length) { G.calPts.pop(); G.step = 0; }
  } else if (G.step === 2) {
    if (G.impacts.length) G.impacts.pop();
    else if (G.poa) { G.poa = null; G.step = 1; }
  }
  gRefresh();
}

function groupNextStep() {
  if (G.step < 3) G.step++;
  gRefresh();
}

function handleGroupCalModeChange() {
  const persp = document.getElementById('group-cal-mode').value === 'perspective';
  document.getElementById('group-cal-h-field').style.display = persp ? '' : 'none';
  document.getElementById('group-cal-row').classList.toggle('single', !persp);
  document.getElementById('group-cal-w-label').textContent =
    persp ? 'Rectangle width (in)' : 'Known distance (in)';
  if (G) {
    G.calPts = [];
    if (G.step > 0) G.step = 0;
    gRefresh();
  }
}

// Sessions are listed newest first, labelled by date and location. When a group's date
// matches exactly one session we preselect it, since that's almost always the right
// answer — but it stays changeable, and "not linked" is always available.
function populateGroupSessionDropdown(selectedId, groupDate) {
  const sel = document.getElementById('group-session');
  const sessions = [...(data.sessions || [])].sort((a, b) => b.date.localeCompare(a.date));
  sel.innerHTML = '<option value="">— Not linked to a session —</option>' +
    sessions.map(s => {
      const loc = data.locations.find(l => l.id === s.locationId);
      const label = `${fmtDate(s.date)}${loc ? ' · ' + loc.name : ''}`;
      return `<option value="${s.id}">${label}</option>`;
    }).join('');

  let hint = '';
  if (selectedId && sessions.some(s => s.id === selectedId)) {
    sel.value = selectedId;
  } else if (!selectedId && groupDate) {
    const sameDay = sessions.filter(s => s.date === groupDate);
    if (sameDay.length === 1) {
      sel.value = sameDay[0].id;
      hint = 'Matched to the session you logged that day. Change it if that’s wrong.';
    } else if (sameDay.length > 1) {
      hint = `${sameDay.length} sessions on that date — pick the right one.`;
    } else {
      hint = 'No session logged on that date.';
    }
  }
  document.getElementById('group-session-hint').textContent = hint;
}

// Everything editable in the group form. Viewing disables the lot rather than trusting
// the user not to touch it — a stray tap on a date field shouldn't silently alter a
// saved record just because you opened it to look.
const GROUP_FIELDS = [
  'group-date', 'group-distance', 'group-distance-unit', 'group-bullet', 'group-session',
  'group-ammo-select', 'group-ammo-custom', 'group-cal-mode', 'group-cal-w', 'group-cal-h',
  'group-keep-photo', 'group-file', 'group-tag-add-select', 'group-tag-custom',
];

function gApplyMode() {
  const viewing = !!(G && G.readOnly);
  GROUP_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = viewing;
  });
  document.getElementById('modal-group').classList.toggle('viewing', viewing);
  document.getElementById('group-cancel').textContent = viewing ? 'Close' : 'Cancel';
  document.getElementById('group-save').style.display = viewing ? 'none' : '';
  document.getElementById('group-edit').style.display = viewing ? '' : 'none';
}

// Switching to edit keeps everything already on screen — no reload, no re-marking.
function groupEnterEdit() {
  if (!G) return;
  G.readOnly = false;
  renderGroupTagChips();
  const gun = data.firearms.find(x => x.id === G.gunId);
  document.getElementById('group-modal-title').textContent =
    'Edit Group' + (gun ? ' · ' + gun.name : '');
  gApplyMode();
  gRefresh();
}

function openViewGroup(gunId, groupId) {
  return openLogGroup(gunId, groupId, true);
}

function handleGroupAmmoChange() {
  handleAmmoSelectChange('group-ammo-select', 'group-ammo-custom');
  // Ammo carries the caliber, so it can fill the bullet diameter in for you.
  const gun = data.firearms.find(x => x.id === document.getElementById('group-gun-id').value);
  const dia = gun && guessBulletDiameter(gun, getSelectedAmmo('group-ammo-select', 'group-ammo-custom'));
  if (dia) document.getElementById('group-bullet').value = dia;
  if (G) gRefresh();
}

/* ---- results ---- */
function gRenderResults() {
  const box = document.getElementById('group-results');
  if (!G) { box.innerHTML = ''; return; }

  const form = gFormGroup();
  const pts = groupToInches(form);
  const m = groupMetrics(pts);

  // Results come from the marked points, not the photo — so a group saved without its
  // image still shows every measurement, and everything but re-marking stays editable.
  if (!m) {
    box.innerHTML = (G.img && G.step === 2)
      ? '<div class="empty-state" style="padding:16px;">Mark at least two impacts to see results.</div>'
      : '';
    return;
  }

  // Don't promise editability while viewing — nothing here is editable in that mode.
  const noPhotoNote = !G.img
    ? `<div class="group-hint" style="margin-bottom:10px;">No photo was kept with this
       group, so the impacts can’t be re-marked. ${G.readOnly
         ? 'The measurements below are recomputed from the saved points.'
         : 'Everything else here is still editable, and the measurements below recompute from the saved points.'}</div>`
    : '';

  const dIn = groupDistanceInches(form);
  const ang = v => dIn ? `${gFmt(toMOA(v, dIn))} MOA · ${gFmt(toMRAD(v, dIn))} MRAD` : '';

  // MOA leads: it's the figure that stays comparable across firearms and distances,
  // which inches can't. Falls back to inches when there's no distance to convert with —
  // and says why, rather than showing a bare dash.
  // Every derived figure follows the same rule as the headline: MOA leads because it's
  // comparable across distances, inches sits beneath. Mean radius especially — it's the
  // measure that stays honest when shot counts differ, so it's the one worth comparing.
  const angPrimary = v => {
    const moa = toMOA(v, dIn);
    return moa != null
      ? `${gFmt(moa)}<span class="group-unit"> MOA</span>`
      : `${gFmt(v)}<span class="group-unit"> in</span>`;
  };
  const angSecondary = v => (toMOA(v, dIn) != null ? `${gFmt(v)} in` : '');
  const tile = (v, label) => `
      <div class="group-tile">
        <div class="group-tile-num">${angPrimary(v)}</div>
        <div class="group-tile-label">${label}</div>
        <div class="group-tile-sub">${angSecondary(v)}</div>
      </div>`;

  const esMOA = toMOA(m.es, dIn);
  const heroNum = esMOA != null
    ? `${gFmt(esMOA)}<span> MOA</span>`
    : `${gFmt(m.es)}<span> in</span>`;
  const heroSub = esMOA != null
    ? `${gFmt(m.es)} in · ${gFmt(toMRAD(m.es, dIn))} MRAD`
    : 'Enter the distance to target — a group can’t be judged without it';
  // Below the displayed precision there is no real direction, so don't invent one.
  const dir = (v, pos, neg) => Math.abs(v) < 0.005 ? 'on point' : v > 0 ? pos : neg;

  box.innerHTML = `
    ${noPhotoNote}
    <div class="group-hero">
      <div class="group-tile-label">Group size — extreme spread, center to center</div>
      <div class="group-hero-num">${heroNum}</div>
      <div class="group-hint">${heroSub}</div>
    </div>
    <div class="group-tiles">
      ${tile(m.meanRadius, 'Mean radius')}
      ${tile(m.width, 'Width')}
      ${tile(m.height, 'Height')}
    </div>
    <div class="group-offsets">
      <div class="group-offset">
        <div class="group-offset-axis">Elevation</div>
        <div class="group-offset-val">${angPrimary(Math.abs(m.cy))}</div>
        <div class="group-offset-dir">${dir(m.cy, 'high', 'low')}</div>
        <div class="group-offset-sub">${angSecondary(Math.abs(m.cy))}</div>
      </div>
      <div class="group-offset">
        <div class="group-offset-axis">Windage</div>
        <div class="group-offset-val">${angPrimary(Math.abs(m.cx))}</div>
        <div class="group-offset-dir">${dir(m.cx, 'right', 'left')}</div>
        <div class="group-offset-sub">${angSecondary(Math.abs(m.cx))}</div>
      </div>
    </div>
    <div class="group-plot-head">
      <span>Group plot — drag to pan, pinch to zoom</span>
      <button type="button" class="btn-mini" id="group-plot-reset">Reset view</button>
    </div>
    <div class="group-plot-wrap">
      ${groupPlotSVG(pts, m)}
      <div class="group-zoom" id="group-plot-zoom">1.0×</div>
    </div>`;

  // The SVG is rebuilt on every render, so gestures re-bind; gPlotVB is module-level and
  // survives, keeping your zoom when an unrelated field changes.
  gApplyPlotView();
  gBindPlotGestures();
}

// Scale drawing of the group: point of aim at the origin, 1-inch rings, true-size holes.
const PLOT_SIZE = 300;

/* ---- plot pan / zoom ----
   For a group saved without its photo this plot is the only picture there is, so it
   gets the same drag-and-pinch treatment as the target image. Driven by the viewBox
   rather than a transform, so geometry scales while strokes and labels stay legible. */
let gPlotVB = null;

function gClampPlotW(w) {
  return Math.max(PLOT_SIZE / 20, Math.min(w, PLOT_SIZE * 2));
}

function gResetPlotView() {
  gPlotVB = null;
  gApplyPlotView();
}

function gApplyPlotView() {
  const svg = document.getElementById('group-plot-svg');
  if (!svg) return;
  if (!gPlotVB) gPlotVB = { x: 0, y: 0, w: PLOT_SIZE, h: PLOT_SIZE };
  svg.setAttribute('viewBox', `${gPlotVB.x} ${gPlotVB.y} ${gPlotVB.w} ${gPlotVB.h}`);

  const k = gPlotVB.w / PLOT_SIZE;
  svg.querySelectorAll('text[data-fs]').forEach(t =>
    t.setAttribute('font-size', (Number(t.dataset.fs) * k).toFixed(2)));

  const chip = document.getElementById('group-plot-zoom');
  if (chip) chip.textContent = (1 / k).toFixed(1) + '×';
}

function gBindPlotGestures() {
  const svg = document.getElementById('group-plot-svg');
  if (!svg) return;
  const reset = document.getElementById('group-plot-reset');
  if (reset) reset.addEventListener('click', gResetPlotView);

  const pts = new Map();
  let pinch = null;
  const toUser = (clientX, clientY) => {
    const r = svg.getBoundingClientRect();
    return {
      x: gPlotVB.x + (clientX - r.left) / r.width * gPlotVB.w,
      y: gPlotVB.y + (clientY - r.top) / r.height * gPlotVB.h,
    };
  };

  svg.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  svg.addEventListener('pointerdown', e => {
    svg.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y),
        w: gPlotVB.w,
        u: toUser((a.x + b.x) / 2, (a.y + b.y) / 2),
      };
    }
  });

  svg.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = svg.getBoundingClientRect();

    if (pts.size === 1) {
      gPlotVB.x -= (e.clientX - prev.x) / r.width * gPlotVB.w;
      gPlotVB.y -= (e.clientY - prev.y) / r.height * gPlotVB.h;
      gApplyPlotView();
    } else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const dd = Math.hypot(a.x - b.x, a.y - b.y);
      const w = gClampPlotW(pinch.w * (pinch.d / dd));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gPlotVB.w = gPlotVB.h = w;
      gPlotVB.x = pinch.u.x - (mid.x - r.left) / r.width * w;
      gPlotVB.y = pinch.u.y - (mid.y - r.top) / r.height * w;
      gApplyPlotView();
    }
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev =>
    svg.addEventListener(ev, e => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
    })
  );

  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const before = toUser(e.clientX, e.clientY);
    const r = svg.getBoundingClientRect();
    const w = gClampPlotW(gPlotVB.w * (e.deltaY < 0 ? 1 / 1.12 : 1.12));
    gPlotVB.w = gPlotVB.h = w;
    gPlotVB.x = before.x - (e.clientX - r.left) / r.width * w;
    gPlotVB.y = before.y - (e.clientY - r.top) / r.height * w;
    gApplyPlotView();
  }, { passive: false });

  svg.addEventListener('dblclick', gResetPlotView);
}

function groupPlotSVG(pts, m) {
  const size = PLOT_SIZE, pad = 24;
  const reach = Math.max(1.2, ...pts.map(p => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 1.25;
  const k = (size / 2 - pad) / reach;
  const X = v => size / 2 + v * k;
  const Y = v => size / 2 - v * k;
  const bullet = parseFloat(document.getElementById('group-bullet').value);
  const rHole = Math.max((bullet > 0 ? bullet : 0.22) * k / 2, 3);

  // The plot pans and zooms via its viewBox, so hole geometry scales with it while
  // non-scaling-stroke keeps line weights constant. Text carries its base size in
  // data-fs and is counter-scaled in gApplyPlotView(), so labels never balloon.
  const ns = 'vector-effect="non-scaling-stroke"';

  let grid = '';
  for (let r = 1; r <= Math.ceil(reach); r++) {
    grid += `<circle cx="${size / 2}" cy="${size / 2}" r="${r * k}" fill="none" stroke="var(--surface3)" stroke-width="1" ${ns}/>`;
    grid += `<text x="${size / 2 + 3}" y="${Y(r) - 3}" fill="var(--text-dim)" font-family="var(--font-mono)" font-size="8" data-fs="8">${r}"</text>`;
  }
  const esLine = m.esPair
    ? `<line x1="${X(pts[m.esPair[0]].x)}" y1="${Y(pts[m.esPair[0]].y)}" x2="${X(pts[m.esPair[1]].x)}" y2="${Y(pts[m.esPair[1]].y)}" stroke="var(--accent-dim)" stroke-width="1.5" stroke-dasharray="4 3" ${ns}/>`
    : '';
  const holes = pts.map((p, i) => `
    <circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${rHole}" fill="none" stroke="var(--mark-impact)" stroke-width="2" ${ns}/>
    <text x="${X(p.x) + rHole + 3}" y="${Y(p.y) - rHole - 1}" fill="var(--mark-impact)" font-family="var(--font-mono)" font-size="9" data-fs="9">${i + 1}</text>`).join('');

  return `<svg class="group-plot" id="group-plot-svg" viewBox="0 0 ${size} ${size}" role="img"
      aria-label="Shot group plotted against point of aim">
    <rect x="-2000" y="-2000" width="4400" height="4400" fill="var(--surface2)"/>
    ${grid}
    <line x1="${pad / 2}" y1="${size / 2}" x2="${size - pad / 2}" y2="${size / 2}" stroke="var(--surface3)" stroke-width="1" ${ns}/>
    <line x1="${size / 2}" y1="${pad / 2}" x2="${size / 2}" y2="${size - pad / 2}" stroke="var(--surface3)" stroke-width="1" ${ns}/>
    ${esLine}
    <g stroke="var(--mark-poa)" stroke-width="1.5" fill="none" ${ns}>
      <circle cx="${size / 2}" cy="${size / 2}" r="7"/>
      <path d="M${size / 2 - 13} ${size / 2}h6M${size / 2 + 7} ${size / 2}h6M${size / 2} ${size / 2 - 13}v6M${size / 2} ${size / 2 + 7}v6"/>
    </g>
    ${holes}
    <circle cx="${X(m.cx)}" cy="${Y(m.cy)}" r="2.5" fill="var(--accent)"/>
  </svg>`;
}

/* ---- group CRUD ---- */
async function openLogGroup(gunId, groupId, readOnly) {
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;

  G = groupBlank(gunId);
  G.editId = groupId || null;
  gPlotVB = null;   // each group opens at full view rather than inheriting a zoom
  document.getElementById('group-gun-id').value = gunId;
  document.getElementById('group-edit-id').value = groupId || '';
  G.readOnly = !!readOnly && !!groupId;
  // A link already saved on a group was a deliberate choice, so treat it as touched.
  G.sessionTouched = !!(groupId && (gun.groups || []).some(x => x.id === groupId && x.sessionId));
  document.getElementById('group-modal-title').textContent =
    (G.readOnly ? 'Group · ' : groupId ? 'Edit Group · ' : 'Add Group · ') + gun.name;
  document.getElementById('group-date-note').textContent = '';
  document.getElementById('group-file').value = '';

  const existing = groupId && (gun.groups || []).find(x => x.id === groupId);
  document.getElementById('group-date').value = existing ? existing.date : today();
  document.getElementById('group-distance').value = existing ? existing.distance : '';
  document.getElementById('group-distance-unit').value = existing ? (existing.distanceUnit || 'yd') : 'yd';
  document.getElementById('group-cal-mode').value = existing ? (existing.calMode || 'linear') : 'linear';
  document.getElementById('group-cal-w').value = existing ? existing.calInches : 1;
  document.getElementById('group-cal-h').value = existing ? (existing.calInchesH || 1) : 1;
  document.getElementById('group-bullet').value = existing && existing.bulletDia ? existing.bulletDia : '';
  document.getElementById('group-keep-photo').checked = existing ? !!existing.photoId : true;
  groupModalTags = existing && Array.isArray(existing.tags) ? [...existing.tags] : [];
  renderGroupTagChips();
  populateAmmoDropdown(gun, existing ? existing.ammo : '', 'group-ammo-select', 'group-ammo-custom');
  populateGroupSessionDropdown(
    existing ? existing.sessionId : null,
    document.getElementById('group-date').value
  );
  handleGroupCalModeChange();

  if (existing) {
    G.calPts = (existing.calPts || []).map(p => ({ ...p }));
    G.poa = existing.poa ? { ...existing.poa } : null;
    G.impacts = (existing.impacts || []).map(p => ({ ...p }));
    G.photoId = existing.photoId || null;
    G.step = 3;
    if (!document.getElementById('group-bullet').value) {
      const dia = guessBulletDiameter(gun, existing.ammo);
      if (dia) document.getElementById('group-bullet').value = dia;
    }
  } else {
    const dia = guessBulletDiameter(gun, '');
    if (dia) document.getElementById('group-bullet').value = dia;
  }

  gApplyMode();
  gBindStage();

  // Only one modal open at a time (see closeModal) — never stack over Details.
  if (document.getElementById('modal-history').classList.contains('open')) {
    restoreHistoryGunId = gunId;
    closeModal('modal-history');
  }
  openModal('modal-group');
  gRefresh();

  // A stored photo lets you re-mark; without one the numbers still stand on their own.
  if (existing && existing.photoId) {
    const blob = await getPhoto(existing.photoId);
    if (blob) await gLoadImage(blob, false);
    else document.getElementById('group-date-note').textContent =
      'Saved photo is no longer available, so impacts can’t be re-marked. Everything else is still editable.';
  }
}

async function gLoadImage(fileOrBlob, resetMarks) {
  let bmp;
  try {
    bmp = await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image' });
  } catch (e) {
    try {
      bmp = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = rej;
        im.src = URL.createObjectURL(fileOrBlob);
      });
    } catch (e2) { return; }
  }
  G.img = bmp;
  G.imgW = bmp.width;
  G.imgH = bmp.height;
  G.photoBlob = fileOrBlob;
  if (resetMarks) { G.calPts = []; G.poa = null; G.impacts = []; G.step = 0; }

  // Reveal the stage first — a hidden canvas measures 0 wide, and fitting against that
  // puts the image off-screen. Only once it has real dimensions can we size and fit it.
  gRefresh();
  gFitStageWhenSized();
}

// The stage may still be laying out (or the modal mid-open), so retry across a couple of
// frames until the canvas reports a real width rather than fitting against zero.
function gFitStageWhenSized(attempt = 0) {
  requestAnimationFrame(() => {
    if (!G || !G.img) return;
    if (gCanvas().clientWidth > 0) {
      gResizeCanvas();
      gFitImage();
      gDrawCanvas();
    } else if (attempt < 10) {
      gFitStageWhenSized(attempt + 1);
    }
  });
}

// Downscale before storing: a full-resolution phone photo is far larger than this needs.
function gDownscale(bmp) {
  const max = 1200;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.7));
}

async function handleGroupFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  const exif = await readExifDate(file);
  document.getElementById('group-date').value = exif || today();
  document.getElementById('group-date-note').textContent = exif
    ? `Dated from the photo (${fmtDate(exif)}). Change it if that’s wrong.`
    : 'No date found in the photo, so today’s date was used.';

  // Assigning .value above fires no change event, so the session suggestion has to be
  // re-run here. Without this it keeps whatever matched today's date when the modal
  // opened — which doesn't just fail to link, it links the wrong session silently.
  if (G && !G.sessionTouched) {
    populateGroupSessionDropdown(null, document.getElementById('group-date').value);
  }

  await gLoadImage(file, true);
}

async function saveGroup() {
  if (!G || G.readOnly) return;
  const gun = data.firearms.find(g => g.id === G.gunId);
  if (!gun) return;

  const date = document.getElementById('group-date').value;
  const distance = parseFloat(document.getElementById('group-distance').value);
  const calInches = parseFloat(document.getElementById('group-cal-w').value);
  if (!date) { alert('Please select a date.'); return; }
  if (!(distance > 0)) { alert('Please enter the distance to target.'); return; }
  if (!(calInches > 0)) { alert('Please enter the known distance used for scale.'); return; }
  if (G.calPts.length < gNeededCalPoints()) { alert('Please finish marking the scale reference.'); return; }
  if (!G.poa) { alert('Please mark your point of aim.'); return; }
  if (G.impacts.length < 2) { alert('Please mark at least two impacts.'); return; }

  const keepPhoto = document.getElementById('group-keep-photo').checked;
  if (!Array.isArray(gun.groups)) gun.groups = [];
  const existing = G.editId && gun.groups.find(x => x.id === G.editId);

  let photoId = existing ? (existing.photoId || null) : null;
  if (keepPhoto && G.photoBlob && G.img) {
    photoId = photoId || uid();
    await putPhoto(photoId, await gDownscale(G.img));
  } else if (!keepPhoto && photoId) {
    await deletePhoto(photoId);
    photoId = null;
  }

  const record = {
    id: existing ? existing.id : uid(),
    date,
    sessionId: document.getElementById('group-session').value || null,
    distance,
    distanceUnit: document.getElementById('group-distance-unit').value,
    ammo: getSelectedAmmo('group-ammo-select', 'group-ammo-custom'),
    tags: [...groupModalTags],
    bulletDia: parseFloat(document.getElementById('group-bullet').value) || null,
    calMode: document.getElementById('group-cal-mode').value,
    calInches,
    calInchesH: parseFloat(document.getElementById('group-cal-h').value) || null,
    calPts: G.calPts.map(p => ({ x: p.x, y: p.y })),
    poa: { x: G.poa.x, y: G.poa.y },
    impacts: G.impacts.map(p => ({ x: p.x, y: p.y })),
    photoId,
  };

  if (existing) Object.assign(existing, record);
  else gun.groups.push(record);

  save(data);
  G = null;
  closeModal('modal-group');
}

async function deleteGroup(gunId, groupId) {
  if (!confirm('Delete this group?')) return;
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  const g = (gun.groups || []).find(x => x.id === groupId);
  // Drop the photo too, or the blob orphans in IndexedDB and quietly eats space.
  if (g && g.photoId) await deletePhoto(g.photoId);
  gun.groups = (gun.groups || []).filter(x => x.id !== groupId);
  save(data);
  if (currentHistoryGunId === gunId) renderGunHistory(gunId);
}

// ── MODALS ────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
// iOS Safari doesn't reliably repaint stacked position:fixed overlays, so we never keep
// two modals open at once. If closing this modal was standing in for the Details view
// (see openLogCleaning/openLogZero), reopen Details — refreshed — right after.
let restoreHistoryGunId = null;
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (restoreHistoryGunId && id !== 'modal-history') {
    const gunId = restoreHistoryGunId;
    restoreHistoryGunId = null;
    openGunHistory(gunId);
  }
}
// Deliberately no click-outside-to-dismiss. These modals hold half-finished work — a
// stray tap on the backdrop used to discard a group mid-marking. Every modal has an
// explicit Cancel or Close button, so leaving is always a deliberate act.

// ── TABS ──────────────────────────────────────────────────────────
function showTab(name) {
  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  const tabs = ['dashboard','log','sessions','ammo','stats','settings'];
  document.querySelectorAll('nav button')[tabs.indexOf(name)]?.classList.add('active');
  if (name === 'dashboard') renderDashboard();
  if (name === 'log') renderLogForm();
  if (name === 'sessions') renderSessions();
  if (name === 'ammo') renderAmmo();
  if (name === 'stats') renderStats();
  if (name === 'settings') renderSettings();
}

// ── EXPORT / IMPORT ───────────────────────────────────────────────
function exportJSON() {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `range-log-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCSV() {
  const rows = [['Date','Location','Firearm','Caliber','Rounds','Notes']];
  const sorted = [...data.sessions].sort((a,b) => a.date.localeCompare(b.date));
  sorted.forEach(s => {
    const loc = data.locations.find(l => l.id === s.locationId);
    Object.entries(s.rounds).forEach(([gid, r]) => {
      const gun = data.firearms.find(g => g.id === gid);
      rows.push([
        s.date,
        loc ? loc.name : '',
        gun ? gun.name : gid,
        gun ? gunCaliberLabel(gun) : '',
        r,
        (s.notes || '').replace(/,/g,'')
      ]);
    });
  });
  const csv = rows.map(r => r.join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `range-log-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJSON(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.schemaVersion || !imported.firearms || !imported.sessions) {
        alert('Invalid backup file.'); return;
      }
      if (!confirm('This will replace all current data with the imported backup. Continue?')) return;
      data = migrateData(imported);
      save(data);
      renderAll();
      // Photos aren't in the backup, so whatever the incoming records don't reference is
      // now unreachable. Sweep rather than wipe: re-importing your own backup on this
      // device keeps its photos, because those ids still match.
      const reclaimed = await sweepOrphanedPhotos();
      alert('Import successful!' + (reclaimed
        ? `\n\n${reclaimed} photo${reclaimed > 1 ? 's' : ''} no longer referenced by any group ` +
          `${reclaimed > 1 ? 'were' : 'was'} removed.`
        : ''));
    } catch { alert('Could not read file. Make sure it is a valid Range Log JSON backup.'); }
  };
  reader.readAsText(file);
  input.value = '';
}

// ── GROUP TAGS ────────────────────────────────────────────────────
// Freeform labels so a group can be described along whatever dimension matters — prone
// vs bench, bipod vs bags, windy — without inventing a schema field per idea. Matching is
// case-insensitive so "Prone" reuses "prone" rather than quietly creating a rival tag,
// which would break any comparison built on them.
let groupModalTags = [];

function allKnownTags() {
  const seen = new Map();   // lowercase -> first spelling used, so casing stays stable
  (data.firearms || []).forEach(gun => (gun.groups || []).forEach(g => {
    (g.tags || []).forEach(t => {
      const k = String(t).trim().toLowerCase();
      if (k && !seen.has(k)) seen.set(k, String(t).trim());
    });
  }));
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function renderGroupTagChips() {
  const container = document.getElementById('group-tags-chips');
  const viewing = !!(G && G.readOnly);
  if (!groupModalTags.length) {
    container.innerHTML = `<div class="chips-empty">${viewing ? 'NO TAGS' : 'NO TAGS ADDED'}</div>`;
  } else {
    container.innerHTML = groupModalTags.map((t, i) =>
      `<span class="chip">${t}${viewing ? '' : `<span class="remove-x" onclick="removeGroupTag(${i})">×</span>`}</span>`
    ).join('');
  }

  const sel = document.getElementById('group-tag-add-select');
  const known = allKnownTags().filter(t =>
    !groupModalTags.some(x => x.trim().toLowerCase() === t.trim().toLowerCase()));
  sel.innerHTML =
    '<option value="">— Add tag —</option>' +
    known.map(t => `<option value="${t.replace(/"/g, '&quot;')}">${t}</option>`).join('') +
    '<option value="__new__">+ New tag...</option>';
  const custom = document.getElementById('group-tag-custom');
  custom.style.display = 'none';
  custom.value = '';
}

function removeGroupTag(idx) {
  groupModalTags.splice(idx, 1);
  renderGroupTagChips();
}

function addGroupTagFromSelect() {
  const sel = document.getElementById('group-tag-add-select');
  const custom = document.getElementById('group-tag-custom');
  let val = sel.value;
  if (val === '__new__') {
    val = custom.value.trim();
    if (!val) { custom.style.display = 'block'; custom.focus(); return; }
  }
  val = val.trim().replace(/\s+/g, ' ');
  if (!val) return;
  // Reuse the existing spelling of a tag that already exists, so casing never forks.
  const existing = allKnownTags().find(t => t.toLowerCase() === val.toLowerCase());
  const tag = existing || val;
  if (groupModalTags.some(x => x.toLowerCase() === tag.toLowerCase())) { renderGroupTagChips(); return; }
  groupModalTags.push(tag);
  renderGroupTagChips();
}

document.addEventListener('change', e => {
  if (e.target && e.target.id === 'group-tag-add-select') {
    const custom = document.getElementById('group-tag-custom');
    if (e.target.value === '__new__') { custom.style.display = 'block'; custom.focus(); }
    else { custom.style.display = 'none'; custom.value = ''; }
  }
});

// ── PHOTO STORAGE READOUT ─────────────────────────────────────────
// Answers "how much is this actually using" with measured numbers rather than a guess,
// and surfaces orphans, which are otherwise invisible by definition.
function fmtBytes(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}

async function renderPhotoStorage() {
  const el = document.getElementById('photo-storage');
  if (!el) return;

  const stats = await photoStoreStats();
  let quotaLine = '';
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { quota } = await navigator.storage.estimate();
      if (quota) {
        // Only the quota is reported here. Safari's `usage` figure under-reports badly —
        // it showed 320 KB against 3.9 MB of photos actually stored — because it doesn't
        // appear to count IndexedDB blobs, which it keeps as separate files. The totals
        // above are summed from the blobs themselves, so they're the honest numbers.
        quotaLine = `<div class="photo-stat-sub">Measured from the stored images.
          This device allows this app about ${fmtBytes(quota)}.</div>`;
      }
    }
  } catch (e) { /* estimate is advisory; its absence isn't worth surfacing */ }

  const orphanBlock = stats.orphans ? `
    <div class="photo-orphans">
      <div>${stats.orphans} photo${stats.orphans > 1 ? 's are' : ' is'} no longer attached to any
        group, so nothing can display ${stats.orphans > 1 ? 'them' : 'it'}.</div>
      <button class="btn-mini" style="margin-top:8px;" onclick="reclaimOrphanedPhotos()">Reclaim space</button>
    </div>` : '';

  el.innerHTML = `
    <div class="photo-stats">
      <div class="photo-stat">
        <div class="photo-stat-num">${stats.count}</div>
        <div class="photo-stat-label">Photos stored</div>
      </div>
      <div class="photo-stat">
        <div class="photo-stat-num">${fmtBytes(stats.bytes)}</div>
        <div class="photo-stat-label">Total size</div>
      </div>
      <div class="photo-stat">
        <div class="photo-stat-num">${stats.count ? fmtBytes(Math.round(stats.bytes / stats.count)) : '—'}</div>
        <div class="photo-stat-label">Average</div>
      </div>
    </div>
    ${quotaLine}
    ${orphanBlock}`;
}

async function reclaimOrphanedPhotos() {
  const n = await sweepOrphanedPhotos();
  await renderPhotoStorage();
  alert(n ? `Removed ${n} unattached photo${n > 1 ? 's' : ''}.` : 'Nothing to reclaim.');
}

// ── PHOTO BUNDLE ──────────────────────────────────────────────────
// Photos are deliberately absent from the JSON backup, which keeps that file small enough
// to email. This is the opt-in companion for moving them between devices: import the JSON
// first so the records exist, then this restores the images they point at.

function blobToDataURL(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function exportPhotos() {
  const keys = await allPhotoKeys();
  if (!keys.length) { alert('No photos are stored, so there is nothing to export.'); return; }

  const photos = {};
  for (const id of keys) {
    const blob = await getPhoto(id);
    if (blob) photos[id] = await blobToDataURL(blob);
  }

  const payload = { type: 'range-log-photos', version: 1, exported: today(), photos };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `range-log-photos-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importPhotos(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const payload = JSON.parse(e.target.result);
      if (payload.type !== 'range-log-photos' || !payload.photos) {
        alert('That is not a Range Log photo bundle. Photo bundles are exported separately from the JSON backup.');
        return;
      }
      const wanted = referencedPhotoIds();
      let restored = 0, skipped = 0;
      for (const [id, dataUrl] of Object.entries(payload.photos)) {
        // Only restore images some group actually points at, or importing an old bundle
        // would put back exactly the orphans this feature exists to clear out.
        if (!wanted.has(id)) { skipped++; continue; }
        const res = await fetch(dataUrl);
        await putPhoto(id, await res.blob());
        restored++;
      }
      renderAll();
      alert(`${restored} photo${restored === 1 ? '' : 's'} restored.` +
        (skipped ? `\n\n${skipped} skipped — no group in this data refers to them.` : ''));
    } catch {
      alert('Could not read that photo bundle.');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

// ── INIT ──────────────────────────────────────────────────────────
function renderAll() {
  renderDashboard();
  renderLogForm();
  renderSessions();
  renderAmmo();
  renderStats();
  renderSettings();
}

renderDashboard();
renderLogForm();

// ── SERVICE WORKER & UPDATE CHECK ─────────────────────────────────
const APP_VERSION = '6.3';

function showUpdateBanner() {
  const banner = document.getElementById('update-banner');
  if (banner) banner.classList.add('open');
}

function applyUpdate() {
  if (navigator.serviceWorker && navigator.serviceWorker.controller) {
    // Ask waiting SW to skip waiting, then reload once controller changes
    navigator.serviceWorker.getRegistration().then(reg => {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      } else {
        window.location.reload();
      }
    });
  } else {
    window.location.reload();
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(reg => {
        // Check for updates immediately and every 30 minutes while open
        reg.update();
        setInterval(() => reg.update(), 30 * 60 * 1000);

        // A new SW has been found and is installing
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New version ready and waiting — show banner
              showUpdateBanner();
            }
          });
        });

        // On page load, if a SW is already waiting, show banner
        if (reg.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner();
        }
      })
      .catch(err => console.log('SW registration failed:', err));

    // Reload once the new SW takes control
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}
