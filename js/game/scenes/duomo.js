// RoGuPong — DUOMO ROOFTOP. The roof of Milan's cathedral at golden hour: a
// forest of marble spires, gold on the sun side and lavender in the shade, the
// Madonnina glinting on top of the tallest, the city hazy between the statues
// and the stepped roof slabs underfoot — pigeons included.
//
// Everything static is painted into a pixel buffer and put on the canvas in
// one call. The big continuous surfaces (sky, clouds, sun, roof steps, the
// court floor) are colour functions evaluated once per art pixel, banded and
// ordered-dithered; everything with an outline (towers, pinnacles, spires,
// statues, people) is laid over them as flat runs written straight into the
// buffer, so a spire's hundreds of carved details cost no canvas calls at all.

import { mulberry, mix, clamp } from './kit.js';

/* ------------------------------------------------------------------ */
/* Colour and texture                                                  */

// Colours carry both forms: the '#hex' fillRect wants and the packed pixel
// (little-endian ABGR) the buffer is written in.
const COLS = new Map();
function col(hex) {
  let c = COLS.get(hex);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    c = { s: hex, u: (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | (n >>> 16)) >>> 0 };
    COLS.set(hex, c);
  }
  return c;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bay = (x, y) => (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;

/** A cheap integer hash → 0..1, for per-slab choices that must not drift. */
function hash(a, b = 0) {
  let t = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b);
  t ^= t >>> 15; t = Math.imul(t, 0x2c1b3c6d);
  t ^= t >>> 12; t = Math.imul(t, 0x297a2d39);
  t ^= t >>> 15;
  return (t >>> 0) / 4294967296;
}

// Deep azure overhead to gold at the horizon; the last steps only appear in
// the sun's glow.
const SKY = ['#152a69', '#1b3984', '#244d9b', '#3564ae', '#5580bd', '#809bc2',
  '#a8a2ba', '#cda69e', '#e8b588', '#f5c885', '#fbdca0', '#fff0c8'].map(col);
const SUN = col('#fff8e2');

// Clouds lit from below by a sun that has already dropped under them.
const CLOUD = {
  high: { top: '#949bcf', body: '#6972b0', side: '#cf9f9e', under: '#dd9c84', rim: '#f3bc7c' },
  mid: { top: '#bdb8dd', body: '#9394c2', side: '#ebb89a', under: '#eea981', rim: '#fbcf8a' },
  low: { top: '#f4cfa4', body: '#e6ae93', side: '#fad8a4', under: '#f5bf7f', rim: '#ffe3aa' },
};

// Marble by distance: nearer is warmer and more contrasted, farther sinks into
// the evening haze. The two near spires are the dark frame, rim-lit in gold.
const TONE = {
  far: { hi: '#fbe2b6', lit: '#eecd9f', mid: '#d6b399', sh: '#b49fb0', dk: '#9c8aa3', dkr: '#877694' },
  mid: { hi: '#fff0cc', lit: '#f3d39b', mid: '#d5ae8c', sh: '#a293b1', dk: '#7e7296', dkr: '#62587c' },
  tall: { hi: '#fff4d6', lit: '#f6d8a0', mid: '#d8b089', sh: '#998bac', dk: '#75698f', dkr: '#554c71' },
  near: { hi: '#ffd48e', lit: '#d9a970', mid: '#93809a', sh: '#675e80', dk: '#4c4466', dkr: '#37314f' },
};
// Up close the marble shows its coursing: faint joints a step darker per face.
Object.assign(TONE.near, {
  shJ: mix(TONE.near.sh, TONE.near.dk, 0.5), midJ: mix(TONE.near.mid, TONE.near.dk, 0.3),
  litJ: mix(TONE.near.lit, TONE.near.mid, 0.3),
});
const GOLD = { hi: '#fff4b8', lit: '#ffd04a', sh: '#c98a26', dk: '#8d5a1e' };

// The city in the haze: towers pick up the sunset on their west faces.
const CITY = { a: '#b690a0', b: '#ad899b', sh: '#9b7b92', lit: '#d3a08b', dk: '#86697f', glint: '#ffe0a0' };
const VELASCA = { sh: '#9a7486', lit: '#cc9884', dk: '#7f5f73' };
const GREEN = { a: '#7c8a63', b: '#65754f' };

// The roof steps by distance tier (far haze → foreground shade).
const ROOF = [
  { lit: '#e6c297', shade: '#b7a1b1', riser: '#a08ba3', nose: '#f5d9a8', noseSh: '#c6b1bb' },
  { lit: '#d6aa7c', shade: '#94839f', riser: '#77698b', nose: '#f1c98c', noseSh: '#a695ae' },
  { lit: '#bd9069', shade: '#6d6484', riser: '#544c6b', nose: '#deb075', noseSh: '#7d7392' },
  { lit: '#a27a5c', shade: '#59526e', riser: '#433d58', nose: '#c49664', noseSh: '#686080' },
].map((t) => ({
  lit: col(t.lit), shade: col(t.shade), riser: col(t.riser), nose: col(t.nose), noseSh: col(t.noseSh),
  jointLit: col(mix(t.lit, t.riser, 0.45)), jointSh: col(mix(t.shade, t.riser, 0.6)),
  riserJ: col(mix(t.riser, '#2a2438', 0.25)),
  speckLit: col(mix(t.lit, '#ffffff', 0.12)), speckSh: col(mix(t.shade, '#2a2438', 0.12)),
  litAlt: col(mix(t.lit, t.riser, 0.1)), shadeAlt: col(mix(t.shade, t.riser, 0.16)),
}));
const TIER_EDGES = [0.13, 0.36, 0.64];
const STEP = 2.3;                         // roof steps: q = STEP / depth, one step per unit

const SHIRTS = ['#3b63d6', '#e6e0d6', '#c9443b', '#e2b83c', '#d98fa6', '#2c3f8f', '#8c7bb8', '#4fa3a0', '#f08a4b'];
const LEGS = ['#2e3a66', '#2a2536', '#8f8065', '#3a3350'];

/* ------------------------------------------------------------------ */
/* Painting helpers                                                    */

/**
 * The pixel surface static layers paint into. fill() writes flat runs
 * straight into the ImageData and put() hands the finished painting to the
 * canvas in one call. With `masking` on it also records which sky pixels the
 * spires cover, so the drifting wisps can pass behind them.
 */
function surface(ctx, w, h, maskH = 0) {
  const img = ctx.createImageData(w, h);
  const buf = new Uint32Array(img.data.buffer);
  const mask = maskH ? new Uint8Array(w * maskH) : null;
  return {
    w, h, buf, mask, masking: false,
    fill(x, y, fw, fh, c) {
      const x0 = Math.max(0, x), x1 = Math.min(w, x + fw);
      const y0 = Math.max(0, y), y1 = Math.min(h, y + fh);
      if (x1 <= x0 || y1 <= y0) return;
      const u = typeof c === 'string' ? col(c).u : c.u;
      for (let yy = y0; yy < y1; yy++) buf.fill(u, yy * w + x0, yy * w + x1);
      if (this.masking) {
        for (let yy = y0; yy < Math.min(y1, maskH); yy++) mask.fill(1, yy * w + x0, yy * w + x1);
      }
    },
    /** The colour already painted at a pixel, as '#hex', for the animation to repaint with. */
    at(x, y) {
      const u = buf[y * w + x];
      return '#' + (((u & 255) << 16) | (u & 0xff00) | ((u >>> 16) & 255)).toString(16).padStart(6, '0');
    },
    put() { ctx.putImageData(img, 0, 0); },
  };
}

/** Split a width into shade / front / sun faces — the sun is low on the right. */
function split(n) {
  const ls = Math.max(1, Math.round(n * 0.32));
  const rs = Math.max(1, Math.round(n * 0.3));
  return [ls, n - ls - rs, rs];
}

