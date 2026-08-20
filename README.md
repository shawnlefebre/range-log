# Range Log
A simple, private tracker for your range sessions — built as a lightweight web app you can install on your phone like a native app, with no account, no ads, and no data ever leaving your device.

**Tracks:**
- 🔫 Firearms — type, caliber(s), round counts, and clean-interval thresholds
- 📅 Range sessions — date, location, rounds fired per firearm, notes
- 🧼 Cleaning history — quick / deep / detail-strip, with automatic round-count resets
- 🎯 Zeros — distance, ammo, optic, and notes per firearm
- 🎯 Target groups — photograph a target, mark the shots, get group size in inches, MOA and MRAD
- 📐 Dope tables — come-ups per firearm and load, entered by hand and editable, in MOA or mils
- 💵 Ammo purchases — cost per round, seller, stock status, with running averages
- 📊 Stats — rounds fired, range trips, and ammo spend over time, filterable by firearm, caliber, and location

All data is stored locally in your browser (nothing is sent to a server), and can be exported/imported as JSON for backup or moving between devices.

## Group Analysis

Open a firearm's **View Details → Groups → + Add Group** to measure a target from a photo.

1. Take or choose a photo of the target
2. Mark a **known distance** on it — one square of a 1-inch grid, say — so the app knows the scale
3. Mark your **point of aim**, then the **centre of each hole**

You get group size (extreme spread), mean radius, width and height, and how far the group sits from your point of aim — in inches, MOA and MRAD. The reticle is drawn at your bullet's true diameter as you mark, so it sits over the hole like a lid.

- **Photos taken at an angle** are handled: switch the scale method to *4 corners* and mark the corners of a known rectangle, in any order, and the distortion is corrected mathematically
- **The date** defaults to when the photo was taken, not when you logged it
- **Bullet diameter** comes from the ammo you select
- **Several groups on one target.** A target often carries four or five separate groups at the same distance with the same load. Mark the scale once, then point of aim and impacts for each group — everything else is entered once and shared. Each saves as its own group, and they share a single stored photo. Groups already marked stay visible on the photo, dimmed, so you can see which clusters you've covered
- **Groups link to a range session**, so each session shows a scorecard of what you shot
- **Tags** let you label a group however you like — prone, bench, bipod, windy — picking from tags you've used before or typing a new one. Matching ignores case, so *Prone* reuses *prone* rather than creating a second tag that would split your comparisons later
- **Keeping the photo is optional.** Marked points are always saved, so every measurement still recomputes without it — you just can't re-mark impacts. Photos are stored on the device only and are never included in a JSON export, which keeps backups small

### Reading the numbers

The app reports several measurements because they answer different questions.

**Group size (extreme spread)** is the conventional figure — the distance between the two
farthest holes, centre to centre. It's what most people quote, but it uses only two shots
and ignores the rest, so it grows with how many rounds you fired. From the same rifle, a
5-shot group runs roughly 25% larger than a 3-shot, and a 10-shot roughly 55% larger.
Comparing groups of different shot counts by this number flatters whichever had fewer
shots.

**Mean radius** is the average distance of each hole from the centre of the group. It uses
every shot and doesn't drift with sample size, which makes it the fair way to compare
groups — and the number to trust when your shot counts aren't consistent.

**Why MOA rather than inches.** A 1″ group at 50 yards and a 1″ group at 100 yards are not
the same performance; the second is twice as good. MOA is angular, so it stays comparable
across distances. One MOA subtends about 1.047″ at 100 yards. Inches are still shown, but
the headline figures are MOA for this reason.

**Elevation and windage offsets** describe where the group sat relative to your point of
aim — a zeroing question, not an accuracy one. A tight group in the wrong place and a loose
group centred on your aim are different problems, and the offsets separate them.

Set a firearm's **optic adjustment unit** (MOA or MRAD) and its offsets lead with that
unit, so they read in whatever your turret is marked in; all three units are shown either
way. Group sizes stay in MOA whatever the optic, because those are compared between
firearms and need one common unit.

**Shot count is worth standardising.** Five shots per group is the usual convention and a
reasonable balance: enough for the number to mean something, not so many that barrel heat
or fatigue creep in. Rimfire is cheap enough that ten is worth it. Shooting several groups
in a session tells you more than one large one, because the spread *between* groups is
where fliers and inconsistency show up.

**When to use 4-corner scaling.** Rotation doesn't change group size — distances between
holes are unaffected by how the camera was held — but it does skew the elevation and
windage split, since those are measured against the image's own axes. If the photo wasn't
taken square-on and you care about the offsets, mark four corners of a known rectangle and
the distortion is corrected mathematically.

### Photo storage

Photos are downscaled before storing, so each one lands around 30–100 KB — a few range trips a month works out to under 10 MB a year, against the gigabytes a browser will give an installed app.

**Settings → Target Photos** shows exactly what's stored: how many photos, their total size, and how much room the app has. If any photos are no longer attached to a group — which can happen after importing a backup — it offers to reclaim that space.

