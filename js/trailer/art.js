// RoGuPong trailer — the drawing kit the shots share.
//
// The trailer keeps to the game's own rules for how things look: chunky art
// pixels (u, about min(W, H) / 180 screen pixels), flat colours banded and
// dithered rather than smooth, and every word in the game's 5x7 pixel font.

import { drawText, measure, GLYPH_H } from '../ui/pixelfont.js';

export const INK = '#f4ecff';
export const BG0 = '#0b0616';
export const BG1 = '#1a0d2b';
export const BG2 = '#2b1350';
export const GOLD = '#ffd93b';
export const OUTLINE = '#160b23';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
/** 0..1 progress of t through [a, a + len]. */
export const span = (t, a, len) => clamp((t - a) / len, 0, 1);
export const outCubic = (t) => 1 - Math.pow(1 - t, 3);
export const inCubic = (t) => t * t * t;
export const outBack = (t) => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);
export const inOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/** Did the playhead cross time `at` this frame? Only ever true while playing forward. */
export const crossed = (prev, now, at) => prev < at && now >= at;

/* ------------------------------------------------------------------ */
/* Colour                                                              */

function parse(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Blend two #rrggbb colours. */
export function mix(a, b, t) {
  const A = parse(a), B = parse(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

/** #rrggbb as the 32-bit pixel an ImageData's Uint32Array stores (little-endian ABGR). */
export function px32(hex) {
  const [r, g, b] = parse(hex);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

/** 4x4 ordered dither thresholds, 0..1: banding with a 16-bit painter's hand. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const dither = (x, y) => BAYER[(y & 3) * 4 + (x & 3)];

/* ------------------------------------------------------------------ */
/* A low-resolution layer painted one art pixel at a time              */

export class Pixels {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.w = 0;
    this.h = 0;
  }

  size(w, h) {
    if (w === this.w && h === this.h) return;
    this.w = this.canvas.width = Math.max(1, w);
    this.h = this.canvas.height = Math.max(1, h);
    this.img = this.ctx.createImageData(this.w, this.h);
    this.buf = new Uint32Array(this.img.data.buffer);
  }

  /** fn(x, y) returns a px32 colour for every art pixel. */
  shade(fn) {
    const { w, h, buf } = this;
    let k = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) buf[k++] = fn(x, y);
    this.ctx.putImageData(this.img, 0, 0);
  }

  blit(ctx, x, y, u) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.canvas, x, y, this.w * u, this.h * u);
  }
}

/**
 * Light rays turning about (cx, cy), in art pixels: the 16-bit title screen's
 * sunburst. `tiers` are pairs of colours from the middle outward; the tiers
 * meet in dithered bands rather than a gradient.
 */
export function sunburst(layer, cx, cy, turn, tiers, rays = 14) {
  const cols = tiers.map((pair) => pair.map(px32));
  const n = cols.length;
  const k = rays / (Math.PI * 2);
  const reach = Math.hypot(layer.w, layer.h) * 0.5;
  layer.shade((x, y) => {
    const dx = x - cx, dy = y - cy;
    const ray = Math.floor((Math.atan2(dy, dx) + turn) * k + 1000) & 1;
    const tier = Math.floor((Math.hypot(dx, dy) / reach) * n + dither(x, y) - 0.5);
    return cols[tier < 0 ? 0 : tier >= n ? n - 1 : tier][ray];
  });
}

/* ------------------------------------------------------------------ */
/* Type                                                                */

/** The largest whole scale at which `str` fits `maxW`, between lo and hi. */
export function fit(str, maxW, hi, lo = 1) {
  let s = Math.max(lo, Math.floor(hi));
  while (s > lo && measure(str, s) > maxW) s--;
  return s;
}

/** Pixel text: the game's font, with the trailer's defaults. */
export function text(ctx, str, x, y, opts = {}) {
  return drawText(ctx, str, x, y, { align: 'center', baseline: 'middle', ...opts });
}

/** Height of a line at a given scale. */
export const lineH = (scale) => GLYPH_H * scale;

/** Break `str` into lines no wider than maxW at this scale; two lines come out balanced. */
export function wrap(str, maxW, scale) {
  const words = str.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (line && measure(next, scale) > maxW) { lines.push(line); line = w; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length !== 2) return lines;
  let best = lines;
  let widest = Math.max(...lines.map((l) => measure(l, scale)));
  for (let i = 1; i < words.length; i++) {
    const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const w = Math.max(...pair.map((l) => measure(l, scale)));
    if (w < widest) { best = pair; widest = w; }
  }
  return best;
}

/**
 * Copy that slams in: a few whole scales too big for its first frames, then
 * home. Whole scales only, so the glyphs never go soft.
 */