/** A block of carved marble `n` wide: shaded left face, warm front, sunlit right edge. */
function faces(g, a, y, n, hh, T) {
  if (n <= 0 || hh <= 0) return;
  if (n === 1) { g.fill(a, y, 1, hh, T.lit); return; }
  if (n === 2) { g.fill(a, y, 1, hh, T.sh); g.fill(a + 1, y, 1, hh, T.lit); return; }
  if (n === 3) {
    g.fill(a, y, 1, hh, T.sh); g.fill(a + 1, y, 1, hh, T.mid); g.fill(a + 2, y, 1, hh, T.lit);
    return;
  }
  const [ls, ms, rs] = split(n);
  g.fill(a, y, ls, hh, T.sh);
  g.fill(a + ls, y, ms, hh, T.mid);
  g.fill(a + ls + ms, y, rs, hh, T.lit);
  if (n >= 5) { g.fill(a, y, 1, hh, T.dk); g.fill(a + n - 1, y, 1, hh, T.hi); }
}

const mirrored = (rows) => rows.map((r) => [...r].reverse().join(''));

/** Paint a sprite given as rows of characters; '.' is transparent. */
function sprite(g, x, y, rows, pal, flip = false) {
  if (flip) rows = mirrored(rows);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let i = 0; i < row.length;) {
      const ch = row[i];
      let j = i + 1;
      while (j < row.length && row[j] === ch) j++;
      if (ch !== '.') g.fill(x + i, y + r, j - i, 1, pal[ch]);
      i = j;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Layout: placed once per canvas size, shared by painter and animation */

const LAYOUTS = new Map();
function remember(key, make) {
  let v = LAYOUTS.get(key);
  if (v) LAYOUTS.delete(key);                     // re-inserted below as the newest
  else {
    if (LAYOUTS.size >= 8) LAYOUTS.delete(LAYOUTS.keys().next().value);
    v = make();
  }
  LAYOUTS.set(key, v);
  return v;
}

function sceneLayout(w, h) {
  const rand = mulberry(0xd0040);
  const s = Math.min(w, h) / 200;
  const S = (v) => Math.max(1, Math.round(v * s));
  const odd = (v) => S(v) | 1;
  // The backdrop canvas carries the renderer's 24 px shake margin: twelve art
  // pixels on a phone, about six on a big screen (whose art pixels are
  // larger). Fractions are of the visible screen, not the canvas.
  const m = h > w * 1.5 || Math.min(w, h) > 200 ? 12 : 6;
  const fy = (f) => Math.round(m + f * (h - 2 * m));
  const land = w > h * 1.15;
  const hz = fy(land ? 0.64 : 0.6);
  const F = h - hz;
  const dy = (d) => Math.round(hz + d * F);
  const cx = w >> 1;
  const gap = clamp(w / 8.2, 22 * s, 30 * s);
  // The sun sets just right of centre, behind one of the small far spires.
  const sun = { x: Math.round(cx + gap * 2.5), y: hz - Math.round(hz * 0.12), r: S(7) };

  // Spires in half-gap slots out from the centre, in a repeating rhythm:
  // small far spire, a skyline tower seen through the gap, a middling spire,
  // a tall one. Landscape screens just show more of the rhythm.
  // The main spire stands clear above the rest, the Madonnina high in the
  // top strip, above the HUD's meter bar.
  const spires = [{ cx, top: fy(0.02) + MADONNINA.length, base: dy(0.04), W: odd(17), T: TONE.tall, tiers: 2, gold: true }];
  const towers = [];
  const TOWERS = { '-1': ['unicredit', 'velasca', 'citylife'], 1: ['pirelli', 'bosco', 'galfa'] };
  for (let j = 1; j <= 24; j++) {
    for (const side of [-1, 1]) {
      const x = Math.round(cx + side * (j * gap) / 2 + (rand() - 0.5) * gap * 0.12);
      const hr = rand();
      if (x < -S(10) || x > w + S(10)) continue;
      const role = j % 4;
      if (role === 2) {
        const kind = TOWERS[side][(j - 2) / 4];
        if (kind) towers.push({ kind, x });
      } else if (role === 0) {
        spires.push({ cx: x, top: fy(0.065 + hr * 0.05 + (j - 4) * 0.006), base: dy(0.1 + rand() * 0.04), W: odd(12), T: TONE.tall });
      } else if (role === 3) {
        spires.push({ cx: x, top: fy(0.1 + hr * 0.13), base: dy(0.06 + rand() * 0.03), W: odd(9), T: TONE.mid });
      } else {
        spires.push({ cx: x, top: fy(0.28 + hr * 0.12), base: dy(0.02), W: odd(6), T: TONE.far });
      }
    }
  }
  spires.sort((a, b) => a.base - b.base);
  const nearW = odd(25);
  const near = [
    { cx: Math.round(w * 0.055), top: fy(-0.02), base: dy(0.78), W: nearW, T: TONE.near },
    { cx: w - 1 - Math.round(w * 0.055), top: fy(0.012), base: dy(0.74), W: nearW, T: TONE.near },
  ];
  const all = spires.concat(near);
  // Spires standing on the roof throw long evening shadows across it.
  const casters = all.filter((sp) => sp.base > hz + 2)
    .map((sp) => ({ bx: sp.cx, by: sp.base, hw: sp.W / 2 + 0.5 }));

  const clouds = [
    { x: w * 0.66, y: Math.max(fy(0.058), m + 18 * s), cw: 40 * s, ch: 8 * s, tone: CLOUD.high },
    { x: w * 0.3, y: fy(0.2), cw: 50 * s, ch: 10 * s, tone: CLOUD.high },
    { x: w * 0.86, y: fy(0.27), cw: 44 * s, ch: 9 * s, tone: CLOUD.mid },
    { x: w * 0.42, y: fy(0.36), cw: 36 * s, ch: 7 * s, tone: CLOUD.mid },
    { x: w * 0.3, y: fy(0.47), cw: 64 * s, tone: CLOUD.low, streak: true },
    { x: w * 0.74, y: fy(0.41), cw: 40 * s, tone: CLOUD.mid, streak: true },
  ];
  // A statue that just grazes a cloud's underside looks as if it were holding
  // the cloud up: lift the cloud clear of it, or where the sky runs out, sink
  // it until the spire clearly rises in front.
  for (let pass = 0; pass < 2; pass++) {
    for (const c of clouds) {
      if (c.streak) continue;
      for (const sp of all) {
        const tip = sp.top - (sp.gold ? MADONNINA.length : 8);
        if (Math.abs(sp.cx - c.x) < c.cw / 2 + 3 && tip > c.y - 3 && tip < c.y + 5) {
          c.y = tip - 5 - c.ch * 2.3 >= m ? tip - 5 : tip + 6;
        }
      }
    }
  }

  // Tourists on the lit middle of the roof — never where a nearer spire
  // would stand in front of them.
  const people = [];
  for (let tries = 0; people.length < (land ? 13 : 10) && tries < 150; tries++) {
    const d = 0.06 + rand() * 0.52;
    const y = dy(d);
    const x = Math.round(cx + (rand() - 0.5) * w * 0.86);
    const ht = Math.max(3, Math.round((3 + 14 * d) * s));
    const pw = ht >= 10 ? 4 : ht >= 7 ? 3 : 2;
    const pick = rand();
    const blocked = all.some((sp) => sp.base >= y - ht && x + pw >= sp.cx - (sp.W >> 1) - 2 && x <= sp.cx + (sp.W >> 1) + 2)
      || people.some((p) => Math.abs(p.x - x) < pw + 3 && Math.abs(p.y - y) < ht);
    if (blocked) continue;
    // Shirts step round the list, so neighbours in the crowd never match.
    const shirt = SHIRTS[(people.length * 4 + ((pick * 3) | 0)) % SHIRTS.length];
    people.push({ x, y, ht, pw, shirt, legs: LEGS[((pick * 97) | 0) % LEGS.length] });
  }

  // Pigeons: three in the foreground that peck, two farther off that don't.
  // The near ones keep to the last few rows, under the players' HUD.
  const pigeons = [
    { x: Math.round(w * 0.27), y: fy(0.975), face: 1, anim: 0.0 },
    { x: Math.round(w * 0.47), y: fy(0.99), face: -1, anim: 1.3 },
    { x: Math.round(w * 0.58), y: fy(0.97), face: 1, anim: 2.1 },
    { x: Math.round(cx - w * 0.2), y: dy(0.45), face: 1 },
    { x: Math.round(cx + w * 0.17), y: dy(0.5), face: -1 },
  ];

  // Scraps of cloud that drift across in the animation layer.
  const wisps = [
    { y: fy(0.12), len: 20 * s, v: 1.3, x0: w * 0.1, tone: CLOUD.high },
    { y: fy(0.31), len: 26 * s, v: 0.9, x0: w * 0.55, tone: CLOUD.mid },
  ];

  const L = { w, h, s, S, fy, hz, F, dy, cx, sun, glowR: 80 * s, spires, near, towers, casters, clouds, people, pigeons, wisps };
  buildClouds(L);
  return L;
}

/** Rasterise the clouds into a palette-index map that the sky painter reads. */
function buildClouds(L) {
  const { w, hz } = L;
  const map = new Uint8Array(w * (hz + 1));
  const pal = [null];
  const idx = (hex) => { const c = col(hex); let i = pal.indexOf(c); if (i < 0) { i = pal.length; pal.push(c); } return i; };
  const rand = mulberry(0xc10d);
  for (const c of L.clouds) {
    if (c.streak) {
      // Low sunset streaks: a few offset runs, their ends dithered away.
      const T = c.tone;
      const runs = [[0.18, 0.62, T.top], [0, 0.86, T.body], [0.1, 0.9, T.under], [0.3, 0.64, T.rim]];
      runs.forEach(([a, b, hex], r) => {
        const y = Math.round(c.y) - 3 + r;
        const x0 = c.x - c.cw / 2 + a * c.cw, x1 = c.x - c.cw / 2 + b * c.cw;
        const k = idx(hex);
        for (let x = Math.max(0, Math.floor(x0)); x < Math.min(w, Math.ceil(x1)); x++) {
          const edge = Math.min(x - x0, x1 - x) / (c.cw * 0.12);
          if (y >= 0 && y <= hz && (edge >= 1 || edge > bay(x, y))) map[y * w + x] = k;
        }
      });
      continue;
    }
    // A row of overlapping puffs, biggest in the middle, cut flat underneath.
    const n = Math.max(3, Math.round(c.cw / (c.ch * 1.2)));
    const discs = [];
    for (let i = 0; i < n; i++) {
      const f = n > 1 ? i / (n - 1) : 0.5;
      // Big enough to overlap the next puff, so the cloud never falls apart.
      const r = Math.max(c.cw / n * 0.62, c.ch * (0.45 + rand() * 0.7) * (1 - 0.4 * Math.abs(f - 0.5) * 2));
      const x = c.x - c.cw / 2 + (i + 0.5) * (c.cw / n) + (rand() - 0.5) * c.ch * 0.4;
      discs.push({ x, y: c.y - r * 0.3, r });
      // Billows piled on top of the middle puffs.
      if (c.ch > 5 && f > 0.15 && f < 0.85 && rand() < 0.8) discs.push({ x: x + (rand() - 0.5) * r, y: c.y - r * 1.1, r: r * 0.7 });
    }
    // Flat underneath, but the base curls up toward the ends.
    const bottom = Math.round(c.y);
    const half = c.cw / 2 + c.ch * 0.6;
    const base = (x) => bottom - Math.round(3.4 * Math.min(1, Math.abs(x + 0.5 - c.x) / half) ** 3);
    const inside = (x, y) => y <= base(x) && discs.some((d) => (x - d.x) ** 2 + (y - d.y) ** 2 <= d.r * d.r);
    const T = c.tone;
    const ids = { top: idx(T.top), body: idx(T.body), side: idx(T.side), under: idx(T.under), rim: idx(T.rim) };
    const x0 = Math.max(0, Math.floor(c.x - c.cw / 2 - c.ch)), x1 = Math.min(w - 1, Math.ceil(c.x + c.cw / 2 + c.ch));
    const y0 = Math.max(0, Math.floor(c.y - c.ch * 2.2));
    for (let y = y0; y <= bottom && y <= hz; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, y)) continue;
        const b = bay(x, y);
        const up = base(x) - y;
        let k;
        if (up < 1) k = ids.rim;
        else if (up < 2.5 + b * 2) k = ids.under;
        else if (!inside(x, y - 1) || (!inside(x, y - 2) && b < 0.5)) k = ids.top;
        else if (!inside(x + 1, y) || (!inside(x + 2, y) && b < 0.5)) k = ids.side;
        else k = ids.body;
        map[y * w + x] = k;
      }
    }
  }
  L.cmap = map;
  L.cpal = pal;
}

