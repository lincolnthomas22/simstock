// SimStock — the 1v1 match simulator.
//
// This file is deliberately standalone: it has no DOM in it and runs the same
// in a browser and in Node, because the matchmaking server needs to generate
// exactly the price path the two players will see.
//
// A match is not a career. There is one stock, a fixed $1,000, a host-chosen
// risk level and a fixed number of ticks, and nothing that happens in a match
// touches a saved game. The whole price path is worked out up front from a
// seed, so two people handed the same seed are guaranteed the same market —
// no tick-by-tick syncing, and nothing for a client to argue with.
(root => {
  'use strict';

  const DAYS_PER_YEAR = 252;            // one tick is one trading day, as in the career game
  const DAYS_PER_QUARTER = 63;          // so earnings and dividends land on the career's calendar
  const COMMISSION_RATE = 0.0025;       // the broker's cut, but no minimum: matches are small
  const STARTING_CASH = 1000;
  const REVERSION = 0.02;               // daily pull of a price back toward fair value
  const MARKET_DRIFT = 0.07;            // average yearly market return, as on the trading floor
  const MARKET_VOL = 0.16;              // yearly market volatility
  const DAILY_MARKET_VOL = MARKET_VOL / Math.sqrt(DAYS_PER_YEAR);
  const MARKET_NEWS_CHANCE = 1 / 90;    // per tick: a match is short, so the economy speaks up more often
  const MARKET_START = 4200;            // where the index is quoted from, as in the career game
  const DIVIDEND_AFTER = 21;            // a dividend lands three weeks after the earnings report

  // How risky the host wants the market to be. Higher levels swing harder and
  // are likelier to be hit by something sudden, and pay for it with more drift.
  const RISKS = [
    null,
    { level: 1, name: 'Steady',   vol: 0.16, drift: 0.06, newsChance: 1 / 70, shockChance: 0.4,  blurb: 'A calm blue chip. Small moves, and the winner is usually whoever was patient.' },
    { level: 2, name: 'Ordinary', vol: 0.28, drift: 0.08, newsChance: 1 / 55, shockChance: 1.0,  blurb: 'A normal listed company. Enough movement to trade, not enough to ruin you.' },
    { level: 3, name: 'Lively',   vol: 0.45, drift: 0.15, newsChance: 1 / 40, shockChance: 2.0,  blurb: 'A growth name having an interesting week. Timing starts to matter more than patience.' },
    { level: 4, name: 'Wild',     vol: 0.70, drift: 0.29, newsChance: 1 / 28, shockChance: 4.0,  blurb: 'Swings of a tenth in a day are ordinary here. Position size is the whole game.' },
    { level: 5, name: 'Degenerate', vol: 1.10, drift: 0.65, newsChance: 1 / 18, shockChance: 8.0, blurb: 'A coin with a cartoon for a logo. It can double or halve while you are reading this.' },
  ];

  const DURATIONS = [
    { id: 'quick',  label: 'Quick',    ticks: 120, note: '2 minutes' },
    { id: 'normal', label: 'Standard', ticks: 300, note: '5 minutes' },
    { id: 'long',   label: 'Long',     ticks: 600, note: '10 minutes' },
  ];

  // The board a match draws from. Deliberately its own cast, so a match never
  // looks like a slice of someone's career game — but each one is a company in
  // the same sense the trading floor's are, with profits behind the price:
  //   volX: how hard it swings next to the risk level the host picked ·
  //   beta: how much of the market's day it takes on ·
  //   growthX: how fast its profits grow, against the risk level's pace ·
  //   pe: the price-to-earnings ratio its fair value is worked out at ·
  //   divYield: the share of the price it pays out over a year, or none ·
  //   sharesOut: how many shares there are, which gives the market cap.
  const COMPANIES = [
    { id: 'ZPHR', name: 'Zephyr Dynamics',   sector: 'Aerospace',    start: 140, volX: 0.85, beta: 0.60, growthX: 0.8, pe: 24, divYield: 0.018, sharesOut: 260e6,
      about: 'Builds small satellites nobody outside the industry has heard of, for customers nobody will name.' },
    { id: 'BRLQ', name: 'Barleyquick Foods', sector: 'Food & drink', start: 46,  volX: 0.70, beta: 0.55, growthX: 0.6, pe: 21, divYield: 0.030, sharesOut: 1.1e9,
      about: 'Frozen meals and a suspiciously popular energy drink. Boring until it is not.' },
    { id: 'HLIX', name: 'Helix Therapeutic', sector: 'Biotech',      start: 62,  volX: 1.30, beta: 0.70, growthX: 1.4, pe: 38, divYield: 0,     sharesOut: 310e6,
      about: 'One drug in trials and a very confident press office.' },
    { id: 'QRRY', name: 'Quarry & Sons',     sector: 'Mining',       start: 88,  volX: 1.05, beta: 0.75, growthX: 0.7, pe: 13, divYield: 0.024, sharesOut: 420e6,
      about: 'Digs holes in remote places and sells what comes out. Lives and dies by the commodity cycle.' },
    { id: 'NMBS', name: 'Nimbus Compute',    sector: 'Technology',   start: 210, volX: 1.10, beta: 1.30, growthX: 1.3, pe: 34, divYield: 0.004, sharesOut: 1.4e9,
      about: 'Rents out servers. Grew fast enough that everyone stopped asking about the margins.' },
    { id: 'TDWK', name: 'Tidewalk Retail',   sector: 'Retail',       start: 34,  volX: 1.00, beta: 1.10, growthX: 0.5, pe: 11, divYield: 0.035, sharesOut: 540e6,
      about: 'A high-street chain halfway through a turnaround that has been halfway through for years.' },
    { id: 'VLTA', name: 'Voltara Motors',    sector: 'Automotive',   start: 118, volX: 1.35, beta: 1.55, growthX: 1.5, pe: 55, divYield: 0,     sharesOut: 880e6,
      about: 'Electric vans, a charismatic founder, and a factory that is always nearly finished.' },
    { id: 'CNDR', name: 'Condor Freight',    sector: 'Logistics',    start: 72,  volX: 0.95, beta: 1.05, growthX: 0.8, pe: 15, divYield: 0.021, sharesOut: 300e6,
      about: 'Moves other people\u2019s things around. Fuel prices decide how good a year it has.' },
    { id: 'GLDN', name: 'Goldenrod Bank',    sector: 'Financials',   start: 96,  volX: 0.90, beta: 1.15, growthX: 0.6, pe: 12, divYield: 0.028, sharesOut: 380e6,
      about: 'A regional lender with a solid book and a nervous share register.' },
    { id: 'PXLM', name: 'Pixelmoth Studios', sector: 'Games',        start: 28,  volX: 1.25, beta: 1.20, growthX: 1.2, pe: 28, divYield: 0,     sharesOut: 190e6,
      about: 'One hit game, four years ago. The next one is announced.' },
    { id: 'ORCL', name: 'Oracle Springs',    sector: 'Utilities',    start: 54,  volX: 0.65, beta: 0.45, growthX: 0.4, pe: 18, divYield: 0.041, sharesOut: 610e6,
      about: 'Water and power for a growing county. Dull by design, which is sometimes the point.' },
    { id: 'MRSH', name: 'Marshgrove Hotels', sector: 'Travel',       start: 40,  volX: 1.15, beta: 1.40, growthX: 0.9, pe: 17, divYield: 0.015, sharesOut: 230e6,
      about: 'Resorts that fill up in good times and empty in bad ones, on the dot.' },
  ];

  // Headlines are generated with the price path so both players read the same
  // news at the same tick. {n} is the company's name.
  const NEWS = {
    good: [
      '{n} lands a contract bigger than anything on its books',
      'An analyst upgrades {n} and puts a number on it nobody expected',
      '{n} reports a quarter well ahead of what the street had pencilled in',
      'Word gets out that a larger rival has been circling {n}',
      '{n} raises its guidance for the year, and means it',
      'A well-known fund discloses a large stake in {n}',
    ],
    bad: [
      '{n} warns that the quarter will come in short',
      'A short seller publishes a long document about {n}, and it is not flattering',
      '{n} loses its biggest customer to a cheaper competitor',
      'The chief executive of {n} resigns, effective immediately',
      'Regulators open an inquiry into how {n} books its revenue',
      '{n} delays the thing it has been promising for two years',
    ],
  };

  const SHOCKS = [
    '{n} halts trading pending an announcement, and the announcement is bad',
    'An accounting hole opens up at {n} and nobody can say how deep it goes',
    '{n} loses a court case it had told everyone it would win',
    'A fire at {n}’s main site takes the year’s production with it',
  ];

  // The economy's own headlines. The index behind the stock moves whether or
  // not the company is in the news, exactly as it does on the trading floor.
  const MARKET_NEWS = {
    good: [
      'Inflation comes in cooler than expected, and the whole market lifts',
      'The central bank holds rates, and says it is done raising them',
      'Jobs figures beat forecasts without frightening anybody about wages',
      'A strong run of company results has fund managers buying the index',
    ],
    bad: [
      'Inflation comes in hotter than expected, and the whole market sags',
      'The central bank warns that rates may have further to go',
      'A weak jobs report has economists talking about a slowdown',
      'Fund managers cut their positions across the board, taking no chances',
    ],
  };

  const RALLIES = [
    '{n} is suddenly the only thing anyone is buying',
    'A bidding war breaks out over {n}',
    '{n} clears the trial nobody thought it would clear',
    'Short sellers scramble to close out of {n}',
  ];

  // ===========================================================
  // RANDOMNESS
  // The whole point of this file: the same seed gives the same market,
  // in any browser, on any machine, forever.
  // ===========================================================

  // mulberry32 — small, fast, and good enough for a market that only has to
  // look plausible. Integer maths throughout, so it is bit-identical anywhere.
  function makeRng(seed) {
    let a = seed >>> 0;
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // A normally distributed number, mean 0 and standard deviation 1.
    next.gauss = () => {
      let u = 0;
      let v = 0;
      while (!u) u = next();
      while (!v) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    next.pick = list => list[Math.floor(next() * list.length)];
    next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo));
    return next;
  }

  // Turns a match password into a seed, so two people who type the same word
  // land in the same market even before there is a server to tell them so.
  // FNV-1a: short, stable, and no collisions that matter at this scale.
  function hashSeed(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  // A seed with no password behind it, for practice matches.
  const randomSeed = () => Math.floor(Math.random() * 0xffffffff) >>> 0;

  // ===========================================================
  // THE MARKET
  // The same simulation the trading floor runs, on a one-stock board.
  //
  // A market index moves first, on its own drift and volatility. The company
  // takes its share of that day through its beta, adds its own move, and is
  // pulled toward a fair value worked out from its profits and its P/E ratio,
  // exactly as a career stock is. Quarterly earnings land on the calendar,
  // dividends three weeks after them, and company news and the rare shock go
  // on top. The host's risk dial scales how hard the whole thing swings.
  // ===========================================================
  function generateMatch({ seed, risk = 3, ticks = 300 }) {
    const rng = makeRng(seed >>> 0);
    const level = RISKS[Math.min(5, Math.max(1, Math.round(risk)))];
    const company = rng.pick(COMPANIES);

    const vol = level.vol * company.volX;
    const dailyVol = vol / Math.sqrt(DAYS_PER_YEAR);
    const growth = level.drift * company.growthX;          // yearly profit growth
    // Whatever the market's beta accounts for is not the company's own to add
    // again, so the two together come to the volatility it is advertised at.
    const ownVol = Math.sqrt(Math.max(0, dailyVol ** 2 - (company.beta * DAILY_MARKET_VOL) ** 2));

    // Start somewhere near the listed price rather than exactly on it, so the
    // round numbers do not give the seed away.
    const start = Math.round(company.start * (0.85 + rng() * 0.3) * 100) / 100;
    let price = start;
    // Profits are set so that fair value is today's price: a match opens with
    // the company fairly valued and everything after that is earned.
    let eps = start / company.pe;
    let index = MARKET_START;
    // Where in the quarter the match opens, so the first earnings report is
    // not always the same number of ticks away.
    const earningsDay = rng.int(0, DAYS_PER_QUARTER);
    const dividendDay = (earningsDay + DIVIDEND_AFTER) % DAYS_PER_QUARTER;

    const prices = [price];
    const marketLevels = [index];
    const epsPath = [eps];
    const news = [];
    const dividends = [];
    const say = (tick, mood, kind, text) => news.push({ tick, mood, kind, text: text.replace('{n}', company.name) });

    for (let t = 1; t <= ticks; t++) {
      // The economy's day, which every company on a real board would share.
      let market = MARKET_DRIFT / DAYS_PER_YEAR + rng.gauss() * DAILY_MARKET_VOL;
      if (rng() < MARKET_NEWS_CHANCE) {
        const good = rng() < 0.5;
        market += (good ? 1 : -1) * (0.012 + rng() * 0.02);
        say(t, good ? 'up' : 'down', 'market', rng.pick(MARKET_NEWS[good ? 'good' : 'bad']));
      }
      index *= Math.exp(market);
      const marketSurprise = market - MARKET_DRIFT / DAYS_PER_YEAR;

      // Profits grow, and partly follow the economy.
      eps *= Math.exp(growth / DAYS_PER_YEAR + company.beta * marketSurprise * 0.6);
      const fair = eps * company.pe;
      let move = growth / DAYS_PER_YEAR
        + company.beta * marketSurprise
        + ownVol * rng.gauss()
        + REVERSION * Math.log(fair / price);

      // The quarterly report, on the calendar rather than at random.
      if (t % DAYS_PER_QUARTER === earningsDay) {
        const surprise = rng.gauss();
        const jump = surprise * vol * 0.12;
        move += jump;
        eps *= Math.exp(jump * 0.6);
        if (surprise > 0.4) say(t, 'up', 'earnings', '{n} beats quarterly earnings estimates');
        else if (surprise < -0.4) say(t, 'down', 'earnings', '{n} misses quarterly earnings estimates');
        else say(t, 'neutral', 'earnings', '{n} reports quarterly earnings in line with estimates');
      }

      if (rng() < level.newsChance) {
        const good = rng() < 0.5;
        const jump = (good ? 1 : -1) * (0.5 + rng()) * vol * 0.12;
        move += jump;
        // News moves the fundamentals as well as the price, as it does on the
        // trading floor — but only partly. A match packs a year of headlines
        // into five minutes, and at full strength they compound into moves no
        // floor stock would ever make.
        eps *= Math.exp(jump * 0.35);
        say(t, good ? 'up' : 'down', 'news', rng.pick(NEWS[good ? 'good' : 'bad']));
      }

      // The rare big one. Never in the last few ticks, so a match is not
      // decided by something nobody had time to react to.
      if (t < ticks - 6 && rng() < level.shockChance / DAYS_PER_YEAR) {
        const up = rng() < 0.45;
        const size = 0.18 + rng() * 0.3;
        move += up ? Math.log(1 + size) : Math.log(1 - size);
        eps *= up ? 1 + size * 0.4 : 1 - size * 0.4;
        say(t, up ? 'up' : 'down', 'news', rng.pick(up ? RALLIES : SHOCKS));
      }

      price = Math.max(0.01, price * Math.exp(move));
      price = Math.round(price * 10000) / 10000;
      prices.push(price);
      marketLevels.push(Math.round(index * 100) / 100);
      epsPath.push(Math.max(0.01, Math.round(eps * 10000) / 10000));

      // The dividend, three weeks after the report, paid on the shares held at
      // the close of that tick. A holder is paid it in cash, as on the floor.
      if (company.divYield && t % DAYS_PER_QUARTER === dividendDay) {
        const perShare = Math.round(((price * company.divYield) / 4) * 10000) / 10000;
        if (perShare > 0) {
          dividends.push({ tick: t, perShare });
          say(t, 'neutral', 'dividend', `{n} pays a dividend of $${perShare.toFixed(2)} a share`);
        }
      }
    }

    return {
      seed: seed >>> 0,
      risk: level.level,
      ticks,
      startingCash: STARTING_CASH,
      stock: {
        id: company.id,
        name: company.name,
        sector: company.sector,
        about: company.about,
        start,
        risk: level.level,
        vol,
        beta: company.beta,
        growth,
        pe: company.pe,
        divYield: company.divYield,
        sharesOut: company.sharesOut,
        earningsDay,
        dividendDay,
      },
      prices,
      market: marketLevels,
      eps: epsPath,
      dividends,
      news,
    };
  }

  // What a holder is paid at a given tick, per share. Nothing for most ticks,
  // and the same number for both players and the server, since it comes out of
  // the seeded path rather than anybody's clock.
  function dividendAt(data, tick) {
    const d = data.dividends && data.dividends.find(x => x.tick === tick);
    return d ? d.perShare : 0;
  }

  // How many ticks until the next quarterly report, and the next dividend,
  // counted the way the trading floor's calendar counts them.
  function nextEarnings(stock, tick) {
    const left = ((stock.earningsDay - tick) % DAYS_PER_QUARTER + DAYS_PER_QUARTER) % DAYS_PER_QUARTER;
    return left || DAYS_PER_QUARTER;
  }

  function nextDividend(stock, tick) {
    if (!stock.divYield) return 0;
    const left = ((stock.dividendDay - tick) % DAYS_PER_QUARTER + DAYS_PER_QUARTER) % DAYS_PER_QUARTER;
    return left || DAYS_PER_QUARTER;
  }

  // What a trade costs. No minimum, unlike the career game: a dollar floor on
  // a $1,000 account would make the commission the whole match.
  const commission = value => Math.round(value * COMMISSION_RATE * 100) / 100;

  // ===========================================================
  // THE PRACTICE OPPONENT
  // Seeded like everything else, so a practice match can be replayed exactly.
  // Each bot reads the same price path a player does and nothing more — it has
  // no view of the future, which is the only thing that would make it unfair.
  // ===========================================================
  const BOT_NAMES = ['Rookwood', 'Merle', 'Ashby', 'Prewitt', 'Calloway', 'Fennimore', 'Sterling', 'Okonkwo'];

  const BOT_STYLES = {
    momentum: { label: 'chases anything that moves', look: 8,  edge: 0.012, bias: 1 },
    dipper:   { label: 'buys the dips and sells the rips', look: 10, edge: 0.014, bias: -1 },
    holder:   { label: 'buys early and sits on it', look: 0,  edge: 0, bias: 0 },
    gambler:  { label: 'has no discernible system', look: 4,  edge: 0.02, bias: 1 },
  };

  function makeBot(seed, styleId) {
    const rng = makeRng((seed ^ 0x5f3759df) >>> 0);
    const style = styleId || rng.pick(Object.keys(BOT_STYLES));
    const spec = BOT_STYLES[style];
    const name = rng.pick(BOT_NAMES);
    // How much of its money it is willing to put on one decision.
    const appetite = 0.25 + rng() * 0.5;
    let cooldown = rng.int(2, 8);

    // ctx: { tick, ticks, prices, cash, shares }. Returns { side, qty } or null.
    function decide(ctx) {
      const price = ctx.prices[ctx.tick];
      if (!price) return null;

      if (style === 'holder') {
        // In early, out at the end, and otherwise leave it alone.
        if (ctx.tick === 2 && ctx.cash > price) return { side: 'buy', qty: Math.floor((ctx.cash * 0.9) / price) };
        if (ctx.tick === ctx.ticks - 1 && ctx.shares > 0) return { side: 'sell', qty: ctx.shares };
        return null;
      }

      if (cooldown-- > 0) return null;
      cooldown = rng.int(3, 12);

      const back = ctx.prices[Math.max(0, ctx.tick - spec.look)];
      const run = (price - back) / back;
      // Momentum buys strength, the dipper buys weakness; the gambler mostly
      // buys whatever just happened and regrets it later.
      const wantsBuy = spec.bias >= 0 ? run > spec.edge : run < -spec.edge;
      const wantsSell = spec.bias >= 0 ? run < -spec.edge : run > spec.edge;

      if (wantsBuy && ctx.cash > price * 1.01) {
        const qty = Math.floor((ctx.cash * appetite) / (price * 1.01));
        return qty > 0 ? { side: 'buy', qty } : null;
      }
      if (wantsSell && ctx.shares > 0) {
        const qty = Math.max(1, Math.floor(ctx.shares * appetite));
        return { side: 'sell', qty: Math.min(qty, ctx.shares) };
      }
      // Nobody wants to be holding nothing at the whistle.
      if (ctx.tick === ctx.ticks - 1 && ctx.shares > 0) return { side: 'sell', qty: ctx.shares };
      return null;
    }

    return { name, style, label: spec.label, decide };
  }

  const api = {
    DAYS_PER_YEAR, DAYS_PER_QUARTER, COMMISSION_RATE, STARTING_CASH, MARKET_START,
    RISKS, DURATIONS, COMPANIES,
    makeRng, hashSeed, randomSeed, generateMatch, commission, makeBot, BOT_STYLES,
    dividendAt, nextEarnings, nextDividend,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SimStockMatch = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
