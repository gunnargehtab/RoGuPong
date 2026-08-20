// RoGuPong — the rules of the game.
//
// The court is a portrait rectangle in normalised coordinates: x and y both
// run 0..1, player 0 defends the bottom edge and player 1 the top. Each phone
// draws its own player at the bottom, so player 1's renderer simply flips y.
//
// The host simulates everything and broadcasts snapshots; the guest sends its
// paddle position and renders what it is told, predicting only its own paddle
// so the stick feels attached to the thumb. On a shared WiFi that is a handful
// of milliseconds of lag, which is well inside "nobody notices".

import { byId as charById } from './characters.js';
import { rollItem, itemById } from './items.js';

export const BALL_R = 0.019;
export const PADDLE_W = 0.20;
export const PADDLE_H = 0.020;
export const PADDLE_Y = [0.905, 0.095];
export const SHIELD_Y = [0.955, 0.045];
export const CRATE_R = 0.043;

const BASE_SPEED = 0.62;      // court heights per second
const MAX_SPEED = 1.75;
const SPEEDUP = 1.035;        // per paddle hit
const MAX_BALLS = 5;
const PADDLE_SPEED = 2.35;    // court widths per second
const SERVE_DELAY = 1.15;
const COUNTDOWN = 3.0;
const CRATE_EVERY = [6.0, 9.5];
const MAX_CRATES = 2;
const METER_PER_HIT = 0.17;
const METER_PER_SEC = 0.022;

