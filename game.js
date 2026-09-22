// SimStock — game logic.
// Everything the game needs to remember lives in `state`, which is saved to
// localStorage so progress survives a reload. One game second is one trading day.
(() => {
  'use strict';

  // ===========================================================
  // TUNING
  // ===========================================================
  const STARTING_CASH = 1000;
  const COMMISSION_RATE = 0.0025;       // the broker's cut of every trade
  const COMMISSION_MIN = 1;             // ...but never less than a dollar
  const DAYS_PER_YEAR = 252;            // trading days in a year
  const DAYS_PER_QUARTER = 63;
  const MARKET_DRIFT = 0.07;            // average yearly market return
  const MARKET_VOL = 0.16;              // yearly market volatility
  const DAILY_MARKET_VOL = MARKET_VOL / Math.sqrt(DAYS_PER_YEAR);
  const REVERSION = 0.02;               // daily pull of a price back toward its fair value
  const COMPANY_NEWS_CHANCE = 1 / 90;   // per stock, per day
  const MARKET_NEWS_CHANCE = 1 / 120;   // per day
  const OFFLINE_CAP_SEC = 2 * 60 * 60;  // staff pay for at most 2 hours away
  // The desktop build puts a small bridge on the window: a real save file that
  // Steam Cloud can sync, Steam achievements, and the address of a match
  // server. In a browser there is none, and everything falls back to the
  // browser's own storage.
  const desktop = (typeof window !== 'undefined' && window.simstock && window.simstock.desktop) ? window.simstock : null;

  const SAVE_KEY = 'simstock.save.v2';
  const OLD_SAVE_KEY = 'stockTycoon.save.v2'; // saves made before the rename to SimStock
  const SAVE_EVERY_TICKS = 5;
  const NEWS_KEEP = 40;
  const TIP_EVERY_TICKS = 12;
  const SPEEDS = [0, 1, 2, 4];          // trading days per real second; 0 is paused

  const XP = { buy: 1, sellLoss: 1, hire: 15, openAccount: 50, dividend: 3, tier: 60 };
  const sellProfitXp = profit => Math.min(50, 5 + Math.floor(profit / 20));
  const xpToNext = level => 75 * level;
  const milestoneBonus = level => 100 * level;

  // ===========================================================
  // GAME DATA
  // vol: yearly volatility · beta: sensitivity to the market ·
  // growth: yearly profit growth · pe: typical price-to-earnings ratio
  // ===========================================================
  const TIERS = [
    // Every tier opens the same amount: three companies, two coins and two
    // memecoins (one ascended, one rising). Starter also has the two safe places
    // to park money, the index fund and the stablecoin.
    { name: 'Starter',  cost: 0,        level: 1,  blurb: 'Your first brokerage account. Steady famous names, the index fund, the two biggest coins, a stablecoin and a first pair of memecoins.' },
    { name: 'Silver',   cost: 5000,     level: 3,  blurb: 'Adds a courier, the biggest bank and a DIY chain, plus two older coins and two more memecoins.' },
    { name: 'Gold',     cost: 30000,    level: 6,  blurb: 'Adds software, oil and online shopping giants, plus two faster coins and two more memecoins.' },
    { name: 'Platinum', cost: 150000,   level: 10, blurb: 'Adds the rough end of the market: an electric carmaker, gold mining and an airline, plus riskier coins.' },
    { name: 'Diamond',  cost: 1000000,  level: 14, blurb: 'Adds a make-or-break biotech, a social media giant and a defence contractor, plus two ambitious coins.' },
    { name: 'Obsidian', cost: 10000000, level: 18, blurb: 'The very top: giant premium-priced companies, the wildest coins on the board and the last of the memecoins.' },
  ];

  // Every name is a light parody of a real company or coin, and each one is
  // tuned to behave roughly like the real thing: its size (sharesOut or coin
  // supply × price), how hard it swings, and how likely it is to blow up.
  // market: 'stock' (the trading floor), 'crypto' or 'meme'.
  const STOCKS = [
    { id: 'VTMF', name: 'Vanguarde Total Market Fund', sector: 'Index fund', fund: true, tier: 0, risk: 1, start: 250, vol: 0.16, beta: 1.0, growth: 0.055, pe: 20, divYield: 0.015, sharesOut: 1.9e9,
      about: 'Owns a small slice of every company in the market. It moves with the market as a whole, so it swings less than most single stocks.' },
    { id: 'APPL', name: 'Appel Inc.', sector: 'Technology', tier: 0, risk: 2, start: 190, vol: 0.27, beta: 1.15, growth: 0.08, pe: 30, divYield: 0.005, sharesOut: 15.2e9,
      about: 'Sells phones, laptops and watches to over a billion people, and takes a cut of every app sold on them. Huge, hugely profitable, and still growing.' },
    { id: 'KOKA', name: 'Koka-Cola Company', sector: 'Consumer staples', tier: 0, risk: 1, start: 62, vol: 0.16, beta: 0.6, growth: 0.03, pe: 23, divYield: 0.031, sharesOut: 4.3e9,
      about: 'Sells fizzy drinks in almost every country on earth. People keep buying them whatever the economy does, so the stock is steady and pays a rising dividend.' },
    { id: 'DUKK', name: 'Duck Energy', sector: 'Utilities', tier: 0, risk: 1, start: 105, vol: 0.15, beta: 0.45, growth: 0.02, pe: 18, divYield: 0.039, sharesOut: 770e6,
      about: 'Keeps the lights on for millions of homes. Growth is slow and dull, but the bills get paid and so do its dividends.' },
    { id: 'FDUP', name: 'FedUp Corporation', sector: 'Logistics', tier: 1, risk: 2, start: 250, vol: 0.28, beta: 1.05, growth: 0.06, pe: 15, divYield: 0.02, sharesOut: 245e6,
      about: 'Flies and trucks parcels around the world overnight. Busy when shops and factories are, and it feels every slowdown first.' },
    { id: 'TSLO', name: 'Teslo Motors', sector: 'Automotive', tier: 3, risk: 4, start: 240, vol: 0.58, beta: 1.8, growth: 0.15, pe: 70, divYield: 0, sharesOut: 3.2e9,
      about: "The world's most valuable carmaker, run by a founder who is never far from the headlines. Priced for enormous growth, so it swings hard on every rumour." },
    { id: 'JPMG', name: 'J.P. Morgane Chase', sector: 'Financials', tier: 1, risk: 2, start: 200, vol: 0.24, beta: 1.1, growth: 0.05, pe: 12, divYield: 0.024, sharesOut: 2.85e9,
      about: 'The biggest bank in the country, lending to families, companies and governments. It rises and falls with the economy, but it has come through every crisis so far.' },
    { id: 'MCSF', name: 'Macrosoft Corporation', sector: 'Technology', tier: 2, risk: 2, start: 410, vol: 0.25, beta: 1.1, growth: 0.1, pe: 34, divYield: 0.008, sharesOut: 7.4e9,
      about: "Sells the office software and cloud computing half the world's businesses run on, paid for by the month. Enormous, steady, and still growing fast." },
    { id: 'HDPO', name: 'The Home Depo', sector: 'Home improvement', tier: 1, risk: 2, start: 350, vol: 0.24, beta: 1.0, growth: 0.06, pe: 23, divYield: 0.025, sharesOut: 990e6,
      about: "Sells timber, tools and paint to builders and weekend DIYers. It booms when people are moving house and doing up homes, and slows when they aren't." },
    { id: 'MDRO', name: 'Moderno', sector: 'Biotech', tier: 4, risk: 5, start: 38, vol: 0.65, beta: 0.8, growth: 0.15, pe: 40, divYield: 0, sharesOut: 385e6,
      about: 'Made its name with a fast-built vaccine and is now betting everything on the next one. A single trial result can double the stock or halve it.' },
    { id: 'XOMB', name: 'ExxonMobile', sector: 'Energy', tier: 2, risk: 2, start: 112, vol: 0.26, beta: 0.85, growth: 0.04, pe: 13, divYield: 0.034, sharesOut: 4.4e9,
      about: 'Pumps, refines and sells oil and gas all over the world. Its price follows energy prices, and it pays out a big dividend.' },
    { id: 'NMNT', name: 'Newmint Mining', sector: 'Mining', tier: 3, risk: 3, start: 45, vol: 0.38, beta: 0.6, growth: 0.07, pe: 14, divYield: 0.022, sharesOut: 1.15e9,
      about: "The world's biggest gold miner. Gold prices swing on fear and interest rates, and a single flooded mine can wipe out a year of profit." },
    { id: 'DLTA', name: 'Delto Air Lines', sector: 'Airlines', tier: 3, risk: 4, start: 48, vol: 0.42, beta: 1.4, growth: 0.08, pe: 8, divYield: 0.012, sharesOut: 645e6,
      about: 'One of the biggest airlines in the world. Full planes and cheap fuel make it soar; a recession or a fuel spike can bring it down hard.' },
    { id: 'LKMN', name: 'Lockheed Martian', sector: 'Aerospace', tier: 4, risk: 2, start: 470, vol: 0.22, beta: 0.5, growth: 0.05, pe: 17, divYield: 0.027, sharesOut: 237e6,
      about: 'Builds fighter jets, missiles and spacecraft for governments. Its customers sign contracts years in advance, which keeps it steady.' },
    { id: 'BRKH', name: 'Berkshire Hathaweigh', sector: 'Conglomerate', tier: 5, risk: 1, start: 460, vol: 0.17, beta: 0.85, growth: 0.06, pe: 22, divYield: 0, sharesOut: 2.16e9,
      about: 'Owns an insurance empire, a railroad and dozens of other businesses, run by a famously patient investor. It never pays a dividend: it keeps the cash and buys more businesses.' },
    { id: 'ELYL', name: 'Ely Lilly', sector: 'Pharmaceuticals', tier: 5, risk: 2, start: 780, vol: 0.28, beta: 0.5, growth: 0.12, pe: 55, divYield: 0.007, sharesOut: 950e6,
      about: 'Sells weight-loss and diabetes drugs the whole world wants. Expensive per share, and priced for years more growth.' },
    { id: 'NVDO', name: 'Nvidio Corporation', sector: 'Semiconductors', tier: 5, risk: 4, start: 880, vol: 0.52, beta: 1.7, growth: 0.2, pe: 60, divYield: 0, sharesOut: 2.46e9,
      about: 'Makes the chips artificial intelligence runs on, and cannot build them fast enough. The fastest-growing giant on the board, and one of the wildest.' },
    { id: 'AMZE', name: 'Amazin.com Inc.', sector: 'Online retail', tier: 2, risk: 3, start: 180, vol: 0.34, beta: 1.25, growth: 0.12, pe: 45, divYield: 0, sharesOut: 10.5e9,
      about: 'Sells nearly everything online and rents out the computers half the internet runs on. Thin profits on the shopping, fat ones on the cloud, and it spends heavily on both.' },
    { id: 'METT', name: 'Metta Platforms', sector: 'Technology', tier: 4, risk: 3, start: 480, vol: 0.4, beta: 1.3, growth: 0.12, pe: 25, divYield: 0.004, sharesOut: 2.53e9,
      about: 'Owns the social networks billions of people scroll every day, and makes its money from the adverts in between. It once lost two-thirds of its value in a year, then won it all back.' },

    // Waiting in the wings: each of these lists on the exchange when a company
    // fails, taking its place on the board. None of them trade before then.
    { id: 'WLMT', name: 'Wallmort Inc.', sector: 'Consumer staples', later: true, tier: 0, risk: 1, start: 68, vol: 0.18, beta: 0.55, growth: 0.05, pe: 30, divYield: 0.013, sharesOut: 8e9,
      about: 'The biggest shop in the world, with a store near almost everyone. People buy groceries in good times and bad.' },
    { id: 'SNPP', name: 'Snapp Inc.', sector: 'Technology', later: true, tier: 0, risk: 4, start: 11, vol: 0.6, beta: 1.5, growth: 0.15, pe: 60, divYield: 0, sharesOut: 1.65e9,
      about: 'A disappearing-photo app loved by teenagers and yet to make a steady profit. Exciting, and fragile.' },
    { id: 'OOBR', name: 'Oober Technologies', sector: 'Logistics', later: true, tier: 1, risk: 3, start: 70, vol: 0.4, beta: 1.3, growth: 0.12, pe: 35, divYield: 0, sharesOut: 2.1e9,
      about: 'Rides and food delivery at the tap of a phone, in cities all over the world. Growing fast, and only lately making a profit.' },
    { id: 'WFGO', name: 'Wells Fargone', sector: 'Financials', later: true, tier: 1, risk: 2, start: 60, vol: 0.27, beta: 1.15, growth: 0.04, pe: 11, divYield: 0.027, sharesOut: 3.4e9,
      about: 'A giant high-street bank still repairing its name after a string of scandals. Pays a solid dividend and follows the economy.' },
    { id: 'RVON', name: 'Rivion Automotive', sector: 'Automotive', later: true, tier: 3, risk: 5, start: 12, vol: 0.7, beta: 1.7, growth: 0.18, pe: 60, divYield: 0, sharesOut: 1e9,
      about: 'Builds electric pickups and delivery vans, and spends money far faster than it earns it. It could be huge, or it could be gone.' },
    { id: 'USTL', name: 'U.S. Steal', sector: 'Materials', later: true, tier: 2, risk: 3, start: 38, vol: 0.38, beta: 1.3, growth: 0.05, pe: 12, divYield: 0.005, sharesOut: 225e6,
      about: 'Melts iron ore into steel for cars, bridges and buildings. Profits rise and fall sharply with construction.' },
    { id: 'NVVX', name: 'Novavacks', sector: 'Biotech', later: true, tier: 4, risk: 5, start: 9, vol: 0.8, beta: 0.9, growth: 0.15, pe: 45, divYield: 0, sharesOut: 160e6,
      about: 'Has one vaccine on the market and not much cash left. The next trial will make or break it.' },
    { id: 'TSOC', name: 'Transoceano', sector: 'Energy', later: true, tier: 2, risk: 4, start: 5, vol: 0.6, beta: 1.2, growth: 0.1, pe: 20, divYield: 0, sharesOut: 870e6,
      about: 'Rents out giant drilling rigs far out at sea. Buried in debt, and its price lurches with every move in oil.' },
    { id: 'SPRT', name: 'Spirited Airlines', sector: 'Airlines', later: true, tier: 3, risk: 5, start: 4, vol: 0.75, beta: 1.6, growth: 0.15, pe: 10, divYield: 0, sharesOut: 110e6,
      about: 'The yellow budget airline with the cheapest seats and the most complaints. Losing money and short of cash; a fuel spike could ground it for good.' },
    { id: 'MSTG', name: 'MicroStratagem', sector: 'Technology', later: true, tier: 4, risk: 5, start: 340, vol: 0.9, beta: 1.4, cryptoBeta: 1.3, growth: 0.2, pe: 80, divYield: 0, sharesOut: 230e6,
      about: 'A small software company that borrowed billions to buy Bitcoyn. Its shares move like the coin itself, only more so.' },
    { id: 'CSTK', name: 'Costko Wholesale', sector: 'Consumer staples', later: true, tier: 5, risk: 1, start: 900, vol: 0.2, beta: 0.75, growth: 0.08, pe: 50, divYield: 0.005, sharesOut: 443e6,
      about: 'Sells groceries and televisions in bulk to members who pay a yearly fee to shop there. Steady, loved, and expensive per share.' },
    { id: 'JNJN', name: 'Johnsen & Johnsen', sector: 'Pharmaceuticals', later: true, tier: 5, risk: 1, start: 158, vol: 0.17, beta: 0.55, growth: 0.04, pe: 16, divYield: 0.031, sharesOut: 2.4e9,
      about: 'Makes everyday medicines and medical devices found in every hospital and chemist. Calm, profitable and a reliable dividend payer.' },

    // ---------- CRYPTO ----------
    // beta here is sensitivity to the crypto market, not the stock market.
    // solid: too big to fail outright, however far it falls.
    { id: 'BTY', market: 'crypto', name: 'Bitcoyn', sector: 'Crypto', tier: 0, risk: 3, solid: true, start: 62000, vol: 0.55, beta: 1.0, growth: 0.12, sharesOut: 19.7e6,
      about: 'The first and biggest cryptocurrency. Only 21 million will ever exist, which is the whole appeal. Big swings, but it has survived every crash so far.' },
    { id: 'ETM', market: 'crypto', name: 'Etherium', sector: 'Crypto', tier: 0, risk: 3, solid: true, start: 3100, vol: 0.7, beta: 1.25, growth: 0.12, sharesOut: 120e6,
      about: 'The network thousands of other apps and tokens run on. It swings harder than Bitcoyn and follows it closely.' },
    { id: 'USDR', market: 'crypto', name: 'Tethur', sector: 'Stablecoin', stable: true, tier: 0, risk: 1, solid: true, start: 1, vol: 0.01, beta: 0, growth: 0, sharesOut: 115e9,
      about: "A stablecoin: each one is meant to be worth exactly one dollar, backed by cash and bonds the issuer holds. Traders use it to park money without leaving crypto. It shouldn't grow, and it shouldn't fall." },
    { id: 'SOLO', market: 'crypto', name: 'Solano', sector: 'Crypto', tier: 2, risk: 4, start: 150, vol: 0.95, beta: 1.5, growth: 0.12, sharesOut: 470e6,
      about: 'A fast, cheap network that once crashed 95% and came roaring back. The favourite of memecoin traders.' },
    { id: 'RPL', market: 'crypto', name: 'Rippel', sector: 'Crypto', tier: 2, risk: 4, start: 0.55, vol: 0.85, beta: 1.1, growth: 0.06, sharesOut: 56e9,
      about: 'Built to move money between banks in seconds. Spent years fighting regulators in court, and its price jumps on every ruling.' },
    { id: 'LTN', market: 'crypto', name: 'Lightcoin', sector: 'Crypto', tier: 1, risk: 3, start: 72, vol: 0.75, beta: 1.1, growth: 0.03, sharesOut: 75e6,
      about: 'One of the oldest coins, a lighter, faster copy of Bitcoyn. Still around, but most of the excitement has moved elsewhere.' },
    { id: 'ADO', market: 'crypto', name: 'Cardono', sector: 'Crypto', tier: 3, risk: 4, start: 0.45, vol: 0.9, beta: 1.3, growth: 0.06, sharesOut: 35e9,
      about: "A carefully researched network that takes its time shipping anything. Fans love it; critics say it's mostly promises." },
    { id: 'LNKK', market: 'crypto', name: 'Chainlynk', sector: 'Crypto', tier: 4, risk: 4, start: 14, vol: 0.9, beta: 1.3, growth: 0.08, sharesOut: 600e6,
      about: 'Feeds real-world prices and data into crypto apps. Useful plumbing, with a price that swings like everything else in crypto.' },
    { id: 'BNN', market: 'crypto', name: 'Binanse Coin', sector: 'Crypto', tier: 1, risk: 3, start: 560, vol: 0.6, beta: 1.0, growth: 0.08, sharesOut: 146e6,
      about: "The coin of the world's biggest crypto exchange. It lives and dies by the exchange, and the exchange has had its share of run-ins with regulators." },
    { id: 'AVLN', market: 'crypto', name: 'Avalanch', sector: 'Crypto', tier: 5, risk: 4, start: 28, vol: 1.0, beta: 1.5, growth: 0.1, sharesOut: 400e6,
      about: 'A rival network that promised to be faster than Etherium. When crypto runs, it runs harder; when crypto falls, it falls harder.' },
    { id: 'LUNH', market: 'crypto', name: 'Lunah', sector: 'Crypto', tier: 5, risk: 5, start: 80, vol: 1.2, beta: 1.6, growth: 0.2, sharesOut: 700e6,
      about: 'Pays sky-high interest through its sister stablecoin, and nobody is quite sure where the money comes from. The fastest riser in crypto, and the likeliest to vanish overnight.' },
    { id: 'TRNN', market: 'crypto', name: 'Tronn', sector: 'Crypto', tier: 3, risk: 4, start: 0.12, vol: 0.8, beta: 1.0, growth: 0.08, sharesOut: 87e9,
      about: 'A network built for cheap, fast transfers, and a favourite for moving stablecoins around. Its founder is as famous for publicity stunts as for the technology.' },
    { id: 'DOTT', market: 'crypto', name: 'Polkadott', sector: 'Crypto', tier: 4, risk: 4, start: 7, vol: 0.95, beta: 1.35, growth: 0.08, sharesOut: 1.4e9,
      about: 'Links lots of separate blockchains together so they can talk to each other. Ambitious, technical, and still waiting for the crowd to arrive.' },
    { id: 'TONN', market: 'crypto', name: 'Toncoyn', sector: 'Crypto', later: true, tier: 2, risk: 4, start: 5.5, vol: 1.0, beta: 1.2, growth: 0.1, sharesOut: 2.5e9,
      about: 'Tied to a messaging app with a billion users. If they all start paying each other in it, it could be huge.' },
    { id: 'POLG', market: 'crypto', name: 'Pollygon', sector: 'Crypto', later: true, tier: 3, risk: 4, start: 0.5, vol: 1.0, beta: 1.4, growth: 0.06, sharesOut: 9.3e9,
      about: 'Makes Etherium cheaper and faster to use by bundling transactions together. Useful, crowded, and fighting a dozen copycats.' },
    { id: 'APTS', market: 'crypto', name: 'Aptoss', sector: 'Crypto', later: true, tier: 4, risk: 5, start: 8, vol: 1.2, beta: 1.5, growth: 0.12, sharesOut: 450e6,
      about: 'A young network built by engineers who left a social media giant. Plenty of money behind it, and not much yet built on it.' },
    { id: 'SUEY', market: 'crypto', name: 'Suey', sector: 'Crypto', later: true, tier: 5, risk: 5, start: 1.2, vol: 1.3, beta: 1.6, growth: 0.15, sharesOut: 2.8e9,
      about: 'A brand-new network, barely a year old and priced as if it has already won.' },

    // ---------- MEMECOINS ----------
    // phase 'ascended': already famous, and too big to vanish. 'rising': tiny,
    // and on any day it might ascend, or be rugged by the people who made it.
    // rug: yearly chance of the makers vanishing with the money.
    { id: 'DOGG', market: 'meme', phase: 'ascended', name: 'Doggecoin', sector: 'Memecoin', tier: 0, risk: 4, solid: true, start: 0.12, vol: 1.0, beta: 1.4, growth: 0.05, sharesOut: 146e9,
      about: 'Started as a joke with a dog on it and became one of the biggest coins in the world. A single post from the right billionaire can move it 20% in a day.' },
    { id: 'SHBU', market: 'meme', phase: 'ascended', name: 'Shiba Inyu', sector: 'Memecoin', tier: 1, risk: 4, solid: true, start: 0.000018, vol: 1.1, beta: 1.5, growth: 0.05, sharesOut: 589e12,
      about: "The self-styled Doggecoin killer, with nearly 600 trillion coins in circulation. A few dollars buys you millions of them." },
    { id: 'PEPP', market: 'meme', phase: 'ascended', name: 'Peppe', sector: 'Memecoin', tier: 2, risk: 4, solid: true, start: 0.0000095, vol: 1.2, beta: 1.6, growth: 0.06, sharesOut: 420e12,
      about: 'A cartoon frog that went from internet in-joke to a multi-billion-dollar coin in weeks. No roadmap, no purpose, no apologies.' },
    { id: 'BONQ', market: 'meme', phase: 'ascended', name: 'Bonkk', sector: 'Memecoin', tier: 3, risk: 4, solid: true, start: 0.000022, vol: 1.3, beta: 1.7, growth: 0.06, sharesOut: 70e12,
      about: 'The dog coin of the Solano network, handed out free to its early users. It rises and falls with Solano, only more so.' },
    { id: 'WCAP', market: 'meme', phase: 'ascended', name: 'dogwifcap', sector: 'Memecoin', tier: 5, risk: 4, solid: true, start: 2.1, vol: 1.4, beta: 1.8, growth: 0.06, sharesOut: 1e9,
      about: "A dog in a knitted cap. That's it. That's the whole thing, and at one point it was worth billions." },
    { id: 'FLKK', market: 'meme', phase: 'ascended', name: 'Flokki', sector: 'Memecoin', tier: 4, risk: 4, solid: true, start: 0.00015, vol: 1.2, beta: 1.6, growth: 0.05, sharesOut: 9.7e12,
      about: "Named after a famous billionaire's dog, with its own game and a marketing budget bigger than most startups'." },
    { id: 'MDNG', market: 'meme', phase: 'rising', name: 'Moo Dang', sector: 'Memecoin', tier: 0, risk: 5, rug: 0.8, start: 0.00021, vol: 1.6, beta: 1.5, growth: 0.3, sharesOut: 1e9,
      about: 'Named after a baby hippo who went viral for being grumpy. Tiny, brand new, and one video away from taking off. Or from nothing at all.' },
    { id: 'TURB', market: 'meme', phase: 'rising', name: 'Turbbo', sector: 'Memecoin', tier: 1, risk: 5, rug: 0.8, start: 0.0000042, vol: 1.7, beta: 1.6, growth: 0.3, sharesOut: 69e9,
      about: 'A coin an AI chatbot designed for fun, from the name to the logo. It has a loud community and not much else.' },
    { id: 'BRET', market: 'meme', phase: 'rising', name: 'Bret', sector: 'Memecoin', tier: 2, risk: 5, rug: 0.8, start: 0.000065, vol: 1.7, beta: 1.6, growth: 0.3, sharesOut: 10e9,
      about: 'The blue cartoon friend of a much more famous frog. Its holders are sure its moment is coming.' },
    { id: 'MOGG', market: 'meme', phase: 'rising', name: 'Mogg', sector: 'Memecoin', tier: 3, risk: 5, rug: 0.8, start: 0.00000031, vol: 1.8, beta: 1.7, growth: 0.35, sharesOut: 420e9,
      about: 'A cat in sunglasses whose whole pitch is that it is cooler than you. A third of a millionth of a dollar per coin.' },
    { id: 'PCAT', market: 'meme', phase: 'rising', name: 'Popcatt', sector: 'Memecoin', tier: 4, risk: 5, rug: 0.8, start: 0.0008, vol: 1.6, beta: 1.5, growth: 0.3, sharesOut: 980e6,
      about: 'A cat with its mouth open, looped forever. Millions of people have seen the video; a few thousand own the coin.' },
    { id: 'BOMS', market: 'meme', phase: 'rising', name: 'Book of Memes', sector: 'Memecoin', tier: 5, risk: 5, rug: 0.8, start: 0.000011, vol: 1.8, beta: 1.7, growth: 0.35, sharesOut: 69e9,
      about: 'Promises to store every meme ever made, forever, on the blockchain. Nobody has checked whether it does.' },
    // new memecoins launch as others ascend or get rugged
    { id: 'GGCH', market: 'meme', phase: 'rising', later: true, name: 'Gigachadd', sector: 'Memecoin', tier: 0, risk: 5, rug: 0.8, start: 0.00009, vol: 1.7, beta: 1.6, growth: 0.3, sharesOut: 9.6e9,
      about: 'A chiselled black-and-white face that stands for supreme confidence. Its holders have plenty of that.' },
    { id: 'MEWW', market: 'meme', phase: 'rising', later: true, name: 'Meww', sector: 'Memecoin', tier: 0, risk: 5, rug: 0.8, start: 0.0000038, vol: 1.8, beta: 1.6, growth: 0.3, sharesOut: 88e9,
      about: "Short for 'cat in a dogs world'. The underdog of underdogs. The undercat." },
    { id: 'NEIR', market: 'meme', phase: 'rising', later: true, name: 'Neirro', sector: 'Memecoin', tier: 1, risk: 5, rug: 0.8, start: 0.0000014, vol: 1.8, beta: 1.7, growth: 0.3, sharesOut: 420e9,
      about: 'Named after the new dog of the owner of the dog that started it all. Yes, really.' },
    { id: 'SLRF', market: 'meme', phase: 'rising', later: true, name: 'Slurff', sector: 'Memecoin', tier: 1, risk: 5, rug: 0.8, start: 0.00005, vol: 1.9, beta: 1.7, growth: 0.3, sharesOut: 500e6,
      about: 'Its maker accidentally destroyed the money raised to launch it on day one. People bought it anyway, as a joke.' },
    { id: 'PNTT', market: 'meme', phase: 'rising', later: true, name: 'Peanutt the Squirrel', sector: 'Memecoin', tier: 2, risk: 5, rug: 0.8, start: 0.00033, vol: 1.7, beta: 1.6, growth: 0.3, sharesOut: 1e9,
      about: 'A tribute to a much-loved pet squirrel whose story went viral. Sentiment is its only asset.' },
    { id: 'WENN', market: 'meme', phase: 'rising', later: true, name: 'Wenn', sector: 'Memecoin', tier: 2, risk: 5, rug: 0.8, start: 0.000024, vol: 1.8, beta: 1.7, growth: 0.3, sharesOut: 700e9,
      about: 'Named after the question every holder asks: when? Handed out free to anyone who wanted it.' },
    { id: 'PONK', market: 'meme', phase: 'rising', later: true, name: 'Ponkee', sector: 'Memecoin', tier: 3, risk: 5, rug: 0.8, start: 0.00012, vol: 1.8, beta: 1.7, growth: 0.35, sharesOut: 555e6,
      about: 'A blue monkey with a bad attitude, favoured by the loudest corner of the internet.' },
    { id: 'MYRH', market: 'meme', phase: 'rising', later: true, name: 'Myroh', sector: 'Memecoin', tier: 3, risk: 5, rug: 0.8, start: 0.00007, vol: 1.7, beta: 1.6, growth: 0.3, sharesOut: 1e9,
      about: "The dog of a famous crypto founder. Its fans say it's the next Doggecoin; so do everyone else's." },
    { id: 'PENG', market: 'meme', phase: 'rising', later: true, name: 'Pudgy Penguu', sector: 'Memecoin', tier: 4, risk: 5, rug: 0.8, start: 0.0000055, vol: 1.7, beta: 1.6, growth: 0.3, sharesOut: 88e9,
      about: 'A chubby cartoon penguin from a collection of pricey digital pictures, now a coin anyone can buy for a fraction of a cent.' },
    { id: 'CHLL', market: 'meme', phase: 'rising', later: true, name: 'Just a Chill Guyy', sector: 'Memecoin', tier: 5, risk: 5, rug: 0.8, start: 0.00018, vol: 1.8, beta: 1.7, growth: 0.3, sharesOut: 1e9,
      about: "A cartoon dog in a grey sweater who doesn't care about anything. Its holders care a great deal." },
  ];
  STOCKS.forEach(s => { if (!s.market) s.market = 'stock'; });
  const STOCK_BY_ID = Object.fromEntries(STOCKS.map(s => [s.id, s]));

  // Tickers from before every company took a parody name, so old saves keep their holdings.
  const RENAMED = {
    IDXF: 'VTMF', TICK: 'APPL', BRWL: 'KOKA', CIVC: 'DUKK', PARC: 'FDUP', VOLT: 'TSLO', NRTH: 'JPMG',
    NIMB: 'MCSF', HRVS: 'HDPO', HELX: 'MDRO', CRST: 'XOMB', AURA: 'NMNT', VELO: 'DLTA', ORBT: 'LKMN',
    SUMT: 'BRKH', MERD: 'ELYL', QNTA: 'NVDO', FRSH: 'WLMT', PNGW: 'SNPP', DSHL: 'OOBR', KEEL: 'WFGO',
    SPRK: 'RVON', FORG: 'USTL', GNVA: 'NVVX', TDWR: 'TSOC', SKYL: 'SPRT', NOVL: 'MSTG', ATLS: 'CSTK', CURW: 'JNJN',
  };

  const MARKETS = {
    stock:  { screen: 'trade',  pick: 'VTMF', unit: 'share' },
    crypto: { screen: 'crypto', pick: 'BTY',  unit: 'coin' },
    meme:   { screen: 'meme',   pick: 'DOGG', unit: 'coin' },
  };
  const MARKET_OF_SCREEN = { trade: 'stock', crypto: 'crypto', meme: 'meme' };
  const isCoin = s => s.market !== 'stock';
  const units = (s, n = 2) => MARKETS[s.market].unit + (n === 1 ? '' : 's');

  // The crypto market has a mood of its own: it leans on the stock market but
  // swings far harder.
  const CRYPTO_OWN_VOL = 0.5;
  const CRYPTO_STOCK_BETA = 1.1;
  const DAILY_CRYPTO_VOL = Math.sqrt((CRYPTO_STOCK_BETA * MARKET_VOL) ** 2 + CRYPTO_OWN_VOL ** 2) / Math.sqrt(DAYS_PER_YEAR);
  const CRYPTO_NEWS_CHANCE = 1 / 90;

  // A rising memecoin can take off: over a week or two its price multiplies
  // somewhere between ASCEND_MIN and ASCEND_MAX times, and it joins the big
  // ones. Most never do: about three in four are rugged or simply collapse
  // first. The ones that do make it can still fade away later, which keeps
  // the pit from filling up forever.
  const ASCEND_CHANCE = 1 / 500;   // per day, for each rising memecoin
  const ASCEND_MIN = 20;
  const ASCEND_MAX = 400;
  const ASCENDED_VOL = 0.75;       // an ascended coin still swings, just less
  const NEW_MEME_AFTER = [15, 35]; // trading days before a new memecoin launches after one ascends
  const FADE_CHANCE = 1.0;         // yearly chance a coin that ascended starts to fade
  const FADE_DAYS = [30, 70];      // how long the fade takes, falling about 96% on the way

  // Risk, from 1 to 5, follows how hard a company's price swings. Riskier
  // companies grow faster on average, and from 3 upward they can fail outright.
  // shock: yearly chance of a blow that puts the company's survival in doubt.
  // sudden: yearly chance of collapsing overnight, with no warning at all.
  const RISK = [
    null,
    { label: 'Very safe',  shock: 0,    sudden: 0 },
    { label: 'Safe',       shock: 0,    sudden: 0 },
    { label: 'Medium',     shock: 0.03, sudden: 0 },
    { label: 'Risky',      shock: 0.07, sudden: 0 },
    { label: 'Very risky', shock: 0.10, sudden: 0.025 },
  ];
  // A memecoin that started out rising and has since made it: no longer rug-able.
  const ascendedNow = (s, rt) => s.phase === 'rising' && !!rt && (rt.phase === 'ascended' || rt.phase === 'ascending');
  const graduated = (s, rt) => s.phase === 'rising' && !!rt && rt.phase === 'ascended';
  // Nothing can fail mid-ascension; everything else rated 3+ can, unless it's too big.
  const canFail = (s, rt) => s.risk >= 3 && !s.solid && !(rt && rt.phase === 'ascending');
  // How far below its year's high a price must sink before failure is on the
  // table, and how far it must climb back to be safe. Crypto shrugs off falls
  // that would finish a company.
  // shock scales the yearly chance of a sudden blow (RISK[n].shock).
  const FAIL_RULES = {
    stock: { distress: 0.35, recover: 0.55, shock: 1 },
    crypto: { distress: 0.1, recover: 0.25, shock: 0.5 },
    meme: { distress: 0.1, recover: 0.25, shock: 1 },
  };

  // ===========================================================
  // ACHIEVEMENTS
  // Most are a `check()` against the live game: the scanner below tests every
  // locked one on every action and every simulated day, and whichever go true
  // first get unlocked and stay that way. A few genuinely momentary ones
  // (Phoenix, Perfect Quarter) are unlocked directly at the instant they
  // happen instead, because there's no standing condition to check later.
  // Hidden ones don't show their name or blurb until unlocked.
  const ACHIEVEMENTS = [
    // Getting started
    { id: 'first_trade', category: 'Getting started', name: 'First Trade', blurb: 'Place your first order.',
      check: () => state.stats.trades >= 1 },
    { id: 'open_for_business', category: 'Getting started', name: 'Open for Business', blurb: 'Open a brokerage account.',
      check: () => state.accountOpen },
    { id: 'first_hire', category: 'Getting started', name: 'First Hire', blurb: 'Hire your first member of staff.',
      check: () => staffCount() >= 1 },
    { id: 'full_house', category: 'Getting started', name: 'Full House', blurb: 'Reach an Obsidian account, the top tier.',
      check: () => state.tier === TIERS.length - 1 },

    // Trading
    { id: 'in_the_black', category: 'Trading', name: 'In the Black', blurb: 'Close a single sale for over $1,000 profit.',
      check: () => state.stats.bestSaleProfit > 1000 },
    { id: 'diamond_hands', category: 'Trading', name: 'Diamond Hands', blurb: 'Hold a position for a full year before selling out of it.',
      check: () => state.stats.longestHoldDays >= DAYS_PER_YEAR },
    { id: 'paper_hands', category: 'Trading', name: 'Paper Hands', blurb: 'Buy and fully sell a position on the same day.',
      check: () => state.stats.sameDayFlip },
    { id: 'buy_the_dip', category: 'Trading', name: 'Buy the Dip', blurb: 'Buy a stock the same day it drops more than 8%.',
      check: () => state.stats.boughtBigDip },
    { id: 'perfect_quarter', category: 'Trading', name: 'Perfect Quarter', blurb: 'End a quarter with every holding above what you paid for it.' },

    // Risk & survival
    { id: 'near_miss', category: 'Risk & survival', name: 'Near Miss', blurb: 'Sell out of a company the moment it warns of trouble.',
      check: () => state.stats.soldWhileDistressed },
    { id: 'burned', category: 'Risk & survival', name: 'Burned', blurb: 'Lose money when a company you hold fails outright.',
      check: () => state.stats.wasBurned },
    { id: 'phoenix', category: 'Risk & survival', name: 'Phoenix', blurb: 'Recover your net worth after a company you held failed.' },
    { id: 'nerves_of_steel', category: 'Risk & survival', name: 'Nerves of Steel', blurb: 'Hold a rating-5 stock for 100 days straight.',
      check: () => STOCKS.some(s => s.market === 'stock' && s.risk === 5 && (rtOf(s.id).riskStreak || 0) >= 100) },
    { id: 'diversified', category: 'Risk & survival', name: 'Diversified', blurb: 'Go a full quarter without any one company topping 25% of your net worth.',
      check: () => state.stats.concentrationStreak >= DAYS_PER_QUARTER },

    // Building the firm
    { id: 'full_team', category: 'Building the firm', name: 'Full Team', blurb: 'Have at least one of every staff role at once.',
      check: () => STAFF.every(r => state.staff[r.id] > 0) },
    { id: 'the_office', category: 'Building the firm', name: 'The Office', blurb: 'Have 10 staff on the payroll at once.',
      check: () => staffCount() >= 10 },
    { id: 'loyal_crew', category: 'Building the firm', name: 'Loyal Crew', blurb: 'Go 100 days without a layoff after your first hire.',
      check: () => state.stats.firstHireDay != null && staffCount() > 0 && (state.day - state.stats.lastLayoffDay) >= 100 },
    { id: 'rough_quarter', category: 'Building the firm', name: 'Rough Quarter', blurb: 'Survive a whole quarter of staff costing more than they bring in.',
      check: () => state.stats.negIncomeStreak >= DAYS_PER_QUARTER },

    // Milestones
    { id: 'five_figures', category: 'Milestones', name: 'Five Figures', blurb: 'Reach a net worth of $10,000.',
      check: () => netWorth() >= 10000 },
    { id: 'six_figures', category: 'Milestones', name: 'Six Figures', blurb: 'Reach a net worth of $100,000.',
      check: () => netWorth() >= 100000 },
    { id: 'seven_figures', category: 'Milestones', name: 'Seven Figures', blurb: 'Reach a net worth of $1,000,000.',
      check: () => netWorth() >= 1000000 },
    { id: 'dividend_income', category: 'Milestones', name: 'Dividend Income', blurb: 'Earn $10,000 in dividends over the life of your account.',
      check: () => state.totalDividends >= 10000 },
    { id: 'a_year_on_the_floor', category: 'Milestones', name: 'A Year on the Floor', blurb: 'Play for a full trading year.',
      check: () => state.day >= DAYS_PER_YEAR },
    { id: 'whole_board', category: 'Milestones', name: 'The Whole Board', blurb: 'Own shares in every company open to your account at once.',
      check: () => {
        const list = boardStocks().filter(s => s.market === 'stock' && isUnlocked(s) && trading(s));
        return state.accountOpen && list.length > 0 && list.every(s => rtOf(s.id).shares > 0);
      } },
    { id: 'beating_the_market', category: 'Milestones', name: 'Beating the Market', blurb: "Beat the index fund's return over a quarter.",
      check: () => {
        const mh = state.worth.history, bh = state.market.history;
        if (mh.length < DAYS_PER_QUARTER || bh.length < DAYS_PER_QUARTER) return false;
        const mine = mh[mh.length - 1] / mh[mh.length - DAYS_PER_QUARTER] - 1;
        const bench = bh[bh.length - 1] / bh[bh.length - DAYS_PER_QUARTER] - 1;
        return mine > bench && mine > 0;
      } },

    // Crypto & memecoins
    { id: 'crypto_curious', category: 'Crypto & memecoins', name: 'Crypto Curious', blurb: 'Buy your first cryptocurrency.',
      check: () => state.stats.boughtCrypto },
    { id: 'whole_coin', category: 'Crypto & memecoins', name: 'A Whole Coin', blurb: 'Own one entire Bitcoyn.',
      check: () => rtOf('BTY').shares >= 1 },
    { id: 'hodl', category: 'Crypto & memecoins', name: 'HODL', blurb: 'Hold a cryptocurrency for 100 days without selling out of it.',
      check: () => STOCKS.some(s => s.market === 'crypto' && rtOf(s.id).shares > 0 && state.day - rtOf(s.id).firstBuyDay >= 100) },
    { id: 'meme_million', category: 'Crypto & memecoins', name: 'Millionaire, Sort Of', blurb: 'Hold 1,000,000 coins of a single memecoin.',
      check: () => memeHeldAtLeast(1e6) },
    { id: 'meme_billion', category: 'Crypto & memecoins', name: 'Billionaire, Technically', blurb: 'Hold 1,000,000,000 coins of a single memecoin.',
      check: () => memeHeldAtLeast(1e9) },
    { id: 'meme_trillion', category: 'Crypto & memecoins', name: 'Trillionaire', blurb: 'Hold 1,000,000,000,000 coins of a single memecoin.',
      check: () => memeHeldAtLeast(1e12) },
    { id: 'meme_whale', category: 'Crypto & memecoins', name: 'Whale', blurb: 'Own 1% of every coin in existence of a single memecoin.',
      check: () => STOCKS.some(s => s.market === 'meme' && rtOf(s.id).shares >= s.sharesOut * 0.01) },
    { id: 'to_the_moon', category: 'Crypto & memecoins', name: 'To the Moon', blurb: 'Be holding a memecoin on the day it ascends.' },
    { id: 'ten_bagger', category: 'Crypto & memecoins', name: 'Ten-Bagger', blurb: 'Sell memecoins for ten times what you paid for them.',
      check: () => state.stats.memeTenBagger },
    { id: 'rugged', category: 'Crypto & memecoins', name: 'Rugged', blurb: 'Lose your coins when the makers of a memecoin vanish.' },

    // Hidden
    { id: 'coffee_break', category: 'Hidden', hidden: true, name: 'Coffee Break', blurb: 'Have a staff member on the books whose quirk mentions coffee.',
      check: () => state.roster.some(p => /coffee|espresso/i.test(p.trait)) },
    { id: 'rags_to_riches', category: 'Hidden', hidden: true, name: 'Rags to Riches', blurb: 'Go from under $50 in cash to a $50,000 net worth.',
      check: () => state.stats.wasPoor && netWorth() >= 50000 },
    { id: 'the_contrarian', category: 'Hidden', hidden: true, name: 'The Contrarian', blurb: 'Buy a rating-5 stock the same day bad news breaks about it.',
      check: () => state.stats.contrarianBuy },
    { id: 'stable_genius', category: 'Hidden', hidden: true, name: 'Stable Genius', blurb: 'Park $10,000 in a stablecoin.',
      check: () => STOCKS.some(s => s.stable && rtOf(s.id).shares * rtOf(s.id).price >= 10000) },
  ];
  const memeHeldAtLeast = n => STOCKS.some(s => s.market === 'meme' && rtOf(s.id).shares >= n);
  const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

  // Records the unlock and shows it off, unless this is a quiet catch-up scan
  // (run once after loading a save) or the game is on the title screen.
  function unlockAchievement(id, silent = false) {
    if (state.achieved[id]) return false;
    state.achieved[id] = state.day;
    if (desktop) desktop.unlockAchievement(id);
    if (!silent && ui.screen !== 'landing') {
      const a = ACHIEVEMENT_BY_ID[id];
      toast(`Achievement unlocked: ${a.name}`, a.blurb, 'accent');
      playSound('achieve');
    }
    return true;
  }

  // Tests every achievement that isn't unlocked yet. Cheap enough to call
  // after any action and once a day; most checks are simple comparisons.
  function scanAchievements(silent = false) {
    for (const a of ACHIEVEMENTS) {
      if (a.check && !state.achieved[a.id] && a.check()) unlockAchievement(a.id, silent);
    }
  }

  // The handful of stats that only make sense measured once a day: streaks,
  // running peaks, and the moment-based Phoenix and Perfect Quarter checks.
  function updateDailyStats() {
    const worth = netWorth();
    state.stats.peakNetWorth = Math.max(state.stats.peakNetWorth, worth);
    if (state.stats.burnRecoveryTarget != null && worth >= state.stats.burnRecoveryTarget) {
      unlockAchievement('phoenix');
      state.stats.burnRecoveryTarget = null;
    }
    if (state.accountOpen && state.cash < 50) state.stats.wasPoor = true;

    state.stats.negIncomeStreak = (staffCount() > 0 && staffIncome() < 0) ? state.stats.negIncomeStreak + 1 : 0;

    let worstShare = 0;
    if (worth > 0) {
      for (const s of STOCKS) {
        const v = rtOf(s.id).shares * rtOf(s.id).price;
        if (v > 0) worstShare = Math.max(worstShare, v / worth);
      }
    }
    // only counts once you're actually invested: an empty account isn't "diversified"
    state.stats.concentrationStreak = (!state.accountOpen || worstShare > 0.25) ? 0 : state.stats.concentrationStreak + 1;

    for (const s of STOCKS) {
      if (s.risk !== 5) continue;
      const rt = rtOf(s.id);
      rt.riskStreak = (rt.shares > 0 && !rt.delisted) ? (rt.riskStreak || 0) + 1 : 0;
    }

    if (state.day > 0 && mod(state.day, DAYS_PER_QUARTER) === 0) {
      const held = STOCKS.filter(s => rtOf(s.id).shares > 0);
      if (held.length && held.every(s => rtOf(s.id).price >= avgCost(rtOf(s.id)))) unlockAchievement('perfect_quarter');
    }

    scanAchievements();
  }

  // income is the fee clients pay per trading day; salary is paid out every day
  // whether the fees arrive or not.
  const SALARY_SHARE = 0.45;
  const STAFF = [
    { id: 'analyst',  name: 'Research Analyst',  tier: 0, baseCost: 50,     growth: 1.15, income: 1,    about: 'Writes research notes that clients pay for.' },
    { id: 'advisor',  name: 'Financial Advisor', tier: 1, baseCost: 1200,   growth: 1.16, income: 15,   about: 'Helps clients plan their savings for a fee.' },
    { id: 'manager',  name: 'Portfolio Manager', tier: 2, baseCost: 12000,  growth: 1.18, income: 140,  about: 'Runs client portfolios for a management fee.' },
    { id: 'director', name: 'Fund Director',     tier: 3, baseCost: 150000, growth: 1.2,  income: 1600, about: 'Oversees whole funds for large institutions.' },
  ];
  STAFF.forEach(s => { s.salary = Math.round(s.income * SALARY_SHARE * 100) / 100; });
  const STAFF_BY_ID = Object.fromEntries(STAFF.map(s => [s.id, s]));

  // Everyone you hire gets a name and a quirk. They're for colour only: two
  // analysts earn the same whatever their habits.
  const FIRST_NAMES = ['Priya', 'Dev', 'Marta', 'Ollie', 'Keiko', 'Sam', 'Tomasz', 'Ana', 'Rafi', 'June', 'Bea', 'Hugo',
    'Imani', 'Lars', 'Nell', 'Omar', 'Rosa', 'Theo', 'Wen', 'Yusuf', 'Ada', 'Cal', 'Esme', 'Felix', 'Gus', 'Iris',
    'Jonah', 'Lena', 'Milo', 'Nadia', 'Pip', 'Quentin', 'Sunny', 'Tariq', 'Uma', 'Vic', 'Zara', 'Bram', 'Cleo', 'Dara'];
  const LAST_NAMES = ['Nair', 'Okafor', 'Lindqvist', 'Brennan', 'Tanaka', 'Reyes', 'Kowalski', 'Ferreira', 'Haddad', 'Park',
    'Moreau', 'Adeyemi', 'Novak', 'Quinn', 'Sato', 'Abbott', 'Castillo', 'Doyle', 'Eriksen', 'Fontaine', 'Hale', 'Iyer',
    'Kerr', 'Achebe', 'Varga', 'Whitlock', 'Oyelaran', 'Bianchi', 'Petrov', 'Delacroix'];
  const TRAITS = {
    analyst: [
      'Colour-codes every spreadsheet',
      'Has read every annual report on the board, twice',
      'Runs on espresso and footnotes',
      'Draws trendlines on napkins',
      'Believes in utilities the way some people believe in fate',
      'Keeps a chart of their own coffee intake',
      'Can recite Tickr\'s last ten earnings from memory',
      'Has strong opinions about fonts in research notes',
      'Still has the calculator they used at school',
      'Labels the office fridge by sector',
    ],
    advisor: [
      'Remembers every client\'s dog\'s name',
      'Says "spread it out" in their sleep',
      'Keeps a bowl of the good sweets on the desk',
      'Once talked a client out of buying a racehorse',
      'Calm voice, firm handshake, spotless shoes',
      'Answers every question with a gentle question',
      'Has never let a client sell in a panic',
      'Sends handwritten birthday cards',
    ],
    manager: [
      'Rebalances on the first of every month, rain or shine',
      'Hasn\'t panic-sold since the last crash',
      'Reads the bond market over breakfast',
      'Owns eleven identical navy suits',
      'Thinks in fractions of a percent',
      'Never checks prices after six in the evening',
      'Keeps a jar of every commission they ever paid',
      'Has a whiteboard nobody else may touch',
    ],
    director: [
      'Once had lunch with three central bankers',
      'Speaks slowly, and everyone listens',
      'Has a corner office, and a smaller corner office inside it',
      'Collects fountain pens and pension funds',
      'Has seen five crashes and outlasted all of them',
      'Chairs meetings that end early',
    ],
  };

  // A company or coin that has lost most of its value can fail outright (see
  // FAIL_RULES for how far is "most"). Only the wildest can.
  const DELIST_CHANCE = 1 / 150; // per day, while in trouble
  const RELIST_AFTER = [15, 35];  // trading days before a failed company's place is filled

  const HEADLINES = {
    'Technology': {
      good: ['{n} signs a multi-year cloud deal with a major bank', '{n} launches a faster trading platform to strong reviews'],
      bad: ['{n} hit by a service outage lasting several hours', 'Senior engineer departures raise questions at {n}'],
    },
    'Consumer staples': {
      good: ['{n} raises prices without losing customers', 'New snack line from {n} sells out in test stores'],
      bad: ['{n} recalls a frozen meal product', 'Higher grain costs squeeze profits at {n}'],
    },
    'Automotive': {
      good: ['{n} vehicle deliveries beat expectations', '{n} factory starts production ahead of schedule'],
      bad: ['{n} delays its next model by six months', 'Safety regulators review braking complaints at {n}'],
    },
    'Financials': {
      good: ['{n} passes regulator stress test with room to spare', 'Loan demand picks up at {n}'],
      bad: ['{n} sets aside more money for bad loans', '{n} fined over account fee practices'],
    },
    'Biotech': {
      good: ['{n} drug succeeds in a late-stage trial', 'Regulators approve a {n} treatment'],
      bad: ['{n} trial fails to meet its main goal', 'Regulators ask {n} for more safety data'],
    },
    'Energy': {
      good: ['Oil prices climb, lifting {n}', '{n} discovers a large new gas field'],
      bad: ['Oil prices slide on weak demand, weighing on {n}', '{n} pipeline shutdown cuts output'],
    },
    'Aerospace': {
      good: ['{n} wins a government satellite contract', '{n} completes a flawless launch'],
      bad: ['{n} rocket test ends in failure', 'Budget cuts threaten a {n} program'],
    },
    'Conglomerate': {
      good: ['{n} insurance arm reports record profits', '{n} buys a profitable railroad operator'],
      bad: ['{n} takes a loss on a failed acquisition', 'Storm claims weigh on the {n} insurance unit'],
    },
    'Utilities': {
      good: ['Regulators let {n} raise household rates', '{n} finishes a power plant under budget'],
      bad: ['A storm leaves {n} customers without power for days', 'Regulators reject a rate rise sought by {n}'],
    },
    'Logistics': {
      good: ['Holiday parcel volumes set a record at {n}', '{n} opens an automated sorting depot'],
      bad: ['Fuel costs bite into {n} margins', 'A driver strike slows deliveries at {n}'],
    },
    'Materials': {
      good: ['A building boom lifts orders at {n}', '{n} wins a contract to supply a motorway project'],
      bad: ['Housebuilders cancel orders at {n}', 'Energy costs squeeze the {n} cement business'],
    },
    'Mining': {
      good: ['Copper prices jump, lifting {n}', '{n} strikes a rich new seam'],
      bad: ['Flooding shuts a {n} mine', 'Metal prices slide, leaving {n} exposed'],
    },
    'Airlines': {
      good: ['{n} fills its planes over the holidays', 'Cheaper fuel widens margins at {n}'],
      bad: ['{n} grounds planes over a safety check', 'A fuel price spike hits {n} hard'],
    },
    'Pharmaceuticals': {
      good: ['{n} wins approval for a long-awaited treatment', '{n} reports strong sales of its main drug'],
      bad: ['A patent on a {n} blockbuster expires', 'Regulators question {n} pricing'],
    },
    'Semiconductors': {
      good: ['{n} sells out a whole year of AI chips in advance', 'A cloud giant places a record chip order with {n}'],
      bad: ['Export limits cut {n} off from a big market', 'A rival unveils a faster chip than anything {n} makes'],
    },
    'Online retail': {
      good: ['Holiday orders set a record at {n}', 'The {n} cloud arm signs a giant new customer'],
      bad: ['Regulators sue {n} over how it treats rival sellers', 'Warehouse costs squeeze margins at {n}'],
    },
    'Home improvement': {
      good: ['Spring DIY season lifts sales at {n}', 'House moves pick up, filling {n} stores'],
      bad: ['A slow housing market weighs on {n}', 'Shoppers put off kitchen refits, hurting {n}'],
    },
    'Crypto': {
      good: ['A big fund starts buying {n} for its clients', '{n} network upgrade goes live without a hitch', 'A major payments firm adds support for {n}'],
      bad: ['The {n} network halts for several hours', 'Regulators open an investigation into {n}', 'A large holder dumps {n} on the market'],
    },
    'Stablecoin': {
      good: ['{n} publishes a clean audit of its reserves'],
      bad: ['Questions are raised over the reserves behind {n}'],
    },
    'Memecoin': {
      good: ['A celebrity posts about {n}', '{n} is listed on a big exchange', '{n} trends on social media all day'],
      bad: ['A big early holder sells a pile of {n}', '{n} slides as traders chase a newer coin', 'An exchange drops {n}'],
    },
  };
  // Blows that put a risky company's survival in doubt.
  const SHOCKS = {
    'Technology': ["{n} loses its biggest customer", "{n} is hit by a data breach and a wave of lawsuits"],
    'Automotive': ["{n} recalls every car it made this year", "{n} runs short of cash for its new factory"],
    'Biotech': ["{n}'s lead drug fails its final trial", "Regulators halt {n}'s drug trial over safety fears"],
    'Energy': ["{n}'s flagship well comes up dry", "An oil spill leaves {n} facing a huge clean-up bill"],
    'Mining': ["Flooding shuts {n}'s biggest mine", "{n} loses its licence to dig at its main site"],
    'Airlines': ["{n} grounds its fleet after a fuel spike", "{n} cancels a month of flights amid a strike"],
    'Aerospace': ["{n}'s rocket explodes on the launch pad", "{n} loses its government contract"],
    'Semiconductors': ["{n} is banned from selling its best chips abroad", "{n}'s biggest customer starts making its own chips"],
    'Materials': ["{n} closes two plants as orders dry up", "{n} is fined heavily over pollution"],
    'Crypto': ["{n} is drained by a hack on its main bridge", "Regulators sue the founders of {n}"],
    'Memecoin': ["The team behind {n} goes silent and its website disappears", "A wallet holding half of all {n} starts selling"],
    default: ["{n} reports a shock loss", "{n} misses a payment to its lenders"],
  };

  const MARKET_NEWS = {
    good: ['Central bank signals interest rate cuts', 'Jobs report shows strong hiring', 'Inflation cools more than expected'],
    bad: ['Central bank hints at more rate hikes', 'Recession worries hit global markets', 'Inflation comes in hotter than expected'],
  };
  const CRYPTO_NEWS = {
    good: ['Regulators approve new crypto funds for ordinary investors', 'A big bank says it will hold crypto for its clients', 'A country makes Bitcoyn legal tender'],
    bad: ['A major crypto exchange collapses', 'Regulators announce a crackdown on crypto trading', 'A giant crypto lender freezes withdrawals'],
  };
  // Booms and recessions. Now and then the whole economy turns, about once every
  // 1,800 trading days: half an hour of play at 1x, or roughly every seven game
  // years, which is about how often it happens for real. A recession front-loads
  // the damage: the market slides about a third, bottoms out before the
  // recession is declared over and claws some back. A boom climbs steadily and
  // calmly. Cyclical businesses (airlines, carmakers, banks) feel either one
  // most; defensive ones (utilities, groceries, medicine, gold) least, and
  // crypto swings harder than all of them.
  const CYCLE_CHANCE = 1 / 1800;        // per trading day, once the game has begun
  const CYCLE_GAP = 250;                // quiet days after one ends before another can start
  const CYCLE_NEWS_CHANCE = 1 / 40;     // a headline about the economy, per day of a cycle
  const CYCLES = {
    recession: {
      days: [126, 252], tilt: -1, volX: 1.7, shockX: 2, goodNews: 0.2, jump: -0.025,
      // the market's log move over the whole cycle, beyond its usual drift, spread across the
      // days: down 0.43 over the first 70%, then back up 0.12 as it recovers ahead of the economy
      path: f => (f < 0.7 ? -0.43 / 0.7 : 0.12 / 0.3),
      title: 'Recession', startTone: 'neg',
      start: 'The economy tips into recession. Stocks slide as companies cut jobs and spending',
      startTip: 'Cyclical companies like airlines, carmakers and banks usually fall hardest. Utilities, groceries, medicine and gold hold up better.',
      endTitle: 'Recession over', end: 'The recession is over. The economy is growing again', endMood: 'up',
      news: ['Unemployment rises for another month', 'Factory orders fall to a two-year low', 'Shoppers cut back as the downturn deepens',
        'Banks tighten lending as loan defaults climb', 'Central bank cuts interest rates to prop up the economy', 'Company profit warnings pile up'],
    },
    boom: {
      days: [189, 378], tilt: 1, volX: 0.8, shockX: 0.6, goodNews: 0.8, jump: 0.015,
      path: () => 0.3,
      title: 'Economic boom', startTone: 'pos',
      start: 'The economy is booming. Hiring, spending and profits are all surging',
      startTip: 'Cyclical companies usually lead a boom. Steady defensive names tend to lag behind.',
      endTitle: 'Boom over', end: 'The boom cools off as the central bank raises interest rates to rein in prices', endMood: 'down',
      news: ['Hiring surges as companies race to expand', 'Consumer confidence hits a record high', 'Company profits beat forecasts across the board',
        'Home sales climb to their best level in years', 'Economists warn the market may be overheating', 'Factories run flat out to keep up with orders'],
    },
  };
  // how hard a sector leans into the cycle: +1 cyclical, -1 defensive (it gains ground in a recession)
  const CYCLICAL = {
    'Airlines': 1, 'Automotive': 1, 'Materials': 1, 'Financials': 1, 'Logistics': 0.6, 'Home improvement': 0.6,
    'Online retail': 0.5, 'Energy': 0.5, 'Semiconductors': 0.5,
    'Utilities': -1, 'Consumer staples': -1, 'Pharmaceuticals': -0.8, 'Mining': -1, 'Aerospace': -0.4,
  };
  const CYCLE_TILT = 0.0006;            // extra daily move per unit of CYCLICAL during a cycle

  // news that is about a whole market rather than one company or coin
  const MARKET_TICKERS = { MKT: 'Economy', CRYPTO: 'Crypto market' };

  const LESSONS = [
    {
      icon: 'pie',
      title: 'A share is a small piece of a company',
      text: 'When you buy a share, you own part of that business. If the company grows its profits over time, each share usually becomes worth more.',
    },
    {
      icon: 'news',
      title: 'Prices move every day',
      text: 'Prices react to earnings reports, company news and the wider economy. Short-term moves are hard to predict, even for professionals.',
    },
    {
      icon: 'trend',
      title: 'How investors make money',
      text: 'Sell a share for more than you paid and you keep the difference. Some companies also pay <b>dividends</b>: regular cash payments to shareholders.',
    },
  ];

  const GENERAL_TIPS = [
    'Spreading your money across several companies, called diversifying, means one bad day for a single stock hurts less.',
    'Short-term price moves are mostly noise. Earnings reports tell you more about how a business is really doing.',
    'A gain only becomes cash when you sell. Until then it is "unrealized" and can still disappear.',
    'Dividend stocks pay you cash every quarter just for holding them. Check the dividend yield stat.',
    'Beta shows how a stock moves with the market. Above 1.00 means it tends to swing more than the market does.',
    'A high P/E ratio means investors expect strong growth. If that growth disappoints, the price can fall hard.',
  ];

  const ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/>',
    building: '<path d="M4 21V5l8-3v19"/><path d="M12 8l8 3v10"/><path d="M2 21h20"/><path d="M8 7v.01M8 11v.01M8 15v.01M16 14v.01M16 17v.01"/>',
    factory: '<path d="M3 21V11l5 3v-3l5 3V6h7v15z"/><path d="M7 18h2M12 18h2M16 18h1"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8 21h8M9 17h6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    pie: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    news: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h10M7 16h6"/>',
    trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  };

  // ===========================================================
  // HELPERS
  // ===========================================================
  const $ = id => document.getElementById(id);
  const mod = (a, n) => ((a % n) + n) % n;
  const pick = list => list[Math.floor(Math.random() * list.length)];

  // A normally distributed random number (mean 0, standard deviation 1).
  function gauss() {
    let u = 0;
    let v = 0;
    while (!u) u = Math.random();
    while (!v) v = Math.random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const moneyFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const fmt = n => moneyFmt.format(n);
  const fmtSigned = n => (Math.abs(n) < 0.005 ? fmt(0) : (n > 0 ? '+' : '−') + fmt(Math.abs(n)));
  const fmtPct = (n, digits = 2) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(digits) + '%';
  const tone = n => (n >= 0 ? 'pos' : 'neg');
  // for text that came out of a save file, which anyone can edit
  const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

  function fmtBig(n) {
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    return fmt(n);
  }

  // Prices under a dollar keep four significant figures, so a memecoin at
  // $0.00001834 doesn't show up as $0.00.
  function fmtPrice(p, bare = false) {
    let text;
    if (p >= 1 || p === 0) text = moneyFmt.format(p).slice(1);
    else text = p.toFixed(Math.min(12, 3 - Math.floor(Math.log10(p))));
    return (bare ? '' : '$') + text;
  }
  const fmtPriceSigned = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmtPrice(Math.abs(n));

  function fmtCount(n) {
    if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  const fmtQty = (s, n) => (s.market === 'meme' && n >= 1e9 ? fmtCount(n) : n.toLocaleString('en-US', { maximumFractionDigits: 4 }));

  function icon(name, size = 18) {
    return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  const tkr = s => `<span class="tkr">${s.id}</span>`;
  const chg = pct => `<span class="chg ${tone(pct)}">${fmtPct(pct)}</span>`;
  const tkrList = stocks => stocks.map(tkr).join(stocks.length === 2 ? ' and ' : ', ');

  // significant figures rather than decimal places, so the tiniest memecoin price survives
  const roundPrice = v => Number(v.toPrecision(8));

  function pushHistory(list, value) {
    list.push(roundPrice(value));
    if (list.length > DAYS_PER_YEAR) list.shift();
  }

  // ===========================================================
  // MARKET SIMULATION
  // Each day the market moves, then every stock moves by
  //   its share of the market move (beta)
  //   + its own random move (the rest of its volatility)
  //   + a gentle pull toward fair value (profits × typical P/E).
  // Earnings, company news and dividends happen on top of that.
  // ===========================================================
  function simulateDay(st) {
    st.day += 1;
    const day = st.day;
    const events = [];
    const add = (ticker, mood, kind, text) => events.push({ day, ticker, mood, kind, text });

    const cycle = stepCycle(st, events);
    const phase = cycle && CYCLES[cycle.kind];
    let market = MARKET_DRIFT / DAYS_PER_YEAR + gauss() * DAILY_MARKET_VOL * (phase ? phase.volX : 1);
    if (phase) {
      market += phase.path(1 - cycle.left / cycle.days) / cycle.days;
      if (cycle.left === cycle.days) market += phase.jump;
      else if (Math.random() < CYCLE_NEWS_CHANCE) add('MKT', cycle.kind === 'boom' ? 'up' : 'down', 'market', pick(phase.news));
    }
    if (Math.random() < MARKET_NEWS_CHANCE) {
      const good = Math.random() < (phase ? phase.goodNews : 0.5);
      market += (good ? 1 : -1) * (0.012 + Math.random() * 0.02);
      add('MKT', good ? 'up' : 'down', 'market', pick(MARKET_NEWS[good ? 'good' : 'bad']));
    }
    st.market.level *= Math.exp(market);
    pushHistory(st.market.history, st.market.level);
    const marketSurprise = market - MARKET_DRIFT / DAYS_PER_YEAR;

    // the crypto market's own mood for the day; each coin's growth is its own
    let cryptoSurprise = CRYPTO_STOCK_BETA * marketSurprise + gauss() * CRYPTO_OWN_VOL / Math.sqrt(DAYS_PER_YEAR);
    if (Math.random() < CRYPTO_NEWS_CHANCE) {
      const good = Math.random() < 0.5;
      cryptoSurprise += (good ? 1 : -1) * (0.04 + Math.random() * 0.06);
      add('CRYPTO', good ? 'up' : 'down', 'market', pick(CRYPTO_NEWS[good ? 'good' : 'bad']));
    }

    fillEmptyPlaces(st, add);

    for (const s of STOCKS) {
      const rt = st.stocks[s.id];
      if (rt.delisted || !rt.listed) continue;
      const coin = isCoin(s);
      const quarterDay = mod(day, DAYS_PER_QUARTER);

      // a stablecoin is pinned to the dollar: wobbles get pulled straight back, and now and then it slips
      if (s.stable) {
        let p = 1 + (rt.price - 1) * 0.5 + gauss() * 0.0008;
        if (Math.random() < 1 / 600) {
          p = 0.94 + Math.random() * 0.04;
          add(s.id, 'down', 'news', `${s.name} briefly slips below its dollar peg as nervous holders cash out`);
        }
        rt.price = roundPrice(Math.max(0.5, p));
        pushHistory(rt.history, rt.price);
        continue;
      }

      let move;
      if (coin) {
        const vol = rt.phase === 'ascended' && s.phase === 'rising' ? s.vol * ASCENDED_VOL : s.vol;
        const dailyVol = vol / Math.sqrt(DAYS_PER_YEAR);
        const ownVol = Math.sqrt(Math.max(0, dailyVol ** 2 - (s.beta * DAILY_CRYPTO_VOL) ** 2));
        move = s.growth / DAYS_PER_YEAR + s.beta * cryptoSurprise + ownVol * gauss();
      } else {
        const dailyVol = s.vol / Math.sqrt(DAYS_PER_YEAR);
        const cryptoBeta = s.cryptoBeta || 0;
        const ownVol = Math.sqrt(Math.max(0, dailyVol ** 2 - (s.beta * DAILY_MARKET_VOL) ** 2 - (cryptoBeta * DAILY_CRYPTO_VOL) ** 2));
        // profits grow slowly and partly follow the economy; in a boom or recession,
        // cyclical businesses' profits swing with it and defensive ones' hold up
        const tilt = phase ? phase.tilt * (CYCLICAL[s.sector] || 0) * CYCLE_TILT : 0;
        rt.eps *= Math.exp(s.growth / DAYS_PER_YEAR + s.beta * marketSurprise * 0.6 + tilt);
        const fairValue = rt.eps * s.pe;
        move = s.growth / DAYS_PER_YEAR
          + s.beta * marketSurprise
          + cryptoBeta * cryptoSurprise
          + ownVol * gauss()
          + tilt
          + REVERSION * Math.log(fairValue / rt.price);
      }

      if (!coin && !s.fund && quarterDay === rt.earningsDay) {
        const surprise = gauss();
        const jump = surprise * s.vol * 0.12;
        move += jump;
        rt.eps *= Math.exp(jump * 0.6);
        if (surprise > 0.4) add(s.id, 'up', 'earnings', `${s.name} beats quarterly earnings estimates`);
        else if (surprise < -0.4) add(s.id, 'down', 'earnings', `${s.name} misses quarterly earnings estimates`);
        else add(s.id, 'neutral', 'earnings', `${s.name} reports quarterly earnings in line with estimates`);
      }

      const lines = HEADLINES[s.sector];
      if (lines && Math.random() < COMPANY_NEWS_CHANCE) {
        const good = Math.random() < 0.5;
        const jump = (good ? 1 : -1) * (0.5 + Math.random()) * s.vol * 0.12;
        move += jump;
        if (!coin) rt.eps *= Math.exp(jump * 0.5);
        add(s.id, good ? 'up' : 'down', 'news', pick(lines[good ? 'good' : 'bad']).replace('{n}', s.name));
      }

      // a rising memecoin can catch fire: days of runaway buying, then it has ascended
      if (s.phase === 'rising') {
        if (rt.phase === 'rising' && Math.random() < ASCEND_CHANCE) {
          rt.phase = 'ascending';
          rt.ascendLeft = 6 + Math.floor(Math.random() * 9);
          rt.ascendRate = Math.log(ASCEND_MIN * (ASCEND_MAX / ASCEND_MIN) ** Math.random()) / rt.ascendLeft;
          rt.distress = false;
          add(s.id, 'up', 'news', `${s.name} is trending everywhere, and buyers are piling in`);
        }
        if (rt.phase === 'ascending') {
          move += rt.ascendRate;
          rt.ascendLeft -= 1;
          if (rt.ascendLeft <= 0) {
            rt.phase = 'ascended';
            delete rt.ascendLeft;
            delete rt.ascendRate;
            rt.spawnOn = day + NEW_MEME_AFTER[0] + Math.floor(Math.random() * (NEW_MEME_AFTER[1] - NEW_MEME_AFTER[0]));
            events.push({ day, ticker: s.id, mood: 'up', kind: 'ascend', text: `${s.name} has ascended. It now trades alongside the big memecoins`, held: rt.shares > 0 });
          }
        }
      }

      // the crowd moves on sooner or later: a slow bleed over a month or two, then it's gone
      if (graduated(s, rt)) {
        if (!rt.fadeLeft && Math.random() < FADE_CHANCE / DAYS_PER_YEAR) {
          rt.fadeLeft = FADE_DAYS[0] + Math.floor(Math.random() * (FADE_DAYS[1] - FADE_DAYS[0]));
          rt.fadeRate = Math.log(0.04) / rt.fadeLeft;
          add(s.id, 'down', 'news', `Interest in ${s.name} is drying up as traders chase newer coins`);
        }
        if (rt.fadeLeft) {
          move += rt.fadeRate;
          rt.fadeLeft -= 1;
          if (rt.fadeLeft <= 0) {
            fail(st, s, events, `${s.name} fades away. The crowd has moved on, exchanges drop it, and the coins are worthless.`);
            continue;
          }
        }
      }

      // the blow that can start a risky company's slide into failure
      const risk = RISK[graduated(s, rt) ? 4 : s.risk];
      // a recession tips more weak companies over the edge; a boom keeps more of them afloat
      const shockX = phase && !coin ? phase.shockX : 1;
      if (risk.shock && canFail(s, rt) && !rt.distress && Math.random() < (risk.shock * FAIL_RULES[s.market].shock * shockX) / DAYS_PER_YEAR) {
        const hit = 0.4 + Math.random() * 0.25;
        move += Math.log(1 - hit);
        if (!coin) rt.eps *= 1 - hit;
        rt.distress = true;
        const tail = coin ? 'Holders rush for the exits' : 'It warns it may not be able to pay its debts';
        add(s.id, 'down', 'news', `${pick(SHOCKS[s.sector] || SHOCKS.default).replace('{n}', s.name)}. ${tail}`);
      }

      rt.price = Math.max(coin ? 1e-10 : 0.5, rt.price * Math.exp(move));
      pushHistory(rt.history, rt.price);

      // a collapse can turn into outright failure, and the shares become worthless
      if (canFail(s, rt)) {
        const high = Math.max(...rt.history);
        const rules = FAIL_RULES[s.market];
        if (!rt.distress && rt.price < high * rules.distress) {
          rt.distress = true;
          add(s.id, 'down', 'news', coin ? `${s.name} has lost almost all its value, and holders are heading for the exits` : `${s.name} warns it may not be able to pay its debts`);
        } else if (rt.distress && rt.price > high * rules.recover) {
          rt.distress = false;
          add(s.id, 'up', 'news', coin ? `${s.name} bounces back from the brink` : `${s.name} steadies itself and calls off the alarm`);
        }
        if (rt.distress && Math.random() < DELIST_CHANCE) {
          fail(st, s, events, graduated(s, rt)
            ? `${s.name} fades away. The crowd has moved on, exchanges drop it, and the coins are worthless.`
            : coin ? `${s.name} collapses to nothing. Exchanges stop trading it and the coins are worthless.`
            : `${s.name} collapses. Trading is halted and the shares are worthless.`);
          continue;
        }
        // the makers of a young memecoin can simply walk off with the money
        if (s.rug && rt.phase === 'rising' && Math.random() < s.rug / DAYS_PER_YEAR) {
          fail(st, s, events, `The makers of ${s.name} pull the plug and vanish with the money. The coins are worthless.`, true);
          continue;
        }
        // the very riskiest can go without any warning at all
        if (!rt.distress && risk.sudden && Math.random() < risk.sudden / DAYS_PER_YEAR) {
          fail(st, s, events, coin
            ? `${s.name} collapses overnight as its backers' promises turn out to be empty. The coins are worthless.`
            : `${s.name} collapses overnight after its accounts turn out to be fiction. The shares are worthless.`);
          continue;
        }
      }

      if (s.divYield && quarterDay === mod(rt.earningsDay + 21, DAYS_PER_QUARTER)) {
        const perShare = (rt.price * s.divYield) / 4;
        const event = { day, ticker: s.id, mood: 'neutral', kind: 'dividend', text: `${s.name} pays a dividend of ${fmt(perShare)} per share` };
        if (rt.shares > 0) {
          event.paid = perShare * rt.shares;
          event.shares = rt.shares;
          st.cash += event.paid;
          rt.dividends += event.paid;
          st.totalDividends += event.paid;
        }
        events.push(event);
      }
    }

    // The player's own equity curve, kept beside the market's so the two can be
    // compared later. There is nothing worth recording before day one.
    if (st.day >= 0) {
      let worth = st.cash;
      for (const s of STOCKS) worth += st.stocks[s.id].shares * st.stocks[s.id].price;
      pushHistory(st.worth.history, worth);
      if (gameReady) updateDailyStats();
    }
    return events;
  }

  // Moves the business cycle on by a day, starting or ending a boom or recession
  // now and then. Returns the cycle today belongs to, or null in ordinary times.
  // The practice year before day one stays ordinary.
  function stepCycle(st, events) {
    const day = st.day;
    if (st.cycle) {
      st.cycle.left -= 1;
      if (st.cycle.left > 0) return st.cycle;
      const phase = CYCLES[st.cycle.kind];
      events.push({ day, ticker: 'MKT', mood: phase.endMood, kind: 'market', cycle: 'end', cycleKind: st.cycle.kind, text: phase.end });
      st.cycle = null;
      st.cycleQuietUntil = day + CYCLE_GAP;
      return null;
    }
    if (day < 0 || day < (st.cycleQuietUntil || 0) || Math.random() >= CYCLE_CHANCE) return null;
    const kind = Math.random() < 0.5 ? 'recession' : 'boom';
    const phase = CYCLES[kind];
    const days = phase.days[0] + Math.floor(Math.random() * (phase.days[1] - phase.days[0]));
    st.cycle = { kind, days, left: days, startDay: day };
    events.push({ day, ticker: 'MKT', mood: kind === 'boom' ? 'up' : 'down', kind: 'market', cycle: 'start', cycleKind: kind, text: phase.start });
    return st.cycle;
  }

  function fail(st, s, events, text, rug = false) {
    const rt = st.stocks[s.id];
    rt.delisted = true;
    rt.distress = false;
    rt.relistOn = st.day + RELIST_AFTER[0] + Math.floor(Math.random() * (RELIST_AFTER[1] - RELIST_AFTER[0]));
    const lost = rt.shares;
    if (lost > 0) {
      rt.realized -= rt.costBasis;
      rt.shares = 0;
      rt.costBasis = 0;
    }
    const event = { day: st.day, ticker: s.id, mood: 'down', kind: 'news', text };
    if (lost > 0) event.wiped = lost;
    if (rug) event.rug = true;
    events.push(event);
  }

  // A few weeks after a failure, something new lists in the same market and
  // takes the empty place, from the same account tier if one is waiting. A
  // memecoin that ascends makes room for a new one too. Once nothing is left
  // waiting, the place stays empty.
  function fillEmptyPlaces(st, add) {
    for (const s of STOCKS) {
      const rt = st.stocks[s.id];
      const failed = rt.delisted && !rt.retired && rt.relistOn != null && st.day >= rt.relistOn;
      const spawned = rt.spawnOn != null && st.day >= rt.spawnOn;
      if (!failed && !spawned) continue;
      if (failed) rt.relistOn = null;
      else rt.spawnOn = null;
      // a memecoin that ascended and later faded made room for a new one the day it ascended
      if (failed && graduated(s, rt)) {
        rt.retired = true;
        continue;
      }
      const waiting = STOCKS.filter(c => c.later && c.market === s.market && !st.stocks[c.id].listed);
      const next = waiting.find(c => c.tier === s.tier) || waiting[0];
      if (next) {
        const nt = st.stocks[next.id];
        inventHistory(nt, next, next.market === 'meme' ? 20 : DAYS_PER_YEAR);
        nt.listed = true;
        if (failed) rt.retired = true;
        add(next.id, 'up', 'listing',
          next.market === 'meme' ? `${next.name} launches, hoping to be the next ${s.name}`
            : next.market === 'crypto' ? `${next.name} starts trading, taking the place ${s.name} left behind`
            : `${next.name} lists on the exchange, taking the place ${s.name} left behind`);
        continue;
      }
      if (s.market === 'meme') relaunchMeme(st, s, rt, failed, add);
    }
  }

  // New memecoins never stop coming. Once every name has had its turn, a coin
  // that died a while ago comes back under a new team, at a new price.
  function relaunchMeme(st, s, rt, failed, add) {
    const gone = STOCKS.filter(c => c.phase === 'rising' && c.id !== s.id && st.stocks[c.id].retired);
    const next = gone.find(c => c.tier === s.tier) || gone[0];
    if (!next) {
      // nothing free yet: try again in a few weeks
      if (failed) rt.relistOn = st.day + RELIST_AFTER[0];
      else rt.spawnOn = st.day + RELIST_AFTER[0];
      return;
    }
    const old = st.stocks[next.id];
    const nt = blankStock(next, STOCKS.indexOf(next));
    nt.realized = old.realized; // what you made or lost on it the first time still counts
    inventHistory(nt, next, 20, next.start * Math.exp(gauss() * 0.8));
    nt.listed = true;
    st.stocks[next.id] = nt;
    if (failed) rt.retired = true;
    add(next.id, 'up', 'listing', `A new team relaunches ${next.name}, and traders pile back in`);
  }

  // ===========================================================
  // STATE + SAVING
  // ===========================================================
  function blankStock(s, index) {
    return {
      ...(s.phase ? { phase: s.phase } : {}),
      price: s.start,
      eps: s.pe ? s.start / s.pe : 0,
      history: [],
      shares: 0,
      costBasis: 0,
      realized: 0,
      dividends: 0,
      distress: false,
      delisted: false,
      listed: !s.later,
      firstBuyDay: null,
      riskStreak: 0,
      earningsDay: (index * 7 + 20) % DAYS_PER_QUARTER,
    };
  }

  // A company added to the game after a save was made needs some history of
  // its own, so its chart isn't empty when it appears.
  function inventHistory(rt, s, days = DAYS_PER_YEAR, end = s.start) {
    const walk = [];
    let price = end;
    for (let i = 0; i < days; i++) {
      price *= Math.exp(s.growth / DAYS_PER_YEAR + (s.vol / Math.sqrt(DAYS_PER_YEAR)) * gauss());
      walk.push(price);
    }
    const scale = end / price; // finish at today's listed price
    rt.history = walk.map(v => roundPrice(v * scale));
    rt.price = rt.history[rt.history.length - 1];
  }

  // A new face for a role, avoiding names and quirks already in the office.
  function newHire(st, roleId) {
    const taken = new Set(st.roster.map(p => p.name));
    let name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    for (let i = 0; i < 20 && taken.has(name); i++) name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const used = new Set(st.roster.filter(p => p.role === roleId).map(p => p.trait));
    const fresh = TRAITS[roleId].filter(t => !used.has(t));
    return { role: roleId, name, trait: pick(fresh.length ? fresh : TRAITS[roleId]) };
  }

  // Keeps the named roster in step with the headcounts, which are what the
  // money is worked out from.
  function syncRoster(st) {
    if (!Array.isArray(st.roster)) st.roster = [];
    st.roster = st.roster.filter(p => p && STAFF_BY_ID[p.role] && typeof p.name === 'string' && typeof p.trait === 'string');
    for (const role of STAFF) {
      let have = st.roster.filter(p => p.role === role.id).length;
      while (have < st.staff[role.id]) { st.roster.push(newHire(st, role.id)); have++; }
      while (have > st.staff[role.id]) {
        st.roster.splice(st.roster.map(p => p.role).lastIndexOf(role.id), 1);
        have--;
      }
    }
  }

  function freshState() {
    const st = {
      version: 3,
      day: -DAYS_PER_YEAR,
      cash: STARTING_CASH,
      xp: 0,
      level: 1,
      tier: 0,
      accountOpen: false,
      speed: 1,
      staff: Object.fromEntries(STAFF.map(s => [s.id, 0])),
      roster: [],
      achieved: {},
      stats: {
        trades: 0,
        bestSaleProfit: 0,
        longestHoldDays: 0,
        sameDayFlip: false,
        boughtBigDip: false,
        soldWhileDistressed: false,
        wasBurned: false,
        contrarianBuy: false,
        wasPoor: false,
        firstHireDay: null,
        lastLayoffDay: null,
        negIncomeStreak: 0,
        concentrationStreak: 0,
        peakNetWorth: 0,
        burnRecoveryTarget: null,
        boughtCrypto: false,
        memeTenBagger: false,
      },
      totalDividends: 0,
      totalFees: 0,
      market: { level: 1000, history: [] },
      cycle: null,          // the boom or recession under way, if any
      cycleQuietUntil: 0,
      worth: { history: [] },
      stocks: {},
      news: [],
      lastSeen: Date.now(),
    };
    STOCKS.forEach((s, i) => { st.stocks[s.id] = blankStock(s, i); });
    // Play one quiet year so every chart has real history on day one.
    for (let i = 0; i < DAYS_PER_YEAR; i++) simulateDay(st);
    st.news = [{ day: st.day, ticker: 'MKT', mood: 'neutral', kind: 'market', text: 'Markets are open. Welcome to your trading desk.' }];
    return st;
  }

  // Brings a save written by an older build up to date, in place. Returns null
  // if the thing handed to it isn't a SimStock save at all, which is what makes
  // it safe to run over a file someone picked off their own disk.
  function migrate(saved) {
    if (!saved || typeof saved !== 'object') return null;
    if (saved.version !== 2 && saved.version !== 3) return null;
    if (!saved.stocks || typeof saved.cash !== 'number' || typeof saved.day !== 'number') return null;

    // version 3 added the equity curve, commission and the speed control
    if (!saved.worth || !Array.isArray(saved.worth.history)) saved.worth = { history: [] };
    if (typeof saved.totalFees !== 'number') saved.totalFees = 0;
    if (!SPEEDS.includes(saved.speed)) saved.speed = 1;
    saved.version = 3;

    // booms and recessions arrived later
    if (!saved.cycle || !CYCLES[saved.cycle.kind] || !(saved.cycle.left > 0) || !(saved.cycle.days > 0)) saved.cycle = null;
    if (typeof saved.cycleQuietUntil !== 'number') saved.cycleQuietUntil = 0;

    // achievements arrived later; every save gets the tracking fields
    if (!saved.achieved || typeof saved.achieved !== 'object') saved.achieved = {};
    const statDefaults = {
      trades: 0, bestSaleProfit: 0, longestHoldDays: 0, sameDayFlip: false, boughtBigDip: false,
      soldWhileDistressed: false, wasBurned: false, contrarianBuy: false, wasPoor: false,
      firstHireDay: null, lastLayoffDay: null, negIncomeStreak: 0, concentrationStreak: 0,
      peakNetWorth: 0, burnRecoveryTarget: null, boughtCrypto: false, memeTenBagger: false,
    };
    if (!saved.stats || typeof saved.stats !== 'object') saved.stats = {};
    Object.entries(statDefaults).forEach(([k, v]) => { if (saved.stats[k] === undefined) saved.stats[k] = v; });

    // staff gained names later on; anyone already hired gets one now
    if (!saved.staff || typeof saved.staff !== 'object') saved.staff = {};
    STAFF.forEach(s => { if (!Number.isInteger(saved.staff[s.id]) || saved.staff[s.id] < 0) saved.staff[s.id] = 0; });
    syncRoster(saved);

    // every company took a parody name: holdings move to the new ticker as they stand,
    // with profits reset so fair value is today's price and nothing lurches
    for (const [oldId, newId] of Object.entries(RENAMED)) {
      const rt = saved.stocks[oldId];
      if (!rt) continue;
      delete saved.stocks[oldId];
      if (saved.stocks[newId]) continue;
      rt.eps = rt.price / STOCK_BY_ID[newId].pe;
      saved.stocks[newId] = rt;
    }
    // headlines under the old names would no longer match anything on the board
    if (Array.isArray(saved.news)) saved.news = saved.news.filter(n => n && (MARKET_TICKERS[n.ticker] || STOCK_BY_ID[n.ticker]));
    else saved.news = [];

    // companies and coins added since this save was written join the board today
    STOCKS.forEach((s, i) => {
      const old = saved.stocks[s.id];
      if (old) {
        if (old.listed === undefined) old.listed = true;
        // failures from before new companies could replace them
        if (old.delisted && !old.retired && old.relistOn === undefined) old.relistOn = saved.day + RELIST_AFTER[0];
        if (old.firstBuyDay === undefined) old.firstBuyDay = null;
        if (old.riskStreak === undefined) old.riskStreak = 0;
        return;
      }
      const rt = blankStock(s, i);
      if (!s.later) inventHistory(rt, s);
      saved.stocks[s.id] = rt;
    });
    return saved;
  }

  function loadState() {
    try {
      const raw = desktop ? desktop.readSave() : (localStorage.getItem(SAVE_KEY) || localStorage.getItem(OLD_SAVE_KEY));
      const saved = migrate(JSON.parse(raw));
      if (saved) return saved;
    } catch (e) { /* storage blocked or save unreadable: start fresh */ }
    return freshState();
  }

  // Set when a save conflict has been settled by taking the other machine's
  // game. The page is about to reload onto it, and anything this one writes on
  // the way out — the tick, pagehide, visibilitychange — would land on top of
  // the save that was just restored and undo the choice.
  let savingStopped = false;

  function saveState() {
    if (savingStopped) return;
    state.lastSeen = Date.now();
    const json = JSON.stringify(state);
    if (desktop) return void desktop.writeSave(json);
    try {
      localStorage.setItem(SAVE_KEY, json);
      localStorage.removeItem(OLD_SAVE_KEY);
    } catch (e) { /* storage unavailable */ }
  }

  // `state` isn't assigned until loadState() returns, but loadState() can call
  // simulateDay() on a state object of its own while priming a fresh save.
  // This flag exists purely so that inner code can tell the two apart without
  // touching `state` itself before it's ready, which would throw.
  let gameReady = false;
  let state = loadState();
  gameReady = true;
  const defaultPicks = () => Object.fromEntries(Object.entries(MARKETS).map(([m, v]) => [m, v.pick]));
  // `selected` is the asset open on whichever trading room is showing; `picks`
  // remembers the last one opened in each room.
  const ui = { screen: 'landing', market: 'stock', selected: MARKETS.stock.pick, picks: defaultPicks(), range: 63, side: 'buy', staffFocus: {} };
  let tickCount = 0;
  let lastTickAt = Date.now();
  let lastRunningSpeed = SPEEDS.includes(state.speed) && state.speed > 0 ? state.speed : 1;
  let booted = false;
  let tipIndex = 0;
  let lastTip = '';
  let renderedNewsKey = '';
  let chartHover = null;

  // ===========================================================
  // DERIVED NUMBERS
  // ===========================================================
  const rtOf = id => state.stocks[id];
  const isUnlocked = s => state.tier >= s.tier;
  // on the board: listed at some point, and not yet replaced after failing
  const onBoard = s => rtOf(s.id).listed && !rtOf(s.id).retired;
  const trading = s => onBoard(s) && !rtOf(s.id).delisted;
  const boardStocks = () => STOCKS.filter(onBoard).sort((a, b) => a.tier - b.tier);
  const boardKey = () => boardStocks().map(s => s.id).join();
  // an ascended memecoin can no longer be rugged, so it rates a notch safer
  const riskOf = s => (ascendedNow(s, rtOf(s.id)) ? 4 : s.risk);
  const riskPips = s => `<span class="risk-pips risk-${riskOf(s)}" title="Risk ${riskOf(s)} of 5: ${RISK[riskOf(s)].label}">${'<i></i>'.repeat(5)}</span>`;
  const onTradeFloor = () => ui.screen in MARKET_OF_SCREEN;
  const MEME_PHASES = {
    rising: { group: 'About to ascend', label: 'About to ascend' },
    ascending: { group: 'About to ascend', label: 'Ascending now' },
    ascended: { group: 'Already ascended', label: 'Ascended' },
  };
  const avgCost = rt => (rt.shares ? rt.costBasis / rt.shares : 0);

  // What the broker charges to put a trade through, rounded to the cent.
  const commission = value => Math.round(Math.max(COMMISSION_MIN, value * COMMISSION_RATE) * 100) / 100;
  const staffCost = s => s.baseCost * Math.pow(s.growth, state.staff[s.id]);
  const staffSalaries = () => STAFF.reduce((sum, s) => sum + state.staff[s.id] * s.salary, 0);

  // Clients pay more when markets have been kind and pull back when they have not.
  // Salaries do not care either way, which is what makes a bad quarter hurt.
  function clientMood() {
    const h = state.market.history;
    if (h.length < 2) return 1;
    const past = h[Math.max(0, h.length - DAYS_PER_QUARTER)];
    const quarterReturn = h[h.length - 1] / past - 1;
    return Math.max(0.3, Math.min(1.5, 1 + quarterReturn * 2.5));
  }

  const staffFees = () => STAFF.reduce((sum, s) => sum + state.staff[s.id] * s.income, 0) * clientMood();
  const staffIncome = () => staffFees() - staffSalaries();
  const staffCount = () => STAFF.reduce((sum, s) => sum + state.staff[s.id], 0);
  const holdingsValue = () => STOCKS.reduce((sum, s) => sum + rtOf(s.id).shares * rtOf(s.id).price, 0);
  const netWorth = () => state.cash + holdingsValue();

  function prevClose(list) {
    return list.length > 1 ? list[list.length - 2] : list[list.length - 1];
  }
  function dayChangePct(list) {
    return (list[list.length - 1] / prevClose(list) - 1) * 100;
  }

  // History holds at most a year of closes, so all of it is the 52-week window.
  function yearStats(list) {
    const last = list.length - 1;
    let lo = 0, hi = 0, peak = list[0], worst = 0, moves = 0;
    for (let i = 0; i <= last; i++) {
      const p = list[i];
      if (p <= list[lo]) lo = i;
      if (p >= list[hi]) hi = i;
      if (p > peak) peak = p;
      worst = Math.min(worst, p / peak - 1);
      if (i > 0) moves += Math.abs(p / list[i - 1] - 1);
    }
    return {
      fullYear: list.length >= DAYS_PER_YEAR,
      days: list.length,
      low: list[lo], lowAgo: last - lo,
      high: list[hi], highAgo: last - hi,
      returnPct: (list[last] / list[0] - 1) * 100,
      worstPct: worst * 100,
      typicalDayPct: last ? (moves / last) * 100 : 0,
    };
  }
  const daysAgo = n => (n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

  function tierReady(i) {
    const t = TIERS[i];
    return !!t && i === state.tier + 1 && state.level >= t.level && state.cash >= t.cost;
  }

  function clockLabel() {
    const d = Math.max(0, state.day);
    const year = Math.floor(d / DAYS_PER_YEAR) + 1;
    const quarter = Math.floor(mod(d, DAYS_PER_YEAR) / DAYS_PER_QUARTER) + 1;
    return `Year ${year} · Q${Math.min(quarter, 4)} · Day ${d + 1}`;
  }

  // ===========================================================
  // TOASTS + MODALS
  // ===========================================================
  function toast(title, body = '', kind = '') {
    const node = el(`<div class="toast ${kind}"><div class="toast-title">${title}</div>${body ? `<div class="toast-body">${body}</div>` : ''}</div>`);
    const box = $('toasts');
    box.appendChild(node);
    while (box.children.length > 4) box.firstElementChild.remove();
    setTimeout(() => {
      node.classList.add('out');
      setTimeout(() => node.remove(), 300);
    }, 4200);
  }

  // ===========================================================
  // SOUND + CONFETTI
  // Every sound is synthesised on the spot, so there are no audio files to
  // load. Whether it's on is a setting for this browser, not part of the save.
  // ===========================================================
  const SOUND_KEY = 'simstock.sound';
  let soundOn = true;
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off'; } catch (e) { /* storage blocked */ }
  let audio = null;
  const lastPlayed = {};

  function setSound(on) {
    soundOn = on;
    try { localStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
  }

  // one note: a pitch that rings and fades
  function note(freq, at, length, { type = 'sine', gain = 0.12, slideTo = null } = {}) {
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    const t = audio.currentTime + at;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + length);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(audio.destination);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  // a short burst of noise: the drawer of a cash register sliding out
  function rattle(at, length, gain = 0.08) {
    const frames = Math.floor(audio.sampleRate * length);
    const buffer = audio.createBuffer(1, frames, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const amp = audio.createGain();
    src.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.value = 2400;
    amp.gain.value = gain;
    src.connect(filter).connect(amp).connect(audio.destination);
    src.start(audio.currentTime + at);
  }

  const SOUNDS = {
    buy: () => { note(880, 0, 0.08, { type: 'triangle', gain: 0.07 }); note(1320, 0.05, 0.1, { type: 'triangle', gain: 0.05 }); },
    cash: () => { rattle(0, 0.09); note(2093, 0.08, 0.5, { gain: 0.1 }); note(2637, 0.1, 0.6, { gain: 0.07 }); },
    loss: () => { note(392, 0, 0.18, { type: 'triangle', gain: 0.08, slideTo: 294 }); },
    coin: () => { note(1568, 0, 0.12, { gain: 0.06 }); note(2349, 0.06, 0.25, { gain: 0.05 }); },
    hire: () => { [523, 659, 784].forEach((f, i) => note(f, i * 0.07, 0.25, { type: 'triangle', gain: 0.08 })); },
    level: () => { [784, 988, 1175, 1568].forEach((f, i) => note(f, i * 0.06, 0.9, { gain: 0.07 })); },
    tier: () => {
      [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.11, 0.35, { type: 'triangle', gain: 0.09 }));
      [1047, 1319, 1568].forEach(f => note(f, 0.46, 1.2, { gain: 0.06 }));
    },
    fail: () => { note(147, 0, 0.6, { type: 'sawtooth', gain: 0.05, slideTo: 73 }); note(110, 0.05, 0.7, { gain: 0.12, slideTo: 55 }); },
    achieve: () => {
      [659, 880, 1109].forEach((f, i) => note(f, i * 0.08, 0.3, { type: 'triangle', gain: 0.09 }));
      note(1319, 0.28, 0.5, { gain: 0.07 });
    },
  };

  // `gap` keeps a sound from stacking up when the market runs fast
  function playSound(name, gap = 0) {
    if (!soundOn || !booted) return;
    const now = Date.now();
    if (gap && now - (lastPlayed[name] || 0) < gap) return;
    lastPlayed[name] = now;
    try {
      getAudio();
      SOUNDS[name]();
    } catch (e) { /* no audio in this browser */ }
  }

  function getAudio() {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    return audio;
  }

  // Background music: a little swing tune in F for a synthesised trio (walking
  // bass, piano chords, brushed ride). A vibraphone plays the melody on every
  // other chorus and noodles around the chords on the rest.
  const MUSIC_KEY = 'simstock.music';
  let musicOn = true;
  try { musicOn = localStorage.getItem(MUSIC_KEY) !== 'off'; } catch (e) { /* storage blocked */ }
  const VOLUME_KEY = 'simstock.musicVolume';
  let musicVolume = 60;
  try {
    const saved = parseInt(localStorage.getItem(VOLUME_KEY), 10);
    if (saved >= 0 && saved <= 100) musicVolume = saved;
  } catch (e) { /* storage blocked */ }
  // squared so the slider feels even to the ear; 60% matches the original level
  const musicGain = () => Math.max(0.0001, (musicVolume / 100) ** 2 * 1.4);
  const BEAT = 0.5; // 120 bpm
  const SWUNG = BEAT * 2 / 3; // where a swung off-beat lands
  const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);
  // eight bars: F6  D9  Gm9  C13  Am7  D9  Gm9  C13
  const TUNE = {
    chords: [[57, 60, 64, 67], [54, 60, 64, 69], [58, 62, 65, 69], [58, 62, 64, 69],
             [55, 60, 64, 71], [54, 60, 64, 69], [58, 62, 65, 69], [58, 62, 64, 69]],
    bass: [[41, 45, 48, 49], [50, 42, 45, 44], [43, 45, 46, 47], [48, 43, 40, 44],
           [45, 43, 40, 39], [38, 42, 45, 44], [43, 46, 50, 49], [48, 46, 43, 40]],
    // [eighth note in the bar, pitch, length in eighths]
    melody: [
      [[0, 72, 1], [1, 74, 1], [2, 76, 1], [3, 77, 1], [4, 79, 3]],
      [[1, 78, 1], [2, 79, 1], [3, 78, 1], [4, 74, 2], [6, 72, 2]],
      [[0, 70, 1], [1, 74, 1], [2, 77, 1], [3, 81, 1], [4, 79, 3]],
      [[0, 76, 2], [2, 74, 1], [3, 72, 1], [4, 70, 2], [6, 67, 2]],
      [[0, 69, 1], [1, 72, 1], [2, 76, 2], [5, 74, 1], [6, 72, 2]],
      [[0, 78, 1], [1, 76, 1], [2, 74, 1], [3, 72, 1], [4, 69, 3]],
      [[0, 70, 1], [1, 74, 1], [2, 77, 2], [4, 76, 1], [5, 74, 1], [6, 72, 1]],
      [[0, 70, 2], [2, 69, 1], [3, 67, 1], [4, 64, 2]],
    ],
  };
  const music = { bus: null, timer: null, next: 0, beat: 0, noise: null };

  function setMusic(on) {
    musicOn = on;
    try { localStorage.setItem(MUSIC_KEY, on ? 'on' : 'off'); } catch (e) { /* storage blocked */ }
    if (on) startMusic();
    else stopMusic();
  }

  function pluck(m, t, length, gain, type = 'sine') {
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    osc.type = type;
    osc.frequency.value = midiHz(m);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(amp).connect(music.bus);
    osc.start(t);
    osc.stop(t + length + 0.02);
  }

  function brush(t, gain, length, pitch) {
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const amp = audio.createGain();
    src.buffer = music.noise;
    filter.type = 'highpass';
    filter.frequency.value = pitch;
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter).connect(amp).connect(music.bus);
    src.start(t);
    src.stop(t + length);
  }

  function playBeat(i, t) {
    const bar = Math.floor(i / 4) % 8, beat = i % 4, chorus = Math.floor(i / 32);
    const chord = TUNE.chords[bar];
    pluck(TUNE.bass[bar][beat], t, BEAT * 0.95, 0.22, 'triangle');
    brush(t, 0.04, 0.35, 7000);
    if (beat % 2) {
      brush(t, 0.03, 0.05, 3500);
      brush(t + SWUNG, 0.03, 0.2, 7000);
    }
    if (beat === 0) chord.forEach(m => pluck(m, t, BEAT * 0.6, 0.03));
    if (beat === 1) chord.forEach(m => pluck(m, t + SWUNG, BEAT * 1.2, 0.025));
    if (chorus % 2 === 0) {
      TUNE.melody[bar]
        .filter(([pos]) => Math.floor(pos / 2) === beat)
        .forEach(([pos, m, len]) => pluck(m, t + (pos % 2 ? SWUNG : 0), len * BEAT / 2 + 0.25, 0.06));
    } else if (Math.random() < 0.4) {
      const m = chord[Math.floor(Math.random() * chord.length)] + 12;
      pluck(m, t + (Math.random() < 0.5 ? 0 : SWUNG), 0.4, 0.045);
    }
  }

  // Browsers only allow sound after a click or key press, so this is also
  // called on every one of those and does nothing once the music is going.
  function startMusic() {
    if (!musicOn || !booted || music.timer || document.hidden) return;
    try {
      getAudio();
      if (!music.noise) {
        music.noise = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
        const data = music.noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      }
      music.bus = audio.createGain();
      music.bus.gain.setValueAtTime(0.0001, audio.currentTime);
      music.bus.gain.exponentialRampToValueAtTime(musicGain(), audio.currentTime + 2);
      music.bus.connect(audio.destination);
      music.next = audio.currentTime + 0.1;
      music.timer = setInterval(() => {
        while (music.next < audio.currentTime + 0.3) {
          playBeat(music.beat++, music.next);
          music.next += BEAT;
        }
      }, 100);
    } catch (e) { /* no audio in this browser */ }
  }

  function setMusicVolume(v) {
    musicVolume = v;
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch (e) { /* storage blocked */ }
    if (!music.timer) return;
    const g = music.bus.gain;
    g.cancelScheduledValues(audio.currentTime);
    g.setValueAtTime(g.value, audio.currentTime);
    g.linearRampToValueAtTime(musicGain(), audio.currentTime + 0.1);
  }

  function stopMusic() {
    if (!music.timer) return;
    clearInterval(music.timer);
    music.timer = null;
    const bus = music.bus;
    bus.gain.cancelScheduledValues(audio.currentTime);
    bus.gain.setValueAtTime(bus.gain.value, audio.currentTime);
    bus.gain.linearRampToValueAtTime(0, audio.currentTime + 0.4);
    setTimeout(() => bus.disconnect(), 500);
  }

  document.addEventListener('pointerdown', startMusic);
  document.addEventListener('keydown', startMusic);
  document.addEventListener('visibilitychange', () => (document.hidden ? stopMusic() : startMusic()));

  const calm = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Paper confetti in the given colours, falling over everything for a few seconds.
  function confetti(count, colours) {
    if (calm()) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    canvas.setAttribute('aria-hidden', 'true');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    const bits = Array.from({ length: count }, () => ({
      x: w / 2 + (Math.random() - 0.5) * w * 0.3,
      y: h * 0.4,
      vx: (Math.random() - 0.5) * 18,
      vy: -8 - Math.random() * 11,
      spin: (Math.random() - 0.5) * 0.4,
      angle: Math.random() * Math.PI,
      size: 8 + Math.random() * 7,
      colour: pick(colours),
    }));
    const started = performance.now();
    (function frame(t) {
      const age = (t - started) / 1000;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.max(0, Math.min(1, 3.2 - age));
      for (const b of bits) {
        b.vy += 0.35;
        b.vx *= 0.985;
        b.x += b.vx;
        b.y += b.vy;
        b.angle += b.spin;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        ctx.scale(1, Math.cos(b.angle * 2)); // tumbling paper shows its edge
        ctx.fillStyle = b.colour;
        ctx.fillRect(-b.size / 2, -b.size / 4, b.size, b.size / 2);
        ctx.restore();
      }
      if (age < 3.2) requestAnimationFrame(frame);
      else canvas.remove();
    })(started);
  }

  const modalRoot = $('modalRoot');
  let returnFocusTo = null;
  const modalQueue = [];

  // Opens a modal, or swaps the content of the one already open.
  function openModal(html) {
    let modal = modalRoot.querySelector('.modal');
    if (!modal) {
      returnFocusTo = document.activeElement;
      modalRoot.innerHTML = '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle"></div></div>';
      modal = modalRoot.querySelector('.modal');
    }
    modal.innerHTML = html;
    const heading = modal.querySelector('h3');
    if (heading) heading.id = 'modalTitle';
    const focusTarget = modal.querySelector('.btn-ink, .btn');
    if (focusTarget) focusTarget.focus();
    return modal;
  }

  function closeModal() {
    modalRoot.innerHTML = '';
    const next = modalQueue.shift();
    if (next) return next();
    // whatever opened the modal gets the keyboard back
    if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus();
    returnFocusTo = null;
  }

  // Shows a modal now, or after the one currently open is closed.
  function queueModal(show) {
    if (modalRoot.firstElementChild) modalQueue.push(show);
    else show();
  }

  function showLessons(step = 0) {
    const lesson = LESSONS[step];
    const last = step === LESSONS.length - 1;
    const opening = !state.accountOpen;
    const modal = openModal(`
      <div class="modal-kicker">The basics, part ${step + 1} of ${LESSONS.length}</div>
      <h3>${lesson.title}</h3>
      <p>${lesson.text}</p>
      ${last && opening ? '<p class="fine-print">Company and coin names in SimStock are parodies, and every price is simulated. No real money is involved.</p>' : ''}
      <div class="modal-actions">
        <div class="steps">${LESSONS.map((_, i) => `<span class="step${i <= step ? ' active' : ''}"></span>`).join('')}</div>
        <span class="spacer"></span>
        <button class="btn btn-ghost" data-act="back">${step > 0 ? 'Back' : opening ? 'Not now' : 'Close'}</button>
        <button class="btn btn-ink" data-act="next">${!last ? 'Next' : opening ? 'Open my account' : 'Done'}</button>
      </div>`);

    modal.querySelector('[data-act="next"]').onclick = () => {
      if (!last) return showLessons(step + 1);
      closeModal();
      if (opening) openAccount();
    };
    modal.querySelector('[data-act="back"]').onclick = () => (step > 0 ? showLessons(step - 1) : closeModal());
  }

  function showLevelUp(level, bonus) {
    const next = TIERS[state.tier + 1];
    const tierNote = next && state.level >= next.level
      ? `<p>You now meet the level requirement for a <b>${next.name}</b> account.</p>`
      : '';
    const modal = openModal(`
      <div class="modal-kicker">Milestone</div>
      <h3>You've reached level ${level}</h3>
      <p>A bonus has been paid into your account.</p>
      <div class="reward">+${fmt(bonus)}</div>
      ${tierNote}
      <div class="modal-actions"><button class="btn btn-ink" data-act="ok">Continue</button></div>`);
    modal.querySelector('[data-act="ok"]').onclick = closeModal;
  }

  function formatDuration(sec) {
    const m = Math.floor(sec / 60);
    if (m < 60) return `${Math.max(1, m)} minute${m === 1 ? '' : 's'}`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function checkOfflineEarnings() {
    const away = Math.min(OFFLINE_CAP_SEC, (Date.now() - state.lastSeen) / 1000);
    const days = Math.floor(away);
    const change = days * staffIncome();
    if (away < 30 || staffCount() === 0 || Math.abs(change) < 0.005) return;
    runPayroll(days);
    saveState();
    const gained = change > 0;
    queueModal(() => {
      const modal = openModal(`
        <div class="modal-kicker">Welcome back</div>
        <h3>${gained ? 'Your staff kept working' : 'The wages kept coming out'}</h3>
        <p>You were away for ${formatDuration(away)}. The market stayed closed${away >= OFFLINE_CAP_SEC ? ', and your desk runs for at most two hours unattended' : ''}. ${gained ? 'Fees came in faster than wages went out.' : 'Client fees did not cover the wages while the market was down.'}</p>
        <div class="reward${gained ? '' : ' reward-loss'}">${fmtSigned(change)}</div>
        <div class="modal-actions"><button class="btn btn-ink" data-act="ok">Collect</button></div>`);
      modal.querySelector('[data-act="ok"]').onclick = () => {
        closeModal();
        render();
      };
    });
  }

  function showTierUnlocked(i) {
    const tier = TIERS[i];
    const stocks = boardStocks().filter(s => s.tier === i && trading(s));
    const staff = STAFF.filter(s => s.tier === i);
    const companies = stocks.filter(s => !isCoin(s)).length;
    const coins = stocks.length - companies;
    const what = [companies && `${companies} more ${companies === 1 ? 'company' : 'companies'}`, coins && `${coins} more ${coins === 1 ? 'coin' : 'coins'}`].filter(Boolean).join(' and ');
    const modal = openModal(`
      <div class="modal-kicker">Account upgraded</div>
      <h3>Welcome to ${tier.name}</h3>
      <p>You can now trade ${what}:</p>
      <ul class="new-stocks">
        ${stocks.map(s => `<li>${tkr(s)}<span>${s.name}</span><span class="muted">${RISK[riskOf(s)].label}</span></li>`).join('')}
      </ul>
      ${staff.length ? `<p>You can also hire a new role: ${staff.map(s => s.name).join(', ')}.</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="close">Close</button>
        <button class="btn btn-ink" data-act="trade">Start trading</button>
      </div>`);
    modal.querySelector('[data-act="close"]').onclick = closeModal;
    modal.querySelector('[data-act="trade"]').onclick = () => {
      closeModal();
      if (stocks.length) openAsset(stocks[0].id);
      else showScreen('trade');
    };
  }

  function showSettings() {
    const modal = openModal(`
      <div class="modal-kicker">Settings</div>
      <h3>Your game</h3>
      <p>Level ${state.level} · ${TIERS[state.tier].name} account · Net worth ${fmt(netWorth())}</p>
      <div class="settings-list">
        <button class="btn btn-ghost btn-block" data-act="sound" aria-pressed="${soundOn}">Sound effects: ${soundOn ? 'on' : 'off'}</button>
        <button class="btn btn-ghost btn-block" data-act="music" aria-pressed="${musicOn}">Music: ${musicOn ? 'on' : 'off'}</button>
        <label class="volume-row">
          <span>Music volume</span>
          <input type="range" min="0" max="100" step="5" value="${musicVolume}" data-act="volume" aria-valuetext="${musicVolume}%">
          <output>${musicVolume}%</output>
        </label>
        <button class="btn btn-ghost btn-block" data-act="basics">Replay investing basics</button>
        <button class="btn btn-ghost btn-block" data-act="export">Save to a file</button>
        <button class="btn btn-ghost btn-block" data-act="import">Load a file</button>
        <button class="btn btn-danger btn-block" data-act="reset">Reset all progress</button>
      </div>
      <p class="fine-print">Your game normally lives in this browser alone. Saving it to a file is how you move it to another browser or device, or keep it safe from a clearing of your browsing data.</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-act="close">Close</button></div>`);

    let confirming = false;
    modal.querySelector('[data-act="sound"]').onclick = e => {
      setSound(!soundOn);
      e.currentTarget.textContent = `Sound effects: ${soundOn ? 'on' : 'off'}`;
      e.currentTarget.setAttribute('aria-pressed', soundOn);
      playSound('coin');
    };
    modal.querySelector('[data-act="music"]').onclick = e => {
      setMusic(!musicOn);
      e.currentTarget.textContent = `Music: ${musicOn ? 'on' : 'off'}`;
      e.currentTarget.setAttribute('aria-pressed', musicOn);
    };
    modal.querySelector('[data-act="volume"]').oninput = e => {
      const v = Number(e.currentTarget.value);
      setMusicVolume(v);
      e.currentTarget.setAttribute('aria-valuetext', `${v}%`);
      e.currentTarget.nextElementSibling.textContent = `${v}%`;
    };
    modal.querySelector('[data-act="basics"]').onclick = () => showLessons(0);
    modal.querySelector('[data-act="export"]').onclick = exportSave;
    modal.querySelector('[data-act="import"]').onclick = pickSaveFile;
    modal.querySelector('[data-act="close"]').onclick = closeModal;
    modal.querySelector('[data-act="reset"]').onclick = e => {
      if (!confirming) {
        confirming = true;
        e.currentTarget.textContent = 'Click again to erase everything';
        return;
      }
      modalQueue.length = 0;
      state = freshState();
      ui.picks = defaultPicks();
      ui.selected = ui.picks[ui.market];
      ui.staffFocus = {};
      lastTip = '';
      renderedNewsKey = '';
      saveState();
      closeModal();
      showScreen('home');
      toast('Progress reset', 'Your desk is back to day one.');
    };
  }

  // ===========================================================
  // SAVING TO A FILE
  // localStorage is per-browser, so a file is the only way to carry a game
  // from one to another, or to keep a copy of it at all.
  // ===========================================================
  function exportSave() {
    saveState();
    const name = `simstock-save-day-${Math.max(0, state.day) + 1}.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('Game saved to a file', `${name} is in your downloads. Load it back from Settings on any browser.`, 'accent');
  }

  function pickSaveFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => { if (input.files && input.files[0]) readSaveFile(input.files[0]); };
    input.click();
  }

  function readSaveFile(file) {
    const reader = new FileReader();
    reader.onerror = () => toast("That file couldn't be read", 'Your game is untouched.', 'neg');
    reader.onload = () => {
      let loaded = null;
      try { loaded = migrate(JSON.parse(reader.result)); } catch (e) { loaded = null; }
      if (!loaded) {
        toast("That isn't a SimStock save", 'Your game is untouched.', 'neg');
        return;
      }
      modalQueue.length = 0;
      state = loaded;
      ui.picks = defaultPicks();
      ui.selected = ui.picks[ui.market];
      chartHover = null;
      lastTip = '';
      renderedNewsKey = '';
      lastTickAt = Date.now();
      saveState();
      closeModal();
      showScreen(state.accountOpen ? 'home' : 'landing');
      toast('Game loaded', `Back at year ${Math.floor(Math.max(0, state.day) / DAYS_PER_YEAR) + 1}, with ${fmt(netWorth())} to your name.`, 'accent');
    };
    reader.readAsText(file);
  }

  // ===========================================================
  // ACTIONS
  // ===========================================================
  function setSpeed(n) {
    if (!SPEEDS.includes(n)) return;
    if (n > 0) lastRunningSpeed = n;
    state.speed = n;
    render();
    saveState();
  }

  function togglePause() {
    setSpeed(state.speed === 0 ? lastRunningSpeed : 0);
  }

  // Returns true on a level-up, which brings its own fanfare unless `quiet`.
  function gainXp(amount, quiet = false) {
    const startLevel = state.level;
    let bonus = 0;
    state.xp += amount;
    while (state.xp >= xpToNext(state.level)) {
      state.xp -= xpToNext(state.level);
      state.level += 1;
      bonus += milestoneBonus(state.level);
    }
    if (state.level > startLevel) {
      state.cash += bonus;
      const level = state.level;
      queueModal(() => showLevelUp(level, bonus));
      if (!quiet) {
        playSound('level');
        confetti(70, ['#f0b73d', '#f4d48c', '#efe8d8']);
      }
      return true;
    }
    return false;
  }

  function afterAction() {
    updateTip();
    scanAchievements();
    render();
    saveState();
  }

  function openAccount() {
    state.accountOpen = true;
    gainXp(XP.openAccount);
    showScreen('trade');
    afterAction();
    toast('Account opened', `+${XP.openAccount} XP. Pick a stock from the list to get started, or try the Crypto and Memecoins rooms.`, 'accent');
  }

  // Crypto trades in fractions of a coin; shares and memecoins come whole.
  const qtyDecimals = s => (s.market === 'crypto' ? 4 : 0);
  function roundQty(s, q) {
    const f = 10 ** qtyDecimals(s);
    return Math.floor(q * f + 1e-6) / f;
  }
  // what the − and + buttons move by: one share, or roughly $100 worth of a coin
  function nudgeOf(s, price) {
    if (!isCoin(s)) return 1;
    const step = 10 ** Math.floor(Math.log10(100 / price));
    return Math.max(10 ** -qtyDecimals(s), step);
  }
  const defaultQty = s => (isCoin(s) ? nudgeOf(s, rtOf(s.id).price) : 1);

  // The most your cash can cover once the commission is paid too. Worked out
  // directly rather than counted up one at a time, since a memecoin order can
  // run to billions of coins.
  function maxBuyQty(s, price) {
    const cash = state.cash;
    const cost = n => n * price + commission(n * price);
    const fit = v => roundQty(s, Math.max(0, v));
    let n = fit((cash - COMMISSION_MIN) / price);
    if (n * price * COMMISSION_RATE > COMMISSION_MIN) n = fit(cash / (price * (1 + COMMISSION_RATE)));
    // the commission is rounded to the cent, so step back a cent or two's worth if needed
    const back = Math.max(10 ** -qtyDecimals(s), fit(0.02 / price));
    while (n > 0 && cost(n) > cash + 1e-9) n = fit(n - back);
    return n;
  }

  function orderQty() {
    const n = roundQty(STOCK_BY_ID[ui.selected], Number($('qtyInput').value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function setQty(n) {
    const s = STOCK_BY_ID[ui.selected];
    $('qtyInput').value = String(Math.max(10 ** -qtyDecimals(s), roundQty(s, n)));
    render();
  }

  // quantities are kept to eight decimal places so repeated crypto trades don't drift
  const tidyQty = q => (q < 1e-9 ? 0 : Number(q.toFixed(8)));

  function placeOrder() {
    const s = STOCK_BY_ID[ui.selected];
    const rt = rtOf(s.id);
    const qty = orderQty();
    const value = qty * rt.price;
    const fee = commission(value);
    if (rt.delisted || qty <= 0) return;
    // anything you already own can always be sold, even if its tier is above yours
    if (!isUnlocked(s) && (ui.side !== 'sell' || !rt.shares)) return;
    const qtyText = `${fmtQty(s, qty)} ${s.id}`;

    if (ui.side === 'buy') {
      if (value + fee > state.cash + 1e-9) return;
      state.stats.trades += 1;
      if (s.market === 'stock' && dayChangePct(rt.history) <= -8) state.stats.boughtBigDip = true;
      const top = state.news[0];
      if (s.market === 'stock' && top && top.ticker === s.id && top.kind === 'news' && top.mood === 'down' && top.day === state.day && s.risk === 5) {
        state.stats.contrarianBuy = true;
      }
      if (s.market === 'crypto') state.stats.boughtCrypto = true;
      if (rt.shares === 0) rt.firstBuyDay = state.day;
      state.cash -= value + fee;
      rt.shares = tidyQty(rt.shares + qty);
      rt.costBasis += value + fee; // the commission is part of what the shares cost you
      state.totalFees += fee;
      toast('Order filled', `Bought ${qtyText} at ${fmtPrice(rt.price)}: ${fmt(value + fee)} with the ${fmt(fee)} commission.`, 'pos');
      if (!gainXp(XP.buy)) playSound('buy');
    } else {
      if (qty > rt.shares + 1e-9) return;
      state.stats.trades += 1;
      const paid = avgCost(rt) * qty;
      const proceeds = value - fee;
      const profit = proceeds - paid;
      if (rt.distress) state.stats.soldWhileDistressed = true;
      if (s.market === 'meme' && paid > 0 && proceeds >= paid * 10) state.stats.memeTenBagger = true;
      state.stats.bestSaleProfit = Math.max(state.stats.bestSaleProfit, profit);
      state.cash += proceeds;
      rt.shares = tidyQty(rt.shares - qty);
      rt.costBasis = rt.shares ? rt.costBasis - paid : 0;
      rt.realized += profit;
      state.totalFees += fee;
      if (rt.shares === 0) {
        const held = state.day - (rt.firstBuyDay ?? state.day);
        state.stats.longestHoldDays = Math.max(state.stats.longestHoldDays, held);
        if (held <= 0) state.stats.sameDayFlip = true;
        rt.firstBuyDay = null;
      }
      const result = Math.abs(profit) < 0.005 ? 'at break-even' : `for a ${fmt(Math.abs(profit))} ${profit > 0 ? 'profit' : 'loss'}`;
      toast('Order filled', `Sold ${qtyText} at ${fmtPrice(rt.price)} ${result}, after the ${fmt(fee)} commission.`, profit > -0.005 ? 'pos' : 'neg');
      if (!gainXp(profit > 0 ? sellProfitXp(profit) : XP.sellLoss)) playSound(profit > 0 ? 'cash' : 'loss');
    }
    afterAction();
  }

  // Fees in, salaries out. If the cash runs out, someone has to go.
  function runPayroll(days) {
    state.cash += staffIncome() * days;
    if (state.cash >= 0) return;
    for (let i = STAFF.length - 1; i >= 0 && state.cash < 0; i--) {
      const role = STAFF[i];
      while (state.cash < 0 && state.staff[role.id] > 0) {
        state.staff[role.id] -= 1;
        state.cash += role.salary * 30; // a month of that salary back in the till
        state.stats.lastLayoffDay = state.day;
        // last in, first out
        const gone = state.roster.splice(state.roster.map(p => p.role).lastIndexOf(role.id), 1)[0];
        toast('Payroll missed', `You couldn't cover the wages, so ${esc(gone.name)}, a ${role.name}, was let go.`, 'neg');
        playSound('loss');
      }
    }
    if (state.cash < 0) state.cash = 0;
  }

  function hire(staff) {
    const cost = staffCost(staff);
    if (state.tier < staff.tier || state.cash < cost) return;
    state.cash -= cost;
    state.staff[staff.id] += 1;
    if (state.stats.firstHireDay == null) state.stats.firstHireDay = state.day;
    if (state.stats.lastLayoffDay == null) state.stats.lastLayoffDay = state.day;
    const person = newHire(state, staff.id);
    state.roster.push(person);
    ui.staffFocus[staff.id] = null;
    toast(`${esc(person.name)} joins as ${staff.name}`, `“${esc(person.trait)}.” ${fmt(staff.income)} a day in fees, ${fmt(staff.salary)} a day in wages.`, 'accent');
    if (!gainXp(XP.hire)) playSound('hire');
    afterAction();
  }

  function upgradeTier(i) {
    if (!tierReady(i)) return;
    state.cash -= TIERS[i].cost;
    state.tier = i;
    queueModal(() => showTierUnlocked(i));
    gainXp(XP.tier, true);
    playSound('tier');
    confetti(160, ['#4cbf8c', '#9fb4c8', '#f0b73d', '#ad93e8', '#efe8d8']);
    afterAction();
  }

  // ===========================================================
  // DESK TIPS
  // Short hints that react to the selected stock and your portfolio.
  // ===========================================================
  function deskTip() {
    const s = STOCK_BY_ID[ui.selected];
    const rt = rtOf(s.id);
    if (!isUnlocked(s)) {
      return `${s.id} needs a ${TIERS[s.tier].name} account. Watching ${isCoin(s) ? 'a coin' : 'a stock'} before you can buy it is a good way to learn how it behaves.`;
    }
    if (s.stable) {
      return `${s.id} is pegged to one dollar. It is somewhere to park cash inside crypto, not something that grows.`;
    }
    if (s.market === 'meme' && rt.phase === 'rising') {
      return `${s.id} hasn't ascended yet. A few memecoins take off and multiply many times over; plenty more get rugged and go to zero. Only put in what you could lose.`;
    }
    if (s.market === 'meme' && rt.shares === 0) {
      return `A memecoin has no profits, no products and no dividends. Its price is whatever the crowd feels like today, so ${s.id} can halve or double in a week.`;
    }
    if (s.id === 'BTY' && rt.shares === 0) {
      return "You don't need a whole Bitcoyn. Coins split into tiny pieces, so you can buy a thousandth of one, or type in any amount.";
    }
    if (holdingsValue() === 0) {
      return 'Not sure where to start? The index fund, VTMF, spreads your money across the whole market, so no single company can sink you.';
    }
    if (rt.shares > 0) {
      const pct = (rt.price / avgCost(rt) - 1) * 100;
      if (pct >= 10) return `You're up ${pct.toFixed(0)}% on ${s.id}. Some investors sell part of a winning position to lock in gains and keep the rest.`;
      if (pct <= -10) return `${s.id} is ${Math.abs(pct).toFixed(0)}% below what you paid. Ask whether something changed about the company, or if it's just normal price swings.`;
    }
    if (s.vol >= 0.5) {
      const typical = (s.vol / Math.sqrt(DAYS_PER_YEAR)) * 200;
      return `${s.id} is highly volatile: daily moves of ${typical.toFixed(0)}% or more are common. Many investors keep positions like this small.`;
    }
    if (isCoin(s)) {
      return 'Coins earn nothing while you hold them: no profits and no dividends. The only way to make money is for someone to pay more for them later.';
    }
    if (state.staff.analyst === 0 && state.cash >= staffCost(STAFF[0])) {
      return 'Staff earn income every trading day, even while you are away. A Research Analyst pays for itself in about 50 days.';
    }
    return GENERAL_TIPS[tipIndex % GENERAL_TIPS.length];
  }

  function updateTip() {
    const tip = deskTip();
    if (tip === lastTip) return;
    lastTip = tip;
    const p = $('coachText');
    p.innerHTML = tip;
    p.classList.remove('fresh');
    void p.offsetWidth;
    p.classList.add('fresh');
  }

  // ===========================================================
  // SCREENS
  // ===========================================================
  const SCREEN_TITLES = {
    landing: 'SimStock', home: 'Front page', trade: 'Trading floor', crypto: 'Crypto exchange', meme: 'Memecoin pit',
    portfolio: 'Your portfolio', upgrades: 'Upgrades', achievements: 'Achievements', tutorial: 'How to play',
    versus: 'Versus',
  };
  const OPEN_SCREENS = ['landing', 'home', 'portfolio', 'achievements', 'tutorial', 'versus']; // viewable before a brokerage account exists

  // The trading floor, the crypto exchange and the memecoin pit are one room
  // showing a different market.
  function showScreen(name) {
    if (!OPEN_SCREENS.includes(name) && !state.accountOpen) {
      showLessons(0);
      return;
    }
    const market = MARKET_OF_SCREEN[name];
    if (market) {
      ui.market = market;
      const pick = STOCK_BY_ID[ui.picks[market]];
      ui.selected = pick && trading(pick) ? pick.id : boardStocks().find(s => s.market === market && trading(s)).id;
      resetOrder();
    }
    ui.screen = name;
    $('landingScreen').hidden = name !== 'landing';
    $('homeScreen').hidden = name !== 'home';
    $('tradeScreen').hidden = !market;
    $('tradeScreen').dataset.market = ui.market;
    $('portfolioScreen').hidden = name !== 'portfolio';
    $('upgradesScreen').hidden = name !== 'upgrades';
    $('achievementsScreen').hidden = name !== 'achievements';
    $('versusScreen').hidden = name !== 'versus';
    $('tutorialScreen').hidden = name !== 'tutorial';
    document.querySelectorAll('.task-switch [data-screen]').forEach(b => {
      if (b.dataset.screen === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    render();
    if (market) {
      sizeChart();
      updateTip();
    }
    if (name === 'portfolio') sizeWorthChart();
    if (name === 'versus') {
      setVsStage(vs.match ? (vs.match.over ? 'over' : 'live') : vs.stage === 'over' ? 'over' : 'lobby');
      autoConnect();
    }
    // move the keyboard to the new room, but not on the way in to the game
    if (booted && name !== 'landing') $('pageTitle').focus();
  }

  // a fresh order ticket for whatever is selected: one share, or about $100 of a coin
  function resetOrder() {
    $('qtyInput').value = String(defaultQty(STOCK_BY_ID[ui.selected]));
  }

  function selectStock(id) {
    ui.selected = id;
    ui.picks[STOCK_BY_ID[id].market] = id;
    chartHover = null;
    resetOrder();
    updateTip();
    render();
  }

  // Opens any company or coin in whichever room trades it.
  function openAsset(id) {
    const s = STOCK_BY_ID[id];
    ui.picks[s.market] = id;
    showScreen(MARKETS[s.market].screen);
  }

  // ===========================================================
  // RENDER
  // ===========================================================
  function render() {
    renderChrome();
    renderTape();
    if (ui.screen === 'home') renderHome();
    if (onTradeFloor()) renderTrade();
    if (ui.screen === 'portfolio') renderPortfolio();
    if (ui.screen === 'upgrades') renderUpgrades();
    if (ui.screen === 'achievements') renderAchievements();
  }

  const speedButtons = Array.from(document.querySelectorAll('#speedSeg button'));

  function renderChrome() {
    const need = xpToNext(state.level);
    $('pageTitle').textContent = SCREEN_TITLES[ui.screen];
    const paused = state.speed === 0;
    $('clockText').textContent = clockLabel() + (paused ? ' · paused' : '');
    $('clockText').classList.toggle('paused', paused);
    const cycle = state.cycle;
    const cycleTag = $('cycleTag');
    cycleTag.hidden = !cycle;
    if (cycle) {
      cycleTag.textContent = cycle.kind === 'boom' ? 'Economy: boom' : 'Economy: recession';
      cycleTag.className = `cycle-tag ${cycle.kind}`;
      cycleTag.title = `Began ${daysAgo(state.day - cycle.startDay)}`;
    }
    speedButtons.forEach(b => {
      const on = Number(b.dataset.speed) === state.speed;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    $('topCash').textContent = fmtBig(state.cash);
    $('topWorth').textContent = fmtBig(netWorth());
    const income = staffIncome();
    const incomeEl = $('topIncome');
    incomeEl.textContent = `${staffCount() ? fmtSigned(income) : fmt(0)}/day`;
    incomeEl.className = 'figure-value ' + (staffCount() && income < 0 ? 'neg' : '');
    $('levelNum').textContent = state.level;
    $('tierChip').textContent = `${TIERS[state.tier].name} account`;
    $('xpFill').style.width = Math.min(100, (state.xp / need) * 100) + '%';
    $('xpText').textContent = `${Math.floor(state.xp)} / ${need} XP to level ${state.level + 1}`;
  }

  // The scrolling price strip under the masthead. Its contents are listed twice
  // so the CSS scroll can loop without a gap.
  const TAPE_SECTIONS = { crypto: 'Crypto', meme: 'Memecoins' };
  let tapeCount = 0;

  function renderTape() {
    const items = [`<span class="tape-item"><b>INDEX</b>${state.market.level.toFixed(2)} ${chg(dayChangePct(state.market.history))}</span>`];
    for (const market of Object.keys(MARKETS)) {
      if (TAPE_SECTIONS[market]) items.push(`<span class="tape-item tape-sep">${TAPE_SECTIONS[market]}</span>`);
      for (const s of boardStocks().filter(x => x.market === market && trading(x))) {
        const rt = rtOf(s.id);
        const ys = yearStats(rt.history);
        // a brand-new listing sets a "high" or "low" almost every day, so wait a month
        const flag = ys.days < 21 || s.stable ? ''
          : ys.highAgo === 0 ? '<span class="tape-flag pos">52W HIGH</span>'
          : ys.lowAgo === 0 ? '<span class="tape-flag neg">52W LOW</span>'
          : '';
        items.push(`<span class="tape-item"><b>${s.id}</b>${fmtPrice(rt.price)} ${chg(dayChangePct(rt.history))}`
          + `<span class="tape-range">52W ${fmtPrice(ys.low, true)}–${fmtPrice(ys.high, true)}</span>${flag}</span>`);
      }
    }
    // keep the reading speed steady however long the strip gets
    if (items.length !== tapeCount) {
      tapeCount = items.length;
      $('tape').style.animationDuration = `${items.length * 6}s`;
    }
    const html = items.join('');
    $('tape').innerHTML = html + html;
  }

  // ---------- Overview ----------
  function renderHome() {
    const worth = netWorth();
    const change = worth - STARTING_CASH;
    $('homeWorth').textContent = fmt(worth);
    const changeEl = $('homeWorthChange');
    changeEl.textContent = `${fmtSigned(change)} (${fmtPct((change / STARTING_CASH) * 100)}) since you started`;
    changeEl.className = 'worth-change ' + tone(change);
    $('homeCash').textContent = fmt(state.cash);
    $('homeInvested').textContent = fmt(holdingsValue());
    $('homeIncome').textContent = `${staffCount() ? fmtSigned(staffIncome()) : fmt(0)}/day`;
    $('homeDividends').textContent = fmt(state.totalDividends);

    $('onboardPanel').hidden = state.accountOpen;
    $('tierPanel').hidden = !state.accountOpen;
    $('holdingsPanel').hidden = !state.accountOpen;
    $('homeRow2').classList.toggle('single', !state.accountOpen);

    if (state.accountOpen) {
      renderTierProgress();
      renderHoldings();
    }
    renderMovers();
    renderNews();
    renderDesk();
    $('homeAchProgress').textContent = `${ACHIEVEMENTS.filter(a => state.achieved[a.id] != null).length}/${ACHIEVEMENTS.length}`;
  }

  // What sits on the desk, in the order the game hands it out.
  const DESK_ITEMS = [
    { id: 'notes',   has: () => state.staff.analyst > 0, hint: 'Hire a Research Analyst and their notes will start piling up here.' },
    { id: 'plant',   has: () => state.tier >= 1, hint: 'A Silver account comes with a pot plant.' },
    { id: 'screen2', has: () => state.tier >= 2, hint: 'Gold gets you a second screen.' },
    { id: 'frame',   has: () => state.tier >= 3, hint: 'Reach Platinum and your first dollar goes up on the wall.' },
  ];
  const deskShown = {};

  function renderDesk() {
    for (const item of DESK_ITEMS) {
      const on = item.has();
      if (deskShown[item.id] === on) continue;
      const node = document.querySelector(`#desk [data-desk="${item.id}"]`);
      node.style.display = on ? '' : 'none';
      // anything new since the page loaded gets a little entrance
      if (on && deskShown[item.id] === false) {
        node.classList.remove('desk-new');
        void node.getBoundingClientRect();
        node.classList.add('desk-new');
      }
      deskShown[item.id] = on;
    }
    const next = DESK_ITEMS.find(item => !item.has());
    $('deskCaption').textContent = next ? next.hint : 'The desk is complete. The view from up here is excellent.';
  }

  let tierChipsFor = '';
  function renderTierProgress() {
    const nextIndex = state.tier + 1;
    const next = TIERS[nextIndex];
    $('tierNext').hidden = !next;
    $('tierMaxed').hidden = !!next;
    if (!next) return;

    $('tierNextTitle').textContent = `${next.name} account`;
    const chipsKey = nextIndex + ':' + boardKey();
    if (tierChipsFor !== chipsKey) {
      $('tierNextStocks').innerHTML = tkrList(boardStocks().filter(s => s.tier === nextIndex && trading(s)));
      tierChipsFor = chipsKey;
    }
    const levelDone = state.level >= next.level;
    const cashDone = state.cash >= next.cost;
    $('tierLevelText').textContent = `Level ${state.level} of ${next.level}`;
    $('tierLevelBar').firstElementChild.style.width = Math.min(100, (state.level / next.level) * 100) + '%';
    $('tierLevelBar').classList.toggle('done', levelDone);
    $('tierCashText').textContent = `${fmt(Math.min(state.cash, next.cost))} of ${fmt(next.cost)}`;
    $('tierCashBar').firstElementChild.style.width = Math.min(100, (state.cash / next.cost) * 100) + '%';
    $('tierCashBar').classList.toggle('done', cashDone);

    const btn = $('tierUpgradeBtn');
    btn.disabled = !tierReady(nextIndex);
    btn.textContent = btn.disabled ? 'Not yet' : `Upgrade for ${fmt(next.cost)}`;
  }

  function renderHoldings() {
    const held = STOCKS.filter(s => rtOf(s.id).shares > 0)
      .sort((a, b) => rtOf(b.id).shares * rtOf(b.id).price - rtOf(a.id).shares * rtOf(a.id).price);
    $('holdingsEmpty').hidden = held.length > 0;
    $('holdingsTable').hidden = held.length === 0;
    if (!held.length) return;

    const rows = held.map(s => {
      const rt = rtOf(s.id);
      const value = rt.shares * rt.price;
      const ret = value - rt.costBasis;
      const day = dayChangePct(rt.history);
      return `<tr data-stock="${s.id}">
        <td>${tkr(s)}</td>
        <td class="num">${fmtQty(s, rt.shares)}</td>
        <td class="num">${fmtPrice(rt.price)}<span class="sub">${chg(day)}</span></td>
        <td class="num">${fmt(value)}</td>
        <td class="num ${tone(ret)}">${fmtSigned(ret)}<span class="sub">${fmtPct((ret / rt.costBasis) * 100)}</span></td>
      </tr>`;
    }).join('');
    $('holdingsTable').innerHTML = `<table class="table">
      <thead><tr><th>Holding</th><th class="num">Owned</th><th class="num">Price</th><th class="num">Value</th><th class="num">Return</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function renderMovers() {
    const marketDay = dayChangePct(state.market.history);
    const marketEl = $('moversMarket');
    marketEl.textContent = `Index ${fmtPct(marketDay)}`;
    marketEl.className = tone(marketDay);

    const rows = boardStocks().filter(s => s.market === 'stock' && isUnlocked(s) && trading(s))
      .map(s => ({ s, rt: rtOf(s.id), change: dayChangePct(rtOf(s.id).history) }))
      .sort((a, b) => b.change - a.change)
      .map(({ s, rt, change }) => `<tr data-stock="${s.id}">
          <td>${tkr(s)}<span class="n">${s.name}</span></td>
          <td class="num">${fmtPrice(rt.price)}</td>
          <td class="num">${chg(change)}</td>
        </tr>`)
      .join('');
    $('moversList').innerHTML = `<table class="table quotes"><tbody>${rows}</tbody></table>`;
  }

  // ---------- Portfolio ----------
  function renderPortfolio() {
    const worth = netWorth();
    const invested = holdingsValue();
    const change = worth - STARTING_CASH;
    const realized = STOCKS.reduce((sum, s) => sum + rtOf(s.id).realized, 0);

    $('pfWorth').textContent = fmt(worth);
    const changeEl = $('pfChange');
    changeEl.textContent = `${fmtSigned(change)} (${fmtPct((change / STARTING_CASH) * 100)}) since you started with ${fmt(STARTING_CASH)}`;
    changeEl.className = 'worth-change ' + tone(change);
    $('pfCash').textContent = fmt(state.cash);
    $('pfInvested').textContent = fmt(invested);
    $('pfRealized').textContent = fmtSigned(Math.abs(realized) < 0.005 ? 0 : realized);
    $('pfDividends').textContent = fmt(state.totalDividends);
    $('pfFees').textContent = fmt(state.totalFees);

    renderVsMarket();

    const held = STOCKS.filter(s => rtOf(s.id).shares > 0)
      .sort((a, b) => rtOf(b.id).shares * rtOf(b.id).price - rtOf(a.id).shares * rtOf(a.id).price);
    $('pfEmpty').hidden = held.length > 0;
    $('pfTable').hidden = held.length === 0;

    if (held.length) {
      const rows = held.map(s => {
        const rt = rtOf(s.id);
        const value = rt.shares * rt.price;
        const gain = value - rt.costBasis;
        return `<tr data-stock="${s.id}">
          <td>${tkr(s)}<span class="n">${s.name}</span></td>
          <td class="num">${fmtQty(s, rt.shares)}</td>
          <td class="num">${fmtPrice(avgCost(rt))}</td>
          <td class="num">${fmtPrice(rt.price)}<span class="sub">${chg(dayChangePct(rt.history))}</span></td>
          <td class="num">${fmt(value)}</td>
          <td class="num ${tone(gain)}">${fmtSigned(gain)}<span class="sub">${fmtPct((gain / rt.costBasis) * 100)}</span></td>
          <td class="num">${isCoin(s) ? '—' : fmt(rt.dividends)}</td>
        </tr>`;
      }).join('');
      $('pfTable').innerHTML = `<table class="table">
        <thead><tr><th>Holding</th><th class="num">Owned</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Value</th><th class="num">Gain or loss</th><th class="num">Dividends</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    }

    // how the money is split between cash and each holding
    const slices = [{ name: 'Cash', value: state.cash, cash: true }]
      .concat(held.map(s => ({ name: s.id, value: rtOf(s.id).shares * rtOf(s.id).price })));
    $('pfMix').innerHTML = slices.map(slice => {
      const pct = worth > 0 ? (slice.value / worth) * 100 : 0;
      return `<div class="mix-row">
          <span class="mix-name${slice.cash ? ' cash' : ''}">${slice.cash ? slice.name : `<span class="tkr">${slice.name}</span>`}</span>
          <span class="mix-bar"><span class="${slice.cash ? 'cash' : ''}" style="width:${pct.toFixed(1)}%"></span></span>
          <span class="mix-value">${fmt(slice.value)}</span>
          <span class="mix-pct">${pct.toFixed(1)}%</span>
        </div>`;
    }).join('');
  }

  // ---------- You against the market ----------
  // Both lines cover the same stretch of days and start from the same dollar,
  // so the only thing to read is the gap between them.
  const worthChart = $('worthChart');
  const worthCtx = worthChart.getContext('2d');

  function worthSeries() {
    const n = state.worth.history.length;
    if (n < 2) return null;
    const market = state.market.history.slice(-n);
    if (market.length < n || !market[0]) return null;
    // The curve only gains a point when a day passes, so the last one is brought
    // up to date by hand: otherwise a trade, or a pause, leaves the chart behind.
    const mine = state.worth.history.slice();
    mine[n - 1] = netWorth();
    const start = mine[0];
    return { mine, bench: market.map(v => (start * v) / market[0]), n };
  }

  function renderVsMarket() {
    const series = worthSeries();
    const note = $('pfVsNote');
    $('pfVsChart').hidden = !series;
    if (!series) {
      note.textContent = 'This chart needs a couple of trading days before it has anything to draw. Leave the market running and come back.';
      worthChart.setAttribute('aria-label', 'Not enough history yet to compare your net worth with the market.');
    } else {
      const mineRet = (series.mine[series.n - 1] / series.mine[0] - 1) * 100;
      const benchRet = (series.bench[series.n - 1] / series.bench[0] - 1) * 100;
      const gap = mineRet - benchRet;
      const days = `${series.n} trading day${series.n === 1 ? '' : 's'}`;
      const verdict = `${Math.abs(gap).toFixed(2)} points ${gap >= 0 ? 'ahead of' : 'behind'}`;
      $('pfVsChart').classList.toggle('behind', gap < 0); // the legend key follows the line
      note.innerHTML = `Over the past ${days} your desk is <b class="${tone(mineRet)}">${fmtPct(mineRet)}</b> and the market is <b class="${tone(benchRet)}">${fmtPct(benchRet)}</b>. That puts you <b class="${tone(gap)}">${verdict}</b> simply owning the whole market and doing nothing else.`;
      worthChart.setAttribute('aria-label', `Your net worth against the market over ${days}: you ${fmtPct(mineRet)}, the market ${fmtPct(benchRet)}, leaving you ${verdict} the market.`);
    }
    drawWorthChart();
  }

  function sizeWorthChart() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = worthChart.getBoundingClientRect();
    if (!width) return;
    worthChart.width = Math.round(width * dpr);
    worthChart.height = Math.round(height * dpr);
    drawWorthChart();
  }

  function drawWorthChart() {
    if (ui.screen !== 'portfolio' || !worthChart.width) return;
    const dpr = window.devicePixelRatio || 1;
    const w = worthChart.width / dpr;
    const h = worthChart.height / dpr;
    const ctx = worthCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const series = worthSeries();
    if (!series) return;
    const { mine, bench, n } = series;
    const box = { left: 4, right: w - 74, top: 12, bottom: h - 26 };
    let min = Math.min(Math.min(...mine), Math.min(...bench));
    let max = Math.max(Math.max(...mine), Math.max(...bench));
    const pad = (max - min) * 0.1 || max * 0.04;
    min -= pad;
    max += pad;
    const x = i => box.left + (i / (n - 1)) * (box.right - box.left);
    const y = v => box.bottom - ((v - min) / (max - min)) * (box.bottom - box.top);

    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = min + ((max - min) * i) / 4;
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = CHART.grid;
      ctx.beginPath();
      ctx.moveTo(box.left, yy);
      ctx.lineTo(box.right, yy);
      ctx.stroke();
      ctx.fillStyle = CHART.text;
      ctx.fillText(fmtBig(v), box.right + 10, yy);
    }

    ctx.textBaseline = 'top';
    [0, 1 / 3, 2 / 3, 1].forEach(f => {
      const i = Math.round(f * (n - 1));
      ctx.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center';
      ctx.fillStyle = CHART.text;
      ctx.fillText(daysAgoLabel(n - 1 - i), x(i), box.bottom + 8);
    });

    // the market goes down first, in grey, so your own line reads on top of it
    ctx.beginPath();
    bench.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = CHART.text;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    const ahead = mine[n - 1] >= bench[n - 1];
    const color = ahead ? CHART.pos : CHART.neg;
    const trace = () => mine.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));

    const grad = ctx.createLinearGradient(0, box.top, 0, box.bottom);
    grad.addColorStop(0, ahead ? 'rgba(76,195,138,0.26)' : 'rgba(255,111,94,0.20)');
    grad.addColorStop(1, 'rgba(13,12,10,0)');
    ctx.beginPath();
    trace();
    ctx.lineTo(x(n - 1), box.bottom);
    ctx.lineTo(x(0), box.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    trace();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x(n - 1), y(mine[n - 1]), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ---------- Trading ----------
  // One room, three markets: the trading floor, the crypto exchange and the
  // memecoin pit all draw from here, showing whatever `ui.market` is.
  let watchRefs = {};
  let watchKey = '';

  const cap1 = t => t[0].toUpperCase() + t.slice(1);
  const volNow = s => (s.phase === 'rising' && rtOf(s.id).phase === 'ascended' ? s.vol * ASCENDED_VOL : s.vol);
  // a memecoin's price can move a long way either side of a dollar in its life
  const fmtMove = (n, price) => (price >= 1 ? fmtSigned(n) : fmtPriceSigned(n));

  // memecoins are grouped by whether they've made it yet; everything else by account tier
  function watchGroup(s) {
    if (s.market === 'meme') {
      const label = MEME_PHASES[rtOf(s.id).phase].group;
      return { label, rank: label === 'Already ascended' ? 0 : 1, cls: label === 'Already ascended' ? 'phase-ascended' : 'phase-rising' };
    }
    return { label: `${TIERS[s.tier].name} account`, rank: s.tier, cls: `tier-${s.tier}` };
  }

  function marketBoard() {
    return boardStocks()
      .filter(s => s.market === ui.market)
      .sort((a, b) => watchGroup(a).rank - watchGroup(b).rank || a.tier - b.tier);
  }

  const watchlistKey = () => ui.market + ':' + marketBoard().map(s => s.id + (rtOf(s.id).phase || '')).join();

  // Built again whenever something leaves the board or joins it, a memecoin
  // changes group, or the room switches market.
  function buildWatchlist() {
    const list = $('watchList');
    list.innerHTML = '';
    watchRefs = {};
    watchKey = watchlistKey();
    let group = '';
    for (const s of marketBoard()) {
      const g = watchGroup(s);
      if (g.label !== group) {
        group = g.label;
        list.appendChild(el(`<div class="watch-group ${g.cls}">${g.label}</div>`));
      }
      const hot = rtOf(s.id).phase === 'ascending' ? '<span class="watch-tag">Ascending</span>' : '';
      const row = el(`<button class="watch-row">
          <span class="watch-id"><span class="watch-ticker">${s.id} ${riskPips(s)}${hot}</span><span class="watch-name">${s.name}</span></span>
          <svg class="spark" viewBox="0 0 44 20" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke-width="1.5" stroke-linejoin="round"/></svg>
          <span class="watch-quote"><span class="watch-price"></span><span class="watch-change"></span></span>
        </button>`);
      row.onclick = () => selectStock(s.id);
      list.appendChild(row);
      watchRefs[s.id] = {
        row,
        spark: row.querySelector('polyline'),
        price: row.querySelector('.watch-price'),
        change: row.querySelector('.watch-change'),
      };
    }
  }

  function sparkPoints(history) {
    const data = history.slice(-30);
    const min = Math.min(...data);
    const span = Math.max(...data) - min || 1;
    return data.map((v, i) => `${((i / (data.length - 1)) * 44).toFixed(1)},${(18 - ((v - min) / span) * 16).toFixed(1)}`).join(' ');
  }

  function setV(node, text, toneClass = '') {
    node.textContent = text;
    node.className = 'v ' + toneClass;
  }

  const RANGE_LABELS = { 21: 'month', 63: '3 months', 252: 'year' };

  // where a coin stands by size among the others in its market
  function sizeRank(s) {
    const list = boardStocks().filter(x => x.market === s.market && trading(x))
      .sort((a, b) => rtOf(b.id).price * b.sharesOut - rtOf(a.id).price * a.sharesOut);
    return { n: list.indexOf(s) + 1, of: list.length };
  }

  function riskNote(s) {
    const rt = rtOf(s.id);
    if (s.stable) return 'Pegged to one dollar, so it should barely move';
    if (canFail(s, rt)) {
      if (graduated(s, rt)) return "Can't be rugged any more, but it could still fade away";
      if (s.rug) return 'Can take off, or be rugged and go to zero';
      return `Grows faster on average, but ${s.risk === 5 ? 'can fail with little or no warning' : 'can fail if things go badly'}`;
    }
    return riskOf(s) >= 3 ? 'Swings hard, but too big to vanish outright' : 'Grows slowly, and too solid to fail outright';
  }

  // The key numbers under the chart. Coins have no profits or dividends to
  // show, so they get their supply, their size and their status instead.
  function statCells(s, rt, ys) {
    const coin = isCoin(s);
    const capCell = { label: 'Market cap', value: fmtBig(rt.price * s.sharesOut), note: coin ? 'What every coin in existence is worth together' : 'What all its shares are worth together' };
    const ret = { label: ys.fullYear ? '1-year return' : 'Since listing', value: fmtPct(ys.returnPct), tone: tone(ys.returnPct), note: 'How much the price has changed' };
    const day = { label: 'Typical day', value: `±${ys.typicalDayPct.toFixed(1)}%`, note: 'How far the price usually moves in a day' };
    const draw = { label: ys.fullYear ? 'Worst fall this year' : 'Worst fall since listing', value: ys.worstPct < 0 ? fmtPct(ys.worstPct) : 'None', tone: ys.worstPct < 0 ? 'neg' : '', note: 'Biggest drop from a high to the low after it' };
    const riskCell = { label: 'Risk', value: `${riskOf(s)} of 5 · swings ${Math.round(volNow(s) * 100)}%/yr`, note: riskNote(s) };
    if (!coin) {
      return [
        capCell,
        { label: 'P/E ratio', value: (rt.price / rt.eps).toFixed(1), note: "Price divided by a year's profit per share" },
        { label: 'Earnings per share', value: fmt(rt.eps), note: "A year's profit, split across every share" },
        { label: 'Dividend yield', value: s.divYield ? `${(s.divYield * 100).toFixed(1)}% · ${fmt(rt.price * s.divYield)} a share` : 'None', note: 'Cash paid out each year, as a share of price' },
        ret, day, riskCell,
        { label: 'Beta', value: s.beta.toFixed(2), note: '1.00 moves with the market; higher swings more' },
        draw,
      ];
    }
    const rank = sizeRank(s);
    const supply = { label: 'Coins in existence', value: fmtCount(s.sharesOut), note: s.market === 'meme' ? 'Why each coin is worth so little' : 'Every coin there is so far' };
    const hundred = { label: '$100 buys', value: `${fmtCount(roundQty(s, 100 / rt.price))} ${units(s)}`, note: "At today's price, before the commission" };
    const rankCell = { label: 'Size rank', value: `#${rank.n} of ${rank.of}`, note: `By market cap, among the ${s.market === 'meme' ? 'memecoins' : 'coins'} on the board` };
    if (s.market === 'crypto') {
      return [capCell, supply, rankCell, ret, day, draw, riskCell,
        { label: 'Crypto beta', value: s.beta.toFixed(2), note: '1.00 moves with the crypto market; higher swings more' }, hundred];
    }
    const status = {
      label: 'Status',
      value: MEME_PHASES[rt.phase].label,
      tone: rt.phase === 'ascending' ? 'pos' : '',
      note: rt.phase === 'rising' ? 'Could take off any day, or be rugged'
        : rt.phase === 'ascending' ? 'Buyers are piling in right now'
        : graduated(s, rt) ? "Made it, so it won't be rugged. It could still fade"
        : "Big and famous, so it won't be rugged",
    };
    return [capCell, supply, status, hundred, ret, day, draw, riskCell, rankCell];
  }

  function renderTrade() {
    // the market box above the watchlist: the index for stocks, total value for coins
    if (ui.market === 'stock') {
      $('marketLabel').textContent = 'Market index';
      $('marketLevel').textContent = state.market.level.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const marketDay = dayChangePct(state.market.history);
      $('marketChange').textContent = `${fmtPct(marketDay)} today`;
      $('marketChange').className = 'change-sm ' + tone(marketDay);
    } else {
      const coins = boardStocks().filter(s => s.market === ui.market && trading(s));
      const now = coins.reduce((sum, s) => sum + rtOf(s.id).price * s.sharesOut, 0);
      const before = coins.reduce((sum, s) => sum + prevClose(rtOf(s.id).history) * s.sharesOut, 0);
      const pct = before ? (now / before - 1) * 100 : 0;
      $('marketLabel').textContent = ui.market === 'crypto' ? 'All crypto, by value' : 'All memecoins, by value';
      $('marketLevel').textContent = fmtBig(now);
      $('marketChange').textContent = `${fmtPct(pct)} today`;
      $('marketChange').className = 'change-sm ' + tone(pct);
    }

    if (watchKey !== watchlistKey()) buildWatchlist();
    const picked = STOCK_BY_ID[ui.selected];
    if (!onBoard(picked) || picked.market !== ui.market) {
      ui.selected = marketBoard().find(trading).id;
      resetOrder();
    }
    for (const s of marketBoard()) {
      const r = watchRefs[s.id];
      const rt = rtOf(s.id);
      const locked = !isUnlocked(s);
      r.row.classList.toggle('selected', s.id === ui.selected);
      if (s.id === ui.selected) r.row.setAttribute('aria-current', 'true');
      else r.row.removeAttribute('aria-current');
      r.row.classList.toggle('locked', locked || rt.delisted);
      r.price.textContent = rt.delisted ? '—' : fmtPrice(rt.price);
      if (rt.delisted) {
        r.change.textContent = isCoin(s) ? 'Collapsed' : 'Delisted';
        r.change.className = 'watch-change locked-label';
      } else if (locked) {
        r.change.textContent = TIERS[s.tier].name;
        r.change.className = 'watch-change locked-label';
      } else {
        const change = dayChangePct(rt.history);
        r.change.innerHTML = chg(change);
        r.change.className = 'watch-change';
      }
      const h = rt.history;
      r.spark.setAttribute('points', sparkPoints(h));
      r.spark.setAttribute('stroke', h[h.length - 1] >= h[Math.max(0, h.length - 30)] ? CHART.pos : CHART.neg);
    }

    const s = STOCK_BY_ID[ui.selected];
    const rt = rtOf(s.id);
    const locked = !isUnlocked(s);
    const coin = isCoin(s);

    // header + price
    $('dName').textContent = s.name;
    const phase = s.market === 'meme' ? ` · ${MEME_PHASES[rt.phase].label}` : '';
    $('dMeta').innerHTML = `${s.id} · ${s.sector}${phase} · ${riskPips(s)} ${RISK[riskOf(s)].label}`;
    $('dLock').hidden = !locked || rt.delisted;
    $('dLockText').textContent = TIERS[s.tier].name;
    const warn = $('dWarn');
    const hot = rt.phase === 'ascending' && !rt.delisted;
    const fading = rt.fadeLeft > 0 && !rt.delisted;
    warn.hidden = !(rt.distress || rt.delisted || hot || fading);
    warn.classList.toggle('hot-note', hot);
    warn.textContent = rt.delisted
      ? (coin ? `${s.name} has collapsed. These coins are worthless and trading is closed.` : `${s.name} has failed. These shares are worthless and trading is closed.`)
      : hot ? `${s.name} is ascending right now. A price this hot can turn around as fast as it rose.`
      : fading ? `${s.name} is fading. Traders are moving on to newer coins, and once it's gone the coins are worthless.`
      : coin ? `${s.name} has lost two-thirds of its value from its high. If it collapses, the coins become worthless.`
      : `${s.name} has warned it may not be able to pay its debts. If it fails, shares in it become worthless.`;
    $('dPrice').textContent = fmtPrice(rt.price);

    const dayPct = dayChangePct(rt.history);
    const dayAbs = rt.price - prevClose(rt.history);
    $('dChange').textContent = `${fmtMove(dayAbs, rt.price)} (${fmtPct(dayPct)}) today`;
    $('dChange').className = 'change chg ' + tone(dayPct);
    const range = rt.history.slice(-ui.range);
    const rangePct = (range[range.length - 1] / range[0] - 1) * 100;
    $('dRange').textContent = `${fmtPct(rangePct)} past ${RANGE_LABELS[ui.range]}`;
    $('dRange').className = 'range-change ' + tone(rangePct);
    document.querySelectorAll('#rangeSeg button').forEach(b => {
      const on = Number(b.dataset.range) === ui.range;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    chart.setAttribute('aria-label', `${s.name} price per ${units(s, 1)} over the past ${RANGE_LABELS[ui.range]}: ${fmtPrice(rt.price)}, ${fmtPct(rangePct)}.`);

    // 52-week range
    const ys = yearStats(rt.history);
    const span = ys.fullYear ? 'this year' : `in ${ys.days} days listed`;
    $('r52Label').textContent = ys.fullYear ? '52-week range' : `Range since listing (${ys.days} days)`;
    $('r52Lo').textContent = fmtPrice(ys.low);
    $('r52Hi').textContent = fmtPrice(ys.high);
    $('r52LoWhen').textContent = daysAgo(ys.lowAgo);
    $('r52HiWhen').textContent = daysAgo(ys.highAgo);
    const spread = ys.high - ys.low;
    $('r52Dot').style.left = (spread > 0 ? ((rt.price - ys.low) / spread) * 100 : 50) + '%';
    const aboveLow = (rt.price / ys.low - 1) * 100;
    const belowHigh = (1 - rt.price / ys.high) * 100;
    $('r52Note').innerHTML = ys.highAgo === 0 ? `<span class="pos">At its high for ${span}</span>`
      : ys.lowAgo === 0 ? `<span class="neg">At its low for ${span}</span>`
      : `${aboveLow.toFixed(1)}% above the low · ${belowHigh.toFixed(1)}% below the high`;

    $('statGrid').innerHTML = statCells(s, rt, ys)
      .map(c => `<div class="stat"><dt>${c.label}</dt><dd class="${c.tone || ''}">${c.value}</dd><small>${c.note}</small></div>`)
      .join('');

    // about + calendar
    $('aboutHead').textContent = coin ? 'About the coin' : s.fund ? 'About the fund' : 'About the company';
    $('dAbout').textContent = s.about;
    $('calEarningsRow').hidden = !!s.fund || coin;
    const toEarnings = mod(rt.earningsDay - state.day, DAYS_PER_QUARTER) || DAYS_PER_QUARTER;
    $('calEarnings').textContent = `in ${toEarnings} day${toEarnings === 1 ? '' : 's'}`;
    $('calDividendRow').hidden = !s.divYield;
    if (s.divYield) {
      const toDividend = mod(rt.earningsDay + 21 - state.day, DAYS_PER_QUARTER) || DAYS_PER_QUARTER;
      $('calDividend').textContent = `~${fmt((rt.price * s.divYield) / 4)}/share in ${toDividend} day${toDividend === 1 ? '' : 's'}`;
    }

    renderOrder(s, rt, locked);
    renderPosition(s, rt);
    renderNews();
    drawChart();
  }

  function renderOrder(s, rt, locked) {
    // something you own from before its tier moved up stays sellable
    const sellOnly = locked && rt.shares > 0 && !rt.delisted;
    const closed = (locked && !sellOnly) || rt.delisted;
    if (sellOnly) ui.side = 'sell';
    document.querySelector('#sideSeg [data-side="buy"]').disabled = sellOnly;
    $('orderForm').hidden = closed;
    $('orderLocked').hidden = !closed;
    if (rt.delisted) {
      $('lockedTitle').textContent = `${s.id} has ${isCoin(s) ? 'collapsed' : 'been delisted'}`;
      $('lockedText').textContent = `${s.name} failed, and its ${units(s)} are worth nothing. Trading in it is closed for good.`;
      return;
    }
    if (locked && !sellOnly) {
      $('lockedTitle').textContent = `${s.id} needs a ${TIERS[s.tier].name} account`;
      $('lockedText').textContent = `You can watch the price and read the news in the meantime. Trading opens once you upgrade.`;
      return;
    }

    const buying = ui.side === 'buy';
    document.querySelectorAll('#sideSeg button').forEach(b => {
      const on = b.dataset.side === ui.side;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const input = $('qtyInput');
    const decimals = qtyDecimals(s);
    input.step = decimals ? 'any' : '1';
    input.min = String(10 ** -decimals);
    input.inputMode = decimals ? 'decimal' : 'numeric';
    $('qtyLabel').textContent = `Number of ${units(s)}`;
    $('qtyMinus').setAttribute('aria-label', `Fewer ${units(s)}`);
    $('qtyPlus').setAttribute('aria-label', `More ${units(s)}`);

    const qty = orderQty();
    const value = qty * rt.price;
    const fee = qty > 0 ? commission(value) : 0;
    const cashAfter = buying ? state.cash - value - fee : state.cash + value - fee;

    $('oPriceLabel').textContent = `Price per ${units(s, 1)}`;
    $('oPrice').textContent = fmtPrice(rt.price);
    $('oTotalLabel').textContent = `${cap1(units(s))} ${buying ? 'cost' : 'sold for'}`;
    $('oTotal').textContent = fmt(value);
    $('oFee').textContent = fmt(fee);
    setV($('oCashAfter'), fmt(cashAfter), cashAfter < 0 ? 'neg' : '');

    let problem = '';
    if (qty <= 0) problem = `Enter how many ${units(s)} to trade.`;
    else if (buying && value + fee > state.cash + 1e-9) problem = `Not enough cash. With the commission you can afford ${fmtQty(s, maxBuyQty(s, rt.price))} ${units(s)}.`;
    else if (!buying && qty > rt.shares + 1e-9) problem = rt.shares ? `You only own ${fmtQty(s, rt.shares)} ${units(s)} of ${s.id}.` : `You don't own any ${s.id} yet.`;

    const btn = $('placeOrderBtn');
    btn.disabled = !!problem;
    btn.className = `btn btn-block ${buying ? 'btn-buy' : 'btn-sell'}`;
    btn.textContent = `${buying ? 'Buy' : 'Sell'}${qty > 0 ? ' ' + fmtQty(s, qty) : ''} ${s.id}`;
    const hint = $('orderHint');
    hint.textContent = problem
      || (sellOnly ? `${s.id} now needs a ${TIERS[s.tier].name} account to buy, but you can always sell what you already own.` : '')
      || `Market order: fills instantly at the current price. The broker takes ${(COMMISSION_RATE * 100).toFixed(2)}% of every trade, at least ${fmt(COMMISSION_MIN)}.`;
    hint.classList.toggle('warn', !!problem);
  }

  function renderPosition(s, rt) {
    $('positionTitle').textContent = `Your ${s.id} ${units(s)}`;
    $('pSharesLabel').textContent = `${cap1(units(s))} owned`;
    const value = rt.shares * rt.price;
    const unrealized = value - rt.costBasis;
    setV($('pShares'), fmtQty(s, rt.shares));
    setV($('pAvg'), rt.shares ? fmtPrice(avgCost(rt)) : '—');
    setV($('pValue'), fmt(value));
    if (rt.shares) setV($('pReturn'), `${fmtSigned(unrealized)} (${fmtPct((unrealized / rt.costBasis) * 100)})`, tone(unrealized));
    else setV($('pReturn'), '—');
    const realized = Math.abs(rt.realized) < 0.005 ? 0 : rt.realized;
    setV($('pRealized'), fmtSigned(realized), realized ? tone(realized) : '');
    $('pDivsRow').hidden = isCoin(s);
    setV($('pDivs'), fmt(rt.dividends), rt.dividends ? 'pos' : '');
  }

  const NEWS_KINDS = { market: 'Economy', earnings: 'Earnings', news: 'Company news', dividend: 'Dividend', listing: 'New listing', ascend: 'Ascension' };
  // the label over a headline: whole-market news, or the ticker and what kind of story it is
  const newsLabel = n => MARKET_TICKERS[n.ticker]
    || `${n.ticker} · ${n.kind === 'news' && isCoin(STOCK_BY_ID[n.ticker]) ? 'News' : NEWS_KINDS[n.kind]}`;

  function newsHtml(list) {
    return list.map(n => `<li class="news-item ${n.mood}">
        <div class="news-meta">${newsLabel(n)} · Day ${Math.max(0, n.day) + 1}</div>
        <div class="news-text">${n.text}</div>
      </li>`).join('') || '<li class="empty">Quiet so far.</li>';
  }

  // The front page carries every headline; each trading room only its own market's.
  function renderNews() {
    const top = state.news[0];
    const key = `${state.tier}:${ui.market}:${state.news.length}:${top ? top.day + top.text : ''}`;
    if (key === renderedNewsKey) return;
    renderedNewsKey = key;

    const visible = state.news.filter(n => MARKET_TICKERS[n.ticker] || (STOCK_BY_ID[n.ticker] && isUnlocked(STOCK_BY_ID[n.ticker])));
    const inMarket = n => {
      const s = STOCK_BY_ID[n.ticker];
      return s ? s.market === ui.market : (n.ticker === 'MKT') === (ui.market === 'stock');
    };
    $('homeNews').innerHTML = newsHtml(visible.slice(0, 20));
    $('newsList').innerHTML = newsHtml(visible.filter(inMarket).slice(0, 20));
  }

  // ---------- Chart ----------
  const chart = $('chart');
  const chartCtx = chart.getContext('2d');
  const CHART = { pos: '#4cc38a', neg: '#ff6f5e', accent: '#f0b73d', ink: '#efe8d8', text: '#857c6c', grid: 'rgba(239,232,216,0.07)' };
  let chartRoom = 70; // room on the right for the price labels, which grow with the price

  function sizeChart() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = chart.getBoundingClientRect();
    if (!width) return;
    chart.width = Math.round(width * dpr);
    chart.height = Math.round(height * dpr);
    drawChart();
  }

  function chartBox() {
    const dpr = window.devicePixelRatio || 1;
    const w = chart.width / dpr;
    const h = chart.height / dpr;
    return { dpr, w, h, left: 4, right: w - chartRoom, top: 12, bottom: h - 26 };
  }

  function daysAgoLabel(days) {
    if (days === 0) return 'Today';
    if (days >= 42) return `${Math.round(days / 21)} months ago`;
    return `${days} days ago`;
  }

  // Axis labels carry just enough decimals to tell neighbouring lines apart,
  // which for a stablecoin hugging $1.00 means more than two.
  function fmtAxis(v, step) {
    if (v < 1) return fmtPrice(v);
    const d = Math.min(6, Math.max(2, 1 - Math.floor(Math.log10(step))));
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function drawChart() {
    if (!onTradeFloor() || !chart.width) return;
    const s = STOCK_BY_ID[ui.selected];
    const rt = rtOf(s.id);
    const data = rt.history.slice(-ui.range);
    const n = data.length;
    const ctx = chartCtx;

    const values = rt.shares ? data.concat(avgCost(rt)) : data;
    let min = Math.min(...values);
    let max = Math.max(...values);
    const pad = (max - min) * 0.08 || max * 0.02;
    min -= pad;
    max += pad;

    ctx.font = '11px "IBM Plex Mono", monospace';
    const labels = [0, 1, 2, 3, 4].map(i => fmtAxis(min + ((max - min) * i) / 4, (max - min) / 4));
    chartRoom = Math.max(70, Math.ceil(Math.max(...labels.map(t => ctx.measureText(t).width))) + 18);

    const box = chartBox();
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);
    const x = i => box.left + (i / (n - 1)) * (box.right - box.left);
    const y = v => box.bottom - ((v - min) / (max - min)) * (box.bottom - box.top);

    // price gridlines + labels
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = min + ((max - min) * i) / 4;
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = CHART.grid;
      ctx.beginPath();
      ctx.moveTo(box.left, yy);
      ctx.lineTo(box.right, yy);
      ctx.stroke();
      ctx.fillStyle = CHART.text;
      ctx.fillText(labels[i], box.right + 10, yy);
    }

    // time labels
    ctx.textBaseline = 'top';
    [0, 1 / 3, 2 / 3, 1].forEach(f => {
      const i = Math.round(f * (n - 1));
      ctx.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center';
      ctx.fillStyle = CHART.text;
      ctx.fillText(daysAgoLabel(n - 1 - i), x(i), box.bottom + 8);
    });

    const up = data[n - 1] >= data[0];
    const color = up ? CHART.pos : CHART.neg;
    const trace = () => data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));

    // area
    const grad = ctx.createLinearGradient(0, box.top, 0, box.bottom);
    grad.addColorStop(0, up ? 'rgba(76,195,138,0.30)' : 'rgba(255,111,94,0.24)');
    grad.addColorStop(1, 'rgba(13,12,10,0)');
    ctx.beginPath();
    trace();
    ctx.lineTo(x(n - 1), box.bottom);
    ctx.lineTo(x(0), box.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // line
    ctx.beginPath();
    trace();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // your average cost
    if (rt.shares) {
      const yy = y(avgCost(rt));
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = CHART.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(box.left, yy);
      ctx.lineTo(box.right, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'italic 13px Newsreader, Georgia, serif';
      ctx.fillStyle = CHART.accent;
      ctx.textAlign = 'left';
      const above = yy > box.top + 16;
      ctx.textBaseline = above ? 'bottom' : 'top';
      ctx.fillText(`you paid ${fmtPrice(avgCost(rt))} a ${units(s, 1)}`, box.left + 6, above ? yy - 4 : yy + 4);
    }

    // latest price marker
    ctx.beginPath();
    ctx.arc(x(n - 1), y(data[n - 1]), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // hover crosshair
    const tip = $('chartTip');
    if (chartHover === null) {
      tip.hidden = true;
      return;
    }
    const i = Math.max(0, Math.min(n - 1, chartHover));
    const hx = x(i);
    const hy = y(data[i]);
    ctx.strokeStyle = 'rgba(239,232,216,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(hx) + 0.5, box.top);
    ctx.lineTo(Math.round(hx) + 0.5, box.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = CHART.ink;
    ctx.fill();

    tip.hidden = false;
    tip.innerHTML = `<strong>${fmtPrice(data[i])}</strong>${daysAgoLabel(n - 1 - i)}`;
    tip.style.left = Math.max(50, Math.min(box.right - 40, hx)) + 'px';
    tip.style.top = hy + 'px';
  }

  chart.addEventListener('mousemove', e => {
    const rect = chart.getBoundingClientRect();
    const box = chartBox();
    const n = Math.min(ui.range, rtOf(ui.selected).history.length);
    const f = (e.clientX - rect.left - box.left) / (box.right - box.left);
    chartHover = Math.round(Math.max(0, Math.min(1, f)) * (n - 1));
    drawChart();
  });
  chart.addEventListener('mouseleave', () => {
    chartHover = null;
    drawChart();
  });

  // ---------- Upgrades ----------
  const tierRefs = [];
  const staffRefs = {};

  function buildUpgrades() {
    const grid = $('tierGrid');
    TIERS.forEach((t, i) => {
      const card = el(`<div class="tier-card tier-${i}">
          <div class="tier-top"><span class="tier-name">${t.name}</span><span class="tier-status"></span></div>
          <div class="tier-blurb">${t.blurb}</div>
          <div class="tier-stocks"></div>
          <div class="reqs">
            <div class="req" data-req="level"><span class="req-icon"></span>Level ${t.level}</div>
            <div class="req" data-req="cash"><span class="req-icon"></span>${fmt(t.cost)} upgrade fee</div>
          </div>
          <div class="tier-spacer"></div>
          <button class="btn btn-tier btn-block"></button>
        </div>`);
      const btn = card.querySelector('button');
      btn.onclick = () => upgradeTier(i);
      grid.appendChild(card);
      tierRefs.push({
        card,
        btn,
        status: card.querySelector('.tier-status'),
        stocks: card.querySelector('.tier-stocks'),
        stocksKey: '',
        reqs: card.querySelector('.reqs'),
        levelReq: card.querySelector('[data-req="level"]'),
        cashReq: card.querySelector('[data-req="cash"]'),
      });
    });

    const list = $('staffList');
    for (const st of STAFF) {
      const row = el(`<div class="staff-row tier-${st.tier}">
          <div class="staff-info">
            <div class="staff-name">${st.name}</div>
            <div class="staff-about">${st.about}</div>
          </div>
          <div class="kv"><span class="label">Fees, less wages</span><span class="v">${fmt(st.income)} − ${fmt(st.salary)}</span></div>
          <div class="kv"><span class="label">On staff</span><span class="v staff-count"></span></div>
          <div class="kv"><span class="label">Team nets</span><span class="v staff-total"></span></div>
          <button class="btn btn-ghost btn-block"></button>
          <div class="staff-team"></div>
        </div>`);
      const btn = row.querySelector('button');
      btn.onclick = () => hire(st);
      list.appendChild(row);
      staffRefs[st.id] = { row, btn, count: row.querySelector('.staff-count'), total: row.querySelector('.staff-total'), team: row.querySelector('.staff-team'), teamKey: '' };
    }
  }

  function setReq(node, met) {
    if (node.classList.contains('met') === met && node.dataset.drawn) return;
    node.dataset.drawn = '1';
    node.classList.toggle('met', met);
    node.querySelector('.req-icon').textContent = met ? '✓' : '·';
  }

  const MOODS = [
    { at: 1.15, text: 'Clients are keen. Fees are running above normal.' },
    { at: 0.9, text: 'Clients are steady. Fees are about normal.' },
    { at: 0.6, text: 'Clients are nervous. Fees have dropped below normal.' },
    { at: 0, text: 'Clients are pulling their money out. Fees are barely coming in.' },
  ];

  function renderUpgrades() {
    const mood = clientMood();
    const moodEl = $('staffMood');
    moodEl.textContent = `${MOODS.find(m => mood >= m.at).text} Wages are paid every day either way.`;
    moodEl.className = 'section-note ' + (mood >= 0.9 ? '' : 'warn-text');

    TIERS.forEach((t, i) => {
      const r = tierRefs[i];
      const owned = i <= state.tier;
      const current = i === state.tier;
      const next = i === state.tier + 1;
      r.card.classList.toggle('current', current);
      const key = boardKey();
      if (r.stocksKey !== key) {
        r.stocks.innerHTML = tkrList(boardStocks().filter(s => s.tier === i && trading(s)));
        r.stocksKey = key;
      }
      r.status.textContent = current ? 'Current' : owned ? 'Unlocked' : next ? 'Next' : 'Locked';
      r.status.className = 'tier-status ' + (current ? 'current' : owned ? 'owned' : '');
      r.reqs.hidden = owned;
      r.btn.hidden = owned;
      setReq(r.levelReq, state.level >= t.level);
      setReq(r.cashReq, state.cash >= t.cost);
      if (owned) return;
      r.btn.disabled = !tierReady(i);
      r.btn.textContent = next ? `Upgrade for ${fmt(t.cost)}` : `After ${TIERS[i - 1].name}`;
    });

    for (const st of STAFF) {
      const r = staffRefs[st.id];
      const locked = state.tier < st.tier;
      const count = state.staff[st.id];
      const cost = staffCost(st);
      r.row.classList.toggle('locked', locked);
      r.count.textContent = count;
      const net = count * (st.income * clientMood() - st.salary);
      r.total.textContent = `${fmtSigned(net)}/day`;
      r.total.className = 'v staff-total ' + (count ? tone(net) : '');
      r.btn.disabled = locked || state.cash < cost;
      r.btn.textContent = locked ? `Needs ${TIERS[st.tier].name}` : `Hire for ${fmt(cost)}`;
      renderTeam(st, r);
    }
  }

  const TEAM_SHOWN = 12;

  // The people in a role, by name. Pressing a name brings up their quirk;
  // otherwise it's the newest hire's.
  function renderTeam(role, r) {
    const team = state.roster.filter(p => p.role === role.id);
    const focus = ui.staffFocus[role.id];
    const key = `${team.length}:${team.length ? team[team.length - 1].name : ''}:${focus}`;
    if (r.teamKey === key) return;
    r.teamKey = key;
    r.team.hidden = !team.length;
    if (!team.length) return;
    const featured = team[focus != null && focus < team.length ? focus : team.length - 1];
    const shown = team.slice(-TEAM_SHOWN).reverse();
    const start = team.length - shown.length;
    r.team.innerHTML = `
      <div class="team-names">${shown.map((p, i) => {
        const index = team.length - 1 - i;
        return `<button class="team-chip${p === featured ? ' on' : ''}" data-role="${role.id}" data-person="${index}">${esc(p.name)}</button>`;
      }).join('')}${start > 0 ? `<span class="team-more">and ${start} more</span>` : ''}</div>
      <p class="team-quote"><b>${esc(featured.name)}</b> ${esc(featured.trait)}.</p>`;
  }

  // ---------- Achievements ----------
  const achRefs = {};

  function buildAchievements() {
    const grid = $('achGrid');
    const categories = [];
    for (const a of ACHIEVEMENTS) if (!categories.includes(a.category)) categories.push(a.category);
    for (const cat of categories) {
      grid.appendChild(el(`<h3 class="ach-category">${cat}</h3>`));
      const row = el('<div class="ach-row"></div>');
      grid.appendChild(row);
      for (const a of ACHIEVEMENTS.filter(x => x.category === cat)) {
        const card = el(`<div class="ach-card">
            <div class="ach-name"></div>
            <p class="ach-blurb"></p>
            <div class="ach-day"></div>
          </div>`);
        row.appendChild(card);
        achRefs[a.id] = {
          card,
          name: card.querySelector('.ach-name'),
          blurb: card.querySelector('.ach-blurb'),
          day: card.querySelector('.ach-day'),
          shown: null,
        };
      }
    }
  }

  function renderAchievements() {
    const total = ACHIEVEMENTS.length;
    const got = ACHIEVEMENTS.filter(a => state.achieved[a.id] != null).length;
    $('achProgress').textContent = `${got} of ${total} unlocked`;
    $('achProgressBar').firstElementChild.style.width = `${(got / total) * 100}%`;

    for (const a of ACHIEVEMENTS) {
      const r = achRefs[a.id];
      const unlockedOn = state.achieved[a.id];
      const unlocked = unlockedOn != null;
      const key = unlocked ? `u${unlockedOn}` : 'locked';
      if (r.shown === key) continue;
      r.shown = key;
      r.card.classList.toggle('unlocked', unlocked);
      const showText = unlocked || !a.hidden;
      r.name.textContent = showText ? a.name : '???';
      r.blurb.textContent = showText ? a.blurb : 'A hidden achievement. Keep playing to find it.';
      r.day.textContent = unlocked ? `Year ${Math.floor(Math.max(0, unlockedOn) / DAYS_PER_YEAR) + 1}, Day ${Math.max(0, unlockedOn) + 1}` : '';
    }
  }

  // ===========================================================
  // GAME LOOP
  // Once a second: pay staff, simulate one trading day, report news.
  // ===========================================================
  function tick() {
    tickCount += 1;

    // One trading day a second at 1x. The speed control multiplies that, or stops it.
    const days = state.speed;
    const events = [];
    for (let i = 0; i < days; i++) events.push(...simulateDay(state));

    // Staff are paid by the trading day, so the wage bill follows the days rather
    // than the clock: run the market faster and the wages speed up with it, pause
    // it and the payroll stops too. The one exception is time this tick did not
    // cover, because a background tab had its timer throttled: the market stays
    // closed for that stretch, but the staff draw wages through it the same way
    // they do while the game is shut.
    const now = Date.now();
    const elapsed = Math.min(OFFLINE_CAP_SEC, Math.max(1, Math.round((now - lastTickAt) / 1000)));
    lastTickAt = now;
    runPayroll(days + elapsed - 1);

    if (events.length) {
      state.news.unshift(...events.slice().reverse());
      state.news.length = Math.min(state.news.length, NEWS_KEEP);

      // the title screen stays quiet
      let shown = ui.screen === 'landing' ? 99 : 0;
      for (const e of events) {
        if (e.paid) {
          if (ui.screen !== 'landing') toast('Dividend received', `+${fmt(e.paid)} from your ${e.shares} ${e.ticker} shares.`, 'pos');
          if (!gainXp(XP.dividend) && ui.screen !== 'landing') playSound('coin', 1500);
          continue;
        }
        // the memecoin pit churns constantly, so its comings and goings only
        // pop up for someone in the pit or holding the coin
        const memeNoise = STOCK_BY_ID[e.ticker] && STOCK_BY_ID[e.ticker].market === 'meme' && ui.screen !== 'meme' && !e.held;
        if (e.kind === 'ascend') {
          if (e.held) unlockAchievement('to_the_moon');
          if (!memeNoise && isUnlocked(STOCK_BY_ID[e.ticker]) && shown++ < 2) {
            toast(`${e.ticker} has ascended`, e.held ? `${e.text}, and you were holding it.` : `${e.text}.`, 'accent');
            if (e.held) confetti(90, ['#f0b73d', '#ad93e8', '#4cc38a']);
          }
          continue;
        }
        if (e.wiped) {
          const s = STOCK_BY_ID[e.ticker];
          const title = e.rug ? 'Rugged' : isCoin(s) ? 'A coin has collapsed' : 'A company has failed';
          toast(title, `${e.ticker} ${e.rug ? 'was pulled by its makers' : 'collapsed'}, and your ${fmtQty(s, e.wiped)} ${units(s, e.wiped)} are now worthless.`, 'neg');
          playSound('fail');
          if (e.rug) unlockAchievement('rugged');
          state.stats.wasBurned = true;
          // aim to recover to whatever your net worth was the day before this hit
          const peakBefore = Math.max(0, ...state.worth.history.slice(0, -1));
          state.stats.burnRecoveryTarget = Math.max(state.stats.burnRecoveryTarget ?? 0, peakBefore);
          continue;
        }
        // a boom or recession starting or ending is news for everyone, holding or not
        if (e.cycle) {
          if (ui.screen === 'landing') continue;
          const phase = CYCLES[e.cycleKind];
          if (e.cycle === 'start') {
            toast(phase.title, `${e.text}. ${phase.startTip}`, phase.startTone);
            playSound(phase.startTone === 'neg' ? 'loss' : 'level');
          } else {
            toast(phase.endTitle, `${e.text}.`, e.mood === 'up' ? 'pos' : 'neg');
          }
          continue;
        }
        if (e.kind === 'dividend') continue;
        if (e.kind === 'listing') {
          if (!memeNoise && isUnlocked(STOCK_BY_ID[e.ticker]) && shown++ < 2) {
            toast(STOCK_BY_ID[e.ticker].market === 'meme' ? 'New memecoin' : 'New on the exchange', e.text, 'accent');
          }
          continue;
        }
        const holds = test => STOCKS.some(s => test(s) && rtOf(s.id).shares > 0);
        const affectsYou = e.ticker === 'MKT' ? holds(s => !isCoin(s))
          : e.ticker === 'CRYPTO' ? holds(isCoin)
          : rtOf(e.ticker).shares > 0;
        if (affectsYou && shown++ < 2) {
          const title = MARKET_TICKERS[e.ticker] ? `${MARKET_TICKERS[e.ticker]} news` : newsLabel(e);
          toast(title, e.text, e.mood === 'up' ? 'pos' : e.mood === 'down' ? 'neg' : '');
        }
      }
    }

    if (tickCount % TIP_EVERY_TICKS === 0) {
      tipIndex += 1;
      updateTip();
    }
    render();
    if (tickCount % SAVE_EVERY_TICKS === 0) saveState();
  }

  // ===========================================================
  // VERSUS — 1v1 matches
  //
  // A match is walled off from the career game on purpose: its own money, its
  // own stock, its own clock, and nothing of it is ever saved. The market comes
  // from sim.js, which works the whole price path out from a seed up front, so
  // two people on the same password are trading an identical market.
  //
  // Everything that talks to an opponent goes through `transport`. Today there
  // are two: a local bot, and a shared-password challenge where the opponent is
  // the stock's own buy-and-hold return. When the matchmaking server lands, it
  // becomes a third transport and none of the rest of this has to change.
  // ===========================================================
  const VS = window.SimStockMatch;

  // Two halves of a password, so "Roll" gives something sayable down a phone.
  const PASS_A = ['copper', 'velvet', 'amber', 'crooked', 'quiet', 'iron', 'paper', 'salted', 'hollow', 'gilded', 'bitter', 'rapid'];
  const PASS_B = ['otter', 'ledger', 'kettle', 'magpie', 'anvil', 'lantern', 'thistle', 'pigeon', 'harbour', 'compass', 'walnut', 'bellow'];

  const vs = {
    risk: 3,
    ticks: 300,
    chart: 'price',  // the trading floor's view of the stock, or the race
    hover: null,
    noteTimer: null,
    stage: 'lobby',
    match: null,     // the match under way, or null
    hosted: null,    // a room open on the server, waiting for somebody to join
    side: 'buy',
    timer: null,
    countTimer: null, // the countdown between the host saying go and the bell
  };

  const vsChart = $('vsChart');
  const vsCtx = vsChart.getContext('2d');

  const rollPassword = () => `${pick(PASS_A)}-${pick(PASS_B)}`;
  // Slashes and spaces separate the parts of a match code, so a password
  // cannot contain them, and case is not worth an argument over the phone.
  const cleanPassword = text => String(text).trim().toLowerCase().replace(/[\s/|]+/g, '-').replace(/^-+|-+$/g, '');
  // The settings are baked into the seed: change the risk or the length and it
  // is a different match, even under the same password.
  const passwordSeed = (password, risk, ticks) => VS.hashSeed(`${password}|${risk}|${ticks}`);
  // The match code is all words, so it can be read down a phone. The risk and
  // the length ride along as words of their own, and only when they are not
  // the usual ones: "copper-otter" is a Lively, Standard match,
  // "copper-otter-wild-long" is not.
  const CODE_RISK = 3;
  const CODE_TICKS = 300;
  const riskWord = risk => VS.RISKS[risk].name.toLowerCase();
  const lengthWord = ticks => matchLength(ticks).label.toLowerCase();
  // Whatever the joiner typed, read back into a password and the settings.
  // Capitals, spaces and slashes do not matter, and the older numbered codes
  // ("copper-otter/3/300") still work.
  function readCode(text) {
    const whole = cleanPassword(text);
    const m = whole.match(/^(.+?)-(\d)-(\d+)$/);
    if (m && VS.RISKS[Number(m[2])] && VS.DURATIONS.some(d => d.ticks === Number(m[3]))) {
      return { password: m[1], risk: Number(m[2]), ticks: Number(m[3]) };
    }
    const parts = whole.split('-');
    let risk = CODE_RISK;
    let ticks = CODE_TICKS;
    const length = parts.length > 1 && VS.DURATIONS.find(d => d.label.toLowerCase() === parts[parts.length - 1]);
    if (length) { ticks = length.ticks; parts.pop(); }
    const level = parts.length > 1 && VS.RISKS.findIndex(r => r && r.name.toLowerCase() === parts[parts.length - 1]);
    if (level > 0) { risk = level; parts.pop(); }
    return { password: parts.join('-'), risk, ticks };
  }
  // The code the host hands over. The short form leaves the usual settings
  // out, but a password that itself ends in a setting's word ("so-long")
  // would read back wrong, so then both words are spelled out.
  function matchCode(password, risk, ticks) {
    const short = [password, risk !== CODE_RISK && riskWord(risk), ticks !== CODE_TICKS && lengthWord(ticks)].filter(Boolean).join('-');
    const back = readCode(short);
    if (back.password === password && back.risk === risk && back.ticks === ticks) return short;
    return [password, riskWord(risk), lengthWord(ticks)].join('-');
  }
  const matchLength = ticks => VS.DURATIONS.find(d => d.ticks === ticks) || { label: 'Custom', ticks, note: `${ticks} ticks` };

  // ---------- transports ----------
  // Each one hands back an opponent: a name, and a way of working out what
  // they are worth at a given tick.

  // The desk bot. It reads the same prices you do, one tick at a time, and
  // trades on them; it cannot see ahead.
  function botOpponent(data, seed) {
    const bot = VS.makeBot(seed);
    const side = { name: `${bot.name} of the desk`, note: bot.label, cash: data.startingCash, shares: 0, worth: [data.startingCash] };
    side.step = tick => {
      side.cash += side.shares * VS.dividendAt(data, tick);
      const move = bot.decide({ tick, ticks: data.ticks, prices: data.prices, cash: side.cash, shares: side.shares });
      if (move) {
        const price = data.prices[tick];
        if (move.side === 'buy') {
          const qty = Math.min(move.qty, Math.floor(side.cash / (price * (1 + VS.COMMISSION_RATE))));
          if (qty > 0) { side.cash -= qty * price + VS.commission(qty * price); side.shares += qty; }
        } else {
          const qty = Math.min(move.qty, side.shares);
          if (qty > 0) { side.cash += qty * price - VS.commission(qty * price); side.shares -= qty; }
        }
      }
      return side.cash + side.shares * data.prices[tick];
    };
    return side;
  }

  // A password match, played apart. Your opponent types the same password and
  // gets the same market; the line you are racing in the meantime is what the
  // stock itself did, which is the one number both of you can compare against.
  function parOpponent(data) {
    const shares = Math.floor(data.startingCash / (data.prices[0] * (1 + VS.COMMISSION_RATE)));
    let cash = data.startingCash - shares * data.prices[0] - VS.commission(shares * data.prices[0]);
    return {
      name: 'Buy and hold',
      note: 'what the stock itself did',
      get cash() { return cash; },
      shares,
      worth: [data.startingCash],
      // Dividends are collected on the way, which is most of what holding a
      // dull stock is for.
      step: tick => {
        cash += shares * VS.dividendAt(data, tick);
        return cash + shares * data.prices[tick];
      },
    };
  }

  // ---------- the match server ----------
  // The server is the referee: it owns the clock, the money and the price
  // path, and reveals prices one tick at a time so neither player can read the
  // end of the match out of their own browser. Without a server the room still
  // works, on the same password, apart — see parOpponent above.
  // ===========================================================
  // The match server this game connects to. Put your own deployment here —
  // it is the only line that needs changing — and nobody has to type an
  // address: the lobby fills it in and connects on its own.
  //
  //   const DEFAULT_SERVER = 'wss://simstock-versus.fly.dev';
  //
  // Left empty, the box starts blank and the room still plays: the practice
  // bot and password matches need no server at all. It has to be wss:// and
  // not ws://, because a page served over https cannot open a plain socket.
  // ===========================================================
  const DEFAULT_SERVER = '';

  const SERVER_KEY = 'simstock.versus.server';
  const NAME_KEY = 'simstock.versus.name';
  const net = { ws: null, status: 'off', note: '', tried: false, ticket: null, resume: null };

  // A dropped socket used to be the end of a match. It is not any more: the
  // server holds the player's money, shares and place in the room for a short
  // while, and the ticket it handed out at the bell is what claims them back.
  // The ticket is kept where a reloaded page can still find it, so a browser
  // that crashes mid-match is the same problem as a wifi blip.
  const TICKET_KEY = 'simstock.versus.ticket';

  function keepTicket(token, graceSec) {
    net.ticket = token || null;
    try {
      if (!token) return sessionStorage.removeItem(TICKET_KEY);
      // Written with a use-by date, so a reload long after a match cannot send
      // the player back to a room that closed while the tab sat there.
      sessionStorage.setItem(TICKET_KEY, `${Date.now() + ((graceSec || 45) + 15) * 1000}|${token}`);
    } catch { /* storage switched off only costs the reload case */ }
  }

  function storedTicket() {
    if (net.ticket) return net.ticket;
    try {
      const kept = sessionStorage.getItem(TICKET_KEY);
      if (!kept) return null;
      const cut = kept.indexOf('|');
      if (cut < 0 || Number(kept.slice(0, cut)) < Date.now()) {
        sessionStorage.removeItem(TICKET_KEY);
        return null;
      }
      return kept.slice(cut + 1);
    } catch { return null; }
  }

  // Accepts whatever somebody pastes in: a bare host, an http:// address, or a
  // proper ws:// one. Anything not plainly local gets the encrypted scheme,
  // because a page served over https cannot open a plain socket anyway.
  function serverUrl(text) {
    let url = String(text || '').trim();
    if (!url) return '';
    url = url.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    if (!/^wss?:\/\//i.test(url)) {
      const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i.test(url);
      url = (local ? 'ws://' : 'wss://') + url;
    }
    return url.replace(/\/+$/, '');
  }

  const netOn = () => net.status === 'on';

  function setNetStatus(status, note) {
    net.status = status;
    net.note = note || '';
    renderVsLobby();
  }

  // Connects on the way into the room the first time, so a player never has to
  // know there is a server. It gives up quietly after one go: somebody who
  // came for the practice bot should not be told about a socket at all, and
  // somebody who disconnected on purpose meant it.
  function autoConnect() {
    if (net.tried || net.ws || !$('vsServerUrl').value.trim()) return;
    net.tried = true;
    netConnect();
  }

  function netConnect() {
    net.tried = true;   // a hand-pressed Connect counts too, so a later visit does not retry
    if (net.ws) return netDisconnect();
    const url = serverUrl($('vsServerUrl').value);
    if (!url) return setNetStatus('off', 'Paste the address of a match server to play live. Without one, a password match still works — you just play it apart and compare the closing numbers.');
    try { localStorage.setItem(SERVER_KEY, url); } catch { /* a locked-down browser is not worth an error */ }
    $('vsServerUrl').value = url;
    setNetStatus('connecting', `Connecting to ${url}…`);

    let ws;
    try { ws = new WebSocket(url); } catch (e) { return setNetStatus('error', `That address will not open: ${e.message}`); }
    net.ws = ws;

    ws.onopen = () => {
      setNetStatus('on', 'Connected. Host a match and give your opponent the password, or join theirs.');
      // A ticket in hand means there is a match waiting to be claimed, either
      // because the socket dropped a moment ago or because the page reloaded
      // under it. Asking costs one message and is refused politely.
      const token = storedTicket();
      if (token) netSend({ t: 'resume', token });
    };
    ws.onmessage = e => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      handleNetMessage(msg);
    };
    ws.onerror = () => { /* onclose carries the outcome; this would only double the noise */ };
    ws.onclose = () => {
      const wasConnected = net.status === 'on';
      net.ws = null;
      // A drop mid-match is no longer the end of it. The match stays on screen
      // and this keeps trying the door until the server's window shuts.
      if (vs.match && vs.match.net && !vs.match.over && storedTicket()) {
        setNetStatus('off', 'The connection dropped. Getting back into the match…');
        return startResuming();
      }
      // A room in its lobby is gone with the socket: the server let it go.
      if (vs.hosted && !vs.hosted.offline) {
        stopCountdown();
        vs.hosted = null;
        if (vs.stage === 'waiting') setVsStage('lobby');
      }
      setNetStatus('off', wasConnected
        ? 'Disconnected from the match server.'
        : 'No match server reachable, so live matches are off. Everything else on this screen still works.');
    };
  }

  // ---------- getting back in ----------
  // Tries the socket again, backing off a little each time, for as long as the
  // server said it would hold the player's place. Nothing about the match is
  // thrown away in the meantime: what comes back from the server replaces it
  // wholesale, and until then the screen shows the last thing that was true.
  function startResuming() {
    const m = vs.match;
    if (!m || net.resume) return;
    const until = Date.now() + Math.max(5, (m.graceSec || 45)) * 1000;
    net.resume = { until, attempt: 0, timer: null };
    m.dropped = true;
    renderNetNote();
    tryResume();
  }

  function tryResume() {
    const r = net.resume;
    if (!r) return;
    if (!vs.match || vs.match.over) return stopResuming();
    if (Date.now() > r.until) return lostMatch();
    r.attempt += 1;
    closeSocketQuietly();   // a half-open attempt from last time is no use to anybody
    netConnect();
    // Each go gets a little longer, but never so long that the window closes
    // between two of them.
    const wait = Math.min(6000, 1200 * r.attempt);
    r.timer = setTimeout(() => {
      if (!net.resume) return;
      if (net.ws && net.ws.readyState === 1 && vs.match && !vs.match.dropped) return;   // back in already
      tryResume();
    }, wait);
  }

  // Puts a socket down without any of the meaning netDisconnect carries: a
  // retry that found the last attempt still hanging must not be read as the
  // player walking out of the match.
  function closeSocketQuietly() {
    const ws = net.ws;
    net.ws = null;
    if (!ws) return;
    ws.onclose = null;
    ws.onmessage = null;
    ws.onopen = null;
    try { ws.close(); } catch { /* already gone */ }
  }

  function stopResuming() {
    if (net.resume) clearTimeout(net.resume.timer);
    net.resume = null;
  }

  // The window has shut: the server has given the match to the other player.
  function lostMatch() {
    stopResuming();
    keepTicket(null);
    leaveMatch();
    toast('The connection did not come back', 'The match went to your opponent when the time ran out.', 'neg');
  }

  function netDisconnect() {
    const ws = net.ws;
    net.ws = null;
    stopResuming();
    keepTicket(null);
    if (ws) { ws.onclose = null; try { ws.close(); } catch { /* already gone */ } }
    if (vs.match && vs.match.net) leaveMatch();
    setNetStatus('off', 'Disconnected.');
  }

  const netSend = msg => { if (net.ws && net.ws.readyState === 1) net.ws.send(JSON.stringify(msg)); };
  const myName = () => $('vsName').value.trim().slice(0, 18) || 'Trader';

  function handleNetMessage(msg) {
    switch (msg.t) {
      case 'hosted':
        // The host's own room, with nobody in it yet but them.
        stopCountdown();
        vs.hosted = { ...msg, host: true, players: [msg.you] };
        setVsStage('waiting');
        return;
      case 'lobby':
        // Somebody came in or went out. Nothing is moving until the host
        // starts it, so whoever joined second is not behind.
        stopCountdown();
        vs.hosted = { ...msg };
        setVsStage('waiting');
        return;
      case 'countdown':
        return startCountdown(msg.seconds);
      case 'start':
        return beginNetMatch(msg);
      case 'tick':
        return netTick(msg);
      case 'filled':
        return netFilled(msg);
      case 'over':
        return netOver(msg);
      case 'resumed':
        return resumeNetMatch(msg);
      case 'opponent_gone':
        return opponentGone(msg);
      case 'opponent_back':
        return opponentBack(msg);
      case 'rematch_offer':
        return rematchOffered(msg);
      case 'rematch_off':
        return rematchOff(msg);
      case 'error':
        // A refused ticket is the one error that settles something: the match
        // it was for is over, or somebody else is already holding that seat.
        if (msg.code === 'no_match' && vs.match && vs.match.net && vs.match.dropped) return lostMatch();
        if (msg.code === 'still_here') return;
        if (msg.code === 'host_left' && vs.stage === 'waiting') {
          stopCountdown();
          vs.hosted = null;
          setVsStage('lobby');
          return toast('The room closed', 'The host left before the match started.', 'neg');
        }
        // An error while waiting sends you back; one mid-match is just a
        // refused order, and the match carries on.
        if (vs.stage === 'waiting') { stopCountdown(); vs.hosted = null; setVsStage('lobby'); }
        return toast('The server said no', msg.message || msg.code, 'neg');
      default:
        return;
    }
  }

  // The few seconds between the host's "start" and the bell, counted down on
  // both screens. The server's clock is the one that starts the match; this
  // is only there so nobody is caught looking the other way.
  function startCountdown(seconds) {
    const h = vs.hosted;
    if (!h) return;
    stopCountdown();
    h.counting = Math.max(0, Math.round(seconds));
    renderVsWaiting();
    vs.countTimer = setInterval(() => {
      if (!vs.hosted || vs.hosted.counting == null) return stopCountdown();
      vs.hosted.counting = Math.max(0, vs.hosted.counting - 1);
      renderVsWaiting();
    }, 1000);
  }

  function stopCountdown() {
    clearInterval(vs.countTimer);
    vs.countTimer = null;
    if (vs.hosted) vs.hosted.counting = null;
  }

  function beginNetMatch(msg) {
    stopCountdown();
    vs.hosted = null;
    keepTicket(msg.token, msg.graceSec);
    stopResuming();
    vs.match = {
      net: true,
      mode: 'online',
      password: msg.password,
      risk: msg.risk,
      ticks: msg.ticks,
      seed: null,                    // handed over only once the match is done
      // The path starts as just the opening price and grows a tick at a time.
      data: { stock: msg.stock, startingCash: msg.startingCash, ticks: msg.ticks, prices: [msg.price], eps: [msg.eps || msg.stock.start / msg.stock.pe], news: [], dividends: [] },
      tick: 0,
      me: { cash: msg.startingCash, shares: 0, spent: 0, bought: 0, trades: 0, fees: 0, divs: 0, worth: [msg.startingCash] },
      them: { name: msg.them.name, note: 'your opponent', worth: [msg.startingCash] },
      seenNews: 0,
      over: false,
      graceSec: msg.graceSec || 45,
      dropped: false,
      theirDrop: null,
    };
    vs.side = 'buy';
    $('vsQty').value = '1';
    clearInterval(vs.timer);
    vs.timer = null;
    setVsStage('live');
    sizeVsChart();
    toast('The bell goes', `${msg.stock.name} at ${fmtPrice(msg.price)}, against ${msg.them.name}.`, 'accent');
    playSound('level');
  }

  // Back in. Everything that was missed comes in one piece, and the server's
  // version of the match replaces whatever was left on screen.
  function resumeNetMatch(msg) {
    stopResuming();
    keepTicket(msg.token, msg.graceSec);
    const startingCash = msg.startingCash;
    vs.hosted = null;
    vs.match = {
      net: true,
      mode: 'online',
      password: msg.password,
      risk: msg.risk,
      ticks: msg.ticks,
      seed: null,
      data: {
        stock: msg.stock,
        startingCash,
        ticks: msg.ticks,
        prices: msg.prices,
        eps: msg.eps || [],
        news: msg.news || [],
        dividends: [],
      },
      tick: msg.tick,
      me: {
        cash: msg.you.cash,
        shares: msg.you.shares,
        spent: msg.you.spent || 0,
        bought: msg.you.bought || 0,
        trades: msg.you.trades,
        fees: msg.you.fees,
        divs: msg.you.dividends || 0,
        serverWorth: msg.you.worth,
        worth: [],
      },
      them: { name: msg.them.name, note: 'your opponent', worth: [] },
      // Read as seen: catching up on five minutes of headlines as toasts would
      // bury the screen. They are all in the list to scroll back through.
      seenNews: (msg.news || []).length,
      over: false,
      graceSec: msg.graceSec || 45,
      dropped: false,
      theirDrop: msg.them.gone ? Date.now() : null,
    };
    // There is no record of what either net worth did while away, so both
    // lines start again from the figures that are true now.
    const m = vs.match;
    for (let i = 0; i <= m.tick; i++) {
      m.me.worth.push(msg.you.worth);
      m.them.worth.push(msg.them.worth);
    }
    vs.side = 'buy';
    $('vsQty').value = '1';
    clearInterval(vs.timer);
    vs.timer = null;
    setVsStage('live');
    sizeVsChart();
    renderNetNote();
    toast('Back in the match', `${msg.stock.name} at ${fmtPrice(msg.prices[msg.tick])}, with ${vsClockText(msg.ticks - msg.tick)} left.`, 'pos');
    playSound('level');
  }

  function opponentGone(msg) {
    const m = vs.match;
    if (!m || !m.net || m.over) return;
    m.theirDrop = Date.now();
    m.graceSec = msg.seconds || m.graceSec;
    renderNetNote();
    toast('Your opponent dropped out', `${msg.name} has ${msg.seconds} seconds to get back in, or the match is yours.`, 'accent');
  }

  function opponentBack(msg) {
    const m = vs.match;
    if (!m || !m.net || m.over) return;
    m.theirDrop = null;
    renderNetNote();
    toast('Your opponent is back', `${msg.name} made it back in.`, 'accent');
  }

  // One line across the top of the match saying who is missing and for how
  // much longer, because a frozen opponent with no explanation looks broken.
  function renderNetNote() {
    const m = vs.match;
    const note = $('vsNetNote');
    if (!note) return;
    if (!m || !m.net || m.over || (!m.dropped && !m.theirDrop)) {
      note.hidden = true;
      clearInterval(vs.noteTimer);
      vs.noteTimer = null;
      return;
    }
    note.hidden = false;
    // Nothing else is arriving while somebody is away, so the seconds have to
    // come off the clock under their own steam.
    if (!vs.noteTimer) vs.noteTimer = setInterval(renderNetNote, 1000);
    if (m.dropped) {
      const left = net.resume ? Math.max(0, Math.ceil((net.resume.until - Date.now()) / 1000)) : m.graceSec;
      note.className = 'versus-net-note neg';
      note.textContent = `The connection dropped. Getting back in — ${left}s before the match goes to your opponent.`;
      return;
    }
    const left = Math.max(0, m.graceSec - Math.floor((Date.now() - m.theirDrop) / 1000));
    note.className = 'versus-net-note';
    note.textContent = `${m.them.name} has dropped out. ${left}s before the match is yours. Their position is frozen where they left it.`;
  }

  function netTick(msg) {
    const m = vs.match;
    if (!m || !m.net || m.over) return;
    const first = m.tick + 1;
    msg.prices.forEach(p => m.data.prices.push(p));
    m.data.news.push(...msg.news);
    m.tick = msg.tick;
    // The server's figures win outright; nothing here is the client's to decide.
    m.me.cash = msg.you.cash;
    m.me.shares = msg.you.shares;
    m.me.serverWorth = msg.you.worth;
    // The profits arrive with the prices, so the panel can show a P/E online
    // that is the same one the offline game works out for itself.
    if (msg.eps) msg.eps.forEach(e => m.data.eps.push(e));
    if (msg.you.dividends != null && msg.you.dividends > (m.me.divs || 0)) {
      const paid = msg.you.dividends - m.me.divs;
      m.me.divs = msg.you.dividends;
      toast('Dividend paid', `${fmt(paid)} from ${m.data.stock.name}, straight into your cash.`, 'pos');
    }

    // Normally one tick arrives at a time. If the tab was asleep and several
    // turned up at once, the missing points are filled in between the last
    // known worth and this one, which is honest enough for a chart.
    const fromThem = m.them.worth[m.them.worth.length - 1];
    const steps = m.data.prices.length - m.me.worth.length;
    for (let i = 1; i <= steps; i++) {
      const at = m.me.worth.length;
      m.me.worth.push(m.me.cash + m.me.shares * m.data.prices[at]);
      m.them.worth.push(fromThem + ((msg.them.worth - fromThem) * i) / steps);
    }

    for (; m.seenNews < m.data.news.length; m.seenNews++) {
      const n = m.data.news[m.seenNews];
      if (n.tick >= first) vsNewsToast(n, m.me.shares > 0);
    }
    renderVersus();
  }

  function netFilled(msg) {
    const m = vs.match;
    if (!m || !m.net) return;
    m.me.cash = msg.cash;
    m.me.shares = msg.shares;
    m.me.fees += msg.fee;
    m.me.trades += 1;
    if (msg.side === 'buy') { m.me.spent += msg.qty * msg.price; m.me.bought += msg.qty; }
    playSound('buy', 120);
    $('vsQty').value = '1';
    renderVersus();
  }

  function netOver(msg) {
    const m = vs.match;
    if (!m || !m.net || m.over) return;
    m.over = true;
    m.dropped = false;
    m.theirDrop = null;
    stopResuming();
    keepTicket(null);
    renderNetNote();
    m.seed = msg.seed;
    m.data.prices = msg.prices;          // the whole path, now it can do no harm
    m.tick = msg.tick;
    m.me.trades = msg.you.trades;
    m.me.fees = msg.you.fees;
    if (msg.you.dividends != null) m.me.divs = msg.you.dividends;
    m.forfeit = msg.reason === 'forfeit';
    m.outcome = msg.outcome;
    m.them.name = msg.them.name;
    m.final = { me: msg.you.worth, them: msg.them.worth };
    m.rematch = !!msg.rematch;
    m.asked = false;
    m.offered = false;
    m.rematchNote = msg.rematch
      ? 'Both of you are still here. Another one is two clicks away.'
      : msg.reason === 'forfeit'
        ? 'One of you walked out, so there is nobody to play again. Host or join another match from the lobby.'
        : 'Host or join another match from the lobby to go again.';
    setVsStage('over');
    renderVersusResult();
    if (msg.outcome === 'win') { playSound('achieve'); confetti(90, ['#f0b73d', '#4cc38a', '#7fb2d6']); }
    else playSound('loss');
  }

  // A match's headlines now come in the same kinds the trading floor's do, so
  // they are announced the same way: an in-line earnings report is not bad
  // news, and a dividend is not news at all to the player who was just paid it.
  const VS_NEWS_KIND = { market: 'Economy', earnings: 'Earnings', news: 'Company news', dividend: 'Dividend' };

  function vsNewsToast(n, holding) {
    if (n.kind === 'dividend' && holding) return;   // they get told what they were paid instead
    const title = VS_NEWS_KIND[n.kind] || (n.mood === 'up' ? 'Good news' : 'Bad news');
    toast(title, n.text, n.mood === 'up' ? 'pos' : n.mood === 'down' ? 'neg' : 'accent');
  }

  // ---------- starting and ending ----------
  function startMatch({ seed, risk, ticks, password, mode }) {
    const data = VS.generateMatch({ seed, risk, ticks });
    const them = mode === 'bot' ? botOpponent(data, seed) : parOpponent(data);
    vs.match = {
      data, password, mode, seed, risk, ticks,
      startedAt: Date.now(),
      tick: 0,
      me: { cash: data.startingCash, shares: 0, spent: 0, bought: 0, trades: 0, fees: 0, divs: 0, worth: [data.startingCash] },
      them,
      seenNews: 0,
      over: false,
    };
    vs.side = 'buy';
    $('vsQty').value = '1';
    setVsStage('live');
    // The clock is read off the wall, not counted, so a throttled background
    // tab catches up instead of quietly falling behind its opponent.
    clearInterval(vs.timer);
    vs.timer = setInterval(matchTick, 250);
    matchTick();
    sizeVsChart();
    toast('The bell goes', `${data.stock.name} at ${fmtPrice(data.prices[0])}. ${matchLength(ticks).note} on the clock.`, 'accent');
    playSound('level');
  }

  function leaveMatch(toLobby = true) {
    clearInterval(vs.timer);
    vs.timer = null;
    clearInterval(vs.noteTimer);
    vs.noteTimer = null;
    stopResuming();
    keepTicket(null);
    stopCountdown();
    // Walking out of an online match forfeits it, so the server hears about it
    // before the screen changes.
    if ((vs.match && vs.match.net) || (vs.hosted && !vs.hosted.offline)) netSend({ t: 'leave' });
    vs.match = null;
    vs.hosted = null;
    if (toLobby) setVsStage('lobby');
  }

  function matchTick() {
    const m = vs.match;
    if (!m || m.over || m.net) return;   // an online match is stepped by the server
    const elapsed = Math.floor((Date.now() - m.startedAt) / 1000);
    const tick = Math.min(m.ticks, elapsed);

    // Catch the opponent up one tick at a time, so a bot that missed a chance
    // while the tab was hidden really did miss it.
    while (m.tick < tick) {
      m.tick += 1;
      // A dividend is paid on the shares held at that tick, to whoever holds
      // them — the same rule the trading floor pays by.
      const perShare = VS.dividendAt(m.data, m.tick);
      if (perShare && m.me.shares > 0) {
        const paid = perShare * m.me.shares;
        m.me.cash += paid;
        m.me.divs += paid;
        toast('Dividend paid', `${fmt(paid)} from ${m.data.stock.name}, straight into your cash.`, 'pos');
      }
      m.them.worth.push(m.them.step(m.tick));
      m.me.worth.push(m.me.cash + m.me.shares * m.data.prices[m.tick]);
    }

    for (; m.seenNews < m.data.news.length; m.seenNews++) {
      const n = m.data.news[m.seenNews];
      if (n.tick > m.tick) break;
      if (n.tick > m.tick - 3) vsNewsToast(n, m.me.shares > 0);
    }

    if (tick >= m.ticks) return endMatch();
    renderVersus();
  }

  function endMatch() {
    const m = vs.match;
    m.over = true;
    clearInterval(vs.timer);
    vs.timer = null;
    // Everything is marked to the closing price; nobody is paid for holding on.
    m.final = {
      me: m.me.cash + m.me.shares * m.data.prices[m.ticks],
      them: m.them.worth[m.them.worth.length - 1],
    };
    setVsStage('over');
    renderVersusResult();
    const won = m.final.me > m.final.them;
    playSound(won ? 'achieve' : 'loss');
    if (won) confetti(90, ['#f0b73d', '#4cc38a', '#7fb2d6']);
  }

  // ---------- trading ----------
  const vsPrice = () => vs.match.data.prices[vs.match.tick];

  function vsOrderQty() {
    const n = Math.floor(Number($('vsQty').value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  const vsMaxBuy = price => Math.floor(vs.match.me.cash / (price * (1 + VS.COMMISSION_RATE)));

  function placeVsOrder() {
    const m = vs.match;
    if (!m || m.over) return;
    const price = vsPrice();
    const qty = vsOrderQty();
    if (!qty) return;

    // Online, the server fills the order and tells us what happened. Guessing
    // at the outcome here would only mean showing a number that is about to be
    // corrected.
    if (m.net) return netSend({ t: 'order', side: vs.side, qty });

    if (vs.side === 'buy') {
      if (qty > vsMaxBuy(price)) return toast("That's more than you can afford", 'Trim the order, or press Max.', 'neg');
      const value = qty * price;
      const fee = VS.commission(value);
      m.me.cash -= value + fee;
      m.me.shares += qty;
      m.me.spent += value;
      m.me.bought += qty;
      m.me.fees += fee;
    } else {
      if (qty > m.me.shares) return toast("You don't have that many", 'Sell what you hold, or press Max.', 'neg');
      const value = qty * price;
      const fee = VS.commission(value);
      m.me.cash += value - fee;
      m.me.shares -= qty;
      m.me.fees += fee;
    }
    m.me.trades += 1;
    playSound('buy', 120);
    $('vsQty').value = '1';
    renderVersus();
  }

  // ---------- the lobby ----------
  function hostMatch() {
    const password = cleanPassword($('vsHostPass').value);
    if (!password) {
      $('vsHostPass').value = rollPassword();
      renderVsLobby();
      return toast('Pick a password first', 'One has been rolled for you. Start again and give your opponent the code.', 'accent');
    }
    $('vsHostPass').value = password;
    // Connected, the server holds the room and the settings and waits for an
    // opponent. Not connected, the password itself is the market.
    if (netOn()) return netSend({ t: 'host', password, risk: vs.risk, ticks: vs.ticks, name: myName() });
    // Offline the settings travel with the password, so the host is shown the
    // whole code to hand over before the clock starts, not after the bell.
    vs.hosted = { offline: true, password, risk: vs.risk, ticks: vs.ticks, code: matchCode(password, vs.risk, vs.ticks) };
    setVsStage('waiting');
  }

  function startHostedMatch() {
    const h = vs.hosted;
    if (!h) return;
    // Online the server starts it, for both players at once.
    if (!h.offline) {
      if (h.host && h.players && h.players.length > 1 && h.counting == null) netSend({ t: 'begin' });
      return;
    }
    vs.hosted = null;
    startMatch({ seed: passwordSeed(h.password, h.risk, h.ticks), risk: h.risk, ticks: h.ticks, password: h.password, mode: 'password' });
  }

  function joinMatch() {
    const code = $('vsJoinPass').value.trim();
    if (!code) return toast('That code is empty', 'Type the one your opponent gave you.', 'neg');
    $('vsJoinNote').textContent = '';
    // Online there is nothing to agree on: the host's room already knows the
    // risk and the length, so the password is sent just as typed.
    if (netOn()) return netSend({ t: 'join', password: cleanPassword(code), name: myName() });
    // Until there is a server to hold the settings, they travel inside the
    // code as words — see matchCode.
    const { password, risk, ticks } = readCode(code);
    if (!password) return toast('That code is empty', 'Type the one your opponent gave you.', 'neg');
    startMatch({ seed: passwordSeed(password, risk, ticks), risk, ticks, password, mode: 'password' });
  }

  function practiceMatch() {
    startMatch({ seed: VS.randomSeed(), risk: vs.risk, ticks: vs.ticks, password: null, mode: 'bot' });
  }

  function setVsStage(stage) {
    vs.stage = stage;
    $('vsLobby').hidden = stage !== 'lobby';
    $('vsWaiting').hidden = stage !== 'waiting';
    $('vsLive').hidden = stage !== 'live';
    $('vsOver').hidden = stage !== 'over';
    if (stage === 'lobby') renderVsLobby();
    if (stage === 'waiting') renderVsWaiting();
    if (stage === 'live') { renderVersus(); sizeVsChart(); }
  }

  function renderVsWaiting() {
    const h = vs.hosted;
    if (!h) return setVsStage('lobby');
    $('vsWaitSettings').textContent = `Risk ${h.risk}, ${VS.RISKS[h.risk].name} · ${matchLength(h.ticks).note}`;
    if (h.offline) {
      $('vsWaitHead').textContent = 'Hand over the code';
      $('vsWaitNote').textContent = 'Give your opponent this code, exactly as it is. With no match server you each play the same market apart, so start whenever you are ready and compare closing numbers.';
      $('vsWaitCode').textContent = h.code;
      $('vsWaitPlayers').hidden = true;
      $('vsWaitDots').hidden = true;
      $('vsStartBtn').hidden = false;
      $('vsStartBtn').disabled = false;
      $('vsStartBtn').textContent = 'Start trading';
      $('vsCancelBtn').textContent = 'Cancel the match';
      return;
    }

    // Online this is the room's lobby: who is in it, and for the host, the
    // button that starts the match for both of them at once.
    const players = h.players || [];
    const both = players.length > 1;
    const counting = h.counting != null;
    const hostName = players[0] ? players[0].name : 'the host';
    $('vsWaitHead').textContent = counting
      ? (h.counting > 0 ? `Starting in ${h.counting}` : 'The bell goes')
      : h.host ? (both ? 'Your opponent is here' : 'Waiting for an opponent') : 'In the lobby';
    $('vsWaitNote').textContent = counting
      ? 'Eyes on the market. It opens for both of you at the same moment.'
      : h.host
        ? (both ? 'Start the match when you are both ready. The clock does not run until you do.' : 'Give them this password. The risk and the length are held by the server, so it is all they need.')
        : `Waiting for ${hostName} to start the match. Nothing moves until they do, so you are not missing anything.`;
    $('vsWaitCode').textContent = h.password;
    $('vsWaitPlayers').hidden = false;
    const rows = players.map((p, i) => `<li><span>${esc(p.name)}</span><span class="tag">${i === 0 ? 'host' : 'opponent'}${(i === 0) === !!h.host ? ' · you' : ''}</span></li>`);
    if (!both) rows.push('<li class="empty"><span>Waiting for an opponent\u2026</span></li>');
    $('vsWaitPlayers').innerHTML = rows.join('');
    $('vsWaitDots').hidden = counting || (h.host && both);
    $('vsStartBtn').hidden = !h.host;
    $('vsStartBtn').disabled = !both || counting;
    $('vsStartBtn').textContent = both ? 'Start the match' : 'Waiting for an opponent';
    $('vsCancelBtn').textContent = h.host ? 'Close the room' : 'Leave the room';
  }

  function renderVsLobby() {
    const level = VS.RISKS[vs.risk];
    $('vsRiskName').textContent = `${level.name}.`;
    $('vsRiskBlurb').textContent = level.blurb;
    document.querySelectorAll('#vsRiskSeg button').forEach(b => {
      const on = Number(b.dataset.risk) === vs.risk;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('#vsLenSeg button').forEach(b => {
      const on = Number(b.dataset.ticks) === vs.ticks;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const STATUS = { off: 'Offline', connecting: 'Connecting', on: 'Live', error: 'Trouble' };
    $('vsStatus').textContent = STATUS[net.status];
    $('vsDot').className = `versus-dot versus-dot-${net.status}`;
    $('vsConnectBtn').textContent = net.ws ? 'Disconnect' : 'Connect';
    $('vsServerNote').textContent = net.note;
    $('vsServerUrl').disabled = !!net.ws;
    $('vsName').disabled = !!net.ws;

    const live = netOn();
    $('vsHostBtn').textContent = live ? 'Open the room' : 'Start the match';
    $('vsJoinPass').placeholder = live ? 'their password' : 'their match code';
    $('vsJoinCardNote').textContent = live
      ? 'Type the password your opponent is hosting on. The risk and the length come from their room, so there is nothing else to agree on.'
      : 'Type the match code your opponent gave you, word for word. The risk and the length are in it.';

    const pass = cleanPassword($('vsHostPass').value);
    $('vsFootnote').textContent = live
      ? (pass ? `Your opponent only needs the password: ${pass}` : 'Pick a password and open the room.')
      : pass
        ? `No server, so you play the same market apart. Give your opponent the code: ${matchCode(pass, vs.risk, vs.ticks)}`
        : 'Without a match server you can still race the same market apart, on a shared code, and compare the closing numbers afterwards.';
  }

  const vsClockText = left => `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  function renderVersus() {
    const m = vs.match;
    if (!m || vs.stage !== 'live') return;
    const price = vsPrice();
    const start = m.data.prices[0];
    const mine = m.net && m.me.serverWorth != null ? m.me.serverWorth : m.me.cash + m.me.shares * price;
    const theirs = m.them.worth[m.them.worth.length - 1];

    $('vsMeName').textContent = 'You';
    $('vsMeWorth').textContent = fmt(mine);
    $('vsMeChange').innerHTML = chg(((mine / m.data.startingCash) - 1) * 100);
    $('vsThemName').textContent = m.them.name;   // textContent, because an online name is somebody else's typing
    $('vsThemWorth').textContent = fmt(theirs);
    $('vsThemChange').innerHTML = chg(((theirs / m.data.startingCash) - 1) * 100);
    $('vsLive').classList.toggle('versus-ahead', mine >= theirs);

    const left = m.ticks - m.tick;
    $('vsClock').textContent = vsClockText(left);
    $('vsClock').classList.toggle('urgent', left <= 15);
    $('vsClockFill').style.width = `${(m.tick / m.ticks) * 100}%`;
    $('vsClockNote').textContent = m.them.note;

    $('vsMeta').textContent = `${m.data.stock.id} · ${m.data.stock.sector} · Risk ${m.risk}, ${VS.RISKS[m.risk].name}`;
    $('vsStockName').textContent = m.data.stock.name;
    $('vsPrice').textContent = fmtPrice(price);
    $('vsChange').innerHTML = chg(((price / start) - 1) * 100);
    $('vsAbout').textContent = m.data.stock.about;
    renderVsStock(m, price);

    const seen = m.data.news.filter(n => n.tick <= m.tick).slice(-8).reverse();
    $('vsNews').innerHTML = seen.length
      ? seen.map(n => `<li class="news-item ${n.mood}"><span class="news-meta">${VS_NEWS_KIND[n.kind] || 'News'} · ${vsClockText(m.ticks - n.tick)} left</span><div class="news-text">${esc(n.text)}</div></li>`).join('')
      : '<li class="empty">Nothing on the wire yet.</li>';

    // the ticket
    document.querySelectorAll('#vsSideSeg button').forEach(b => {
      const on = b.dataset.side === vs.side;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    const qty = vsOrderQty();
    const value = qty * price;
    const fee = VS.commission(value);
    const buying = vs.side === 'buy';
    $('vsOPrice').textContent = fmtPrice(price);
    $('vsOTotal').textContent = fmt(value);
    $('vsOFee').textContent = fmt(fee);
    $('vsOCash').textContent = fmt(buying ? m.me.cash - value - fee : m.me.cash + value - fee);
    const btn = $('vsOrderBtn');
    btn.textContent = buying ? `Buy ${qty || 0}` : `Sell ${qty || 0}`;
    btn.className = `btn btn-block ${buying ? 'btn-buy' : 'btn-sell'}`;
    const blocked = !!m.dropped || !qty || (buying ? qty > vsMaxBuy(price) : qty > m.me.shares);
    btn.disabled = blocked;
    $('vsOrderHint').textContent = m.dropped ? 'The connection is down. Your position is held where it is until you are back.'
      : !qty ? 'Enter a number of shares.'
      : buying && qty > vsMaxBuy(price) ? `You can afford ${vsMaxBuy(price)} at this price.`
      : !buying && qty > m.me.shares ? `You hold ${m.me.shares}.`
      : buying ? `${vsMaxBuy(price)} is the most you can buy right now.`
      : `${m.me.shares} shares on the book.`;

    const avg = m.me.bought ? m.me.spent / m.me.bought : 0;
    $('vsPCash').textContent = fmt(m.me.cash);
    $('vsPShares').textContent = m.me.shares.toLocaleString('en-US');
    $('vsPAvg').textContent = avg ? fmtPrice(avg) : '—';
    $('vsPValue').textContent = fmt(m.me.shares * price);
    $('vsPDivsRow').hidden = !m.data.stock.divYield;
    $('vsPDivs').textContent = fmt(m.me.divs || 0);
    $('vsPWorth').textContent = fmt(mine);

    renderNetNote();
    drawVsChart();
  }

  // Everything the trading floor shows about a stock, for the one in a match:
  // where it is in its range, what it is worth against its profits, and when
  // the next report and dividend are due.
  function renderVsStock(m, price) {
    const s = m.data.stock;
    const seen = m.data.prices.slice(0, m.tick + 1);
    let low = seen[0];
    let high = seen[0];
    for (const p of seen) {
      if (p < low) low = p;
      if (p > high) high = p;
    }
    const spread = high - low;
    $('vsR52Lo').textContent = fmtPrice(low);
    $('vsR52Hi').textContent = fmtPrice(high);
    $('vsR52Dot').style.left = (spread > 0 ? ((price - low) / spread) * 100 : 50) + '%';
    $('vsR52Note').innerHTML = price >= high ? '<span class="pos">At its high for the match</span>'
      : price <= low ? '<span class="neg">At its low for the match</span>'
      : `${((price / low - 1) * 100).toFixed(1)}% above the low · ${((1 - price / high) * 100).toFixed(1)}% below the high`;

    // Online, the server hands the profits over with each tick; offline they
    // are in the path already. Either way the P/E is the real one.
    const eps = m.data.eps ? m.data.eps[Math.min(m.tick, m.data.eps.length - 1)] : 0;
    const ret = (price / seen[0] - 1) * 100;
    let moves = 0;
    for (let i = 1; i < seen.length; i++) moves += Math.abs(seen[i] / seen[i - 1] - 1);
    const typical = seen.length > 1 ? (moves / (seen.length - 1)) * 100 : 0;

    const cells = [
      { label: 'Market cap', value: fmtBig(price * s.sharesOut), note: 'What all its shares are worth together' },
      { label: 'P/E ratio', value: eps > 0 ? (price / eps).toFixed(1) : '—', note: "Price divided by a year's profit per share" },
      { label: 'Earnings per share', value: eps > 0 ? fmt(eps) : '—', note: "A year's profit, split across every share" },
      { label: 'Dividend yield', value: s.divYield ? `${(s.divYield * 100).toFixed(1)}% · ${fmt(price * s.divYield)} a share` : 'None', note: 'Cash paid out each year, as a share of price' },
      { label: 'Since the bell', value: fmtPct(ret), tone: tone(ret), note: 'How much the price has changed this match' },
      { label: 'Typical tick', value: `±${typical.toFixed(2)}%`, note: 'How far the price usually moves in a tick' },
      { label: 'Risk', value: `${m.risk} of 5 · swings ${Math.round(s.vol * 100)}%/yr`, note: VS.RISKS[m.risk].blurb },
      { label: 'Beta', value: s.beta.toFixed(2), note: '1.00 moves with the market; higher swings more' },
    ];
    $('vsStatGrid').innerHTML = cells
      .map(c => `<div class="stat"><dt>${esc(c.label)}</dt><dd class="${c.tone || ''}">${esc(c.value)}</dd><small>${esc(c.note)}</small></div>`)
      .join('');

    const ticks = n => `in ${n} tick${n === 1 ? '' : 's'}`;
    const toEarnings = VS.nextEarnings(s, m.tick);
    $('vsCalEarningsRow').hidden = false;
    $('vsCalEarnings').textContent = toEarnings > m.ticks - m.tick
      ? 'not before the bell'
      : `${ticks(toEarnings)} (${vsClockText(m.ticks - m.tick - toEarnings)} left)`;
    const toDividend = VS.nextDividend(s, m.tick);
    $('vsCalDividendRow').hidden = !s.divYield;
    if (s.divYield) {
      $('vsCalDividend').textContent = toDividend > m.ticks - m.tick
        ? 'not before the bell'
        : `~${fmt((price * s.divYield) / 4)}/share ${ticks(toDividend)}`;
    }

    document.querySelectorAll('#vsChartSeg button').forEach(b => {
      const on = b.dataset.chart === vs.chart;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
  }

  function renderVersusResult() {
    const m = vs.match;
    const mine = m.final.me;
    const theirs = m.final.them;
    // Where a server refereed the match its verdict is the one that counts: a
    // forfeit is won by staying, whatever the two of you were worth.
    const won = m.outcome ? m.outcome === 'win' : mine > theirs;
    const drew = m.outcome ? m.outcome === 'draw' : Math.abs(mine - theirs) < 0.005;

    $('vsVerdict').textContent = drew ? 'A dead heat' : won ? 'You win' : 'You lose';
    $('vsVerdict').className = `versus-verdict ${drew ? '' : won ? 'pos' : 'neg'}`;
    $('vsVerdictNote').textContent = m.forfeit
      ? (won ? `${m.them.name} walked out, so the match is yours.` : 'You walked out, so the match went the other way.')
      : drew
        ? `Both of you closed on ${fmt(mine)}. Somebody had better go again.`
        : `${fmt(Math.abs(mine - theirs))} in it after ${matchLength(m.ticks).note} on ${m.data.stock.name}.`;

    $('vsResMe').className = `versus-result-card ${won && !drew ? 'winner' : ''}`;
    $('vsResThem').className = `versus-result-card ${!won && !drew ? 'winner' : ''}`;
    $('vsResMeWorth').textContent = fmt(mine);
    $('vsResMeChange').innerHTML = chg(((mine / m.data.startingCash) - 1) * 100);
    $('vsResThemName').textContent = m.them.name;
    $('vsResThemWorth').textContent = fmt(theirs);
    $('vsResThemChange').innerHTML = chg(((theirs / m.data.startingCash) - 1) * 100);

    const best = Math.max(...m.me.worth);
    const rows = [
      ['Stock', `${m.data.stock.name} (${m.data.stock.id})`],
      ['Risk', `${m.risk} · ${VS.RISKS[m.risk].name}`],
      ['The stock itself', fmtPct(((m.data.prices[m.ticks] / m.data.prices[0]) - 1) * 100)],
      ['Trades made', String(m.me.trades)],
      ['Commission paid', fmt(m.me.fees)],
      ['Best you were worth', fmt(best)],
    ];
    if (m.me.divs > 0) rows.splice(5, 0, ['Dividends received', fmt(m.me.divs)]);
    if (m.password) rows.push(['Match code', m.net ? m.password : matchCode(m.password, m.risk, m.ticks)]);
    if (m.net && m.seed != null) rows.push(['Seed', String(m.seed)]);
    $('vsResStats').innerHTML = rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
    renderRematch();
  }

  // Offline, "play it again" is the same market or a fresh one and starts at
  // once. Online it takes two, so the button asks and then waits.
  function renderRematch() {
    const m = vs.match;
    const btn = $('vsAgainBtn');
    const note = $('vsAgainNote');
    if (!m) return;
    if (!m.net) {
      btn.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Play it again';
      note.textContent = '';
      return;
    }
    btn.hidden = !m.rematch;
    note.textContent = m.rematchNote || '';
    if (!m.rematch) return;
    btn.disabled = !!m.asked;
    btn.textContent = m.asked ? 'Waiting for them…' : m.offered ? 'Yes, go again' : 'Ask for a rematch';
  }

  function rematchOffered(msg) {
    const m = vs.match;
    if (!m || !m.net) return;
    m.offered = true;
    m.rematchNote = `${msg.name} wants another one, on the same risk and length.`;
    renderRematch();
    toast('A rematch is offered', `${msg.name} wants to go again.`, 'accent');
    playSound('level');
  }

  function rematchOff(msg) {
    const m = vs.match;
    if (!m || !m.net) return;
    m.rematch = false;
    m.asked = false;
    m.offered = false;
    m.rematchNote = msg.reason === 'opponent_left'
      ? 'Your opponent has left, so there is nobody to play again.'
      : 'The room has closed. Host or join another match from the lobby.';
    renderRematch();
  }

  // ---------- the match chart ----------
  // Two views of the same match. "The price" is the trading floor's chart,
  // drawn the same way from the same kind of data: the stock's price, your
  // average cost across it, and a crosshair you can read a tick off. "The
  // race" is the one a match needs and a career has no use for — both net
  // worths as percentages, against the stock itself.
  function sizeVsChart() {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = vsChart.getBoundingClientRect();
    if (!width) return;
    vsChart.width = Math.round(width * dpr);
    vsChart.height = Math.round(height * dpr);
    drawVsChart();
  }

  function vsChartBox(room) {
    const dpr = window.devicePixelRatio || 1;
    const w = vsChart.width / dpr;
    const h = vsChart.height / dpr;
    return { dpr, w, h, left: 4, right: w - room, top: 12, bottom: h - 26 };
  }

  const drawVsChart = () => (vs.chart === 'race' ? drawVsRaceChart() : drawVsPriceChart());

  // The price, as the trading floor draws it.
  function drawVsPriceChart() {
    const m = vs.match;
    if (!m || vs.stage !== 'live' || !vsChart.width) return;
    const data = m.data.prices.slice(0, m.tick + 1);
    const n = data.length;
    const ctx = vsCtx;
    if (n < 2) return;

    const avg = m.me.bought ? m.me.spent / m.me.bought : 0;
    const values = m.me.shares && avg > 0 ? data.concat(avg) : data;
    let min = Math.min(...values);
    let max = Math.max(...values);
    const pad = (max - min) * 0.08 || max * 0.02;
    min -= pad;
    max += pad;

    ctx.font = '11px "IBM Plex Mono", monospace';
    const labels = [0, 1, 2, 3, 4].map(i => fmtAxis(min + ((max - min) * i) / 4, (max - min) / 4));
    const room = Math.max(70, Math.ceil(Math.max(...labels.map(t => ctx.measureText(t).width))) + 18);
    const box = vsChartBox(room);
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);

    // The window grows a little ahead of the line rather than showing the whole
    // match from the bell: five minutes of empty chart with the first ten ticks
    // crushed into the left edge is not a picture of anything.
    const span = Math.min(m.ticks, Math.max(Math.ceil(m.tick * 1.2), Math.ceil(m.ticks / 12)));
    const x = i => box.left + (i / span) * (box.right - box.left);
    const y = v => box.bottom - ((v - min) / (max - min)) * (box.bottom - box.top);

    ctx.lineWidth = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const yy = Math.round(y(min + ((max - min) * i) / 4)) + 0.5;
      ctx.strokeStyle = CHART.grid;
      ctx.beginPath();
      ctx.moveTo(box.left, yy);
      ctx.lineTo(box.right, yy);
      ctx.stroke();
      ctx.fillStyle = CHART.text;
      ctx.fillText(labels[i], box.right + 10, yy);
    }

    // Time runs on the clock the players are watching, not on days.
    ctx.textBaseline = 'top';
    [0, 1 / 3, 2 / 3, 1].forEach(f => {
      const tick = Math.round(f * span);
      ctx.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center';
      ctx.fillStyle = CHART.text;
      ctx.fillText(tick >= m.ticks ? 'the bell' : `${vsClockText(m.ticks - tick)} left`, x(tick), box.bottom + 8);
    });

    const up = data[n - 1] >= data[0];
    const colour = up ? CHART.pos : CHART.neg;
    const trace = () => data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));

    const grad = ctx.createLinearGradient(0, box.top, 0, box.bottom);
    grad.addColorStop(0, up ? 'rgba(76,195,138,0.30)' : 'rgba(255,111,94,0.24)');
    grad.addColorStop(1, 'rgba(13,12,10,0)');
    ctx.beginPath();
    trace();
    ctx.lineTo(x(n - 1), box.bottom);
    ctx.lineTo(x(0), box.bottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    trace();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    ctx.stroke();

    if (m.me.shares && avg > 0) {
      const yy = y(avg);
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = CHART.accent;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(box.left, yy);
      ctx.lineTo(box.right, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = 'italic 13px Newsreader, Georgia, serif';
      ctx.fillStyle = CHART.accent;
      ctx.textAlign = 'left';
      const above = yy > box.top + 16;
      ctx.textBaseline = above ? 'bottom' : 'top';
      ctx.fillText(`you paid ${fmtPrice(avg)} a share`, box.left + 6, above ? yy - 4 : yy + 4);
    }

    ctx.beginPath();
    ctx.arc(x(n - 1), y(data[n - 1]), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();

    const tip = $('vsChartTip');
    if (vs.hover === null || vs.hover === undefined || vs.hover >= n) {
      tip.hidden = true;
      return;
    }
    const i = Math.max(0, Math.min(n - 1, vs.hover));
    const hx = x(i);
    const hy = y(data[i]);
    ctx.strokeStyle = 'rgba(239,232,216,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(hx) + 0.5, box.top);
    ctx.lineTo(Math.round(hx) + 0.5, box.bottom);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = CHART.ink;
    ctx.fill();
    tip.hidden = false;
    tip.innerHTML = `<strong>${fmtPrice(data[i])}</strong>${i === m.ticks ? 'at the bell' : `${vsClockText(m.ticks - i)} left`}`;
    tip.style.left = Math.max(50, Math.min(box.right - 40, hx)) + 'px';
    tip.style.top = hy + 'px';
  }

  // The price so far, with your net worth and your opponent's drawn over it as
  // percentages of where they started, so the race reads at a glance.
  function drawVsRaceChart() {
    const m = vs.match;
    if (!m || vs.stage !== 'live' || !vsChart.width) return;
    const ctx = vsCtx;
    const box = vsChartBox(56);
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);

    const base = m.data.startingCash;
    const mine = m.me.worth.map(v => (v / base - 1) * 100);
    const theirs = m.them.worth.map(v => (v / base - 1) * 100);
    const stock = m.data.prices.slice(0, m.tick + 1).map(p => (p / m.data.prices[0] - 1) * 100);
    const n = mine.length;
    if (n < 2) return;

    // Gridlines land on round percentages rather than wherever the data ends,
    // so the axis reads 5, 10, 15 instead of 1, 6, 11.
    const lo = Math.min(0, ...mine, ...theirs, ...stock);
    const hi = Math.max(0, ...mine, ...theirs, ...stock);
    const step = niceStep((hi - lo) / 4 || 1);
    const min = Math.floor(lo / step) * step - step / 2;
    const max = Math.ceil(hi / step) * step + step / 2;

    const x = i => box.left + (i / m.ticks) * (box.right - box.left);
    const y = v => box.bottom - ((v - min) / (max - min)) * (box.bottom - box.top);

    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1;
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < step / 100 ? 'rgba(239,232,216,0.22)' : CHART.grid;
      ctx.beginPath();
      ctx.moveTo(box.left, yy);
      ctx.lineTo(box.right, yy);
      ctx.stroke();
      ctx.fillStyle = CHART.text;
      ctx.fillText(`${v >= 0 ? '+' : '\u2212'}${Math.abs(v).toFixed(step < 1 ? 1 : 0)}%`, box.right + 8, yy);
    }

    ctx.textBaseline = 'top';
    [0, 1 / 3, 2 / 3, 1].forEach(f => {
      const tick = Math.round(f * m.ticks);
      ctx.textAlign = f === 0 ? 'left' : f === 1 ? 'right' : 'center';
      ctx.fillStyle = CHART.text;
      ctx.fillText(f === 1 ? 'the bell' : `${vsClockText(m.ticks - tick)} left`, x(tick), box.bottom + 8);
    });

    const line = (data, colour, width, dash) => {
      ctx.beginPath();
      data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.strokeStyle = colour;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    line(stock, 'rgba(133,124,108,0.65)', 1.25, [2, 3]);   // the stock, faintly, underneath
    line(theirs, CHART.accent, 2, [6, 4]);                 // your opponent
    const ahead = mine[n - 1] >= theirs[n - 1];
    line(mine, ahead ? CHART.pos : CHART.neg, 2.5);        // you, on top

    ctx.beginPath();
    ctx.arc(x(n - 1), y(mine[n - 1]), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = ahead ? CHART.pos : CHART.neg;
    ctx.fill();

    // A key, because three lines with nothing naming them is what the race
    // chart looked like before.
    ctx.font = '11px "IBM Plex Mono", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let kx = box.left + 6;
    [['you', ahead ? CHART.pos : CHART.neg], [m.them.name, CHART.accent], [m.data.stock.id, 'rgba(133,124,108,0.9)']]
      .forEach(([label, colour]) => {
        ctx.fillStyle = colour;
        ctx.fillRect(kx, box.top + 4, 10, 2);
        ctx.fillText(label, kx + 14, box.top);
        kx += 22 + ctx.measureText(label).width;
      });
  }

  // 1, 2, 5, 10, 20, 50 … whichever is closest above a rough step.
  function niceStep(rough) {
    const mag = 10 ** Math.floor(Math.log10(rough));
    const n = rough / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  // ===========================================================
  // WIRING
  // ===========================================================
  document.querySelectorAll('[data-icon]').forEach(node => {
    node.innerHTML = icon(node.dataset.icon, Number(node.dataset.size) || 18);
  });

  document.querySelectorAll('[data-screen]').forEach(node => {
    node.addEventListener('click', () => showScreen(node.dataset.screen));
  });
  document.querySelectorAll('[data-soon]').forEach(node => {
    node.addEventListener('click', () => toast(`${node.dataset.soon} isn't open yet`, "It's being built. Check back later."));
  });

  // Rows on the overview are redrawn every tick, so open them on press.
  function openStockRow(e) {
    const row = e.target.closest('[data-stock]');
    if (!row) return;
    if (!state.accountOpen) return showLessons(0);
    openAsset(row.dataset.stock);
  }
  $('moversList').addEventListener('pointerdown', openStockRow);
  $('holdingsTable').addEventListener('pointerdown', openStockRow);
  $('pfTable').addEventListener('pointerdown', openStockRow);

  $('staffList').addEventListener('click', e => {
    const chip = e.target.closest('.team-chip');
    if (!chip) return;
    ui.staffFocus[chip.dataset.role] = Number(chip.dataset.person);
    render();
  });

  $('openAccountBtn').onclick = () => showLessons(0);
  $('settingsBtn').onclick = showSettings;
  $('tierUpgradeBtn').onclick = () => upgradeTier(state.tier + 1);
  $('placeOrderBtn').onclick = placeOrder;
  const nudge = () => nudgeOf(STOCK_BY_ID[ui.selected], rtOf(ui.selected).price);
  $('qtyMinus').onclick = () => setQty(orderQty() - nudge());
  $('qtyPlus').onclick = () => setQty(orderQty() + nudge());
  $('qtyMax').onclick = () => {
    const s = STOCK_BY_ID[ui.selected];
    const rt = rtOf(s.id);
    setQty(ui.side === 'buy' ? maxBuyQty(s, rt.price) : rt.shares);
  };
  $('qtyInput').addEventListener('input', render);
  $('qtyInput').addEventListener('keydown', e => { if (e.key === 'Enter') placeOrder(); });

  document.querySelectorAll('#sideSeg button').forEach(b => {
    b.onclick = () => { ui.side = b.dataset.side; render(); };
  });
  document.querySelectorAll('#rangeSeg button').forEach(b => {
    b.onclick = () => { ui.range = Number(b.dataset.range); chartHover = null; render(); };
  });
  speedButtons.forEach(b => {
    b.onclick = () => setSpeed(Number(b.dataset.speed));
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalRoot.firstElementChild) return closeModal();

    // a modal keeps the keyboard to itself while it is open
    if (e.key === 'Tab' && modalRoot.firstElementChild) {
      const stops = modalRoot.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      return;
    }

    // space stops and starts the market, unless you are typing or on a button
    if (e.key === ' ' && !modalRoot.firstElementChild) {
      const t = e.target;
      const busy = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable);
      if (!busy) { e.preventDefault(); togglePause(); }
    }
  });
  window.addEventListener('resize', () => { sizeChart(); sizeWorthChart(); sizeVsChart(); });
  window.addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });

  // ---------- versus ----------
  $('vsLenSeg').innerHTML = VS.DURATIONS
    .map(d => `<button data-ticks="${d.ticks}">${d.label}<small>${d.note}</small></button>`).join('');
  document.querySelectorAll('#vsRiskSeg button').forEach(b => {
    b.onclick = () => { vs.risk = Number(b.dataset.risk); renderVsLobby(); };
  });
  document.querySelectorAll('#vsLenSeg button').forEach(b => {
    b.onclick = () => { vs.ticks = Number(b.dataset.ticks); renderVsLobby(); };
  });
  document.querySelectorAll('#vsSideSeg button').forEach(b => {
    b.onclick = () => { vs.side = b.dataset.side; renderVersus(); };
  });
  document.querySelectorAll('#vsChartSeg button').forEach(b => {
    b.onclick = () => { vs.chart = b.dataset.chart; vs.hover = null; renderVersus(); };
  });
  vsChart.addEventListener('mousemove', e => {
    if (vs.chart !== 'price' || !vs.match) return;
    const rect = vsChart.getBoundingClientRect();
    const box = vsChartBox(70);
    const m = vs.match;
    const span = Math.min(m.ticks, Math.max(Math.ceil(m.tick * 1.2), Math.ceil(m.ticks / 12)));
    const f = (e.clientX - rect.left - box.left) / (box.right - box.left);
    vs.hover = Math.round(Math.max(0, Math.min(1, f)) * span);
    drawVsChart();
  });
  vsChart.addEventListener('mouseleave', () => { vs.hover = null; drawVsChart(); });
  $('vsRollPass').onclick = () => { $('vsHostPass').value = rollPassword(); renderVsLobby(); };
  $('vsHostPass').addEventListener('input', renderVsLobby);
  $('vsHostBtn').onclick = hostMatch;
  $('vsJoinBtn').onclick = joinMatch;
  $('vsJoinPass').addEventListener('keydown', e => { if (e.key === 'Enter') joinMatch(); });
  $('vsBotBtn').onclick = practiceMatch;
  $('vsOrderBtn').onclick = placeVsOrder;
  $('vsQty').addEventListener('input', renderVersus);
  $('vsQty').addEventListener('keydown', e => { if (e.key === 'Enter') placeVsOrder(); });
  $('vsQtyMinus').onclick = () => { $('vsQty').value = String(Math.max(1, vsOrderQty() - 1)); renderVersus(); };
  $('vsQtyPlus').onclick = () => { $('vsQty').value = String(vsOrderQty() + 1); renderVersus(); };
  $('vsQtyMax').onclick = () => {
    if (!vs.match || vs.match.over) return;
    $('vsQty').value = String(Math.max(1, vs.side === 'buy' ? vsMaxBuy(vsPrice()) : vs.match.me.shares));
    renderVersus();
  };
  $('vsQuitBtn').onclick = () => {
    if (!vs.match) return;
    const online = vs.match.net;
    leaveMatch();
    toast('You walked out', online ? 'That hands the match to your opponent.' : 'The match is over and nothing was recorded.');
  };
  $('vsCancelBtn').onclick = () => leaveMatch();
  $('vsStartBtn').onclick = startHostedMatch;
  $('vsConnectBtn').onclick = netConnect;
  $('vsServerUrl').addEventListener('keydown', e => { if (e.key === 'Enter') netConnect(); });
  $('vsName').addEventListener('change', () => {
    try { localStorage.setItem(NAME_KEY, myName()); } catch { /* nothing worth failing over */ }
  });
  $('vsCopyBtn').onclick = async () => {
    if (!vs.hosted) return;
    try {
      await navigator.clipboard.writeText(vs.hosted.offline ? vs.hosted.code : vs.hosted.password);
      toast('Copied', vs.hosted.offline ? 'The code is on your clipboard.' : 'The password is on your clipboard.');
    } catch {
      toast('Could not copy', 'Read it out instead.', 'neg');
    }
  };
  try {
    // A player's own address wins, then whatever a desktop build was built
    // with, then the one above.
    $('vsServerUrl').value = localStorage.getItem(SERVER_KEY) || (desktop && desktop.defaultServer) || DEFAULT_SERVER;
    $('vsName').value = localStorage.getItem(NAME_KEY) || '';
  } catch { /* a browser with storage switched off still plays fine */ }
  $('vsAgainBtn').onclick = () => {
    const m = vs.match;
    if (!m) return setVsStage('lobby');
    // Online it takes both of them, so all this does is ask; the server starts
    // the match when the other one says yes.
    if (m.net) {
      if (!m.rematch || m.asked) return;
      m.asked = true;
      m.rematchNote = m.offered ? 'Starting…' : 'Asked. Waiting for them to say yes.';
      netSend({ t: 'rematch' });
      return renderRematch();
    }
    // A practice match is a fresh market; a password match is the same one again.
    const seed = m.mode === 'bot' ? VS.randomSeed() : m.seed;
    startMatch({ seed, risk: m.risk, ticks: m.ticks, password: m.password, mode: m.mode });
  };
  $('vsLobbyBtn').onclick = () => leaveMatch();
  $('vsHostPass').value = rollPassword();
  renderVsLobby();
  // A page that reloaded out from under a live match: the ticket is still good
  // for a few seconds, so go straight to the room and claim it back rather
  // than leaving somebody watching the front page while their clock runs.
  if (storedTicket() && $('vsServerUrl').value.trim()) {
    setTimeout(() => {
      if (!storedTicket()) return;
      showScreen('versus');
      autoConnect();
    }, 0);
  }

  // Steam Cloud can hand back a save this machine did not write: two machines
  // played offline and only one of them can be the save. The desktop shell
  // keeps both and asks here, in the game's own terms, because "modified 3
  // days ago" does not tell anyone which run is theirs. Whichever is not
  // chosen is kept on disk either way — see desktop/save.js.
  function askAboutSaveConflict() {
    if (!desktop || !desktop.saveConflict) return;
    let clash = null;
    try { clash = desktop.saveConflict(); } catch (e) { return; }
    if (!clash) return;

    const when = at => (at ? new Date(at).toLocaleString() : 'at some point');
    const card = (title, s, note) => (s ? `
      <div class="save-choice">
        <div class="modal-kicker">${title}</div>
        <div class="save-choice-worth">${fmt(s.netWorth)}</div>
        <div class="save-choice-lines">
          <span>Year ${s.year} · Q${s.quarter} · Day ${s.day}</span>
          <span>Level ${s.level}</span>
          <span>Saved ${when(s.savedAt)}</span>
        </div>
      </div>` : `<div class="save-choice save-choice-gone"><div class="modal-kicker">${title}</div><p>${note}</p></div>`);

    const vanished = clash.kind === 'vanished';
    const modal = openModal(`
      <h3>${vanished ? 'Your save is not where it was' : 'Two saves, one game'}</h3>
      <p>${vanished
        ? 'The game could not find its save file, but this machine has a copy of the last one it wrote. Nothing has been thrown away.'
        : 'The save on this machine is not the one it last wrote — another machine has played since, and Steam has brought that game back. Both are kept; pick the one to carry on.'}</p>
      <div class="save-choices">
        ${card('From the cloud', clash.incoming, 'There is no save on this machine right now.')}
        ${card('Last played here', clash.mine, 'Nothing was kept here.')}
      </div>
      <p class="fine-print">Whichever you do not pick stays on disk as a backup file next to your save, so this is not a decision you can lose a game to.</p>
      <div class="modal-actions">
        <span class="spacer"></span>
        ${clash.incoming ? '<button class="btn btn-ghost" data-act="incoming">Use the cloud one</button>' : ''}
        ${clash.mine ? '<button class="btn btn-ink" data-act="mine">Use this machine\'s</button>' : ''}
      </div>`);

    const choose = which => {
      // Stop this game writing anything more before the other one is put back:
      // reloading fires pagehide, and that would save the game being replaced
      // straight over its replacement.
      if (which === 'mine') savingStopped = true;
      let out = { ok: false, reload: false };
      try { out = desktop.resolveSaveConflict(which); } catch (e) { /* fall through */ }
      closeModal();
      // The game is already running the cloud save, so keeping it needs
      // nothing; taking the other one means starting again from it.
      if (out && out.ok && out.reload) return void location.reload();
      // Nothing was swapped, so this game carries on and must be able to save.
      savingStopped = false;
      if (!out || !out.ok) toast('That did not work', 'The save could not be switched. Both copies are still on disk.', 'loss');
    };
    const wire = (act, which) => {
      const btn = modal.querySelector(`[data-act="${act}"]`);
      if (btn) btn.onclick = () => choose(which);
    };
    wire('incoming', 'incoming');
    wire('mine', 'mine');
  }

  buildWatchlist();
  buildUpgrades();
  buildAchievements();
  scanAchievements(true); // quietly catch up an existing save; no toast spam for old progress
  showScreen('landing');
  booted = true;
  askAboutSaveConflict();
  updateTip();
  checkOfflineEarnings();
  lastTickAt = Date.now();
  setInterval(tick, 1000);
})();
