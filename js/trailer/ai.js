// RoGuPong trailer — the two players in the gameplay shots.
//
// A bot reads the court the way a decent player does: it finds the ball that
// reaches its goal first, works out where that ball will cross its paddle
// (bouncing off the side walls on the way) and slides there, aiming to meet it
// off-centre so the return goes somewhere interesting. Now and then it plans
// to be a touch too late, so points actually end on camera.
//
// Everything random comes from the bot's own seeded PRNG and is drawn inside
// the fixed simulation step, so a shot replays identically wherever the
// trailer is scrubbed to. No DOM in here: a headless harness can run it.

import { PADDLE_Y, PADDLE_H, ballRadius } from '../game/match.js';
import { mulberry } from '../game/scenes/kit.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Where a ball will cross height y, folded off the side walls; null if it isn't heading there. */
function crossing(b, y) {
  if (b.held >= 0 || !b.vy) return null;
  const t = (y - b.y) / b.vy;
  if (t <= 0) return null;
  const rad = ballRadius(b);
  const span = 1 - rad * 2;
  const u = ((b.x + b.vx * t - rad) % (span * 2) + span * 2) % (span * 2);
  return { x: rad + (u <= span ? u : span * 2 - u), t };
}

export class Bot {
  /**
   * i      player index (0 bottom, 1 top)
   * seed   PRNG seed
   * miss   chance a given approach is planned as a miss
   */
  constructor(i, seed, { miss = 0.12 } = {}) {
    this.i = i;
    this.rand = mulberry(seed);
    this.miss = miss;
    this.plans = new Map();
    this.idle = 0.5;
    // The director can hold a special back until a cue, or demand one.
    this.specialFrom = 0;
    this.forceSpecial = false;
  }

  /** The input for this step: { x, special }. */
  think(m) {
    const i = this.i;
    const me = m.paddles[i];
    const half = m.paddleWidth(i) / 2;
    const faceY = i === 0 ? PADDLE_Y[0] - PADDLE_H / 2 : PADDLE_Y[1] + PADDLE_H / 2;

    // A ball caught on our magnet: slide to aim it away from the rival.
    const held = m.balls.find((b) => b.held === i);
    if (held) {
      const rival = m.paddles[1 - i].x;
      return { x: rival < 0.5 ? 0.82 : 0.18, special: false };
    }

    let next = null;
    for (const b of m.balls) {
      const toward = i === 0 ? b.vy > 0 && b.y < faceY : b.vy < 0 && b.y > faceY;
      if (!toward) continue;
      const c = crossing(b, faceY + (i === 0 ? -ballRadius(b) : ballRadius(b)));
      if (c && (!next || c.t < next.t)) next = { b, ...c };
    }

    let x = this.idle;
    let plan = null;
    if (next) {
      const key = next.b.id + ':' + m.rally;
      plan = this.plans.get(key);
      if (!plan) {
        const missing = this.rand() < this.miss;
        const side = this.rand() < 0.5 ? -1 : 1;
        plan = {
          // Where on the paddle to meet it, in half-widths: that sets the angle.
          aim: missing ? side * (1.3 + this.rand() * 0.5) : (this.rand() * 2 - 1) * 0.8,
          missing,
        };
        this.plans.set(key, plan);
        if (this.plans.size > 64) this.plans.delete(this.plans.keys().next().value);
      }
      x = next.x - plan.aim * half;
    } else if (m.phase === 'play') {
      // Nothing coming: drift back toward the middle, a little off it.
      if (this.rand() < 0.01) this.idle = 0.35 + this.rand() * 0.3;
      x = this.idle;
    }

    return { x: clamp(x, 0, 1), special: this.wantsSpecial(m, next, plan, me) };
  }

  wantsSpecial(m, next, plan, me) {
    const i = this.i;
    if (m.phase !== 'play' || m.meter[i] < 1 || m.time < this.specialFrom) return false;
    if (this.forceSpecial) { this.forceSpecial = false; return true; }
    const id = m.chars[i].special.id;
    const soon = next && next.t < 0.55;
    switch (id) {
      case 'afterburn':
      case 'curve':
      case 'phantom':
        return !me.pending && !!soon && !plan.missing;
      case 'magnet':
        return me.magnet <= 0 && !!soon;
      case 'aegis':
        // Saved for a ball it is about to let through.
        return me.shield <= 0 && !!soon && plan.missing;
      case 'quake':
        // An attack: every ball on the rival's half, heading at the rival.
        return m.balls.some((b) => b.held < 0 && (i === 0 ? b.y < 0.45 && b.vy < 0 : b.y > 0.55 && b.vy > 0));
      default:
        return false;
    }
  }
}
