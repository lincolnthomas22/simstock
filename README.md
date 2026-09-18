# SimStock

A free, beginner-friendly stock market simulator game that runs in the browser.

Build a trading desk from $1,000: research fictional companies, buy and sell shares, collect dividends, hire staff for passive income, and upgrade your account to unlock more stocks. One second in the game is one trading day, and a speed control can pause that or run it up to four times faster.

The portfolio screen charts your net worth against the market, so you can see whether your trading is beating the index or just paying commission to keep up.

All companies and prices are fictional and simulated. No real money is involved.

## Play

Open `index.html` in a browser. There's nothing to install or build.

## Files

- `index.html` — page layout (the desk home screen, Trading and Upgrades)
- `style.css` — all styling
- `game.js` — game logic, market simulation and saving (progress is stored in the browser's localStorage)
- `favicon.svg` — browser tab icon
- `og-image.png` — the card that shows up when the site is linked somewhere

Game balance numbers (starting cash, commission, tier costs, staff pay, news frequency, XP) are at the top of `game.js`.

Progress is kept in the browser's localStorage. Settings can write the whole game out to a JSON file and read one back, which is how a game moves between browsers.
