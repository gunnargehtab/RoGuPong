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
// The court is drawn 0.56 as wide as it is tall. The rules mostly live in the
// stretched 0..1 square, but anything round — the SPIRE — collides in true
// proportions, so it is round on screen and the ball leaves it at the angle
// the eye expects.
export const COURT_ASPECT = 0.56;
export const SPIRE_R = 0.06;             // court widths
export const SPIRE_Y = [0.70, 0.30];     // by the victim: the middle of their half
export const DRIFT_Y = [0.978, 0.022];   // on each goal line, behind the shield
export const DRIFT_HALF = 0.18;

const BASE_SPEED = 0.62;      // court heights per second
const MAX_SPEED = 1.75;
const SPEEDUP = 1.035;        // per paddle hit
const MAX_BALLS = 5;
const PADDLE_SPEED = 2.35;    // court widths per second
const SERVE_DELAY = 1.15;
const COUNTDOWN = 3.0;
const CRATE_EVERY = [6.0, 9.5];
const MAX_CRATES = 2;
// Party mode: same game, chaos dial turned up. Crates rain, and up to three
// share the court.
const CRATE_EVERY_PARTY = [2.4, 4.0];
const MAX_CRATES_PARTY = 3;
const METER_PER_HIT = 0.17;
const METER_PER_SEC = 0.022;
const MAGNET_HOLD = 1.0;      // seconds a caught ball sits on the paddle
const PHANTOM_GHOST = 3.0;    // seconds of ghost on a PHANTOM return
const ARCO_K = 2.2;           // inward spin on an ARCO return, at serve pace
const ARCO_POW = 1.75;        // ... scaled by pace^this, so the arch keeps its shape
const ARCO_MIN = 0.15;        // radians off straight before a return bends at all
const SPIRE_MIN_VY = 0.35;    // share of the speed a spire bounce leaves vertical
const DRIFT_HITS = 2;         // blocks before a snowdrift is spent
const DRIFT_DAMP = 0.88;      // speed kept by a ball the snow sends back

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

/** A beach ball is a much bigger target; everything that collides asks here. */
export const ballRadius = (b) => BALL_R * (b.beach > 0 ? 2.3 : 1);

/**
 * Where a ball will cross the line at height y, bouncing off the side walls on
 * the way — or null if it isn't heading there. Straight-line only: spin is
 * ignored, which is close enough for keeping things out of its way.
 */
function crossingX(b, y) {
  if (b.held >= 0 || !b.vy || (y - b.y) / b.vy <= 0) return null;
  const rad = ballRadius(b);
  const span = 1 - rad * 2;
  const u = ((b.x + b.vx * ((y - b.y) / b.vy) - rad) % (span * 2) + span * 2) % (span * 2);
  return rad + (u <= span ? u : span * 2 - u);
}

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
    ghost: 0,       // seconds of near-invisibility left
    beach: 0,       // seconds of huge-and-floaty left
    mirror: 0,      // seconds of REFLECTION decoy left
    arc: false,     // the spin it carries is an ARCO bend (host only)
    held: -1,       // player index holding it on a magnetic paddle, or -1
    holdT: 0,
    hx: 0,          // offset from the holding paddle's centre
    catchX: 0,      // where the paddle was at the catch — the aim reference
    owner,          // last player to touch it — decides who gets an item crate
  };
}