/* ------------------------------------------------------------------ */
/* Surfaces: sky and roof as colour functions                          */

function skyAt(L, x, y) {
  const ci = L.cmap[y * L.w + x];
  if (ci) return L.cpal[ci];
  const sx = x - L.sun.x, sy = y - L.sun.y;
  if (sx * sx + sy * sy <= L.sun.r * L.sun.r) return SUN;
  // The sun's glow is flattened sideways and pushes the ramp toward gold,
  // which draws its halo as concentric bands of the same palette.
  const dd = Math.sqrt(sx * sx + sy * sy * 2.6);
  const gl = Math.max(0, 1 - dd / L.glowR);
  return SKY[skyStep((y / L.hz) * 9.3 + 3.4 * gl * gl, x, y)];
}

/** Flat bands with an ordered-dither seam over the last 40% of each. */
function skyStep(p, x, y) {
  if (p > 11) p = 11;
  const i = Math.floor(p);
  return (p - i - 0.6) / 0.4 > bay(x, y) && i < 11 ? i + 1 : i;
}

/** The sky row by row: outside the sun's glow a row is one 4-pixel dither pattern. */
function paintSky(L, buf) {
  const { w, hz, sun, glowR, cmap, cpal } = L;
  const gy = glowR / Math.sqrt(2.6) + 1;
  const gx0 = Math.max(0, Math.floor(sun.x - glowR - 1)), gx1 = Math.min(w, Math.ceil(sun.x + glowR + 2));
  const pat = [0, 0, 0, 0];
  for (let y = 0; y <= hz; y++) {
    const row = y * w;
    const p = (y / hz) * 9.3;
    for (let i = 0; i < 4; i++) pat[i] = SKY[skyStep(p, i, y)].u;
    for (let x = 0; x < w; x++) buf[row + x] = pat[x & 3];
    if (Math.abs(y - sun.y) <= gy) for (let x = gx0; x < gx1; x++) buf[row + x] = skyAt(L, x, y).u;
    for (let x = 0; x < w; x++) if (cmap[row + x]) buf[row + x] = cpal[cmap[row + x]].u;
  }
}

/**
 * Everything about a roof row that doesn't depend on x, worked out once: its
 * depth, which step it belongs to and which part of the step (nosing, riser,
 * tread), the slab-joint spacing, and where the spires' shadows cross it.
 */
