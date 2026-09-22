# SimStock on the desktop

An Electron shell around the same `index.html` that runs on the web. The game
is not forked or rewritten for desktop: `desktop/app/` is a copy of the web
root, and the game checks for `window.simstock` before using anything the
shell adds.

## Why Electron and not Tauri

Tauri would produce a binary a tenth the size, which is a real advantage
almost everywhere except here. It uses the operating system's webview, and on
Linux that is WebKitGTK, which is not guaranteed to be present inside Steam's
`pressure-vessel` container — so Steam Deck, where a game like this belongs,
becomes the risk. Electron ships its own Chromium, so what was tested is what
runs, on Deck and on a ten-year-old Windows install alike. A 250MB download is
nothing on Steam.

Nothing about the game depends on that choice. It is plain HTML, CSS and
JavaScript with no build step, so swapping the shell later touches only this
directory.

## Running it

```sh
cd desktop
npm install
npm start           # copies the game in, then opens it
```

```sh
npm test            # 33 tests against the real app; on a headless box: xvfb-run -a npm test
```

`npm start` runs `sync-game.js` first, which copies `index.html`, `style.css`,
`game.js`, `sim.js`, `gamepad.js`, `favicon.svg` and `fonts/` into
`desktop/app/`. That directory is generated — never edit it, edit the web root
and re-sync.

| Variable | What it does |
| --- | --- |
| `SIMSTOCK_SERVER` | The match server the Versus lobby is prefilled with, e.g. `wss://simstock-versus.fly.dev`. Set `DEFAULT_SERVER` in `main.js` for real builds. |
| `SIMSTOCK_DEVTOOLS` | Opens the developer tools on start, in a dev run only. |
| `STEAM_APP_ID` | Overrides `steam_appid.txt`. |
| `SIMSTOCK_NO_SANDBOX` | `1` makes the launcher stand the Chromium sandbox down without probing. For reproducing a Steam Deck on a machine that is not one. |

## Building

```sh
npm run pack        # an unpacked build in dist/, for checking
npm run dist:win    # Windows
npm run dist:linux  # Linux
```

The targets are all `dir` — a plain folder of files, which is what Steam wants
to upload. It does not want an installer; Steam is the installer.

You cannot build for macOS from anywhere but a Mac, and building for Windows
from Linux needs Wine, which is why `.github/workflows/release.yml` exists: one
runner per platform, kicked off by a `v*` tag or by hand from the Actions tab.
Its `server` input is the match server address to bake into the build.

That address is written into `app/build-config.json` at sync time rather than
read from the environment when the game runs, because a player double-clicking
an icon has none of the build machine's environment. `SIMSTOCK_SERVER` still
wins during a dev run, which is how the tests point at a local server.

One thing to know about the release workflow's artifacts: GitHub zips them, and
a zip does not carry the executable bit. `launch-linux.sh` and the Linux binary
itself come out of a downloaded artifact unexecutable. Build the depot from a
local `npm run dist:linux`, or `chmod +x` them after unzipping — Steam will
copy across whatever mode it is given, and a launcher without `+x` is the same
dead Play button the launcher exists to prevent.

Uploading to Steam is deliberately not automated. It needs steamcmd, partner
credentials and a second factor, and a wrong build pushed to a live branch is
not something to learn about from a workflow log.

## What the shell adds

**A real save file.** The browser build keeps progress in `localStorage`, which
Steam Cloud cannot see. Here the save is one JSON file in the app's data
directory, written to a temporary neighbour and renamed over the real one, so
a crash or a power cut halfway through a write leaves the previous save intact
rather than a half-written one.

| | Path |
| --- | --- |
| Windows | `%APPDATA%\SimStock\simstock-save.json` |
| macOS | `~/Library/Application Support/SimStock/simstock-save.json` |
| Linux | `~/.config/SimStock/simstock-save.json` |

**Steam achievements**, when Steam is there. See below.

**The match server address**, so nobody has to type one to play online.

**A window with no browser in it**: no menu bar, F11 for full screen, external
links opened in the real browser, and navigation away from the game refused.
The renderer is sandboxed with context isolation on and no Node in it, so the
only thing the page can reach is the small bridge in `preload.js`.

## Steam achievements

The game has 39 achievements already. `tools/steam-achievements.js` reads them
straight out of `game.js` and writes two files here:

- `achievements.json` — the game's own id mapped to the API name on Steam
- `steam-achievements.tsv` — a row per achievement, to work from when entering
  them in the Steamworks web UI, which has no bulk import

Regenerate both after adding an achievement:

```sh
node tools/steam-achievements.js
```

The Steamworks SDK is not redistributable and needs a partner account, so it is
an **optional** dependency. Without it every Steam call is a no-op and the game
is exactly the game — which is the point: this repository has to run for anyone
who checks it out, not only for someone with a Steam partner account.

To turn it on:

```sh
npm install steamworks.js
echo 480 > steam_appid.txt      # your own app ID; 480 is Valve's test app
npm start                       # with the Steam client running
```

`steam.js` logs what it decided on start, so a silent failure is not possible.

