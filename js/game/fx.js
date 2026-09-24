// RoGuPong — sparks, rings, shockwaves and the words that fly off a big hit.
//
// Everything lives in normalised court coordinates so the same burst looks
// right on a 5" phone and a tablet. The renderer converts at draw time.

import { ITEMS, itemById } from './items.js';
import { COURT_ASPECT } from './match.js';

const TAU = Math.PI * 2;

export class Fx {
  constructor() {
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.flash = null;
    this.confetti = null;         // {time, dir} — a sustained rain, not a burst
    this.confettiCarry = 0;
    this.freeze = 0;
    // Scales every burst. Dropped on phones that cannot afford the confetti;
    // the events still read, there is just less of each one.
    this.budget = 1;
    this.maxParticles = 500;
  }

  setQuality(quality) {
    const low = quality === 'low';
    this.budget = low ? 0.4 : 1;
    this.maxParticles = low ? 130 : 500;
    if (this.particles.length > this.maxParticles) {
      this.particles.length = this.maxParticles;
    }
  }

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.flash = null;
    this.confetti = null;
  }

  /**
   * Confetti rain for the winner's celebration. `dir` is +1 when the local
   * view's "up" is court-up (player 0) and -1 when the renderer flips y
   * (player 1), so the paper always falls downward on the phone showing it.
   */
  celebrate(duration = 2.4, dir = 1) {
    this.confetti = { time: duration, dir };
    this.confettiCarry = 0;
  }

  /** A spray of sparks. `spread` is in radians around `dir`. */
  burst(x, y, opts = {}) {
    const {
      count = 12, color = '#ffffff', color2 = null, speed = 0.55, spread = TAU,
      dir = 0, life = 0.45, gravity = 0.35, size = 0.008, squares = true,
    } = opts;
    const n = Math.max(3, Math.round(count * this.budget));
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.35 + Math.random() * 0.9);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.8),
        age: 0,
        size: size * (0.6 + Math.random() * 0.9),
        color: color2 && Math.random() < 0.45 ? color2 : color,
        gravity,
        squares,
        spin: (Math.random() - 0.5) * 12,
        rot: Math.random() * TAU,
      });
    }
  }

  /** A thin expanding ring — impacts, specials, goals. */
  ring(x, y, opts = {}) {
    const { color = '#fff', from = 0.01, to = 0.28, life = 0.5, width = 0.008, fillTo = 0 } = opts;
    this.rings.push({ x, y, color, from, to, life, age: 0, width, fillTo });
  }

  /**
   * Sparkles strung along an arch, ARCO's flourish. `dir` -1 raises it up
   * the court (toward player 1), +1 down it. `radius` is in court widths.
   */
  arch(x, y, opts = {}) {
    const { color = '#fff', color2 = null, radius = 0.07, count = 9, dir = -1, life = 0.5 } = opts;
    const n = Math.max(5, Math.round(count * this.budget));
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (i / (n - 1));
      const ox = Math.cos(a), oy = Math.sin(a) * dir;
      this.particles.push({
        x: x + ox * radius,
        y: y + oy * radius * COURT_ASPECT,           // round on screen, not in court units
        vx: ox * 0.06, vy: oy * 0.06 * COURT_ASPECT,
        life: life * (0.8 + Math.random() * 0.4), age: 0,
        size: 0.013, color: color2 && i % 2 ? color2 : color,
        gravity: 0, squares: true, spin: 0, rot: 0,
      });
    }
  }

  /** Pixel text that pops and drifts upward. */
  text(x, y, str, opts = {}) {
    const { color = '#fff', life = 0.9, rise = 0.10, scale = 1, outline = '#1a0d2b' } = opts;
    this.texts.push({ x, y, str, color, life, age: 0, rise, scale, outline });
  }

  /** Full-screen colour wash. */
  bang(color = '#fff', strength = 0.5, life = 0.28) {
    this.flash = { color, strength, life, age: 0 };
  }

  update(dt) {
    if (this.confetti) {
      this.confetti.time -= dt;
      this.confettiCarry += 70 * this.budget * dt;
      const colors = ['#ff4d3d', '#ffd93b', '#8affc1', '#3da5ff', '#ff56d0', '#ffffff'];
      const dir = this.confetti.dir;
      while (this.confettiCarry >= 1) {
        this.confettiCarry -= 1;
        this.particles.push({
          x: Math.random(),
          y: dir > 0 ? -0.04 : 1.04,
          vx: (Math.random() - 0.5) * 0.14,
          vy: dir * (0.10 + Math.random() * 0.18),
          life: 2.4, age: 0,
          size: 0.010 * (0.6 + Math.random() * 0.8),
          color: colors[(Math.random() * colors.length) | 0],
          gravity: 0.16 * dir,
          squares: true,
          spin: (Math.random() - 0.5) * 14,
          rot: Math.random() * TAU,
        });
      }
      if (this.confetti.time <= 0) this.confetti = null;
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.life) { this.particles.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.age += dt;
      if (r.age >= r.life) this.rings.splice(i, 1);
    }
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.age += dt;
      if (t.age >= t.life) this.texts.splice(i, 1);
    }
    if (this.flash) {
      this.flash.age += dt;
      if (this.flash.age >= this.flash.life) this.flash = null;
    }
    if (this.particles.length > this.maxParticles) {
      this.particles.splice(0, this.particles.length - this.maxParticles);
    }
  }
}

