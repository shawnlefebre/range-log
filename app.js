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
//     Marked points are normalized by image WIDTH on both axes (so aspect is preserved
//     and they stay valid at any resolution, with or without the photo). Group size,
//     mean radius, W/H and offsets are always recomputed, never stored.
// v10: group.sessionId added — links a group to the range session it was shot at, or
//      null when unlinked. Existing groups are auto-linked only where a single session
//      shares their date; anything ambiguous stays null rather than guessing.
// v11: group.tags added — freeform labels (prone, bench, bipod, wind...) so a group can
//      be described along whatever dimension matters, without a new field per idea.
// v12: gun.opticUnit added — 'moa' | 'mrad' | null. Chooses which angular unit leads the
//      point-of-aim offsets, so they match the turret you actually dial. Group size stays
//      MOA regardless, since that figure is compared across firearms.
// v15: ammo.usedUpDate added — when a lot ran out, or null for "used up, date unknown",
//      which is every lot that was already used up before this existed. Deliberately not
//      cleared when a purchase is toggled back to in stock, so an accidental un-toggle and
//      re-toggle is lossless rather than silently restamping the date as today.
// v14: ammo.rangeAmmo added — false for carry/defensive/match. Stored positively while the
//      checkbox reads "Not range ammo", because everything you buy is range ammo unless you
//      say otherwise. Per-round price figures exclude the false ones; totals include them.
// v13: gun.dope array added — manually entered come-up tables, one per ammo, each
//      {id, ammo, unit, zeroDistance, distanceUnit, conditions, entries[{distance, come}]}.
//      The app never computes ballistics; numbers come from whatever solver the user
//      trusts and are edited by hand.
const SCHEMA_VERSION = 15;

// The sentinel value for the "type your own" entry in every picker that offers one —
// calibers, ammo, optics, tags. These once used two different sentinels, so forms that look
// identical behaved differently and a test that set the wrong one failed for a reason that
// had nothing to do with what it was testing. Keep it to this one constant; a test asserts
// no second sentinel appears anywhere in this file. It is never stored — the handlers swap
// in the typed text before saving.
const CUSTOM_OPTION = '__custom__';

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
// manual override in the group form for anything it doesn't recognize.
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

// Resolves a caliber string to a bullet diameter, or null when it isn't recognized.
function caliberDiameter(caliber) {
  if (!caliber) return null;
  const key = String(caliber).trim().toLowerCase();
  return CALIBER_DIAMETERS[key] ?? null;
}