function floorRows(L) {
  if (L.rows) return L.rows;
  const { hz, F } = L;
  const rows = [];
  for (let y = hz + 1; y < L.h; y++) {
    const d = (y - hz + 0.5) / F;
    // Equal steps in depth: step k spans depths STEP/(k+1)..STEP/k. From the
    // top of its band down: the lit nosing, the riser facing us, the tread.
    const k = Math.floor(STEP / d);
    const sh = (STEP / k - STEP / (k + 1)) * F;
    const r = y - (hz + (STEP / (k + 1)) * F - 0.5);
    let part = 2;
    if (sh >= 3) {
      if (r < 1) part = 0;
      else if (r < 1 + Math.max(1, Math.round(sh * 0.2))) part = 1;
    } else if (sh >= 1.4 && r < 1) part = 1;
    const sp = d * 34 * L.s;                      // slab width on screen at this depth
    // Shadows fan out from under the sun, through each spire's foot.
    const shadows = [];
    for (const c of L.casters) {
      if (y <= c.by) continue;
      const t = (y - hz) / (c.by - hz);
      const xc = L.sun.x + (c.bx - L.sun.x) * t, hw = c.hw * t;
      if (xc + hw > -2 && xc - hw < L.w + 2) shadows.push(xc, hw);
    }
    // Rasterised once per row, so a pixel only asks whether it is in shade.
    const shade = new Uint8Array(L.w);
    for (let i = 0; i < shadows.length; i += 2) {
      const xc = shadows[i], hw = shadows[i + 1];
      for (let x = Math.max(0, Math.floor(xc - hw - 1)); x <= Math.min(L.w - 1, Math.ceil(xc + hw + 1)); x++) {
        if (Math.abs(x - xc) < hw + (bay(x, y) - 0.5) * 0.8) shade[x] = 1;
      }
    }
    rows.push({ d, k, part, inv: sp >= 5 ? 1 / sp : 0, off: (k & 1) * 0.5 + hash(k) * 0.3, shade });
  }
  return (L.rows = rows);
}

function floorAt(L, x, y, forceShade = false) {
  const row = floorRows(L)[y - L.hz - 1];
  const { d, part, inv } = row;
  const b = bay(x, y);
  let tier = 3;
  for (let i = 0; i < 3; i++) {
    if (d < TIER_EDGES[i] + (b - 0.5) * 0.05) { tier = i; break; }
  }
  const P = ROOF[tier];
  let joint = false, alt = false;
  if (inv && part !== 0) {
    const u = (x + 0.5 - L.cx) * inv + row.off;
    const j = Math.floor(u);
    joint = u - j < inv;
    alt = hash(row.k, j) < 0.35;                  // no two slabs quite the same marble
  }
  // The foreground lies in the shadow of the near spires.
  const lit = !forceShade && !row.shade[x] && d <= 0.56 + 0.16 * (1 - x / L.w) + (b - 0.5) * 0.06;
  if (part === 0) return lit ? P.nose : P.noseSh;
  if (part === 1) return joint ? P.riserJ : P.riser;
  if (joint) return lit ? P.jointLit : P.jointSh;
  if (hash(x * 7 + 3, y * 13 + 1) < 0.03) return lit ? P.speckLit : P.speckSh;
  if (alt) return lit ? P.litAlt : P.shadeAlt;
  return lit ? P.lit : P.shade;
}

/* ------------------------------------------------------------------ */
/* Skyline and the roof edge                                           */

function skyline(g, L) {
  const { hz, w, S } = L;
  const rand = mulberry(0x5c1e);
  // The low city: rooftops in haze all along the horizon, a bell tower here
  // and there.
  for (let x = -2; x < w;) {
    const bw = S(4 + rand() * 9);
    const bh = S(2 + rand() * rand() * 12);
    g.fill(x, hz - bh, bw, bh + 3, rand() < 0.5 ? CITY.a : CITY.b);
    g.fill(x + bw - Math.max(1, bw >> 2), hz - bh, Math.max(1, bw >> 2), bh + 3, CITY.lit);
    if (rand() < 0.12) {
      const th = S(9 + rand() * 6);
      g.fill(x + 1, hz - th, 2, th, CITY.sh);
      g.fill(x + 2, hz - th, 1, th, CITY.lit);
      g.fill(x + 1, hz - th - 2, 1, 2, CITY.sh);
    }
    x += bw;
  }
  for (const t of L.towers) TOWER[t.kind](g, t.x, L);
}

// Milan's modern skyline, one silhouette each, placed in the gaps between
// the spires.
const TOWER = {
  unicredit(g, x, { hz, S }) {
    const W = S(9), x0 = x - (W >> 1), top = hz - S(40);
    for (let i = 0; i < W; i++) {
      // The crown sweeps up toward the needle.
      const ct = top + Math.round(((W - 1 - i) / Math.max(1, W - 1)) * S(6));
      g.fill(x0 + i, ct, 1, hz - ct + 2, i < W * 0.45 ? CITY.sh : CITY.lit);
    }
    g.fill(x0 + W - 2, top - S(20), 1, S(20), CITY.lit);
    g.fill(x0 + W - 3, top + S(8), 1, S(22), CITY.glint);
  },
  pirelli(g, x, { hz, S }) {
    const W = S(15), x0 = x - (W >> 1), top = hz - S(36);
    g.fill(x0, top + 1, W, hz - top + 1, CITY.sh);
    g.fill(x0 + Math.round(W * 0.55), top + 1, W - Math.round(W * 0.55), hz - top + 1, CITY.lit);
    // Tapered ends read as darker slivers; the facade splits down the middle.
    g.fill(x0, top + 2, 1, hz - top, CITY.dk);
    g.fill(x0 + W - 1, top + 2, 1, hz - top, CITY.sh);
    g.fill(x0 + (W >> 1), top + 2, 1, hz - top, CITY.dk);
    g.fill(x0 - 1, top, W + 2, 1, CITY.dk);
    for (let y = top + S(4); y < hz - 2; y += S(6)) g.fill(x0 + W - 3, y, 1, 1, CITY.glint);
  },
  velasca(g, x, { hz, S }) {
    const sw = S(8) | 1, bw = S(14) | 1, sx = x - (sw >> 1), bx = x - (bw >> 1);
    const bTop = hz - S(33), bBot = hz - S(21);
    g.fill(sx, bBot, sw, hz - bBot + 2, VELASCA.sh);
    g.fill(sx + sw - 3, bBot, 3, hz - bBot + 2, VELASCA.lit);
    g.fill(bx, bTop, bw, bBot - bTop, VELASCA.sh);
    g.fill(bx + bw - 4, bTop, 4, bBot - bTop, VELASCA.lit);
    // Its ribs, the struts under the overhang and a pitched roof on top.
    for (let i = 2; i < bw - 1; i += 3) g.fill(bx + i, bTop + 1, 1, bBot - bTop - 1, VELASCA.dk);
    for (let i = 2; i < sw - 1; i += 3) g.fill(sx + i, bBot + 1, 1, hz - bBot, VELASCA.dk);
    const ov = sx - bx;
    for (let r = 0; r < ov; r++) {
      g.fill(bx + r, bBot + r, 1, 1, VELASCA.dk);
      g.fill(bx + bw - 1 - r, bBot + r, 1, 1, VELASCA.lit);
    }
    g.fill(bx + 1, bTop - 1, bw - 2, 1, VELASCA.dk);
    g.fill(bx + 3, bTop - 3, 1, 2, VELASCA.dk);
    g.fill(bx + bw - 4, bTop - 3, 1, 2, VELASCA.dk);
  },
  bosco(g, x, { hz, S }) {
    const pair = [[x - S(6), S(7), hz - S(28)], [x + S(3), S(6), hz - S(22)]];
    for (const [x0, W, top] of pair) {
      g.fill(x0, top, W, hz - top + 2, CITY.sh);
      g.fill(x0 + W - 2, top, 2, hz - top + 2, CITY.lit);
      // The vertical forest: balconies of trees, dotted green.
      for (let y = top + 1; y < hz; y++) {
        for (let i = 0; i < W; i++) {
          const b = bay(x0 + i, y);
          if (b < 0.45) g.fill(x0 + i, y, 1, 1, b < 0.2 ? GREEN.b : GREEN.a);
        }
      }
    }
  },
  citylife(g, x, { hz, S }) {
    // Isozaki's straight tower and Hadid's twisted one.
    const a0 = x - S(7), aw = S(7), at = hz - S(40);
    g.fill(a0, at, aw, hz - at + 2, CITY.sh);
    g.fill(a0 + aw - 2, at, 2, hz - at + 2, CITY.lit);
    for (let y = at + S(4); y < hz; y += S(5)) g.fill(a0, y, aw, 1, CITY.dk);
    const b0 = x + S(2), bw = S(8), bt = hz - S(32);
    g.fill(b0, bt, bw, hz - bt + 2, CITY.sh);
    for (let y = bt; y < hz; y++) g.fill(b0 + ((y - bt) >> 1) % bw, y, 1, 1, CITY.lit);
    g.fill(b0 + bw - 1, bt, 1, hz - bt + 2, CITY.lit);
  },
  galfa(g, x, { hz, S }) {
    const W = S(10), x0 = x - (W >> 1), top = hz - S(28);
    g.fill(x0, top, W, hz - top + 2, CITY.sh);
    g.fill(x0 + W - 3, top, 3, hz - top + 2, CITY.lit);
    for (let y = top + 2; y < hz; y += 3) g.fill(x0 + 1, y, W - 4, 1, CITY.dk);
  },
};

