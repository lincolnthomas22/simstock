# SimStock

[![CI](https://github.com/lincolnthomas22/simstock/actions/workflows/ci.yml/badge.svg)](https://github.com/lincolnthomas22/simstock/actions/workflows/ci.yml)

A free, beginner-friendly stock market simulator game that runs in the browser.

Build a trading desk from $1,000: research fictional companies, buy and sell shares, collect dividends, hire staff for passive income, and upgrade your account to unlock more stocks. One second in the game is one trading day, and a speed control can pause that or run it up to four times faster.

The portfolio screen charts your net worth against the market, so you can see whether your trading is beating the index or just paying commission to keep up.

The Versus room is a 1v1 match: one stock, $1,000 each, a risk level and a length chosen by the host, and whoever is worth more when the bell goes wins. Matches are sealed off from a saved game entirely.

The stock you race on is a company in the same sense the trading floor's are, and its screen is the same screen: profits behind the price, a P/E ratio and a market cap, quarterly earnings on the calendar, dividends paid into your cash three weeks after each report, a market index it moves with, and a price chart you can read a tick off. The chart switches to a view of the race — both net worths against the stock itself — when you want to see who is winning rather than what the stock is doing.

Point the room at a match server and two people play live, in the same market, against each other's net worth, and either can ask for a rematch from the result screen without going back to the lobby. A connection that drops no longer ends the match: the server holds your money, your shares and your place for three quarters of a minute while the game quietly lets itself back in, and that covers a reloaded page as well as a wifi blip. With no server there is still a practice opponent on the desk, and a password match that puts both of you in an identical market to play apart and compare afterwards.

All companies and prices are fictional and simulated. No real money is involved.

## Play

Open `index.html` in a browser. There's nothing to install or build.

For live 1v1 you need a match server running somewhere. There are two ways,
and neither needs you to understand Docker.

**From a browser, installing nothing.** Add a Fly.io token as a repository
secret, then run the "Deploy the match server" workflow from the Actions tab.
The install happens on GitHub's machines, so this works on a locked-down
laptop where you cannot install anything yourself. Setup steps are in the
comment at the top of `.github/workflows/deploy-server.yml`.

**From your own machine**, if you can install things:

```sh
./tools/deploy-server.sh
```

which deploys, waits for the server to answer, and offers to write the address
into the game for you. See also `server/README.md`. Either way, what it comes down to is setting
`DEFAULT_SERVER` near the top of the versus section of `game.js`:

```js
const DEFAULT_SERVER = 'wss://your-server.example';
```

That is the only line to change. The lobby then fills the address in and
connects on its own, so nobody has to type anything. Left empty it stays
blank, and the room still plays: the practice bot and password matches need no
server at all.

For the desktop version, `cd desktop && npm install && npm start`. See
`desktop/README.md`, which also covers what getting onto Steam involves.

## Files

- `index.html` — page layout (the desk home screen, Trading and Upgrades)
- `style.css` — all styling
- `game.js` — game logic, market simulation and saving (progress is stored in the browser's localStorage)
- `sim.js` — the 1v1 match simulator: seeded, self-contained and DOM-free, so the browser and the match server generate the identical market. It runs the same model the career game does — a market index, profits, fair value, earnings and dividends — on a one-stock board
- `fonts/` — the game's fonts, kept locally so it runs with no internet (regenerate with `node tools/fetch-fonts.js`)
- `server/` — the match server: matchmaking, the clock and the referee for live 1v1 play. It has its own README and its own tests, and the game works without it
- `desktop/` — the Electron shell that makes it a desktop game, for Steam. Its README covers the build, the Steam side, and why the Linux build is started through a launcher script
- `tests/` — browser tests: the game on its own, and two browsers playing each other through a real match server
- `tools/` — small generators: the font bundle and the Steam achievement mapping, both read from the game rather than kept by hand
- `.github/workflows/` — CI on every push, and the three-platform desktop build
- `Dockerfile`, `fly.toml` — deployment for the match server, built from the repository root because it needs `sim.js` too
- `favicon.svg` — browser tab icon
- `og-image.png` — the card that shows up when the site is linked somewhere

Game balance numbers (starting cash, commission, tier costs, staff pay, news frequency, XP) are at the top of `game.js`. Match risk levels and lengths are at the top of `sim.js`.

Progress is kept in the browser's localStorage. Settings can write the whole game out to a JSON file and read one back, which is how a game moves between browsers. The desktop build keeps it in a real file instead, which is the only form Steam Cloud can sync.

## Tests

Four suites, all run by CI on every push. Each can be run on its own:

```sh
cd server  && npm ci && npm test   # 50 — the match protocol, against a real server
cd tests   && npm ci && npm test   # 70 — the game in a browser, and two browsers playing each other
cd desktop && npm ci && npm test   # 33 — the desktop shell, as a real app
node tools/steam-achievements.js   # regenerates the Steam mapping; CI fails if it differs
```

The browser and desktop suites drive Chromium and Electron. On a headless
machine put `xvfb-run -a` in front. `CHROMIUM_PATH` points the browser suite at
a Chromium that is already installed, instead of downloading one.

Desktop builds for Windows, macOS and Linux come from
`.github/workflows/release.yml` — one runner per platform, because macOS only
builds on a Mac and Windows-from-Linux needs Wine. Push a `v*` tag, or run it
by hand from the Actions tab with the match server address to bake in.
