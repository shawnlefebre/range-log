# Changelog

Range Log releases, newest first.

Patch releases are folded into the minor release that closed them — the patch stream is how a
feature gets built and tried on a phone between pushes, and the minor release is the story. The
commit for each patch is in `git log` if you want the detail.

**Schema version** is separate from the app version and only moves when the shape of stored data
changes. It's noted below wherever it did.

## Unreleased

- Drilling into a range day from the Groups trend chart now shows the groups that match
  the filters you were viewing, rather than everything shot that day. The header counts
  what is shown against the day's total, and a note says how many are hidden with a tap to
  see the whole day. Rounds logged and the session stay day-level facts and are not
  filtered.
- Cleanings record which side of the day's shooting they happened on. Logged on a day nothing
  has been shot yet, a cleaning is recorded as *before* — clean in the morning, log the session
  at the range later, and the rounds land on the right side of it. Logged after a trip, it asks
  and defaults to *after*. The choice shows up when you review a cleaning that turns out to
  share a date with a session, so a late-logged trip can be corrected. **Schema v17** — every
  existing cleaning is stamped *after*, which is what the app assumed before, so no figure moves.
- **Barrel fouling** on the range day view and on a single group: how many rounds were on the
  barrel since its last deep clean, as a span — what it carried into the day and what it carried
  out — because rounds are logged a day at a time and the groups sit somewhere inside that.
  Says when the figure is only a floor, and when nothing has been cleaned at all.
- **Cleaning on the Groups trend chart.** A deep clean draws a dashed slate rule, labeled with
  the rounds that interval ran, on a second label row so it never collides with a re-zero. On a
  day you shot, the rule sits half a day to whichever side of the shooting the cleaning
  happened on. Beneath the plot, a strip carries rounds-since-clean on the same x-axis — a step
  shape that climbs with each range day and drops at each clean — so group size and the state
  of the bore read on one vertical. A **Cleans** switch beside the zoom controls turns the whole
  layer off, since marks tell you nothing if you clean after every trip.

## 7.10 — how far you go between cleans, and when you last backed up (2026-09-20)

- **Cleaning History** in Stats → Upkeep: rounds fired between one deep clean and the next,
  charted per firearm against its own threshold, with the average, the shortest-to-longest
  spread, and how many intervals the figures rest on. Tap a point for its rounds and dates.
  Stretches with no range day in them are left out, since cleaning twice without shooting
  measures nothing.
- **Backups say where they came from.** The release and date are in the filename and inside the
  file — `range-log-backup-2026-09-20-1443-v7.9.4.json` — so two backups on one day no longer
  collide and a renamed file still knows what wrote it.
- **The Dashboard says when something isn't backed up**, tracking records and target photos
  separately because they're saved by separate buttons into separate files. Clears the moment
  you take a backup. *(schema v16)*
- The time range filter now applies on Upkeep; Cleaning Due still describes now, and says so.

## 7.9 — read your groups either way (2026-09-18)

- **Mean radius / extreme spread toggle** across both group panes — the per-firearm charts and
  the all-firearms ranking — held as one preference rather than one per screen.
- **Shots scope chips**, because extreme spread grows with round count: a firearm shot in
  3-round strings would otherwise outrank an identical one shot in 5s.
- **Ammo manufacturer is a picker** built from what you've bought, folding near-duplicate
  spellings rather than letting *Federal* and *federal* both accumulate.
- **The ammo log filters by date**, defaulting to all time, with the four figures following the
  window.
- Fixed the scale reference being checked against the wrong corners, and the trend chart
  clipping its edge labels.

## 7.8 — an app icon, and installable everywhere (2026-08-26)

- **A real app icon and web manifest.** iOS had been generating one by screenshotting the
  dashboard, and Android and desktop couldn't offer an install at all.
- Both install mechanisms are covered: iOS reads the Apple meta tags, everything else reads the
  manifest, and a browser suite asserts both survive.

## 7.7 — comparing firearms, and figures that reconcile (2026-08-25)

- **Accuracy compared across firearms**, with a 95% range derived from how much each firearm's
  own groups vary — and a refusal to rank two whose ranges overlap.
- **One color per load across both group charts.** They had been picking independently, so a
  load was gold in one and green in the other.
- **Every figure names which group size it is.** Lists lead with extreme spread, charts plot
  mean radius, and both had been printing a bare "MOA" despite differing by two to three times.
- Average cost per round counts every purchase; each chambering gets its own burn-rate window.

## 7.6 — reading a zero, and photos that survive being shared (2026-08-22)

- **Groups stats scope by ammo, distance and tag**, so a zero can be read at the distance and
  load it actually lives at.
- **Tapping a point on the group trend opens that range day.**
- **A target photo shared by several groups survives deleting one of them**, and groups whose
  photo has gone missing are reported rather than silently drawing blank.
- Point of impact draws its median for a single load too, which is most firearms in real use.

## 7.5 — the app stops losing data quietly (2026-08-22)

Five patches of correctness work. Every one was a silent failure — nothing crashed, and the app
looked fine while being wrong.

- **`today()` returned the UTC date**, so a trip logged after about 8pm west of Greenwich
  prefilled tomorrow. The guard test hadn't caught it because it computed its expectation with
  the same expression the bug lived in.
- **Nothing escaped user text before `innerHTML`.** A note reading `Grouped <MOA all day` lost
  everything after the `<`.
- **Failed saves are surfaced** rather than swallowed, imports are guarded, and CSV fields are
  quoted so a comma in a note stops rewriting the file.