/** The far edge of the roof: a tracery balustrade bristling with little pinnacles. */
function roofEdge(g, L) {
  const { hz, w, S } = L;
  const T = TONE.far;
  const rand = mulberry(0xed6e);
  const bh = S(3);
  // Openwork gables here and there, like the transept's.
  const ng = Math.max(2, Math.round(w / 90));
  for (let i = 0; i < ng; i++) {
    const gx = Math.round(w * (0.1 + ((i + 0.2 + rand() * 0.6) / ng) * 0.8));
    const GW = S(18 + rand() * 6), GH = S(11 + rand() * 4);
    for (let r = 0; r < GH; r++) {
      const wd = Math.max(1, Math.round((GW * (r + 1)) / GH));
      const a = gx - (wd >> 1), y = hz - bh - GH + r;
      g.fill(a, y, wd, 1, T.mid);
      g.fill(a + wd - 1, y, 1, 1, T.hi);
      g.fill(a, y, 1, 1, T.sh);
      for (let i2 = a + 2; i2 < a + wd - 2; i2++) if (bay(i2, y) < 0.25) g.fill(i2, y, 1, 1, T.dk);
    }
    faces(g, gx - (GW >> 1) - 1, hz - bh - GH, 2, GH, T);
    faces(g, gx + (GW >> 1) - 1, hz - bh - GH - S(3), 2, GH + S(3), T);
  }
  g.fill(0, hz - bh, w, bh + 2, T.mid);
  g.fill(0, hz - bh, w, 1, T.lit);
  for (let x = 1; x < w; x += 3) g.fill(x, hz - bh + 1, 1, bh - 1, T.dk);
  for (let x = (rand() * 3) | 0; x < w; x += 3 + Math.floor(rand() * 4)) {
    const ph = S(4 + rand() * 10);
    const pw = rand() < 0.5 ? 1 : 2;
    const top = hz - bh - ph;
    faces(g, x, top, pw, ph, T);
    g.fill(x + pw - 1, top - 1, 1, 1, T.hi);
  }
}

/* ------------------------------------------------------------------ */
/* Spires                                                              */

// Robed saints, lit from the right, on a little plinth: one per spire size.
const STATUES = {
  3: ['h', 'l', 'l'],
  5: ['.h.', 'sl.', 'slh', 'sll', 'mmm'],
  7: ['.h.', 'sl.', 'slh', 'sll', 'sll', 'sll', 'sll', 'mmm'],
};

// The Madonnina, gilded, her lance raised in her right hand.
const MADONNINA = [
  '......y',
  '..H...y',
  '.hHH..y',
  '.hHH.Hy',
  '..h.G.y',
  '.hGGG.y',
  '.hGGG..',
  '.hGGG..',
  '.hGGG..',
  'hhGGGG.',
  'hhGGGG.',
  'hhGGGGG',
  '.ddddd.',
];

/** A saint in a pointed niche under a little gabled canopy, standing on a bracket. */
function niche(g, a, n, y, hh, T) {
  const c = a + (n >> 1);
  if (n < 3 || hh < 7) {
    if (hh >= 4) g.fill(c, y + 1, 1, hh - 2, T.dk);
    return;
  }
  const nw = n >= 9 ? 5 : n >= 5 ? 3 : 1;
  let ny = y;
  if (n >= 5) {
    g.fill(c, ny, 1, 1, T.hi);
    g.fill(c - 1, ny + 1, 3, 1, T.lit);
    ny += 2;
    if (nw === 5) { g.fill(c - 2, ny, 5, 1, T.lit); ny++; }
  }
  // A niche is only a little taller than its saint; the rest of the tier is wall.
  const nh = Math.min(y + hh - ny, nw * 2 + 5);
  if (nh < 5) return;
  const x0 = c - (nw >> 1);
  g.fill(x0 + (nw > 1 ? 1 : 0), ny, Math.max(1, nw - 2), 1, T.dkr);
  g.fill(x0, ny + 1, nw, nh - 2, T.dkr);
  if (nw >= 3) {
    g.fill(c, ny + 1, 1, 1, T.lit);
    if (nw === 5) {
      g.fill(c - 1, ny + 2, 1, nh - 4, T.sh);
      g.fill(c + 1, ny + 2, 1, nh - 4, T.lit);
    }
    g.fill(c, ny + 2, 1, nh - 4, T.mid);
  }
  g.fill(x0 - 1, ny + nh - 1, nw + 2, 1, T.lit);
}

/** The pier: stacked tiers, each a niche on the front and blind lancets on the sides. */
function pier(g, x0, yA, yB, W, T) {
  faces(g, x0, yA, W, yB - yA, T);
  if (W < 5) return;
  const [ls, ms, rs] = split(W);
  if (T.shJ) {
    for (let y = yA + 2; y < yB; y += 4) {
      g.fill(x0 + 1, y, ls - 1, 1, T.shJ);
      g.fill(x0 + ls, y, ms, 1, T.midJ);
      g.fill(x0 + ls + ms, y, rs - 1, 1, T.litJ);
    }
  }
  const th = Math.max(10, Math.round(W * 1.8));
  for (let y = yA; y < yB - 6; y += th) {
    const hh = Math.min(th, yB - y) - 1;
    niche(g, x0 + ls, ms, y + 1, hh - 1, T);
    if (ls >= 3) g.fill(x0 + (ls >> 1), y + 3, 1, hh - 5, T.dk);
    if (rs >= 3) g.fill(x0 + W - 1 - (rs >> 1), y + 3, 1, hh - 5, T.mid);
    if (W >= 9) {
      g.fill(x0 - 1, y + (th >> 1), 1, 1, T.sh);
      g.fill(x0 + W, y + (th >> 1), 1, 1, T.lit);
    }
    // A string course between tiers.
    if (y + th < yB - 6) faces(g, x0 - 1, y + th - 1, W + 2, 1, T);
  }
}