export class Match {
  constructor(opts = {}) {
    this.chars = (opts.chars || ['ro', 'gu']).map(charById);
    this.stageId = opts.stage || 'navigli';
    this.target = opts.target || 7;
    this.party = !!opts.party;
    this.rand = mulberry(opts.seed || 12345);
    this.names = opts.names || ['P1', 'P2'];
    // The stage's crate pool, as item ids; null deals every item.
    this.items = Array.isArray(opts.items) && opts.items.length ? [...opts.items] : null;

    this.tick = 0;
    this.time = 0;
    this.phase = 'countdown';     // countdown | play | point | over
    this.phaseTime = COUNTDOWN;
    this.scores = [0, 0];
    this.meter = [0, 0];
    this.streak = [0, 0];         // consecutive points, for the on-fire fanfare
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
      shrink: 0,
      shield: 0,
      magnet: 0,          // seconds the paddle stays magnetic, waiting for a ball
      arco: 0,            // seconds of ARCO left: returns bend back in
      pending: null,      // 'afterburn' | 'curve' armed for the next hit
      lastItem: null,
    }));

    this.balls = [];
    this.crates = [];
    // Stage props raised by items: SPIRE pinnacles and AVALANCHE snowdrifts,
    // { kind: 'spire' | 'drift', x, y, size, t: seconds left, age, p: owner, hits }.
    this.props = [];
    this.nextCrate = this.rollCrateDelay();
    this.input = [{ x: 0.5, special: false }, { x: 0.5, special: false }];
    this.events = [];
    this.outbox = [];
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
    const p = this.paddles[i];
    return base * pressure * (p.grow > 0 ? 1.6 : 1) * (p.shrink > 0 ? 0.55 : 1);
  }

  paddleSpeed(i) {
    const p = this.paddles[i];
    return PADDLE_SPEED * this.chars[i].speed * (p.frost > 0 ? 0.5 : 1);
  }

  // Local fx (drainEvents) and the network (snapshot) each get their own copy;
  // a single shared queue had them stealing events from each other, so every
  // hit spark and goal boom played on only one of the two phones.
  event(e) {
    this.events.push(e);
    this.outbox.push(e);
    if (this.events.length > 24) this.events.shift();
    if (this.outbox.length > 24) this.outbox.shift();
  }

  rollCrateDelay() {
    const [lo, hi] = this.party ? CRATE_EVERY_PARTY : CRATE_EVERY;
    return lo + this.rand() * (hi - lo);
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
      p.shrink = Math.max(0, p.shrink - dt);
      p.magnet = Math.max(0, p.magnet - dt);
      p.arco = Math.max(0, p.arco - dt);
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
        this.stepProps(dt);
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
      b.ghost = Math.max(0, b.ghost - dt);
      b.beach = Math.max(0, b.beach - dt);
      b.mirror = Math.max(0, b.mirror - dt);
      const rad = ballRadius(b);

      // A caught ball rides the magnetic paddle until the hold runs out —
      // no physics, no collisions, just aiming.
      if (b.held >= 0) {
        const p = this.paddles[b.held];
        b.x = clamp(p.x + b.hx, rad, 1 - rad);
        b.y = b.held === 0
          ? PADDLE_Y[0] - PADDLE_H / 2 - rad
          : PADDLE_Y[1] + PADDLE_H / 2 + rad;
        b.holdT -= dt;
        if (b.holdT <= 0) this.flingBall(b);
        continue;
      }

      if (b.spin !== 0) {
        b.vx += b.spin * dt * 0.55;
        b.spin *= Math.pow(0.55, dt);
        if (Math.abs(b.spin) < 0.05) b.spin = 0;
        const mag = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / mag) * b.speed;
        b.vy = (b.vy / mag) * b.speed;
      }

      const x0 = b.x, y0 = b.y;           // props test the whole step's path
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Side walls
      if (b.x < rad && b.vx < 0) {
        b.x = rad; b.vx = -b.vx; b.spin = -b.spin * 0.5; this.endArc(b);
        this.event({ t: 'wall', x: b.x, y: b.y });
      } else if (b.x > 1 - rad && b.vx > 0) {
        b.x = 1 - rad; b.vx = -b.vx; b.spin = -b.spin * 0.5; this.endArc(b);
        this.event({ t: 'wall', x: b.x, y: b.y });
      }

      for (let i = 0; i < 2; i++) {
        this.collidePaddle(b, i);
        this.collideShield(b, i);
      }
      if (this.props.length) this.collideProps(b, x0, y0, true);
      this.collideCrates(b);

      // Goals
      if (b.y > 1 + rad) { this.concede(0, b, bi); continue; }
      if (b.y < -rad) { this.concede(1, b, bi); continue; }
    }
  }

  collidePaddle(b, i) {
    const py = PADDLE_Y[i];
    const towardMe = i === 0 ? b.vy > 0 : b.vy < 0;
    if (!towardMe) return;
    const rad = ballRadius(b);
    const surface = i === 0 ? py - PADDLE_H / 2 - rad : py + PADDLE_H / 2 + rad;
    const crossed = i === 0 ? b.y >= surface : b.y <= surface;
    if (!crossed) return;
    // Only within a paddle's thickness — a ball already past it is a goal.
    if (Math.abs(b.y - surface) > 0.09) return;

    const p = this.paddles[i];
    const half = this.paddleWidth(i) / 2;
    const offset = (b.x - p.x) / half;
    if (Math.abs(offset) > 1.12) return;         // edge whiff

    // A magnetic paddle catches instead of bouncing. The catch counts as the
    // return; the fling a second later is the aimed part.
    if (p.magnet > 0) {
      p.magnet = 0;
      b.held = i;
      b.holdT = MAGNET_HOLD;
      b.hx = clamp(b.x - p.x, -half, half);
      b.catchX = p.x;
      b.y = surface;
      b.vx = 0;
      b.vy = 0;
      b.spin = 0;
      b.arc = false;
      b.owner = i;
      this.rally++;
      this.bestRally = Math.max(this.bestRally, this.rally);
      this.hitstop = 0.06;
      this.shake = Math.max(this.shake, 0.5);
      this.event({ t: 'catch', x: b.x, y: b.y, p: i });
      return;
    }

    b.y = surface;
    this.rally++;
    this.bestRally = Math.max(this.bestRally, this.rally);
    b.owner = i;
    this.endArc(b);

    // Classic pong control: where you hit the paddle sets the angle.
    let angle = clamp(offset, -1, 1) * 1.05;     // up to ~60 degrees
    angle += clamp(p.vx * 0.09, -0.35, 0.35);    // and a little from paddle motion
    angle = clamp(angle, -1.25, 1.25);

    // Rally heat: the longer a point runs, the harder the ball comes back, so
    // even two immovable defences eventually produce a winner.
    const heat = Math.min(0.35, this.rally * 0.006);
    const speedup = SPEEDUP + Math.min(0.05, this.rally * 0.0015);
    b.speed = Math.min(MAX_SPEED * (1 + heat), b.speed * speedup);
    // A beach ball stays floaty however long the rally runs; only a special
    // (afterburn below) is allowed to punch through the cap.
    if (b.beach > 0) b.speed = Math.min(b.speed, BASE_SPEED * 1.15);

    let big = false;
    let curved = false;
    const pending = p.pending;
    if (pending && pending.id === 'phantom') {
      b.ghost = PHANTOM_GHOST;
      b.speed = Math.min(MAX_SPEED, b.speed * 1.12);
      p.pending = null;
      big = true;
      this.event({ t: 'phantom', x: b.x, y: b.y, p: i });
    } else if (pending && pending.id === 'afterburn') {
      b.speed = Math.min(MAX_SPEED * 1.15, b.speed * 1.9);
      b.fire = 2.5;
      p.pending = null;
      big = true;
      this.shake = Math.max(this.shake, 1);
      this.hitstop = 0.09;
      this.event({ t: 'burn', x: b.x, y: b.y, p: i });
    } else if (pending && pending.id === 'curve') {
      b.spin = (offset >= 0 ? 1 : -1) * 3.4;
      curved = true;
      p.pending = null;
      big = true;
      this.event({ t: 'curve', x: b.x, y: b.y, p: i });
    }

    const dir = i === 0 ? -1 : 1;                // away from this player's goal
    b.vx = Math.sin(angle) * b.speed;
    b.vy = Math.cos(angle) * b.speed * dir;

    // ARCO: inward spin, so a wide return swings out and arches back in.
    // Scaled by how wide the shot is — a straight one barely bends — and by
    // speed^ARCO_POW, which keeps the arch the same shape at every pace: a
    // fixed spin hooks a serve-pace ball clean across the court and hardly
    // bends one at the speed cap. CURVE, when it fires on the same hit, wins.
    let arc = 0;
    if (p.arco > 0 && !curved && Math.abs(angle) >= ARCO_MIN) {
      b.spin = -Math.sign(b.vx) * ARCO_K * Math.abs(Math.sin(angle))
        * Math.pow(b.speed / BASE_SPEED, ARCO_POW);
      b.arc = true;
      arc = 1;
    }

    this.meter[i] = clamp(this.meter[i] + METER_PER_HIT * this.chars[i].meterRate, 0, 1);
    this.shake = Math.max(this.shake, big ? 1 : 0.32);
    this.event({ t: 'hit', x: b.x, y: b.y, p: i, big, r: this.rally, ...(arc ? { a: 1 } : {}) });
  }

  /**
   * An ARCO bend belongs to the return that earned it. The next touch —
   * paddle, shield, wall, prop — straightens the ball out, so the rival's
   * reply is never bent by spin left over from yours and a bend can't hug a
   * wall.
   */
  endArc(b) {
    if (!b.arc) return;
    b.arc = false;
    b.spin = 0;
  }

  collideShield(b, i) {
    const p = this.paddles[i];
    if (p.shield <= 0) return;
    const sy = SHIELD_Y[i];
    const towardMe = i === 0 ? b.vy > 0 : b.vy < 0;
    if (!towardMe) return;
    const rad = ballRadius(b);
    const crossed = i === 0 ? b.y >= sy - rad : b.y <= sy + rad;
    if (!crossed) return;

    p.shield = 0;
    b.y = i === 0 ? sy - rad : sy + rad;
    b.vy = -b.vy;
    b.owner = i;
    this.endArc(b);
    b.speed = Math.min(MAX_SPEED, b.speed * 1.05);
    this.shake = Math.max(this.shake, 0.7);
    this.event({ t: 'shield', x: b.x, y: b.y, p: i });
  }

  /**
   * Stage props in the ball's way, tested along the whole step's path so a
   * fast ball can't skip through one. `live` is false on the guest, which
   * bounces its extrapolated balls only for the look and leaves the rules —
   * owners, blocks, events — to the host. Returns whether anything bounced.
   */
  collideProps(b, x0, y0, live) {
    let bounced = false;
    for (let pi = this.props.length - 1; pi >= 0; pi--) {
      const q = this.props[pi];
      // A kind this build doesn't know (a newer host) is left alone, not
      // bounced off as if it were a snowdrift.
      const hit = q.kind === 'spire' ? this.bounceSpire(b, q, x0, y0)
        : q.kind === 'drift' ? this.bounceDrift(b, q, x0, y0) : false;
      if (!hit) continue;
      bounced = true;
      this.endArc(b);
      if (!live) continue;
      q.hits++;
      if (q.kind === 'spire') {
        this.shake = Math.max(this.shake, 0.35);
        this.event({ t: 'bump', k: 'spire', x: b.x, y: b.y, p: q.p });
        continue;
      }
      // The snow takes the sting out of it, and the save counts as the
      // drift owner's touch — the next crate that ball breaks is theirs.
      b.owner = q.p;
      b.speed = Math.max(Math.min(b.speed, BASE_SPEED * 0.75), b.speed * DRIFT_DAMP);
      this.renormalise(b);
      this.shake = Math.max(this.shake, 0.5);
      this.event({ t: 'bump', k: 'drift', x: b.x, y: q.y, p: q.p, left: Math.max(0, DRIFT_HITS - q.hits) });
      if (q.hits >= DRIFT_HITS) this.dropProp(q);
    }
    return bounced;
  }

  /** Circle bounce, worked in true proportions (x in court widths, y / COURT_ASPECT). */
  bounceSpire(b, q, x0, y0) {
    const A = COURT_ASPECT;
    const R = q.size + ballRadius(b);
    const cy = q.y / A;
    const ax = x0 - q.x, ay = y0 / A - cy;            // path start, relative
    let px = b.x - q.x, py = b.y / A - cy;            // path end, relative
    let nx, ny;
    if (ax * ax + ay * ay >= R * R) {
      // First touch along the path, if there is one.
      const dx = px - ax, dy = py - ay;
      const a = dx * dx + dy * dy;
      if (a < 1e-12) return false;
      const h = ax * dx + ay * dy;
      const disc = h * h - a * (ax * ax + ay * ay - R * R);
      if (disc < 0) return false;
      const t = (-h - Math.sqrt(disc)) / a;
      if (t < 0 || t > 1) return false;
      px = ax + dx * t;
      py = ay + dy * t;
      nx = px / R;
      ny = py / R;
    } else {
      // It started inside — the spire rose under it. Push it straight out
      // rather than let it rattle about in the marble.
      const d = Math.hypot(px, py);
      if (d >= R) return false;                     // already on its way out
      if (d > 1e-9) { nx = px / d; ny = py / d; } else {
        const m = Math.hypot(b.vx, b.vy / A) || 1;
        nx = -b.vx / m; ny = -(b.vy / A) / m;
        if (!nx && !ny) ny = 1;
      }
    }
    const rad = ballRadius(b);
    b.x = clamp(q.x + nx * (R + 1e-4), rad, 1 - rad);
    b.y = (cy + ny * (R + 1e-4)) * A;
    let vx = b.vx, vy = b.vy / A;
    const vn = vx * nx + vy * ny;
    if (vn < 0) { vx -= 2 * vn * nx; vy -= 2 * vn * ny; }
    b.vx = vx;
    b.vy = vy * A;
    this.renormalise(b);                            // same speed as it arrived
    // A glancing hit could send it off nearly flat, to ping-pong between the
    // spire and a wall; keep it heading somewhere, away from the spire.
    const minVy = SPIRE_MIN_VY * b.speed;
    if (Math.abs(b.vy) < minVy) {
      b.vy = (Math.sign(ny) || Math.sign(b.vy) || 1) * minVy;
      b.vx = (Math.sign(b.vx) || 1) * Math.sqrt(b.speed * b.speed - minVy * minVy);
    }
    return true;
  }

  /** A snowdrift is a line across part of its owner's goal, facing the court. */
  bounceDrift(b, q, x0, y0) {
    const down = q.p === 0;                          // guarding the bottom goal
    if (down ? b.vy <= 0 : b.vy >= 0) return false;
    const rad = ballRadius(b);
    const lead0 = down ? y0 + rad : y0 - rad;
    const lead1 = down ? b.y + rad : b.y - rad;
    // Only a ball crossing the line this step: one already behind it is a goal.
    if (down ? lead0 > q.y || lead1 < q.y : lead0 < q.y || lead1 > q.y) return false;
    const f = lead1 !== lead0 ? (q.y - lead0) / (lead1 - lead0) : 1;
    const xc = x0 + (b.x - x0) * f;
    if (Math.abs(xc - q.x) > q.size + rad * 0.5) return false;
    b.x = clamp(xc, rad, 1 - rad);
    b.y = down ? q.y - rad : q.y + rad;
    b.vy = -b.vy;
    return true;
  }

  collideCrates(b) {
    for (let ci = this.crates.length - 1; ci >= 0; ci--) {
      const c = this.crates[ci];
      if (Math.hypot(c.x - b.x, c.y - b.y) > CRATE_R + ballRadius(b)) continue;
      this.crates.splice(ci, 1);
      const owner = b.owner >= 0 ? b.owner : (b.vy > 0 ? 1 : 0);
      this.applyItem(c.item, owner, b);
      this.event({ t: 'item', x: c.x, y: c.y, id: c.item.id, p: owner });
      this.shake = Math.max(this.shake, 0.55);
    }
  }

  applyItem(item, owner, ball) {
    const foe = 1 - owner;
    const pace = ball.speed;
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
          // atan2(vx, vy) is makeBall's own angle convention, so the extras
          // fan out around the ball's real heading — up the court as well as
          // down it. (They used to be flipped toward the bottom goal whenever
          // the ball was heading up, turning the host's own multiball on them.)
          const angle = Math.atan2(ball.vx, ball.vy) + sign * 0.42;
          this.balls.push(makeBall(ball.x, ball.y, angle, ball.speed * 0.94, owner));
        }
        break;
      }
      case 'ghost':
        ball.ghost = item.duration;
        break;
      case 'shrink':
        this.paddles[foe].shrink = item.duration;
        break;
      case 'mirror':
        ball.mirror = item.duration;
        break;
      case 'arco':
        this.paddles[owner].arco = item.duration;
        break;
      case 'spire': {
        // One per owner: a second pick moves it.
        const old = this.props.find((q) => q.kind === 'spire' && q.p === owner);
        if (old) this.dropProp(old);
        // Never in the path of the shot that raised it: that ball is still
        // heading for the victim's half, and a spire rising under it would
        // bat the picker's own attack straight back before it had even
        // finished rising. Keep it clear of where the ball will cross its
        // line (walls folded in, spin ignored) — wider for a slanting ball,
        // whose path passes the spire closer than that crossing point does.
        let x = 0.25 + this.rand() * 0.5;
        const cross = crossingX(ball, SPIRE_Y[foe]);
        const upright = Math.abs(ball.vy / COURT_ASPECT) / Math.hypot(ball.vx, ball.vy / COURT_ASPECT) || 1;
        const clear = Math.min(0.24, (SPIRE_R + ballRadius(ball)) / upright + 0.02);
        if (cross != null && Math.abs(x - cross) < clear) {
          x = clamp(cross > 0.5 ? cross - clear : cross + clear, 0.25, 0.75);
        }
        this.props.push({ kind: 'spire', x, y: SPIRE_Y[foe], size: SPIRE_R, t: item.duration, age: 0, p: owner, hits: 0 });
        this.event({ t: 'prop', k: 'spire', x, y: SPIRE_Y[foe], p: owner });
        break;
      }
      case 'avalanche': {
        // Snow piles up on the half of the goal the paddle isn't covering.
        const x = clamp(this.paddles[owner].x < 0.5 ? 0.72 : 0.28, DRIFT_HALF, 1 - DRIFT_HALF);
        const old = this.props.find((q) => q.kind === 'drift' && q.p === owner);
        if (old && old.x === x) {
          old.t = item.duration;                      // topped up where it stands
          old.hits = 0;
        } else {
          if (old) this.dropProp(old);
          this.props.push({ kind: 'drift', x, y: DRIFT_Y[owner], size: DRIFT_HALF, t: item.duration, age: 0, p: owner, hits: 0 });
        }
        this.event({ t: 'prop', k: 'drift', x, y: DRIFT_Y[owner], p: owner });
        break;
      }
      case 'beach': {
        ball.beach = item.duration;
        ball.speed = Math.max(BASE_SPEED * 0.75, ball.speed * 0.55);
        this.renormalise(ball);
        // The radius just jumped; a ball inflated next to a wall would be
        // stuck inside it until the next bounce.
        const rad = ballRadius(ball);
        ball.x = clamp(ball.x, rad, 1 - rad);
        break;
      }
      default:
        break;
    }
    // An ARCO bend is sized for the pace it was struck at. TURBO or a BEACH
    // BALL mid-arch changes the pace, so rescale the bend with it: left at
    // full strength, a beach ball hooks almost flat into the wall.
    if (ball.arc && ball.speed !== pace) ball.spin *= Math.pow(ball.speed / pace, ARCO_POW);
  }

  renormalise(b) {
    const mag = Math.hypot(b.vx, b.vy) || 1;
    b.vx = (b.vx / mag) * b.speed;
    b.vy = (b.vy / mag) * b.speed;
  }

  /** The hold ran out: the caught ball leaves, aimed by the paddle's motion. */
  flingBall(b) {
    const i = b.held;
    b.held = -1;
    const p = this.paddles[i];
    const dir = i === 0 ? -1 : 1;                // away from the flinger's goal
    // The drag is the aim: however far the paddle moved since the catch sets
    // the angle, so hauling the ball across the court slings a sharp diagonal
    // and holding your ground fires it dead straight. Position, not velocity —
    // no split-second flick timing required of a seven-year-old thumb.
    const angle = clamp((p.x - b.catchX) * 2.4, -1.1, 1.1);
    b.speed = Math.min(MAX_SPEED, Math.max(BASE_SPEED, b.speed) * 1.3);
    if (b.beach > 0) b.speed = Math.min(b.speed, BASE_SPEED * 1.15);
    b.vx = Math.sin(angle) * b.speed;
    b.vy = Math.cos(angle) * b.speed * dir;
    this.shake = Math.max(this.shake, 0.8);
    this.event({ t: 'fling', x: b.x, y: b.y, p: i });
  }

  fireSpecial(i) {
    if (this.phase !== 'play' || this.meter[i] < 1) return;
    const spec = this.chars[i].special;
    this.meter[i] = 0;
    const p = this.paddles[i];

    switch (spec.id) {
      case 'afterburn':
      case 'curve':
      case 'phantom':
        p.pending = { id: spec.id, until: this.time + spec.duration };
        break;
      case 'aegis':
        p.shield = spec.duration;
        break;
      case 'magnet':
        p.magnet = spec.duration;
        break;
      case 'quake': {
        const away = i === 0 ? -1 : 1;
        for (const b of this.balls) {
          // A quake rips a caught ball straight off the rival's magnet.
          if (b.held >= 0) { b.held = -1; b.vx = 0; b.vy = away; }
          b.speed = Math.min(MAX_SPEED, b.speed * 1.15);
          b.vy = Math.abs(b.vy) * away;
          b.spin = 0;
          b.arc = false;
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

  stepProps(dt) {
    for (let i = this.props.length - 1; i >= 0; i--) {
      const q = this.props[i];
      q.age += dt;
      q.t -= dt;
      if (q.t <= 0) this.dropProp(q);
    }
  }

  dropProp(q) {
    this.props.splice(this.props.indexOf(q), 1);
    this.event({ t: 'gone', k: q.kind, x: q.x, y: q.y, p: q.p });
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
    const maxCrates = this.party ? MAX_CRATES_PARTY : MAX_CRATES;
    const minRally = this.party ? 1 : 2;
    if (this.nextCrate <= 0 && this.crates.length < maxCrates && this.rally >= minRally) {
      this.nextCrate = this.rollCrateDelay();
      const item = rollItem(this.rand, this.party, this.items);
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
    this.scores[scorer]++;
    this.streak[scorer]++;
    this.streak[loser] = 0;
    if (this.balls.length > 0) {
      // Multiball: the rally carries on, the point still counts.
      this.event({ t: 'goal', x: ball.x, y: loser === 0 ? 1 : 0, p: scorer, quiet: true });
      if (this.scores[scorer] >= this.target) { this.balls = []; this.pointBreak(scorer); }
      return;
    }
    this.pointBreak(scorer);
  }

  pointBreak(scorer) {
    const loser = 1 - scorer;
    this.serveTo = loser;
    this.phase = 'point';
    this.phaseTime = SERVE_DELAY;
    this.crates = [];
    this.props = [];
    this.shake = 1.2;
    for (const p of this.paddles) { p.shield = 0; p.pending = null; p.magnet = 0; }
    this.event({
      t: 'goal', x: 0.5, y: loser === 0 ? 1 : 0, p: scorer, rally: this.rally,
      streak: this.streak[scorer],
      // Reaching match point deserves its own drum roll; winning outright
      // gets the 'match' event instead.
      mp: this.scores[scorer] === this.target - 1 ? 1 : 0,
    });
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
      st: this.streak,
      pd: this.paddles.map((p, i) => [
        +p.x.toFixed(4), +this.paddleWidth(i).toFixed(4),
        p.shield > 0 ? 1 : 0, p.frost > 0 ? 1 : 0, p.pending ? 1 : 0,
        p.shrink > 0 ? 1 : 0, p.magnet > 0 ? 1 : 0,
        +p.arco.toFixed(1),
      ]),
      bl: this.balls.map((b) => [
        +b.x.toFixed(4), +b.y.toFixed(4), +b.vx.toFixed(3), +b.vy.toFixed(3),
        b.fire > 0 ? 1 : 0, b.id, b.ghost > 0 ? 1 : 0, b.beach > 0 ? 1 : 0,
        b.held >= 0 ? 1 : 0, b.owner, +b.mirror.toFixed(1),
      ]),
      cr: this.crates.map((c) => [+c.x.toFixed(3), +c.y.toFixed(3), +c.spin.toFixed(2), c.item.id]),
      ev: this.outbox,
      sh: +this.shake.toFixed(2),
    };
    // Appended fields ride at the end of their arrays, and props only when
    // there are any, so a phone on an older build just never looks at them.
    if (this.props.length) {
      snap.pr = this.props.map((q) => [
        q.kind, +q.x.toFixed(3), +q.y.toFixed(3), +q.size.toFixed(3), +q.t.toFixed(2), q.p, q.hits,
      ]);
    }
    this.outbox = [];
    return snap;
  }

  /** Returns whether the snapshot was applied (stale ticks are discarded). */
  applySnapshot(s) {
    if (s.n <= this.tick) return false;    // an unreliable channel reorders packets
    this.tick = s.n;
    this.phase = s.ph;
    this.phaseTime = s.pt;
    this.scores = s.sc;
    this.meter = s.me;
    this.rally = s.rl;
    this.bestRally = Math.max(this.bestRally, s.rl);
    this.winner = s.wn;
    if (s.st) this.streak = s.st;
    this.shake = Math.max(this.shake, s.sh);

    s.pd.forEach((p, i) => {
      const pad = this.paddles[i];
      pad.x = p[0];
      pad.netWidth = p[1];
      pad.shield = p[2] ? 1 : 0;
      pad.frost = p[3] ? 1 : 0;
      pad.pending = p[4] ? { id: this.chars[i].special.id, until: Infinity } : null;
      pad.shrink = p[5] ? 1 : 0;
      pad.magnet = p[6] ? 1 : 0;
      pad.arco = p[7] || 0;                // absent from an older host
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
        speed: Math.hypot(b[2], b[3]), fire: b[4] ? 1 : 0, spin: 0,
        owner: b[9] ?? -1,      // who last touched it — drives the trail flair
        ghost: b[6] ? 1 : 0, beach: b[7] ? 1 : 0, held: b[8] ? 0 : -1, hx: 0,
        mirror: b[10] || 0,
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

    // Props keep a local age, so a spire rises once rather than on every
    // packet. Same kind, owner and spot means the same prop; a moved one
    // is new and rises again.
    const before = this.props;
    this.props = (s.pr || []).map((q) => {
      const was = before.find((o) => o.kind === q[0] && o.p === q[5] && Math.abs(o.x - q[1]) < 1e-3);
      return {
        kind: q[0], x: q[1], y: q[2], size: q[3], t: q[4], p: q[5], hits: q[6] || 0,
        age: was ? was.age : 0,
      };
    });

    for (const e of s.ev) this.events.push(e);
    return true;
  }

  /** Guest-side smoothing between the 30 Hz snapshots. */
  extrapolate(dt) {
    if (this.phase !== 'play') return;
    for (const b of this.balls) {
      const rad = ballRadius(b);
      const x0 = b.x, y0 = b.y;
      b.x = clamp(b.x + b.vx * dt, rad, 1 - rad);
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
      b.mirror = Math.max(0, (b.mirror || 0) - dt);
      // Bounce off props here as well, rather than drawing the ball sailing
      // through a spire for the packet or two before the host's bounce lands.
      // The host's word still wins: this only drops the stale target so the
      // easing can't drag the ball back through.
      if (this.props.length && b.held < 0 && this.collideProps(b, x0, y0, false)) {
        b.tx = null;
        b.ty = null;
      }
    }
    for (const q of this.props) {
      q.age += dt;
      q.t = Math.max(0, q.t - dt);
    }
    for (const p of this.paddles) p.arco = Math.max(0, (p.arco || 0) - dt);
    for (const c of this.crates) c.spin += dt * 1.4;
    this.shake = Math.max(0, this.shake - dt * 2.6);
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