// Best guess for a group's bullet diameter: the chosen ammo's caliber first, then the
// firearm's primary caliber. Returns null when neither is recognized, leaving it to
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
    { id: g1, name: 'Example Rifle', type: 'rifle', calibers: ['.223 Rem', '5.56 NATO'], opticUnit: 'mrad', cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [], groups: [], dope: [], notes: 'Action screws: 65 in-lbs, front then rear.' },
    { id: g2, name: 'Example Pistol', type: 'pistol', calibers: ['9mm'], cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [], groups: [], dope: [], notes: '' },
    { id: g3, name: 'Example Revolver', type: 'revolver', calibers: ['.357 Mag', '.38 Special'], cleanThreshold: 300, totalRounds: 0, cleanings: [], zeros: [], groups: [], dope: [], notes: '' },
    { id: g4, name: 'Example Shotgun', type: 'shotgun', calibers: ['12 Gauge'], cleanThreshold: 500, totalRounds: 0, cleanings: [], zeros: [], groups: [], dope: [], notes: '' },
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
        sellerId: (i % 2 === 0) ? s1 : s2, status: i < 9 ? 'usedup' : 'instock',
        rangeAmmo: true, notes: '',
      });
    }
  }

  // One small, expensive carry-ammo purchase. Without it nothing in the demo would exercise
  // the per-round exclusion, and a rule nobody can see is a rule nobody trusts.
  if (ammo.length) {
    const nine = ammoOptions.find(o => o.caliber === '9mm') || ammoOptions[0];
    ammo.push({
      id: 'dammo_carry', date: ammo[ammo.length - 1].date, caliber: nine.caliber,
      manufacturer: nine.manufacturer, model: 'Defender JHP 124gr', quantity: 20,
      totalPrice: 27.99, sellerId: s1, status: 'instock', rangeAmmo: false,
      notes: 'Carry load — not shot for practice.',
    });
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

  // Sample groups so the feature is discoverable on a fresh load. They hang off real
  // sessions the rifle actually shot at, spread across the whole year rather than piled on
  // one day — a Group Size Over Time chart with a single point demonstrates nothing.
  // Points are normalized by image width; 0.10 normalized units == 1 inch at this scale.
  {
    // Every range day the rifle actually went out on, oldest first.
    const rifleDays = [...sessions]
      .filter(s => (s.rounds[g1] || 0) > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    // Fixed seed so demo data stays identical run to run, but scattered like real
    // shooting rather than a perfect circle — including a slight high-right bias, since
    // a group sitting exactly on the aim point is not what a real target looks like.
    let seed = 20260817;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 2;

    // The story the sample data tells: bulk FMJ off bags to begin with, a match load and a
    // fresh zero around the middle of the year, and groups tightening as both settle in.
    // Roughly 1.5 MOA at 50 yd down to 0.8 — a believable year, not a straight line.
    const FMJ = 'Example Ammo Co 55gr FMJ';
    const MATCH = 'Example Match 69gr HPBT';
    const rezeroAt = Math.floor(rifleDays.length / 2);
    // Enough day-to-day scatter to look like shooting, not so much that it buries the
    // year's improvement — the chart is meant to demonstrate a readable trend.
    const wobble = [0.002, 0.005, -0.003, 0.004, -0.002, 0.003, -0.004, 0.002, 0.005, -0.003];

    let gi = 0;
    rifleDays.forEach((host, di) => {
      // Not every trip is a group-shooting trip; skipping a couple keeps the trend honest
      // about range days rather than implying you test loads every single time out.
      if (di % 5 === 4) return;
      const settled = di >= rezeroAt;
      // Base dispersion improves across the year, with the load change helping a little.
      const base = 0.088 - (di / Math.max(1, rifleDays.length - 1)) * 0.038
        + wobble[di % wobble.length] + (settled ? -0.004 : 0);

      // Two or three groups a day: bench off bags, then prone off a bipod, which is
      // realistically a touch worse. Every few trips one gets shot at 100 instead of 50.
      const shots = [
        { tags: ['bench', 'bags'], mult: 1.00, ammo: settled ? MATCH : FMJ, distance: 50 },
        { tags: ['prone', 'bipod'], mult: 1.18, ammo: settled ? MATCH : FMJ, distance: 50 },
      ];
      if (di % 3 === 1) {
        shots.push({ tags: ['bench', 'bags'], mult: 1.06,
          ammo: settled ? FMJ : MATCH, distance: 100 });
      }

      shots.forEach(s => {
        const sd = Math.max(0.030, base * s.mult);
        const impacts = [0, 1, 2, 3, 4].map(() => ({
          x: 0.5 + 0.012 + gauss() * sd,
          y: 0.5 - 0.010 + gauss() * sd,
        }));
        firearms[0].groups.push({
          id: `dgroup_${gi++}`,
          date: host.date,
          sessionId: host.id,
          distance: s.distance,
          distanceUnit: 'yd',
          ammo: s.ammo,
          tags: s.tags,
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
    });

    // Two zeros on the rifle: the original, and the re-zero that goes with the load change.
    // Without these the Zeros section is empty and the trend chart never shows the marker
    // that explains why the groups shift.
    if (rifleDays.length) {
      firearms[0].zeros.push({
        id: 'dzero_1',
        date: rifleDays[0].date,
        distance: 100,
        distanceUnit: 'yd',
        ammo: FMJ,
        optic: 'Example 3-18x',
        notes: 'Initial zero, bulk ammo.',
      });
      if (rifleDays[rezeroAt]) {
        firearms[0].zeros.push({
          id: 'dzero_2',
          date: rifleDays[rezeroAt].date,
          distance: 100,
          distanceUnit: 'yd',
          ammo: MATCH,
          optic: 'Example 3-18x',
          notes: 'Re-zeroed for the match load.',
        });
      }
    }
  }

  // A sample dope table on the rifle, in mils to match its opticUnit. Numbers are
  // illustrative — the app never calculates these, they're always entered by hand.
  firearms[0].dope.push({
    id: 'ddope_1',
    ammo: 'Example Ammo Co 55gr FMJ',
    unit: 'mrad',
    zeroDistance: 100,
    distanceUnit: 'yd',
    conditions: 'trued at 900 ft, 70\u00b0F',
    entries: [
      { distance: 200, come: 0.6 },
      { distance: 300, come: 1.5 },
      { distance: 400, come: 2.7 },
      { distance: 500, come: 4.1 },
      { distance: 600, come: 5.8 },
    ],
  });

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

// ── TEXT SIZE ─────────────────────────────────────────────────────
// Every size in the stylesheet is a rem, so the root font size scales the entire app at once
// and the hierarchy is preserved exactly. Note that `body { font-size }` cannot do this —
// rem measures against the root, not the body, which is why the app's 15px body rule never
// had any effect on it.
//
// Stored per device rather than in the backup: it describes this screen and these eyes, not
// the shooting record, and restoring a backup on a different device should not carry it over.
const TEXT_SIZES = [
  { key: 'normal',  label: 'Normal',  px: 16 },
  { key: 'large',   label: 'Large',   px: 20 },
  { key: 'larger',  label: 'Larger',  px: 24 },
  { key: 'largest', label: 'Largest', px: 28 },
];
const TEXT_SIZE_KEY = 'rangeLogTextSize';
// Large is the default: the app shipped at 16, where its typical text renders around 11px,
// which is below comfortable reading on a phone.
const DEFAULT_TEXT_SIZE = 'large';

function currentTextSize() {
  const stored = localStorage.getItem(TEXT_SIZE_KEY);
  return TEXT_SIZES.some(t => t.key === stored) ? stored : DEFAULT_TEXT_SIZE;
}

function applyTextSize(key) {
  const size = TEXT_SIZES.find(t => t.key === (key || currentTextSize())) || TEXT_SIZES[1];
  document.documentElement.style.fontSize = size.px + 'px';
  syncStickyOffsets();
}

// The nav sits below the header, both sticky. The nav's offset was a hard 57px, which is the
// header's height at the original text size only — scale the text up and the nav rode up
// over the top of the content beneath it. Measure the header instead of guessing.
function syncStickyOffsets() {
  const header = document.querySelector('header');
  if (!header) return;
  const set = () => document.documentElement.style.setProperty(
    '--header-h', Math.round(header.getBoundingClientRect().height) + 'px');
  set();
  // Fonts land after first paint and change the height, so measure again once they have.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(set).catch(() => {});
  requestAnimationFrame(set);
}

function setTextSize(key) {
  if (!TEXT_SIZES.some(t => t.key === key)) return;
  localStorage.setItem(TEXT_SIZE_KEY, key);
  applyTextSize(key);
  renderTextSizePicker();
}

function renderTextSizePicker() {
  const el = document.getElementById('textsize-picker');
  if (!el) return;
  const cur = currentTextSize();
  el.innerHTML = TEXT_SIZES.map(t => `
    <button type="button" class="textsize-opt${t.key === cur ? ' active' : ''}"
            aria-pressed="${t.key === cur}" onclick="setTextSize('${t.key}')">${t.label}</button>`).join('');
  const sample = document.getElementById('textsize-sample');
  if (sample) {
    sample.innerHTML = `
      <div class="textsize-sample-row"><span>Jun 13, 2026</span><b>$94.83</b></div>
      <div class="textsize-sample-sub">200 rounds at $0.474/rd · Example Rod and Gun Club</div>`;
  }
}

// ── STORAGE ──────────────────────────────────────────────────────
// Set at startup when stored data was found but could not be read. The raw text is held in
// memory as well as copied aside, so the download works even on a device too full to accept
// the copy — which is exactly the situation where a truncated write happened in the first place.
let recoveryState = null;

const UNREADABLE_PREFIX = 'rangeLogData-unreadable-';

// Puts the unreadable text somewhere it will survive the next save, without touching the
// original key.
//
// Idempotent by content: startup runs more than once against the same unreadable value —
// the service worker reloads the page after it installs an update, and the user can refresh
// as often as they like while the banner is up. Copying again each time would multiply a
// full copy of the record at precisely the moment the device may be short of room. A
// genuinely different unreadable value still gets its own key rather than overwriting the
// earlier copy, which by then is the more valuable of the two.
function quarantineUnreadable(raw, err) {
  let key = Object.keys(localStorage).find(
    k => k.startsWith(UNREADABLE_PREFIX) && localStorage.getItem(k) === raw) || null;
  let stored = !!key;

  if (!stored) {
    key = UNREADABLE_PREFIX + today();
    for (let n = 2; localStorage.getItem(key) !== null; n++) key = `${UNREADABLE_PREFIX}${today()}-${n}`;
    try { localStorage.setItem(key, raw); stored = true; } catch (e) { key = null; }
  }

  recoveryState = {
    raw, stored, key,
    bytes: raw.length,
    reason: (err && err.message) || String(err),
    dismissed: false,
  };
}

function load() {
  const raw = localStorage.getItem('rangeLogData');
  // Nothing stored, or stored empty: a genuine first run, and there is nothing to recover.
  if (raw === null || !raw.trim()) return buildDefaultData();
  try {
    const d = JSON.parse(raw);
    return migrateData(d);
  } catch (e) {
    // Stored data exists and could not be read. Handing back demo data here — which is what
    // buildDefaultData does — would both disguise the failure as a fresh install and, on the
    // very next save, overwrite the only copy of the real thing. Set it aside and start
    // empty instead, so the app is honest about the state and nothing is lost silently.
    quarantineUnreadable(raw, e);
    return buildEmptyData();
  }
}

// A blank slate that is explicitly not demo data. Shared by the wipe and by recovery, so
// "empty" means one thing.
function buildEmptyData() {
  return {
    schemaVersion: SCHEMA_VERSION,
    isDemo: false,
    firearms: [],
    locations: [],
    sellers: [],
    sessions: [],
    ammo: [],
  };
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
    if (!Array.isArray(gun.dope)) gun.dope = [];
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

  // v11 -> v12: add the optic unit, unset until the user says otherwise
  if (d.schemaVersion === 11) {
    d.firearms.forEach(gun => { if (gun.opticUnit === undefined) gun.opticUnit = null; });
    d.schemaVersion = 12;
  }

  // v12 -> v13: add the dope array
  if (d.schemaVersion === 12) {
    d.firearms.forEach(gun => { if (!Array.isArray(gun.dope)) gun.dope = []; });
    d.schemaVersion = 13;
  }

  // v13 -> v14: everything already logged was bought to shoot, so default it to range ammo.
  if (d.schemaVersion === 13) {
    (d.ammo || []).forEach(a => {
    if (a.rangeAmmo === undefined) a.rangeAmmo = true;
    if (a.usedUpDate === undefined) a.usedUpDate = null;
  });
    d.schemaVersion = 14;
  }

  // v14 -> v15: nothing to backfill. A lot already marked used up ran out at an unknown
  // time, and inventing a date would be worse than admitting that.
  if (d.schemaVersion === 14) {
    (d.ammo || []).forEach(a => { if (a.usedUpDate === undefined) a.usedUpDate = null; });
    d.schemaVersion = 15;
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
    if (gun.opticUnit === undefined) gun.opticUnit = null;
  });
  if (!Array.isArray(d.ammo)) d.ammo = [];
  if (!Array.isArray(d.sellers)) d.sellers = [];
  if (d.isDemo === undefined) d.isDemo = false;
  (d.ammo || []).forEach(a => { if (a.rangeAmmo === undefined) a.rangeAmmo = true; });

  return d;
}

// Returns whether the write landed. A failure here is otherwise completely invisible: the
// in-memory `data` has already been mutated and the caller re-renders from it, so the app
// shows the change and looks saved right up until the next reload drops it. Quota is the
// usual cause; Safari with storage blocked throws here too.
function save(d) {
  try {
    localStorage.setItem('rangeLogData', JSON.stringify(d));
    return true;
  } catch (e) {
    console.error('Range Log: could not write to localStorage', e);
    alert('Could not save — this device would not accept the write.\n\n' +
      'Your last change is on screen but is not stored yet, so do not reload. ' +
      'Export a backup from Setup to keep it. If storage is full, Setup also has a ' +
      'photo storage readout and a way to reclaim space.');
    return false;
  }
}

applyTextSize();
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
function clearAllPhotos() {
  return photoTx('readwrite', s => s.clear())
    .then(r => { availablePhotoIds = new Set(); return r; })
    .catch(() => null);
}

// Every photoId currently referenced by a group. Anything in the store outside this set
// is unreachable — no screen can show it and nothing will ever delete it.
function referencedPhotoIds(d = data) {
  const ids = new Set();
  (d.firearms || []).forEach(gun => (gun.groups || []).forEach(g => {
    if (g.photoId) ids.add(g.photoId);
  }));
  return ids;
}

// Which photos are actually in the store. A group's photoId stays a perfectly good string
// after its blob is gone — a backup restored without its photo bundle, or the shared-photo
// bug this cache was added alongside — so `g.photoId` answers "did this group ever have a
// photo", not "can it be shown". The lists render synchronously and IndexedDB is async, so
// the answer is cached here rather than awaited per row.
//
// Derived, never persisted: refreshed from the store itself at startup and after every
// write or delete, so it cannot drift into disagreeing with what is really there.
let availablePhotoIds = new Set();

async function refreshAvailablePhotoIds() {
  availablePhotoIds = new Set(await allPhotoKeys());
  return availablePhotoIds;
}

function hasPhoto(group) {
  return !!(group && group.photoId && availablePhotoIds.has(group.photoId));
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
  await refreshAvailablePhotoIds();
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

// The inverse of an orphan: a group pointing at a photo the store no longer has. Orphans
// waste space and are invisible; these cost nothing but quietly remove the ability to
// re-mark, and until now there was no way to find them short of opening every group.
//
// Keyed by photoId rather than by group, because one target is one thing to fix — restoring
// it repairs every group marked on it, so listing them separately would overstate the work.
function missingPhotoTargets() {
  const byPhoto = new Map();
  (data.firearms || []).forEach(gun => (gun.groups || []).forEach(g => {
    if (!g.photoId || availablePhotoIds.has(g.photoId)) return;
    const t = byPhoto.get(g.photoId)
      || { photoId: g.photoId, gunId: gun.id, gunName: gun.name, groups: [] };
    t.groups.push(g);
    byPhoto.set(g.photoId, t);
  }));
  return [...byPhoto.values()]
    .map(t => {
      const dates = [...new Set(t.groups.map(g => g.date))].sort();
      return { ...t, dates, openId: t.groups[0].id };
    })
    .sort((a, b) => (b.dates[0] || '').localeCompare(a.dates[0] || ''));
}

// ── UTILS ─────────────────────────────────────────────────────────
function uid() { return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }

// The app's one definition of a calendar day, and it is always the *local* one.
// Never toISOString().slice(0,10) here: that is the UTC day, which is already tomorrow
// for anyone west of Greenwich during their evening — so a range trip logged after dark
// would prefill with tomorrow's date, and Stats range ends would land a day past the
// local-basis range starts that firstOfMonthISO/firstOfYearISO produce.
function localISODate(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function today() { return localISODate(new Date()); }

// Everything a person types here — firearm names, notes, tags, ammo and optic labels — is
// interpolated into template literals and handed to innerHTML. Anything user-typed must go
// through this on the way in.
//
// The everyday failure is not an attack, it is a note like "Grouped <MOA all day": the
// parser reads "<MOA " as an unclosed tag and swallows the rest of the line, so the text is
// safe in localStorage but invisible on screen, which reads as lost data. Escaping quotes
// matters for the same reason inside title="..." attributes. Backups are files that get
// mailed between devices and imported, so this is the injection boundary too.
function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
  // Takes precedence: if startup could not read the stored data, that is the only thing
  // worth saying on this screen.
  if (recoveryState && !recoveryState.dismissed) {
    container.innerHTML = recoveryBannerHTML();
    return;
  }
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

// ── UNREADABLE-DATA RECOVERY ──────────────────────────────────────
// Shown when startup found stored data it could not parse. The point of the wording is that
// nothing has been thrown away yet and the user still has to act: a copy set aside in
// localStorage survives the next save, but if the device had no room for one it exists only
// until this tab closes.
function recoveryBannerHTML() {
  const r = recoveryState;
  const where = r.stored
    ? `A copy is set aside on this device and the app has started empty.
       Download it before entering anything new.`
    : `<span class="recovery-warn">This device had no room to set a copy aside, so it only
       exists until you close this tab</span> — download it now.`;
  const detail = [r.stored ? r.key : null, fmtBytes(r.bytes), r.reason]
    .filter(Boolean).map(esc).join(' · ');
  return `
    <div class="demo-banner recovery">
      <div class="demo-banner-title">⚠ Saved data could not be read</div>
      <div class="demo-banner-text">
        Range Log found saved data on this device but could not open it, so it has
        <b>not</b> been overwritten. ${where}
      </div>
      <div class="recovery-detail">${detail}</div>
      <div class="demo-banner-actions">
        <button class="btn-demo btn-demo-keep" onclick="downloadUnreadableData()">Download Copy</button>
        <button class="btn-demo" onclick="dismissRecoveryNotice()">Dismiss</button>
      </div>
    </div>`;
}

// Served from the in-memory copy, so this works whether or not the set-aside write landed.
function downloadUnreadableData() {
  if (!recoveryState) return;
  const blob = new Blob([recoveryState.raw], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `range-log-unreadable-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// Hides the notice only. The copy stays where it is — dismissing a warning is not the same
// as agreeing to throw the data away, and Delete All Data is where that decision lives.
function dismissRecoveryNotice() {
  if (!recoveryState) return;
  if (!recoveryState.stored &&
      !confirm('The only copy of that data is in this tab. If you dismiss without ' +
               'downloading it, closing the tab loses it for good.\n\nDismiss anyway?')) return;
  recoveryState.dismissed = true;
  renderDemoBanner();
}

function wipeAllData() {
  data = buildEmptyData();
  save(data);
  // Without this every photo blob survives the wipe, unreachable and invisible — the app
  // looks empty while still holding every image it ever stored.
  clearAllPhotos();
  // Same reasoning for a set-aside copy of unreadable data: it is a full copy of the
  // record, so "delete everything" has to mean it too, or the app reports itself empty
  // while still holding the lot.
  discardRecoveryCopies();
  renderAll();
}

// Removes every set-aside copy and the in-memory one. Separate from the banner's Dismiss,
// which only stops showing the notice.
function discardRecoveryCopies() {
  Object.keys(localStorage)
    .filter(k => k.startsWith(UNREADABLE_PREFIX))
    .forEach(k => localStorage.removeItem(k));
  recoveryState = null;
}

function clearDemoData() {
  if (!confirm('This will permanently delete all sample data (firearms, sessions, ammo, everything) and start you with a blank app. This cannot be undone. Continue?')) return;
  wipeAllData();
}

// ── LOAD DEMO DATA (Settings) ──────────────────────────────────────
// Demo data is generated on first launch and never comes back once cleared, so there was
// no way to get a populated app for a screenshot or to try a feature out. This restores it.

// Anything the user could have entered themselves. Derived counters aren't consulted —
// a firearm with no sessions is still something you'd be upset to lose.
function hasAnyStoredData() {
  return ['firearms', 'locations', 'sellers', 'sessions', 'ammo']
    .some(k => (data[k] || []).length > 0);
}

function openLoadDemoModal() {
  // With an empty app there is nothing at stake, so making you type a word would be
  // ceremony. With real records in it, this is as destructive as Delete All and gets the
  // same treatment.
  if (!hasAnyStoredData()) {
    if (!confirm('Load the built-in sample data? The app is currently empty, so nothing is lost.')) return;
    loadDemoData();
    return;
  }
  const input = document.getElementById('load-demo-confirm-input');
  input.value = '';
  updateLoadDemoButtonState();
  openModal('modal-load-demo');
  setTimeout(() => input.focus(), 50);
}

function updateLoadDemoButtonState() {
  const input = document.getElementById('load-demo-confirm-input');
  const btn = document.getElementById('load-demo-confirm-btn');
  const match = input.value === 'DEMO';
  btn.style.opacity = match ? '1' : '0.4';
  btn.style.pointerEvents = match ? 'auto' : 'none';
}

function confirmLoadDemo() {
  if (document.getElementById('load-demo-confirm-input').value !== 'DEMO') return;
  loadDemoData();
  closeModal('modal-load-demo');
}

function loadDemoData() {
  data = buildDefaultData();
  save(data);
  // Demo groups reference no photos, so anything still in IndexedDB would be an orphan
  // the app can neither show nor reclaim through normal use.
  clearAllPhotos();
  renderAll();
  // isDemo is true again, so the banner returns — and with it "Keep This Data", which is
  // already the way sample data becomes your own.
  showTab('dashboard');
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
            <div class="gun-name">${esc(gun.name)}</div>
          </div>
          <div class="gun-caliber">${esc(gunCaliberLabel(gun))}</div>
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
    data.locations.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('');

  const gunInputs = document.getElementById('gun-inputs');
  gunInputs.innerHTML = data.firearms.map(gun => `
    <div class="gun-row">
      <div>
        <label>${esc(gun.name)}</label>
        <div class="caliber-tag">${esc(gunCaliberLabel(gun))}</div>
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
  const pricer = buildCaliberPricer();
  el.innerHTML = sorted.map(s => {
    const loc = data.locations.find(l => l.id === s.locationId);
    const money = sessionCost(s, pricer);
    const rounds = s.rounds && typeof s.rounds === 'object' ? s.rounds : {};
    const pills = Object.entries(rounds).map(([gid, r]) => {
      const gun = data.firearms.find(g => g.id === gid);
      return `<div class="session-gun-pill">${gun ? esc(gun.name) : 'Unknown'} <span>${r}</span></div>`;
    }).join('');
    return `
      <div class="session-card tappable" onclick="openViewSession('${s.id}')"
           role="button" tabindex="0" title="View this session">
        <div class="session-header">
          <div class="session-date">${fmtDate(s.date)}</div>
          <div style="display:flex;align-items:center;gap:10px;">
            <div class="session-total">${s.totalRounds} rds${
              money.cost > 0 ? ` <span class="session-cost" title="Estimated from the average price of range ammo for each firearm's chambering">~$${money.cost.toFixed(2)}</span>` : ''
            }</div>
            <button class="btn-icon" onclick="event.stopPropagation(); openEditSession('${s.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="event.stopPropagation(); deleteSession('${s.id}')" title="Delete">🗑</button>
          </div>
        </div>
        ${s.locationId ? `<div class="session-location">${loc ? esc(loc.name) : 'Unknown location'}</div>` : ''}
        <div class="session-rounds">${pills}</div>
        ${s.notes ? `<div class="session-notes">${esc(s.notes)}</div>` : ''}
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
    const sub = [esc(r.group.ammo), `${r.group.distance} ${r.group.distanceUnit || 'yd'}`,
                 `${(r.group.impacts || []).length} shots`].filter(Boolean).join(' · ');
    return `
      <div class="scorecard-row">
        <div class="scorecard-main">
          <div class="scorecard-gun">${esc(r.gun.name)}</div>
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
        <div class="list-item-name">${esc(gun.name)}</div>
        <div class="list-item-sub">${esc(gunCaliberLabel(gun))} · Clean every ${gun.cleanThreshold} rds</div>
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
        <div class="list-item-name">${esc(loc.name)}</div>
      </div>
      <button class="btn-icon" onclick="deleteLocation('${loc.id}')" title="Delete">🗑</button>
    </div>
  `).join('') || '<div class="empty-state">No locations.</div>';

  const sl = document.getElementById('sellers-settings-list');
  const sellers = data.sellers || [];
  sl.innerHTML = sellers.map(seller => `
    <div class="list-item">
      <div class="list-item-text">
        <div class="list-item-name">${esc(seller.name)}</div>
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
      `<span class="chip">${esc(c)}<span class="remove-x" onclick="removeGunCaliber(${i})">×</span></span>`
    ).join('');
  }
  // Repopulate the add-select excluding already-added
  const sel = document.getElementById('gun-caliber-add-select');
  const known = allKnownCalibers().filter(c => !gunModalCalibers.some(x => x.trim().toLowerCase() === c.trim().toLowerCase()));
  sel.innerHTML =
    '<option value="">— Add caliber —</option>' +
    known.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('') +
    `<option value="${CUSTOM_OPTION}">+ New caliber...</option>`;
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
  if (val === CUSTOM_OPTION) {
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
    if (e.target.value === CUSTOM_OPTION) {
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
  document.getElementById('gun-optic-unit').value = '';
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
  document.getElementById('gun-optic-unit').value = gun.opticUnit || '';
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
  const opticUnit = document.getElementById('gun-optic-unit').value || null;
  const calibers = [...gunModalCalibers];
  if (!name) { alert('Please enter a name.'); return; }
  if (!calibers.length) { alert('Please add at least one caliber.'); return; }
  if (!threshold) { alert('Please set a clean threshold.'); return; }
  if (id) {
    const gun = data.firearms.find(g => g.id === id);
    if (gun) { gun.name = name; gun.type = type; gun.calibers = calibers; gun.cleanThreshold = threshold; gun.notes = notes; gun.opticUnit = opticUnit; delete gun.caliber; }
  } else {
    data.firearms.push({ id: uid(), name, type, calibers, cleanThreshold: threshold, notes, opticUnit, totalRounds: 0, cleanings: [], zeros: [], groups: [], dope: [] });
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
  // The capped view is the one worth landing on; a section left open from last time
  // would defeat the point of capping them.
  historyExpanded = {};
  renderGunHistory(gunId);
  openModal('modal-history');
  // Whether a panel is scrolled to its end can only be measured once it has a height,
  // and it has none while the modal is still display:none.
  Object.values(HISTORY_LIST_EL).forEach(id => {
    const box = document.getElementById(id);
    if (box) markHistoryScrollEnd(box);
  });
}

// ── CAPPED DETAILS LISTS ──────────────────────────────────────────
// Every section in Details used to render every record it held, so a firearm with a year
// of use turned the modal into one long scroll. Each list now shows its most recent few,
// with the rest one tap away.

// Cleanings gets the smallest cap because the block at the top of Details already reports
// rounds since each clean and when they were — the list below is history, not status.
// Dope cards are the tallest thing in here, so two is already a screenful.
const HISTORY_CAPS = { cleanings: 3, zeros: 3, dope: 2, groups: 5 };
const HISTORY_LIST_EL = {
  cleanings: 'history-cleanings-list',
  zeros: 'history-zeros-list',
  dope: 'history-dope-list',
  groups: 'history-groups-list',
};

let historyExpanded = {};
// The rendered rows are kept so expanding repaints one section instead of rebuilding the
// whole modal, which would throw away where you were scrolled to.
const historyRows = {};

function paintHistorySection(name, rows, emptyHtml) {
  historyRows[name] = rows;
  const box = document.getElementById(HISTORY_LIST_EL[name]);
  const btn = document.getElementById('show-all-' + name);
  if (!box || !btn) return;

  if (!rows.length) {
    box.innerHTML = emptyHtml;
    box.classList.remove('list-scroll', 'at-end');
    btn.style.display = 'none';
    return;
  }

  const cap = HISTORY_CAPS[name];
  const expanded = !!historyExpanded[name];
  box.innerHTML = (expanded ? rows : rows.slice(0, cap)).join('');

  // The scroll panel only appears when it earns its keep: expanded, and long enough that
  // the modal would otherwise stretch. Six rows just render as six rows.
  const needsPanel = expanded && rows.length > cap;
  box.classList.toggle('list-scroll', needsPanel);
  if (!needsPanel) {
    box.classList.remove('at-end');
  } else {
    if (!box.dataset.scrollBound) {
      box.addEventListener('scroll', () => markHistoryScrollEnd(box), { passive: true });
      box.dataset.scrollBound = '1';
    }
    markHistoryScrollEnd(box);
  }

  if (rows.length <= cap) { btn.style.display = 'none'; return; }
  btn.style.display = 'block';
  btn.innerHTML = expanded ? 'Show fewer ▲' : `Show all ${rows.length} ▼`;
}

// The bottom fade means "there is more"; it has to lift at the end or it sits over the
// last row lying about it.
function markHistoryScrollEnd(box) {
  if (!box.classList.contains('list-scroll')) return;
  box.classList.toggle('at-end', box.scrollTop + box.clientHeight >= box.scrollHeight - 2);
}

function toggleHistorySection(name) {
  historyExpanded[name] = !historyExpanded[name];
  paintHistorySection(name, historyRows[name] || [], '');
}

function renderGunHistory(gunId) {
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  document.getElementById('history-title').innerHTML = typeIconSVG(gun.type, 26) + esc(gun.name) + ' · Details';

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
    ? `<div class="gun-notes-block">${esc(gun.notes)}</div>`
    : '';

  // Cleanings list
  const cleanings = [...(gun.cleanings || [])].sort((a,b) => b.date.localeCompare(a.date));
  paintHistorySection('cleanings', cleanings.map(c => {
      const typeLabel = CLEANING_TYPES[c.type]?.label || c.type;
      return `
        <div class="cleaning-row">
          <div class="cleaning-type-badge ${c.type}">${typeLabel}</div>
          <div>
            <div class="cleaning-meta-date">${fmtDate(c.date)}</div>
            ${c.notes ? `<div class="cleaning-meta-notes">${esc(c.notes)}</div>` : ''}
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn-icon" onclick="openLogCleaning('${gunId}','${c.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="deleteCleaning('${gunId}','${c.id}')" title="Delete">🗑</button>
          </div>
        </div>
      `;
  }), '<div class="empty-state" style="padding:16px;">No cleanings logged yet.</div>');

  // Zeros list
  const zeros = [...(gun.zeros || [])].sort((a,b) => b.date.localeCompare(a.date));
  paintHistorySection('zeros', zeros.map(z => {
      const distLabel = z.distance ? `${z.distance} ${z.distanceUnit || 'yd'}` : '—';
      const subParts = [];
      if (z.ammo) subParts.push(esc(z.ammo));
      if (z.optic) subParts.push(esc(z.optic));
      return `
        <div class="cleaning-row tappable" onclick="openViewZero('${gunId}','${z.id}')"
             role="button" tabindex="0" title="View this zero">
          <div class="cleaning-type-badge zero">${distLabel}</div>
          <div>
            <div class="cleaning-meta-date">${fmtDate(z.date)}${subParts.length ? ' · ' : ''}<span style="color:var(--text-muted);font-weight:normal;">${subParts.join(' · ')}</span></div>
            ${z.notes ? `<div class="cleaning-meta-notes">${esc(z.notes)}</div>` : ''}
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn-icon" onclick="event.stopPropagation(); openLogZero('${gunId}','${z.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="event.stopPropagation(); deleteZero('${gunId}','${z.id}')" title="Delete">🗑</button>
          </div>
        </div>
      `;
  }), '<div class="empty-state" style="padding:16px;">No zeros recorded yet.</div>');

  renderDopeCards(gunId);

  // Groups list — sizes recomputed from the marked points on every render.
  const groups = [...(gun.groups || [])].sort((a, b) => b.date.localeCompare(a.date));
  paintHistorySection('groups', groups.map(g => {
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
      // Shortened here as everywhere else: the full load name runs to three lines on a phone
      // and pushes every other group off the panel. Tapping the row shows it in full.
      if (g.ammo) sub.push(esc(shortLoadName(g.ammo)));
      const tagLine = (g.tags || []).length
        ? `<div class="group-row-tags">${g.tags.map(t => `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>`
        : '';
      return `
        <div class="group-row tappable" onclick="openViewGroup('${gunId}','${g.id}')"
             role="button" tabindex="0" title="View this group">
          <div class="group-row-info">
            <div class="group-row-main">${fmtDate(g.date)}</div>
            <div class="group-row-sub">${sub.join(' · ')}${hasPhoto(g) ? ' · 📷' : ''}</div>
            ${tagLine}
          </div>
          <div class="group-row-figure">
            <div class="group-row-size">${primary}</div>
            <div class="group-row-sub">${secondary}</div>
          </div>
          <div class="group-row-actions">
            <button class="btn-icon" onclick="event.stopPropagation(); openLogGroup('${gunId}','${g.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="event.stopPropagation(); deleteGroup('${gunId}','${g.id}')" title="Delete">🗑</button>
          </div>
        </div>
      `;
  }), '<div class="empty-state" style="padding:16px;">No groups recorded yet.</div>');
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
    [...(g.zeros || []), ...(g.groups || []), ...(g.dope || [])].forEach(entry => {
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
      html += `<option value="${esc(label)}"${sel}>${esc(label)}</option>`;
    });
    html += '</optgroup>';
  }
  if (usedUp.length) {
    html += '<optgroup label="Used up">';
    usedUp.forEach(a => {
      const label = ammoDisplayLabel(a);
      const sel = label === selectedAmmoText ? ' selected' : '';
      html += `<option value="${esc(label)}"${sel}>${esc(label)}</option>`;
    });
    html += '</optgroup>';
  }
  if (textOnly.length) {
    html += '<optgroup label="◇ Text-only (from past entries)">';
    textOnly.forEach(t => {
      const sel = t === selectedAmmoText ? ' selected' : '';
      html += `<option value="${esc(t)}"${sel}>${esc(t)}</option>`;
    });
    html += '</optgroup>';
  }
  html += `<option value="${CUSTOM_OPTION}">+ Custom...</option>`;
  sel.innerHTML = html;

  // If selected value doesn't match any option, use custom
  if (selectedAmmoText && sel.value !== selectedAmmoText) {
    sel.value = CUSTOM_OPTION;
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
  if (sel.value === CUSTOM_OPTION) {
    custom.style.display = 'block';
    custom.focus();
  } else {
    custom.style.display = 'none';
    custom.value = '';
  }
}

function getSelectedAmmo(selectId, customId) {
  const sel = document.getElementById(selectId);
  if (sel.value === CUSTOM_OPTION) return document.getElementById(customId).value.trim();
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
    html += `<option value="${esc(o)}"${s}>${esc(o)}</option>`;
  });
  html += `<option value="${CUSTOM_OPTION}">+ Custom...</option>`;
  sel.innerHTML = html;
  if (selectedOptic && sel.value !== selectedOptic) {
    sel.value = CUSTOM_OPTION;
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
  if (sel.value === CUSTOM_OPTION) {
    custom.style.display = 'block';
    custom.focus();
  } else {
    custom.style.display = 'none';
    custom.value = '';
  }
}

function getSelectedZeroOptic() {
  const sel = document.getElementById('zero-optic-select');
  if (sel.value === CUSTOM_OPTION) return document.getElementById('zero-optic-custom').value.trim();
  return sel.value.trim();
}

// Reading a zero and changing one are different intentions. Tapping the row opens it
// inert, the same way groups and dope tables already work, so a stray tap at the bench
// can't quietly alter what the rifle is actually zeroed at.
let zeroReadOnly = false;

// Zero, dope, session and ammo all present the same view/edit modal: mark the modal
// `viewing`, disable its fields, and swap the button row between Close/Edit and
// Cancel/Save. Only the ids and the save handler differ, so the shape lives here once.
//
// `enterEdit` and `save` are function *names* rather than functions because these buttons
// are built as markup with inline onclick, like the rest of the app — which is also why a
// typo here is a dead button rather than an error, and why the handler-resolution test
// exists. The group modal deliberately does not route through this: its buttons are
// persistent elements toggled by visibility, not a container rebuilt from markup.
function applyModalMode({ modal, fields, buttons, readOnly, enterEdit, save, alsoDisable }) {
  const el = document.getElementById(modal);
  el.classList.toggle('viewing', readOnly);
  fields.forEach(id => {
    const f = document.getElementById(id);
    if (f) f.disabled = readOnly;
  });
  if (alsoDisable) el.querySelectorAll(alsoDisable).forEach(f => { f.disabled = readOnly; });
  document.getElementById(buttons).innerHTML = readOnly
    ? `<button class="btn btn-secondary" onclick="closeModal('${modal}')">Close</button>
       <button class="btn btn-primary" onclick="${enterEdit}()">Edit</button>`
    : `<button class="btn btn-secondary" onclick="closeModal('${modal}')">Cancel</button>
       <button class="btn btn-primary" onclick="${save}()">Save</button>`;
}

function zeroApplyMode() {
  applyModalMode({
    modal: 'modal-zero', buttons: 'zero-buttons', readOnly: zeroReadOnly,
    enterEdit: 'zeroEnterEdit', save: 'saveZero',
    fields: ['zero-date', 'zero-distance', 'zero-distance-unit', 'zero-ammo-select',
             'zero-ammo-custom', 'zero-optic-select', 'zero-optic-custom', 'zero-notes'],
  });
}

function openViewZero(gunId, zeroId) {
  return openLogZero(gunId, zeroId, true);
}

function zeroEnterEdit() {
  zeroReadOnly = false;
  const gun = data.firearms.find(x => x.id === document.getElementById('zero-gun-id').value);
  document.getElementById('zero-modal-title').textContent =
    'Edit Zero' + (gun ? ' · ' + gun.name : '');
  zeroApplyMode();
}

function openLogZero(gunId, zeroId, readOnly) {
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  zeroReadOnly = !!readOnly;
  document.getElementById('zero-gun-id').value = gunId;
  document.getElementById('zero-edit-id').value = zeroId || '';
  document.getElementById('zero-modal-title').textContent =
    (zeroReadOnly ? 'Zero · ' : zeroId ? 'Edit Zero · ' : 'Add Zero · ') + gun.name;

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
  zeroApplyMode();
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

// ── DOPE TABLES ───────────────────────────────────────────────────
// Come-ups entered by hand from whatever ballistic solver the shooter trusts. This app
// deliberately computes no trajectory and never adjusts these numbers from logged group
// data — storing and tweaking them is the part an external solver won't let you do.

const MOA_PER_MRAD = 3.437746;

// A come-up is an angle, so switching the unit has to convert it. Reinterpreting 6.0 MOA
// as 6.0 mil instead would silently turn a good table into a wrong one.
function convertCome(v, from, to) {
  if (v == null || !isFinite(v) || from === to) return v;
  return from === 'moa' ? v / MOA_PER_MRAD : v * MOA_PER_MRAD;
}

function dopeUnitLabel(u) { return u === 'mrad' ? 'mil' : 'MOA'; }

// Come-ups are read to the tenth in mils and the quarter in MOA; more decimals than the
// turret can actually dial is false precision.
function dopeFmt(v) {
  if (v == null || !isFinite(v)) return '—';
  return (Math.round(v * 100) / 100).toString();
}

// Editor state. The rows live here rather than being read back out of the DOM each time,
// because a unit switch has to rewrite every value and the DOM is only a view of them.
let dopeRows = [];
let dopeUnit = 'moa';
let dopeReadOnly = false;

function renderDopeCards(gunId) {
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  const tables = gun.dope || [];
  const CAP = 6;
  paintHistorySection('dope', tables.map(t => {
    const unit = t.unit === 'mrad' ? 'mrad' : 'moa';
    const du = t.distanceUnit || 'yd';
    const entries = [...(t.entries || [])].sort((a, b) => (a.distance || 0) - (b.distance || 0));
    const meta = [unit.toUpperCase()];
    if (t.zeroDistance) meta.push(`zero ${t.zeroDistance} ${du}`);
    meta.push(`${entries.length} distance${entries.length === 1 ? '' : 's'}`);
    const shown = entries.slice(0, CAP).map(e => `
      <div class="dope-row">
        <div class="dope-dist">${e.distance} ${du.toUpperCase()}</div>
        <div class="dope-come">${dopeFmt(e.come)}<span> ${dopeUnitLabel(unit)}</span></div>
      </div>`).join('');
    const more = entries.length > CAP
      ? `<div class="dope-row more">+${entries.length - CAP} more</div>` : '';
    return `
      <div class="dope-card tappable" onclick="openViewDope('${gunId}','${t.id}')"
           role="button" tabindex="0" title="View this table">
        <div class="dope-head">
          <div>
            <div class="dope-ammo">${esc(t.ammo || '(no ammo)')}</div>
            <div class="dope-meta">${meta.join(' · ')}</div>
            <div class="dope-conditions">${esc(t.conditions) || 'no conditions recorded'}</div>
          </div>
          <div style="display:flex;gap:4px;">
            <button class="btn-icon" onclick="event.stopPropagation(); openDope('${gunId}','${t.id}')" title="Edit">✏️</button>
            <button class="btn-icon" onclick="event.stopPropagation(); deleteDope('${gunId}','${t.id}')" title="Delete">🗑</button>
          </div>
        </div>
        ${entries.length ? `<div class="dope-rows">${shown}${more}</div>` : ''}
      </div>`;
  }), '<div class="empty-state" style="padding:16px;">No dope tables yet.</div>');
}

function populateDopeAmmoDropdown(gun, selected) {
  populateAmmoDropdown(gun, selected, 'dope-ammo-select', 'dope-ammo-custom');
}
function handleDopeAmmoChange() {
  handleAmmoSelectChange('dope-ammo-select', 'dope-ammo-custom');
}
function getSelectedDopeAmmo() {
  return getSelectedAmmo('dope-ammo-select', 'dope-ammo-custom');
}

function renderDopeEntries() {
  const wrap = document.getElementById('dope-entries');
  if (!wrap) return;
  const du = document.getElementById('dope-distance-unit').value || 'yd';
  const cls = dopeReadOnly ? ' view' : '';
  const dis = dopeReadOnly ? ' disabled' : '';
  let html = `<div class="entry-head${cls}"><span>Distance (${du})</span>` +
             `<span>Come-up (${dopeUnitLabel(dopeUnit)})</span>${dopeReadOnly ? '' : '<span></span>'}</div>`;
  html += dopeRows.map((r, i) => `
    <div class="entry-row${cls}">
      <input type="number" step="any" min="0" value="${r.distance != null ? r.distance : ''}"
             onchange="setDopeCell(${i},'distance',this.value)"${dis}>
      <input type="number" step="any" value="${r.come != null ? r.come : ''}"
             onchange="setDopeCell(${i},'come',this.value)"${dis}>
      ${dopeReadOnly ? '' : `<button class="entry-del" onclick="removeDopeRow(${i})" title="Remove">×</button>`}
    </div>`).join('');
  if (!dopeRows.length) {
    html += '<div class="group-hint">No distances yet — add one below.</div>';
  }
  wrap.innerHTML = html;
}

function setDopeCell(i, field, value) {
  if (!dopeRows[i]) return;
  const n = parseFloat(value);
  dopeRows[i][field] = isFinite(n) ? n : null;
}

function addDopeRow() {
  dopeRows.push({ distance: null, come: null });
  renderDopeEntries();
  // Land the caret in the new distance field — adding a row is always followed by typing.
  const inputs = document.querySelectorAll('#dope-entries .entry-row input');
  const first = inputs[(dopeRows.length - 1) * 2];
  if (first) first.focus();
}

function removeDopeRow(i) {
  dopeRows.splice(i, 1);
  renderDopeEntries();
}

function handleDopeUnitChange() {
  const next = document.getElementById('dope-unit').value === 'mrad' ? 'mrad' : 'moa';
  if (next === dopeUnit) return;
  dopeRows = dopeRows.map(r => ({
    distance: r.distance,
    come: r.come == null ? null : Math.round(convertCome(r.come, dopeUnit, next) * 100) / 100,
  }));
  dopeUnit = next;
  renderDopeEntries();
}

function dopeApplyMode() {
  applyModalMode({
    modal: 'modal-dope', buttons: 'dope-buttons', readOnly: dopeReadOnly,
    enterEdit: 'dopeEnterEdit', save: 'saveDope',
    fields: ['dope-ammo-select', 'dope-ammo-custom', 'dope-unit', 'dope-zero-distance',
             'dope-distance-unit', 'dope-conditions'],
  });
}

function openDope(gunId, dopeId, readOnly) {
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  dopeReadOnly = !!readOnly;
  document.getElementById('dope-gun-id').value = gunId;
  document.getElementById('dope-id').value = dopeId || '';

  let ammo = '';
  const t = dopeId ? (gun.dope || []).find(x => x.id === dopeId) : null;
  if (t) {
    dopeUnit = t.unit === 'mrad' ? 'mrad' : 'moa';
    document.getElementById('dope-unit').value = dopeUnit;
    document.getElementById('dope-zero-distance').value = t.zeroDistance || '';
    document.getElementById('dope-distance-unit').value = t.distanceUnit || 'yd';
    document.getElementById('dope-conditions').value = t.conditions || '';
    dopeRows = (t.entries || [])
      .map(e => ({ distance: e.distance, come: e.come }))
      .sort((a, b) => (a.distance || 0) - (b.distance || 0));
    ammo = t.ammo || '';
  } else {
    // A new table inherits the firearm's turret unit — the whole point of recording
    // opticUnit is not being asked the same question twice.
    dopeUnit = gun.opticUnit === 'mrad' ? 'mrad' : 'moa';
    document.getElementById('dope-unit').value = dopeUnit;
    document.getElementById('dope-zero-distance').value = '';
    document.getElementById('dope-distance-unit').value = 'yd';
    document.getElementById('dope-conditions').value = '';
    dopeRows = [{ distance: null, come: null }];
  }

  document.getElementById('dope-modal-title').textContent =
    (dopeReadOnly ? 'Dope · ' : dopeId ? 'Edit Dope · ' : 'Add Dope · ') + gun.name;
  populateDopeAmmoDropdown(gun, ammo);
  dopeApplyMode();
  renderDopeEntries();

  if (document.getElementById('modal-history').classList.contains('open')) {
    restoreHistoryGunId = gunId;
    closeModal('modal-history');
  }
  openModal('modal-dope');
}

function openViewDope(gunId, dopeId) {
  return openDope(gunId, dopeId, true);
}

function dopeEnterEdit() {
  dopeReadOnly = false;
  const gun = data.firearms.find(x => x.id === document.getElementById('dope-gun-id').value);
  document.getElementById('dope-modal-title').textContent =
    'Edit Dope' + (gun ? ' · ' + gun.name : '');
  dopeApplyMode();
  renderDopeEntries();
}

function saveDope() {
  const gunId = document.getElementById('dope-gun-id').value;
  const editId = document.getElementById('dope-id').value;
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;

  const ammo = getSelectedDopeAmmo();
  if (!ammo) { alert('Please select or enter the ammo this dope is for.'); return; }

  // Half-filled rows are dropped rather than saved with a hole in them: a distance with
  // no come-up is not dope, and reading one back at the range would be worse than nothing.
  const entries = dopeRows
    .filter(r => r.distance != null && isFinite(r.distance) && r.come != null && isFinite(r.come))
    .map(r => ({ distance: r.distance, come: r.come }))
    .sort((a, b) => a.distance - b.distance);
  if (!entries.length) { alert('Add at least one distance with a come-up.'); return; }

  const record = {
    ammo,
    unit: dopeUnit,
    zeroDistance: parseFloat(document.getElementById('dope-zero-distance').value) || null,
    distanceUnit: document.getElementById('dope-distance-unit').value,
    conditions: document.getElementById('dope-conditions').value.trim(),
    entries,
  };

  if (!Array.isArray(gun.dope)) gun.dope = [];
  if (editId) {
    const t = gun.dope.find(x => x.id === editId);
    if (t) Object.assign(t, record);
  } else {
    gun.dope.push({ id: uid(), ...record });
  }
  save(data);
  closeModal('modal-dope');
}

function deleteDope(gunId, dopeId) {
  if (!confirm('Delete this dope table?')) return;
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  gun.dope = (gun.dope || []).filter(t => t.id !== dopeId);
  save(data);
  if (currentHistoryGunId === gunId) renderGunHistory(gunId);
}

// ── SESSION EDIT / DELETE ─────────────────────────────────────────
// Reading a trip and changing one are different intentions — the same argument that put
// zeros, groups, dope tables and ammo purchases behind a read-only view.
let sessionReadOnly = false;

function sessionApplyMode() {
  applyModalMode({
    modal: 'modal-session', buttons: 'session-buttons', readOnly: sessionReadOnly,
    enterEdit: 'sessionEnterEdit', save: 'saveEditSession',
    fields: ['session-edit-date', 'session-edit-location', 'session-edit-notes'],
    // The per-firearm round inputs are rebuilt on every open, so they have no fixed ids.
    alsoDisable: '#session-edit-gun-inputs input',
  });
}

function openViewSession(id) {
  return openEditSession(id, true);
}

function sessionEnterEdit() {
  sessionReadOnly = false;
  document.getElementById('session-modal-title').textContent = 'Edit Session';
  sessionApplyMode();
}

function openEditSession(id, readOnly) {
  sessionReadOnly = !!readOnly;
  const s = data.sessions.find(s => s.id === id);
  if (!s) return;

  document.getElementById('session-modal-title').textContent =
    sessionReadOnly ? 'Range Session' : 'Edit Session';
  document.getElementById('session-edit-id').value = id;
  document.getElementById('session-edit-date').value = s.date;
  document.getElementById('session-edit-notes').value = s.notes || '';

  const locSel = document.getElementById('session-edit-location');
  locSel.innerHTML = '<option value="">— Select location —</option>' +
    data.locations.map(l => `<option value="${l.id}" ${l.id === s.locationId ? 'selected' : ''}>${esc(l.name)}</option>`).join('');

  const sessionRounds = s.rounds && typeof s.rounds === 'object' ? s.rounds : {};
  const gunInputs = document.getElementById('session-edit-gun-inputs');
  gunInputs.innerHTML = data.firearms.map(gun => `
    <div class="gun-row">
      <div>
        <label>${esc(gun.name)}</label>
        <div class="caliber-tag">${esc(gunCaliberLabel(gun))}</div>
      </div>
      <input type="number" id="edit-rounds-${gun.id}" min="0" placeholder="0" value="${sessionRounds[gun.id] || ''}">
    </div>
  `).join('');

  sessionApplyMode();
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
    sellers.map(s => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
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
    known.map(c => `<option value="${esc(c)}"${c === selectedCaliber ? ' selected' : ''}>${esc(c)}</option>`).join('') +
    `<option value="${CUSTOM_OPTION}">+ New caliber...</option>`;

  if (selectedCaliber && !isKnown) {
    // Editing an entry with a caliber not in the current list — treat as custom
    sel.value = CUSTOM_OPTION;
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
  if (sel.value === CUSTOM_OPTION) {
    custom.style.display = 'block';
    custom.focus();
  } else {
    custom.style.display = 'none';
    custom.value = '';
  }
}

function getSelectedCaliber() {
  const sel = document.getElementById('ammo-caliber-select');
  if (sel.value === CUSTOM_OPTION) {
    return document.getElementById('ammo-caliber-custom').value.trim();
  }
  return sel.value.trim();
}

// Reading a purchase and changing one are different intentions. Tapping the card opens it
// inert, the same way zeros, groups and dope tables already work.
let ammoReadOnly = false;

function ammoApplyMode() {
  applyModalMode({
    modal: 'modal-ammo', buttons: 'ammo-buttons', readOnly: ammoReadOnly,
    enterEdit: 'ammoEnterEdit', save: 'saveAmmo',
    fields: ['ammo-date', 'ammo-caliber-select', 'ammo-caliber-custom', 'ammo-manufacturer',
             'ammo-model', 'ammo-quantity', 'ammo-price', 'ammo-seller', 'ammo-status',
             'ammo-not-range', 'ammo-usedup-date', 'ammo-notes'],
  });
}

function openViewAmmo(id) {
  openEditAmmo(id, true);
}

function ammoEnterEdit() {
  ammoReadOnly = false;
  document.getElementById('ammo-modal-title').textContent = 'Edit Ammo Purchase';
  ammoApplyMode();
}

function openAddAmmo() {
  ammoReadOnly = false;
  document.getElementById('ammo-modal-title').textContent = 'Log Ammo Purchase';
  document.getElementById('ammo-edit-id').value = '';
  document.getElementById('ammo-date').value = today();
  document.getElementById('ammo-manufacturer').value = '';
  document.getElementById('ammo-model').value = '';
  document.getElementById('ammo-quantity').value = '';
  document.getElementById('ammo-price').value = '';
  document.getElementById('ammo-status').value = 'instock';
  document.getElementById('ammo-not-range').checked = false;
  document.getElementById('ammo-usedup-date').value = '';
  document.getElementById('ammo-notes').value = '';
  populateAmmoSellerDropdown('');
  populateAmmoCaliberDropdown('');
  handleAmmoStatusChange();
  ammoApplyMode();
  openModal('modal-ammo');
}

function openEditAmmo(id, readOnly) {
  const a = (data.ammo || []).find(x => x.id === id);
  if (!a) return;
  ammoReadOnly = !!readOnly;
  document.getElementById('ammo-modal-title').textContent =
    ammoReadOnly ? 'Ammo Purchase' : 'Edit Ammo Purchase';
  document.getElementById('ammo-edit-id').value = id;
  document.getElementById('ammo-date').value = a.date || '';
  document.getElementById('ammo-manufacturer').value = a.manufacturer || '';
  document.getElementById('ammo-model').value = a.model || '';
  document.getElementById('ammo-quantity').value = a.quantity || '';
  document.getElementById('ammo-price').value = a.totalPrice || '';
  document.getElementById('ammo-status').value = a.status || 'instock';
  document.getElementById('ammo-not-range').checked = a.rangeAmmo === false;
  document.getElementById('ammo-usedup-date').value = a.usedUpDate || '';
  document.getElementById('ammo-notes').value = a.notes || '';
  populateAmmoSellerDropdown(a.sellerId || '');
  populateAmmoCaliberDropdown(a.caliber || '');
  handleAmmoStatusChange();
  ammoApplyMode();
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
  // Inverted on purpose: the box asks the unusual question, the field records the common case.
  const rangeAmmo = !document.getElementById('ammo-not-range').checked;
  // Only meaningful while used up; kept in storage regardless so a toggle round-trip is
  // lossless.
  const usedUpDate = status === 'usedup'
    ? (document.getElementById('ammo-usedup-date').value || today())
    : (document.getElementById('ammo-usedup-date').value || null);
  const notes = document.getElementById('ammo-notes').value.trim();

  if (!date) { alert('Please select a date.'); return; }
  if (!caliber) { alert('Please select or enter a caliber.'); return; }
  if (!quantity || quantity <= 0) { alert('Please enter a valid quantity.'); return; }
  if (isNaN(totalPrice) || totalPrice < 0) { alert('Please enter a valid total price.'); return; }

  if (!Array.isArray(data.ammo)) data.ammo = [];
  if (id) {
    const a = data.ammo.find(x => x.id === id);
    if (a) Object.assign(a, { date, caliber, manufacturer, model, quantity, totalPrice, sellerId, status, rangeAmmo, usedUpDate, notes });
  } else {
    data.ammo.push({ id: uid(), date, caliber, manufacturer, model, quantity, totalPrice, sellerId, status, rangeAmmo, usedUpDate, notes });
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
  const nowUsedUp = a.status !== 'usedup';
  a.status = nowUsedUp ? 'usedup' : 'instock';
  // Stamp the date the first time a lot runs out, and never restamp it. Going back to in
  // stock keeps the old date rather than clearing it, so mis-tapping the button and
  // correcting it leaves the record exactly as it was — which is the whole point, since
  // the correction would otherwise silently rewrite the date to today.
  if (nowUsedUp && !a.usedUpDate) a.usedUpDate = today();
  save(data);
  renderAmmo();
}

// The date only makes sense against a used-up lot; a date sitting on something in stock
// invites "used up when?" about ammo you still have. The stored value survives either way.
function handleAmmoStatusChange() {
  const field = document.getElementById('ammo-usedup-field');
  const usedUp = document.getElementById('ammo-status').value === 'usedup';
  if (field) field.style.display = usedUp ? '' : 'none';
  const input = document.getElementById('ammo-usedup-date');
  if (usedUp && input && !input.value && !ammoReadOnly) input.value = today();
}

// ── AMMO RENDER ───────────────────────────────────────────────────
function renderAmmo() {
  const ammo = data.ammo || [];

  // Populate caliber filter dropdown (preserve current selection)
  const calSel = document.getElementById('ammo-filter-caliber');
  const currentCal = calSel.value;
  const calibers = [...new Set(ammo.map(a => a.caliber).filter(Boolean))].sort();
  calSel.innerHTML = '<option value="">All calibers</option>' +
    calibers.map(c => `<option value="${esc(c)}"${c === currentCal ? ' selected' : ''}>${esc(c)}</option>`).join('');

  const filterCal = calSel.value;
  const filterStock = document.getElementById('ammo-filter-stock').value;

  // Apply filters
  let filtered = ammo;
  if (filterCal) filtered = filtered.filter(a => a.caliber === filterCal);
  if (filterStock === 'instock') filtered = filtered.filter(a => (a.status || 'instock') === 'instock');
  if (filterStock === 'usedup') filtered = filtered.filter(a => (a.status || 'instock') === 'usedup');

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
      <div class="ammo-card tappable ${isUsedUp ? 'used-up' : ''}"
           onclick="openViewAmmo('${a.id}')" role="button" tabindex="0"
           title="View this purchase">
        <div class="ammo-card-header">
          <div style="flex:1;min-width:0;">
            <div class="ammo-caliber-badge">${esc(a.caliber)}</div>
            <div class="ammo-name">${esc(name)}</div>
          </div>
          <div>
            <div class="ammo-cpr">$${cpr.toFixed(3)}</div>
            <div class="ammo-cpr-label">per round</div>
          </div>
        </div>
        <div class="ammo-meta">
          <span>${(a.quantity || 0).toLocaleString()}</span> rds &nbsp;·&nbsp;
          <span>$${(a.totalPrice || 0).toFixed(2)}</span> &nbsp;·&nbsp;
          ${fmtDate(a.date)}${sellerLabel ? ` &nbsp;·&nbsp; <span>${esc(sellerLabel)}</span>` : ''} &nbsp;·&nbsp;
          <span class="ammo-status-pill ${isUsedUp ? 'usedup' : ''}">${
            isUsedUp ? (a.usedUpDate ? `Used up ${fmtDate(a.usedUpDate)}` : 'Used up') : 'In stock'
          }</span>
        </div>
        ${a.notes ? `<div class="ammo-notes">${esc(a.notes)}</div>` : ''}
        <div class="ammo-actions">
          <button class="btn-mini" onclick="event.stopPropagation(); toggleAmmoStatus('${a.id}')">${isUsedUp ? 'Mark in stock' : 'Mark used up'}</button>
          <button class="btn-mini" onclick="event.stopPropagation(); openEditAmmo('${a.id}')">Edit</button>
          <button class="btn-mini" onclick="event.stopPropagation(); deleteAmmo('${a.id}')">Delete</button>
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

function getStatsRangeBounds() {
  const key = document.getElementById('stats-range').value;
  const end = today();
  // A re-zero is a hard boundary: point of impact before and after it are not the same
  // measurement, so the range picker can anchor to one. Groups dated the same day as the
  // zero count as after it — neither carries a time, and you zero before you shoot groups.
  if (key.startsWith('zero:')) {
    const zeroId = key.slice(5);
    for (const gun of data.firearms || []) {
      const z = (gun.zeros || []).find(x => x.id === zeroId);
      if (z) return { start: z.date, end };
    }
    return { start: null, end: null };
  }
  switch (key) {
    case 'month': return { start: firstOfMonthISO(0), end };
    case '3months': return { start: firstOfMonthISO(2), end };
    case '12months': return { start: firstOfMonthISO(11), end };
    case 'year': return { start: firstOfYearISO(), end };
    case 'all': return { start: null, end: null };
    case 'custom': {
      const s = document.getElementById('stats-start').value || null;
      const e = document.getElementById('stats-end').value || null;
      return { start: s, end: e };
    }
    default: return { start: firstOfMonthISO(11), end };
  }
}

function handleStatsRangeChange() {
  const key = document.getElementById('stats-range').value;
  const customDiv = document.getElementById('stats-custom-range');
  const isCustom = key === 'custom';
  customDiv.style.display = isCustom ? 'flex' : 'none';
  if (isCustom) {
    const startEl = document.getElementById('stats-start');
    const endEl = document.getElementById('stats-end');
    if (!startEl.value) startEl.value = firstOfMonthISO(11);
    if (!endEl.value) endEl.value = today();
  }
  renderStats();
}

// Zero anchors are only meaningful for one firearm's own zeros, so they appear on Groups
// once a firearm is picked. Rebuilt on every render because the selected firearm changes them.
function populateStatsRangeOptions() {
  const sel = document.getElementById('stats-range');
  const current = sel.value;
  const base = `
    <option value="month">This Month</option>
    <option value="3months">Last 3 Months</option>
    <option value="12months">Last 12 Months</option>
    <option value="year">This Year</option>
    <option value="all">All Time</option>
    <option value="custom">Custom...</option>`;

  let anchors = '';
  if (currentStatsSection === 'groups') {
    const gunId = document.getElementById('stats-firearm').value;
    const gun = gunId ? data.firearms.find(g => g.id === gunId) : null;
    const zeros = gun ? [...(gun.zeros || [])].sort((a, b) => b.date.localeCompare(a.date)) : [];
    if (zeros.length) {
      anchors = '<optgroup label="Anchored to a zero">' + zeros.map((z, i) =>
        `<option value="zero:${z.id}">${i === 0 ? 'Since last zero' : 'Since zero'} · ${fmtDate(z.date)}</option>`
      ).join('') + '</optgroup>';
    }
  }
  sel.innerHTML = anchors + base;
  // A zero anchor from a different firearm has no meaning here, so fall back rather than
  // silently keeping a selection the list no longer offers.
  sel.value = Array.from(sel.options).some(o => o.value === current) ? current : '12months';
}

function populateStatsFilterDropdowns() {
  populateStatsRangeOptions();
  const loc = document.getElementById('stats-location');
  const curLoc = loc.value;
  loc.innerHTML = '<option value="">All Locations</option>' +
    data.locations.map(l => `<option value="${l.id}"${l.id === curLoc ? ' selected' : ''}>${esc(l.name)}</option>`).join('');

  const gun = document.getElementById('stats-firearm');
  const curGun = gun.value;
  gun.innerHTML = '<option value="">All Firearms</option>' +
    data.firearms.map(g => `<option value="${g.id}"${g.id === curGun ? ' selected' : ''}>${esc(g.name)}</option>`).join('');

  // Both individual calibers and the merged groups, because the two answer different
  // questions. Rounds fired through a firearm chambered .223/5.56 cannot be attributed to
  // one or the other, so the merged entry exists for the shooting panes. A purchase always
  // names exactly one caliber, and .223 match at ~$1.10/rd is a different product from bulk
  // 5.56 at ~$0.44 — merging those on Money would compare products rather than prices, the
  // same trap the store comparison avoids.
  const cal = document.getElementById('stats-caliber');
  const curCal = cal.value;
  const merged = getMergedFirearmCalibers().filter(g => g.tokens.length > 1);
  const singles = allKnownCalibers();
  let calHtml = '<option value="">All Calibers</option>';
  calHtml += singles.map(c =>
    `<option value="${esc(c)}"${c === curCal ? ' selected' : ''}>${esc(c)}</option>`).join('');
  // Only listed where a merge actually exists — a single-token group would just duplicate
  // the entry above it.
  if (merged.length) {
    calHtml += '<optgroup label="Shared chambers">' + merged.map(g =>
      `<option value="${esc(g.value)}"${g.value === curCal ? ' selected' : ''}>${esc(g.label)}</option>`).join('') +
      '</optgroup>';
  }
  cal.innerHTML = calHtml;
}

// Which filters mean anything in which pane. A control that cannot apply is dimmed and
// explained rather than silently ignored — otherwise you set a firearm, watch a number not
// move, and have no way to tell whether that is the answer or the filter.
const STATS_FILTER_APPLIES = {
  groups:   { range: true,  location: true,  firearm: true, caliber: false },
  practice: { range: true,  location: true,  firearm: true, caliber: true },
  money:    { range: true,  location: false, firearm: true, caliber: true },
  upkeep:   { range: false, location: false, firearm: true, caliber: true },
};
const STATS_FILTER_WHY = {
  groups:   { caliber: 'caliber follows from the firearm you pick' },
  money:    { location: 'purchases record a seller, not a range' },
  upkeep:   { range: 'rounds since clean is a state now, not a period',
              location: 'cleaning is not tied to a range' },
};

function applyStatsFilterAvailability() {
  const applies = STATS_FILTER_APPLIES[currentStatsSection] || STATS_FILTER_APPLIES.practice;
  const why = STATS_FILTER_WHY[currentStatsSection] || {};
  const notes = [];
  ['range', 'location', 'firearm', 'caliber'].forEach(key => {
    const group = document.getElementById('statsf-' + key);
    if (!group) return;
    const on = !!applies[key];
    group.classList.toggle('na', !on);
    const sel = group.querySelector('select');
    if (sel) sel.disabled = !on;
    if (!on && why[key]) notes.push(`${key} ignored here — ${why[key]}`);
  });
  // The custom date row goes with the range control.
  const custom = document.getElementById('stats-custom-range');
  if (custom && !applies.range) custom.style.display = 'none';
  else if (custom) custom.style.display =
    document.getElementById('stats-range').value === 'custom' ? 'flex' : 'none';

  const noteEl = document.getElementById('stats-filter-note');
  if (noteEl) noteEl.textContent = notes.join(' · ');
}

// A caliber selection is a merged group (tokens joined by '||'). Returns the token set, or
// null for "all".
function selectedCaliberTokens() {
  const v = document.getElementById('stats-caliber').value;
  return v ? new Set(v.split('||')) : null;
}

// Firearms in scope given the firearm and caliber chips together. Returns null for "all".
function scopedGunIdsFromFilters() {
  const gunId = document.getElementById('stats-firearm').value;
  const caliberValue = document.getElementById('stats-caliber').value;
  if (!gunId && !caliberValue) return null;
  const group = caliberValue
    ? getMergedFirearmCalibers().find(g => g.value === caliberValue) : null;
  if (gunId && caliberValue) {
    // Both set — intersect. A firearm not chambered for the selected caliber genuinely has
    // nothing to show, rather than falling back to the firearm-only total.
    return group && group.gunIds.has(gunId) ? new Set([gunId]) : new Set();
  }
  if (gunId) return new Set([gunId]);
  return group ? group.gunIds : new Set();
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

// Gridlines are only worth drawing if they land on numbers a person would have picked, so
// the top of the scale rounds up to a round step instead of sitting on the tallest bar.
//
// The step sequence is 1/2/5/10 rather than the usual 1/2/2.5/5/10, and is floored at 1,
// because all three charts using this render whole numbers. With 2.5 in the sequence a
// seven-trip month produced ticks at 2.5 and 7.5 — worse than a slightly coarser axis.
// minStep floors the step size. It defaults to 1 because the bar charts count rounds and
// dollars, where a gridline at 0.5 means nothing. Angular scales pass a smaller floor —
// offsets in mils live below 1 entirely, and flooring them at 1 leaves no scale at all.
function niceScale(max, intervals, minStep = 1) {
  if (!(max > 0)) return { step: minStep, top: minStep };
  const raw = max / Math.max(1, intervals);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const step = Math.max(minStep, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag);
  return { step, top: Math.ceil(max / step) * step };
}

function buildStatsBarChart(buckets, formatVal) {
  if (!buckets.length) return '<div class="stats-empty">No data for this range.</div>';
  const max = Math.max(...buckets.map(b => b.value), 1);
  const scale = niceScale(max, 3);
  const top = scale.top;
  // Lines are placed as a percentage of the plot area, so nothing here has to know how
  // tall the track is in pixels — that stays a CSS decision.
  const lines = [];
  for (let v = 0; v <= top + 1e-9; v += scale.step) {
    lines.push(`<div class="stats-bar-gl" style="bottom:${(v / top) * 100}%">` +
      `<span class="stats-bar-tick">${formatVal(v)}</span></div>`);
  }
  const bars = buckets.map(b => {
    const pct = b.value > 0 ? Math.max((b.value / top) * 100, 3) : 1;
    const labelClass = b.showLabel === false ? 'stats-bar-label hidden-label' : 'stats-bar-label';
    return `
      <div class="stats-bar-col">
        <div class="stats-bar-val">${formatVal(b.value)}</div>
        <div class="stats-bar-track"><div class="stats-bar" style="height:${pct}%"></div></div>
        <div class="${labelClass}">${b.label}</div>
      </div>
    `;
  }).join('');
  return `<div class="stats-bar-plot">
      <div class="stats-bar-grid" aria-hidden="true">${lines.join('')}</div>
      <div class="stats-bar-chart">${bars}</div>
    </div>`;
}

// ── STATS SUB-TABS ────────────────────────────────────────────────
// Four panes rather than one long scroll. Which one is showing is view state, not data, so
// it is deliberately not persisted — reopening Stats lands on Practice every time.
const STATS_SECTIONS = ['groups', 'practice', 'money', 'upkeep'];
let currentStatsSection = 'practice';

function showStatsSection(name) {
  if (!STATS_SECTIONS.includes(name)) name = 'practice';
  currentStatsSection = name;
  STATS_SECTIONS.forEach(n => {
    const pane = document.getElementById('statspane-' + n);
    const tab = document.getElementById('statstab-' + n);
    if (pane) pane.classList.toggle('active', n === name);
    if (tab) {
      tab.classList.toggle('active', n === name);
      tab.setAttribute('aria-selected', n === name ? 'true' : 'false');
    }
  });
  renderStats();
}

function renderStats() {
  populateStatsFilterDropdowns();
  applyStatsFilterAvailability();
  renderRoundsFiredStats();
  renderRangeTripsStats();
  renderAmmoSpendStats();
  renderUpkeepStats();
  renderGroupsStats();
  layoutStatsBarCharts();
}

// The axis gutter is sized to its own widest tick rather than a fixed width, because the
// ticks are rem-sized and grow with the text-size setting — and a dollar figure is wider
// than a round count. Runs before the thinning pass, since narrowing the columns is
// exactly what decides how many month labels still fit.
function layoutStatsBarCharts(root) {
  (root || document).querySelectorAll('.stats-bar-plot').forEach(plot => {
    const grid = plot.querySelector('.stats-bar-grid');
    const track = plot.querySelector('.stats-bar-track');
    if (!grid || !track) return;
    let widest = 0;
    plot.querySelectorAll('.stats-bar-tick').forEach(t => {
      widest = Math.max(widest, t.getBoundingClientRect().width);
    });
    plot.style.setProperty('--gutter', widest ? Math.ceil(widest + 9) + 'px' : '0px');
    // Overlay the plot area exactly, measured rather than derived from margins — the value
    // and label rows above and below it change height with the text size.
    const t = track.getBoundingClientRect();
    const p = plot.getBoundingClientRect();
    if (!(t.height > 0)) return;   // pane is hidden (or jsdom) — nothing to measure yet
    grid.style.top = (t.top - p.top) + 'px';
    grid.style.height = t.height + 'px';
  });
  thinStatsBarLabels(root);
}

// Bar-chart text is sized in rem, so it grows with the text-size setting while the columns
// stay where they are — at Larger and Largest the values run together and the month labels
// overlap. Measure what actually fits once laid out, then show every Nth column's text.
// Measured rather than a fixed modulo because the answer depends on text size, bucket count
// and viewport width together, and a hardcoded rule gets all three wrong somewhere.
function thinStatsBarLabels(root) {
  (root || document).querySelectorAll('.stats-bar-chart').forEach(chart => {
    const cols = [...chart.querySelectorAll('.stats-bar-col')];
    if (cols.length < 2) return;
    const pitch = cols[0].getBoundingClientRect().width +
      (parseFloat(getComputedStyle(chart).gap) || 0);
    if (!(pitch > 0)) return;   // pane is hidden (or jsdom) — nothing to measure yet
    let widest = 0;
    const texts = cols.map(c => [...c.querySelectorAll('.stats-bar-val, .stats-bar-label')]);
    texts.forEach(els => els.forEach(el => {
      el.classList.remove('thinned');                      // re-measure from unthinned
      widest = Math.max(widest, el.getBoundingClientRect().width);
    }));
    const step = Math.max(1, Math.ceil((widest + 4) / pitch));
    if (step === 1) return;
    texts.forEach((els, i) => {
      if (i % step) els.forEach(el => el.classList.add('thinned'));
    });
  });
}

// ── AMMO PRICING ──────────────────────────────────────────────────
// Shared by the session cards and the Money views, so a trip cannot be priced one way in one
// place and another way somewhere else.
//
// Rounds are logged per firearm and purchases per caliber, so nothing can say which box a
// given round came from. A firearm's rounds are priced at the average of the range ammo
// bought for its chambering — carry ammo excluded, or one 20-round box at five times the
// price would inflate every round that firearm ever fired.
//
// Crucially the average is taken *as of the session date*: only purchases made on or before
// a trip can price it. Otherwise buying expensive ammo today would retroactively raise what
// last March cost, and a figure that changes after the fact is not a record of anything.
//
// Where a trip predates every purchase of what was shot — real here, since ammo bought
// before this app existed was never logged — it falls back to the earliest price ever
// recorded for that chambering and says so. An assumption stated beats a trip that reads $0.
function buildCaliberPricer() {
  const lots = {};
  (data.ammo || []).forEach(a => {
    if (a.rangeAmmo === false) return;
    const c = (a.caliber || '').trim();
    if (!c || !(a.quantity > 0)) return;
    (lots[c] = lots[c] || []).push({ date: a.date, spend: a.totalPrice || 0, rounds: a.quantity });
  });
  Object.values(lots).forEach(l => l.sort((x, y) => (x.date || '').localeCompare(y.date || '')));

  const cache = new Map();
  // Returns { cpr, estimated } for one caliber as of a date, or null if never purchased.
  function forCaliber(caliber, date) {
    const l = lots[caliber];
    if (!l || !l.length) return null;
    const key = caliber + '|' + (date || '');
    if (cache.has(key)) return cache.get(key);
    const upTo = date ? l.filter(x => (x.date || '') <= date) : l;
    let out;
    if (upTo.length) {
      const spend = upTo.reduce((x, y) => x + y.spend, 0);
      const rounds = upTo.reduce((x, y) => x + y.rounds, 0);
      out = { cpr: rounds ? spend / rounds : null, estimated: false };
    } else {
      // Nothing bought yet at that date — use the first price ever recorded, and flag it.
      out = { cpr: l[0].rounds ? l[0].spend / l[0].rounds : null, estimated: true };
    }
    cache.set(key, out);
    return out && out.cpr != null ? out : null;
  }

  // A firearm's price is the weighted average across its own chamberings, as of that date.
  function forFirearm(gun, date) {
    const parts = gunCalibers(gun).map(c => ({ c: c.trim(), l: lots[c.trim()] }))
      .filter(x => x.l && x.l.length);
    if (!parts.length) return null;
    let spend = 0, rounds = 0, estimated = false;
    parts.forEach(({ c }) => {
      const l = lots[c];
      const upTo = date ? l.filter(x => (x.date || '') <= date) : l;
      if (upTo.length) {
        spend += upTo.reduce((x, y) => x + y.spend, 0);
        rounds += upTo.reduce((x, y) => x + y.rounds, 0);
      } else {
        spend += l[0].spend;
        rounds += l[0].rounds;
        estimated = true;
      }
    });
    if (!rounds) return null;
    return { cpr: spend / rounds, estimated };
  }

  return { forCaliber, forFirearm };
}

// What one range trip cost, broken out by firearm. `unpriced` is rounds whose chambering has
// no logged ammo at all — reported rather than folded in as if they were free.
function sessionCost(session, pricer, scoped) {
  const p = pricer || buildCaliberPricer();
  let cost = 0, rounds = 0, unpriced = 0, estimated = false;
  const byFirearm = [];
  Object.entries(session.rounds || {}).forEach(([gid, n]) => {
    if (scoped && !scoped.has(gid)) return;
    const gun = (data.firearms || []).find(g => g.id === gid);
    if (!gun) return;
    const priced = p.forFirearm(gun, session.date);
    if (!priced) { unpriced += n; return; }
    if (priced.estimated) estimated = true;
    cost += n * priced.cpr;
    rounds += n;
    byFirearm.push({ gun, name: gun.name, rounds: n, cpr: priced.cpr,
                     cost: n * priced.cpr, estimated: priced.estimated });
  });
  byFirearm.sort((a, b) => b.cost - a.cost);
  return { cost, rounds, unpriced, estimated, byFirearm, cpr: rounds ? cost / rounds : null };
}

// ── COST OF SHOOTING ──────────────────────────────────────────────
// What you have actually put downrange, as money. Total spend is what left your wallet;
// this is what got fired, which is the figure you would quote to someone.
//
// It is an estimate and says so: rounds are logged per firearm and purchases per caliber, so
// there is no way to know which specific box a given round came from. Each firearm's rounds
// are priced at the average of the range ammo bought for its chambering — which is exactly
// what the "not range ammo" flag is for. A 20-round box of carry ammo at five times the
// price would otherwise inflate every round that firearm has ever fired.
function renderCostToShoot() {
  const el = document.getElementById('stats-as-cost');
  if (!el) return;
  const { start, end } = getStatsRangeBounds();
  const scoped = scopedGunIdsFromFilters();
  const pricer = buildCaliberPricer();

  const sessions = (data.sessions || []).filter(s =>
    (!start || s.date >= start) && (!end || s.date <= end));

  // Built from the same per-session figures the trip list uses, so the two can never
  // disagree — each trip is priced as of its own date and the firearm totals are the sum.
  const byGun = {};
  let unpriced = 0, estimated = false, tripsInScope = 0;
  sessions.forEach(s => {
    const c = sessionCost(s, pricer, scoped);
    unpriced += c.unpriced;
    if (c.estimated) estimated = true;
    if (c.rounds > 0 || c.unpriced > 0) tripsInScope++;
    c.byFirearm.forEach(f => {
      const row = byGun[f.name] || (byGun[f.name] = { name: f.name, rounds: 0, cost: 0 });
      row.rounds += f.rounds;
      row.cost += f.cost;
    });
  });

  const rows = Object.values(byGun)
    .map(r => ({ ...r, cpr: r.rounds ? r.cost / r.rounds : 0 }))
    .sort((a, b) => b.cost - a.cost);
  if (!rows.length) { el.innerHTML = ''; return; }

  const total = rows.reduce((x, r) => x + r.cost, 0);
  const max = rows[0].cost || 1;

  const rowsHtml = rows.map(r => `
    <div class="breakdown-row">
      <div class="breakdown-top">
        <span class="breakdown-name">${esc(r.name)}</span>
        <span class="breakdown-val">$${r.cost.toFixed(2)}</span>
      </div>
      <div class="breakdown-bar-track">
        <div class="breakdown-bar-fill" style="width:${Math.round((r.cost / max) * 100)}%"></div>
      </div>
      <div class="breakdown-pct">${r.rounds.toLocaleString()} rounds, averaging $${r.cpr.toFixed(3)}/rd</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title">Cost of Shooting</div>
      <div class="stats-stat-grid two">
        <div class="stats-stat-box">
          <div class="stats-stat-num">$${total.toFixed(2)}</div>
          <div class="stats-stat-label">Rounds Fired</div></div>
        <div class="stats-stat-box">
          <div class="stats-stat-num">$${tripsInScope ? (total / tripsInScope).toFixed(2) : '0.00'}</div>
          <div class="stats-stat-label">Per Range Trip</div></div>
      </div>
      ${rowsHtml}
      <div class="stats-note"><b>Estimated</b> from the range ammo you'd bought by each trip's
        date, so these don't change when you buy more. Carry ammo excluded.${
        estimated ? ' Some trips predate every purchase of what was shot and fall back to the earliest price on record.' : ''}${
        unpriced ? ` ${unpriced.toLocaleString()} rounds aren't priced here: no ammo logged
        for their chambering.` : ''}</div>
    </div>`;
}

// The average trip cost hides a lot: on real data the most expensive range day runs nearly
// ten times the cheapest, and it is driven by what got shot rather than how much. Ranking the
// trips shows which ones ran high, and the per-round rate beside each says why.
// Which end of the ranking you care about depends on the question: "what did I splurge on"
// reads from the top, "what does a cheap afternoon look like" reads from the bottom. Cheaper
// to offer both than to make someone scroll to the end of 22 trips.
let tripSortDesc = true;

function toggleTripSort() {
  tripSortDesc = !tripSortDesc;
  renderCostPerTrip();
}

function renderCostPerTrip() {
  const el = document.getElementById('stats-as-trips');
  if (!el) return;
  const { start, end } = getStatsRangeBounds();
  const scoped = scopedGunIdsFromFilters();
  const pricer = buildCaliberPricer();

  const rows = (data.sessions || [])
    .filter(s => (!start || s.date >= start) && (!end || s.date <= end))
    .map(s => ({ s, ...sessionCost(s, pricer, scoped) }))
    .filter(r => r.cost > 0)
    .sort((a, b) => tripSortDesc ? b.cost - a.cost : a.cost - b.cost);
  if (rows.length < 2) { el.innerHTML = ''; return; }

  // Bar width stays relative to the most expensive trip whichever way the list is sorted,
  // so reversing the order rearranges the rows without redrawing every bar full-width.
  const max = Math.max(...rows.map(r => r.cost));
  const rowsHtml = rows.map(r => {
    const loc = data.locations.find(l => l.id === r.s.locationId);
    // What was actually shot and what each firearm's share of the money was — sorted by
    // cost rather than rounds, since this is the money view and the two orders differ:
    // 30 rounds of centerfire outspend 60 of rimfire.
    const guns = r.byFirearm;
    return `
      <div class="breakdown-row trip-row tappable" onclick="openViewSession('${r.s.id}')"
           role="button" tabindex="0" title="View this session">
        <div class="breakdown-top">
          <span class="breakdown-name">${fmtDate(r.s.date)}${
            r.estimated ? ' <span class="est-flag" title="Predates every purchase of what was shot — priced from the earliest record">≈</span>' : ''}</span>
          <span class="breakdown-val">$${r.cost.toFixed(2)}</span>
        </div>
        <div class="breakdown-bar-track">
          <div class="breakdown-bar-fill" style="width:${Math.round((r.cost / max) * 100)}%"></div>
        </div>
        <div class="breakdown-pct">${r.rounds.toLocaleString()} rounds at $${r.cpr.toFixed(3)}/rd${
          loc ? ` · ${esc(loc.name)}` : ''}</div>
        <div class="trip-guns">${guns.map(g =>
          `<span>${esc(g.name)} <b>$${g.cost.toFixed(2)}</b> <i>${g.rounds} rds</i></span>`).join('')}</div>
        ${r.s.notes && r.s.notes.trim()
          // One line, clipped. Most notes fit whole; the long ones give their gist, and the
          // row opens the session for the rest. A note is why the trip was what it was —
          // "first time with AR15", "indoor qual" — so it earns the line.
          ? `<div class="trip-note" title="${esc(r.s.notes)}">${
              esc(r.s.notes).replace(/\s*\n+\s*/g, ' · ')}</div>`
          : ''}
      </div>`;
  }).join('');

  const costs = rows.map(r => r.cost);
  const cheapest = Math.min(...costs), priciest = Math.max(...costs);
  // Scrolls inside itself past a handful of trips rather than capping the list — the same
  // treatment the Details lists get, so a long record stays browsable without pushing
  // everything below it off screen.
  const panel = rows.length > 5 ? ' list-scroll' : '';
  el.innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title sortable">
        <span>Cost Per Trip</span>
        <button class="sort-toggle" onclick="toggleTripSort()"
                aria-label="Sort by cost, ${tripSortDesc ? 'ascending' : 'descending'}">
          ${tripSortDesc ? 'Most first ▾' : 'Least first ▴'}
        </button>
      </div>
      <div class="trip-list${panel}" id="stats-trip-list">${rowsHtml}</div>
      <div class="stats-note">${rows.length} trips — tap one to open it. The most expensive ran
        ${(priciest / cheapest).toFixed(1)}× the cheapest, driven by what was shot rather than
        how much.${
        rows.some(r => r.estimated)
          ? ' Trips marked ≈ predate every purchase of what was shot and use the earliest price on record.'
          : ''}</div>
    </div>`;

  const list = document.getElementById('stats-trip-list');
  if (list && panel) {
    if (!list.dataset.scrollBound) {
      list.addEventListener('scroll', () => markHistoryScrollEnd(list), { passive: true });
      list.dataset.scrollBound = '1';
    }
    markHistoryScrollEnd(list);
  }
}

// ── BURN RATE ─────────────────────────────────────────────────────
// Rounds actually fired per month, by chambering. This comes from the session log, which is
// complete — unlike inventory, which cannot be computed because ammo bought before the app
// existed was never recorded.
//
// Bucketed by a firearm's whole caliber list rather than by individual caliber. Rounds are
// logged per firearm, so a gun chambered .357/.38 cannot say which of the two it fired; put
// both in one bucket and the question stops existing. Bucketing by firearm also means every
// firearm lands in exactly one bucket, so nothing is counted twice.
function burnRateBuckets(start, end, scoped) {
  const key = gun => {
    const cs = gunCalibers(gun).map(c => c.trim()).filter(Boolean).sort(
      (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return cs.length ? cs.join(' / ') : '(no caliber)';
  };
  const rounds = {};
  (data.sessions || []).forEach(s => {
    if (start && s.date < start) return;
    if (end && s.date > end) return;
    Object.entries(s.rounds || {}).forEach(([gid, n]) => {
      if (scoped && !scoped.has(gid)) return;
      const gun = (data.firearms || []).find(g => g.id === gid);
      if (!gun) return;
      const k = key(gun);
      rounds[k] = (rounds[k] || 0) + n;
    });
  });
  return rounds;
}

function renderBurnRate() {
  const el = document.getElementById('stats-as-burn');
  if (!el) return;
  const { start, end } = getStatsRangeBounds();
  const scoped = scopedGunIdsFromFilters();

  // The window is what was actually shot in, not what was asked for: "all time" has no start,
  // and a range reaching into the future would deflate the rate.
  const dates = (data.sessions || [])
    .filter(s => (!start || s.date >= start) && (!end || s.date <= end))
    .map(s => s.date).sort();
  if (dates.length < 2) { el.innerHTML = ''; return; }
  const days = (new Date(dates[dates.length - 1]) - new Date(dates[0])) / 86400000;
  const months = Math.max(days / 30.44, 0.5);

  const rounds = burnRateBuckets(start, end, scoped);
  const rows = Object.entries(rounds)
    .map(([k, n]) => ({ label: k, rounds: n, rate: n / months }))
    .filter(r => r.rounds > 0)
    .sort((a, b) => b.rate - a.rate);
  if (!rows.length) { el.innerHTML = ''; return; }

  const max = rows[0].rate;
  const rowsHtml = rows.map(r => `
    <div class="breakdown-row">
      <div class="breakdown-top">
        <span class="breakdown-name">${esc(r.label)}</span>
        <span class="breakdown-val" style="color:${'#1f68bc'}">${Math.round(r.rate).toLocaleString()} / mo</span>
      </div>
      <div class="breakdown-bar-track">
        <div class="breakdown-bar-fill" style="width:${Math.round((r.rate / max) * 100)}%;background:#1f68bc;"></div>
      </div>
      <div class="breakdown-pct">${r.rounds.toLocaleString()} rounds over ${
        months < 1.5 ? 'about a month' : `${Math.round(months)} months`}</div>
    </div>`).join('');

  el.innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title">Burn Rate</div>
      ${rowsHtml}
      <div class="stats-note">Rounds actually fired, grouped by chambering, so a two-caliber
        firearm counts once. <b>Not inventory</b> — what's left on the shelf can't be worked out
        from logged purchases alone.</div>
    </div>`;
}

// ── STATS · GROUPS ────────────────────────────────────────────────
// Scoped to one firearm on purpose. Group sizes are not comparable between firearms — a
// rimfire rifle at 50 yd and a pistol at 25 ft are not on the same scale, and on one axis
// the pistol is the only thing you can see.

// Median rather than mean throughout: a single group is a noisy estimate, and two lucky
// ones shouldn't move a load or a session up the ranking.
// 25 ft and 8.333 yd are the same distance typed two ways. Anything that buckets by
// distance normalizes first, or one distance shows up as two.
function groupDistanceYards(g) {
  const u = g.distanceUnit || 'yd';
  const d = Number(g.distance) || 0;
  return u === 'ft' ? d / 3 : u === 'm' ? d * 1.09361 : d;
}
function groupDistanceLabel(g) {
  const y = groupDistanceYards(g);
  return (Math.abs(y - Math.round(y)) < 0.01 ? Math.round(y) : y.toFixed(1)) + ' yd';
}

// Ammo names as logged carry a lot of words that add nothing once you know which load you
// mean: "CCI Standard Velocity 22LR Ammo 40 Grain Round Nose" is four lines on a phone.
// Only ever used for display — the stored name is untouched, and the full text stays in the
// row's title.
function shortLoadName(name) {
  return String(name || '')
    .replace(/\s+Ammo\s+/i, ' ')
    .replace(/(\d+)\s*[Gg]rain/, '$1gr')
    .replace(/\s+(Round Nose|Full Metal Jacket|hollow point boat tail.*|copper plated.*)/i, '')
    // Trailing SKU like " - NR912450". Whitespace before the dash is required, or this eats
    // the calibre out of names that hyphenate, turning "Norma Tac-22" into "Norma Tac".
    .replace(/\s+-\s*\w+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || String(name || '');
}

function statsMedian(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Every group for the selected firearm that survives the shared filters, with its size
// recomputed from the marked points — never read from a stored value.
function groupsInScope() {
  const gunId = document.getElementById('stats-firearm').value;
  const gun = gunId ? data.firearms.find(g => g.id === gunId) : null;
  if (!gun) return { gun: null, groups: [] };

  const { start, end } = getStatsRangeBounds();
  const locId = document.getElementById('stats-location').value;

  const groups = (gun.groups || []).filter(g => {
    if (start && g.date < start) return false;      // >= start: same-day counts as after
    if (end && g.date > end) return false;
    if (locId) {
      const ses = g.sessionId ? data.sessions.find(s => s.id === g.sessionId) : null;
      if (!ses || ses.locationId !== locId) return false;
    }
    return true;
  }).map(g => {
    const distIn = groupDistanceInches(g);
    const m = groupMetrics(groupToInches(g));
    return {
      raw: g, date: g.date, ammo: g.ammo || '(unspecified)', tags: g.tags || [],
      shots: m ? m.n : 0,
      mrMOA: m && distIn ? toMOA(m.meanRadius, distIn) : null,
      mrIn: m ? m.meanRadius : null,
      esMOA: m && distIn ? toMOA(m.es, distIn) : null,
      // Group center relative to point of aim. +x right, +y up.
      offXMOA: m && distIn ? toMOA(m.cx, distIn) : null,
      offYMOA: m && distIn ? toMOA(m.cy, distIn) : null,
      distance: g.distance, distanceUnit: g.distanceUnit || 'yd',
    };
  }).filter(g => g.mrMOA != null).sort((a, b) => a.date.localeCompare(b.date));

  return { gun, groups };
}

// ── GROUPS SCOPE ──────────────────────────────────────────────────
// Ammo, distance and tag narrow every chart in the Groups pane. They exist because point of
// impact is only one measurement within a single distance: at another distance you dial a
// different come-up, so if that come-up is wrong its groups land somewhere else and drag the
// median with them. Same for ammo, which has its own point of impact. Reading a zero means
// pinning both, and that is what these are for.
//
// An empty set means "all", so the default state costs nothing and matches how the pane
// behaved before this existed.
const GROUP_SCOPE_DIMS = {
  ammo:     { label: 'Ammo',     of: g => [g.ammo], short: v => shortLoadName(v) },
  distance: { label: 'Distance', of: g => [groupDistanceLabel(g.raw)], short: v => v },
  tag:      { label: 'Tag',      of: g => (g.tags.length ? g.tags : ['Untagged']), short: v => v },
};

let groupScope = { ammo: new Set(), distance: new Set(), tag: new Set() };
let groupScopeGunId = null;

// Selections belong to a firearm: 77gr at 50 yd means nothing once you switch to a different
// rifle, and silently carrying it over would show an empty pane for no visible reason.
function resetGroupScopeIfGunChanged(gunId) {
  if (groupScopeGunId === gunId) return;
  groupScopeGunId = gunId;
  groupScope = { ammo: new Set(), distance: new Set(), tag: new Set() };
}

// True when the group satisfies every dimension except the one named — the basis for facet
// counts, which have to answer "how many would I get if I clicked this" rather than "how
// many exist in total", or the numbers contradict what the chart then shows.
function groupMatchesScope(g, except) {
  return Object.keys(GROUP_SCOPE_DIMS).every(dim => {
    if (dim === except) return true;
    const sel = groupScope[dim];
    if (!sel.size) return true;
    return GROUP_SCOPE_DIMS[dim].of(g).some(v => sel.has(v));
  });
}

function applyGroupScope(groups) {
  return groups.filter(g => groupMatchesScope(g, null));
}

function toggleGroupScope(dim, value) {
  const sel = groupScope[dim];
  if (!sel) return;
  if (value === null) sel.clear();                 // the "All" chip
  else if (sel.has(value)) sel.delete(value);
  else sel.add(value);
  renderStats();
}

// Offered by the mixed-distance note, which is usually the first sign the mix is a problem.
// Picks the best-supported distance rather than the nearest or the first, since that is the
// one with enough groups to read a median from.
function scopeToSingleDistance() {
  const { gun, groups } = groupsInScope();
  if (!gun || !groups.length) return;
  const counts = {};
  groups.forEach(g => {
    const k = groupDistanceLabel(g.raw);
    counts[k] = (counts[k] || 0) + 1;
  });
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!best) return;
  groupScope.distance = new Set([best[0]]);
  renderStats();
}

// Drops selections whose value is no longer present — narrowing the date range can remove a
// load entirely, and a selection you cannot see or clear would silently empty the pane.
function pruneGroupScope(groups) {
  Object.keys(GROUP_SCOPE_DIMS).forEach(dim => {
    const live = new Set(groups.flatMap(g => GROUP_SCOPE_DIMS[dim].of(g)));
    [...groupScope[dim]].forEach(v => { if (!live.has(v)) groupScope[dim].delete(v); });
  });
}

function renderGroupScope(groups) {
  const el = document.getElementById('stats-groups-scope');
  if (!el) return;

  const rows = Object.entries(GROUP_SCOPE_DIMS).map(([dim, cfg]) => {
    const values = [...new Set(groups.flatMap(g => cfg.of(g)))]
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    // A dimension with one value cannot narrow anything, so it would be a row of one chip
    // that does nothing. Tags are the common case — most groups carry none.
    if (values.length < 2) return '';

    const sel = groupScope[dim];
    const chips = values.map(v => {
      const n = groups.filter(g => cfg.of(g).includes(v) && groupMatchesScope(g, dim)).length;
      const on = sel.has(v);
      // Zero here means the other dimensions already exclude it. Left visible so the set of
      // choices does not shift under your finger, but inert — clicking it empties the pane.
      const dead = n === 0 && !on;
      // Label and count are separate elements so the label can ellipsize without taking the
      // count with it — .22 match ammo names run long enough to fill the row on their own,
      // and the count is the part you are scanning for. Full name stays in the title.
      return `<button class="scope-chip${on ? ' on' : ''}${dead ? ' dead' : ''}"
                ${dead ? 'disabled' : ''} aria-pressed="${on}"
                onclick="toggleGroupScope('${dim}', ${JSON.stringify(v).replace(/"/g, '&quot;')})"
                title="${esc(v)}"><span class="scope-chip-t">${esc(cfg.short(v))}</span><b>${n}</b></button>`;
    }).join('');

    return `
      <div class="scope-row">
        <label class="filter-label">${cfg.label}</label>
        <div class="scope-chips">
          <button class="scope-chip scope-all${sel.size ? '' : ' on'}"
                  aria-pressed="${!sel.size}"
                  onclick="toggleGroupScope('${dim}', null)">All</button>
          ${chips}
        </div>
      </div>`;
  }).filter(Boolean).join('');

  if (!rows) { el.innerHTML = ''; return; }

  const scoped = applyGroupScope(groups);
  const active = Object.entries(groupScope).filter(([, s]) => s.size);
  const summary = active.length
    ? `${scoped.length} of ${groups.length} groups · ` +
      active.map(([dim, s]) => [...s].map(v => esc(GROUP_SCOPE_DIMS[dim].short(v))).join(' or '))
        .join(' · ')
    : `all ${groups.length} groups`;

  el.innerHTML = `<div class="stats-chart-card scope-card">
      ${rows}
      <div class="scope-summary">${summary}</div>
    </div>`;
}

function renderGroupsStats() {
  const promptEl = document.getElementById('stats-groups-prompt');
  const bodyEl = document.getElementById('stats-groups-body');
  if (!promptEl || !bodyEl) return;

  const { gun, groups: unscoped } = groupsInScope();
  if (!gun) {
    bodyEl.style.display = 'none';
    promptEl.innerHTML = `<div class="empty-state" style="padding:26px 16px;">
      Pick a firearm above to see its groups.<br>
      <span style="font-size:0.72rem;color:var(--text-dim);">
        Group sizes aren't comparable between firearms, so this view always looks at one.
      </span></div>`;
    return;
  }
  promptEl.innerHTML = '';
  bodyEl.style.display = '';

  if (!unscoped.length) {
    document.getElementById('stats-groups-scope').innerHTML = '';
    document.getElementById('stats-groups-stats').innerHTML =
      `<div class="empty-state" style="padding:20px 16px;">
        No measurable groups for ${esc(gun.name)} in this range.</div>`;
    document.getElementById('stats-groups-trend').innerHTML = '';
    document.getElementById('stats-groups-compare').innerHTML = '';
    document.getElementById('stats-groups-poi').innerHTML = '';
    return;
  }

  // Scope is per firearm and only over what the shared filters already left in play, so it
  // is reset and pruned before the chips are drawn from it.
  resetGroupScopeIfGunChanged(gun.id);
  pruneGroupScope(unscoped);
  renderGroupScope(unscoped);
  const groups = applyGroupScope(unscoped);

  if (!groups.length) {
    document.getElementById('stats-groups-stats').innerHTML =
      `<div class="empty-state" style="padding:20px 16px;">
        Nothing matches this combination.<br>
        <span style="font-size:0.72rem;color:var(--text-dim);">
          Clear a filter above to widen it.</span></div>`;
    document.getElementById('stats-groups-trend').innerHTML = '';
    document.getElementById('stats-groups-compare').innerHTML = '';
    document.getElementById('stats-groups-poi').innerHTML = '';
    return;
  }

  const sizes = groups.map(g => g.mrMOA);
  const days = [...new Set(groups.map(g => g.date))];
  document.getElementById('stats-groups-stats').innerHTML = `
    <div class="stats-stat-grid">
      <div class="stats-stat-box">
        <div class="stats-stat-num">${gFmt(statsMedian(sizes))}</div>
        <div class="stats-stat-label">Median MOA</div></div>
      <div class="stats-stat-box">
        <div class="stats-stat-num">${gFmt(Math.min(...sizes))}</div>
        <div class="stats-stat-label">Best Group</div></div>
      <div class="stats-stat-box">
        <div class="stats-stat-num">${groups.length}</div>
        <div class="stats-stat-label">Groups · ${days.length} day${days.length === 1 ? '' : 's'}</div></div>
    </div>
    <div class="stats-note">Mean radius, median across groups — comparable across different
      shot counts, unlike extreme spread.</div>`;

  renderGroupTrend(gun, groups);
  updateCompareCounts(groups);
  renderGroupCompare(groups);
  renderGroupPOI(gun, groups);
}

// How many distinct buckets a dimension would split these groups into. One bucket means
// there is nothing to compare, which is worth knowing before you pick it rather than after.
function groupBucketCount(groups, dim) {
  const seen = new Set();
  groups.forEach(g => dim.of(g).forEach(k => seen.add(k)));
  return seen.size;
}

// Carry each dimension's bucket count in the picker itself. Tags in particular are often
// sparse — a rifle every group of which is tagged "prone" offers nothing to compare, and
// without the count the only way to discover that was to select it and hit a dead end.
function updateCompareCounts(groups) {
  const sel = document.getElementById('stats-groups-compare-by');
  if (!sel) return;
  [...sel.options].forEach(o => {
    const dim = GROUP_COMPARE_DIMS[o.value];
    if (!dim) return;
    const base = o.dataset.label || o.textContent;
    o.textContent = `${base} (${groupBucketCount(groups, dim)})`;
  });
}

// The picker's own wording for a dimension, so a suggestion chip names exactly what you
// would be selecting. Falls back to the sentence-case label the empty state uses.
function compareDimLabel(key) {
  const o = document.querySelector(`#stats-groups-compare-by option[value="${key}"]`);
  return (o && o.dataset.label) || (GROUP_COMPARE_DIMS[key] || {}).label || key;
}

// Chips in the empty state switch the picker for you, so a dead end costs one tap instead
// of trying each dimension in turn.
function setGroupCompare(key) {
  const sel = document.getElementById('stats-groups-compare-by');
  if (!sel) return;
  sel.value = key;
  renderStats();
}

// Every group is plotted, dimmed, with the bold line joining session medians. One group is a
// noisy estimate — on this rifle a single afternoon has spanned better than 3x best to worst
// — so a line through individual groups would show trends that are only sampling noise.
//
// The x-axis is real time rather than one slot per range day: evenly spacing them makes a
// two-month gap look like a week between trips, which misreads the history as a steady march.
// That means the plot can be wider than the screen, so it scrolls under a pinned y-axis.
const TREND_ZOOMS = [
  { key: 'fit', label: 'Fit' },
  { key: '6mo', label: '6 mo', days: 183 },
  { key: '3mo', label: '3 mo', days: 92 },
  { key: '1mo', label: '1 mo', days: 31 },
];
// View state, not data: it survives a re-render so that opening a session from the chart and
// closing it again puts you back where you were looking.
let trendZoom = 'fit';
let trendScrollLeft = 0;

function setTrendZoom(key) {
  if (!TREND_ZOOMS.some(z => z.key === key)) return;
  trendZoom = key;
  // Zooming in holds the most recent end, which is where you were.
  trendScrollLeft = key === 'fit' ? 0 : Number.MAX_SAFE_INTEGER;
  renderGroupsStats();
}

function renderGroupTrend(gun, groups) {
  const el = document.getElementById('stats-groups-trend');
  const byDate = {};
  groups.forEach(g => (byDate[g.date] = byDate[g.date] || []).push(g));
  const dates = Object.keys(byDate).sort();

  const days = dates.map(d => {
    const v = byDate[d].map(g => g.mrMOA);
    return {
      date: d, t: dateMs(d), n: v.length, med: statsMedian(v),
      lo: Math.min(...v), hi: Math.max(...v),
      // A day is one range trip in practice; where groups from that day span more than one
      // session, the busiest wins rather than guessing.
      sessionId: pickSessionForDay(byDate[d]),
    };
  });

  const H = 200, PT = 18, PB = 36, PAD = 12, AXIS_W = 42;
  const existing = el.querySelector('.trend-scroll');
  // A container that has not been laid out yet — or is in a hidden pane — measures zero.
  // Fall back to a sane width rather than dividing by it.
  const measured = existing ? existing.clientWidth : 0;
  const viewW = measured > 40 ? measured : 300;
  const T0 = days[0].t, T1 = days[days.length - 1].t;
  const spanDays = Math.max((T1 - T0) / 86400000, 1) + 20;
  const z = TREND_ZOOMS.find(o => o.key === trendZoom) || TREND_ZOOMS[0];
  const pxPerDay = (z.days ? viewW / z.days : viewW / spanDays);
  const W = Math.max(viewW, spanDays * pxPerDay);
  const x = t => PAD + ((t - T0) / 86400000) * pxPerDay;
  const vals = groups.map(g => g.mrMOA);
  const ymax = Math.max(...vals) * 1.2 || 1;
  const y = v => H - PB - (v / ymax) * (H - PT - PB);

  const ACCENT = '#c8a84b', ZERO = '#1f68bc', GRIDC = '#2e2e2e', DIM = '#8a8a8a';
  const ticks = [0, ymax / 2, ymax];

  // The y-axis is its own element so it never scrolls — and never scales, which a CSS
  // transform over the whole chart would have done to every label and stroke.
  const axisSvg = ticks.map(t =>
    `<text x="${AXIS_W - 6}" y="${y(t) + 3}" fill="${DIM}" font-family="IBM Plex Mono"
           font-size="9" text-anchor="end">${gFmt(t, 1)}</text>`).join('') +
    `<line x1="${AXIS_W - 3}" y1="${PT - 6}" x2="${AXIS_W - 3}" y2="${H - PB}" stroke="${GRIDC}"/>`;

  let svg = ticks.map(t =>
    `<line x1="0" y1="${y(t)}" x2="${W}" y2="${y(t)}" stroke="${GRIDC}"/>`).join('');

  // Month gridlines are the skeleton of the timeline at every zoom.
  const months = [];
  for (let d = new Date(T0); d.getTime() <= T1 + 30 * 86400000; d.setMonth(d.getMonth() + 1)) {
    months.push(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
  }
  months.forEach(m => { svg += `<line x1="${x(m)}" y1="${PT - 6}" x2="${x(m)}" y2="${H - PB}"
    stroke="${GRIDC}" opacity="0.7"/>`; });

  // Zoomed in far enough that a week is a comfortable label apart, the axis names the range
  // days themselves — a date is what you need to find the session it came from. Zoomed out,
  // months are all that fits.
  if (pxPerDay * 7 >= 40) {
    let lastX = -Infinity;
    days.forEach(d => {
      if (x(d.t) - lastX < 40) return;      // trips cluster; skip what will not fit
      svg += `<text x="${x(d.t)}" y="${H - 14}" fill="${DIM}" font-family="IBM Plex Mono"
                    font-size="9" text-anchor="middle">${trendDayLabel(d.date)}</text>`;
      lastX = x(d.t);
    });
  } else {
    const everyN = Math.max(1, Math.ceil(58 / (30 * pxPerDay)));
    let prev = null;
    months.forEach((m, i) => {
      if (i % everyN) return;
      svg += `<text x="${x(m)}" y="${H - 14}" fill="${DIM}" font-family="IBM Plex Mono"
                    font-size="9" text-anchor="middle">${trendMonthLabel(m, prev)}</text>`;
      prev = m;
    });
  }

  // Re-zero marks are drawn whatever the range is set to: hiding the boundary unless you
  // filtered by it is how you read straight through one. Labels are per cluster, since at low
  // zoom two zeros a week apart are a few pixels apart and pushing their labels apart just
  // walks them off the chart.
  const { start, end } = getStatsRangeBounds();
  const zs = (gun.zeros || []).map(z2 => z2.date)
    .filter(d => (!start || d >= start) && (!end || d <= end) && d >= dates[0] && d <= dates[dates.length - 1])
    .sort();
  zs.forEach(d => { svg += `<line x1="${x(dateMs(d))}" y1="${PT - 6}" x2="${x(dateMs(d))}"
    y2="${H - PB}" stroke="${ZERO}" stroke-width="1" stroke-dasharray="3 3"/>`; });
  const clusters = [];
  zs.forEach(d => {
    const last = clusters[clusters.length - 1];
    if (last && x(dateMs(d)) - x(dateMs(last[last.length - 1])) < 52) last.push(d);
    else clusters.push([d]);
  });
  clusters.forEach(c => {
    const at = x(dateMs(c[0]));
    const text = c.length > 1 ? `${c.length} re-zeros` : 're-zero';
    const right = at + 4 + text.length * 5.4 < W - 4;
    svg += `<text x="${right ? at + 4 : at - 4}" y="${PT + 6}" fill="${ZERO}"
                  font-family="IBM Plex Mono" font-size="9"
                  text-anchor="${right ? 'start' : 'end'}">${text}</text>`;
  });

  // The faint vertical bar is that day's best-to-worst range — the honest width of the
  // estimate. A trend is real when the medians move further than those bars are tall.
  days.forEach(d => {
    svg += `<line x1="${x(d.t)}" y1="${y(d.lo)}" x2="${x(d.t)}" y2="${y(d.hi)}"
                  stroke="${ACCENT}" stroke-width="1" opacity="0.28"/>`;
    byDate[d.date].forEach(g => {
      svg += `<circle cx="${x(d.t)}" cy="${y(g.mrMOA)}" r="2.8" fill="${ACCENT}" opacity="0.5"/>`;
    });
  });
  svg += `<polyline fill="none" stroke="${ACCENT}" stroke-width="2.2" stroke-linejoin="round"
            points="${days.map(d => `${x(d.t)},${y(d.med)}`).join(' ')}"/>`;

  let lastLabel = -Infinity;
  days.forEach(d => {
    svg += `<circle class="trend-point" data-session="${d.sessionId || ''}" data-date="${d.date}"
                    cx="${x(d.t)}" cy="${y(d.med)}" r="4.2" fill="${ACCENT}"
                    stroke="var(--surface)" stroke-width="2"/>`;
    if (x(d.t) - lastLabel >= 30) {
      svg += `<text x="${x(d.t)}" y="${y(d.med) - 9}" fill="${ACCENT}" font-family="IBM Plex Mono"
                    font-size="9" text-anchor="middle">${gFmt(d.med)}</text>`;
      lastLabel = x(d.t);
    }
  });

  const tappable = days.some(d => d.sessionId);
  el.innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title">Group Size Over Time</div>
      <div class="trend-chart">
        <svg class="trend-axis" viewBox="0 0 ${AXIS_W} ${H}" width="${AXIS_W}" height="${H}"
             aria-hidden="true">${axisSvg}</svg>
        <div class="trend-scroll" data-pxperday="${pxPerDay}" data-pad="${PAD}" data-t0="${T0}">
          <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img"
               aria-label="Median group size per range day">${svg}</svg>
        </div>
      </div>
      <div class="trend-ctrl">
        ${TREND_ZOOMS.map(o => `<button type="button" class="${o.key === trendZoom ? 'on' : ''}"
          onclick="setTrendZoom('${o.key}')">${o.label}</button>`).join('')}
        <span class="trend-readout" id="trend-readout"></span>
      </div>
      <div class="stats-note">Bold line joins each range day's <b>median</b>; every group is
        plotted faintly behind it, with the vertical bar showing that day's best to worst.${
        tappable ? ' Tap a point to open that session.' : ''}${
        dates.length < 3 ? ' Too few range days for a trend yet.' : ''}</div>
    </div>`;

  wireTrendScroll(el.querySelector('.trend-scroll'), viewW);
}

// A range day is one trip in practice. Where a day's groups span more than one session, the
// one carrying most of them wins rather than the chart guessing silently.
// ── ONE RANGE DAY ─────────────────────────────────────────────────
// Tapping a point on the trend asks "what did I shoot that day", so this is keyed on the
// calendar date rather than the session. A group marked without a session still has a date,
// and dropping it would quietly hide groups from a day that plainly contains them.
let dayViewGunId = null;
let dayViewDate = null;

function openGroupDay(gunId, dateISO) {
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun || !dateISO) return;
  dayViewGunId = gunId;
  dayViewDate = dateISO;
  renderGroupDay();
  openModal('modal-day');
}

// Every group this firearm shot on the day, whether or not it carries a session.
function groupsOnDay(gun, dateISO) {
  return (gun.groups || [])
    .filter(g => g.date === dateISO)
    .map(g => {
      const distIn = groupDistanceInches(g);
      const m = groupMetrics(groupToInches(g));
      return {
        raw: g,
        moa: m && distIn ? toMOA(m.es, distIn) : null,
        inches: m ? m.es : null,
        shots: m ? m.n : 0,
      };
    })
    .sort((a, b) => (a.moa ?? Infinity) - (b.moa ?? Infinity));
}

function renderGroupDay() {
  const gun = data.firearms.find(g => g.id === dayViewGunId);
  if (!gun || !dayViewDate) return;
  const rows = groupsOnDay(gun, dayViewDate);

  document.getElementById('day-title').textContent = fmtDate(dayViewDate);
  document.getElementById('day-sub').textContent =
    `${gun.name} · ${rows.length} group${rows.length === 1 ? '' : 's'}`;

  const sessionId = pickSessionForDay(rows);
  const session = sessionId ? (data.sessions || []).find(s => s.id === sessionId) : null;
  const loc = session && session.locationId
    ? (data.locations || []).find(l => l.id === session.locationId) : null;

  const shots = rows.reduce((n, r) => n + r.shots, 0);
  const measured = rows.map(r => r.moa).filter(v => v != null);
  const median = measured.length ? gFmt(statsMedian(measured)) : '—';
  const roundsLogged = session ? (session.rounds || {})[gun.id] : null;

  // Two figures that never match, shown together on purpose. "Rounds logged" is what was
  // recorded for this firearm that day; "shots measured" is what is actually in the groups
  // below. You do not photograph every string, so the first is normally the larger — but
  // either one alone reads as though it should equal the other.
  const figures = `
    <div class="day-figs">
      ${roundsLogged ? `<div class="day-fig"><b>${roundsLogged}</b><span>rounds logged</span></div>` : ''}
      <div class="day-fig"><b>${shots}</b><span>shots measured</span></div>
      <div class="day-fig"><b>${median}</b><span>median MOA</span></div>
    </div>`;

  document.getElementById('day-context').innerHTML = session
    ? `<div class="day-session">
         ${loc ? `<div class="day-loc">${esc(loc.name)}</div>` : ''}
         ${session.notes ? `<div class="day-note">${esc(session.notes)}</div>` : ''}
         ${figures}
       </div>
       ${roundsLogged ? `<div class="day-caveat"><b>Rounds logged</b> is what you recorded for
          this firearm that day; <b>shots measured</b> is what is in the groups below. They
          rarely match — you don't photograph every string.</div>` : ''}`
    : `<div class="day-nosession">No session logged for this day · ${shots} shot${
         shots === 1 ? '' : 's'} measured · median ${median} MOA</div>`;

  const best = measured.length ? Math.min(...measured) : null;
  document.getElementById('day-groups').innerHTML = rows.length
    ? rows.map(r => {
        const g = r.raw;
        const sub = [`${g.distance} ${g.distanceUnit || 'yd'}`, `${r.shots} shots`];
        if (g.ammo) sub.push(esc(shortLoadName(g.ammo)));
        if (!g.sessionId) sub.push('<span class="dim">no session</span>');
        const tags = (g.tags || []).length
          ? `<div class="group-row-tags">${g.tags.map(t =>
              `<span class="tag-pill">${esc(t)}</span>`).join('')}</div>`
          : '';
        return `
          <div class="group-row tappable" onclick="openViewGroup('${gun.id}','${g.id}')"
               role="button" tabindex="0" title="View this group">
            <div class="group-row-info">
              <div class="group-row-main">${r.moa != null ? `${gFmt(r.moa)} MOA` : '—'}${
                r.moa != null && r.moa === best && measured.length > 1
                  ? ' <span class="dim">· best</span>' : ''}${
                hasPhoto(g) ? ' 📷' : ''}</div>
              <div class="group-row-sub">${sub.join(' · ')}</div>
              ${tags}
            </div>
            <div class="group-row-figure">
              <div class="group-row-size">${r.inches != null ? `${gFmt(r.inches)}"` : '—'}</div>
            </div>
          </div>`;
      }).join('')
    : '<div class="empty-state" style="padding:16px;">No groups on this day.</div>';

  document.getElementById('day-buttons').innerHTML = `
    ${session ? `<button class="btn btn-secondary" onclick="openSessionFromDay('${session.id}')">
       Open the full session</button>` : ''}
    <button class="btn btn-primary" onclick="closeModal('modal-day')">Close</button>`;
}

// Hands off to the session view, closing this one first so the two are never stacked — the
// same rule Details follows when it opens Cleaning or Zero.
function openSessionFromDay(sessionId) {
  closeModal('modal-day');
  openViewSession(sessionId);
}

function pickSessionForDay(groupsOnDay) {
  const tally = {};
  groupsOnDay.forEach(g => { if (g.raw && g.raw.sessionId) tally[g.raw.sessionId] = (tally[g.raw.sessionId] || 0) + 1; });
  const best = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

// A bare "2026-08-14" parses as UTC midnight and renders as the 13th west of Greenwich.
function dateMs(d) { return new Date(d + 'T12:00').getTime(); }
function trendDayLabel(d) {
  return new Date(d + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function trendMonthLabel(ms, prev) {
  const d = new Date(ms);
  const m = d.toLocaleDateString('en-US', { month: 'short' });
  // "Jul 26" reads as the 26th of July, so the year is only ever marked when it turns.
  return (!prev || new Date(prev).getFullYear() !== d.getFullYear())
    ? `${m} ’${String(d.getFullYear()).slice(2)}` : m;
}

function wireTrendScroll(sc, assumedW) {
  if (!sc) return;
  // First paint has nothing to measure. Once the element exists at its real width, draw again
  // at the right scale — guessing it made the readout disagree with the plot.
  if (sc.clientWidth > 40 && Math.abs(sc.clientWidth - assumedW) > 2) {
    requestAnimationFrame(renderGroupsStats);
    return;
  }

  sc.scrollLeft = Math.min(trendScrollLeft, sc.scrollWidth);
  updateTrendReadout(sc);
  sc.addEventListener('scroll', () => {
    trendScrollLeft = sc.scrollLeft;
    updateTrendReadout(sc);
  }, { passive: true });

  // Dragging anywhere on the plot pans it. touch-action: pan-x already gives touch the
  // horizontal gesture while vertical falls through to the page; this covers mouse and
  // trackpad, which have no obvious way to scroll a narrow strip sideways.
  let downX = 0, downLeft = 0, dragging = false, moved = 0;
  sc.addEventListener('pointerdown', e => {
    if (e.button != null && e.button !== 0) return;
    dragging = true; moved = 0;
    downX = e.clientX; downLeft = sc.scrollLeft;
    sc.classList.add('dragging');
    sc.setPointerCapture(e.pointerId);
  });
  sc.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - downX;
    moved = Math.max(moved, Math.abs(dx));
    sc.scrollLeft = downLeft - dx;
  });
  const release = e => {
    if (!dragging) return;
    dragging = false;
    sc.classList.remove('dragging');
    if (e.pointerId != null && sc.hasPointerCapture(e.pointerId)) sc.releasePointerCapture(e.pointerId);
    // A pan that barely moved was a tap. Anything more and opening a session would be a
    // surprise at the end of a drag.
    if (moved <= 5) trendTapAt(sc, e.clientX, e.clientY);
  };
  sc.addEventListener('pointerup', release);
  sc.addEventListener('pointercancel', release);
  sc.addEventListener('wheel', e => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    sc.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
}

// Opens the session behind the nearest range day, if the tap landed near one. Generous about
// what counts as near: the points are small targets and the answer is unambiguous.
function trendTapAt(sc, clientX, clientY) {
  const svg = sc.querySelector('svg');
  if (!svg) return;
  const box = svg.getBoundingClientRect();
  const scale = box.width / Number(svg.getAttribute('width'));
  const px = (clientX - box.left) / scale;
  const py = (clientY - box.top) / scale;
  let best = null, bestD = 26;
  svg.querySelectorAll('.trend-point').forEach(c => {
    const d = Math.hypot(Number(c.getAttribute('cx')) - px, Number(c.getAttribute('cy')) - py);
    if (d < bestD) { bestD = d; best = c; }
  });
  // Opens the day, not the session. Tapping a point asks "what did I shoot that day", and a
  // session answers a wider question — every firearm, every round — while omitting any group
  // marked without one. The day view can still hand off to the session.
  const date = best && best.dataset.date;
  const gunId = document.getElementById('stats-firearm').value;
  if (date && gunId) openGroupDay(gunId, date);
}

function updateTrendReadout(sc) {
  const out = document.getElementById('trend-readout');
  if (!out || !sc) return;
  // Read the scale the plot was drawn at rather than deriving it again; deriving it
  // separately is how a readout comes to disagree with its own chart.
  const pxPerDay = Number(sc.dataset.pxperday);
  const pad = Number(sc.dataset.pad);
  const t0 = Number(sc.dataset.t0);
  const svg = sc.querySelector('svg');
  const drawnW = svg ? Number(svg.getAttribute('width')) : 0;
  const shownW = svg ? svg.getBoundingClientRect().width : 0;
  const scale = shownW > 0 && drawnW > 0 ? shownW / drawnW : 1;
  if (!isFinite(pxPerDay) || pxPerDay <= 0) { out.textContent = ''; return; }

  const at = pxv => t0 + ((pxv - pad) / pxPerDay) * 86400000;
  const width = sc.clientWidth > 0 ? sc.clientWidth : drawnW;
  const lo = at(sc.scrollLeft / scale);
  const hi = at((sc.scrollLeft + width) / scale);
  // Day-and-month alone is a lie across a long span: a full year of history read
  // "Aug 23 – Aug 25", which looks like a two-day window rather than two different years.
  const spanDays = (hi - lo) / 86400000;
  const sameYear = new Date(lo).getFullYear() === new Date(hi).getFullYear();
  out.textContent = (spanDays > 120 || !sameYear)
    ? `${trendSpanLabel(lo)} – ${trendSpanLabel(hi)}`
    : `${trendDayLabel(isoDay(lo))} – ${trendDayLabel(isoDay(hi))}`;
}

// Month and year, for spans too wide for a day to be meaningful.
function trendSpanLabel(ms) {
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

// Local calendar day for a timestamp. toISOString would shift the date across the UTC
// boundary, which is the same trap the T12:00 parsing avoids on the way in.
function isoDay(ms) {
  const d = new Date(ms);
  if (!isFinite(d.getTime())) return today();
  return localISODate(d);
}

// Prone vs bench is the same chart as Norma vs CCI — one dot per group, a median tick, the
// spread as a whisker. Only the grouping changes, so it is one view with a control rather
// than three near-identical views.
// Validated for four series against this surface; a fifth cannot be added without failing
// color-blind separation, which is why both charts stop coloring rather than cycling.
const GROUP_SERIES = ['#ba8c01', '#1f68bc', '#cf5a93', '#007c59'];
const GROUP_ACCENT = '#c8a84b';

// One color per bucket, decided once and handed to both charts. They used to each pick their
// own: Compare colored by index after sorting on median, Point of Impact by whatever order
// the buckets happened to be built in — so the same load was gold in one chart and green in
// the other, and reading them together, which is the entire reason they share a dimension,
// silently told you the wrong thing.
//
// The order is Compare's, best median first, because that one is meaningful; the map is
// built from the full scoped set so a bucket keeps its color even in the chart that cannot
// draw it. Whether to color at all is also decided here, so the two can never disagree about
// that either.
function groupSeriesFor(groups, dim) {
  const buckets = {};
  groups.forEach(g => dim.of(g).forEach(k => (buckets[k] = buckets[k] || []).push(g)));
  const order = Object.entries(buckets)
    .map(([k, gs]) => ({ k, med: statsMedian(gs.map(x => x.mrMOA)) }))
    .sort((a, b) => a.med - b.med)
    .map(x => x.k);

  const colored = order.length >= 2 && order.length <= GROUP_SERIES.length;
  const map = new Map();
  order.forEach((k, i) => map.set(k, GROUP_SERIES[i % GROUP_SERIES.length]));
  return {
    order,
    colored,
    colorOf: k => (colored ? (map.get(k) || GROUP_ACCENT) : GROUP_ACCENT),
  };
}

const GROUP_COMPARE_DIMS = {
  ammo:     { label: 'ammo', of: g => [g.ammo] },
  // Tags are multi-valued, so a group tagged prone + bipod lands in both buckets and the
  // bucket counts deliberately don't add up to the group count.
  tag:      { label: 'tag', of: g => (g.tags.length ? g.tags : ['Untagged']), overlaps: true },
  day:      { label: 'range day', of: g => [g.date] },
  distance: { label: 'distance', of: g => [groupDistanceLabel(g.raw)] },
};

function renderGroupCompare(groups) {
  const el = document.getElementById('stats-groups-compare');
  if (!el) return;
  const key = document.getElementById('stats-groups-compare-by').value;
  const dim = GROUP_COMPARE_DIMS[key] || GROUP_COMPARE_DIMS.ammo;

  const buckets = {};
  groups.forEach(g => dim.of(g).forEach(k => (buckets[k] = buckets[k] || []).push(g)));
  const rows = Object.entries(buckets).map(([k, gs]) => ({
    key: k,
    label: key === 'day' ? fmtDate(k) : key === 'ammo' ? shortLoadName(k) : k,
    gs,
    med: statsMedian(gs.map(x => x.mrMOA)),
    lo: Math.min(...gs.map(x => x.mrMOA)),
    hi: Math.max(...gs.map(x => x.mrMOA)),
    days: new Set(gs.map(x => x.date)).size,
  })).sort((a, b) => a.med - b.med);

  if (rows.length < 2) {
    // Name the ways out rather than leaving a dead end. Only dimensions that would actually
    // split these same groups are offered, so a suggestion can never lead to another one.
    const alts = Object.entries(GROUP_COMPARE_DIMS)
      .filter(([k]) => k !== key)
      .map(([k, d]) => ({ k, label: compareDimLabel(k), n: groupBucketCount(groups, d) }))
      .filter(a => a.n >= 2);
    el.innerHTML = `<div class="stats-empty">Only one ${dim.label} in this range — nothing to
      compare against yet.${alts.length ? `
      <div class="cmp-alts">${alts.map(a =>
        `<button type="button" class="chip chip-btn" onclick="setGroupCompare('${a.k}')"
                 >${a.label} <b>${a.n}</b></button>`).join('')}</div>` : ''}</div>`;
    return;
  }

  // Plain HTML rows rather than SVG. Text inside an SVG scales with the viewBox, so on a
  // phone the labels came out smaller than body text; here they are real type at real sizes,
  // and they wrap and stay selectable.
  const series = groupSeriesFor(groups, dim);
  const all = groups.map(g => g.mrMOA);
  const xmax = Math.max(...all) * 1.08 || 1;
  const pct = v => (v / xmax) * 100;

  const rowsHtml = rows.map(r => {
    // By key, not by position — the same load has to come out the same color here as it does
    // on the point-of-impact map beneath it.
    const c = series.colorOf(r.key);
    const dots = r.gs.map(g =>
      `<span class="cmp-dot" style="left:${pct(g.mrMOA)}%;background:${c}"></span>`).join('');
    return `
      <div class="cmp-row">
        <div class="cmp-name" title="${esc(r.key)}">
          <span class="cmp-name-t">${esc(r.label)}</span>
          <span>n=${r.gs.length}${r.days === 1 && key !== 'day' ? ' · 1 day' : ''}</span>
        </div>
        <div class="cmp-track">
          <span class="cmp-span" style="left:${pct(r.lo)}%;width:${pct(r.hi - r.lo)}%;background:${c}"></span>
          ${dots}
          <span class="cmp-tick" style="left:${pct(r.med)}%;background:${c}"></span>
        </div>
        <div class="cmp-med" style="color:${c}">${gFmt(r.med)}</div>
      </div>`;
  }).join('');

  const ticks = [0, xmax / 2, xmax];
  const axis = `<div class="cmp-axis">${ticks.map(t =>
    `<span style="left:${pct(t)}%">${gFmt(t, 1)}</span>`).join('')}</div>`;

  // A bucket whose groups all come from one afternoon is not evidence about the thing you
  // grouped by — it is evidence about that afternoon.
  const confounded = key !== 'day' && rows.every(r => r.days === 1);
  const notes = [];
  if (confounded) {
    notes.push(`Every ${dim.label} here was shot on a single range day, so this compares
      afternoons as much as it compares ${dim.label}. Check "range day" — if it lands in the
      same place, that is what you are seeing.`);
  }
  if (dim.overlaps) {
    notes.push('Tags are multi-valued, so a group can appear in more than one row and the counts need not add up.');
  }

  el.innerHTML = `
    <div class="cmp-chart">${rowsHtml}${axis}</div>
    <div class="stats-note">Median mean-radius MOA, lower is better. One dot per group, the
      bar is its spread.${notes.length ? ' ' + notes.join(' ') : ''}</div>`;
}

// Where the groups landed, rather than how tight they were. Group size says what the firearm
// can do; this says whether it is pointed where you think, which is the question your zeros
// are really about.
function renderGroupPOI(gun, groups) {
  const el = document.getElementById('stats-groups-poi');
  if (!el) return;
  const usable = groups.filter(g => g.offXMOA != null && g.offYMOA != null);
  if (usable.length < 2) { el.innerHTML = ''; return; }

  // Colored by whatever the comparison is grouped by, so the two charts read together.
  const key = document.getElementById('stats-groups-compare-by').value;
  const dim = GROUP_COMPARE_DIMS[key] || GROUP_COMPARE_DIMS.ammo;
  const buckets = {};
  usable.forEach(g => dim.of(g).forEach(k => (buckets[k] = buckets[k] || []).push(g)));
  // Ordered and colored by the same rule Compare uses, from the same scoped set, so a load
  // that is gold up there is gold down here. Buckets with no measurable offset simply do not
  // appear; the ones that do keep the color they were assigned.
  const series = groupSeriesFor(groups, dim);
  const names = series.order.filter(k => buckets[k]);
  const ACCENT = GROUP_ACCENT;
  const colored = series.colored;

  const W = 300, H = 300, C = W / 2, PAD = 26;
  const reach = Math.max(
    ...usable.map(g => Math.hypot(g.offXMOA, g.offYMOA)), 0.5) * 1.2;
  const px = v => C + (v / reach) * (C - PAD);
  const py = v => C - (v / reach) * (C - PAD);

  // Offsets are the figures you dial, so they read in this rifle's turret unit — the same
  // rule the group detail view follows. Group size stays MOA everywhere, since that one is
  // compared across firearms and a per-rifle unit would make those numbers incomparable.
  const mil = !!gun && gun.opticUnit === 'mrad';
  const unitLabel = mil ? 'MRAD' : 'MOA';
  const disp = v => (mil ? v / MOA_PER_MRAD : v);
  const reachDisp = disp(reach);
  // The ring step has to come from how far the dots actually sit, not from a fixed size in
  // either unit: a rifle whose groups all land inside one step draws no rings at all and
  // the plot loses its scale entirely. A mil zero offset is routinely under half a mil, so
  // the floor here has to go well below 1 — hence the third argument.
  const ringStep = niceScale(reachDisp, 4, 0.01).step;
  // Enough decimals for the step chosen, so a 0.2 step never labels its rings "0" and "0".
  const ringDec = Math.max(0, -Math.floor(Math.log10(ringStep)));

  const GRIDC = '#2e2e2e', AXIS = '#555', DIM = '#555';
  let svg = '';
  // Rings out to the edge, labeled in whichever unit the offsets are being read in.
  for (let i = 1; i * ringStep <= reachDisp + 1e-9; i++) {
    const frac = (i * ringStep) / reachDisp;
    const label = (i * ringStep).toFixed(ringDec);
    svg += `<circle cx="${C}" cy="${C}" r="${(C - PAD) * frac}" fill="none"
                    stroke="${GRIDC}" stroke-width="1"/>
            <text x="${C + (C - PAD) * frac - 3}" y="${C - 4}" fill="${DIM}"
                  font-family="IBM Plex Mono" font-size="8.5" text-anchor="end">${label}</text>`;
  }
  svg += `<line x1="${PAD}" y1="${C}" x2="${W - PAD}" y2="${C}" stroke="${AXIS}" stroke-width="1"/>
          <line x1="${C}" y1="${PAD}" x2="${C}" y2="${H - PAD}" stroke="${AXIS}" stroke-width="1"/>
          <text x="${W - 4}" y="${C + 12}" fill="${DIM}" font-family="IBM Plex Mono"
                font-size="8.5" text-anchor="end">right</text>
          <text x="${C + 6}" y="${PAD - 6}" fill="${DIM}" font-family="IBM Plex Mono"
                font-size="8.5">up</text>`;

  names.forEach(n => {
    const c = series.colorOf(n);
    buckets[n].forEach(g => {
      svg += `<circle cx="${px(g.offXMOA)}" cy="${py(g.offYMOA)}" r="4" fill="${c}"
                      opacity="0.82" stroke="var(--surface)" stroke-width="1.2"/>`;
    });
    if (colored) {
      const mx = statsMedian(buckets[n].map(g => g.offXMOA));
      const my = statsMedian(buckets[n].map(g => g.offYMOA));
      svg += `<path class="poi-center" d="M${px(mx) - 7} ${py(my)}h14M${px(mx)} ${py(my) - 7}v14"
                    stroke="${c}" stroke-width="2" fill="none"/>`;
    }
  });

  // Where the rifle is actually hitting is the whole question this plot answers, so the
  // median has to be drawn whichever way the dots are colored. Per-bucket crosses only
  // exist in the 2–4 bucket case; every other case gets one cross for the lot. Without this
  // a rifle shot with a single load — the plainest reading of a zero there is — drew no
  // marker at all, while the note underneath still described a median it never showed.
  if (!colored) {
    const ox = statsMedian(usable.map(g => g.offXMOA));
    const oy = statsMedian(usable.map(g => g.offYMOA));
    svg += `<path class="poi-center" d="M${px(ox) - 7} ${py(oy)}h14M${px(ox)} ${py(oy) - 7}v14"
                  stroke="${ACCENT}" stroke-width="2.5" fill="none"/>`;
  }

  const legend = colored
    ? `<div class="poi-legend">${names.map(n =>
        `<span><i style="background:${series.colorOf(n)}"></i>${
          key === 'day' ? fmtDate(n) : esc(shortLoadName(n))}</span>`).join('')}</div>`
    : '';

  const mx = statsMedian(usable.map(g => g.offXMOA));
  const my = statsMedian(usable.map(g => g.offYMOA));
  // "On aim" stays a test in MOA so the threshold means the same thing physically whichever
  // unit the number is then printed in.
  const offText = (v, pos, neg) => Math.abs(v) < 0.05 ? ''
    : `${gFmt(Math.abs(disp(v)))} ${unitLabel} ${v > 0 ? pos : neg}`;
  const dirX = offText(mx, 'right', 'left');
  const dirY = offText(my, 'high', 'low');
  const centered = !dirX && !dirY;

  // A re-zero inside the visible range means these dots are not one measurement. Point of
  // impact before and after a zero change are different questions, and averaging across one
  // produces a number describing neither.
  const { start, end } = getStatsRangeBounds();
  const dates = usable.map(g => g.date).sort();
  const spanning = (gun.zeros || []).filter(z =>
    (!start || z.date >= start) && (!end || z.date <= end) &&
    z.date > dates[0] && z.date <= dates[dates.length - 1]);

  // Offsets are angular, so a correctly dialled rifle lands on aim at any distance and
  // mixing them is fine in principle. In practice it is the come-up that is in question: a
  // wrong one at 100 puts its groups somewhere else entirely and drags the median with them,
  // which reads as a zero problem at 50. Said plainly rather than silently averaged.
  const distances = [...new Set(usable.map(g => groupDistanceLabel(g.raw)))];
  const distanceNote = distances.length > 1
    ? `<div class="poi-caveat"><span class="i">⚠</span><span>${distances.length} distances in
         scope (${esc(distances.join(', '))}). These are one measurement only if your come-ups
         are right — a wrong one shifts its own groups here.
         <button class="linkish" onclick="scopeToSingleDistance()">Pick one distance</button>
         to read your zero.</span></div>`
    : '';

  el.innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title">Point of Impact</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="xMidYMid meet"
           style="max-width:340px;margin:0 auto;" role="img"
           aria-label="Group centers relative to point of aim">${svg}</svg>
      ${legend}
      <div class="stats-note">Each dot is one group's <b>center</b> against your aim${
        colored ? ', the cross its median per row' : ', the cross their median'}. ${
        centered
          ? `Typical center sits on aim.`
          : `Typical center is ${[dirY, dirX].filter(Boolean).join(' and ')} of aim across
             ${usable.length} groups.`}
        ${spanning.length
          ? `<br><b>A re-zero falls inside this range</b> (${spanning.map(z => fmtDate(z.date)).join(', ')}),
             so these dots are not one measurement — anchor the range to a zero to read them
             as one.`
          : ''}</div>
      ${distanceNote}
    </div>`;
}

// Rounds since the last deep clean against each firearm's own threshold, worst first.
// Recomputed from history like everything else, never stored.
function renderUpkeepStats() {
  const el = document.getElementById('stats-upkeep-cleaning');
  if (!el) return;
  const scoped = scopedGunIdsFromFilters();
  const rows = (data.firearms || []).filter(g => !scoped || scoped.has(g.id)).map(gun => {
    const since = computeRoundsSinceClean(gun);
    const thr = gun.cleanThreshold || 0;
    return { gun, since, thr, pct: thr ? since / thr : 0 };
  }).sort((a, b) => b.pct - a.pct);

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state" style="padding:16px;">${
      (data.firearms || []).length ? 'No firearms match the current filter.' : 'No firearms yet.'
    }</div>`;
    return;
  }
  // Reuses the breakdown-row pattern from Rounds Fired and Ammo Spend rather than inventing
  // a third bar style.
  const rowsHtml = rows.map(r => {
    // Status color is legitimate here — this is a state, not a series — and it is always
    // paired with the number, so it never depends on color alone.
    const state = r.pct >= 1 ? 'danger' : r.pct >= 0.8 ? 'warn' : 'ok';
    const label = r.pct >= 1 ? 'past due' : r.pct >= 0.8 ? 'due soon' : 'ok';
    const lastDeep = lastDeepCleanDate(r.gun);
    return `
      <div class="breakdown-row">
        <div class="breakdown-top">
          <span class="breakdown-name">${esc(r.gun.name)}</span>
          <span class="breakdown-val" style="color:var(--${state})">${r.since}${r.thr ? ` / ${r.thr}` : ''} rds</span>
        </div>
        <div class="breakdown-bar-track">
          <div class="breakdown-bar-fill" style="width:${Math.min(100, r.pct * 100)}%;background:var(--${state});"></div>
        </div>
        <div class="breakdown-pct">${label}${lastDeep ? ` · last deep clean ${fmtDate(lastDeep)}` : ' · never deep cleaned'}</div>
      </div>`;
  }).join('');
  el.innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title">Rounds Since Deep Clean</div>
      ${rowsHtml}
    </div>`;
}

function renderRoundsFiredStats() {
  const { start, end } = getStatsRangeBounds();
  const locId = document.getElementById('stats-location').value;
  const gunId = document.getElementById('stats-firearm').value;
  const caliberValue = document.getElementById('stats-caliber').value; // merged-group value, tokens joined by '||'

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
      const parts = mixedGuns.map(g => `${esc(g.name)} (${esc(gunCaliberLabel(g))})`);
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
          <div class="breakdown-top"><span class="breakdown-name">${esc(x.gun.name)}</span><span class="breakdown-val">${x.r.toLocaleString()} rds</span></div>
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
  const { start, end } = getStatsRangeBounds();
  const locId = document.getElementById('stats-location').value;

  // A trip counts when an in-scope firearm was shot on it, and its round total is scoped to
  // those firearms — otherwise "avg rounds per trip" would divide the whole trip's rounds by
  // trips selected for one rifle.
  const scoped = scopedGunIdsFromFilters();
  const sessions = data.sessions.filter(s => {
    if (start && s.date < start) return false;
    if (end && s.date > end) return false;
    if (locId && s.locationId !== locId) return false;
    if (scoped && ![...Object.keys(s.rounds || {})].some(id => scoped.has(id))) return false;
    return true;
  });

  const roundsIn = s => scoped
    ? Object.entries(s.rounds || {}).reduce((sum, [id, n]) => sum + (scoped.has(id) ? n : 0), 0)
    : (s.totalRounds || 0);

  const totalTrips = sessions.length;
  const totalRounds = sessions.reduce((sum, s) => sum + roundsIn(s), 0);
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
  const { start, end } = getStatsRangeBounds();
  // Purchases are logged per caliber and never per firearm, so a firearm filter resolves to
  // the calibers that firearm uses. That is a weaker claim than "what this firearm cost" and
  // the note under the figures says so rather than letting the number imply otherwise.
  let tokens = selectedCaliberTokens();
  const gunId = document.getElementById('stats-firearm').value;
  const gun = gunId ? data.firearms.find(g => g.id === gunId) : null;
  if (gun) {
    const gunTokens = new Set(gunCalibers(gun).map(c => c.trim()));
    tokens = tokens ? new Set([...tokens].filter(t => gunTokens.has(t))) : gunTokens;
  }

  const purchases = (data.ammo || []).filter(a => {
    if (start && a.date < start) return false;
    if (end && a.date > end) return false;
    if (tokens && !tokens.has((a.caliber || '').trim())) return false;
    return true;
  });

  const scopeNote = document.getElementById('stats-as-scope-note');
  if (scopeNote) {
    scopeNote.innerHTML = gun
      ? `<div class="caliber-disclaimer"><span>&#9432;</span><div>Showing
           <strong>${esc([...tokens].join(' / ')) || '—'}</strong> — the calibers ${esc(gun.name)} uses.
           Purchases aren't tied to a firearm, so this covers any other firearm chambered the
           same way. It is what you spent on ammo this one <em>can</em> use, not what it
           consumed.</div></div>`
      : '';
  }

  const totalSpend = purchases.reduce((sum, a) => sum + (a.totalPrice || 0), 0);
  const totalRoundsBought = purchases.reduce((sum, a) => sum + (a.quantity || 0), 0);

  // Totals count every purchase — you spent the money either way. The per-round figure does
  // not: a 20-round box of defensive ammo at five times the price describes nothing about
  // what practice costs, and averaging it in makes the number useless for planning.
  const rangeOnly = purchases.filter(a => a.rangeAmmo !== false);
  const excluded = purchases.length - rangeOnly.length;
  const rangeSpend = rangeOnly.reduce((sum, a) => sum + (a.totalPrice || 0), 0);
  const rangeRounds = rangeOnly.reduce((sum, a) => sum + (a.quantity || 0), 0);
  const avgCPR = rangeRounds > 0 ? (rangeSpend / rangeRounds)
    : (totalRoundsBought > 0 ? totalSpend / totalRoundsBought : 0);

  document.getElementById('stats-as-stats').innerHTML = `
    <div class="stats-stat-grid">
      <div class="stats-stat-box"><div class="stats-stat-num">$${totalSpend.toFixed(2)}</div><div class="stats-stat-label">Total Spend</div></div>
      <div class="stats-stat-box"><div class="stats-stat-num">${totalRoundsBought.toLocaleString()}</div><div class="stats-stat-label">Rounds Bought</div></div>
      <div class="stats-stat-box"><div class="stats-stat-num">$${avgCPR.toFixed(3)}</div><div class="stats-stat-label">Avg CPR${
        excluded ? ' · range' : ''}</div></div>
    </div>
    ${excluded ? `<div class="stats-note">Per-round price leaves out ${excluded}
      non-range purchase${excluded === 1 ? '' : 's'} — carry, defensive or match ammo you
      don't shoot for practice. The spend and round totals still include ${
      excluded === 1 ? 'it' : 'them'}.</div>` : ''}
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
  // A breakdown of a single item is redundant. A merged group with two tokens (.223 / 5.56)
  // still has something to break down, so only collapse when the scope is truly one caliber.
  if (tokens && tokens.size <= 1) {
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
          <div class="breakdown-top"><span class="breakdown-name">${esc(x.cal)}</span><span class="breakdown-val">$${x.spend.toFixed(2)}</span></div>
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
          <div class="breakdown-top"><span class="breakdown-name">${esc(x.cal)}</span><span class="breakdown-val" style="color:#7a92a3;">${x.rounds.toLocaleString()} rds</span></div>
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

  renderSellerSpend(purchases, tokens, rangeOnly);
  renderCostToShoot();
  renderCostPerTrip();
  renderBurnRate();
}

// Spend by store. Deliberately no blended price-per-round per store while several calibers
// are in scope: a shop that only ever sold you 5.56 would look expensive next to one that
// sold you bulk .22, and the comparison would be between products, not prices. Filter to a
// single caliber and the per-round figures become comparable, so they appear then.
function renderSellerSpend(purchases, tokens, rangeOnly) {
  const el = document.getElementById('stats-as-seller-breakdown');
  if (!el) return;

  const per = {};
  purchases.forEach(a => {
    const seller = (data.sellers || []).find(x => x.id === a.sellerId);
    const key = seller ? seller.name : '(no store recorded)';
    if (!per[key]) per[key] = { spend: 0, rounds: 0, buys: 0, cals: new Set() };
    per[key].spend += (a.totalPrice || 0);
    per[key].rounds += (a.quantity || 0);
    per[key].buys++;
    if (a.caliber) per[key].cals.add(a.caliber);
  });

  // Price per store follows the same rule as the headline: spend counts everything, the
  // per-round figure counts range ammo only, or one defensive box makes a shop look dear.
  const rangeSet = new Set((rangeOnly || purchases).map(a => a.id));
  const perRange = {};
  purchases.filter(a => rangeSet.has(a.id)).forEach(a => {
    const seller = (data.sellers || []).find(x => x.id === a.sellerId);
    const key = seller ? seller.name : '(no store recorded)';
    if (!perRange[key]) perRange[key] = { spend: 0, rounds: 0 };
    perRange[key].spend += (a.totalPrice || 0);
    perRange[key].rounds += (a.quantity || 0);
  });
  const rows = Object.entries(per)
    .map(([name, v]) => ({ name, ...v,
      cpr: perRange[name] && perRange[name].rounds
        ? perRange[name].spend / perRange[name].rounds : null }))
    .sort((a, b) => b.spend - a.spend);
  if (!rows.length) { el.innerHTML = ''; return; }

  const total = rows.reduce((sum, r) => sum + r.spend, 0);
  const max = rows[0].spend || 1;
  // One caliber in scope means every store is being compared on the same product.
  const comparable = !!tokens && tokens.size <= 1;

  const html = rows.map(r => {
    const pct = total > 0 ? Math.round((r.spend / total) * 100) : 0;
    const sub = comparable && r.cpr != null
      ? `${pct}% of spend · $${r.cpr.toFixed(3)}/rd · ${r.rounds.toLocaleString()} rds`
      : `${pct}% of spend · ${r.buys} purchase${r.buys === 1 ? '' : 's'} · ${esc([...r.cals].join(', ')) || '—'}`;
    return `
      <div class="breakdown-row">
        <div class="breakdown-top">
          <span class="breakdown-name">${esc(r.name)}</span>
          <span class="breakdown-val">$${r.spend.toFixed(2)}</span>
        </div>
        <div class="breakdown-bar-track">
          <div class="breakdown-bar-fill" style="width:${Math.round((r.spend / max) * 100)}%"></div>
        </div>
        <div class="breakdown-pct">${sub}</div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="stats-chart-card">
      <div class="stats-chart-title">Spend by Store</div>
      ${html}
      ${comparable ? '' : `<div class="stats-note">Pick a single caliber to compare
        price per round between stores — across calibers it would compare products, not prices.</div>`}
    </div>`;
}

// ── GROUP ANALYSIS ────────────────────────────────────────────────
// Marked points are stored normalized by image WIDTH on both axes, so aspect ratio is
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
    // Undo reverses the last thing done at the impacts step, add or remove alike.
    actions: [],
    // A target usually carries several groups. Scale is marked once for the photo, then
    // aim and impacts repeat per group. `saved` holds the ones already written, so they
    // can be drawn dimmed and listed while the next one is marked.
    saved: [],
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
  const per = gDist(g.calPts[0], g.calPts[1]) / calW;   // normalized units per inch
  if (!isFinite(per) || per <= 0) return null;
  return g.impacts.map(p => ({ x: (p.x - g.poa.x) / per, y: -(p.y - g.poa.y) / per }));
}

// Normalized units per inch, for drawing impact marks at true bullet size.
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
// Points live in normalized units (x/imgW, y/imgW); these map to and from screen pixels.
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
// Which impact the crosshair is sitting on, if any. Measured in screen pixels rather than
// image units on purpose: the target stays a constant size under your thumb, so it is
// forgiving at 1x and gets precise as you zoom in — exactly when you need to separate two
// holes that nearly touch.
const IMPACT_GRAB_PX = 24;

// Panning redraws the canvas but not the modal chrome, so the prompt would go stale as the
// crosshair slid over a hole. Rewritten only when the targeted impact actually changes —
// touching the DOM on every pointermove would be wasteful and would fight text selection.
let gLastTargeted = -2;

function gSyncImpactPrompt(force) {
  if (!G || !G.img) { gLastTargeted = -2; return; }
  const now = gImpactUnderCrosshair();
  if (!force && now === gLastTargeted) return;
  gLastTargeted = now;
  const el = document.getElementById('group-prompt');
  if (el && G.step < GROUP_PROMPTS.length && !G.readOnly) el.innerHTML = GROUP_PROMPTS[G.step]();
}

function gImpactUnderCrosshair() {
  if (!G || !G.img || G.step !== 2 || !G.impacts.length) return -1;
  const cv = gCanvas();
  const cx = cv.clientWidth / 2, cy = cv.clientHeight / 2;
  let best = -1, bestDist = IMPACT_GRAB_PX;
  G.impacts.forEach((ip, i) => {
    const p = gNormToScreen(ip);
    const d = Math.hypot(p.x - cx, p.y - cy);
    if (d <= bestDist) { bestDist = d; best = i; }
  });
  return best;
}

// Removing is deliberately not the primary button. Marking a tight group puts the crosshair
// near an existing hole constantly, and a primary that flips to Remove would fight you every
// time you tried to add a point beside one.
function groupRemoveImpact(i) {
  if (!G || G.step !== 2) return;
  const idx = i == null ? gImpactUnderCrosshair() : i;
  if (idx < 0 || idx >= G.impacts.length) return;
  const [p] = G.impacts.splice(idx, 1);
  (G.actions = G.actions || []).push({ t: 'rm', i: idx, p });
  gRefresh();
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

  // Groups already finished on this photo, drawn faint. Without them there's no way to
  // tell which clusters you've covered on a target carrying four of them.
  if (G.saved && G.saved.length) {
    const gun = data.firearms.find(x => x.id === G.gunId);
    const done = (gun ? gun.groups || [] : []).filter(x => G.saved.includes(x.id) && x.id !== G.editId);
    ctx.save();
    ctx.globalAlpha = 0.34;
    done.forEach((rec, gi) => {
      (rec.impacts || []).forEach(ip => {
        const p = gNormToScreen(ip);
        halo(() => { ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.stroke(); },
             gVar('--mark-impact'), 1.5);
      });
      if (rec.poa) {
        const p = gNormToScreen(rec.poa);
        halo(() => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
          ctx.stroke();
        }, gVar('--mark-poa'), 1.5);
        ctx.font = '600 10px ' + getComputedStyle(document.body).getPropertyValue('--font-mono');
        ctx.fillStyle = gVar('--mark-impact');
        ctx.fillText(String(gi + 1), p.x + 12, p.y - 10);
      }
    });
    ctx.restore();
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
  const targeted = gImpactUnderCrosshair();
  G.impacts.forEach((ip, i) => {
    const p = gNormToScreen(ip);
    const r = (per && bullet > 0)
      ? Math.max(bullet * per * G.imgW * G.view.scale / 2, 4) : 9;
    // The one the crosshair is on gets a second ring, so you can see which would be removed
    // before you commit to removing it.
    if (i === targeted) {
      halo(() => { ctx.beginPath(); ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2); ctx.stroke(); },
           gVar('--danger'), 2);
    }
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
  gSyncImpactPrompt();
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
      field.addEventListener('input', () => {
        if (!G) return;
        gSyncSharedToSaved();
        gRefresh();
      });
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
  () => {
    const on = gImpactUnderCrosshair();
    if (on >= 0) {
      return `Crosshair is on <b>impact ${on + 1}</b> of ${G.impacts.length}.
        <button type="button" class="link-danger" onclick="groupRemoveImpact()">Remove it</button>
        — or Set point to add another beside it.`;
    }
    return `Mark the <b>center of each hole</b> — ${G.impacts.length} so far. The ring is drawn
      at true bullet size, so it should sit on the hole like a lid.${
      G.impacts.length ? ' Move the crosshair over one to remove it.' : ''}`;
  },
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
  gLastTargeted = G.img ? gImpactUnderCrosshair() : -2;
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

  // Once a group has been written, Save has nothing left to do — the useful actions are
  // marking the next group on the same photo, or closing.
  const finished = G.saved.length > 0 && G.step === 3 && !G.readOnly;
  document.getElementById('group-another').style.display = finished && G.img ? '' : 'none';
  document.getElementById('group-save').style.display =
    (G.readOnly || finished) ? 'none' : '';
  document.getElementById('group-cancel').textContent =
    G.readOnly ? 'Close' : finished ? 'Done' : 'Cancel';

  gRenderMarked();

  gDrawCanvas();
  gRenderResults();
}

// Starts the next group on the same photo: the scale, the photo and every shared field
// stay put, only the aim point and impacts reset. This is the whole point of the feature —
// four groups on one target shouldn't mean four passes at the same setup.
// Shared fields describe the target, not one group on it. If the distance or ammo is
// corrected after some groups are already written, those groups have to follow — four
// groups off one photo disagreeing about the distance they were shot at is nonsense.
function gSyncSharedToSaved() {
  if (!G || !G.saved.length) return;
  const gun = data.firearms.find(x => x.id === G.gunId);
  if (!gun) return;
  const shared = {
    date: document.getElementById('group-date').value,
    sessionId: document.getElementById('group-session').value || null,
    distance: parseFloat(document.getElementById('group-distance').value),
    distanceUnit: document.getElementById('group-distance-unit').value,
    ammo: getSelectedAmmo('group-ammo-select', 'group-ammo-custom'),
    tags: [...groupModalTags],
    bulletDia: parseFloat(document.getElementById('group-bullet').value) || null,
    calMode: document.getElementById('group-cal-mode').value,
    calInches: parseFloat(document.getElementById('group-cal-w').value),
    calInchesH: parseFloat(document.getElementById('group-cal-h').value) || null,
    calPts: G.calPts.map(p => ({ x: p.x, y: p.y })),
  };
  if (!(shared.distance > 0) || !(shared.calInches > 0)) return;
  let touched = false;
  (gun.groups || []).forEach(rec => {
    if (G.saved.includes(rec.id)) { Object.assign(rec, shared); touched = true; }
  });
  if (touched) { save(data); renderGunHistory(G.gunId); }
}

function groupMarkAnother() {
  if (!G) return;
  G.poa = null;
  G.impacts = [];
  G.editId = null;
  G.step = 1;
  gRefresh();
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
    (G.actions = G.actions || []).push({ t: 'add' });
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
    // Undo the last thing done, which may have been a removal. Popping the newest impact
    // regardless would silently delete a good point after you removed a bad one.
    const last = (G.actions || []).pop();
    if (last && last.t === 'rm') {
      G.impacts.splice(Math.min(last.i, G.impacts.length), 0, last.p);
    } else if (G.impacts.length) {
      G.impacts.pop();
    } else if (G.poa) { G.poa = null; G.step = 1; }
  }
  gRefresh();
}

function groupNextStep() {
  // Done on the impacts step writes the group straight away rather than waiting for a
  // final Save, so an interruption at the bench can't cost you what's already marked.
  if (G.step === 2) { groupFinishCurrent(); return; }
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
      const label = `${fmtDate(s.date)}${loc ? ' · ' + esc(loc.name) : ''}`;
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

// The set of groups marked on this photo, so you can watch it build and spot a cluster
// you've missed. Each is already saved by the time it appears here.
function gRenderMarked() {
  const box = document.getElementById('group-marked');
  if (!G || !G.saved.length) { box.innerHTML = ''; return; }

  const gun = data.firearms.find(x => x.id === G.gunId);
  const rows = G.saved.map((id, i) => {
    const rec = (gun ? gun.groups || [] : []).find(x => x.id === id);
    if (!rec) return '';
    const size = groupSizeInches(rec);
    const moa = size != null ? toMOA(size, groupDistanceInches(rec)) : null;
    const current = rec.id === G.editId && G.step < 3;
    return `
      <div class="marked-row${current ? ' current' : ''}">
        <span class="marked-n">${i + 1}</span>
        <span class="marked-meta">${(rec.impacts || []).length} shots${current ? ' — marking' : ''}</span>
        <span class="marked-size">${moa != null ? gFmt(moa) + ' MOA' : '—'}</span>
      </div>`;
  }).join('');

  box.innerHTML = `
    <div class="marked">
      <div class="marked-head">
        <span>Groups on this photo</span>
        <span>${G.saved.length} saved</span>
      </div>
      ${rows}
    </div>`;
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
  // Offsets are the figures you dial from, so they carry both angular units — a MOA
  // turret and a mil turret can each read what they need without the app having to know
  // which scope is on which rifle. Group size stays MOA-led; only corrections need this.
  // Offsets lead with whatever unit this rifle's turret uses, falling back to MOA when
  // it's unset. Safe to vary per firearm because offsets aren't compared between rifles —
  // unlike group size, which stays MOA precisely so it can be.
  const gun = data.firearms.find(x => x.id === G.gunId);
  const opticUnit = gun && gun.opticUnit === 'mrad' ? 'mrad' : 'moa';
  const offsetPrimary = v => {
    const moa = toMOA(v, dIn), mrad = toMRAD(v, dIn);
    if (moa == null) return `${gFmt(v)}<span class="group-unit"> in</span>`;
    return opticUnit === 'mrad'
      ? `${gFmt(mrad)}<span class="group-unit"> MRAD</span>`
      : `${gFmt(moa)}<span class="group-unit"> MOA</span>`;
  };
  const offsetSub = v => {
    const moa = toMOA(v, dIn), mrad = toMRAD(v, dIn);
    if (moa == null) return '';
    return opticUnit === 'mrad'
      ? `${gFmt(v)} in · ${gFmt(moa)} MOA`
      : `${gFmt(v)} in · ${gFmt(mrad)} MRAD`;
  };
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
        <div class="group-offset-val">${offsetPrimary(Math.abs(m.cy))}</div>
        <div class="group-offset-dir">${dir(m.cy, 'high', 'low')}</div>
        <div class="group-offset-sub">${offsetSub(Math.abs(m.cy))}</div>
      </div>
      <div class="group-offset">
        <div class="group-offset-axis">Windage</div>
        <div class="group-offset-val">${offsetPrimary(Math.abs(m.cx))}</div>
        <div class="group-offset-dir">${dir(m.cx, 'right', 'left')}</div>
        <div class="group-offset-sub">${offsetSub(Math.abs(m.cx))}</div>
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
  hidePhotoMissing();
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
    // Loading a saved group starts a fresh undo history — there is nothing here to undo
    // back past, and reversing into a previous group's edits would be nonsense.
    G.actions = [];
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
    else showPhotoMissing(existing.photoId);
  }
}

// The marks are stored normalized against the image, so putting the same target photo back
// lines them up again exactly. That is the whole reason this is offered rather than just
// reported: the measurements were never lost, only the ability to see them on the target.
function showPhotoMissing(photoId) {
  const el = document.getElementById('group-photo-missing');
  if (!el) return;
  const sharing = (data.firearms || []).reduce((n, gun) =>
    n + (gun.groups || []).filter(g => g.photoId === photoId).length, 0);
  el.style.display = '';
  el.innerHTML = `
    <div class="photo-missing">
      <div class="photo-missing-head">⚠ Saved photo is no longer available</div>
      <div class="photo-missing-text">Every measurement still stands — only re-marking needs
        the image. ${sharing > 1
          ? `<b>${sharing} groups on this target share it</b>, so restoring it repairs them all.`
          : 'Restore it and the marks line back up, as long as it is the same photo.'}</div>
      <label for="group-restore-file" class="btn-photo">Restore photo${
        sharing > 1 ? ` for all ${sharing}` : ''}</label>
    </div>`;
}

function hidePhotoMissing() {
  const el = document.getElementById('group-photo-missing');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

// Deliberately not handleGroupFile: that one reads EXIF and rewrites the date, which would
// overwrite the date of a group that was logged correctly. A restore replaces the pixels and
// nothing else, and must not reset the marks it exists to make visible again.
async function handleGroupRestoreFile(input) {
  const file = input.files && input.files[0];
  input.value = '';
  if (!file || !G) return;
  const keep = document.getElementById('group-keep-photo');
  if (keep) keep.checked = true;   // or the save path would drop it straight back out
  await gLoadImage(file, false);
  hidePhotoMissing();
  document.getElementById('group-date-note').textContent =
    'Photo restored. Check the marks still sit where they should before saving.';
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
  G.photoWritten = false;
  if (resetMarks) { G.calPts = []; G.poa = null; G.impacts = []; G.actions = []; G.step = 0; }

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

// Validates and writes the current marking state. Returns the record, or undefined
// when something's missing — callers decide whether to close.
async function groupPersist() {
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

  // Groups after the first on the same target reuse the photo already stored for it —
  // G.photoId carries it across. Without this each group would store its own copy of the
  // same image, so a four-group target would hold four identical blobs.
  let photoId = existing ? (existing.photoId || null) : (G.photoId || null);
  let droppedPhotoId = null;
  if (keepPhoto && G.photoBlob && G.img) {
    photoId = photoId || uid();
    // Write once per loaded image; gLoadImage clears this when a new photo is chosen,
    // so editing a group and replacing its photo still overwrites properly.
    if (!G.photoWritten) {
      await putPhoto(photoId, await gDownscale(G.img));
      G.photoWritten = true;
    }
  } else if (!keepPhoto && photoId) {
    // Drop this group's claim on the blob, but only delete the blob itself once nothing
    // else points at it. Several groups marked on one target share a single photoId, so
    // deleting outright blinded every sibling — they kept their measurements but lost the
    // ability to re-mark, and still showed a camera icon for a photo that was gone. The
    // reference count has to be taken *after* this group lets go, which is why the record
    // is written below before the sweep rather than after.
    droppedPhotoId = photoId;
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

  // Now that the record no longer claims it, the count is honest: delete the blob only if
  // no other group on any firearm still points at it.
  if (droppedPhotoId && !referencedPhotoIds().has(droppedPhotoId)) await deletePhoto(droppedPhotoId);
  await refreshAvailablePhotoIds();
  return record;
}

// Finishing a group writes it immediately rather than batching to the end, so being
// interrupted mid-target can't lose what's already marked. The photo is stored once on
// the first save; later groups on the same target reference the same blob.
async function groupFinishCurrent() {
  const record = await groupPersist();
  if (!record) return;
  G.photoId = record.photoId;
  G.saved.push(record.id);
  G.editId = record.id;
  G.step = 3;
  renderGunHistory(G.gunId);
  gRefresh();
}

async function saveGroup() {
  const record = await groupPersist();
  if (!record) return;
  G = null;
  closeModal('modal-group');
}

async function deleteGroup(gunId, groupId) {
  if (!confirm('Delete this group?')) return;
  const gun = data.firearms.find(g => g.id === gunId);
  if (!gun) return;
  const g = (gun.groups || []).find(x => x.id === groupId);
  const photoId = g && g.photoId;
  gun.groups = (gun.groups || []).filter(x => x.id !== groupId);
  save(data);

  // Several groups marked on one target share a single photo, so the blob can only go
  // once nothing references it any more. Deleting it outright would blind the groups
  // still pointing at it — they'd keep their measurements but lose the ability to
  // re-mark. Checking after the removal is what makes the count correct.
  if (photoId && !referencedPhotoIds().has(photoId)) await deletePhoto(photoId);
  await refreshAvailablePhotoIds();
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
  if (name === 'stats') showStatsSection(currentStatsSection);
  if (name === 'settings') renderTextSizePicker();
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

// One CSV field. Notes used to have their commas stripped, which silently rewrote what the
// user wrote and still left newlines free to break the row in half. Quoting per RFC 4180
// handles commas, quotes and newlines alike, and gives the text back unaltered.
function csvCell(v) {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Split out from exportCSV so the escaping can be tested without a download.
function buildSessionCSV() {
  const rows = [['Date','Location','Firearm','Caliber','Rounds','Notes']];
  const sorted = [...data.sessions].sort((a,b) => a.date.localeCompare(b.date));
  sorted.forEach(s => {
    const loc = data.locations.find(l => l.id === s.locationId);
    Object.entries(s.rounds || {}).forEach(([gid, r]) => {
      const gun = data.firearms.find(g => g.id === gid);
      rows.push([
        s.date,
        loc ? loc.name : '',
        gun ? gun.name : gid,
        gun ? gunCaliberLabel(gun) : '',
        r,
        s.notes || ''
      ]);
    });
  });
  return rows.map(r => r.map(csvCell).join(',')).join('\r\n');
}

function exportCSV() {
  const blob = new Blob([buildSessionCSV()], { type: 'text/csv' });
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
      if (!imported.schemaVersion || !Array.isArray(imported.firearms) || !Array.isArray(imported.sessions)) {
        alert('Invalid backup file.'); return;
      }
      // Migrations only run forward. A backup written by a newer version falls through
      // every step untouched and loads as-is, so fields this version does not understand
      // would be read with the wrong shape — and then saved back over the good data.
      if (imported.schemaVersion > SCHEMA_VERSION) {
        alert(`This backup is from a newer version of Range Log (data schema v${imported.schemaVersion}; ` +
          `this copy understands up to v${SCHEMA_VERSION}).\n\n` +
          'Update the app on this device first, then import again.');
        return;
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
      `<span class="chip">${esc(t)}${viewing ? '' : `<span class="remove-x" onclick="removeGroupTag(${i})">×</span>`}</span>`
    ).join('');
  }

  const sel = document.getElementById('group-tag-add-select');
  const known = allKnownTags().filter(t =>
    !groupModalTags.some(x => x.trim().toLowerCase() === t.trim().toLowerCase()));
  sel.innerHTML =
    '<option value="">— Add tag —</option>' +
    known.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('') +
    `<option value="${CUSTOM_OPTION}">+ New tag...</option>`;
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
  if (val === CUSTOM_OPTION) {
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
    if (e.target.value === CUSTOM_OPTION) { custom.style.display = 'block'; custom.focus(); }
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

  // Both readouts below are only as honest as this cache, so it is re-read here rather
  // than trusted from whenever it was last touched.
  await refreshAvailablePhotoIds();
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

  // Each row opens the first group on that target, which is where the restore prompt lives.
  // Any of them would do — restoring writes back under the shared id and repairs the lot.
  const missing = missingPhotoTargets();
  const missingBlock = missing.length ? `
    <div class="photo-lost">
      <div class="photo-lost-head">⚠ ${missing.length} target${missing.length > 1 ? 's' : ''}
        missing ${missing.length > 1 ? 'their photos' : 'its photo'}</div>
      <div class="photo-lost-text">Every measurement is intact — only re-marking needs the
        image. Open one to put the photo back; that repairs every group marked on it.</div>
      ${missing.map(t => `
        <button class="photo-lost-row" onclick="openLogGroup('${t.gunId}','${t.openId}')">
          <span class="photo-lost-name">${esc(t.gunName)} · ${fmtDate(t.dates[0])}${
            t.dates.length > 1 ? ` +${t.dates.length - 1} more` : ''}</span>
          <span class="photo-lost-n">${t.groups.length} group${t.groups.length > 1 ? 's' : ''}</span>
        </button>`).join('')}
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
    ${orphanBlock}
    ${missingBlock}`;
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
      await refreshAvailablePhotoIds();
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

// Reading the photo store is async, so the first paint cannot know which photos exist. Any
// list already on screen is repainted once it does — a camera icon appearing a moment late
// is better than one that is wrong.
refreshAvailablePhotoIds().then(() => {
  if (currentHistoryGunId) renderGunHistory(currentHistoryGunId);
  renderStats();
});

// ── SERVICE WORKER & UPDATE CHECK ─────────────────────────────────
const APP_VERSION = '7.6.1';

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