const MIRROR = itemById('mirror');
const ARCO = itemById('arco');

/**
 * Turn a simulation event into noise and light. Kept next to the Fx class so
 * every visual reaction to the rules lives in one readable place.
 */
export function reactTo(ev, fx, chars, audio, opts = {}) {
  const { accent = '#fff', view = 0 } = opts;
  const who = ev.p != null ? chars[ev.p] : null;
  const tint = who ? who.color : accent;
  const tint2 = who ? who.color2 : '#fff';
  // Court +y is screen-down on this phone, or screen-up when the view is flipped.
  const down = view === 1 ? -1 : 1;

  switch (ev.t) {
    case 'hit': {
      const dir = ev.p === 0 ? -Math.PI / 2 : Math.PI / 2;
      fx.burst(ev.x, ev.y, {
        count: ev.big ? 26 : 11, color: tint, color2: tint2,
        speed: ev.big ? 0.95 : 0.5, spread: 1.9, dir, life: ev.big ? 0.6 : 0.36,
      });
      fx.ring(ev.x, ev.y, { color: tint2, to: ev.big ? 0.30 : 0.13, life: ev.big ? 0.5 : 0.28 });
      // An ARCO return: this one is going to bend.
      if (ev.a) fx.arch(ev.x, ev.y, { color: ARCO.color, color2: '#efe2c4', radius: 0.06, count: 7, dir: ev.p === 0 ? -1 : 1, life: 0.4 });
      if (ev.big) fx.bang(tint, 0.45, 0.22);
      if (ev.r && ev.r > 0 && ev.r % 5 === 0) {
        fx.text(ev.x, ev.y - 0.05, ev.r + ' RALLY', { color: '#ffd93b', scale: 0.9 });
      }
      audio?.hit(ev.big, ev.r || 0);
      break;
    }
    case 'wall':
      fx.burst(ev.x, ev.y, { count: 6, color: '#ffffff', speed: 0.3, spread: 2.4, life: 0.25, gravity: 0.2 });
      audio?.wall();
      break;
    case 'burn':
      fx.burst(ev.x, ev.y, { count: 30, color: '#ff7a3d', color2: '#ffd166', speed: 1.1, spread: 2.4, life: 0.7 });
      fx.text(ev.x, ev.y - 0.06, 'AFTERBURN', { color: '#ffd166', scale: 1.1 });
      break;
    case 'curve':
      fx.ring(ev.x, ev.y, { color: '#ff56d0', to: 0.25, life: 0.6, width: 0.014 });
      fx.text(ev.x, ev.y - 0.06, 'CURVE', { color: '#ff8ae2', scale: 1.1 });
      break;
    case 'phantom':
      fx.ring(ev.x, ev.y, { color: '#9b7bff', to: 0.28, life: 0.7, width: 0.014 });
      fx.burst(ev.x, ev.y, { count: 16, color: '#c9a2ff', color2: '#e0d4ff', speed: 0.5, spread: TAU, life: 0.6, gravity: 0.1 });
      fx.text(ev.x, ev.y - 0.06, 'PHANTOM', { color: '#c9a2ff', scale: 1.1 });
      break;
    case 'catch':
      fx.ring(ev.x, ev.y, { color: '#3ddc84', to: 0.2, life: 0.5, width: 0.012 });
      fx.burst(ev.x, ev.y, { count: 14, color: '#3ddc84', color2: '#b8ffd9', speed: 0.45, spread: TAU, life: 0.45 });
      fx.text(ev.x, ev.y + (ev.p === 0 ? -0.07 : 0.07), 'CAUGHT!', { color: '#b8ffd9', scale: 1.0 });
      audio?.blip(520, 0.12, 'sine', 0.18);
      break;
    case 'fling': {
      const dir = ev.p === 0 ? -Math.PI / 2 : Math.PI / 2;
      fx.burst(ev.x, ev.y, { count: 24, color: '#3ddc84', color2: '#ffffff', speed: 0.9, spread: 1.4, dir, life: 0.55 });
      fx.ring(ev.x, ev.y, { color: '#b8ffd9', to: 0.26, life: 0.4 });
      audio?.hit(true, 0);
      break;
    }
    case 'shield':
      fx.burst(ev.x, ev.y, { count: 34, color: '#9df3ff', color2: '#ffffff', speed: 0.9, spread: 3.2, life: 0.7 });
      fx.ring(ev.x, ev.y, { color: '#9df3ff', to: 0.35, life: 0.5, width: 0.012 });
      fx.text(ev.x, ev.y - 0.06, 'BLOCKED', { color: '#9df3ff' });
      audio?.shield();
      break;
    case 'special':
      fx.bang(tint, 0.6, 0.35);
      fx.ring(0.5, ev.p === 0 ? 0.9 : 0.1, { color: tint2, to: 1.1, life: 0.7, width: 0.02 });
      fx.text(0.5, 0.5, (who?.special.name) || 'SPECIAL', { color: tint2, scale: 1.6, life: 1.1 });
      audio?.special();
      break;
    case 'item': {
      fx.burst(ev.x, ev.y, { count: 26, color: tint2, color2: '#ffffff', speed: 0.8, spread: TAU, life: 0.6 });
      fx.ring(ev.x, ev.y, { color: tint, to: 0.3, life: 0.45 });
      // The item's own name, in its own colour. An id this build doesn't know
      // (a newer host) still shows something sensible.
      const item = ITEMS.find((i) => i.id === ev.id);
      const name = item ? item.name : String(ev.id || '').toUpperCase();
      // Kept whole on screen: a long name off a crate near the wall would
      // otherwise run off the edge (6 font pixels a glyph, 90 to the court
      // width, and 10% more at the top of the text's pop).
      const half = Math.min(0.5, ((name.length * 6 - 1) * 1.05 * 1.1) / 180);
      fx.text(Math.max(half, Math.min(1 - half, ev.x)), ev.y - 0.05, name, { color: item ? item.color : '#ffffff', scale: 1.05 });
      if (ev.id === 'mirror') {
        // Ripples open where the decoy is about to appear.
        fx.ring(1 - ev.x, ev.y, { color: MIRROR.color, from: 0.01, to: 0.14, life: 0.5, width: 0.006 });
        fx.ring(1 - ev.x, ev.y, { color: '#c8e8ff', from: 0.04, to: 0.22, life: 0.75, width: 0.004 });
      } else if (ev.id === 'arco') {
        // An arch the right way up on this phone, whichever way it is flipped.
        fx.arch(ev.x, ev.y, { color: ARCO.color, color2: '#efe2c4', radius: 0.09, count: 11, dir: -down, life: 0.6 });
        fx.arch(ev.x, ev.y, { color: '#efe2c4', radius: 0.05, count: 7, dir: -down, life: 0.5 });
      }
      audio?.item();
      break;
    }
    case 'prop':
      if (ev.k === 'spire') {
        // Marble dust kicked out sideways as the pinnacle rises. The spire
        // stands upright on screen, so its dust falls screen-down.
        fx.burst(ev.x, ev.y, { count: 22, color: '#d8ccc3', color2: '#9a8c9c', speed: 0.45, spread: 0.9, dir: 0, life: 0.55, gravity: 0.15 * down });
        fx.burst(ev.x, ev.y, { count: 22, color: '#d8ccc3', color2: '#f7efe5', speed: 0.45, spread: 0.9, dir: Math.PI, life: 0.55, gravity: 0.15 * down });
        fx.ring(ev.x, ev.y, { color: '#f2e2cc', from: 0.02, to: 0.16, life: 0.4, width: 0.01 });
        audio?.rumble();
      } else {
        // A wall of snow blown up off the goal line, into the court, settling
        // back onto the bank.
        const bank = ev.p === 0 ? 1 : -1;
        const into = -bank * Math.PI / 2;
        fx.burst(ev.x, ev.y, { count: 34, color: '#ffffff', color2: '#b7c6ee', speed: 0.55, spread: 2.4, dir: into, life: 0.7, gravity: 0.25 * bank, size: 0.007 });
        fx.burst(ev.x - 0.12, ev.y, { count: 12, color: '#ffe0ec', color2: '#ffffff', speed: 0.35, spread: 1.6, dir: into, life: 0.6, gravity: 0.2 * bank, size: 0.006 });
        fx.burst(ev.x + 0.12, ev.y, { count: 12, color: '#ffe0ec', color2: '#ffffff', speed: 0.35, spread: 1.6, dir: into, life: 0.6, gravity: 0.2 * bank, size: 0.006 });
        audio?.thump();
      }
      break;
    case 'bump':
      if (ev.k === 'spire') {
        fx.burst(ev.x, ev.y, { count: 10, color: '#f7efe5', color2: '#9a8c9c', speed: 0.45, spread: TAU, life: 0.35, gravity: 0.3 * down, size: 0.006 });
        fx.ring(ev.x, ev.y, { color: '#f2e2cc', to: 0.1, life: 0.25 });
        audio?.clack();
      } else {
        const bank = ev.p === 0 ? 1 : -1;
        const last = ev.left === 0;
        fx.burst(ev.x, ev.y, {
          count: last ? 40 : 22, color: '#ffffff', color2: '#dce6fb', speed: last ? 0.7 : 0.5,
          spread: 2.2, dir: -bank * Math.PI / 2, life: last ? 0.8 : 0.55, gravity: 0.3 * bank, size: 0.008,
        });
        audio?.thump();
      }
      break;
    case 'gone':
      if (ev.k === 'spire') {
        fx.burst(ev.x, ev.y, { count: 26, color: '#d8ccc3', color2: '#7d7182', speed: 0.4, spread: TAU, life: 0.6, gravity: 0.45 * down, size: 0.009 });
        audio?.crumble();
      } else {
        // Melted, or the last of it after a final block: a soft slump of
        // powder onto the goal line.
        fx.burst(ev.x, ev.y, { count: 18, color: '#ffffff', color2: '#b7c6ee', speed: 0.3, spread: TAU, life: 0.5, gravity: 0.15 * (ev.p === 0 ? 1 : -1), size: 0.006 });
      }
      break;
    case 'crate':
      audio?.blip(880, 0.05, 'square', 0.06);
      break;
    case 'goal': {
      if (ev.quiet) { audio?.goal(); break; }
      fx.bang('#ffffff', 0.7, 0.3);
      fx.burst(ev.x, ev.y, { count: 44, color: tint, color2: '#ffffff', speed: 1.2, spread: TAU, life: 0.9, gravity: 0.5 });
      fx.ring(ev.x, ev.y, { color: tint2, to: 0.7, life: 0.6, width: 0.016 });
      if (ev.streak >= 3) {
        // Below centre so it clears the POINT banner, drifting up as it fades.
        fx.text(0.5, 0.64, ev.streak + ' IN A ROW!', { color: '#ff9b4a', scale: 1.25, life: 1.3 });
        fx.burst(0.5, 0.5, { count: 20, color: '#ff9b4a', color2: '#ffd166', speed: 0.8, spread: TAU, life: 0.6 });
      }
      if (ev.mp) {
        fx.bang('#ff4d3d', 0.3, 0.4);
        fx.ring(0.5, 0.5, { color: '#ff4d3d', to: 0.9, life: 0.8, width: 0.02 });
      }
      audio?.goal();
      break;
    }
    case 'serve':
      fx.ring(0.5, 0.5, { color: '#ffffff', to: 0.2, life: 0.35 });
      audio?.blip(660, 0.07, 'square', 0.05);
      break;
    case 'match': {
      fx.bang('#ffffff', 0.9, 0.5);
      const won = ev.p === view;
      // Confetti only rains on the winner's phone; the paper falls toward
      // whichever screen edge is "down" for that player's flipped view.
      if (won) fx.celebrate(2.4, view === 1 ? -1 : 1);
      for (let i = 0; i < (won ? 9 : 5); i++) {
        setTimeout(() => {
          const x = 0.12 + Math.random() * 0.76;
          const y = 0.15 + Math.random() * 0.7;
          fx.burst(x, y, {
            count: won ? 36 : 26, color: tint, color2: '#ffd93b',
            speed: 1.1, spread: TAU, life: 1.1, gravity: 0.4,
          });
          fx.ring(x, y, { color: '#ffffff', to: 0.22, life: 0.5 });
        }, i * 150);
      }
      // No jingle here: finishMatch already plays victory or defeat per view,
      // and a second victory() on the losing phone was clashing with it.
      break;
    }
    default:
      break;
  }
}