function spire(g, sp) {
  const { cx, top, base, W, T } = sp;
  const H = base - top;
  const x0 = cx - (W >> 1);
  const two = sp.tiers === 2;
  const pierTop = top + Math.round(H * (two ? 0.58 : 0.52));
  const tabTop = top + Math.round(H * (two ? 0.28 : 0.34));
  const tw = Math.max(3, Math.round(W * 0.62) | 1);
  const nw = Math.max(1, Math.round(W * 0.4) | 1);

  // Needle: tapers to one pixel under the statue, crocketed every third row.
  for (let y = top; y < tabTop; y++) {
    const f = (y - top) / Math.max(1, tabTop - top);
    const n = (1 + Math.round((nw - 1) * f)) | 1;
    const a = cx - (n >> 1);
    faces(g, a, y, n, 1, T);
    if ((y - top) % 3 === 2 && y > top + 3) { g.fill(a - 1, y, 1, 1, T.sh); g.fill(a + n, y, 1, 1, T.lit); }
    if (n >= 3 && (y - top) % 13 === 12) faces(g, a - 1, y, n + 2, 1, T);
  }

  // Tabernacle: an open lantern with a lancet and a saint inside.
  const tab = (yA, yB, n) => {
    const a = cx - (n >> 1);
    faces(g, a - 1, yA, n + 2, 1, T);
    faces(g, a, yA + 1, n, yB - yA - 1, T);
    if (n >= 5 && yB - yA > 6) {
      const lw = n >= 9 ? 3 : 1;
      g.fill(cx, yA + 2, 1, 1, T.dkr);
      g.fill(cx - (lw >> 1), yA + 3, lw, yB - yA - 5, T.dkr);
      if (lw === 3) {
        g.fill(cx, yA + 4, 1, 1, T.lit);
        g.fill(cx, yA + 5, 1, yB - yA - 8, T.mid);
      }
    }
  };
  if (two) {
    const mid = tabTop + Math.round((pierTop - tabTop) * 0.45);
    tab(tabTop, mid, Math.max(3, Math.round(W * 0.5) | 1));
    tab(mid, pierTop, tw);
  } else tab(tabTop, pierTop, tw);

  // Corner pinnacles on the pier, and for a big spire a second inner pair.
  const pin = (px, pw, pTop) => {
    faces(g, px, pTop, pw, pierTop - pTop, T);
    g.fill(px + pw - 1, pTop - 1, 1, 1, T.hi);
    for (let y = pTop + 2; y < pierTop - 1; y += 3) {
      g.fill(px - 1, y, 1, 1, T.sh);
      g.fill(px + pw, y, 1, 1, T.lit);
    }
  };
  const pw = W >= 11 ? 2 : 1;
  const pTop = tabTop + Math.round((pierTop - tabTop) * (two ? 0.55 : 0.35));
  if (W >= 5) {
    pin(x0, pw, pTop);
    pin(x0 + W - pw, pw, pTop);
  }
  if (W >= 15) {
    const inset = Math.round(W * 0.2);
    const iTop = pTop + Math.round((pierTop - pTop) * 0.4);
    pin(x0 + inset, 1, iTop);
    pin(x0 + W - 1 - inset, 1, iTop);
  }

  // Gable over the pier face, with a crocketed edge and a trefoil.
  if (W >= 5) {
    const gh = Math.max(2, Math.round(W * 0.5));
    const apex = pierTop - gh;
    g.fill(cx, apex - 1, 1, 1, T.hi);
    for (let r = 0; r < gh; r++) {
      const wd = Math.min(W - 2 * pw, 1 + 2 * Math.round(((W >> 1) * (r + 1)) / gh));
      const a = cx - (wd >> 1);
      g.fill(a, apex + r, wd, 1, T.mid);
      g.fill(a, apex + r, 1, 1, T.sh);
      g.fill(a + wd - 1, apex + r, 1, 1, T.hi);
    }
    const ty = apex + Math.round(gh * 0.55);
    if (gh >= 4) g.fill(cx, ty, 1, 1, T.dkr);
    if (gh >= 7) { g.fill(cx - 1, ty + 1, 1, 1, T.dkr); g.fill(cx + 1, ty + 1, 1, 1, T.dkr); }
  }

  // Pier and plinth.
  const plH = Math.max(2, Math.round(W * 0.22));
  const pierBot = base - plH;
  pier(g, x0, pierTop, pierBot, W, T);
  const rs = split(W)[2];
  faces(g, x0 - 1, pierBot, W + 2, plH, T);
  g.fill(x0 - 1, pierBot, W + 2, 1, T.mid);
  g.fill(x0 + W - rs, pierBot, rs + 1, 1, T.hi);

  // The statue on top.
  if (sp.gold) {
    const sx = cx - 3, sy = top - MADONNINA.length;
    sprite(g, sx, sy, MADONNINA, { y: GOLD.hi, H: GOLD.hi, G: GOLD.lit, h: GOLD.sh, d: GOLD.dk });
    sp.glint = { x: sx + 2, y: sy + 1 };
  } else {
    const size = W >= 11 ? 7 : W >= 7 ? 5 : 3;
    if (W >= 7) g.fill(cx - 1, top, 3, 1, T.mid);
    const rows = STATUES[size];
    sprite(g, cx - (size > 3 ? 1 : 0), top - rows.length, rows, { l: T.lit, s: T.sh, h: T.hi, m: T.mid });
  }
}

/* ------------------------------------------------------------------ */
/* People and pigeons                                                  */

function tourist(g, p, L) {
  const { x, y, ht, pw } = p;
  // A long shadow on the roof, pointing away from the sun.
  const dx = x - L.sun.x, dyv = (y - L.hz) * 1.5;
  const n = Math.hypot(dx, dyv) || 1;
  const len = Math.round(ht * 1.7);
  for (let i = 1; i <= len; i++) {
    const sx = Math.round(x + (dx / n) * i), sy = Math.round(y + (dyv / n) * i);
    g.fill(sx, sy, pw - 1, 1, floorAt(L, sx, sy, true));
  }
  const head = ht >= 10 ? 2 : 1;
  const legs = Math.max(1, Math.round(ht * 0.42));
  const torso = ht - head - legs;
  const top = y - ht + 1;
  const lit = mix(p.shirt, '#ffd9a0', 0.4);
  if (pw === 4) {
    g.fill(x + 1, top, 2, head, '#e7b48c');
    g.fill(x + 1, top, 2, 1, '#3b2a24');
    g.fill(x, top + head, 4, torso, p.shirt);
    g.fill(x + 3, top + head, 1, torso, lit);
    g.fill(x, top + head + torso - 1, 1, 1, '#e7b48c');
    g.fill(x + 1, y - legs + 1, 1, legs, p.legs);
    g.fill(x + 2, y - legs + 1, 1, legs, mix(p.legs, '#ffd9a0', 0.2));
  } else {
    g.fill(x + (pw === 3 ? 1 : 0), top, pw === 3 ? 1 : 2, head, '#e7b48c');
    g.fill(x, top + head, pw, torso, p.shirt);
    g.fill(x + pw - 1, top + head, 1, torso, lit);
    if (pw === 3) {
      g.fill(x, y - legs + 1, 1, legs, p.legs);
      g.fill(x + 2, y - legs + 1, 1, legs, p.legs);
      g.fill(x + 1, y - legs + 1, 1, 1, p.legs);
    } else g.fill(x, y - legs + 1, 2, legs, p.legs);
  }
}

// Side-on pigeons, facing right; the peck swaps the raised head for one down
// at the ground.
const PIGEON_REST = ['.....h.', '....hhk', '.wwwnn.', 'tbbbbn.', '..l.l..'];
const PIGEON_PECK = ['.......', '.......', '.wwwn..', 'tbbbbnh', '..l.lhk'];
const PIGEON_PECK_L = mirrored(PIGEON_PECK);
const PIGEON = { w: '#a7a1b8', b: '#8a849d', n: '#6f988a', h: '#77718c', k: '#e3b3a3', t: '#5d5873', l: '#c98078' };
// Pixels only the raised head covers: the animation repaints them with the roof.
const PIGEON_UNCOVER = [];
PIGEON_REST.forEach((row, r) => [...row].forEach((ch, i) => {
  if (ch !== '.' && PIGEON_PECK[r][i] === '.') PIGEON_UNCOVER.push([i, r]);
}));

// A cloud scrap, two small puffs on a lit base: each row is a list of
// [start, length, tone] runs in fractions of its width.
const WISP = [
  [[0.24, 0.14, 'top'], [0.58, 0.12, 'top']],
  [[0.14, 0.3, 'top'], [0.44, 0.14, 'body'], [0.58, 0.24, 'top']],
  [[0.05, 0.1, 'top'], [0.15, 0.72, 'body'], [0.87, 0.07, 'side']],
  [[0, 1, 'under']],
  [[0.08, 0.84, 'rim']],
];

