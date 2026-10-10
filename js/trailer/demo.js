// RoGuPong trailer — the gameplay shot is the real game.
//
// A real Match runs between two bots, drawn by the game's own Renderer onto two
// phone screens: RO's phone sees RO at the bottom, GU's phone sees GU at the
// bottom, exactly as the two handsets would. The simulation steps at the
// game's fixed 1/60 s and its randomness is seeded, so the shot is the same
// rally on every pass and a scrub lands on the same frame.
//
// Click a phone and the shot turns into free play: you take that phone's
// player against the bot, first to seven, for as long as you like.

import { Match } from '../game/match.js';
import { Renderer } from '../game/render.js';
import { Fx, reactTo } from '../game/fx.js';
import { stageById } from '../game/stages.js';
import { Bot } from './ai.js';

const FIXED = 1 / 60;

// The rally the shot shows, picked with a headless run of this same code:
// inside its 3.2 seconds RO fires AFTERBURN, breaks a MULTIBALL crate, GU
// raises AEGIS and RO still scores.
const SHOT = {
  chars: ['ro', 'gu'], stage: 'navigli', party: true, seed: 5,
  scores: [5, 4], meters: [0.97, 0.9], nextCrate: 0.3, preroll: 1.8,
};

/** A canvas the Renderer can size itself from, without being in the page. */
function screenCanvas() {
  const canvas = document.createElement('canvas');
  const size = { w: 300, h: 640 };
  Object.defineProperty(canvas, 'clientWidth', { get: () => size.w });
  Object.defineProperty(canvas, 'clientHeight', { get: () => size.h });
  return { canvas, size };
}

class Screen {
  constructor(view) {
    const { canvas, size } = screenCanvas();
    this.canvas = canvas;
    this.size = size;
    this.view = view;
    this.renderer = new Renderer(canvas);
    this.noNotch();
    this.fx = new Fx();
  }

  resize(w, h) {
    if (w === this.size.w && h === this.size.h) return;
    this.size.w = w;
    this.size.h = h;
    this.renderer.resize();
    this.noNotch();
  }

  // The renderer reads the page's safe-area insets; a phone in a picture has no notch.
  noNotch() {
    this.renderer.safe = { top: 0, right: 0, bottom: 0, left: 0 };
    this.renderer.layout();
  }

  /** Screen x (CSS pixels, in this screen) to court x, 0..1. */
  courtX(x) {
    const c = this.renderer.court;
    return Math.max(0, Math.min(1, (x - c.x) / c.w));
  }
}

export class Demo {
  constructor(sfx) {
    this.sfx = sfx;
    this.stage = stageById(SHOT.stage);
    this.screens = [new Screen(0), new Screen(1)];
    this.human = -1;          // the player free play hands the viewer, or -1
    this.input = { x: 0.5, fire: false };
    this.reset(0);
  }

  newMatch(opts) {
    return new Match({
      chars: SHOT.chars, stage: SHOT.stage, party: SHOT.party, target: 7,
      items: this.stage.items, ...opts,
    });
  }

  clearFx() {
    for (const s of this.screens) {
      s.fx.clear();
      s.renderer.trails.clear();
    }
  }

  /** The shot as it stands `t` seconds in, run silently from its first step. */
  reset(t) {
    const m = this.newMatch({ seed: SHOT.seed });
    m.scores = [...SHOT.scores];
    m.meter = [...SHOT.meters];
    m.serve();
    m.nextCrate = SHOT.nextCrate;
    this.m = m;
    this.bots = [new Bot(0, SHOT.seed * 7 + 1), new Bot(1, SHOT.seed * 13 + 5)];
    this.simT = -SHOT.preroll;
    this.clearFx();
    this.advance(t, false);
  }

  /** Follow the trailer's playhead: step live when it plays on, re-run on a jump. */
  sync(t, live) {
    if (t < this.simT - 0.02 || t - this.simT > 0.3) this.reset(t);
    else this.advance(t, live);
  }

  advance(t, live) {
    while (this.simT + FIXED <= t + 1e-9) {
      this.stepOnce(live);
      this.simT += FIXED;
    }
  }

  stepOnce(live) {
    const m = this.m;
    for (const bot of this.bots) {
      if (bot.i === this.human) {
        m.setInput(bot.i, { x: this.input.x, special: this.input.fire });
        this.input.fire = false;
      } else {
        m.setInput(bot.i, bot.think(m));
      }
    }
    m.step(FIXED);
    for (const ev of m.drainEvents()) {
      if (!live) continue;
      // Both phones see every event; only one of them makes the noise.
      reactTo(ev, this.screens[0].fx, m.chars, this.sfx, { accent: this.stage.accent, view: 0 });
      reactTo(ev, this.screens[1].fx, m.chars, null, { accent: this.stage.accent, view: 1 });
    }
  }

  /* ---------------------------------------------------------------- */
  /* Free play                                                         */

  startFree(i) {
    this.human = i;
    this.input.x = this.m.paddles[i].x;
    this.input.fire = false;
    this.freeMatch();
  }

  freeMatch() {
    this.m = this.newMatch({ seed: (Math.random() * 1e9) >>> 0 });
    const other = 1 - this.human;
    this.bots = [new Bot(0, 11, { miss: 0.2 }), new Bot(1, 29, { miss: 0.2 })];
    this.bots[other].specialFrom = 4;
    this.overFor = 0;
    this.acc = 0;
    this.clearFx();
  }

  /** Free play runs on the wall clock, the trailer's playhead held where it was. */
  stepFree(dt) {
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= FIXED) {
      this.stepOnce(true);
      this.acc -= FIXED;
    }
    if (this.m.phase === 'over') {
      this.overFor += dt;
      if (this.overFor > 3.2) this.freeMatch();
    }
  }

  endFree(t) {
    this.human = -1;
    this.reset(t);
  }

  names() {
    if (this.human < 0) return ['YOU', 'FRIEND'];
    return [0, 1].map((i) => (i === this.human ? 'YOU' : 'CPU'));
  }

  /** Paint phone `i`'s screen into its own canvas. */
  draw(i, time, dt, moving) {
    const s = this.screens[i];
    const m = this.m;
    if (moving) s.fx.update(dt);
    // A frozen frame keeps still: the renderer shakes on the match's shake,
    // which only the simulation winds down.
    const shake = m.shake;
    if (!moving) m.shake = 0;
    s.renderer.draw(m, {
      view: i, stage: this.stage, fx: s.fx, time, names: this.names(), chars: m.chars,
      showTouchHint: this.human === i && m.phase === 'countdown',
      showTapHint: this.human === i && m.phase === 'play' && m.meter[i] >= 1,
    });
    m.shake = shake;
    return s.canvas;
  }
}