export function slam(ctx, str, x, y, scale, age, opts = {}) {
  const extra = age < 0.04 ? 3 : age < 0.08 ? 1 : 0;
  return text(ctx, str, x, y, { scale: scale + extra, ...opts });
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */

/**
 * A rectangle with stepped pixel corners: `steps` are the insets of the first
 * rows, in units of u (e.g. [3, 1, 1]).
 */
export function pixelRect(ctx, x, y, w, h, u, steps, color) {
  ctx.fillStyle = color;
  const n = steps.length;
  for (let k = 0; k < n; k++) {
    const ins = steps[k] * u;
    ctx.fillRect(x + ins, y + k * u, w - ins * 2, u);
    ctx.fillRect(x + ins, y + h - (k + 1) * u, w - ins * 2, u);
  }
  ctx.fillRect(x, y + n * u, w, h - n * u * 2);
}

/** The screen inside a phone of this size, in whole pixels. */
export function screenRect(x, y, w, h, u) {
  const bez = Math.max(u * 2, Math.round(w * 0.055));
  const top = Math.max(u * 4, Math.round(h * 0.055));
  return {
    x: Math.round(x) + bez,
    y: Math.round(y) + top,
    w: w - bez * 2,
    h: h - top - Math.max(u * 3, Math.round(h * 0.04)),
  };
}

/**
 * A phone, front on: bezel, screen, earpiece and a side button in its owner's
 * colour. Returns the screen rectangle.
 */
export function phone(ctx, x, y, w, h, u, accent) {
  x = Math.round(x);
  y = Math.round(y);
  const shadow = Math.max(u, Math.round(w * 0.03));
  pixelRect(ctx, x + shadow, y + shadow, w, h, u, [3, 1, 1], 'rgba(5,2,12,0.6)');
  pixelRect(ctx, x, y, w, h, u, [3, 1, 1], '#3a2a55');
  pixelRect(ctx, x + u, y + u, w - u * 2, h - u * 2, u, [2, 1], '#120a1c');
  ctx.fillStyle = accent;
  ctx.fillRect(x + w, y + Math.round(h * 0.22), u, Math.round(h * 0.09));
  const screen = screenRect(x, y, w, h, u);
  ctx.fillStyle = '#05020c';
  ctx.fillRect(screen.x - 1, screen.y - 1, screen.w + 2, screen.h + 2);
  // Earpiece and camera.
  ctx.fillStyle = '#2b1f40';
  const ew = Math.round(w * 0.22);
  const ey = y + Math.round((screen.y - y) / 2 - u / 2);
  ctx.fillRect(Math.round(x + w / 2 - ew / 2), ey, ew, u);
  ctx.fillRect(Math.round(x + w / 2 + ew / 2 + u * 2), ey, u, u);
  return screen;
}

/** A QR symbol from encodeQr, with its quiet zone, `m` pixels a module. */
export function qrCode(ctx, qr, x, y, m, quiet = 2) {
  const dim = (qr.size + quiet * 2) * m;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, dim, dim);
  ctx.fillStyle = '#120a1c';
  for (let j = 0; j < qr.size; j++) {
    for (let i = 0; i < qr.size; i++) {
      if (qr.get(i, j)) ctx.fillRect(x + (i + quiet) * m, y + (j + quiet) * m, m, m);
    }
  }
  return dim;
}

/** Four corner brackets: a camera looking for a code. */
export function brackets(ctx, x, y, w, h, len, th, color) {
  ctx.fillStyle = color;
  for (const [cx, sx] of [[x, 1], [x + w, -1]]) {
    for (const [cy, sy] of [[y, 1], [y + h, -1]]) {
      ctx.fillRect(sx > 0 ? cx : cx - len, sy > 0 ? cy : cy - th, len, th);
      ctx.fillRect(sx > 0 ? cx : cx - th, sy > 0 ? cy : cy - len, th, len);
    }
  }
}

/** A dark strip behind a line of copy, its edges stepped down in two bands. */
export function band(ctx, y, h, W, alpha = 0.72) {
  const e = Math.max(2, Math.round(h * 0.12));
  ctx.fillStyle = BG0;
  ctx.globalAlpha = alpha;
  ctx.fillRect(0, y, W, h);
  ctx.globalAlpha = alpha * 0.55;
  ctx.fillRect(0, y - e, W, e);
  ctx.fillRect(0, y + h, W, e);
  ctx.globalAlpha = alpha * 0.25;
  ctx.fillRect(0, y - e * 2, W, e);
  ctx.fillRect(0, y + h + e, W, e);
  ctx.globalAlpha = 1;
}

/** An arc stroked in square dots one u apart, so it keeps the pixel grain. */
export function pixelArc(ctx, cx, cy, r, a0, a1, u, color) {
  ctx.fillStyle = color;
  const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / u));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    ctx.fillRect(Math.round(cx + Math.cos(a) * r - u / 2), Math.round(cy + Math.sin(a) * r - u / 2), u, u);
  }
}

/** A cheap repeatable hash, 0..1, for star fields and streaks. */
export function hash(n) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/* ------------------------------------------------------------------ */
/* Sparks — screen-space, square, and gone in under a second           */

export class Sparks {
  constructor() { this.list = []; }

  clear() { this.list.length = 0; }

  burst(x, y, { count = 14, colors = ['#ffffff'], speed = 300, size = 4, life = 0.5, gravity = 600, dir = 0, spread = Math.PI * 2 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const s = speed * (0.35 + Math.random() * 0.8);
      this.list.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life * (0.6 + Math.random() * 0.7), age: 0,
        size: Math.max(1, Math.round(size * (0.6 + Math.random() * 0.8))),
        color: colors[(Math.random() * colors.length) | 0], gravity,
      });
    }
    if (this.list.length > 900) this.list.splice(0, this.list.length - 900);
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.age += dt;
      if (p.age >= p.life) { this.list.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    for (const p of this.list) {
      ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x - p.size / 2), Math.round(p.y - p.size / 2), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }
}
