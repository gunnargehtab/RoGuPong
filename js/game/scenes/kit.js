// RoGuPong — the scene painter's toolbox.
//
// Every stage is painted in "art pixels": the renderer hands a painter a small
// canvas (a phone gets roughly 195 × 420) and scales the result up with
// nearest-neighbour sampling, so every scene has the same chunky 16-bit grain
// no matter the screen. Painters therefore work in whole numbers and flat
// colours. Gradients are banded and dithered, never smooth — a smooth gradient
// upscaled 2–5× is the one thing that would give the game away as a canvas.

/** Seeded PRNG (mulberry32): the same seed paints the same street every time. */
export function mulberry(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/* ------------------------------------------------------------------ */
/* Colour                                                              */

function parse(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

/** Blend two #rrggbb colours; t = 0 gives a, t = 1 gives b. */
export function mix(a, b, t) {
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return toHex(lerp(r1, r2, t), lerp(g1, g2, t), lerp(b1, b2, t));
}

/** Darken (k < 0, toward black) or lighten (k > 0, toward white). */
export const shade = (c, k) => (k < 0 ? mix(c, '#000000', -k) : mix(c, '#ffffff', k));

/** '#rrggbb' + alpha → 'rgba(...)'. */
export function rgba(c, a) {
  const [r, g, b] = parse(c);
  return `rgba(${r},${g},${b},${a})`;
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */

/** A filled rectangle snapped to the art-pixel grid. */
export function rect(ctx, x, y, w, h, color) {
  if (color) ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

export const px = (ctx, x, y, color) => rect(ctx, x, y, 1, 1, color);

/** A 50% checkerboard of one colour over a rectangle — the 16-bit blend. */
export function checker(ctx, x, y, w, h, color, phase = 0) {
  ctx.fillStyle = color;
  x = Math.round(x); y = Math.round(y);
  for (let j = 0; j < Math.round(h); j++) {
    for (let i = (j + phase) & 1; i < Math.round(w); i += 2) ctx.fillRect(x + i, y + j, 1, 1);
  }
}

/**
 * A sparse ordered dither: roughly `density` (0..1) of the pixels in the
 * rectangle, laid out on a 4×4 Bayer grid so the texture reads as intentional.
 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function dither(ctx, x, y, w, h, color, density) {
  if (density <= 0) return;
  ctx.fillStyle = color;
  x = Math.round(x); y = Math.round(y);
  const cut = density * 16;
  for (let j = 0; j < Math.round(h); j++) {
    for (let i = 0; i < Math.round(w); i++) {
      if (BAYER[((y + j) & 3) * 4 + ((x + i) & 3)] < cut) ctx.fillRect(x + i, y + j, 1, 1);
    }
  }
}

/**
 * A vertical banded gradient: `stops` is a list of colours top to bottom.
 * Each step between two stops is split into `steps` flat bands, and every
 * band boundary gets a one-row checker seam so the banding looks deliberate.
 */
export function bands(ctx, x, y, w, h, stops, steps = 6) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const segs = stops.length - 1;
  const total = segs * steps;
  let prev = null;
  for (let k = 0; k < total; k++) {
    const seg = Math.floor(k / steps);
    const t = (k % steps) / steps;
    const color = mix(stops[seg], stops[seg + 1], t);
    const y0 = y + Math.round((k / total) * h);
    const y1 = y + Math.round(((k + 1) / total) * h);
    rect(ctx, x, y0, w, y1 - y0, color);
    if (prev && y1 - y0 > 2) checker(ctx, x, y0, w, 1, prev, k);
    prev = color;
  }
}

/** Horizontal version of bands(): colours left to right. */
export function hbands(ctx, x, y, w, h, stops, steps = 6) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const segs = stops.length - 1;
  const total = segs * steps;
  for (let k = 0; k < total; k++) {
    const seg = Math.floor(k / steps);
    const t = (k % steps) / steps;
    const x0 = x + Math.round((k / total) * w);
    const x1 = x + Math.round(((k + 1) / total) * w);
    rect(ctx, x0, y, x1 - x0, h, mix(stops[seg], stops[seg + 1], t));
  }
}

/** A filled polygon, points in art pixels. */
export function poly(ctx, pts, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fill();
}

/** A pixel disc (no anti-aliasing): rows of flat spans. */
export function disc(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  for (let j = -r; j <= r; j++) {
    const half = Math.round(Math.sqrt(Math.max(0, r * r - j * j)));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + j), half * 2 + 1, 1);
  }
}

/**
 * A soft light halo built from concentric dithered discs — how a street lamp
 * or a lit window glows without a single canvas shadow.
 */
export function halo(ctx, cx, cy, r, color) {
  for (let k = 3; k >= 1; k--) {
    const rr = Math.round((r * k) / 3);
    for (let j = -rr; j <= rr; j++) {
      const half = Math.round(Math.sqrt(Math.max(0, rr * rr - j * j)));
      dither(ctx, cx - half, cy + j, half * 2 + 1, 1, color, 0.14 + (3 - k) * 0.14);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Generators                                                          */

/**
 * A ridgeline by midpoint displacement: returns `w + 1` heights (0..1, where
 * 1 is the tallest point the caller allows). `rough` near 0.5 gives rolling
 * hills, near 0.7 gives Dolomite teeth.
 */
export function ridge(rand, w, rough = 0.55, jag = 1) {
  let n = 1;
  while (n < w) n *= 2;
  const hs = new Array(n + 1).fill(0);
  hs[0] = rand();
  hs[n] = rand();
  let amp = jag;
  for (let step = n; step > 1; step >>= 1) {
    for (let i = step >> 1; i < n; i += step) {
      hs[i] = (hs[i - (step >> 1)] + hs[i + (step >> 1)]) / 2 + (rand() - 0.5) * amp;
    }
    amp *= rough;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of hs) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return hs.slice(0, w + 1).map((v) => (v - lo) / (hi - lo || 1));
}

/**
 * A tiny standing person, 2 × 5 art pixels: head, body, legs. The core of
 * every crowd — at this scale three colours read as a human.
 */
export function person(ctx, x, y, body, skin = '#e8b894', legs = '#1c1a2a') {
  rect(ctx, x, y, 2, 1, skin);
  rect(ctx, x, y + 1, 2, 2, body);
  rect(ctx, x, y + 3, 1, 2, legs);
  rect(ctx, x + 1, y + 3, 1, 2, legs);
}

/**
 * Mirror the top half of the canvas onto the bottom half. Court floors must
 * read the same from both ends — each phone sees the court from its own goal —
 * so a floor painter can paint the top half and finish with this.
 */
export function mirrorY(ctx, w, h) {
  const half = Math.floor(h / 2);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.translate(0, h);
  ctx.scale(1, -1);
  ctx.drawImage(ctx.canvas, 0, 0, w, half, 0, 0, w, half);
  ctx.restore();
}