/* ------------------------------------------------------------------ */
/* Backdrop                                                            */

function paintBackdrop(ctx, w, h) {
  const L = remember(`${w}x${h}`, () => sceneLayout(w, h));
  const g = surface(ctx, w, h, L.hz);
  paintSky(L, g.buf);
  for (let y = L.hz + 1; y < h; y++) {
    for (let x = 0, row = y * w; x < w; x++) g.buf[row + x] = floorAt(L, x, y).u;
  }
  skyline(g, L);
  roofEdge(g, L);
  g.masking = true;
  for (const sp of L.spires) spire(g, sp);
  g.masking = false;
  for (const p of L.people) tourist(g, p, L);
  // A pecking pigeon's raised head leaves roof showing: note what is painted
  // there before the pigeons go on top.
  const ph = PIGEON_REST.length;
  for (const p of L.pigeons) {
    if (p.anim === undefined) continue;
    p.uncover = PIGEON_UNCOVER.map(([i, r]) => {
      const x = p.face < 0 ? p.x + 6 - i : p.x + i;
      const y = p.y - ph + 1 + r;
      return [x, y, g.at(x, y)];
    });
  }
  for (const p of L.pigeons) sprite(g, p.x, p.y - ph + 1, PIGEON_REST, PIGEON, p.face < 0);
  g.masking = true;
  for (const sp of L.near) spire(g, sp);
  g.masking = false;

  // Remember what else the animation needs: the Madonnina's glint and the
  // open sky along each wisp row.
  L.glint = L.spires.find((sp) => sp.gold).glint;
  L.free = L.wisps.map((wp) => WISP.map((_, dr) => {
    const y = Math.round(wp.y) + dr;
    const spans = [];
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const open = x < w && !g.mask[y * w + x];
      if (open && start < 0) start = x;
      if (!open && start >= 0) { spans.push(start, x); start = -1; }
    }
    return spans;
  }));
  g.put();
}

function animateBackdrop(ctx, w, h, t) {
  const L = LAYOUTS.get(`${w}x${h}`);
  if (!L || !L.free) return;

  // Scraps of cloud drifting slowly right, behind the spires.
  L.wisps.forEach((wp, i) => {
    const span = w + wp.len * 2;
    const x = ((wp.x0 + t * wp.v) % span + span) % span - wp.len;
    WISP.forEach((runs, dr) => {
      const free = L.free[i][dr];
      const y = Math.round(wp.y) + dr;
      for (const [off, frac, part] of runs) {
        const a0 = Math.round(x + wp.len * off), a1 = Math.round(x + wp.len * (off + frac));
        ctx.fillStyle = wp.tone[part];
        for (let k = 0; k < free.length; k += 2) {
          const lo = Math.max(a0, free[k]), hi = Math.min(a1, free[k + 1]);
          if (hi > lo) ctx.fillRect(lo, y, hi - lo, 1);
        }
      }
    });
  });

  // Swifts wheeling over the roof.
  ctx.fillStyle = '#2b2542';
  for (let i = 0; i < 3; i++) {
    const a = t * (0.35 + i * 0.07) + i * 2.1;
    const bx = Math.round(L.cx + Math.sin(a) * w * 0.34 + Math.sin(a * 2.3) * 8);
    const by = Math.round(L.fy(0.16 + i * 0.05) + Math.sin(a * 1.7) * 10 * L.s);
    const up = Math.sin(t * 14 + i * 3) > 0;
    ctx.fillRect(bx - 1, by + (up ? 0 : 1), 1, 1);
    ctx.fillRect(bx, by + (up ? 1 : 0), 1, 1);
    ctx.fillRect(bx + 1, by + (up ? 0 : 1), 1, 1);
  }

  // The Madonnina catches the sun every few seconds.
  const ph = (t % 4.2) / 0.6;
  if (ph < 1 && L.glint) {
    const k = Math.sin(ph * Math.PI);
    const arm = Math.round(1 + 2.4 * k);
    const { x, y } = L.glint;
    ctx.fillStyle = '#fff6d6';
    ctx.fillRect(x - arm, y, arm * 2 + 1, 1);
    ctx.fillRect(x, y - arm, 1, arm * 2 + 1);
    if (k > 0.7) {
      ctx.fillStyle = '#ffe39a';
      ctx.fillRect(x - 1, y - 1, 1, 1); ctx.fillRect(x + 1, y - 1, 1, 1);
      ctx.fillRect(x - 1, y + 1, 1, 1); ctx.fillRect(x + 1, y + 1, 1, 1);
    }
  }

  // Foreground pigeons peck twice every few seconds.
  pen.ctx = ctx;
  for (const p of L.pigeons) {
    if (!p.uncover) continue;
    const q = (t + p.anim) % 3.1;
    if (q > 0.6 || ((q * 6) | 0) % 2) continue;
    for (const [x, y, c] of p.uncover) pen.fill(x, y, 1, 1, c);
    sprite(pen, p.x, p.y - PIGEON_PECK.length + 1, p.face < 0 ? PIGEON_PECK_L : PIGEON_PECK, PIGEON);
  }
}

/** fill() straight onto the live canvas, for sprites in the animation layer. */
const pen = {
  ctx: null,
  fill(x, y, fw, fh, c) { this.ctx.fillStyle = c; this.ctx.fillRect(x, y, fw, fh); },
};

/* ------------------------------------------------------------------ */
/* Court floor: the same roof from above, in evening shade             */

// The roof ridge runs along the centre line and the slab courses step down
// from it toward each goal, cool slate in the shade. The low sun comes over
// the right parapet: it warms a band down that side, catches the edge of
// every step there, and the pinnacles standing on that parapet throw long,
// thin shadows back across it.
const warm = (hex, k) => mix(hex, '#ffc46a', k);
const SLAB = ['#29273a', '#2c293c', '#2e2a3a', '#272738'];
const CT = {
  slab: SLAB.map(col),
  lit: SLAB.map((c) => col(warm(c, 0.07))),
  joint: col('#1f1d2b'), jointLit: col(warm('#1f1d2b', 0.05)),
  nose: col('#2d2b3e'), noseLit: col('#5e4d40'),
  seam: col('#232130'), seamLit: col(warm('#232130', 0.08)),
  lip: col('#252333'), lipLit: col(warm('#252333', 0.08)),
  vein: col('#302e41'), veinLit: col(warm('#302e41', 0.1)),
  // The parapet: its outer drop, its coping, and the inner face — lit on
  // the left wall (it faces the sun), in shade on the right.
  wallOut: col('#15131d'), wallTop: col('#2f2b3c'), wallLit: col('#57493f'), wallSh: col('#1b1925'),
  // A pinnacle's buttress pier stepping out of the parapet, seen from above.
  pier: col('#332f40'), pierEdge: col('#24212f'), base: '#3b3646', baseLit: '#5f4f44',
};
const CPIGEON = { h: '#45404f', n: '#4f7068', w: '#625c72', b: '#524d61', t: '#36323f' };
const CPIGEON_ROWS = ['.h.', '.n.', 'wbw', 'bbb', 'bbb', '.t.'];