- **Unreadable stored data is preserved** instead of being replaced with demo data, which had
  disguised a failure as a fresh install and then overwritten the only copy.

## 7.4 — group analysis reads in your units (2026-08-21)

- **Point of impact reads in the firearm's own turret unit**, matching the group detail view.
  Group size stays MOA, since that figure is compared between firearms.
- **Comparison dimensions show how many buckets they'd split into**, so a dead end is visible
  before you pick it.
- Point-of-impact rings are sized from the data, so a rifle grouping inside one ring step still
  gets a scale to read against.
- Sample data spans a year of groups across ten range days, two loads, two distances and a
  mid-year re-zero, so the feature demonstrates itself on a fresh install.

## 7.3 — readable at any size (2026-08-21)

- **Text size setting**, four steps, defaulting to Large. Every size in the stylesheet is a rem,
  so the whole app scales together and the hierarchy is preserved.
- **Trips are priced from the ammo you owned at the time**, so buying expensive ammo today no
  longer changes what last March cost.
- **Ammo lots record when they ran out** — and correcting a mis-tapped toggle keeps the original
  date rather than restamping it as today. *(schema v15)*
- Removing a single impact from a group, without re-marking the rest.

## 7.2 — Stats (2026-08-20)

The largest release since 7.0. Stats went from three stacked sections to four panes behind one
filter bar, and gained the group analysis the group feature had always pointed at.

- **Four sub-tabs** — Groups, Practice, Money, Upkeep — under one shared filter bar, with any
  filter that can't apply to a pane dimmed and explained rather than silently ignored.
- **Group size over time**, joining each range day's median rather than each group, because one
  afternoon can span 0.28 to 1.04 MOA with the same rifle and load. Re-zero marks are always
  drawn.
- **Compare by** ammo, tag, range day or distance in one chart, plus a **point of impact** map.
- **Money**: what shooting actually costs, per-session cost, cost per trip, spend by store, and
  burn rate per chambering.
- Carry and defensive ammo can be marked as not-range, excluded from per-round price figures.
  *(schema v14)*

## 7.1 — (2026-08-19)

- Load Demo Data from Settings, for getting the sample set back after wiping it.
- Details lists cap their most recent few behind a **Show all** count, expanding inside their own
  scroll panel rather than stretching the modal.
- Zeros open read-only on a tap, so a stray touch can't alter what a rifle is zeroed at.

## 7.0 — dope tables (2026-08-19)

- **Dope tables** per firearm: manually entered come-up tables, one per ammo, with unit
  conversion. The app never computes ballistics — the numbers come from whatever solver you
  trust. *(schema v13)*
- **Several groups marked on one target photo**, sharing its calibration.
- Offsets lead with the firearm's own optic unit.

## 6.4 — (2026-08-19)

- **Freeform tags on groups** — prone, bench, bipod, windy — so a group can be described along
  whatever dimension matters without a schema field per idea.
- Browser regression suites committed, covering what jsdom can't see: canvas, IndexedDB, file
  inputs, pointer gestures and layout.
- A photo's EXIF date re-suggests the matching session.

## 6.3 — (2026-08-18)

- Every derived group figure reads in MOA.
- Tap a group to view it read-only.
- **Photo bundle export/import**, plus fixes for photo storage leaks and a usage readout.

## 6.2 — (2026-08-17)

- **Groups link to range sessions**, and sessions gain a scorecard of what was shot.

## 6.1 — group analysis, made usable (2026-08-16)

- **Pan and zoom on the group plot**, with a Reset view to match the photo.
- Marking advances automatically after the scale and aim points, instead of waiting to be told.
- Group results lead with MOA, and a distance is required — without one the figure means
  nothing.
- Distance can be given in feet, for indoor ranges.

## 6.0 — target group analysis (2026-08-16)

- **Target group analysis**: photograph a target, mark the scale, the point of aim and each
  impact, and get group size, mean radius, width, height and point of impact back. The feature
  everything in 7.x has been built on.
- The app split into `index.html` + `app.css` + `app.js`, which is still its shape.

## 5.3 — (2026-08-14)

- Fixed the Edit Cleaning and Edit Zero modals rendering invisibly behind the Details view.

## 5.2 — (2026-08-13)

- **Per-firearm notes**, for torque specs and maintenance reminders.

## 5.1 — (2026-08-08)

- Fixed bar charts clamping tall bars to the same height, which made the largest months
  indistinguishable.

## 5.0 — stats, and a test suite (2026-08-04)

- **Stats**: rounds fired and spend over time, charted.
- **The regression suite starts here.** Everything since has been built against it.

## 4.6 — (2026-08-02)

- Rounds since the last quick clean, alongside rounds since the last deep clean.

## 4.5 — (2026-07-30)

- **Firearm type icons** — rifle, pistol, revolver, shotgun.

## 4.4 — (2026-07-15)

- Zeros record the optic and the ammo they were shot with, not just the distance.

## 4.3 — (2026-06-30)

- Ammo caliber became a dropdown rather than free text.

## 4.2 — the first version the app recorded (2026-06-30)

The earliest release the repo can name, because `APP_VERSION` did not exist before it. By this
point the app already had range sessions, firearms with round counts and cleaning levels, zeros,
reorderable firearms, ammo logging with sellers, and cost per round.

---

**Before 4.2** there is no version to attribute work to — the app did not track its own version
until 2026-06-30, and the earliest commits predate it. The features are in `git log` from
2026-04-18 onward; the version numbers are simply not recorded anywhere.
