// RoGuPong — ALPI SUNSET. The Brenta Dolomites from the Paganella on a winter
// evening: a sky burning from violet through magenta to gold behind a long saw
// of limestone towers, their snow lit pink by the last of the sun, lenticular
// clouds stacked like plates, a dark forested ridge below, and the summit
// snowfield — lavender, wind-scoured, ski-tracked — running down to a drift at
// your feet whose lee lies in blue shade.
//
// Nearly every pixel here is decided by a rule rather than a shape, so the
// backdrop is painted straight into a pixel buffer and put once. The sky and
// the snow are ramps quantised with an ordered dither. The range is a field of
// cones in three kinds — the massif's shoulders, the towers standing on its
// crest, the snowy aprons in front — and a pixel belongs to whichever cone it
// sits deepest inside. The right face of that cone catches the sun and the
// left falls into violet shade; where two cones of a kind meet is a gully (a
// snow couloir in the massif, a dark cleft between towers), so faces, divides
// and couloirs all fall out of one comparison per pixel. Ribs of rock fan down
// every snow face from its summit, as they streak the Brenta's walls.
//
// The court is the same snowfield from above, in the blue shade after sunset:
// sastrugi, a rose tint toward the sunset side, spruce crowns along both
// walls. The animation is the wind — spindrift off the summits and across the
// snow, wisps crossing the sky — and the alpenglow breathing on the towers.

import { mulberry, clamp } from './kit.js';

/* ------------------------------------------------------------------ */
/* Palette                                                             */

// Violet at the zenith down to gold on the horizon, one flat band per step.
const SKY = ['#1a1238', '#21164a', '#2c1a58', '#3a1e64', '#4c226c', '#622670',
  '#7c2a72', '#982e6e', '#b43866', '#cc445c', '#e05650', '#ee6e44', '#f7883c',
  '#fca23e', '#ffbc50'];
// Clouds by altitude: shaded top, body, lit belly, the sun-facing rim.
const CLOUD_HIGH = ['#4a2266', '#7e3280', '#c0508c', '#f27c8c'];
const CLOUD_MID = ['#7c2c6c', '#b44474', '#e8667a', '#ff9a80'];
const CLOUD_LOW = ['#b0405a', '#e06058', '#ff8e58', '#ffc070'];
// The range, warm at the summits and cooling toward the foot.
const LIT_SNOW = ['#ffc6c0', '#f7aebb', '#e69ebe', '#cc94c4', '#ae8ac2', '#9480ba'];
const SHD_SNOW = ['#a07ac0', '#8c70b6', '#7a68ac', '#6a60a2', '#5e5a98', '#54548e'];
const LIT_ROCK = ['#c86c7e', '#aa5c78', '#8e5072', '#76466a', '#643e62'];
const SHD_ROCK = ['#5c3c70', '#4e3466', '#422e5c', '#382852', '#30244a'];
const CLEFT = '#231b3a';
// The forested ridge in front, back to front.
const HILL = '#2b2150';
const HILL_DARK = '#231b44';
const HILL_SNOW = '#40397a';
const HILL_RIM = '#4a3466';
const FOREST = '#1b1634';
const SPRUCE = '#141029';
const SPRUCE_SNOW = ['#4c4a88', '#6e66a8', '#9c86c0'];
// The snowfield: blue shade to pink glow, dark to light.
const SNOW = ['#30347a', '#3a3e84', '#464890', '#52549c', '#6060a6', '#6e6cb0',
  '#7e78b8', '#9282bc', '#a68cbe', '#b896c0', '#c8a0c2'];
const JACKET = '#e0443c';

// The court floor, deep and quiet: a blue ramp and a rose one for the sunset side.
const C_BLUE = ['#16152f', '#1b1a38', '#211f42', '#27244b', '#2e2a55', '#36315f', '#3f3869'];
const C_ROSE = ['#1b1530', '#221839', '#2a1c43', '#32214c', '#3a2555', '#432a5e', '#4d3067'];
const C_PINE = ['#08121c', '#0f1f29', '#173035', '#213e3f'];
const C_PINE_SNOW = ['#444a80', '#5a5c96', '#7a6496'];

/* ------------------------------------------------------------------ */
/* Pixel buffer                                                        */

const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const WORDS = new Map();

/**
 * '#rrggbb' → the opaque 32-bit word ImageData wants on this machine. Kept
 * signed: with alpha in the top byte that is a small negative integer, which
 * the engine can pass around without boxing — it matters on a first paint.
 */
function word(hex) {
  let v = WORDS.get(hex);
  if (v === undefined) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    v = LITTLE ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255;
    WORDS.set(hex, v);
  }
  return v;
}
const ramp = (list) => Int32Array.from(list, word);

const R_SKY = ramp(SKY);
const R_LIT_SNOW = ramp(LIT_SNOW);
const R_SHD_SNOW = ramp(SHD_SNOW);
const R_LIT_ROCK = ramp(LIT_ROCK);
const R_SHD_ROCK = ramp(SHD_ROCK);
const R_SNOW = ramp(SNOW);
const R_C_BLUE = ramp(C_BLUE);
const R_C_ROSE = ramp(C_ROSE);
const R_C_PINE = ramp(C_PINE);
const R_C_PINE_SNOW = ramp(C_PINE_SNOW);

function buffer(ctx, w, h) {
  const img = ctx.createImageData(w, h);
  return { w, h, img, d: new Int32Array(img.data.buffer), ctx };
}
const put = (B) => B.ctx.putImageData(B.img, 0, 0);

