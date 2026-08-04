# Range Log
A simple, private tracker for your range sessions — built as a lightweight web app you can install on your phone like a native app, with no account, no ads, and no data ever leaving your device.

**Tracks:**
- 🔫 Firearms — type, caliber(s), round counts, and clean-interval thresholds
- 📅 Range sessions — date, location, rounds fired per firearm, notes
- 🧼 Cleaning history — quick / deep / detail-strip, with automatic round-count resets
- 🎯 Zeros — distance, ammo, optic, and notes per firearm
- 💵 Ammo purchases — cost per round, seller, stock status, with running averages
- 📊 Stats — rounds fired, range trips, and ammo spend over time, filterable by firearm, caliber, and location

All data is stored locally in your browser (nothing is sent to a server), and can be exported/imported as JSON for backup or moving between devices.

## Screenshots
![Home](images/home.png)
![Sessions](images/sessions.png)
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

1. **Fork this repository** (or create a new one and copy in `index.html` and `sw.js`)
2. Make sure the repo is **public** — GitHub Pages requires this on free accounts
3. In your repo, go to **Settings → Pages**
4. Under **Source**, select the **main** branch and **/ (root)** folder, then **Save**
5. Wait about a minute, then your app will be live at:
   `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`

**Important:** both `index.html` and `sw.js` must sit in the same folder (repo root) for the app to auto-update correctly. If you rename or move one, update the other's references to match.

## Development & Testing

The app itself is a zero-dependency single file — nothing here affects anyone just using or hosting it. This section is for anyone modifying the code.

A regression suite lives in `test/`, using Node's built-in test runner and `jsdom`. It covers the trickier logic: data-schema migrations, Stats filtering, weekly/monthly chart bucketing, and demo-data generation.

```bash
npm install
npm test
```

Tests also run automatically on every push via GitHub Actions — free and unlimited for public repos, no setup required beyond the workflow file already being in the repo.