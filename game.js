// SimStock — game logic.
// Everything the game needs to remember lives in `state`, which is saved to
// localStorage so progress survives a reload. One game second is one trading day.
(() => {
  'use strict';

  // ===========================================================
  // TUNING
  // ===========================================================
  const STARTING_CASH = 1000;
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
    { name: 'Silver',   cost: 2500,  level: 3,  blurb: 'Adds a fast-growing automaker and a major bank.' },
    { name: 'Gold',     cost: 15000, level: 6,  blurb: 'Adds higher-risk sectors: biotech and energy.' },
    { name: 'Platinum', cost: 75000, level: 10, blurb: 'Adds large, premium-priced companies.' },
  ];

  const STOCKS = [
    { id: 'IDXF', name: 'Evergreen Total Market Fund', sector: 'Index fund', fund: true, tier: 0, start: 250, vol: 0.16, beta: 1.0, growth: 0.07, pe: 20, divYield: 0.015, sharesOut: 2.1e9, color: '#7f9cc4',
      about: 'Owns a small slice of every company in the market. It moves with the market as a whole, so it swings less than most single stocks.' },
    { id: 'TICK', name: 'Tickr Inc.', sector: 'Technology', tier: 0, start: 100, vol: 0.32, beta: 1.2, growth: 0.12, pe: 30, divYield: 0, sharesOut: 850e6, color: '#5b8def',
      about: 'Builds trading software and cloud tools for banks. It is growing quickly and reinvests its profits instead of paying a dividend.' },
    { id: 'BRWL', name: 'Brightwell Foods', sector: 'Consumer staples', tier: 0, start: 48, vol: 0.17, beta: 0.6, growth: 0.05, pe: 18, divYield: 0.032, sharesOut: 1.4e9, color: '#c9a45c',
      about: 'Makes cereal, snacks and frozen meals. People buy groceries in good times and bad, so the stock is steady and pays a regular dividend.' },
    { id: 'VOLT', name: 'Voltaic Motors', sector: 'Automotive', tier: 1, start: 64, vol: 0.55, beta: 1.6, growth: 0.15, pe: 45, divYield: 0, sharesOut: 1.1e9, color: '#4fb3a9',
      about: 'An electric vehicle maker betting big on new factories. Investors expect a lot of growth, so the stock swings hard on any news.' },
    { id: 'NRTH', name: 'Northgate Bank', sector: 'Financials', tier: 1, start: 72, vol: 0.25, beta: 1.15, growth: 0.06, pe: 11, divYield: 0.036, sharesOut: 2.6e9, color: '#8a93d6',
      about: 'A large bank that earns money lending to families and businesses. It tends to rise and fall with the overall economy.' },
    { id: 'HELX', name: 'Helix Therapeutics', sector: 'Biotech', tier: 2, start: 38, vol: 0.62, beta: 0.8, growth: 0.14, pe: 40, divYield: 0, sharesOut: 520e6, color: '#b98ac6',
      about: 'Develops new medicines. A single drug trial result can send the stock sharply up or down, no matter what the market is doing.' },
    { id: 'CRST', name: 'Crestline Energy', sector: 'Energy', tier: 2, start: 91, vol: 0.30, beta: 0.9, growth: 0.04, pe: 12, divYield: 0.045, sharesOut: 1.9e9, color: '#d08a57',
      about: 'Produces oil and natural gas. Its price follows energy prices, and it returns much of its cash to investors as dividends.' },
    { id: 'ORBT', name: 'Orbital Systems', sector: 'Aerospace', tier: 3, start: 220, vol: 0.40, beta: 1.3, growth: 0.13, pe: 35, divYield: 0, sharesOut: 640e6, color: '#6aa6d6',
      about: 'Launches satellites and builds spacecraft for governments. Big contracts can lift the stock, and launch failures can sink it.' },
    { id: 'SUMT', name: 'Summit Global Holdings', sector: 'Conglomerate', tier: 3, start: 410, vol: 0.18, beta: 0.9, growth: 0.08, pe: 22, divYield: 0.022, sharesOut: 1.3e9, color: '#9aa7b8',
      about: 'Owns dozens of businesses, from insurance to railroads. Pricey per share, but steady, diversified and a reliable dividend payer.' },
  ];
  const STOCK_BY_ID = Object.fromEntries(STOCKS.map(s => [s.id, s]));

  const STAFF = [
    { id: 'analyst',  name: 'Research Analyst',  tier: 0, baseCost: 50,     growth: 1.15, income: 1,    about: 'Writes research notes that clients pay for.' },
    { id: 'advisor',  name: 'Financial Advisor', tier: 1, baseCost: 1200,   growth: 1.16, income: 15,   about: 'Helps clients plan their savings for a fee.' },
    { id: 'manager',  name: 'Portfolio Manager', tier: 2, baseCost: 12000,  growth: 1.18, income: 140,  about: 'Runs client portfolios for a management fee.' },
    { id: 'director', name: 'Fund Director',     tier: 3, baseCost: 150000, growth: 1.2,  income: 1600, about: 'Oversees whole funds for large institutions.' },
  ];

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

    for (const s of STOCKS) {
      const rt = st.stocks[s.id];
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

      rt.price = Math.max(0.5, rt.price * Math.exp(move));
      pushHistory(rt.history, rt.price);

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
    return events;
  }

  // ===========================================================
  // STATE + SAVING
  // ===========================================================
  function freshState() {
    const st = {
      version: 2,
      day: -DAYS_PER_YEAR,
      cash: STARTING_CASH,
      xp: 0,
      level: 1,
      tier: 0,
      accountOpen: false,
      staff: Object.fromEntries(STAFF.map(s => [s.id, 0])),
      totalDividends: 0,
      market: { level: 1000, history: [] },
      stocks: {},
      news: [],
      lastSeen: Date.now(),
    };
    STOCKS.forEach((s, i) => {
      st.stocks[s.id] = {
        price: s.start,
        eps: s.start / s.pe,
        history: [],
        shares: 0,
        costBasis: 0,
        realized: 0,
        dividends: 0,
        earningsDay: (i * 7 + 20) % DAYS_PER_QUARTER,
      };
    });
    // Play one quiet year so every chart has real history on day one.
    for (let i = 0; i < DAYS_PER_YEAR; i++) simulateDay(st);
    st.news = [{ day: st.day, ticker: 'MKT', mood: 'neutral', kind: 'market', text: 'Markets are open. Welcome to your trading desk.' }];
    return st;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || localStorage.getItem(OLD_SAVE_KEY));
      if (saved && saved.version === 2) return saved;
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

  let state = loadState();
  const ui = { screen: 'landing', selected: 'TICK', range: 63, side: 'buy' };
  let tickCount = 0;
  let lastTickAt = Date.now();
  let tipIndex = 0;
  let lastTip = '';
  let renderedNewsKey = '';
  let chartHover = null;

  // ===========================================================
  // DERIVED NUMBERS
  // ===========================================================
  const rtOf = id => state.stocks[id];
  const isUnlocked = s => state.tier >= s.tier;
  const avgCost = rt => (rt.shares ? rt.costBasis / rt.shares : 0);
  const staffCost = s => s.baseCost * Math.pow(s.growth, state.staff[s.id]);
  const staffIncome = () => STAFF.reduce((sum, s) => sum + state.staff[s.id] * s.income, 0);
  const holdingsValue = () => STOCKS.reduce((sum, s) => sum + rtOf(s.id).shares * rtOf(s.id).price, 0);
  const netWorth = () => state.cash + holdingsValue();

  function prevClose(list) {
    return list.length > 1 ? list[list.length - 2] : list[list.length - 1];
  }
  function dayChangePct(list) {
    return (list[list.length - 1] / prevClose(list) - 1) * 100;
  }

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

  const modalRoot = $('modalRoot');
  const modalQueue = [];

  // Opens a modal, or swaps the content of the one already open.
  function openModal(html) {
    let modal = modalRoot.querySelector('.modal');
    if (!modal) {
      modalRoot.innerHTML = '<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"></div></div>';
      modal = modalRoot.querySelector('.modal');
    }
    modal.innerHTML = html;
    const focusTarget = modal.querySelector('.btn-ink, .btn');
    if (focusTarget) focusTarget.focus();
    return modal;
  }

  function closeModal() {
    modalRoot.innerHTML = '';
    const next = modalQueue.shift();
    if (next) next();
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
    const earned = Math.floor(away) * staffIncome();
    if (away < 30 || earned <= 0) return;
    state.cash += earned;
    saveState();
    queueModal(() => {
      const modal = openModal(`
        <div class="modal-kicker">Welcome back</div>
        <h3>Your staff kept working</h3>
        <p>You were away for ${formatDuration(away)}. The market stayed closed, but your staff kept earning${away >= OFFLINE_CAP_SEC ? ' (they stop after two hours)' : ''}.</p>
        <div class="reward">+${fmt(earned)}</div>
        <div class="modal-actions"><button class="btn btn-ink" data-act="ok">Collect</button></div>`);
      modal.querySelector('[data-act="ok"]').onclick = () => {
        closeModal();
        render();
      };
    });
  }

  function showTierUnlocked(i) {
    const tier = TIERS[i];
    const stocks = STOCKS.filter(s => s.tier === i);
    const staff = STAFF.filter(s => s.tier === i);
    const modal = openModal(`
      <div class="modal-kicker">Account upgraded</div>
      <h3>Welcome to ${tier.name}</h3>
      <p>You can now trade ${stocks.length} more companies:</p>
      <ul class="new-stocks">
        ${stocks.map(s => `<li>${tkr(s)}<span>${s.name}</span><span class="muted">${s.sector}</span></li>`).join('')}
      </ul>
      ${staff.length ? `<p>You can also hire a new role: ${staff.map(s => s.name).join(', ')}.</p>` : ''}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="close">Close</button>
        <button class="btn btn-ink" data-act="trade">Start trading</button>
      </div>`);
    modal.querySelector('[data-act="close"]').onclick = closeModal;
    modal.querySelector('[data-act="trade"]').onclick = () => {
      ui.selected = stocks[0].id;
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
        <button class="btn btn-ghost btn-block" data-act="basics">Replay investing basics</button>
        <button class="btn btn-danger btn-block" data-act="reset">Reset all progress</button>
      </div>
      <div class="modal-actions"><button class="btn btn-ghost" data-act="close">Close</button></div>`);

    let confirming = false;
    modal.querySelector('[data-act="basics"]').onclick = () => showLessons(0);
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
      lastTip = '';
      renderedNewsKey = '';
      saveState();
      closeModal();
      showScreen('home');
      toast('Progress reset', 'Your desk is back to day one.');
    };
  }

  // ===========================================================
  // ACTIONS
  // ===========================================================
  function gainXp(amount) {
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
    }
  }

  function afterAction() {
    updateTip();
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
    const total = qty * rt.price;
    if (!isUnlocked(s) || qty < 1) return;

    if (ui.side === 'buy') {
      if (total > state.cash + 1e-9) return;
      state.cash -= total;
      rt.shares += qty;
      rt.costBasis += total;
      toast('Order filled', `Bought ${qty} ${s.id} at ${fmt(rt.price)} for ${fmt(total)}.`, 'pos');
      gainXp(XP.buy);
    } else {
      if (qty > rt.shares) return;
      const paid = avgCost(rt) * qty;
      const profit = total - paid;
      state.cash += total;
      rt.shares -= qty;
      rt.costBasis = rt.shares ? rt.costBasis - paid : 0;
      rt.realized += profit;
      const result = Math.abs(profit) < 0.005 ? 'at break-even' : `for a ${fmt(Math.abs(profit))} ${profit > 0 ? 'profit' : 'loss'}`;
      toast('Order filled', `Sold ${qty} ${s.id} at ${fmt(rt.price)} ${result}.`, profit > -0.005 ? 'pos' : 'neg');
      gainXp(profit > 0 ? sellProfitXp(profit) : XP.sellLoss);
    }
    afterAction();
  }

  function hire(staff) {
    const cost = staffCost(staff);
    if (state.tier < staff.tier || state.cash < cost) return;
    state.cash -= cost;
    state.staff[staff.id] += 1;
    toast('Staff hired', `${staff.name} adds ${fmt(staff.income)} per trading day.`, 'accent');
    gainXp(XP.hire);
    afterAction();
  }

  function upgradeTier(i) {
    if (!tierReady(i)) return;
    state.cash -= TIERS[i].cost;
    state.tier = i;
    queueModal(() => showTierUnlocked(i));
    gainXp(XP.tier);
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
  const SCREEN_TITLES = { landing: 'SimStock', home: 'Front page', trade: 'Trading floor', portfolio: 'Your portfolio', upgrades: 'Upgrades' };
  const OPEN_SCREENS = ['landing', 'home', 'portfolio']; // viewable before a brokerage account exists

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
    window.scrollTo(0, 0);
    render();
    if (name === 'trade') {
      sizeChart();
      updateTip();
    }
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
  }

  function renderChrome() {
    const need = xpToNext(state.level);
    $('pageTitle').textContent = SCREEN_TITLES[ui.screen];
    $('clockText').textContent = clockLabel();
    $('topCash').textContent = fmtBig(state.cash);
    $('topWorth').textContent = fmtBig(netWorth());
    $('topIncome').textContent = `${fmtBig(staffIncome())}/day`;
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
      ...STOCKS.map(s => `<span class="tape-item"><b>${s.id}</b>${fmt(rtOf(s.id).price)} ${chg(dayChangePct(rtOf(s.id).history))}</span>`),
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
    $('homeIncome').textContent = `${fmt(staffIncome())}/day`;
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
  }

  let tierChipsFor = -1;
  function renderTierProgress() {
    const nextIndex = state.tier + 1;
    const next = TIERS[nextIndex];
    $('tierNext').hidden = !next;
    $('tierMaxed').hidden = !!next;
    if (!next) return;

    $('tierNextTitle').textContent = `${next.name} account`;
    if (tierChipsFor !== nextIndex) {
      $('tierNextStocks').innerHTML = tkrList(STOCKS.filter(s => s.tier === nextIndex));
      tierChipsFor = nextIndex;
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

    const rows = STOCKS.filter(isUnlocked)
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

  // ---------- Trading ----------
  const watchRefs = {};

  function buildWatchlist() {
    const list = $('watchList');
    let group = -1;
    for (const s of STOCKS) {
      if (s.tier !== group) {
        group = s.tier;
        list.appendChild(el(`<div class="watch-group tier-${group}">${TIERS[group].name} account</div>`));
      }
      const row = el(`<button class="watch-row">
          <span class="watch-id"><span class="watch-ticker">${s.id}</span><span class="watch-name">${s.name}</span></span>
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

    for (const s of STOCKS) {
      const r = watchRefs[s.id];
      const rt = rtOf(s.id);
      const locked = !isUnlocked(s);
      r.row.classList.toggle('selected', s.id === ui.selected);
      r.row.classList.toggle('locked', locked);
      r.price.textContent = fmt(rt.price);
      if (locked) {
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
    $('dMeta').textContent = `${s.id} · ${s.sector}`;
    $('dLock').hidden = !locked;
    $('dLockText').textContent = TIERS[s.tier].name;
    $('dPrice').textContent = fmt(rt.price);

    const dayPct = dayChangePct(rt.history);
    const dayAbs = rt.price - prevClose(rt.history);
    $('dChange').textContent = `${fmtSigned(dayAbs)} (${fmtPct(dayPct)}) today`;
    $('dChange').className = 'change chg ' + tone(dayPct);
    const range = rt.history.slice(-ui.range);
    const rangePct = (range[range.length - 1] / range[0] - 1) * 100;
    $('dRange').textContent = `${fmtPct(rangePct)} past ${RANGE_LABELS[ui.range]}`;
    $('dRange').className = 'range-change ' + tone(rangePct);
    document.querySelectorAll('#rangeSeg button').forEach(b => b.classList.toggle('active', Number(b.dataset.range) === ui.range));

    // key stats
    $('sCap').textContent = fmtBig(rt.price * s.sharesOut);
    $('sPe').textContent = (rt.price / rt.eps).toFixed(1);
    $('sDiv').textContent = s.divYield ? (s.divYield * 100).toFixed(1) + '%' : 'None';
    $('sRange').textContent = `${fmt(Math.min(...rt.history))} – ${fmt(Math.max(...rt.history))}`;
    $('sVol').textContent = `${s.vol < 0.2 ? 'Low' : s.vol < 0.4 ? 'Medium' : 'High'} · ${Math.round(s.vol * 100)}%/yr`;
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
    $('orderForm').hidden = locked;
    $('orderLocked').hidden = !locked;
    if (locked) {
      $('lockedTitle').textContent = `${s.id} needs a ${TIERS[s.tier].name} account`;
      $('lockedText').textContent = `You can watch the price and read the news in the meantime. Trading opens once you upgrade.`;
      return;
    }

    const buying = ui.side === 'buy';
    document.querySelectorAll('#sideSeg button').forEach(b => b.classList.toggle('active', b.dataset.side === ui.side));
    const qty = orderQty();
    const total = qty * rt.price;
    const cashAfter = buying ? state.cash - total : state.cash + total;

    $('oPrice').textContent = fmt(rt.price);
    $('oTotalLabel').textContent = buying ? 'Estimated cost' : 'Estimated proceeds';
    $('oTotal').textContent = fmt(total);
    setV($('oCashAfter'), fmt(cashAfter), cashAfter < 0 ? 'neg' : '');

    let problem = '';
    if (qty < 1) problem = 'Enter how many shares to trade.';
    else if (buying && total > state.cash + 1e-9) problem = `Not enough cash. You can afford ${Math.floor(state.cash / rt.price)} shares.`;
    else if (!buying && qty > rt.shares) problem = rt.shares ? `You only own ${rt.shares} shares of ${s.id}.` : `You don't own any ${s.id} yet.`;

    const btn = $('placeOrderBtn');
    btn.disabled = !!problem;
    btn.className = `btn btn-block ${buying ? 'btn-buy' : 'btn-sell'}`;
    btn.textContent = `${buying ? 'Buy' : 'Sell'} ${qty || ''} ${s.id}`.replace('  ', ' ');
    const hint = $('orderHint');
    hint.textContent = problem || 'Market order: fills instantly at the current price.';
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

  const NEWS_KINDS = { market: 'Economy', earnings: 'Earnings', news: 'Company news', dividend: 'Dividend' };

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
          <div class="tier-stocks">${tkrList(STOCKS.filter(s => s.tier === i))}</div>
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
          <div class="kv"><span class="label">Pay per day</span><span class="v">${fmt(st.income)}</span></div>
          <div class="kv"><span class="label">On staff</span><span class="v staff-count"></span></div>
          <div class="kv"><span class="label">Team earns</span><span class="v staff-total"></span></div>
          <button class="btn btn-ghost btn-block"></button>
        </div>`);
      const btn = row.querySelector('button');
      btn.onclick = () => hire(st);
      list.appendChild(row);
      staffRefs[st.id] = { row, btn, count: row.querySelector('.staff-count'), total: row.querySelector('.staff-total') };
    }
  }

  function setReq(node, met) {
    if (node.classList.contains('met') === met && node.dataset.drawn) return;
    node.dataset.drawn = '1';
    node.classList.toggle('met', met);
    node.querySelector('.req-icon').textContent = met ? '✓' : '·';
  }

  function renderUpgrades() {
    TIERS.forEach((t, i) => {
      const r = tierRefs[i];
      const owned = i <= state.tier;
      const current = i === state.tier;
      const next = i === state.tier + 1;
      r.card.classList.toggle('current', current);
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
      r.total.textContent = fmt(count * st.income);
      r.btn.disabled = locked || state.cash < cost;
      r.btn.textContent = locked ? `Needs ${TIERS[st.tier].name}` : `Hire for ${fmt(cost)}`;
    }
  }

  // ===========================================================
  // GAME LOOP
  // Once a second: pay staff, simulate one trading day, report news.
  // ===========================================================
  function tick() {
    tickCount += 1;

    // Background tabs get throttled, so pay staff for all the time that passed.
    const now = Date.now();
    const seconds = Math.min(OFFLINE_CAP_SEC, Math.max(1, Math.round((now - lastTickAt) / 1000)));
    lastTickAt = now;
    state.cash += staffIncome() * seconds;

    const events = simulateDay(state);
    if (events.length) {
      state.news.unshift(...events.slice().reverse());
      state.news.length = Math.min(state.news.length, NEWS_KEEP);

      // the title screen stays quiet
      let shown = ui.screen === 'landing' ? 99 : 0;
      for (const e of events) {
        if (e.paid) {
          if (ui.screen !== 'landing') toast('Dividend received', `+${fmt(e.paid)} from your ${e.shares} ${e.ticker} shares.`, 'pos');
          gainXp(XP.dividend);
          continue;
        }
        if (e.kind === 'dividend') continue;
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

  $('openAccountBtn').onclick = () => showLessons(0);
  $('settingsBtn').onclick = showSettings;
  $('tierUpgradeBtn').onclick = () => upgradeTier(state.tier + 1);
  $('placeOrderBtn').onclick = placeOrder;
  $('qtyMinus').onclick = () => setQty(orderQty() - 1);
  $('qtyPlus').onclick = () => setQty(orderQty() + 1);
  $('qtyMax').onclick = () => {
    const rt = rtOf(ui.selected);
    setQty(ui.side === 'buy' ? Math.floor(state.cash / rt.price) : rt.shares);
  };
  $('qtyInput').addEventListener('input', render);
  $('qtyInput').addEventListener('keydown', e => { if (e.key === 'Enter') placeOrder(); });

  document.querySelectorAll('#sideSeg button').forEach(b => {
    b.onclick = () => { ui.side = b.dataset.side; render(); };
  });
  document.querySelectorAll('#rangeSeg button').forEach(b => {
    b.onclick = () => { ui.range = Number(b.dataset.range); chartHover = null; render(); };
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalRoot.firstElementChild) closeModal();
  });
  window.addEventListener('resize', sizeChart);
  window.addEventListener('pagehide', saveState);
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveState(); });

  buildWatchlist();
  buildUpgrades();
  showScreen('landing');
  updateTip();
  checkOfflineEarnings();
  lastTickAt = Date.now();
  setInterval(tick, 1000);
})();