## Actually getting onto Steam

None of this is code, and it is most of the work.

1. **Steamworks partner account.** $100 per app, recoupable once the app earns
   $1,000. Needs bank and tax details, which take longer to clear than you
   expect — start this before you think you need to.
2. **Create the app** and get the App ID. Put it in `steam_appid.txt`.
3. **Store page**: capsule art at several sizes, screenshots, a trailer, a
   description, tags. Valve reviews it. Budget a week of back-and-forth.
4. **Depots and builds.** One depot per platform. Upload with `steamcmd` and an
   app build script pointing at `dist/win-unpacked`, `dist/linux-unpacked` and
   so on.
5. **Achievements**: enter each row of `steam-achievements.tsv` in the
   Steamworks UI, plus an icon for each — 64×64 locked and unlocked. 39
   achievements is 78 icons.
6. **Steam Cloud**: Auto-Cloud, pointed at the save directory above. Steam's
   root variables change now and then, so check the current names in the
   Steamworks docs rather than trusting this table.
7. **Review and release.** Valve checks the build runs and the store page is
   honest. There is a mandatory two-week wait between setting a release date
   and releasing.

### Steam Deck

Deck is a strong fit for this game.

**Set the Linux launch executable to `launch-linux.sh`, not to `SimStock`.**
This is the one Steamworks setting the game will not start without.

The Linux build ships a `chrome-sandbox` helper that Chromium will only trust
if root owns it and it carries the setuid bit. A Steam depot does not carry
setuid bits and Steam's `pressure-vessel` container does not add them, so on a
Deck the helper is present and untrusted, and Chromium aborts before it draws
a window — the player presses Play and nothing happens.

Most games answer this with a blanket `--no-sandbox` launch option.
`build/launch-linux.sh` does the same thing without the blanket: it asks
`sandbox.js` whether a sandbox is possible on this machine — unprivileged user
namespaces, or a correctly configured setuid helper — and hands over with the
switch only when neither is available. A Deck loses the sandbox; a normal Linux
desktop keeps it.

Verified against a real packaged build, running as an unprivileged user with
Chromium forced onto the setuid path: the binary on its own aborts with
`The SUID sandbox helper binary was found, but is not configured correctly`,
and the same build through the launcher starts. Still worth confirming on
actual Deck hardware before release — the container is reproduced here by
argument, not by being a Deck.

### Playing with a controller

`gamepad.js` in the web root, loaded by both builds. The game is already built
out of real `<button>` elements, so nothing had to be made focusable — what was
missing was a way to move the focus with a thumb. It moves focus in the
direction pushed, and turns the rest of the pad into the keys the game already
listens for, so there is one pause and one Escape rather than two of each.

| | |
| --- | --- |
| D-pad / left stick | move the focus, repeating while held |
| A | press whatever is focused |
| B | close a modal, or go back to the front page |
| LB / RB | previous / next tab |
| Start | stop and start the market, as the space bar does |

A modal takes the pad entirely: the shoulders stop changing the screen behind
it, the way the space bar already refuses to pause from inside one.

The focus ring appears the moment a pad is used and goes away when a mouse
turns up, because with a pad it is the only thing saying where you are. A bar
along the bottom says what each button does, listing only the ones that would
do something from where the player is standing — inside a modal it drops the
shoulders, because a modal ignores them, and it never offers A on the quantity
field, because A leaves that alone.

The glyphs are drawn in the game's own ink rather than in Xbox's green A and
red B. This is a game about a market, where green and red already mean a gain
and a loss, and a green A sitting above a Buy button reads as an instruction
rather than as a label.

The tests drive it with a fake pad in a real page, stepping the module a frame
at a time: the whole opening tutorial is completed with the pad alone, and a
flood fill checks that all 46 stops on the trading floor can actually be
pushed to, which is the question that decides whether the game is playable
this way at all.

**What a pad still cannot do.** These are what stand between "Playable" and
"Verified":

- **Text entry.** The Versus lobby's match-server address and password fields
  need a keyboard. Steam's on-screen keyboard may cover this on a Deck; it has
  not been tested. Nothing else in the game needs typing — the quantity field
  has −, + and Max beside it, and the pad deliberately leaves it alone.
- **No Steam Input.** This reads the browser's Gamepad API, not Steam's, so
  there is no official controller layout to ship and no rebinding.
- **The charts are hover-only.** Reading a price off the chart wants a mouse.

## What is not done

- **Controller support is partial.** A pad plays the game and the screen says
  what its buttons do; text entry and Steam Input are still missing. See above.
- **No Steam Cloud conflict handling.** Two machines playing offline and then
  syncing will have Steam pick one save; the loser is gone.
- **No rich presence, leaderboards or Steam multiplayer.** 1v1 goes through
  the match server in `server/`, not through Steam's networking. Steam's
  lobbies would remove the need to run a server at all, and are worth
  considering before launch.
- **No code signing.** Unsigned Windows builds get a SmartScreen warning
  outside of Steam. Inside Steam it matters less, but a certificate is worth
  having.