function mulberry(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

let ballSeq = 0;

function makeBall(x, y, angle, speed, owner) {
  return {
    id: ++ballSeq,
    x, y,
    vx: Math.sin(angle) * speed,
    vy: Math.cos(angle) * speed,
    speed,
    spin: 0,
    fire: 0,
    owner,          // last player to touch it — decides who gets an item crate
  };
}

export class Match {
  constructor(opts = {}) {
    this.chars = (opts.chars || ['ro', 'gu']).map(charById);
    this.stageId = opts.stage || 'navigli';
    this.target = opts.target || 7;
    this.rand = mulberry(opts.seed || 12345);
    this.names = opts.names || ['P1', 'P2'];

    this.tick = 0;
    this.time = 0;
    this.phase = 'countdown';     // countdown | play | point | over
    this.phaseTime = COUNTDOWN;
    this.scores = [0, 0];
    this.meter = [0, 0];
    this.rally = 0;
    this.bestRally = 0;
    this.winner = -1;
    this.serveTo = this.rand() < 0.5 ? 0 : 1;

    this.paddles = [0, 1].map((i) => ({
      x: 0.5,
      target: 0.5,
      vx: 0,
      grow: 0,
      frost: 0,
      shield: 0,
      pending: null,      // 'afterburn' | 'curve' armed for the next hit
      lastItem: null,
    }));

    this.balls = [];
    this.crates = [];
    this.nextCrate = CRATE_EVERY[0] + this.rand() * (CRATE_EVERY[1] - CRATE_EVERY[0]);
    this.input = [{ x: 0.5, special: false }, { x: 0.5, special: false }];
    this.events = [];
    this.shake = 0;
    this.hitstop = 0;
  }

  /* ---------------------------------------------------------------- */
  /* Derived values                                                    */

  paddleWidth(i) {
    const base = PADDLE_W * this.chars[i].paddle;
    // Past twenty returns the paddles start closing in on each other. Long
    // rallies are the best part of pong right up until they never end.
    const pressure = 1 - Math.min(0.34, Math.max(0, this.rally - 20) * 0.0045);
    return base * pressure * (this.paddles[i].grow > 0 ? 1.6 : 1);
  }

  paddleSpeed(i) {
    const p = this.paddles[i];
    return PADDLE_SPEED * this.chars[i].speed * (p.frost > 0 ? 0.5 : 1);
  }

  event(e) {
    this.events.push(e);
    if (this.events.length > 24) this.events.shift();
  }

  /* ---------------------------------------------------------------- */
  /* Input                                                             */

  setInput(i, input) {
    this.input[i].x = clamp(input.x, 0, 1);
    if (input.special) this.input[i].special = true;
  }

  /* ---------------------------------------------------------------- */
  /* Simulation (host only)                                            */

  step(dt) {
    dt = Math.min(dt, 1 / 30);
    this.tick++;
    this.time += dt;

    if (this.hitstop > 0) {
      this.hitstop = Math.max(0, this.hitstop - dt);
      dt *= 0.12;                      // freeze-frame on a big hit
    }
    this.shake = Math.max(0, this.shake - dt * 2.6);

    for (let i = 0; i < 2; i++) {
      const p = this.paddles[i];
      p.grow = Math.max(0, p.grow - dt);
      p.frost = Math.max(0, p.frost - dt);
      if (p.pending && p.pending.until <= this.time) p.pending = null;
      this.meter[i] = clamp(this.meter[i] + METER_PER_SEC * this.chars[i].meterRate * dt, 0, 1);
      if (this.input[i].special) {
        this.input[i].special = false;
        this.fireSpecial(i);
      }
      this.movePaddle(i, dt);
    }

    switch (this.phase) {
      case 'countdown':
        this.phaseTime -= dt;
        if (this.phaseTime <= 0) this.serve();
        break;
      case 'point':
        this.phaseTime -= dt;
        if (this.phaseTime <= 0) {
          if (this.scores[0] >= this.target || this.scores[1] >= this.target) this.finish();
          else this.serve();
        }
        break;
      case 'play':
        this.stepCrates(dt);
        this.stepBalls(dt);
        break;
      default:
        break;
    }
  }

  movePaddle(i, dt) {
    const p = this.paddles[i];
    const half = this.paddleWidth(i) / 2;
    p.target = clamp(this.input[i].x, half, 1 - half);
    const max = this.paddleSpeed(i) * dt;
    const delta = clamp(p.target - p.x, -max, max);
    p.vx = delta / dt;
    p.x += delta;
  }

  serve() {
    this.balls = [];
    const toward = this.serveTo;                 // served at whoever just conceded
    const spread = (this.rand() - 0.5) * 0.55;
    const angle = (toward === 0 ? Math.PI : 0) + spread;
    this.balls.push(makeBall(0.5, 0.5, angle, BASE_SPEED, -1));
    this.phase = 'play';
    this.rally = 0;
    this.event({ t: 'serve', x: 0.5, y: 0.5 });
  }

  finish() {
    this.phase = 'over';
    this.winner = this.scores[0] > this.scores[1] ? 0 : 1;
    this.event({ t: 'match', p: this.winner });
  }

  stepBalls(dt) {
    for (let bi = this.balls.length - 1; bi >= 0; bi--) {
      // Conceding a match point clears the court mid-loop.
      if (this.phase !== 'play') break;
      const b = this.balls[bi];
      if (!b) continue;
      b.fire = Math.max(0, b.fire - dt);

      if (b.spin !== 0) {
        b.vx += b.spin * dt * 0.55;
        b.spin *= Math.pow(0.55, dt);
        if (Math.abs(b.spin) < 0.05) b.spin = 0;
        const mag = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / mag) * b.speed;
        b.vy = (b.vy / mag) * b.speed;
      }

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Side walls
      if (b.x < BALL_R && b.vx < 0) {
        b.x = BALL_R; b.vx = -b.vx; b.spin = -b.spin * 0.5;
        this.event({ t: 'wall', x: b.x, y: b.y });
      } else if (b.x > 1 - BALL_R && b.vx > 0) {
        b.x = 1 - BALL_R; b.vx = -b.vx; b.spin = -b.spin * 0.5;
        this.event({ t: 'wall', x: b.x, y: b.y });
      }

      for (let i = 0; i < 2; i++) {
        this.collidePaddle(b, i);
        this.collideShield(b, i);
      }
      this.collideCrates(b);

      // Goals
      if (b.y > 1 + BALL_R) { this.concede(0, b, bi); continue; }
      if (b.y < -BALL_R) { this.concede(1, b, bi); continue; }
    }
  }

  collidePaddle(b, i) {
    const py = PADDLE_Y[i];
    const towardMe = i === 0 ? b.vy > 0 : b.vy < 0;
    if (!towardMe) return;
    const surface = i === 0 ? py - PADDLE_H / 2 - BALL_R : py + PADDLE_H / 2 + BALL_R;
    const crossed = i === 0 ? b.y >= surface : b.y <= surface;
    if (!crossed) return;
    // Only within a paddle's thickness — a ball already past it is a goal.
    if (Math.abs(b.y - surface) > 0.09) return;

    const p = this.paddles[i];
    const half = this.paddleWidth(i) / 2;
    const offset = (b.x - p.x) / half;
    if (Math.abs(offset) > 1.12) return;         // edge whiff

    b.y = surface;
    this.rally++;
    this.bestRally = Math.max(this.bestRally, this.rally);
    b.owner = i;

    // Classic pong control: where you hit the paddle sets the angle.
    let angle = clamp(offset, -1, 1) * 1.05;     // up to ~60 degrees
    angle += clamp(p.vx * 0.09, -0.35, 0.35);    // and a little from paddle motion
    angle = clamp(angle, -1.25, 1.25);

    // Rally heat: the longer a point runs, the harder the ball comes back, so
    // even two immovable defences eventually produce a winner.
    const heat = Math.min(0.35, this.rally * 0.006);
    const speedup = SPEEDUP + Math.min(0.05, this.rally * 0.0015);
    b.speed = Math.min(MAX_SPEED * (1 + heat), b.speed * speedup);

    let big = false;
    const pending = p.pending;
    if (pending && pending.id === 'afterburn') {
      b.speed = Math.min(MAX_SPEED * 1.15, b.speed * 1.9);
      b.fire = 2.5;
      p.pending = null;
      big = true;
      this.shake = Math.max(this.shake, 1);
      this.hitstop = 0.09;
      this.event({ t: 'burn', x: b.x, y: b.y, p: i });
    } else if (pending && pending.id === 'curve') {
      b.spin = (offset >= 0 ? 1 : -1) * 3.4;
      p.pending = null;
      big = true;
      this.event({ t: 'curve', x: b.x, y: b.y, p: i });
    }

    const dir = i === 0 ? -1 : 1;                // away from this player's goal
    b.vx = Math.sin(angle) * b.speed;
    b.vy = Math.cos(angle) * b.speed * dir;

    this.meter[i] = clamp(this.meter[i] + METER_PER_HIT * this.chars[i].meterRate, 0, 1);
    this.shake = Math.max(this.shake, big ? 1 : 0.32);
    this.event({ t: 'hit', x: b.x, y: b.y, p: i, big, r: this.rally });
  }

  collideShield(b, i) {
    const p = this.paddles[i];
    if (p.shield <= 0) return;
    const sy = SHIELD_Y[i];
    const towardMe = i === 0 ? b.vy > 0 : b.vy < 0;
    if (!towardMe) return;
    const crossed = i === 0 ? b.y >= sy - BALL_R : b.y <= sy + BALL_R;
    if (!crossed) return;

    p.shield = 0;
    b.y = i === 0 ? sy - BALL_R : sy + BALL_R;
    b.vy = -b.vy;
    b.owner = i;
    b.speed = Math.min(MAX_SPEED, b.speed * 1.05);
    this.shake = Math.max(this.shake, 0.7);
    this.event({ t: 'shield', x: b.x, y: b.y, p: i });
  }

  collideCrates(b) {
    for (let ci = this.crates.length - 1; ci >= 0; ci--) {
      const c = this.crates[ci];
      if (Math.hypot(c.x - b.x, c.y - b.y) > CRATE_R + BALL_R) continue;
      this.crates.splice(ci, 1);
      const owner = b.owner >= 0 ? b.owner : (b.vy > 0 ? 1 : 0);
      this.applyItem(c.item, owner, b);
      this.event({ t: 'item', x: c.x, y: c.y, id: c.item.id, p: owner });
      this.shake = Math.max(this.shake, 0.55);
    }
  }

  applyItem(item, owner, ball) {
    const foe = 1 - owner;
    this.paddles[owner].lastItem = { id: item.id, at: this.time };
    switch (item.id) {
      case 'grow':
        this.paddles[owner].grow = item.duration;
        break;
      case 'frost':
        this.paddles[foe].frost = item.duration;
        break;
      case 'turbo':
        ball.speed = Math.min(MAX_SPEED * 1.1, ball.speed * 1.45);
        ball.fire = 3;
        this.renormalise(ball);
        break;
      case 'multi': {
        for (const sign of [-1, 1]) {
          if (this.balls.length >= MAX_BALLS) break;
          const angle = Math.atan2(ball.vx, ball.vy) + sign * 0.42;
          const extra = makeBall(ball.x, ball.y, angle, ball.speed * 0.94, owner);
          extra.vy = Math.cos(angle) * extra.speed * Math.sign(ball.vy || 1);
          extra.vx = Math.sin(angle) * extra.speed;
          this.balls.push(extra);
        }
        break;
      }
      default:
        break;
    }
  }

  renormalise(b) {
    const mag = Math.hypot(b.vx, b.vy) || 1;
    b.vx = (b.vx / mag) * b.speed;
    b.vy = (b.vy / mag) * b.speed;
  }

  fireSpecial(i) {
    if (this.phase !== 'play' || this.meter[i] < 1) return;
    const spec = this.chars[i].special;
    this.meter[i] = 0;
    const p = this.paddles[i];

    switch (spec.id) {
      case 'afterburn':
      case 'curve':
        p.pending = { id: spec.id, until: this.time + spec.duration };
        break;
      case 'aegis':
        p.shield = spec.duration;
        break;
      case 'quake': {
        const away = i === 0 ? -1 : 1;
        for (const b of this.balls) {
          b.speed = Math.min(MAX_SPEED, b.speed * 1.15);
          b.vy = Math.abs(b.vy) * away;
          b.spin = 0;
          this.renormalise(b);
          b.owner = i;
        }
        this.paddles[1 - i].frost = spec.duration;
        this.shake = 1.4;
        this.hitstop = 0.1;
        break;
      }
      default:
        break;
    }
    this.event({ t: 'special', p: i, id: spec.id });
  }

  stepCrates(dt) {
    for (const c of this.crates) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.spin += dt * 1.4;
      if (c.x < CRATE_R || c.x > 1 - CRATE_R) c.vx = -c.vx;
      if (c.y < 0.30 || c.y > 0.70) c.vy = -c.vy;
    }
    this.nextCrate -= dt;
    if (this.nextCrate <= 0 && this.crates.length < MAX_CRATES && this.rally >= 2) {
      this.nextCrate = CRATE_EVERY[0] + this.rand() * (CRATE_EVERY[1] - CRATE_EVERY[0]);
      const item = rollItem(this.rand);
      this.crates.push({
        x: 0.18 + this.rand() * 0.64,
        y: 0.38 + this.rand() * 0.24,
        vx: (this.rand() - 0.5) * 0.09,
        vy: (this.rand() - 0.5) * 0.05,
        spin: this.rand() * 6,
        item,
      });
      this.event({ t: 'crate', x: 0.5, y: 0.5, id: item.id });
    }
  }

  concede(loser, ball, index) {
    this.balls.splice(index, 1);
    const scorer = 1 - loser;
    if (this.balls.length > 0) {
      // Multiball: the rally carries on, the point still counts.
      this.scores[scorer]++;
      this.event({ t: 'goal', x: ball.x, y: loser === 0 ? 1 : 0, p: scorer, quiet: true });
      if (this.scores[scorer] >= this.target) { this.balls = []; this.pointBreak(scorer); }
      return;
    }
    this.scores[scorer]++;
    this.pointBreak(scorer);
  }

  pointBreak(scorer) {
    const loser = 1 - scorer;
    this.serveTo = loser;
    this.phase = 'point';
    this.phaseTime = SERVE_DELAY;
    this.crates = [];
    this.shake = 1.2;
    for (const p of this.paddles) { p.shield = 0; p.pending = null; }
    this.event({ t: 'goal', x: 0.5, y: loser === 0 ? 1 : 0, p: scorer, rally: this.rally });
  }

  get matchPoint() {
    return this.scores.map((s) => s >= this.target - 1);
  }

  /* ---------------------------------------------------------------- */
  /* Networking                                                        */

  snapshot() {
    const snap = {
      k: 's',
      n: this.tick,
      ph: this.phase,
      pt: +this.phaseTime.toFixed(2),
      sc: this.scores,
      me: this.meter.map((m) => +m.toFixed(3)),
      rl: this.rally,
      wn: this.winner,
      pd: this.paddles.map((p, i) => [
        +p.x.toFixed(4), +this.paddleWidth(i).toFixed(4),
        p.shield > 0 ? 1 : 0, p.frost > 0 ? 1 : 0, p.pending ? 1 : 0,
      ]),
      bl: this.balls.map((b) => [
        +b.x.toFixed(4), +b.y.toFixed(4), +b.vx.toFixed(3), +b.vy.toFixed(3),
        b.fire > 0 ? 1 : 0, b.id,
      ]),
      cr: this.crates.map((c) => [+c.x.toFixed(3), +c.y.toFixed(3), +c.spin.toFixed(2), c.item.id]),
      ev: this.events,
      sh: +this.shake.toFixed(2),
    };
    this.events = [];
    return snap;
  }

  applySnapshot(s) {
    if (s.n <= this.tick) return;      // an unreliable channel reorders packets
    this.tick = s.n;
    this.phase = s.ph;
    this.phaseTime = s.pt;
    this.scores = s.sc;
    this.meter = s.me;
    this.rally = s.rl;
    this.bestRally = Math.max(this.bestRally, s.rl);
    this.winner = s.wn;
    this.shake = Math.max(this.shake, s.sh);

    s.pd.forEach((p, i) => {
      const pad = this.paddles[i];
      pad.x = p[0];
      pad.netWidth = p[1];
      pad.shield = p[2] ? 1 : 0;
      pad.frost = p[3] ? 1 : 0;
      pad.pending = p[4] ? { id: this.chars[i].special.id, until: Infinity } : null;
    });

    // Snapshots arrive at 30 Hz but we draw more often than that, so hard-
    // assigning positions makes the ball visibly pop. Keep the ball we are
    // already drawing and record where the host says it should be; extrapolate()
    // eases the difference away between packets.
    const previous = new Map(this.balls.map((b) => [b.id, b]));
    this.balls = s.bl.map((b) => {
      const was = previous.get(b[5]);
      const fresh = {
        id: b[5], x: b[0], y: b[1], vx: b[2], vy: b[3],
        speed: Math.hypot(b[2], b[3]), fire: b[4] ? 1 : 0, spin: 0, owner: -1,
      };
      if (!was) return fresh;
      const gap = Math.hypot(was.x - fresh.x, was.y - fresh.y);
      // A big jump means a bounce or a fresh serve, not drift — take it as-is.
      if (gap > 0.12) return fresh;
      return { ...fresh, x: was.x, y: was.y, tx: fresh.x, ty: fresh.y };
    });

    this.crates = s.cr.map((c) => ({
      x: c[0], y: c[1], spin: c[2], vx: 0, vy: 0, item: itemById(c[3]),
    }));

    for (const e of s.ev) this.events.push(e);
  }

  /** Guest-side smoothing between the 30 Hz snapshots. */
  extrapolate(dt) {
    if (this.phase !== 'play') return;
    for (const b of this.balls) {
      b.x = clamp(b.x + b.vx * dt, BALL_R, 1 - BALL_R);
      b.y += b.vy * dt;
      // Ease toward wherever the host last said this ball was, so the
      // correction is a drift rather than a jump.
      if (b.tx != null) {
        b.tx += b.vx * dt;
        b.ty += b.vy * dt;
        const k = Math.min(1, dt * 9);
        b.x += (b.tx - b.x) * k;
        b.y += (b.ty - b.y) * k;
      }
    }
    for (const c of this.crates) c.spin += dt * 1.4;
    this.shake = Math.max(0, this.shake - dt * 2.6);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
