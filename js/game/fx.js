// RoGuPong — sparks, rings, shockwaves and the words that fly off a big hit.
//
// Everything lives in normalised court coordinates so the same burst looks
// right on a 5" phone and a tablet. The renderer converts at draw time.

const TAU = Math.PI * 2;

export class Fx {
  constructor() {
    this.particles = [];
    this.rings = [];
    this.texts = [];
    this.flash = null;
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

/**
 * Turn a simulation event into noise and light. Kept next to the Fx class so
 * every visual reaction to the rules lives in one readable place.
 */
export function reactTo(ev, fx, chars, audio, opts = {}) {
  const { accent = '#fff' } = opts;
  const who = ev.p != null ? chars[ev.p] : null;
  const tint = who ? who.color : accent;
  const tint2 = who ? who.color2 : '#fff';

  switch (ev.t) {
    case 'hit': {
      const dir = ev.p === 0 ? -Math.PI / 2 : Math.PI / 2;
      fx.burst(ev.x, ev.y, {
        count: ev.big ? 26 : 11, color: tint, color2: tint2,
        speed: ev.big ? 0.95 : 0.5, spread: 1.9, dir, life: ev.big ? 0.6 : 0.36,
      });
      fx.ring(ev.x, ev.y, { color: tint2, to: ev.big ? 0.30 : 0.13, life: ev.big ? 0.5 : 0.28 });
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
    case 'item':
      fx.burst(ev.x, ev.y, { count: 26, color: tint2, color2: '#ffffff', speed: 0.8, spread: TAU, life: 0.6 });
      fx.ring(ev.x, ev.y, { color: tint, to: 0.3, life: 0.45 });
      fx.text(ev.x, ev.y - 0.05, String(ev.id || '').toUpperCase(), { color: '#ffffff', scale: 1.05 });
      audio?.item();
      break;
    case 'crate':
      audio?.blip(880, 0.05, 'square', 0.06);
      break;
    case 'goal': {
      if (ev.quiet) { audio?.goal(); break; }
      fx.bang('#ffffff', 0.7, 0.3);
      fx.burst(ev.x, ev.y, { count: 44, color: tint, color2: '#ffffff', speed: 1.2, spread: TAU, life: 0.9, gravity: 0.5 });
      fx.ring(ev.x, ev.y, { color: tint2, to: 0.7, life: 0.6, width: 0.016 });
      audio?.goal();
      break;
    }
    case 'serve':
      fx.ring(0.5, 0.5, { color: '#ffffff', to: 0.2, life: 0.35 });
      audio?.blip(660, 0.07, 'square', 0.05);
      break;
    case 'match':
      fx.bang('#ffffff', 0.9, 0.5);
      for (let i = 0; i < 5; i++) {
        setTimeout(() => fx.burst(0.15 + Math.random() * 0.7, 0.2 + Math.random() * 0.6, {
          count: 30, color: tint, color2: '#ffd93b', speed: 1.0, spread: TAU, life: 1.0,
        }), i * 130);
      }
      audio?.victory();
      break;
    default:
      break;
  }
}
