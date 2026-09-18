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
    { name: 'Starter',  cost: 0,     level: 1,  blurb: 'Your first brokerage account. Steady, well-known companies.' },
    { name: 'Silver',   cost: 5000,   level: 3,  blurb: 'Adds a bank, a software firm, a builders merchant and an electric carmaker.' },
    { name: 'Gold',     cost: 30000,  level: 6,  blurb: 'Adds the rough end of the market: biotech, energy, mining and an airline.' },
    { name: 'Platinum', cost: 150000, level: 10, blurb: 'Adds large, premium-priced companies with high share prices.' },
  ];

  const STOCKS = [
    { id: 'IDXF', name: 'Evergreen Total Market Fund', sector: 'Index fund', fund: true, tier: 0, risk: 1, start: 250, vol: 0.16, beta: 1.0, growth: 0.055, pe: 20, divYield: 0.015, sharesOut: 2.1e9, color: '#7f9cc4',
      about: 'Owns a small slice of every company in the market. It moves with the market as a whole, so it swings less than most single stocks.' },
    { id: 'TICK', name: 'Tickr Inc.', sector: 'Technology', tier: 0, risk: 3, start: 100, vol: 0.32, beta: 1.2, growth: 0.1, pe: 30, divYield: 0, sharesOut: 850e6, color: '#5b8def',
      about: 'Builds trading software and cloud tools for banks. It is growing quickly and reinvests its profits instead of paying a dividend.' },
    { id: 'BRWL', name: 'Brightwell Foods', sector: 'Consumer staples', tier: 0, risk: 1, start: 48, vol: 0.17, beta: 0.6, growth: 0.02, pe: 18, divYield: 0.032, sharesOut: 1.4e9, color: '#c9a45c',
      about: 'Makes cereal, snacks and frozen meals. People buy groceries in good times and bad, so the stock is steady and pays a regular dividend.' },
    { id: 'CIVC', name: 'Civic Power & Water', sector: 'Utilities', tier: 0, risk: 1, start: 62, vol: 0.14, beta: 0.45, growth: 0.01, pe: 16, divYield: 0.042, sharesOut: 900e6, color: '#6f9aa8',
      about: 'Keeps the lights on and the taps running for millions of homes. Growth is slow and dull, but the bills get paid and so do its dividends.' },
    { id: 'PARC', name: 'Parcelworks', sector: 'Logistics', tier: 0, risk: 2, start: 84, vol: 0.22, beta: 0.9, growth: 0.065, pe: 19, divYield: 0.012, sharesOut: 700e6, color: '#b08a6a',
      about: 'Runs delivery vans and sorting depots. When shops and factories are busy it thrives, and when they slow down so does it.' },
    { id: 'VOLT', name: 'Voltaic Motors', sector: 'Automotive', tier: 1, risk: 5, start: 64, vol: 0.55, beta: 1.6, growth: 0.18, pe: 45, divYield: 0, sharesOut: 1.1e9, color: '#4fb3a9',
      about: 'An electric vehicle maker betting big on new factories. Investors expect a lot of growth, so the stock swings hard on any news.' },
    { id: 'NRTH', name: 'Northgate Bank', sector: 'Financials', tier: 1, risk: 2, start: 72, vol: 0.25, beta: 1.15, growth: 0.04, pe: 11, divYield: 0.036, sharesOut: 2.6e9, color: '#8a93d6',
      about: 'A large bank that earns money lending to families and businesses. It tends to rise and fall with the overall economy.' },
    { id: 'NIMB', name: 'Nimbus Software', sector: 'Technology', tier: 1, risk: 3, start: 118, vol: 0.38, beta: 1.25, growth: 0.1, pe: 38, divYield: 0, sharesOut: 620e6, color: '#6f8fe0',
      about: 'Sells office software that companies pay for by the month. Those payments are reliable, but investors expect fast growth and punish any slip.' },
    { id: 'HRVS', name: 'Harvest Materials', sector: 'Materials', tier: 1, risk: 2, start: 57, vol: 0.28, beta: 1.05, growth: 0.045, pe: 13, divYield: 0.028, sharesOut: 1.1e9, color: '#a8925c',
      about: 'Makes cement, glass and steel for building work. Its fortunes follow construction, which booms and stalls with the economy.' },
    { id: 'HELX', name: 'Helix Therapeutics', sector: 'Biotech', tier: 2, risk: 5, start: 38, vol: 0.62, beta: 0.8, growth: 0.18, pe: 40, divYield: 0, sharesOut: 520e6, color: '#b98ac6',
      about: 'Develops new medicines. A single drug trial result can send the stock sharply up or down, no matter what the market is doing.' },
    { id: 'CRST', name: 'Crestline Energy', sector: 'Energy', tier: 2, risk: 3, start: 91, vol: 0.30, beta: 0.9, growth: 0.055, pe: 12, divYield: 0.045, sharesOut: 1.9e9, color: '#d08a57',
      about: 'Produces oil and natural gas. Its price follows energy prices, and it returns much of its cash to investors as dividends.' },
    { id: 'AURA', name: 'Aurora Mining', sector: 'Mining', tier: 2, risk: 4, start: 41, vol: 0.45, beta: 1.1, growth: 0.115, pe: 14, divYield: 0.02, sharesOut: 800e6, color: '#c98f4a',
      about: 'Digs copper and gold out of the ground. Metal prices swing hard, and a single flooded mine can wipe out a year of profit.' },
    { id: 'VELO', name: 'Velocity Airways', sector: 'Airlines', tier: 2, risk: 4, start: 33, vol: 0.50, beta: 1.5, growth: 0.135, pe: 10, divYield: 0, sharesOut: 540e6, color: '#7fa9c9',
      about: 'Flies short-haul routes on thin margins. Cheap fuel and full planes make it soar; a downturn or a fuel spike can sink it entirely.' },
    { id: 'ORBT', name: 'Orbital Systems', sector: 'Aerospace', tier: 3, risk: 4, start: 220, vol: 0.40, beta: 1.3, growth: 0.135, pe: 35, divYield: 0, sharesOut: 640e6, color: '#6aa6d6',
      about: 'Launches satellites and builds spacecraft for governments. Big contracts can lift the stock, and launch failures can sink it.' },
    { id: 'SUMT', name: 'Summit Global Holdings', sector: 'Conglomerate', tier: 3, risk: 1, start: 410, vol: 0.18, beta: 0.9, growth: 0.03, pe: 22, divYield: 0.022, sharesOut: 1.3e9, color: '#9aa7b8',
      about: 'Owns dozens of businesses, from insurance to railroads. Pricey per share, but steady, diversified and a reliable dividend payer.' },
    { id: 'MERD', name: 'Meridian Pharma', sector: 'Pharmaceuticals', tier: 3, risk: 2, start: 330, vol: 0.24, beta: 0.7, growth: 0.045, pe: 19, divYield: 0.031, sharesOut: 1.6e9, color: '#9ab8a0',
      about: 'Sells medicines people take for years at a time. Far calmer than a young biotech, because it already has drugs earning money.' },
    { id: 'QNTA', name: 'Quanta Robotics', sector: 'Robotics', tier: 3, risk: 4, start: 265, vol: 0.42, beta: 1.35, growth: 0.135, pe: 48, divYield: 0, sharesOut: 700e6, color: '#a58fd6',
      about: 'Builds factory robots and the software that runs them. One of the fastest growers on the board, priced as though that will never stop.' },

    // Waiting in the wings: each of these lists on the exchange when a company
    // fails, taking its place on the board. None of them trade before then.
    { id: 'FRSH', name: 'Freshfield Grocers', sector: 'Consumer staples', later: true, tier: 0, risk: 1, start: 36, vol: 0.16, beta: 0.55, growth: 0.02, pe: 17, divYield: 0.033, sharesOut: 1.2e9, color: '#b5a86a',
      about: 'Runs neighbourhood supermarkets. Nobody gets rich quick owning it, but people always need milk and bread.' },
    { id: 'PNGW', name: 'Pingwire', sector: 'Technology', later: true, tier: 0, risk: 4, start: 22, vol: 0.47, beta: 1.4, growth: 0.135, pe: 50, divYield: 0, sharesOut: 900e6, color: '#5fa8e8',
      about: 'A young messaging app signing up users fast and yet to make a profit. Exciting, and fragile.' },
    { id: 'DSHL', name: 'Dashline Couriers', sector: 'Logistics', later: true, tier: 0, risk: 2, start: 44, vol: 0.24, beta: 0.95, growth: 0.06, pe: 17, divYield: 0.015, sharesOut: 600e6, color: '#b3906f',
      about: 'Same-day delivery by bike and van in big cities. Busy when shoppers are, quieter when they are not.' },
    { id: 'KEEL', name: 'Keel & Harbour Bank', sector: 'Financials', later: true, tier: 1, risk: 2, start: 54, vol: 0.26, beta: 1.1, growth: 0.04, pe: 10, divYield: 0.038, sharesOut: 1.8e9, color: '#8f8fd0',
      about: 'A regional bank lending to shipyards, farms and small firms. Pays a solid dividend and follows the economy.' },
    { id: 'SPRK', name: 'Sparkline EV', sector: 'Automotive', later: true, tier: 1, risk: 5, start: 18, vol: 0.60, beta: 1.7, growth: 0.18, pe: 60, divYield: 0, sharesOut: 800e6, color: '#45c2b0',
      about: 'Makes electric scooters and vans, and spends money far faster than it earns it. It could be huge, or it could be gone.' },
    { id: 'FORG', name: 'Forge Steelworks', sector: 'Materials', later: true, tier: 1, risk: 3, start: 39, vol: 0.33, beta: 1.2, growth: 0.075, pe: 12, divYield: 0.025, sharesOut: 900e6, color: '#a88a5a',
      about: 'Melts scrap into new steel for bridges and buildings. Profits rise and fall sharply with construction.' },
    { id: 'GNVA', name: 'Genova Bio', sector: 'Biotech', later: true, tier: 2, risk: 5, start: 27, vol: 0.64, beta: 0.8, growth: 0.18, pe: 45, divYield: 0, sharesOut: 450e6, color: '#c08fd0',
      about: 'Has one promising drug in late trials and not much else. The result will make or break it.' },
    { id: 'TDWR', name: 'Tidewater Offshore', sector: 'Energy', later: true, tier: 2, risk: 3, start: 58, vol: 0.34, beta: 1.0, growth: 0.06, pe: 11, divYield: 0.04, sharesOut: 1.2e9, color: '#d49a62',
      about: 'Drills for oil and gas far out at sea. Big projects, big costs, and a price that follows energy markets.' },
    { id: 'SKYL', name: 'Skylark Air', sector: 'Airlines', later: true, tier: 2, risk: 4, start: 26, vol: 0.48, beta: 1.5, growth: 0.135, pe: 11, divYield: 0, sharesOut: 480e6, color: '#86b0d0',
      about: 'A budget airline growing route by route. Full planes make it fly; a fuel spike could ground it.' },
    { id: 'NOVL', name: 'Nova Launch', sector: 'Aerospace', later: true, tier: 3, risk: 5, start: 180, vol: 0.58, beta: 1.4, growth: 0.18, pe: 60, divYield: 0, sharesOut: 500e6, color: '#74b0e0',
      about: 'Builds reusable rockets on a shoestring. Every launch is a bet on the whole company.' },
    { id: 'ATLS', name: 'Atlas Consolidated', sector: 'Conglomerate', later: true, tier: 3, risk: 1, start: 360, vol: 0.17, beta: 0.85, growth: 0.03, pe: 20, divYield: 0.024, sharesOut: 1.4e9, color: '#a0abbb',
      about: 'Owns railways, insurers and a chain of hardware shops. Steady, sprawling and unexciting.' },
    { id: 'CURW', name: 'Curewell Pharma', sector: 'Pharmaceuticals', later: true, tier: 3, risk: 2, start: 290, vol: 0.23, beta: 0.7, growth: 0.045, pe: 18, divYield: 0.03, sharesOut: 1.5e9, color: '#a2c0a8',
      about: 'Makes everyday medicines sold in every chemist. Calm, profitable and a reliable dividend payer.' },
  ];
  const STOCK_BY_ID = Object.fromEntries(STOCKS.map(s => [s.id, s]));

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
  const canFail = s => s.risk >= 3;

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
    { id: 'full_house', category: 'Getting started', name: 'Full House', blurb: 'Reach a Platinum account.',
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
      check: () => STOCKS.some(s => s.risk === 5 && (rtOf(s.id).riskStreak || 0) >= 100) },
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
        const list = boardStocks().filter(s => isUnlocked(s) && trading(s));
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

    // Hidden
    { id: 'coffee_break', category: 'Hidden', hidden: true, name: 'Coffee Break', blurb: 'Have a staff member on the books whose quirk mentions coffee.',
      check: () => state.roster.some(p => /coffee|espresso/i.test(p.trait)) },
    { id: 'rags_to_riches', category: 'Hidden', hidden: true, name: 'Rags to Riches', blurb: 'Go from under $50 in cash to a $50,000 net worth.',
      check: () => state.stats.wasPoor && netWorth() >= 50000 },
    { id: 'the_contrarian', category: 'Hidden', hidden: true, name: 'The Contrarian', blurb: 'Buy a rating-5 stock the same day bad news breaks about it.',
      check: () => state.stats.contrarianBuy },
  ];
  const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map(a => [a.id, a]));

  // Records the unlock and shows it off, unless this is a quiet catch-up scan
  // (run once after loading a save) or the game is on the title screen.
  function unlockAchievement(id, silent = false) {
    if (state.achieved[id]) return false;
    state.achieved[id] = state.day;
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

  // A company that has lost most of its value can fail outright. Only the
  // wildest companies can, and only after a real collapse.
  const DISTRESS_LEVEL = 0.35;   // below this share of its year's high, it is in trouble
  const RECOVERY_LEVEL = 0.55;   // above this, the trouble is over
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
    'Robotics': {
      good: ['{n} lands a huge factory automation order', '{n} unveils a faster assembly robot'],
      bad: ['{n} recalls robots after a software fault', 'A key customer delays its {n} rollout'],
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
    'Robotics': ["{n}'s biggest order is cancelled", "{n} admits its new robot does not work yet"],
    'Materials': ["{n} closes two plants as orders dry up", "{n} is fined heavily over pollution"],
    default: ["{n} reports a shock loss", "{n} misses a payment to its lenders"],
  };

  const MARKET_NEWS = {
    good: ['Central bank signals interest rate cuts', 'Jobs report shows strong hiring', 'Inflation cools more than expected'],
    bad: ['Central bank hints at more rate hikes', 'Recession worries hit global markets', 'Inflation comes in hotter than expected'],
  };

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

  function pushHistory(list, value) {
    list.push(Math.round(value * 10000) / 10000);
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

    let market = MARKET_DRIFT / DAYS_PER_YEAR + gauss() * DAILY_MARKET_VOL;
    if (Math.random() < MARKET_NEWS_CHANCE) {
      const good = Math.random() < 0.5;
      market += (good ? 1 : -1) * (0.012 + Math.random() * 0.02);
      add('MKT', good ? 'up' : 'down', 'market', pick(MARKET_NEWS[good ? 'good' : 'bad']));
    }
    st.market.level *= Math.exp(market);
    pushHistory(st.market.history, st.market.level);
    const marketSurprise = market - MARKET_DRIFT / DAYS_PER_YEAR;

    fillEmptyPlaces(st, add);

    for (const s of STOCKS) {
      const rt = st.stocks[s.id];
      if (rt.delisted || !rt.listed) continue;
      const dailyVol = s.vol / Math.sqrt(DAYS_PER_YEAR);
      const ownVol = Math.sqrt(Math.max(0, dailyVol ** 2 - (s.beta * DAILY_MARKET_VOL) ** 2));
      const quarterDay = mod(day, DAYS_PER_QUARTER);

      // profits grow slowly and partly follow the economy
      rt.eps *= Math.exp(s.growth / DAYS_PER_YEAR + s.beta * marketSurprise * 0.6);
      const fairValue = rt.eps * s.pe;

      let move = s.growth / DAYS_PER_YEAR
        + s.beta * marketSurprise
        + ownVol * gauss()
        + REVERSION * Math.log(fairValue / rt.price);

      if (!s.fund && quarterDay === rt.earningsDay) {
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
        rt.eps *= Math.exp(jump * 0.5);
        add(s.id, good ? 'up' : 'down', 'news', pick(lines[good ? 'good' : 'bad']).replace('{n}', s.name));
      }

      // the blow that can start a risky company's slide into failure
      const risk = RISK[s.risk];
      if (risk.shock && !rt.distress && Math.random() < risk.shock / DAYS_PER_YEAR) {
        const hit = 0.4 + Math.random() * 0.25;
        move += Math.log(1 - hit);
        rt.eps *= 1 - hit;
        rt.distress = true;
        add(s.id, 'down', 'news', `${pick(SHOCKS[s.sector] || SHOCKS.default).replace('{n}', s.name)}. It warns it may not be able to pay its debts`);
      }

      rt.price = Math.max(0.5, rt.price * Math.exp(move));
      pushHistory(rt.history, rt.price);

      // a collapse can turn into outright failure, and the shares become worthless
      if (canFail(s)) {
        const high = Math.max(...rt.history);
        if (!rt.distress && rt.price < high * DISTRESS_LEVEL) {
          rt.distress = true;
          add(s.id, 'down', 'news', `${s.name} warns it may not be able to pay its debts`);
        } else if (rt.distress && rt.price > high * RECOVERY_LEVEL) {
          rt.distress = false;
          add(s.id, 'up', 'news', `${s.name} steadies itself and calls off the alarm`);
        }
        if (rt.distress && Math.random() < DELIST_CHANCE) {
          fail(st, s, events, `${s.name} collapses. Trading is halted and the shares are worthless.`);
          continue;
        }
        // the very riskiest can go without any warning at all
        if (!rt.distress && risk.sudden && Math.random() < risk.sudden / DAYS_PER_YEAR) {
          fail(st, s, events, `${s.name} collapses overnight after its accounts turn out to be fiction. The shares are worthless.`);
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

  function fail(st, s, events, text) {
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
    events.push(event);
  }

  // A few weeks after a failure, a new company lists and takes the empty place,
  // from the same account tier if one is waiting, from any tier if not. Once
  // nobody is left waiting, the place stays empty.
  function fillEmptyPlaces(st, add) {
    for (const s of STOCKS) {
      const rt = st.stocks[s.id];
      if (!rt.delisted || rt.retired || rt.relistOn == null || st.day < rt.relistOn) continue;
      const waiting = STOCKS.filter(c => c.later && !st.stocks[c.id].listed);
      const next = waiting.find(c => c.tier === s.tier) || waiting[0];
      rt.relistOn = null;
      if (!next) continue;
      const nt = st.stocks[next.id];
      inventHistory(nt, next);
      nt.listed = true;
      rt.retired = true;
      add(next.id, 'up', 'listing', `${next.name} lists on the exchange, taking the place ${s.name} left behind`);
    }
  }

  // ===========================================================
  // STATE + SAVING
  // ===========================================================
  function blankStock(s, index) {
    return {
      price: s.start,
      eps: s.start / s.pe,
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

  // A company added to the game after a save was made needs a year of
  // history of its own, so its chart isn't empty when it appears.
  function inventHistory(rt, s) {
    const walk = [];
    let price = s.start;
    for (let i = 0; i < DAYS_PER_YEAR; i++) {
      price *= Math.exp(s.growth / DAYS_PER_YEAR + (s.vol / Math.sqrt(DAYS_PER_YEAR)) * gauss());
      walk.push(price);
    }
    const scale = s.start / price; // finish at today's listed price
    rt.history = walk.map(v => Math.round(v * scale * 10000) / 10000);
    rt.price = s.start;
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
      },
      totalDividends: 0,
      totalFees: 0,
      market: { level: 1000, history: [] },
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

    // achievements arrived later; every save gets the tracking fields
    if (!saved.achieved || typeof saved.achieved !== 'object') saved.achieved = {};
    const statDefaults = {
      trades: 0, bestSaleProfit: 0, longestHoldDays: 0, sameDayFlip: false, boughtBigDip: false,
      soldWhileDistressed: false, wasBurned: false, contrarianBuy: false, wasPoor: false,
      firstHireDay: null, lastLayoffDay: null, negIncomeStreak: 0, concentrationStreak: 0,
      peakNetWorth: 0, burnRecoveryTarget: null,
    };
    if (!saved.stats || typeof saved.stats !== 'object') saved.stats = {};
    Object.entries(statDefaults).forEach(([k, v]) => { if (saved.stats[k] === undefined) saved.stats[k] = v; });

    // staff gained names later on; anyone already hired gets one now
    if (!saved.staff || typeof saved.staff !== 'object') saved.staff = {};
    STAFF.forEach(s => { if (!Number.isInteger(saved.staff[s.id]) || saved.staff[s.id] < 0) saved.staff[s.id] = 0; });
    syncRoster(saved);

    // companies added since this save was written join the board today
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
      const saved = migrate(JSON.parse(localStorage.getItem(SAVE_KEY) || localStorage.getItem(OLD_SAVE_KEY)));
      if (saved) return saved;
    } catch (e) { /* storage blocked or save unreadable: start fresh */ }
    return freshState();
  }

  function saveState() {
    state.lastSeen = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
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
  const ui = { screen: 'landing', selected: 'TICK', range: 63, side: 'buy', staffFocus: {} };
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
  const riskPips = s => `<span class="risk-pips risk-${s.risk}" title="Risk ${s.risk} of 5: ${RISK[s.risk].label}">${'<i></i>'.repeat(5)}</span>`;
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
      ${last && opening ? '<p class="fine-print">All companies and prices in SimStock are fictional. No real money is involved.</p>' : ''}
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
    const modal = openModal(`
      <div class="modal-kicker">Account upgraded</div>
      <h3>Welcome to ${tier.name}</h3>
      <p>You can now trade ${stocks.length} more companies:</p>
      <ul class="new-stocks">
        ${stocks.map(s => `<li>${tkr(s)}<span>${s.name}</span><span class="muted">${RISK[s.risk].label}</span></li>`).join('')}
      </ul>
      ${staff.length ? `<p>You can also hire a new role: ${staff.map(s => s.name).join(', ')}.</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="close">Close</button>
        <button class="btn btn-ink" data-act="trade">Start trading</button>
      </div>`);
    modal.querySelector('[data-act="close"]').onclick = closeModal;
    modal.querySelector('[data-act="trade"]').onclick = () => {
      if (stocks.length) ui.selected = stocks[0].id;
      closeModal();
      showScreen('trade');
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
      ui.selected = 'TICK';
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
      ui.selected = 'TICK';
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
    toast('Account opened', `+${XP.openAccount} XP. Pick a stock from the list to get started.`, 'accent');
  }

  // The most shares your cash can cover once the commission is paid too.
  function maxBuyQty(price) {
    let n = Math.max(0, Math.floor(state.cash / (price * (1 + COMMISSION_RATE))));
    while (n > 0 && n * price + commission(n * price) > state.cash + 1e-9) n -= 1;
    // below the flat minimum the rate-based guess is too cautious, so creep back up
    while ((n + 1) * price + commission((n + 1) * price) <= state.cash + 1e-9) n += 1;
    return n;
  }

  function orderQty() {
    const n = Math.floor(Number($('qtyInput').value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function setQty(n) {
    $('qtyInput').value = Math.max(1, Math.floor(n));
    render();
  }

  function placeOrder() {
    const s = STOCK_BY_ID[ui.selected];
    const rt = rtOf(s.id);
    const qty = orderQty();
    const value = qty * rt.price;
    const fee = commission(value);
    if (!isUnlocked(s) || rt.delisted || qty < 1) return;

    state.stats.trades += 1;
    if (ui.side === 'buy') {
      if (value + fee > state.cash + 1e-9) return;
      if (dayChangePct(rt.history) <= -8) state.stats.boughtBigDip = true;
      const top = state.news[0];
      if (top && top.ticker === s.id && top.kind === 'news' && top.mood === 'down' && top.day === state.day && s.risk === 5) {
        state.stats.contrarianBuy = true;
      }
      if (rt.shares === 0) rt.firstBuyDay = state.day;
      state.cash -= value + fee;
      rt.shares += qty;
      rt.costBasis += value + fee; // the commission is part of what the shares cost you
      state.totalFees += fee;
      toast('Order filled', `Bought ${qty} ${s.id} at ${fmt(rt.price)}: ${fmt(value + fee)} with the ${fmt(fee)} commission.`, 'pos');
      if (!gainXp(XP.buy)) playSound('buy');
    } else {
      if (qty > rt.shares) return;
      const paid = avgCost(rt) * qty;
      const proceeds = value - fee;
      const profit = proceeds - paid;
      if (rt.distress) state.stats.soldWhileDistressed = true;
      state.stats.bestSaleProfit = Math.max(state.stats.bestSaleProfit, profit);
      state.cash += proceeds;
      rt.shares -= qty;
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
      toast('Order filled', `Sold ${qty} ${s.id} at ${fmt(rt.price)} ${result}, after the ${fmt(fee)} commission.`, profit > -0.005 ? 'pos' : 'neg');
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
      return `${s.id} needs a ${TIERS[s.tier].name} account. Watching a stock before you can buy it is a good way to learn how it behaves.`;
    }
    if (holdingsValue() === 0) {
      return 'Not sure where to start? The index fund, IDXF, spreads your money across the whole market, so no single company can sink you.';
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
  const SCREEN_TITLES = { landing: 'SimStock', home: 'Front page', trade: 'Trading floor', portfolio: 'Your portfolio', upgrades: 'Upgrades', achievements: 'Achievements', tutorial: 'How to play' };
  const OPEN_SCREENS = ['landing', 'home', 'portfolio', 'achievements', 'tutorial']; // viewable before a brokerage account exists

  function showScreen(name) {
    if (!OPEN_SCREENS.includes(name) && !state.accountOpen) {
      showLessons(0);
      return;
    }
    ui.screen = name;
    $('landingScreen').hidden = name !== 'landing';
    $('homeScreen').hidden = name !== 'home';
    $('tradeScreen').hidden = name !== 'trade';
    $('portfolioScreen').hidden = name !== 'portfolio';
    $('upgradesScreen').hidden = name !== 'upgrades';
    $('achievementsScreen').hidden = name !== 'achievements';
    $('tutorialScreen').hidden = name !== 'tutorial';
    document.querySelectorAll('.task-switch [data-screen]').forEach(b => {
      if (b.dataset.screen === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
    render();
    if (name === 'trade') {
      sizeChart();
      updateTip();
    }
    if (name === 'portfolio') sizeWorthChart();
    // move the keyboard to the new room, but not on the way in to the game
    if (booted && name !== 'landing') $('pageTitle').focus();
  }

  function selectStock(id) {
    ui.selected = id;
    chartHover = null;
    updateTip();
    render();
  }

  // ===========================================================
  // RENDER
  // ===========================================================
  function render() {
    renderChrome();
    renderTape();
    if (ui.screen === 'home') renderHome();
    if (ui.screen === 'trade') renderTrade();
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
  function renderTape() {
    const items = [
      `<span class="tape-item"><b>INDEX</b>${state.market.level.toFixed(2)} ${chg(dayChangePct(state.market.history))}</span>`,
      ...boardStocks().filter(trading).map(s => {
        const rt = rtOf(s.id);
        const ys = yearStats(rt.history);
        // a brand-new listing sets a "high" or "low" almost every day, so wait a month
        const flag = ys.days < 21 ? ''
          : ys.highAgo === 0 ? '<span class="tape-flag pos">52W HIGH</span>'
          : ys.lowAgo === 0 ? '<span class="tape-flag neg">52W LOW</span>'
          : '';
        return `<span class="tape-item"><b>${s.id}</b>${fmt(rt.price)} ${chg(dayChangePct(rt.history))}`
          + `<span class="tape-range">52W ${ys.low.toFixed(2)}–${ys.high.toFixed(2)}</span>${flag}</span>`;
      }),
    ].join('');
    $('tape').innerHTML = items + items;
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
        <td class="num">${rt.shares.toLocaleString('en-US')}</td>
        <td class="num">${fmt(rt.price)}<span class="sub">${chg(day)}</span></td>
        <td class="num">${fmt(value)}</td>
        <td class="num ${tone(ret)}">${fmtSigned(ret)}<span class="sub">${fmtPct((ret / rt.costBasis) * 100)}</span></td>
      </tr>`;
    }).join('');
    $('holdingsTable').innerHTML = `<table class="table">
      <thead><tr><th>Stock</th><th class="num">Shares</th><th class="num">Price</th><th class="num">Value</th><th class="num">Return</th></tr></thead>
      <tbody>${rows}</tbody></table>`;
  }

  function renderMovers() {
    const marketDay = dayChangePct(state.market.history);
    const marketEl = $('moversMarket');
    marketEl.textContent = `Index ${fmtPct(marketDay)}`;
    marketEl.className = tone(marketDay);

    const rows = boardStocks().filter(s => isUnlocked(s) && trading(s))
      .map(s => ({ s, rt: rtOf(s.id), change: dayChangePct(rtOf(s.id).history) }))
      .sort((a, b) => b.change - a.change)
      .map(({ s, rt, change }) => `<tr data-stock="${s.id}">
          <td>${tkr(s)}<span class="n">${s.name}</span></td>
          <td class="num">${fmt(rt.price)}</td>
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
          <td class="num">${rt.shares.toLocaleString('en-US')}</td>
          <td class="num">${fmt(avgCost(rt))}</td>
          <td class="num">${fmt(rt.price)}<span class="sub">${chg(dayChangePct(rt.history))}</span></td>
          <td class="num">${fmt(value)}</td>
          <td class="num ${tone(gain)}">${fmtSigned(gain)}<span class="sub">${fmtPct((gain / rt.costBasis) * 100)}</span></td>
          <td class="num">${fmt(rt.dividends)}</td>
        </tr>`;
      }).join('');
      $('pfTable').innerHTML = `<table class="table">
        <thead><tr><th>Stock</th><th class="num">Shares</th><th class="num">Avg cost</th><th class="num">Price</th><th class="num">Value</th><th class="num">Gain or loss</th><th class="num">Dividends</th></tr></thead>
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
  let watchRefs = {};
  let watchKey = '';

  // Built again whenever a company leaves the board or a new one joins it.
  function buildWatchlist() {
    const list = $('watchList');
    list.innerHTML = '';
    watchRefs = {};
    watchKey = boardKey();
    let group = -1;
    for (const s of boardStocks()) {
      if (s.tier !== group) {
        group = s.tier;
        list.appendChild(el(`<div class="watch-group tier-${group}">${TIERS[group].name} account</div>`));
      }
      const row = el(`<button class="watch-row">
          <span class="watch-id"><span class="watch-ticker">${s.id} ${riskPips(s)}</span><span class="watch-name">${s.name}</span></span>
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

  function renderTrade() {
    // market + watchlist
    $('marketLevel').textContent = state.market.level.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const marketDay = dayChangePct(state.market.history);
    $('marketChange').textContent = `${fmtPct(marketDay)} today`;
    $('marketChange').className = 'change-sm ' + tone(marketDay);

    if (watchKey !== boardKey()) buildWatchlist();
    if (!onBoard(STOCK_BY_ID[ui.selected])) ui.selected = boardStocks().find(trading).id;
    for (const s of boardStocks()) {
      const r = watchRefs[s.id];
      const rt = rtOf(s.id);
      const locked = !isUnlocked(s);
      r.row.classList.toggle('selected', s.id === ui.selected);
      if (s.id === ui.selected) r.row.setAttribute('aria-current', 'true');
      else r.row.removeAttribute('aria-current');
      r.row.classList.toggle('locked', locked || rt.delisted);
      r.price.textContent = rt.delisted ? '—' : fmt(rt.price);
      if (rt.delisted) {
        r.change.textContent = 'Delisted';
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

    // header + price
    $('dName').textContent = s.name;
    $('dMeta').innerHTML = `${s.id} · ${s.sector} · ${riskPips(s)} ${RISK[s.risk].label}`;
    $('dLock').hidden = !locked || rt.delisted;
    $('dLockText').textContent = TIERS[s.tier].name;
    const warn = $('dWarn');
    warn.hidden = !(rt.distress || rt.delisted);
    warn.textContent = rt.delisted
      ? `${s.name} has failed. These shares are worthless and trading is closed.`
      : `${s.name} has warned it may not be able to pay its debts. If it fails, shares in it become worthless.`;
    $('dPrice').textContent = fmt(rt.price);

    const dayPct = dayChangePct(rt.history);
    const dayAbs = rt.price - prevClose(rt.history);
    $('dChange').textContent = `${fmtSigned(dayAbs)} (${fmtPct(dayPct)}) today`;
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
    chart.setAttribute('aria-label', `${s.name} share price over the past ${RANGE_LABELS[ui.range]}: ${fmt(rt.price)}, ${fmtPct(rangePct)}.`);

    // key stats
    $('sCap').textContent = fmtBig(rt.price * s.sharesOut);
    $('sPe').textContent = (rt.price / rt.eps).toFixed(1);
    $('sEps').textContent = fmt(rt.eps);
    $('sDiv').textContent = s.divYield ? `${(s.divYield * 100).toFixed(1)}% · ${fmt(rt.price * s.divYield)} a share` : 'None';

    const ys = yearStats(rt.history);
    const span = ys.fullYear ? 'this year' : `in ${ys.days} days listed`;
    $('r52Label').textContent = ys.fullYear ? '52-week range' : `Range since listing (${ys.days} days)`;
    $('r52Lo').textContent = fmt(ys.low);
    $('r52Hi').textContent = fmt(ys.high);
    $('r52LoWhen').textContent = daysAgo(ys.lowAgo);
    $('r52HiWhen').textContent = daysAgo(ys.highAgo);
    const spread = ys.high - ys.low;
    $('r52Dot').style.left = (spread > 0 ? ((rt.price - ys.low) / spread) * 100 : 50) + '%';
    const aboveLow = (rt.price / ys.low - 1) * 100;
    const belowHigh = (1 - rt.price / ys.high) * 100;
    $('r52Note').innerHTML = ys.highAgo === 0 ? `<span class="pos">At its high for ${span}</span>`
      : ys.lowAgo === 0 ? `<span class="neg">At its low for ${span}</span>`
      : `${aboveLow.toFixed(1)}% above the low · ${belowHigh.toFixed(1)}% below the high`;
    $('sReturnLabel').textContent = ys.fullYear ? '1-year return' : 'Since listing';
    $('sReturn').textContent = fmtPct(ys.returnPct);
    $('sReturn').className = tone(ys.returnPct);
    $('sDayMove').textContent = `±${ys.typicalDayPct.toFixed(1)}%`;
    $('sDrawLabel').textContent = ys.fullYear ? 'Worst fall this year' : 'Worst fall since listing';
    $('sDraw').textContent = ys.worstPct < 0 ? fmtPct(ys.worstPct) : 'None';
    $('sDraw').className = ys.worstPct < 0 ? 'neg' : '';
    $('sVol').textContent = `${s.risk} of 5 · swings ${Math.round(s.vol * 100)}%/yr`;
    $('sVolNote').textContent = canFail(s)
      ? `Grows faster on average, but ${s.risk === 5 ? 'can fail with little or no warning' : 'can fail if things go badly'}`
      : 'Grows slowly, and too solid to fail outright';
    $('sBeta').textContent = s.beta.toFixed(2);

    // about + calendar
    $('dAbout').textContent = s.about;
    $('calEarningsRow').hidden = !!s.fund;
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
    const closed = locked || rt.delisted;
    $('orderForm').hidden = closed;
    $('orderLocked').hidden = !closed;
    if (rt.delisted) {
      $('lockedTitle').textContent = `${s.id} has been delisted`;
      $('lockedText').textContent = `${s.name} failed, and its shares are worth nothing. Trading in it is closed for good.`;
      return;
    }
    if (locked) {
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
    const qty = orderQty();
    const value = qty * rt.price;
    const fee = qty > 0 ? commission(value) : 0;
    const cashAfter = buying ? state.cash - value - fee : state.cash + value - fee;

    $('oPrice').textContent = fmt(rt.price);
    $('oTotalLabel').textContent = buying ? 'Shares cost' : 'Shares sold for';
    $('oTotal').textContent = fmt(value);
    $('oFee').textContent = fmt(fee);
    setV($('oCashAfter'), fmt(cashAfter), cashAfter < 0 ? 'neg' : '');

    let problem = '';
    if (qty < 1) problem = 'Enter how many shares to trade.';
    else if (buying && value + fee > state.cash + 1e-9) problem = `Not enough cash. With the commission you can afford ${maxBuyQty(rt.price)} shares.`;
    else if (!buying && qty > rt.shares) problem = rt.shares ? `You only own ${rt.shares} shares of ${s.id}.` : `You don't own any ${s.id} yet.`;

    const btn = $('placeOrderBtn');
    btn.disabled = !!problem;
    btn.className = `btn btn-block ${buying ? 'btn-buy' : 'btn-sell'}`;
    btn.textContent = `${buying ? 'Buy' : 'Sell'} ${qty || ''} ${s.id}`.replace('  ', ' ');
    const hint = $('orderHint');
    hint.textContent = problem || `Market order: fills instantly at the current price. The broker takes ${(COMMISSION_RATE * 100).toFixed(2)}% of every trade, at least ${fmt(COMMISSION_MIN)}.`;
    hint.classList.toggle('warn', !!problem);
  }

  function renderPosition(s, rt) {
    $('positionTitle').textContent = `Your ${s.id} shares`;
    const value = rt.shares * rt.price;
    const unrealized = value - rt.costBasis;
    setV($('pShares'), rt.shares.toLocaleString('en-US'));
    setV($('pAvg'), rt.shares ? fmt(avgCost(rt)) : '—');
    setV($('pValue'), fmt(value));
    if (rt.shares) setV($('pReturn'), `${fmtSigned(unrealized)} (${fmtPct((unrealized / rt.costBasis) * 100)})`, tone(unrealized));
    else setV($('pReturn'), '—');
    const realized = Math.abs(rt.realized) < 0.005 ? 0 : rt.realized;
    setV($('pRealized'), fmtSigned(realized), realized ? tone(realized) : '');
    setV($('pDivs'), fmt(rt.dividends), rt.dividends ? 'pos' : '');
  }

  const NEWS_KINDS = { market: 'Economy', earnings: 'Earnings', news: 'Company news', dividend: 'Dividend', listing: 'New listing' };

  function renderNews() {
    const top = state.news[0];
    const key = `${state.tier}:${state.news.length}:${top ? top.day + top.text : ''}`;
    if (key === renderedNewsKey) return;
    renderedNewsKey = key;

    const visible = state.news
      .filter(n => n.ticker === 'MKT' || isUnlocked(STOCK_BY_ID[n.ticker]))
      .slice(0, 20);
    const html = visible.map(n => `<li class="news-item ${n.mood}">
        <div class="news-meta">${n.ticker === 'MKT' ? 'Economy' : `${n.ticker} · ${NEWS_KINDS[n.kind]}`} · Day ${Math.max(0, n.day) + 1}</div>
        <div class="news-text">${n.text}</div>
      </li>`).join('') || '<li class="empty">Quiet so far.</li>';
    // the same headlines appear on the front page and the trading floor
    ['newsList', 'homeNews'].forEach(id => { if ($(id)) $(id).innerHTML = html; });
  }

  // ---------- Chart ----------
  const chart = $('chart');
  const chartCtx = chart.getContext('2d');
  const CHART = { pos: '#4cc38a', neg: '#ff6f5e', accent: '#f0b73d', ink: '#efe8d8', text: '#857c6c', grid: 'rgba(239,232,216,0.07)' };

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
    return { dpr, w, h, left: 4, right: w - 70, top: 12, bottom: h - 26 };
  }

  function daysAgoLabel(days) {
    if (days === 0) return 'Today';
    if (days >= 42) return `${Math.round(days / 21)} months ago`;
    return `${days} days ago`;
  }

  function drawChart() {
    if (ui.screen !== 'trade' || !chart.width) return;
    const rt = rtOf(ui.selected);
    const data = rt.history.slice(-ui.range);
    const n = data.length;
    const box = chartBox();
    const ctx = chartCtx;
    ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);

    const values = rt.shares ? data.concat(avgCost(rt)) : data;
    let min = Math.min(...values);
    let max = Math.max(...values);
    const pad = (max - min) * 0.08 || max * 0.02;
    min -= pad;
    max += pad;
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
      ctx.fillText(fmt(v), box.right + 10, yy);
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
      ctx.fillText(`you paid ${fmt(avgCost(rt))} a share`, box.left + 6, above ? yy - 4 : yy + 4);
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
    tip.innerHTML = `<strong>${fmt(data[i])}</strong>${daysAgoLabel(n - 1 - i)}`;
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
        if (e.wiped) {
          toast('A company has failed', `${e.ticker} collapsed and your ${e.wiped} shares are now worthless.`, 'neg');
          playSound('fail');
          state.stats.wasBurned = true;
          // aim to recover to whatever your net worth was the day before this hit
          const peakBefore = Math.max(0, ...state.worth.history.slice(0, -1));
          state.stats.burnRecoveryTarget = Math.max(state.stats.burnRecoveryTarget ?? 0, peakBefore);
          continue;
        }
        if (e.kind === 'dividend') continue;
        if (e.kind === 'listing' && isUnlocked(STOCK_BY_ID[e.ticker]) && shown++ < 2) {
          toast('New on the exchange', e.text, 'accent');
          continue;
        }
        const affectsYou = e.ticker === 'MKT' ? holdingsValue() > 0 : rtOf(e.ticker).shares > 0;
        if (affectsYou && shown++ < 2) {
          const title = e.ticker === 'MKT' ? 'Market news' : `${e.ticker} · ${NEWS_KINDS[e.kind]}`;
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
    ui.selected = row.dataset.stock;
    showScreen('trade');
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
  $('qtyMinus').onclick = () => setQty(orderQty() - 1);
  $('qtyPlus').onclick = () => setQty(orderQty() + 1);
  $('qtyMax').onclick = () => {
    const rt = rtOf(ui.selected);
    setQty(ui.side === 'buy' ? maxBuyQty(rt.price) : rt.shares);
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
  window.addEventListener('resize', () => { sizeChart(); sizeWorthChart(); });
  window.addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });

  buildWatchlist();
  buildUpgrades();
  buildAchievements();
  scanAchievements(true); // quietly catch up an existing save; no toast spam for old progress
  showScreen('landing');
  booted = true;
  updateTip();
  checkOfflineEarnings();
  lastTickAt = Date.now();
  setInterval(tick, 1000);
})();