function courtLayout(w, h) {
  const s = w / 175;
  const E = Math.max(2, Math.round(3 * s));          // parapet wall
  const D = Math.max(2, Math.round(3 * s));          // how far a pier steps out of it
  const PL = Math.max(5, Math.round(11 * s)) | 1;    // pier length along the wall
  const R = Math.max(9, Math.round(26 * s));         // slab course
  // Each course is cut into slabs of random length; a joint column is -1.
  const slabs = [], tones = [], veins = [];
  for (let k = 0; k * R < h / 2 + R; k++) {
    const ids = new Int16Array(w);
    let x = -Math.floor(hash(k, 3) * R * 2);
    let id = 0;
    for (; x < w; id++) {
      const len = Math.round(R * (1.2 + hash(k, id + 11) * 1.0));
      for (let i = Math.max(0, x); i < Math.min(w, x + len); i++) ids[i] = i === x ? -1 : id;
      x += len;
    }
    const tone = new Uint8Array(id), vein = new Float32Array(id);
    for (let i = 0; i < id; i++) {
      tone[i] = (hash(k, i) * 4) | 0;
      const hv = hash(k, i + 100);
      vein[i] = hv < 0.4 ? hv : -1;                  // some slabs carry a vein
    }
    slabs.push(ids); tones.push(tone); veins.push(vein);
  }
  const peds = [];
  const step = Math.max(PL * 3, Math.round(h / 7.5));
  for (let i = 0; ; i++) {
    const yc = Math.round(h / 2 - (i + 0.5) * step);
    if (yc < PL) break;
    peds.push(yc);
  }
  // Two pigeons in the top half (mirrored into four), clear of the piers.
  // On a small court the art pixels are big and a pigeon would be the size
  // of the ball, so it stays empty.
  const pigeons = w < 120 ? [] : [
    { x: E + D + Math.round(6 * s), y: Math.round(h * 0.2) },
    { x: w - E - D - Math.round(12 * s), y: Math.round(h * 0.33) },
  ].map((p) => {
    while (peds.some((yc) => Math.abs(p.y + 3 - yc) < PL)) p.y += 2;
    return p;
  });
  return {
    w, h, s, E, D, PL, R, slabs, tones, veins, peds, pigeons,
    band: Math.round(w * 0.58), fade: Math.max(1, Math.round(3 * s)), shLen: Math.round(w * 0.36),
  };
}

/** Half-height of a pinnacle's shadow `u` pixels out from its pier: the pier, then the needle. */
function shadowHalf(C, u) {
  if (u < C.shLen * 0.4) return (C.PL >> 1) - 1 - (u > C.shLen * 0.3 ? 1 : 0);
  if (u < C.shLen * 0.75) return 1;
  return u < C.shLen ? 0 : -1;
}

function courtAt(C, x, y) {
  const { w, h, E, R } = C;
  const yy = y < h - 1 - y ? y : h - 1 - y;          // one half, reflected
  if (x < E) return x === 0 ? CT.wallOut : x === E - 1 ? CT.wallLit : CT.wallTop;
  if (x >= w - E) return x === w - 1 ? CT.wallOut : x === w - E ? CT.wallSh : CT.wallTop;

  // The warm band fades in over three clean dither steps, stops short of the
  // sliver of shade under the parapet, and is cut by the pinnacles' shadows.
  const t = x - C.band;
  let lit = x < w - E - 2 && (t >= C.fade * 3 || (t >= 0 && bay(x, yy) < (1 + ((t / C.fade) | 0)) / 4));
  if (lit) {
    const u = w - E - C.D - 1 - x;
    for (const yc of C.peds) {
      if (Math.abs(yy - yc) <= shadowHalf(C, u)) { lit = false; break; }
    }
  }

  // Courses run across the roof, counted out from the centre line: a dark
  // joint, then the step's edge, the slab, a shadowed lip.
  const dc = h / 2 - (yy + 0.5);
  const k = Math.min(Math.floor(dc / R), C.slabs.length - 1);
  const v = dc - k * R;
  const id = C.slabs[k][x];
  if (v < 1) return lit ? CT.jointLit : CT.joint;
  if (v < 2) return lit ? CT.noseLit : CT.nose;
  if (id < 0) return lit ? CT.seamLit : CT.seam;
  if (v >= R - 1) return lit ? CT.lipLit : CT.lip;
  // Marble veins: a wobbling sine band crossing some of the slabs.
  const hv = C.veins[k][id];
  if (hv >= 0) {
    const ph = hv * 40;
    const vv = Math.sin(x * 0.2 + yy * (0.25 + hv) + ph + 1.8 * Math.sin(yy * 0.15 + x * 0.05 + ph));
    if (vv < 0.05 && vv > -0.05) return lit ? CT.veinLit : CT.vein;
  }
  const tone = C.tones[k][id];
  return lit ? CT.lit[tone] : CT.slab[tone];
}

function paintCourt(ctx, w, h) {
  const C = remember(`c:${w}x${h}`, () => courtLayout(w, h));
  const g = surface(ctx, w, h);
  const half = Math.ceil(h / 2);
  for (let y = 0; y < half; y++) {
    for (let x = 0, row = y * w; x < w; x++) g.buf[row + x] = courtAt(C, x, y).u;
  }
  for (let y = half; y < h; y++) g.buf.copyWithin(y * w, (h - 1 - y) * w, (h - y) * w);
  // Every detail is painted twice, reflected, so both goals see the same roof.
  const m = { fill(x, y, fw, fh, c) { g.fill(x, y, fw, fh, c); g.fill(x, h - y - fh, fw, fh, c); } };
  const { E, D, PL } = C;
  const bs = Math.max(3, Math.round(E * 0.9) | 1);   // the pinnacle's own footing on the pier
  for (const yc of C.peds) {
    // Buttress piers stepping out of the parapet, part of the wall rather than
    // things on the floor: the pier's coping, its edges, and on it the square
    // footing of the pinnacle, its sun side lit.
    const y0 = yc - (PL >> 1);
    for (const left of [true, false]) {
      const x0 = left ? 1 : w - E - D, pw = E + D - 1;
      m.fill(x0, y0, pw, PL, CT.pier);
      m.fill(x0, y0, pw, 1, CT.pierEdge);
      m.fill(x0, y0 + PL - 1, pw, 1, CT.pierEdge);
      m.fill(left ? x0 + pw - 1 : x0, y0 + 1, 1, PL - 2, left ? CT.wallLit : CT.wallSh);
      const bx = left ? x0 + ((pw - bs) >> 1) : x0 + pw - bs - ((pw - bs) >> 1);
      const by = yc - (bs >> 1);
      m.fill(bx, by, bs, bs, CT.base);
      m.fill(bx + bs - 1, by, 1, bs, CT.baseLit);
    }
  }
  // Where a pigeon glances aside, the animation needs the floor under its head.
  for (const p of C.pigeons) p.under = [g.at(p.x + 1, p.y), g.at(p.x + 1, h - 1 - p.y)];
  for (const p of C.pigeons) sprite(m, p.x, p.y, CPIGEON_ROWS, CPIGEON);
  g.put();
}

function animateCourt(ctx, w, h, t) {
  const C = LAYOUTS.get(`c:${w}x${h}`);
  if (!C || !C.pigeons.length || !C.pigeons[0].under) return;
  // Each pigeon (and its reflection) pecks forward or glances aside now and
  // then; the rest pose is the static painting, so idle pigeons cost nothing.
  C.pigeons.forEach((p, i) => {
    [false, true].forEach((flip, f) => {
      const q = (t * 0.9 + i * 1.7 + f * 0.9) % 3;
      const hx = p.x + 1;
      const hy = flip ? h - 1 - p.y : p.y;
      if (q < 0.5 && ((q * 8) | 0) % 2 === 0) {
        ctx.fillStyle = CPIGEON.h;
        ctx.fillRect(hx, hy + (flip ? 1 : -1), 1, 1);
        ctx.fillStyle = CPIGEON.n;
        ctx.fillRect(hx, hy, 1, 1);
      } else if (q > 1.6 && q < 2.2) {
        ctx.fillStyle = p.under[f];
        ctx.fillRect(hx, hy, 1, 1);
        ctx.fillStyle = CPIGEON.h;
        ctx.fillRect(hx + (q < 1.9 ? -1 : 1), hy, 1, 1);
      }
    });
  });
}

export default {
  palette: { accent: '#ffcf5a', court: '#2e2b3a', line: 'rgba(255,214,150,0.5)' },
  backdrop: paintBackdrop,
  court: paintCourt,
  animateBackdrop,
  animateCourt,
};
