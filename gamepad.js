// Playing SimStock with a controller.
//
// This is here for the Steam Deck. Everything in the game is a mouse click,
// and Deck Verified needs a game to be playable without ever touching one.
//
// It works with the game rather than inside it. The game is already built out
// of real <button> elements, so there is nothing to focus that the browser
// does not already know how to focus — what is missing is a way to move that
// focus around with a thumb. So this file does two things: it moves focus in
// the direction pushed, and it turns the remaining buttons into the keyboard
// events the game already listens for (Escape closes a modal, space pauses
// the market). No game logic lives here, and game.js does not know it exists.
//
// The web build gets this too. A browser with a pad plugged in is a browser
// with a pad plugged in, and the desktop build is the same files.
'use strict';

(function () {
  // The Standard Gamepad mapping, which is what a Deck, an Xbox pad and a
  // DualSense all report. A pad that reports something else gets the same
  // indices and may land somewhere odd; that is better than ignoring it.
  const A = 0, B = 1, LB = 4, RB = 5, START = 9;
  const DPAD = { 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

  const DEADZONE = 0.55;      // a stick at rest is not always at zero
  const REPEAT_FIRST = 400;   // held: how long before it starts repeating
  const REPEAT_AGAIN = 130;   // held: and how fast after that

  const FOCUSABLE = [
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'a[href]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  // Held buttons, by code, each remembering when it may fire again. Directions
  // repeat while held; everything else fires once on the press.
  const held = new Map();
  let usingPad = false;

  // Overridable so the tests can plug in a pad that does not exist. Everything
  // below reads the pads through this one function.
  let source = () => (navigator.getGamepads ? Array.from(navigator.getGamepads() || []) : []);

  // ---------------------------------------------------------------
  // What can be reached
  // ---------------------------------------------------------------

  // A hidden screen is display:none, so its buttons have no box and drop out
  // here without anyone having to keep a list of screens.
  function reachable(el) {
    if (el.hidden || el.disabled) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
  }

  function modalOpen() {
    const modal = document.getElementById('modalRoot');
    return !!(modal && modal.firstElementChild);
  }

  // A modal keeps the pad to itself, exactly as it already keeps Tab.
  function scope() {
    return modalOpen() ? document.getElementById('modalRoot') : document.body;
  }

  const stops = () => Array.from(scope().querySelectorAll(FOCUSABLE)).filter(reachable);

  // ---------------------------------------------------------------
  // Which way is that
  // ---------------------------------------------------------------
  const middle = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  // The nearest thing in the direction pushed, preferring something the
  // current element actually lines up with. Without that preference a push
  // rightwards along a row of buttons will happily jump to a nearer one on the
  // line below, which feels broken in a way that is hard to describe and
  // obvious to use.
  function pick(from, candidates, dir) {
    const a = from.getBoundingClientRect();
    const ac = middle(a);
    const sideways = dir === 'left' || dir === 'right';
    let best = null;
    let bestScore = Infinity;

    for (const el of candidates) {
      if (el === from) continue;
      const b = el.getBoundingClientRect();
      const bc = middle(b);
      const dx = bc.x - ac.x;
      const dy = bc.y - ac.y;

      // How far it is the way we are going. Behind us does not count.
      const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
      if (along <= 2) continue;

      const across = sideways ? Math.abs(dy) : Math.abs(dx);
      const overlap = sideways
        ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        : Math.min(a.right, b.right) - Math.max(a.left, b.left);

      const score = along + (overlap > 0 ? across * 0.2 : across * 3);
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function move(dir) {
    const all = stops();
    if (!all.length) return false;

    const current = all.includes(document.activeElement) ? document.activeElement : null;
    if (!current) { focus(all[0]); return true; }

    const next = pick(current, all, dir);
    if (!next) return false;
    focus(next);
    return true;
  }

  function focus(el) {
    el.focus({ preventScroll: true });
    // Keep it on screen, but without yanking the page around for something
    // that is already comfortably visible.
    const r = el.getBoundingClientRect();
    if (r.top < 8 || r.bottom > window.innerHeight - 8) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // ---------------------------------------------------------------
  // What the buttons do
  // ---------------------------------------------------------------

  // Rather than reach into game.js, say the same thing the keyboard says. The
  // game already knows what to do with these, and there is one behaviour to
  // keep working instead of two.
  function key(k) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
  }

  function activate() {
    const el = document.activeElement;
    if (!el || !stops().includes(el)) return false;
    // A number field has −, + and Max buttons beside it, so a pad never needs
    // to type into one. Pressing A on it would open a keyboard for nothing.
    if (el.tagName === 'INPUT' && el.type === 'number') return false;
    el.click();
    return true;
  }

  function back() {
    if (modalOpen()) { key('Escape'); return true; }
    const home = document.querySelector('.task-switch [data-screen="home"]');
    if (home && reachable(home) && !home.hasAttribute('aria-current')) { home.click(); return true; }
    return false;
  }

  // The shoulder buttons page through the same tabs the mouse clicks, which is
  // what makes the whole game reachable without a spatial route to every screen.
  function tab(step) {
    // Not while something is open. A modal that let the shoulders move the
    // screen behind it would close onto a room the player never asked for,
    // and the keyboard already refuses to pause from inside one.
    if (modalOpen()) return false;
    const tabs = Array.from(document.querySelectorAll('.task-switch [data-screen]')).filter(reachable);
    if (tabs.length < 2) return false;
    const at = tabs.findIndex(b => b.hasAttribute('aria-current'));
    const next = tabs[((at < 0 ? 0 : at + step) + tabs.length) % tabs.length];
    next.click();
    // The old screen's focus went with it.
    focus(next);
    return true;
  }

  function press(code) {
    if (DPAD[code]) return move(DPAD[code]);
    if (code === A) return activate();
    if (code === B) return back();
    if (code === LB) return tab(-1);
    if (code === RB) return tab(1);
    if (code === START) { key(' '); return true; }
    return false;
  }

  // ---------------------------------------------------------------
  // Reading the pad
  // ---------------------------------------------------------------

  // The stick is reported as an axis, but it should feel like the d-pad, so it
  // is turned into the same presses. Only the strongest direction counts, or a
  // diagonal would fire two.
  function stickCode(pad) {
    const x = pad.axes[0] || 0;
    const y = pad.axes[1] || 0;
    if (Math.abs(x) < DEADZONE && Math.abs(y) < DEADZONE) return null;
    if (Math.abs(x) > Math.abs(y)) return x > 0 ? 15 : 14;
    return y > 0 ? 13 : 12;
  }

  function down(pad) {
    const out = new Set();
    (pad.buttons || []).forEach((b, i) => {
      const on = typeof b === 'object' ? b.pressed : b > 0.5;
      if (on) out.add(i);
    });
    const stick = stickCode(pad);
    if (stick !== null) out.add(stick);
    return out;
  }

  // One step of the loop. Separate from the loop itself so the tests can drive
  // it a frame at a time instead of racing an animation frame.
  function poll(now) {
    const pressed = new Set();
    for (const pad of source()) {
      if (!pad) continue;
      for (const code of down(pad)) pressed.add(code);
    }

    for (const code of held.keys()) {
      if (!pressed.has(code)) held.delete(code);
    }

    for (const code of pressed) {
      const seen = held.get(code);
      if (seen === undefined) {
        // A pad that is already being held when the page loads should not fire.
        held.set(code, now + REPEAT_FIRST);
        wake();
        press(code);
      } else if (DPAD[code] && now >= seen) {
        held.set(code, now + REPEAT_AGAIN);
        press(code);
      }
    }

    drawHints();
  }

  // ---------------------------------------------------------------
  // Saying which button does what
  //
  // Deck Verified asks a game to tell the player what the pad does, and a
  // player who is not told presses B to find out. The bar lists only what
  // would actually do something from where they are standing, so it is never
  // offering a button that does nothing.
  //
  // The glyphs are drawn in the game's own ink rather than in Xbox's green A
  // and red B. This is a game about a market, where green and red already mean
  // a gain and a loss, and a green A sitting above a Buy button reads as an
  // instruction rather than as a label.
  // ---------------------------------------------------------------
  let bar = null;
  let barHtml = '';

  const glyph = (kind, label) => `<b class="pad-glyph pad-glyph-${kind}">${label}</b>`;

  function hints() {
    const inModal = modalOpen();
    const el = document.activeElement;
    const on = el && el !== document.body && reachable(el);
    // A number field is the one thing A leaves alone, so it is not offered.
    const typing = on && el.tagName === 'INPUT' && el.type === 'number';
    const out = [];

    if (on && !typing) out.push([glyph('face', 'A'), inModal ? 'Press' : 'Select']);

    if (inModal) {
      out.push([glyph('face', 'B'), 'Close']);
    } else {
      if (!document.querySelector('.task-switch [data-screen="home"][aria-current]')) {
        out.push([glyph('face', 'B'), 'Front page']);
      }
      out.push([glyph('bumper', 'LB') + glyph('bumper', 'RB'), 'Screens']);
      const clock = document.getElementById('clockText');
      out.push([glyph('menu', '☰'), clock && clock.classList.contains('paused') ? 'Play' : 'Pause']);
    }
    return out;
  }

  // Rebuilt on every frame but written only when it changes, which is rarely.
  function drawHints() {
    if (!usingPad) return;
    const html = hints().map(([g, label]) => `<span class="pad-hint">${g}<span>${label}</span></span>`).join('');
    if (html === barHtml) return;
    barHtml = html;
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'pad-hints';
      bar.id = 'padHints';
      // A screen reader already reads each button; this is the same thing
      // again, in a form that only means anything to someone holding a pad.
      bar.setAttribute('aria-hidden', 'true');
      document.body.appendChild(bar);
    }
    bar.innerHTML = html;
  }

  // Focus is invisible until there is a reason to show it. Once a pad is used
  // the ring stays on, because it is the only thing telling the player where
  // they are; a mouse move puts it away again.
  function wake() {
    if (usingPad) return;
    usingPad = true;
    document.body.classList.add('using-pad');
    if (!stops().includes(document.activeElement)) {
      const first = stops()[0];
      if (first) focus(first);
    }
    drawHints();
  }

  function sleep() {
    if (!usingPad) return;
    usingPad = false;
    document.body.classList.remove('using-pad');
  }

  let running = false;
  function loop() {
    poll(performance.now());
    if (running) requestAnimationFrame(loop);
  }

  function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(loop);
  }

  // Polling only once a pad has said hello keeps an idle game off the main
  // thread entirely. Chromium will not report a pad before it is touched, so a
  // player who plugs one in mid-game is picked up by the event.
  window.addEventListener('gamepadconnected', start);
  window.addEventListener('mousemove', sleep, { passive: true });
  window.addEventListener('pointerdown', sleep, { passive: true });
  if (source().some(Boolean)) start();

  // For the tests, and for anyone who wants to know what it decided.
  window.simstockPad = {
    poll,
    hints,
    pick,
    stops,
    press,
    start,
    get active() { return usingPad; },
    set source(fn) { source = fn; start(); },
  };
})();
