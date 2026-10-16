# Volleyball Game Day

A scorekeeping + player-stats app (PWA) that fills out the paper volleyball scoresheet automatically
and gives you a print-ready PDF. Works on iPhone, iPad and laptops from a single codebase.

## Run it

```
npm install          # only needed for tests/dev tools; the app itself has no build step
npm start            # http://localhost:8080  (serves the app + optional sync API)
```

Deploy `server/server.js` anywhere that runs Node 18+ (Render, Fly, a VPS…). **Use HTTPS** — iOS only
installs/caches a PWA over HTTPS. Environment variables: `PORT`, `DATA_DIR` (where accounts + synced games
are stored), `INVITE_CODE` (require a code to create an account — recommended on a public host).
On iPhone/iPad: Safari → Share → *Add to Home Screen*.

The app works with **no server at all** (everything is stored on the device). The server only adds
sign-in and syncing between devices.

## How it is built

* `public/js/engine/engine.js` — scoring engine. The single source of truth is an append-only list of
  events. Scoreboard, serving order/rotation, libero, subs, time-outs, scoresheet marks and player stats
  are all *derived* by replaying it. Undo/redo are appended `void` events, so corrections can never put the
  views out of sync. Rule problems (4th time-out, illegal re-entry, libero serving from two spots…) are
  warnings the operator must confirm — the engine never decides rulings and never guesses a player.
* `public/js/sheet/layout.js` — recreates the three-sets-per-page scoresheet (US Letter landscape) as
  drawing ops. `render.js` turns the same ops into the PDF (pdf-lib) **and** the on-screen SVG, so the
  preview is what prints.
* `public/js/ui/*` — dashboard, new game, live scoring, scoresheet viewer, stats, reports, account.
* `public/js/tour.js` — interactive first-run tour on the real screens using a practice game.
* `server/server.js` — dependency-free sync server. Games carry a revision number; a device must hold the
  game's scorekeeper lease to save; stale saves get 409/423. Offline edits that diverge become a saved copy.
* `public/sw.js` — service worker for full offline use.

## Tests

```
npm test                         # engine + sheet unit tests
PORT=8099 npm start &            # then the browser tests (use the preinstalled Chromium):
node tests/e2e.mjs  <out-dir>    # iPhone setup -> iPad 5-set match -> PDF download
node tests/tour.mjs <out-dir>    # the beginner tour, start to finish
node tests/sync.mjs <out-dir>    # offline, second device, take-over, conflict copy
```

## Scoresheet conventions (from the legend printed on the form)

number = point while serving · boxed number = point scored off a loss of rally (written on the *next*
server's row, boxed again in the running score) · triangle = libero point · `-|` = loss of rally ·
T/Tx time-out · S/Sx substitution · P/Px/P3 penalty · R/RS replay/re-serve · circled number on the
Subs line for each substitution · time-out scores in the TIME-OUTS boxes.

If your league gives you the original blank PDF, the layout constants at the top of `layout.js` are the
only thing that needs adjusting to match it exactly.
