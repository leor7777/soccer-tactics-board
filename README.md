# Soccer Tactics Board

A tactics board for soccer coaches. Set up formations, draw plays and set pieces, play them back with a broadcast-style camera, and plan for each opponent.

**Open it:** https://leor7777.github.io/soccer-tactics-board/

It runs in any modern browser on a laptop, tablet or phone. There's nothing to install and no account to make.

## For coaches

- **Teams.** Coach more than one side? Use the team switcher at the top left. Each team keeps its own squad, game plans, opponents, set pieces and saved shapes.
- **Shapes.** 33 formations (4-3-3, 4-3-2-1, 3-4-2-1, diamonds, back fives, the WM and more) plus 62 famous sides, from Guardiola's City and Klopp's Liverpool to Sacchi's Milan and Hungary 1953. The board tells you which famous side your shape resembles ("Shades of…").
- **Plays.** Pick a tool on the left (pass, dribble, run, shot, press) and drag from a player. Passes can go along the ground, driven or lofted, and curve either way. Actions in the same step happen together; add steps below the pitch.
- **Automatic defense.** The team without the ball shifts, presses and tracks runners every step, with realistic mistakes, so there's still space to attack. Tune the block height, pressing and quality under View.
- **Set pieces.** Corners, free kicks from any spot, long throws, penalties, kick-offs and goal kicks, saved once and ready in every game plan.
- **Present.** Full-screen playback with captions, sound and a camera that follows the ball, for showing the team.
- **Plan for the opponent.** Rate your players and the opponent, then **Optimize formation** ranks every shape with a suggested lineup.

### Where your work is saved

Everything saves automatically in the browser you're using. It doesn't sync between devices or coaches. To move or share work:

- **A game plan:** Plans menu (top bar) → *Game plan file*, then *Import plan* on the other device.
- **A whole team:** team switcher → edit a team → *Back up team*, then *Import team* on the other device.
- **A picture:** Plans menu → *Board image* or *Storyboard*.

Clearing your browser's site data erases your plans, so keep a backup of anything important.

## For developers

No build step and no dependencies to install: plain ES modules with [Preact](https://preactjs.com/) + [htm](https://github.com/developit/htm) loaded from a CDN.

```bash
python3 tools/serve.py          # dev server on http://localhost:5173
python3 tools/serve.py --build  # static site in dist/
npm test                        # unit tests (Node 18+)
```

On a Mac without Node, the tests also run on the built-in JavaScript engine:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/run.js
```

Every push to `main` runs the tests and deploys to GitHub Pages (`.github/workflows/pages.yml`).

| File | What it does |
| --- | --- |
| `index.html` | Styles and page shell (the document skeleton is added by `tools/serve.py`) |
| `js/geometry.js` | Pitch dimensions, zones, curved paths, view orientation |
| `js/playback.js` | Play timeline: possession, pass timing and height, frame interpolation, sound events |
| `js/defense.js` | Automatic defensive reactions and the space map |
| `js/analysis.js` | Zone counts, matchup report, role fit, formation ranking and optimizer, "shades of" |
| `js/setpieces.js` | Set-piece templates, free kicks from any spot, long throws |
| `js/data.js`, `js/systems.js` | Formations, roles, attributes, tags, pitch themes, famous sides |
| `js/store.js` | State, teams, undo/redo, autosave, all editing actions |
| `js/pitch.js` | The SVG board, camera, effects and every pointer interaction |
| `js/audio.js` | Synthesized sound effects |
| `js/panel-*.js` | Side panels and the Teams manager |