function plot(B, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x >= 0 && y >= 0 && x < B.w && y < B.h) B.d[y * B.w + x] = c;
}
function span(B, x0, x1, y, c) {
  y = Math.round(y);
  if (y < 0 || y >= B.h) return;
  const a = Math.max(0, Math.round(x0));
  const b = Math.min(B.w - 1, Math.round(x1));
  for (let x = a; x <= b; x++) B.d[y * B.w + x] = c;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bay = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/**
 * A continuous ramp position → one ramp colour: mostly flat bands, with an
 * ordered-dither seam over the last `seam` of each step, which is how a
 * 16-bit painter would blend two palette entries.
 */
function tone(r, v, x, y, seam) {
  let i = Math.floor(v);
  const f = v - i;
  if (f > 1 - seam && (BAYER[((y & 3) << 2) | (x & 3)] + 0.5) / 16 < (f - 1 + seam) / seam) i++;
  return r[i < 0 ? 0 : i >= r.length ? r.length - 1 : i];
}

/* ------------------------------------------------------------------ */
/* Noise: integer hashes, never Math.random                            */

function hash(ix, iy, seed) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function noise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/**
 * noise() sampled over a whole block of rows at once — identical values, but
 * the lattice is hashed once instead of four times per pixel, which is most of
 * the cost of a first paint before the engine has warmed up.
 */
function noiseGrid(w, rows, fx, fy, seed, y0 = 0) {
  const out = new Float32Array(w * rows);
  const gx0 = 0, gy0 = Math.floor(y0 * fy);
  const gw = Math.ceil(w * fx) + 2, gh = Math.ceil((y0 + rows) * fy) - gy0 + 2;
  const L = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) L[j * gw + i] = hash(gx0 + i, gy0 + j, seed);
  for (let r = 0; r < rows; r++) {
    const py = (y0 + r) * fy, iy = Math.floor(py), ty = py - iy, sy = ty * ty * (3 - 2 * ty);
    const row = (iy - gy0) * gw;
    for (let x = 0; x < w; x++) {
      const px = x * fx, ix = Math.floor(px), tx = px - ix, sx = tx * tx * (3 - 2 * tx);
      const a = L[row + ix], b = L[row + ix + 1], c = L[row + gw + ix], d = L[row + gw + ix + 1];
      out[r * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

/** 1-D value noise tabulated over `n` steps of `f` from `t0`: one hash per lattice point. */
function noiseLine(n, t0, f, seed) {
  const out = new Float32Array(n);
  const k0 = Math.floor(t0 * f);
  const L = new Float32Array(Math.ceil((t0 + n) * f) - k0 + 2);
  for (let i = 0; i < L.length; i++) L[i] = hash(k0 + i, 0, seed);
  for (let j = 0; j < n; j++) {
    const t = (t0 + j) * f, k = Math.floor(t), u = t - k, su = u * u * (3 - 2 * u);
    out[j] = L[k - k0] + (L[k - k0 + 1] - L[k - k0]) * su;
  }
  return out;
}

const wrap = (v, p) => ((v % p) + p) % p;

// A sine table: the snowfield's ripples want two sines a pixel.
const SIN = Float32Array.from({ length: 1024 }, (_, i) => Math.sin((i / 1024) * Math.PI * 2));
const fsin = (a) => SIN[((a * 162.974661) | 0) & 1023];

/* ------------------------------------------------------------------ */
/* Layout and the range model                                          */

// Everything the painters and the animation share for one canvas size.
const MODELS = new Map();

let lastModel = null;

function model(w, h) {
  if (lastModel && lastModel.w === w && lastModel.h === h) return lastModel;
  const key = `${w}x${h}`;
  let m = MODELS.get(key);
  if (m) return (lastModel = m);
  if (MODELS.size > 8) MODELS.clear();

  // The range is scaled by whichever is tighter, so portrait phones get
  // towers, not needles, and landscape gets the long ridgeline.
  const MS = Math.min(h * 0.29, w * 0.5);
  const yH = Math.round(h * 0.585);     // foot of the range, behind the forest
  const yS = Math.round(h * 0.645);     // brow of the summit snowfield
  const sunX = w * 0.6;
  const yG = yH - MS * 0.45;             // where the sky has turned gold
  m = { w, h, MS, yH, yS, yG, sunX, cones: cones(w, MS, yH), shimmer: [] };
  m.ridge = ridgeBase(m);
  m.top = Math.min(...m.cones.map((c) => c.y));
  m.anim = animBackdrop(m);
  MODELS.set(key, m);
  return (lastModel = m);
}

/** Where the range stands tallest: the towers crowd toward the sun. */
const envelope = (u) => clamp(0.4 + 0.6 * Math.exp(-(((u - 0.6) / 0.2) ** 2))
  + 0.3 * Math.exp(-(((u - 0.2) / 0.1) ** 2)), 0, 1);

/**
 * The cones, in two layers. Behind: steep shoulders make the massif and its
 * crest, groups of towers stand on that crest (tallest mid-group) and a
 * scatter of little teeth saws the rest of the skyline. In front: broad snowy
 * aprons, the slopes the walls shed their snow onto.
 */
function cones(w, MS, yH) {
  const rand = mulberry(0x5a1d0);
  const list = [];
  const nM = Math.max(5, Math.round(w / 28));
  for (let i = -1; i <= nM; i++) {
    const x = ((i + 0.5 + (rand() - 0.5) * 0.8) / nM) * w;
    const e = envelope(clamp(x / w, 0, 1));
    list.push({ x, y: yH - MS * (0.5 + 0.2 * e + rand() * 0.08), s: 0.9 + rand() * 0.9, fl: 0,
      tw: 0, wob: 2, tower: false, front: false, seed: 101 + i });
  }
  const crest = (x) => {
    let y = 1e9;
    for (const c of list) y = Math.min(y, c.y + Math.abs(x - c.x) / c.s);
    return y;
  };
  const nG = Math.max(4, Math.round(w / 38));
  for (let g = 0; g < nG; g++) {
    const gx = ((g + 0.5 + (rand() - 0.5) * 0.5) / nG) * w;
    const e = envelope(clamp(gx / w, 0, 1));
    const gw = (0.45 + rand() * 0.45) * (w / nG);
    const n = 3 + Math.floor(rand() * 5);
    for (let t = 0; t < n; t++) {
      const pos = t / (n - 1) - 0.5;
      const x = gx + pos * gw + (rand() - 0.5) * 3;
      const r1 = rand(), r2 = rand(), r3 = rand();
      const rise = MS * (0.05 + 0.4 * e * (1 - Math.abs(pos) * 0.9) * (0.4 + 0.6 * r1));
      // Sheer walls that flare out into their own scree lower down: the
      // taller the tower, the sheerer the top.
      list.push({ x, y: crest(x) - rise, s: 0.06 + r2 * (0.24 - 0.14 * Math.min(1, rise / (MS * 0.3))),
        fl: (0.001 + rand() * 0.003) * (90 / MS), tw: r3 < 0.5 ? 1.2 + r3 * 5 : 0.8 + (r3 - 0.5) * 1.2, wob: 0.7,
        tower: true, front: false, seed: 501 + g * 16 + t });
    }
  }
  for (let x = 0; x < w; x += 2 + rand() * 4) {
    const r1 = rand(), r2 = rand();
    list.push({ x, y: crest(x) - (1 + r1 * 3.5), s: 0.35 + r2 * 0.5, fl: 0, tw: r2 * 0.8, wob: 0.4,
      tower: true, front: false, seed: 901 + Math.round(x) });
  }
  const nA = Math.max(4, Math.round(w / 30));
  for (let i = -1; i <= nA; i++) {
    const x = ((i + 0.5 + (rand() - 0.5) * 0.9) / nA) * w;
    const e = envelope(clamp(x / w, 0, 1));
    list.push({ x, y: yH - MS * (0.18 + 0.22 * rand() + 0.12 * e), s: 1.6 + rand() * 1.4, fl: 0,
      tw: 0, wob: 3, tower: false, front: true, seed: 301 + i });
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* Backdrop painters                                                   */

function paintSky(B, m) {
  const { w, h, yH, sunX } = m;
  const n = SKY.length - 1;
  const glow = new Float32Array(w);
  for (let x = 0; x < w; x++) glow[x] = Math.exp(-(((x - sunX) / (w * 0.38)) ** 2));
  // Gold arrives where it can still be seen: between the towers, not at the
  // foot of the range behind the forest.
  const yG = m.yG;
  const rows = Math.min(h, yH + 4);
  const d = B.d;
  for (let y = 0; y < rows; y++) {
    const t = clamp(y / yG, 0, 1);
    const lift = 0.2 * t * t * t, by = (y & 3) * 4;
    for (let x = 0; x < w; x++) {
      // The sun just under the ridge pulls the warm bands up into a dome.
      // (tone() inlined: this is the biggest single fill in the scene.)
      const v = (t + glow[x] * lift) * n;
      let i = v | 0;
      const f = v - i;
      if (f > 0.6 && (BAYER[by + (x & 3)] + 0.5) / 16 < (f - 0.6) / 0.4) i++;
      d[y * w + x] = R_SKY[i > n ? n : i];
    }
  }
}

function cloudPalette(m, y) {
  const t = y / m.yG;
  return t < 0.26 ? CLOUD_HIGH : t < 0.52 ? CLOUD_MID : CLOUD_LOW;
}

/**
 * One lenticular plate: a domed top over a flat belly, shaded above and lit
 * underneath, with ragged ends and a few brighter streaks through the body.
 */
function lens(B, m, cx, cy, len, th, seed) {
  const hex = cloudPalette(m, cy + th);
  const pal = hex.map(word);
  const y0 = Math.round(cy);
  for (let r = 0; r < th; r++) {
    const u = (r + 1) / th;                             // just above 0 at the top, 1 at the belly
    const half = (len / 2) * Math.sqrt(1 - (1 - u) * (1 - u) * 0.96);
    const x0 = cx - half + (hash(r, 0, seed) - 0.5) * 4;
    const x1 = cx + half + (hash(r, 1, seed) - 0.5) * 4;
    const c = r === 0 ? pal[0] : u <= 0.5 ? pal[1] : pal[2];
    span(B, x0, x1, y0 + r, c);
    // Streaks: the wind combs each plate into strands.
    if (r > 0 && r < th - 1) {
      for (let k = 0; k < 3; k++) {
        if (hash(r, k + 2, seed) < 0.45) continue;
        const a = x0 + hash(r, k + 5, seed) * (x1 - x0) * 0.8;
        const b = a + (0.08 + hash(r, k + 8, seed) * 0.25) * len;
        span(B, a, Math.min(b, x1 - 2), y0 + r, u <= 0.5 ? pal[2] : pal[1]);
      }
    }
  }
  // The belly catches the sun where it faces it.
  const by = y0 + th;
  const bx0 = cx - len * 0.4, bx1 = cx + len * 0.4;
  span(B, bx0, bx1, by, pal[2]);
  const toward = clamp((m.sunX - cx) / len, -0.3, 0.3) * len;
  span(B, cx + toward - len * 0.22, cx + toward + len * 0.22, by, pal[3]);
  // Wisps trailing downwind off the tips.
  const tail = len * (0.1 + hash(1, 2, seed) * 0.16);
  span(B, cx + len / 2 - 2, cx + len / 2 + tail, y0 + th - 1, pal[1]);
  span(B, cx - len / 2 - tail * 0.5, cx - len / 2 + 2, by - 2, pal[1]);
}

// Clouds as fractions: centre x, belly y, length (of w), plates in the stack.
const CLOUDS = [
  [0.30, 0.080, 0.62, 2],
  [0.82, 0.046, 0.40, 1],
  [0.74, 0.128, 0.30, 1],
  [0.58, 0.195, 0.55, 3],
  [0.16, 0.240, 0.38, 2],
  [0.88, 0.268, 0.28, 1],
  [0.38, 0.305, 0.22, 1],
];
// Loose cirrus strands: x, y, length.
const STRANDS = [
  [0.08, 0.030, 0.20], [0.55, 0.020, 0.25], [0.62, 0.100, 0.18], [0.05, 0.150, 0.16],
  [0.90, 0.170, 0.14], [0.30, 0.205, 0.12], [0.70, 0.290, 0.16],
];

function paintClouds(B, m) {
  const { w, h } = m;
  for (const [fx, fy, fl] of STRANDS) {
    const y = Math.round(fy * h);
    const pal = cloudPalette(m, y);
    span(B, fx * w, (fx + fl) * w, y, word(pal[1]));
    span(B, (fx + fl * 0.3) * w, (fx + fl * 0.7) * w, y, word(pal[2]));
  }
  // Sized off the shorter side, so a landscape sky gets lenses, not threads.
  const unit = Math.min(w, h * 1.15);
  CLOUDS.forEach(([fx, fy, fl, stack], i) => {
    const len = fl * unit;
    const th = clamp(Math.round(len * 0.075), 3, 14);
    // Stacked plates: each one higher is shorter, thinner and nudged downwind.
    const plates = [];
    let top = fy * h - th;
    for (let k = 0; k < stack; k++) {
      const t = Math.max(2, th - k * 2);
      if (k > 0) top -= t + 2;
      plates.push([fx * w + k * len * 0.07, top, len * (1 - k * 0.25), t]);
    }
    const drop = Math.max(0, 2 - top);                 // keep the top plate on the canvas
    plates.forEach(([x, y, l, t], k) => lens(B, m, x, y + drop, l, t, 700 + i * 13 + k));
  });
}

/**
 * The upper envelope of one layer of cones along a row. Every cone's depth
 * F = core(y) − |x − spur| has slope ±1 across x, so the best cone at each x
 * falls out of seeding the spurs and two sweeps — no pixel weighs every cone.
 */
function envelopeRow(list, layer, spur, rows, j, y, val, own) {
  const w = val.length;
  val.fill(-1e9);
  own.fill(-1);
  for (const i of layer) {
    const c = list[i];
    if (y < c.y - 2) continue;
    const sx = spur[i * rows + j];
    const d = y - c.y;
    const core = d * c.s + d * d * c.fl + c.tw;
    for (let x = Math.floor(sx), k = 0; k < 2; k++, x++) {
      const xi = x < 0 ? 0 : x >= w ? w - 1 : x;
      const v = core - Math.abs(xi - sx);
      if (v > val[xi]) { val[xi] = v; own[xi] = i; }
    }
  }
  for (let x = 1; x < w; x++) if (val[x - 1] - 1 > val[x]) { val[x] = val[x - 1] - 1; own[x] = own[x - 1]; }
  for (let x = w - 2; x >= 0; x--) if (val[x + 1] - 1 > val[x]) { val[x] = val[x + 1] - 1; own[x] = own[x + 1]; }
}

/** The Dolomites: the cone field, shaded per pixel. Records shimmer runs. */
function paintRange(B, m) {
  const { w, yH, cones: list } = m;
  const y0 = Math.max(0, Math.floor(m.top) - 1);
  const y1 = Math.min(B.h - 1, yH + 2);
  const rows = y1 - y0 + 1;
  // Each cone's spur (its crest line) wanders a little; tabulate it per row.
  const spur = new Float32Array(list.length * rows);
  list.forEach((c, i) => {
    const wander = noiseLine(rows, y0, 0.11, c.seed);
    for (let j = 0; j < rows; j++) spur[i * rows + j] = c.x + c.wob * (wander[j] - 0.5) * 2;
  });
  const towers = [], walls = [], aprons = [];
  list.forEach((c, i) => (c.front ? aprons : c.tower ? towers : walls).push(i));
  // A rib of rock runs down some stretches of each apron's spur.
  const ribW = new Float32Array(list.length * rows);
  for (const i of aprons) {
    const on = noiseLine(rows, y0, 0.07, list[i].seed + 2);
    const width = noiseLine(rows, y0, 0.13, list[i].seed + 1);
    for (let j = 0; j < rows; j++) ribW[i * rows + j] = on[j] > 0.5 ? 0.4 + 1.1 * width[j] : -1;
  }
  // Ribs of rock fan down every snow face from its summit with couloirs of
  // snow between them — what turns a folded-paper cone into a mountainside.
  // Their spacing grows with the root of the depth below the summit, so they
  // splay outward as they fall, 7–12 px apart where the face meets the forest.
  const ribK = new Float32Array(list.length), ribO = new Float32Array(list.length);
  list.forEach((c, i) => {
    ribK[i] = (7 + hash(i, 1, 91) * 5) / Math.sqrt(Math.max(4, yH - c.y));
    ribO[i] = hash(i, 2, 91);
  });
  // Towers get a ragged per-column edge; it notches their tops.
  const jag = new Float32Array(w);
  for (let x = 0; x < w; x++) jag[x] = (hash(x, 7, 3) - 0.5) * 1.2;
  const kind = Int8Array.from(list, (c) => (c.front ? 2 : c.tower ? 1 : 0));
  // The bedding planes are hashed once per plane, not once per pixel.
  const nb = rows + Math.ceil(w * 0.07) + 2;
  const bandH = new Float32Array(nb), bandS = new Float32Array(nb), bandR = new Uint8Array(nb);
  for (let k = 0; k < nb; k++) {
    bandH[k] = hash(y0 + k, 21, 11); bandS[k] = hash(y0 + k, 2, 5) * 9; bandR[k] = hash(y0 + k, 9, 11) < 0.2 ? 1 : 0;
  }
  // Nothing below the forested ridge's skyline is ever seen.
  const hidden = m.ridge;
  let memoC = -1, memoR = 0, memoL = 0, memoS = 0;
  let ribC = -1, ribY = 0, ribSp = 0, ribMax = 0;
  const vT = new Float32Array(w), oT = new Int16Array(w);
  const vW = new Float32Array(w), oW = new Int16Array(w);
  const vA = new Float32Array(w), oA = new Int16Array(w);
  const own = new Int16Array(w);
  const span01 = yH - m.top;
  const nl = LIT_SNOW.length - 1, nr = LIT_ROCK.length - 1;
  const cleft = word(CLEFT);
  // The first unbroken run of sunlit face in each column, top down: where the
  // alpenglow will breathe. On the Dolomites it is the rock itself that turns
  // pink at sunset — the enrosadira.
  const glowY = new Int16Array(w).fill(-1), glowN = new Int16Array(w), glowEnd = new Uint8Array(w);

  for (let y = y0; y <= y1; y++) {
    const j = y - y0;
    envelopeRow(list, towers, spur, rows, j, y, vT, oT);
    envelopeRow(list, walls, spur, rows, j, y, vW, oW);
    envelopeRow(list, aprons, spur, rows, j, y, vA, oA);
    // The front layer wins wherever it stands. Behind it, towers stand on the
    // massif: they own the sky above its crest and a pixel or two into it.
    for (let x = 0; x < w; x++) {
      const t = vT[x] + jag[x];
      own[x] = vA[x] >= 0 ? oA[x] : t >= 0 && vW[x] < 1.5 ? oT[x] : vW[x] >= 0 ? oW[x] : -1;
    }
    const v = clamp((y - m.top) / span01, 0, 1);
    for (let x = 0; x < w; x++) {
      const bi = own[x];
      if (bi < 0) { if (glowN[x]) glowEnd[x] = 1; continue; }
      if (y > hidden[x] + 1) continue;
      const c = list[bi], kb = kind[bi];
      // Where ownership changes between neighbours of the same kind: a gully.
      const l = x > 0 ? own[x - 1] : bi, r = x < w - 1 ? own[x + 1] : bi;
      const seam = (l !== bi && l >= 0 && kind[l] === kb) || (r !== bi && r >= 0 && kind[r] === kb);
      const dx = x - spur[bi * rows + j];
      // Bedding planes dip gently and run across the whole range.
      const row = y + Math.floor(x * 0.07), rk = row - y0;
      let lit, col;
      if (c.tower) {
        lit = dx > c.tw * 0.3;
        const surf = c.y + Math.max(0, Math.abs(dx) - c.tw) / c.s;
        const cap = c.tw > 2 && Math.abs(dx) <= c.tw + 0.6 && y - surf < 0.5 + hash(x, 3, c.seed) * 1.2;
        // Snow ledges: each tower keeps its own, so they never line up into a
        // grid. A tower's pixels in a row are neighbours: hash its row once.
        if (bi !== memoC || row !== memoR) { memoC = bi; memoR = row; memoL = hash(row, 5, c.seed); memoS = hash(row, 1, c.seed) * 7; }
        const ledge = memoL < (lit ? 0.2 : 0.12) && hash(Math.floor((x + memoS) / 3), row, c.seed) > 0.45;
        const snow = cap || ledge;
        if (!snow && seam) col = cleft;
        else if (snow) col = tone(lit ? R_LIT_SNOW : R_SHD_SNOW, v * nl + (cap ? 0 : 1.3), x, y, 0.45);
        else col = tone(lit ? R_LIT_ROCK : R_SHD_ROCK, v * nr + (bandR[rk] ? 1.2 : 0), x, y, 0.45);
      } else {
        lit = dx > 0;
        // Which fan rib this pixel is nearest, and how far off it in pixels.
        // Ribs start once they are 3 px apart, and each breaks into
        // buttresses along its own length. Spacing is per cone and row.
        if (bi !== ribC || y !== ribY) {
          ribC = bi; ribY = y;
          const d = y - c.y;
          ribSp = ribK[bi] * Math.sqrt(d > 0 ? d : 0);
          ribMax = ribSp > 2.6 ? Math.min(ribSp * 0.3, 1.75) * (kb === 2 ? 0.7 : 1) : 0;
        }
        let ribSide = 0;
        if (ribMax > 0 && !seam) {
          const q = dx / ribSp + ribO[bi], n = Math.floor(q + 0.5), dd = Math.abs(q - n) * ribSp;
          if (dd < ribMax) {
            // The aprons in front are mostly snow: fewer, finer ribs.
            const hn = hash(n, 3, c.seed);
            const wR = Math.min(ribSp * 0.3, 0.45 + hn * 1.3) * (kb === 2 ? 0.7 : 1);
            if (hn > (kb === 2 ? 0.5 : 0.22) && dd < wR
              && hash(n, Math.floor((y - c.y + hn * 11) / (4 + hn * 7)), c.seed) > 0.3) ribSide = q < n ? 1 : 2;
          }
        }
        if (!c.front) {
          // The walls under the crest: snow plastered on rock, dark bands
          // between, and bare rock in the steep headwall under the towers.
          const head = vW[x] < 5 * c.s ? 0.22 : 0;
          const band = seam ? 1 : bandH[rk];
          const broken = band < 0.36 ? hash(Math.floor((x + bandS[rk]) / 3.3), row, 5) : 0;
          if (ribSide || (band < 0.14 + head && broken > 0.45 - head)) {
            col = tone(lit && ribSide !== 1 ? R_LIT_ROCK : R_SHD_ROCK, v * nr + 0.4, x, y, 0.45);
          } else {
            // Thinner snow over rock: a step darker, in broken bands.
            const thin = band < 0.34 && broken > 0.5 ? 1.6 : 0;
            col = tone(lit ? R_LIT_SNOW : R_SHD_SNOW, v * nl + thin + (seam ? 0.7 : 0), x, y, 0.45);
          }
        } else {
          // The aprons: long snow slopes, a rib of rock down the odd spur.
          const rib = Math.abs(dx) < ribW[bi * rows + j];
          if (!seam && (rib || ribSide)) {
            col = tone(lit && ribSide !== 1 ? R_LIT_ROCK : R_SHD_ROCK, v * nr + 0.6, x, y, 0.45);
          } else {
            col = tone(lit ? R_LIT_SNOW : R_SHD_SNOW, v * nl + (seam ? 0.8 : 0), x, y, 0.45);
          }
        }
      }
      B.d[y * w + x] = col;
      if (!glowEnd[x]) {
        if (lit && v < 0.4) { if (!glowN[x]) glowY[x] = y; glowN[x]++; }
        else if (glowN[x]) glowEnd[x] = 1;
      }
    }
  }
  // Keep the longest: the animation budget is small.
  const glow = [];
  for (let x = 0; x < w; x++) if (glowN[x] >= 2) glow.push({ x, y: glowY[x], len: glowN[x] });
  m.shimmer = glow.sort((a, b) => b.len - a.len).slice(0, 80);
}

/**
 * The forested ridge in front: a dark silhouette that rises to a rounded
 * shoulder on the left, furred with spruce tips, snowy clearings showing
 * through its upper slopes.
 */
/** The forested ridge's skyline under its spruce tips: high on the left, low on the right. */
function ridgeBase(m) {
  const { w, yH, MS } = m;
  const base = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    base[x] = yH - MS * 0.06 - MS * 0.26 * Math.exp(-(((u - 0.06) / 0.26) ** 2))
      - MS * 0.07 * Math.exp(-(((u - 0.86) / 0.14) ** 2)) - MS * 0.05 * (noise(x * 0.04, 0.5, 41) - 0.5);
  }
  return base;
}

function paintRidge(B, m) {
  const { w, h, yS } = m;
  const rand = mulberry(0x77a);
  const base = m.ridge;
  // Spruce tips along the skyline: a crowd of little triangles.
  const crest = Float32Array.from(base);
  for (let x = -3; x < w + 3; x += 1 + rand() * 2.2) {
    const tx = Math.round(x);
    const tip = 1.5 + rand() * 3;
    const b = base[clamp(tx, 0, w - 1)];
    for (let dx = -3; dx <= 3; dx++) {
      const cx = tx + dx;
      if (cx >= 0 && cx < w) crest[cx] = Math.min(crest[cx], b - tip + Math.abs(dx) * 1.7);
    }
  }
  const hill = word(HILL), dark = word(HILL_DARK), snowy = word(HILL_SNOW), rim = word(HILL_RIM);
  const forest = word(FOREST);
  const bottom = Math.min(h - 1, yS + 6);           // the snowfield's brow wanders
  // Where the slope is snow-dusted rather than dense forest.
  let gy0 = h;
  for (let x = 0; x < w; x++) gy0 = Math.min(gy0, Math.floor(crest[x]));
  gy0 = Math.max(0, gy0);
  const grows = Math.max(1, Math.min(h - 1, yS + 3) - gy0 + 1);
  const g1 = noiseGrid(w, grows, 0.06, 0.12, 29, gy0);
  const g2 = noiseGrid(w, grows, 0.126, 0.252, 36, gy0);
  const clearing = (x, y) => {
    const i = (y - gy0) * w + x;
    return g1[i] * 0.66 + g2[i] * 0.34 + Math.max(0, 0.3 - x / w) * 0.5 - (y - base[x]) * 0.012;
  };
  for (let x = 0; x < w; x++) {
    const top = Math.round(crest[x]);
    const facing = crest[Math.min(w - 1, x + 1)] > crest[Math.max(0, x - 1)];
    // The lower slopes darken into the forest that meets the snowfield.
    const fy = base[x] + (yS - base[x]) * 0.55 + (noise(x * 0.07, 3.5, 43) - 0.5) * 3;
    for (let y = Math.max(0, top); y <= bottom; y++) {
      let c = y > fy ? forest : hill;
      if (y > top + 1 && y <= fy && clearing(x, y) > 0.6) c = snowy;
      if (y === top && facing) c = rim;
      B.d[y * w + x] = c;
    }
  }
  // Little spruces in rows over the slope: dark on the hill, lit tips on the
  // sun side, thinning out into the clearings.
  for (let y = 0; y < bottom; y += 3) {
    for (let x = (y * 7) % 3; x < w; x += 2 + ((x * 13 + y) % 3)) {
      const yy = y + ((x * 5) % 3);
      if (yy < base[x] + 2 || yy + 2 > bottom) continue;
      const inClearing = clearing(x, yy) > 0.6;
      if (inClearing && hash(x, yy, 47) < 0.7) continue;
      const shadeC = yy > base[x] + (yS - base[x]) * 0.55 ? forest : dark;
      plot(B, x, yy, shadeC);
      span(B, x - 1, x + 1, yy + 1, shadeC);
      span(B, x - 1, x + 1, yy + 2, shadeC);
      if (inClearing || hash(x, yy, 53) < 0.15) plot(B, x + 1, yy + 1, rim);
    }
  }
}

/** A spruce with snow on its tiers, standing with its foot at (x, y). */
function spruce(B, x, y, ht, seed) {
  const body = word(SPRUCE);
  const [s0, s1, s2] = SPRUCE_SNOW.map(word);
  const tier = ht > 9 ? 3 : 2;
  for (let j = 0; j < ht; j++) {
    const yy = y - ht + j;                        // j = 0 is the tip
    // Each tier flares out, then steps back in: the spruce zig-zag.
    const k = (j + tier - 1) % tier;
    const half = Math.round(Math.min(j, ht - 2) * 0.34 * (0.55 + (0.45 * k) / (tier - 1)));
    span(B, x - half, x + half, yy, body);
    // Snow lies on the tip of each tier: pink on the sun side, blue in shade.
    if (k === tier - 1 && half > 0 && hash(j, seed, 7) < 0.75) {
      plot(B, x + half, yy, half > 1 ? s2 : s1);
      if (half > 1 && hash(j, seed, 3) < 0.5) plot(B, x - half, yy, s0);
      if (half > 2 && hash(j, seed, 5) < 0.5) plot(B, x + half - 1, yy - 1, s1);
    }
  }
  plot(B, x, y, body);
}

/** The summit snowfield: drifts, sastrugi, ski tracks, a far skier. */
function paintSnowfield(B, m) {
  const { w, h, yS } = m;
  const brow = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    // The summit rises gently to the left, dips away to the right.
    brow[x] = yS + (noise(x * 0.03, 8.5, 61) - 0.5) * 4
      - h * 0.025 * Math.pow(clamp(1 - u / 0.5, 0, 1), 2) + u * u * 2;
  }
  let yTop = h;
  for (let x = 0; x < w; x++) yTop = Math.min(yTop, Math.floor(brow[x]));
  const H = h - yS;
  const rowsS = h - yTop;
  const V = new Float32Array(w * rowsS);
  const broad = noiseGrid(w, rowsS, 0.03, 0.06, 71, yTop);
  const combed = noiseGrid(w, rowsS, 0.14, 0.35, 73, yTop);
  for (let y = yTop; y < h; y++) {
    const p = clamp((y - yS) / H, 0, 1);
    const base = 8.3 - 6 * Math.pow(p, 0.8);
    const g = (y - yTop) * w;
    // Sastrugi: short wavy ridges, finer in the distance.
    const freq = 2 / (0.6 + p * 3.2);
    const bend = 0.2 - p * 0.12;
    for (let x = 0; x < w; x++) {
      let v = base + (broad[g + x] - 0.5) * 1.2;
      const r = fsin((y + 1.8 * fsin(x * bend + y * 0.3)) * freq);
      if ((r > 0.9 || r < -0.93) && combed[g + x] > 0.52) v += r > 0 ? 0.9 : -0.8;
      V[g + x] = v;
    }
  }

  // Drift crests, spaced wider as they come toward you, each one only
  // running part of the way across.
  for (let k = 0; k < 5; k++) {
    const p = Math.pow((k + 0.6) / 5, 1.45);
    const amp = 1 + p * 6, f = 0.02 + hash(k, 1, 63) * 0.03, ph = hash(k, 2, 63) * 6.28;
    const up = 2 + p * 12, down = 1 + p * 7;
    // Each brightens its windward rise, lights its crest and throws a blue
    // shadow down its lee — only the rows near the crest are touched.
    for (let x = 0; x < w; x++) {
      const on = clamp((noise(x * 0.025, k * 5.3, 69) - 0.3) * 3, 0, 1);
      if (on === 0) continue;
      const cy = yS + p * H + amp * Math.sin(x * f + ph) + (noise(x * 0.05, k * 3.1, 67) - 0.5) * amp;
      const ya = Math.max(yTop, Math.ceil(cy - up)), yb = Math.min(h - 1, Math.floor(cy + down));
      for (let y = ya; y <= yb; y++) {
        const dy = y - cy;
        const i = (y - yTop) * w + x;
        if (dy < 0) V[i] += 1.1 * on * (1 + dy / up);
        else if (dy < 1) V[i] += 1.4 * on;
        else V[i] -= 1.5 * on * (1 - dy / down);
      }
    }
  }

  // Ski tracks: two grooves curving up from the foreground to the brow.
  const trackX = (s) => w * (0.4 + 0.2 * s + 0.07 * Math.sin(s * 4.2 + 0.4));
  const steps = Math.round(H * 5);
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;                 // 0 near .. 1 far
    const y = h + 2 - (h + 2 - (yS + 4)) * Math.pow(s, 0.85);
    const gap = 0.7 + 3.4 * (1 - s);
    for (let side = -1; side <= 1; side += 2) {
      const x = Math.round(trackX(s) + side * gap);
      const yy = Math.round(y);
      if (x < 0 || x >= w - 1 || yy < yTop || yy >= h || yy < brow[x]) continue;
      V[(yy - yTop) * w + x] -= 1.7;
      V[(yy - yTop) * w + x + 1] += 0.6;
    }
  }

  // One long drift right in front of you: a lit crest, then its lee in blue
  // shade all the way down — which is also what keeps the scores readable.
  const lee = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const u = x / w;
    lee[x] = h * (0.805 + 0.025 * Math.sin(u * 4.1 + 0.6) - 0.015 * u) + (noise(x * 0.06, 2.5, 87) - 0.5) * 3;
  }
  const leeK = 0.9 / (h * 0.12);

  const n = SNOW.length - 1, out = B.d;
  for (let y = yTop; y < h; y++) {
    const g = (y - yTop) * w;
    for (let x = 0; x < w; x++) {
      if (y < brow[x]) continue;
      let v = V[g + x];
      const dy = y - lee[x];
      if (dy > -8) v += dy < 0 ? 0.9 * (1 + dy / 8) : dy < 1 ? 1.6 : dy < 3 ? -2.6 : Math.min(-1.7, -2.6 + (dy - 3) * leeK);
      out[y * w + x] = tone(R_SNOW, v < 0 ? 0 : v > n ? n : v, x, y, 0.5);
    }
  }
  // The brow of the snowfield holds the last of the sky's light.
  for (let x = 0; x < w; x++) plot(B, x, Math.ceil(brow[x]), word(SNOW[n - (hash(x, 3, 81) < 0.3 ? 1 : 0)]));
  // Sparkle: a few crystals catching the glow on the far slope.
  for (let i = 0; i < w * 0.3; i++) {
    const x = Math.floor(hash(i, 1, 79) * w);
    const y = Math.floor(yS + Math.pow(hash(i, 2, 79), 2) * H * 0.5);
    if (y >= brow[x] + 1) plot(B, x, y, word(SNOW[n]));
  }

  // The treeline along the brow, in clumps, and a few spruces out on the snow.
  const rand = mulberry(0x5bce);
  for (let x = -2; x < w + 2; x += 2 + rand() * 3) {
    const clump = noise(x * 0.05, 1.5, 83);
    const r = rand();
    if (clump < 0.45) continue;
    const xi = clamp(Math.round(x), 0, w - 1);
    spruce(B, xi, Math.round(brow[xi]), Math.round(4 + r * 4 + (clump - 0.45) * 12), xi);
  }
  const lone = [[0.05, 0.1, 1.0], [0.09, 0.16, 1.3], [0.13, 0.08, 0.8], [0.93, 0.06, 0.8], [0.97, 0.13, 1.1]];
  for (const [fx, fp, sz] of lone) {
    const x = Math.round(fx * w);
    const y = Math.round(yS + fp * H);
    const ht = Math.round((6 + fp * 40) * sz * (h / 440 + 0.5));
    // A blue shadow on the snow, away from the sun.
    span(B, x - ht * 0.6, x, y, word(SNOW[1]));
    spruce(B, x, y, ht, x);
  }
  // A ski tourer at the far end of the tracks, heading for the ridge.
  const sx = Math.round(trackX(0.97)), sy = Math.round(yS + 5);
  plot(B, sx, sy - 5, word('#e8b894'));
  span(B, sx, sx + 1, sy - 4, word(JACKET));
  span(B, sx, sx + 1, sy - 3, word(JACKET));
  plot(B, sx, sy - 2, word(SPRUCE));
  plot(B, sx + 1, sy - 1, word(SPRUCE));
  plot(B, sx - 1, sy - 2, word(SPRUCE));
}

/* ------------------------------------------------------------------ */
/* Animation caches                                                    */

function animBackdrop(m) {
  const { w, h, yS } = m;
  const rand = mulberry(0xa41b);
  const wisps = [];
  for (let i = 0; i < 9; i++) {
    const y = Math.round((0.02 + rand() * 0.3) * h);
    const pal = cloudPalette(m, y);
    wisps.push({ y, x0: rand() * w, v: 0.8 + rand() * 1.8, len: Math.round(6 + rand() * w * 0.12),
      c1: pal[1], c2: pal[2] });
  }
  const drift = [];
  for (let i = 0; i < 26; i++) {
    const p = rand();
    drift.push({ y: yS + 2 + p * (h - yS - 3), x0: rand() * (w + 20), v: 10 + p * 26 + rand() * 6,
      ph: rand() * 6.28, big: p > 0.55 });
  }
  return { wisps, drift, plumes: null };
}

/** The four highest summits carry spindrift plumes. */
function plumes(m) {
  if (!m.anim.plumes) {
    m.anim.plumes = m.cones.filter((c) => c.tower && c.x > 2 && c.x < m.w - 2)
      .sort((a, b) => a.y - b.y).slice(0, 4)
      .map((c, i) => ({ x: Math.round(c.x + c.tw), y: Math.round(c.y), ph: i * 0.37 }));
  }
  return m.anim.plumes;
}

const COURTS = new Map();
let lastCourt = null;

function courtAnim(w, h) {
  if (lastCourt && lastCourt.w === w && lastCourt.h === h) return lastCourt;
  const key = `${w}x${h}`;
  let a = COURTS.get(key);
  if (a) return (lastCourt = a);
  if (COURTS.size > 8) COURTS.clear();
  const rand = mulberry(0xc0a7);
  const flakes = [];
  const count = clamp(Math.round((44 * w * h) / (175 * 313)), 16, 44);
  for (let i = 0; i < count; i++) {
    flakes.push({ y: rand() * h, x0: rand() * (w + 12), v: 14 + rand() * 20, f: 0.8 + rand() * 1.5,
      ph: rand() * 6.28, len: 1 + Math.floor(rand() * (w < 120 ? 2 : 3)), bright: i % 5 === 0 });
  }
  const snakes = [];
  for (let i = 0; i < 4; i++) {
    snakes.push({ y: (0.12 + rand() * 0.76) * h, x0: rand() * w, v: 20 + rand() * 10, ph: rand() * 6.28 });
  }
  a = { w, h, flakes, snakes };
  COURTS.set(key, a);
  return (lastCourt = a);
}

/* ------------------------------------------------------------------ */

export default {
  palette: { accent: '#ff9468', court: '#201d3f', line: 'rgba(255,164,190,0.5)' },

  backdrop(ctx, w, h) {
    const m = model(w, h);
    const B = buffer(ctx, w, h);
    paintSky(B, m);
    paintClouds(B, m);
    paintRange(B, m);
    paintRidge(B, m);
    paintSnowfield(B, m);
    put(B);
  },

  court(ctx, w, h) {
    const B = buffer(ctx, w, h);
    paintFloor(B, w, h);
    // Mirror the top half: each phone sees the court from its own goal.
    for (let y = 0; y < Math.floor(h / 2); y++) B.d.copyWithin((h - 1 - y) * w, y * w, y * w + w);
    put(B);
  },

  animateBackdrop(ctx, w, h, t) {
    const m = model(w, h);
    const { wisps, drift } = m.anim;
    // Wisps crossing the sky, slower than anything else on screen.
    for (const s of wisps) {
      const x = Math.round(wrap(s.x0 + t * s.v, w + s.len * 2) - s.len);
      ctx.fillStyle = s.c1;
      ctx.fillRect(x, s.y, s.len, 1);
      ctx.fillStyle = s.c2;
      ctx.fillRect(x + Math.round(s.len * 0.3), s.y + 1, Math.round(s.len * 0.45), 1);
    }
    // Alpenglow breathing along the towers: a slow wave of warm light
    // sweeping across the sunlit faces.
    ctx.fillStyle = '#ffa894';
    for (const r of m.shimmer) {
      const a = Math.sin(t * 0.6 - r.x * 0.035);
      if (a < 0.25) continue;
      ctx.globalAlpha = (a - 0.25) * 0.36;
      ctx.fillRect(r.x, r.y, 1, r.len);
    }
    // Spindrift off the highest summits, downwind to the right.
    ctx.fillStyle = '#ffe4dc';
    for (const p of plumes(m)) {
      for (let k = 0; k < 6; k++) {
        const f = wrap(t * 0.3 + p.ph + k / 6, 1);
        ctx.globalAlpha = 0.6 * (1 - f) * Math.min(1, f * 10);
        ctx.fillRect(Math.round(p.x + f * 16 + Math.sin(f * 7 + k) * 1.2),
          Math.round(p.y - f * 3 + f * f * 5), f > 0.45 ? 2 : 1, 1);
      }
    }
    // Snow blowing across the snowfield in gusts.
    const D = t + 1.5 * (1 - Math.cos(t * 0.45));
    ctx.fillStyle = '#d8caee';
    ctx.globalAlpha = 0.55;
    for (const p of drift) {
      const x = Math.round(wrap(p.x0 + D * p.v, w + 20) - 10);
      const y = Math.round(p.y + Math.sin(t * 1.3 + p.ph) * 1.5);
      ctx.fillRect(x, y, p.big ? 3 : 2, 1);
    }
    ctx.globalAlpha = 1;
  },

  animateCourt(ctx, w, h, t) {
    const { flakes, snakes } = courtAnim(w, h);
    const D = t + 1.5 * (1 - Math.cos(t * 0.45));
    // Ground drift: faint snakes of snow skating across the crust.
    ctx.fillStyle = '#8c86c4';
    ctx.globalAlpha = 0.12;
    for (const s of snakes) {
      const x0 = wrap(s.x0 + D * s.v, w + 30) - 30;
      for (let k = 0; k < 6; k++) {
        ctx.fillRect(Math.round(x0 + k * 5), Math.round(s.y + Math.sin(k * 0.9 + t * 2 + s.ph) * 1.5), 5, 1);
      }
    }
    // Blowing snow, streaked by the wind.
    ctx.fillStyle = '#aaa4da';
    ctx.globalAlpha = 0.3;
    for (const p of flakes) {
      if (p.bright) continue;
      ctx.fillRect(Math.round(wrap(p.x0 + D * p.v, w + 12) - 6),
        Math.round(p.y + Math.sin(t * p.f + p.ph) * 1.5), p.len, 1);
    }
    ctx.fillStyle = '#dcd6f4';
    ctx.globalAlpha = 0.38;
    for (const p of flakes) {
      if (!p.bright) continue;
      ctx.fillRect(Math.round(wrap(p.x0 + D * p.v, w + 12) - 6),
        Math.round(p.y + Math.sin(t * p.f + p.ph) * 1.5), p.len + 1, 1);
    }
    ctx.globalAlpha = 1;
  },
};

/**
 * The top half of the floor: blue snow in the after-glow, rose where the
 * sunset side still reaches it, sastrugi combed across by the wind in
 * patches, and spruce crowns crowding both walls.
 */
function paintFloor(B, w, h) {
  const half = Math.ceil(h / 2);
  const k = 175 / w;                       // features keep their art-pixel size
  const V = new Float32Array(w * half);
  const warm = new Float32Array(w * half);
  const crest = new Uint8Array(w * half);
  const s = Math.max(0.7, w / 175);        // trees stay trees on a small court
  const n1 = noiseGrid(w, half, 0.03 * k, 0.025 * k, 5);
  const n2 = noiseGrid(w, half, 0.1 * k, 0.08 * k, 9);
  const n3 = noiseGrid(w, half, 0.02 * k, 0.018 * k, 3);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Snow banked up against the tree lines, so the crowns stand out on it.
      const bank = Math.max(0, 1 - Math.min(x, w - 1 - x) / (9 * s));
      V[i] = 2.5 + (n1[i] - 0.5) * 1.6 + (n2[i] - 0.5) * 0.5 + bank * 1.3;
      warm[i] = (x / w) * 0.75 + (n3[i] - 0.5) * 1.1;
    }
  }
  // Sastrugi: wavy wind-cut ridges, lit along the top and shadowed below,
  // gathered in fields and kept away from the centre ring.
  const rand = mulberry(0x5a57);
  const cx = w / 2, cy = h / 2;
  const tries = Math.round((w * half) / 16);
  for (let i = 0; i < tries; i++) {
    const x0 = rand() * w, y0 = Math.floor(rand() * half);
    const len = Math.round(5 + rand() * 10);
    const ph = rand() * 6.28, keep = rand();
    const field = noise(x0 * 0.025 * k, y0 * 0.03 * k, 13);
    const calm = Math.hypot(x0 - cx, (y0 - cy) * 0.8) < w * 0.24 ? 0.25 : 1;
    if (keep > field * field * 1.1 * calm) continue;
    for (let j = 0; j < len; j++) {
      const x = Math.round(x0 + j), y = y0 + Math.round(Math.sin(j * 0.6 + ph) * 0.7);
      if (x < 0 || x >= w || y < 0 || y >= half - 1) continue;
      V[y * w + x] += 1.7;
      crest[y * w + x] = 1;
      V[(y + 1) * w + x] -= 1.0;
    }
  }
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      // Ridge tops catch the pink of the sky more readily than the hollows.
      const t = warm[i] + (crest[i] ? 0.25 : 0);
      const rose = t > 0.58 || (t > 0.5 && bay(x, y) < (t - 0.5) / 0.08);
      B.d[i] = tone(rose ? R_C_ROSE : R_C_BLUE, clamp(V[i], 0, 6), x, y, 0.4);
    }
  }
  // Spruce crowns along both walls: big ones against the wall with snow
  // between them, smaller ones stepping out into the gaps. The wall cuts the
  // big ones, but not so far that they stop reading as trees — except on a
  // narrow court, where every column of snow is wanted for play.
  const trees = [];
  for (const side of [0, 1]) {
    const r2 = mulberry(0x9e3 + side);
    const at = (inset, y, r) => trees.push([side ? w - 1 - inset : inset, y, r, side * 100 + Math.round(y)]);
    let y = -2;
    while (y < half + 6) {
      const r = (3.8 + r2() * 2.8) * s;
      at((0.2 + r2() * 1.5) * s + r * 0.45 * Math.min(1, s * s), y, r);
      const gap = r * (1.9 + r2() * 0.9);
      if (r2() < 0.65) at((r * 1.2 + 1.5 + r2() * 2) * s, y + gap * 0.5, (1.8 + r2() * 1.4) * s);
      y += gap;
    }
  }
  // Each crown throws a shadow away from the sunset first, so that no shadow
  // falls across a neighbouring crown.
  const shadow = word(C_BLUE[0]);
  for (const [x, y, r] of trees) {
    const sx = x - r * 0.3, sy = y + r * 0.3, R = r * 0.92;
    for (let py = Math.max(0, Math.floor(sy - R)); py <= Math.min(half - 1, Math.ceil(sy + R)); py++) {
      const hw = Math.sqrt(Math.max(0, R * R - (py - sy) ** 2));
      span(B, sx - hw, sx + hw, py, shadow);
    }
  }
  for (const [x, y, r, seed] of trees) crown(B, x, y, r, seed, half);
}

