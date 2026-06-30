# LeWorldCup 2026 — Bracket Pool Dashboard

A self-contained static website that shows a live leaderboard, the day's games, and
automatic scoring for your World Cup 2026 knockout bracket pool. Built to publish on
Netlify with **zero hosting cost risk**: there is no backend and no serverless
function. All live data is fetched in each visitor's browser straight from ESPN's
public scoreboard, so it never touches your Netlify bandwidth or function limits.

## What it does

- **Leaderboard** — ranks all six entrants by points, with correct-pick count and
  maximum still-possible points. Ties break on the Final goals tiebreaker.
- **Games** — live matches (with minute), upcoming kickoffs, and finished results,
  each annotated with how the pool picked.
- **Auto-scoring** — reads completed knockout results from ESPN, resolves the bracket
  forward, and awards points per correct pick. Updates every 60 seconds.

## File structure

```
LeWorldCup-Dashboard/
├── index.html              Page shell
├── netlify.toml            Netlify settings (static, no build)
├── README.md               This file
└── assets/
    ├── styles.css          FIFA-blue + gold theme
    ├── config.js           ← EDIT ME: scoring, dates, manual overrides
    ├── bracket-data.js      The six entrants' picks + bracket tree (auto-generated)
    └── app.js               Fetch + scoring + rendering logic
```

## Publish to Netlify (easiest method)

1. Go to https://app.netlify.com/drop
2. Drag the entire `LeWorldCup-Dashboard` folder onto the page.
3. Netlify gives you a live URL in seconds. Share it.

To update later, drag the folder again, or connect the folder to a Git repo and
Netlify will redeploy on each push.

## Deploy with Git + Netlify (auto-deploy on every push)

The dashboard was first saved inside a synced workspace that doesn't allow
deleting files, so the initial `.git` here may carry stale lock files. On your
Mac (full permissions), reset it cleanly once:

```bash
cd ~/"Claude Projects/LeWorldCup-Dashboard"
rm -f _probe.txt          # stray empty file the sandbox couldn't remove
rm -rf .git               # clear the half-initialized repo
git init -b main
git add -A
git commit -m "LeWorldCup 2026 dashboard"
```

Create an empty repo on GitHub (no README/license), then push:

```bash
git remote add origin https://github.com/<your-username>/leworldcup-dashboard.git
git push -u origin main
```

Connect Netlify for continuous deploys:

1. app.netlify.com -> **Add new site -> Import an existing project -> GitHub**
2. Pick the repo. **Build command:** leave blank. **Publish directory:** `.`
   (already set in `netlify.toml`). Click **Deploy**.
3. Every `git push` now auto-deploys in ~30-60 seconds.

No terminal? Use **GitHub Desktop** to publish the folder, then do the Netlify
step above. Or skip Git entirely and drag the folder to app.netlify.com/drop.

## Editing things (all in `assets/config.js`)

- **Scoring** — points per round live in `scoring`. The default is an ESPN-style
  escalating scheme (`R32:10, R16:20, QF:40, SF:80, FINAL:160, THIRD:40`). Replace
  the numbers with whatever your pool uses; the leaderboard recomputes on reload.
- **Refresh rate** — `refreshSeconds` (default 60).
- **Manual override** — if ESPN is slow or a team name doesn't line up, you can force
  a result in `manualResults`, e.g. `"M73": "Canada"`. These win over ESPN.

## A note on the scoring values

ESPN's official Knockout Bracket Challenge rules page is JavaScript-rendered and its
exact 2026 point table couldn't be read automatically. The default values follow
ESPN's well-known doubling-by-round pattern. If you have their exact numbers, drop
them into `scoring` in `config.js`.

## How results map to your bracket

Each pool match (M73–M104, plus third place M103) is matched to an ESPN fixture by the
two competing teams. Team-name spelling differences (e.g. "USA" vs "United States",
"Ivory Coast", "DR Congo") are handled by an alias table in `bracket-data.js`. A pool
match is only scored once ESPN marks the corresponding fixture **final**.
