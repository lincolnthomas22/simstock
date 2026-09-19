# SimStock

A free, beginner-friendly stock market simulator game that runs in the browser.

Build a trading desk from $1,000: research fictional companies, buy and sell shares, collect dividends, hire staff for passive income, and upgrade your account to unlock more stocks. One second in the game is one trading day, and a speed control can pause that or run it up to four times faster.

The portfolio screen charts your net worth against the market, so you can see whether your trading is beating the index or just paying commission to keep up.

The Versus room is a 1v1 match: one stock, $1,000 each, a risk level and a length chosen by the host, and whoever is worth more when the bell goes wins. Matches are sealed off from a saved game entirely.

Point the room at a match server and two people play live, in the same market, against each other's net worth. With no server there is still a practice opponent on the desk, and a password match that puts both of you in an identical market to play apart and compare afterwards.

All companies and prices are fictional and simulated. No real money is involved.

## Play

Open `index.html` in a browser. There's nothing to install or build.

For live 1v1, run the match server as well — see `server/README.md` — and put
its address into the Versus room.

For the desktop version, `cd desktop && npm install && npm start`. See
`desktop/README.md`, which also covers what getting onto Steam involves.

## Files

- `index.html` — page layout (the desk home screen, Trading and Upgrades)
- `style.css` — all styling
- `game.js` — game logic, market simulation and saving (progress is stored in the browser's localStorage)
- `sim.js` — the 1v1 match simulator: seeded, self-contained and DOM-free, so the browser and the match server generate the identical market
- `fonts/` — the game's fonts, kept locally so it runs with no internet (regenerate with `node tools/fetch-fonts.js`)
- `server/` — the match server: matchmaking, the clock and the referee for live 1v1 play. It has its own README and its own tests, and the game works without it
- `desktop/` — the Electron shell that makes it a desktop game, for Steam. Its README covers the build and the Steam side
- `tools/` — small generators: the font bundle and the Steam achievement mapping, both read from the game rather than kept by hand
- `Dockerfile`, `fly.toml` — deployment for the match server, built from the repository root because it needs `sim.js` too
- `favicon.svg` — browser tab icon
- `og-image.png` — the card that shows up when the site is linked somewhere

Game balance numbers (starting cash, commission, tier costs, staff pay, news frequency, XP) are at the top of `game.js`. Match risk levels and lengths are at the top of `sim.js`.

Progress is kept in the browser's localStorage. Settings can write the whole game out to a JSON file and read one back, which is how a game moves between browsers.