/** A spruce crown from above: eight boughs round a dense core, snow along them. */
function crown(B, cx, cy, r, seed, half) {
  const pine = R_C_PINE, snow = R_C_PINE_SNOW;
  const rot = hash(seed, 1, 17) * 6.28;
  const R = Math.ceil(r) + 1;
  const ya = Math.max(0, Math.floor(cy - R)), yb = Math.min(half - 1, Math.ceil(cy + R));
  const xa = Math.max(0, Math.floor(cx - R)), xb = Math.min(B.w - 1, Math.ceil(cx + R));
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      const dx = x - cx, dy = y - cy;
      const d = Math.hypot(dx, dy);
      const spoke = Math.abs(Math.cos(Math.atan2(dy, dx) * 4 + rot));
      if (d > r * (0.55 + 0.45 * spoke * spoke)) continue;
      // Darkest at the trunk, bough tips lighter, the sunset side lighter still.
      const f = d / r;
      const light = ((dx - dy) / r) * 0.7;
      let c = pine[clamp(Math.floor(f * 2.3 + light + 0.15), 0, 3)];
      // Snow lies out along the boughs, most of it on the sunlit side.
      const fl = hash(x, y, seed + 2);
      if (f > 0.35 && spoke > 0.55 && fl < 0.28 + light * 0.2) c = snow[light > 0.15 ? 2 : light > -0.2 ? 1 : 0];
      B.d[y * B.w + x] = c;
    }
  }
}
