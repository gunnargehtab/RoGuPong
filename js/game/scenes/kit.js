// RoGuPong — the scene painter's toolbox.
//
// Every stage is painted in "art pixels": the renderer hands a painter a canvas
// about min(W, H) / 180 times smaller than the screen (never less than 2×, so
// a phone's backdrop is roughly 220 × 450 including the shake margin) and scales
// the result up with nearest-neighbour sampling, so every scene has the same
// chunky 16-bit grain no matter the screen. Painters therefore work in whole
// numbers and flat colours. Gradients are banded and dithered, never smooth — a
// smooth gradient upscaled that far is the one thing that would give the game
// away as a canvas.
//
// Only what more than one scene shares lives here; each scene keeps its own
// stage-specific helpers.

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

/** A filled rectangle snapped to the art-pixel grid. */
export function rect(ctx, x, y, w, h, color) {
  if (color) ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
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