Because photos are left out of the JSON backup, moving them to another device is a separate step: **Export photos** writes a bundle you import on the new device *after* restoring the JSON backup. Importing a bundle only restores images that some group actually refers to.

## Dope Tables

Open a firearm's **View Details → Dope → + Add Table** to record the come-ups for a load.

A dope table is one ammo, one zero distance, and a list of distances with the elevation to
dial for each. Tap a card to read the whole table; the pencil opens it for editing.

**The app does not calculate ballistics.** The numbers come from whatever solver you already
trust — this stores them and, more to the point, lets you correct them once you've actually
shot the distance. Nothing here second-guesses your table, and logged group data never
adjusts it.

A few things worth knowing:

- **The unit is per table, and switching it converts the numbers.** 6.0 MOA becomes 1.75 mil,
  not 6.0 mil. A new table starts in whatever unit you set as the firearm's turret unit.
- **The distance unit is set once** at the top, so each row is just two numbers — four
  controls per row would be unusable at phone width.
- **Conditions are a note to yourself**, not a model. Dope drifts with altitude and
  temperature, and recording that these came from 900 ft at 70°F is what stops you trusting
  them somewhere they don't apply.
- **The card shows six distances**, then a count of the rest, so a long table doesn't push
  everything below it off screen.

## Screenshots
![Home](images/home.png)
![Sessions](images/sessions.png)
![Group analysis](images/groups.png)
![Ammo](images/ammo.png)
![Stats](images/stats.png)

*(These show the app's built-in demo data — [see below](#first-launch).)*

## Access via Web
https://shawnlefebre.github.io/range-log/

## First Launch

The app opens pre-loaded with a full year of sample data — firearms, sessions, cleanings, ammo purchases — so you can explore everything, including the Stats tab, before entering anything of your own. A banner on the Dashboard lets you either:

- **Clear & Start Fresh** — wipes the sample data for a blank app
- **Keep This Data** — dismisses the banner and leaves the sample entries in place, if you'd rather edit them into your real setup than start from zero

## Installing on iPhone (Home Screen App)

1. Open the hosted URL (see above or your own if [hosting your own](#hosting-your-own-copy-github-pages)) in **Safari** — not Chrome or another browser, since only Safari supports adding web apps to the home screen on iOS
2. Tap the **Share** button (square with an arrow pointing up)
3. Scroll down and tap **Add to Home Screen**
4. Confirm the name and tap **Add**
5. Launch the app from its new home screen icon going forward — it'll behave like a native app (full screen, no browser bar)

**Note on updates:** Range Log checks for new versions automatically each time you open it. When an update is available, a banner appears at the bottom — tap it to reload with the latest version. If you don't see a banner, your app already has the newest version.

**Note on data:** All your data (firearms, sessions, ammo, etc.) is stored locally in your browser/device — nothing is sent to a server. This means:
- Data does **not** sync automatically between devices (e.g. iPhone and Mac)
- Use **Settings → Export JSON** periodically to back up your data
- Use **Settings → Import JSON** to restore a backup or move data to another device
- Use **Settings → Danger Zone** to permanently delete everything and start over (requires typing DELETE to confirm — there's no undo)

## Hosting Your Own Copy (GitHub Pages)

1. **Fork this repository** (or create a new one and copy in `index.html`, `app.css`, `app.js` and `sw.js`)
2. Make sure the repo is **public** — GitHub Pages requires this on free accounts
3. In your repo, go to **Settings → Pages**
4. Under **Source**, select the **main** branch and **/ (root)** folder, then **Save**
5. Wait about a minute, then your app will be live at:
   `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`

**Important:** all four files — `index.html`, `app.css`, `app.js` and `sw.js` — must sit together in the same folder (repo root). The app has no build step, but it does need all four: `index.html` loads the other two, and `sw.js` handles updates. Deploy them together, or you can end up with new markup running against old code.

## Development & Testing

The app itself has zero runtime dependencies and no build step — nothing here affects anyone just using or hosting it. This section is for anyone modifying the code.

`index.html` is markup only; `app.css` and `app.js` hold the styles and all the application code. `app.js` is loaded as a plain script rather than an ES module, because the markup uses inline `onclick` handlers that need global scope.

A regression suite lives in `test/`, using Node's built-in test runner and `jsdom`. It covers the trickier logic: data-schema migrations, Stats filtering, weekly/monthly chart bucketing, group geometry (including the perspective correction), and demo-data generation.

```bash
npm install
npm test
```

There is also a **browser suite** covering what jsdom can't reach — canvas rendering, IndexedDB, real file inputs, pointer gestures and layout, which is where most real bugs in this app have turned up. It drives a headless Chromium against a throwaway local server:

```bash
npx playwright install chromium   # one time
npm run test:browser
```

It is deliberately kept out of `npm test` so the unit suite stays fast and CI needs no browser download.

The unit tests run automatically on every push via GitHub Actions — free and unlimited for public repos, no setup required beyond the workflow file already being in the repo.