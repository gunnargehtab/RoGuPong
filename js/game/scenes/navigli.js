// RoGuPong — NAVIGLI NIGHT. The Naviglio Grande at blue hour, seen from a
// footbridge in one-point perspective: ochre, salmon and terracotta facades
// lit from below, terraces crowding both banks, lamps marching away to the
// vanishing point, and the canal throwing every light back as a long streak.
//
// The street is ray-cast a screen column at a time, like an old corridor
// shooter: each column meets the facade, the pavement and the embankment at
// one depth apiece, so building, bay and floor are simple lookups and a whole
// bank paints as a few thousand flat spans with no anti-aliased edge anywhere.
// The water is the same columns mirrored about the waterline at each depth
// (a reflection is a vertical flip in its own column), then broken into
// ripples; the streaks go on top, one per light.
//
// The court is the canal from the lamp posts' height: dark water, the same
// streaks running its length, the embankments with their terraces at the
// walls.

import { mulberry, clamp, mix, rect, disc, mirrorY } from './kit.js';

/* ------------------------------------------------------------------ */
/* The place, in metres: x across the canal, y up from the water, z away */

const CW = 9;          // canal half-width
const SL = 1.7;        // street level above the water
const FX = 16;         // facade line
const GF = 4.2;        // ground floor: bars, arches, awnings
const FH = 3.3;        // upper floors
const ZFAR = 520;      // where the street stops and the far city takes over
const LAMP_H = 4.6;    // lamp posts, above the street

/* ------------------------------------------------------------------ */
/* Palette                                                             */

const INK = '#120d18';          // wrought iron and silhouettes
const DUSK = '#1c2250';         // what upper floors fade into
const HAZE = '#533d5e';         // the far end of the canal, lit from below
const DEEP = '#030615';         // what reflections sink toward
const WIN = '#ffcf6a';
const WIN_HOT = '#ffe7a2';
const WIN_AMB = '#ee9442';
const WIN_OFF = '#1a2142';
const SHUT = '#2d4b36';
const BAR = '#ffb658';
const SHOP = '#a86a3a';
const GRILLE = '#352d3a';
const STREET = '#2c2029';
const WALL = '#3a2c34';
const COPING = '#6a5656';
const WALL_LT = '#433139';
const WALL_DK = '#33262f';
const WALL_WET = '#261c26';
const MORTAR = '#2a1f28';
const ALGAE = '#141c1c';
const LAMP = '#fff0bc';
const GLOW = '#ffc45c';
const AMBER = '#f39a3c';
const GOLD = '#ffd67a';
const EMBER = '#a4582c';
const RUST = '#5c3224';
const PINK = '#ff4fa6';
const CYAN = '#46eeff';
const MOON = '#f6e6b4';
const FACADES = ['#b8803e', '#c9a04e', '#bb6b4f', '#9c4e36', '#c6a67e', '#aa5d55'];
const NEAR_FACADES = ['#9c4e36', '#aa5d55', '#a0663a'];
const AWNINGS = [['#8a2a2c', '#6a1c22'], ['#2c5c3c', '#1e4230'], ['#c2ae88', '#9a8664']];
const UMBRELLAS = ['#cdb68c', '#8a2c30', '#2e5a3c', '#c9c0a8', '#2c3a64'];
const CLOTHES = ['#c8483c', '#3c6aa0', '#cdbf9f', '#2a2a36', '#6a4a8a', '#3a7a5a', '#b87838', '#8a2f4a', '#5a6a7a'];
const SKIN = ['#e8b894', '#c68a60', '#8a5a3c', '#f0c8a0'];
const LEGS = ['#1c1a2a', '#2a3048', '#3a2a24', '#161420'];
const SKY_HIGH = ['#04071a', '#091233', '#111e4e', '#1b2b64', '#2b3872'];
const SKY_LOW = ['#2b3872', '#4e4478', '#8e5068', '#d2704a', '#f4a650'];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */

// mix() parses hex every call; a scene this size asks for the same few
// hundred blends thousands of times.
const MIXES = new Map();
function mx(a, b, t) {
  const key = a + b + t;
  let c = MIXES.get(key);
  if (!c) { c = mix(a, b, t); MIXES.set(key, c); }
  return c;
}
const wet = (c, t = 0.42) => mx(c, DEEP, t);

/** A stateless hash to 0..1 — window lights and ripples by index, not by draw order. */
function hash(a, b, c) {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x2f1c2b35);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** One column of flat colour between two rows (either order), clipped to [lo, hi). */
function vspan(ctx, x, a, b, color, lo, hi) {
  let y0 = Math.round(a < b ? a : b);
  let y1 = Math.round(a < b ? b : a);
  if (y0 < lo) y0 = lo;
  if (y1 > hi) y1 = hi;
  if (y1 > y0) { ctx.fillStyle = color; ctx.fillRect(x, y0, 1, y1 - y0); }
}

/**
 * Light as colour math, the way the SNES did it: three stacked translucent
 * pixel discs, so a lamp tints whatever is behind it in crisp-edged bands
 * instead of scattering a dot grid over the façade.
 */
function glow(ctx, cx, cy, r, color, a = 0.13) {
  if (r < 1) return;
  ctx.globalAlpha = a;
  for (let k = 3; k >= 1; k--) disc(ctx, cx, cy, Math.max(1, Math.round((r * k) / 3)), color);
  ctx.globalAlpha = 1;
}

/** Fraction of [s - d/2, s + d/2] covered by windows of half-width `half`, one per bay. */
function cover(s, d, bay, half) {
  const F = (v) => {
    const j = Math.floor(v / bay);
    return j * 2 * half + clamp(v - j * bay - (bay / 2 - half), 0, 2 * half);
  };
  return (F(s + d / 2) - F(s - d / 2)) / d;
}

/**
 * A vertical banded gradient — flat bands, a checker seam at each boundary —
 * that also records each row's colour so the water can mirror it.
 */
function vbands(ctx, x, y, w, h, stops, steps, rows) {
  const total = (stops.length - 1) * steps;
  let prev = null;
  for (let k = 0; k < total; k++) {
    const seg = Math.floor(k / steps);
    const c = mx(stops[seg], stops[seg + 1], (k % steps) / steps);
    const y0 = y + Math.round((k / total) * h);
    const y1 = y + Math.round(((k + 1) / total) * h);
    if (y1 <= y0) continue;
    rect(ctx, x, y0, w, y1 - y0, c);
    for (let r = y0; r < y1; r++) rows[r] = c;
    if (prev && y1 - y0 > 2) {
      ctx.fillStyle = prev;
      for (let i = (k & 1); i < w; i += 2) ctx.fillRect(x + i, y0, 1, 1);
    }
    prev = c;
  }
}

/* ------------------------------------------------------------------ */
/* Camera                                                              */

/**
 * Portrait screens get a slightly taller world (fy > f): the canal is a
 * landscape subject, and a phone held upright would otherwise be half sky,
 * half water with a thin street between.
 */
function geometry(w, h) {
  const tall = h > w * 1.15;
  const f = 0.72 * Math.max(w, h * 0.75);
  return {
    w, h, tall, f,
    fy: f * (tall ? 1.45 : 1),
    cx: w / 2,
    vy: Math.round(h * (tall ? 0.48 : 0.47)),
    E: 5,                       // eye height above the water: on the bridge
  };
}
const sxOf = (G, X, z) => G.cx + (X * G.f) / z;
const syOf = (G, Y, z) => G.vy + ((G.E - Y) * G.fy) / z;

/* ------------------------------------------------------------------ */
/* The street, generated once                                          */

let WORLD = null;
function world() {
  if (WORLD) return WORLD;
  const r = mulberry(0x4e617669);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const person = () => {
    const top = pick(CLOTHES);
    return { top: mx(top, '#140f22', 0.3), topDk: mx(top, '#140f22', 0.55), skin: pick(SKIN), legs: pick(LEGS), hair: pick(LEGS) };
  };

  const banks = [-1, 1].map((side) => {
    const buildings = [];
    let z = 3;
    let last = -1;
    while (z < ZFAR + 30) {
      const len = 9 + r() * 11;
      const floors = 3 + Math.floor(r() * 3);
      let ci = Math.floor(r() * FACADES.length);
      if (ci === last) ci = (ci + 1) % FACADES.length;
      last = ci;
      buildings.push({
        z0: z, z1: z + len, floors, H: SL + GF + floors * FH + 0.5,
        // The nearest houses frame the view in the deeper reds, which keeps
        // the screen corners (and the HUD over them) darker than the canal.
        base: z < 32 ? NEAR_FACADES[ci % NEAR_FACADES.length] : FACADES[ci], pals: [],
        bay: 2.9 + r() * 0.8, off: r() * 3, seed: Math.floor(r() * 1e9),
        lit: 0.3 + r() * 0.4, shutters: r() < 0.75,
        balc: [r() < 0.5, r() < 0.3, r() < 0.2, r() < 0.1, false],
        bars: r() < 0.6 ? 0.55 : 0.25,
        awning: r() < 0.55 ? pick(AWNINGS) : null,
        chimney: 1 + r() * (len - 2), antenna: r() < 0.45 ? 1 + r() * (len - 2) : -9,
      });
      z += len;
    }

    // Everything that stands on the pavement, sorted far to near later.
    const things = [];
    for (let lz = 9 + (side > 0 ? 6 : 0); lz < ZFAR; lz += 12.5) {
      things.push({ kind: 'lamp', X: side * (CW + 0.45), z: lz });
    }
    for (const b of buildings) {
      if (r() < 0.55) things.push({ kind: 'wall', X: side * (FX - 0.3), z: (b.z0 + b.z1) / 2 + (r() - 0.5) * 3 });
    }
    // Terraces: tables and umbrellas against the bars and along the railing.
    for (let tz = 12 + r() * 4; tz < 330; tz += 5 + r() * 9) {
      const byCanal = r() < 0.45;
      things.push({
        kind: 'terrace', z: tz,
        X: side * (byCanal ? CW + 1.9 : FX - 2.1 - r() * 0.8),
        col: pick(UMBRELLAS), sit: [person(), person(), person()], n: 1 + Math.floor(r() * 3),
      });
    }
    // The crowd: strollers along the railing, people standing about.
    for (let pz = 10; pz < 380; pz += 0.7 + r() * 1.6) {
      const rail = r() < 0.45;
      things.push({
        kind: 'person', z: pz + r(),
        X: side * (rail ? CW + 0.5 + r() * 0.8 : CW + 1.2 + r() * (FX - CW - 2.4)),
        h: 1.55 + r() * 0.3, look: person(),
      });
    }
    return { side, buildings, things };
  });

  // Neon blade signs, sticking out of the facades so they face the canal.
  const signs = [
    { side: -1, z: 38, glyph: 'bar', col: PINK },
    { side: 1, z: 39.5, glyph: 'glass', col: CYAN },
    { side: 1, z: 82, glyph: 'bar', col: PINK },
    { side: -1, z: 104, glyph: 'glass', col: CYAN },
  ];
  for (const s of signs) {
    s.X = s.side * (FX - 1.1);
    banks[s.side < 0 ? 0 : 1].things.push({ kind: 'sign', z: s.z, X: s.X, sign: s });
  }
  for (const b of banks) b.things.sort((a, c) => c.z - a.z);

  // A covered tour boat moored along the left bank, as in every postcard.
  WORLD = { banks, signs, bridges: [64, 165], boats: [{ side: -1, z0: 33, z1: 51 }] };
  return WORLD;
}

/** A building's colours at one of three distances, plus their reflections. */
function palette(b, fog) {
  let p = b.pals[fog];
  if (p) return p;
  const t = [0, 0.3, 0.56][fog];
  const tone = (c) => (t ? mx(c, HAZE, t) : c);
  const mid = mx(b.base, DUSK, 0.5);
  p = {
    lit: tone(b.base), mid: tone(mid), top: tone(mx(b.base, DUSK, 0.72)),
    line: tone(mx(b.base, '#fff1d0', 0.2)), eave: tone('#1c1220'), roof: tone('#2e1d25'),
    win: tone(WIN), hot: tone(WIN_HOT), amb: tone(WIN_AMB), off: tone(WIN_OFF), shut: tone(SHUT),
    iron: tone(INK), frame: tone('#5a3a24'), bar: tone(BAR), shop: tone(SHOP), grille: tone(GRILLE),
    winHalf: tone(mx(WIN_AMB, mid, 0.4)), offHalf: tone(mx(WIN_OFF, mid, 0.45)),
    awnA: b.awning ? tone(b.awning[0]) : null, awnB: b.awning ? tone(b.awning[1]) : null,
  };
  // The reflection: the same façade sunk into the water, lit windows holding
  // their colour longest.
  const r = {};
  for (const k of Object.keys(p)) r[k] = p[k] && wet(p[k], 0.5);
  r.win = wet(p.win, 0.3); r.hot = wet(p.hot, 0.3); r.amb = wet(p.amb, 0.34);
  p.r = r;
  b.pals[fog] = p;
  return p;
}

/* ------------------------------------------------------------------ */
/* Façade columns                                                      */

function paintFacade(ctx, G, x, zf, b, P, mirror, lo, hi) {
  const k = G.fy / zf;
  const vy = G.vy;
  const E = G.E;
  const H = b.H;
  const put = mirror
    ? (Ya, Yb, c) => vspan(ctx, x, vy + (E + Ya) * k, vy + (E + Yb) * k, c, lo, hi)
    : (Ya, Yb, c) => vspan(ctx, x, vy + (E - Ya) * k, vy + (E - Yb) * k, c, lo, hi);
  const dz = (zf * zf) / (FX * G.f);          // metres of façade in this column
  const near = dz < 0.3;
  const s = zf - b.z0;

  // Roof, chimney, antenna, eave.
  const chim = Math.abs(s - b.chimney) < Math.max(0.45, dz / 2);
  put(H, H + (chim ? 2.9 : 1.3), P.roof);
  if (Math.abs(s - b.antenna) < Math.max(0.12, dz / 2)) put(H + 1.3, H + 4.2, P.iron);
  put(H - 0.4, H, P.eave);
  // Walls, darkening upward away from the lamps.
  const top = H - 0.4;
  put(SL, Math.min(SL + 7, top), P.lit);
  if (top > SL + 7) put(SL + 7, Math.min(SL + 11.2, top), P.mid);
  if (top > SL + 11.2) put(SL + 11.2, top, P.top);
  put(top - 0.35, top, P.line);                 // cornice
  put(SL + GF - 0.25, SL + GF, P.line);         // string course
  if (near && s < 0.28) { put(SL, top, P.iron); return; }   // drainpipe at the party wall

  // Upper floors: tall windows, green shutters, the odd iron balcony.
  const ss = s - b.off;
  const j = Math.floor(ss / b.bay);
  const aw = Math.abs(ss - j * b.bay - b.bay / 2);
  const cw = near ? (aw < 0.6 ? 1 : 0) : cover(ss, dz, b.bay, 0.6);
  for (let fl = 0; fl < b.floors; fl++) {
    const Yb = SL + GF + fl * FH;
    const hv = hash(b.seed, fl, j);
    const lit = hv < b.lit;
    const balc = b.balc[fl];
    const sill = balc ? Yb + 0.15 : Yb + 0.8;
    if (cw >= 0.55) {
      const c = lit ? (hv < b.lit * 0.22 ? P.hot : hv < b.lit * 0.5 ? P.amb : P.win) : (hv > 0.82 ? P.shut : P.off);
      put(sill, Yb + 2.75, c);
      put(Yb + 2.75, Yb + 2.95, P.line);
      if (dz < 0.2 && (lit || hv > 0.82)) {
        if (aw < 0.08) put(sill, Yb + 2.75, lit ? P.frame : P.iron);
        put(Yb + 2.05, Yb + 2.2, lit ? P.frame : P.iron);
      }
    } else if (cw >= 0.2) {
      put(sill, Yb + 2.75, lit ? P.winHalf : P.offHalf);
    } else if (near && b.shutters && aw < 1.02 && lit) {
      put(sill, Yb + 2.75, P.shut);
    }
    if (balc && aw < 1.3 && dz < 0.8) {
      put(Yb, Yb + 0.18, P.line);
      put(Yb + 0.95, Yb + 1.08, P.iron);
      // Balusters on every other column: without them a balcony seen at an
      // angle is just a stray dark slash across the wall.
      if ((x & 1) === 0) put(Yb + 0.18, Yb + 0.95, P.iron);
    }
  }

  // Ground floor: arched openings, most of them bars.
  const kind = hash(b.seed, 77, j);
  const og = near ? (aw < 1.05 ? 1 : 0) : cover(ss, dz, b.bay, 1.05);
  if (og >= 0.5) {
    const isBar = kind < b.bars;
    const c = isBar ? P.bar : kind < b.bars + 0.2 ? P.shop : P.grille;
    const arch = near ? 0.45 * Math.sqrt(Math.max(0, 1 - (aw / 1.05) ** 2)) : 0.25;
    put(SL, SL + 3.0 + arch, c);
    // People inside, against the light.
    if (isBar && near && hash(b.seed, j, x) < 0.4) put(SL, SL + 1.5 + hash(x, j, 3) * 0.4, P.iron);
  }
  if (b.awning && (aw < 1.35 || hash(b.seed, 78, j) < 0.7) && hash(b.seed, 79, j) > 0.2) {
    put(SL + 3.4, SL + 3.95, (Math.floor(ss / 0.45) & 1) ? P.awnA : P.awnB);
  }
}

/* ------------------------------------------------------------------ */
/* Layout: everything that has a screen position, shared with animation */

/**
 * One light's reflection as a stack of short horizontal dashes: continuous
 * under the light, then thinning toward the viewer. Gaps and widths are
 * chosen per ripple band, not per row, so near the viewer the streak breaks
 * into strokes rather than salt.
 */
function streakDashes(G, rip, s) {
  const { x, y0, ym, y1, id } = s;
  const up = Math.max(1, ym - y0);
  const down = Math.max(1, y1 - ym);
  const out = [];
  let prevB = -1;
  for (let y = Math.round(y0); y < y1; y++) {
    const d = y - G.vy;
    const b = rip.band[d];
    const I = (y < ym ? 0.45 + 0.55 * ((y - y0) / up) : Math.exp(-((y - ym) / down) * 2.2)) * s.s;
    if (hash(id, b, 21) > 0.25 + 0.75 * Math.min(1, I * 1.6)) continue;
    // The first row of a band is its crest: the full width. The rows under
    // it narrow, which rounds each stroke off.
    const crest = b !== prevB || d < 75;
    prevB = b;
    const wide = hash(id, b, 23) < 0.15 ? 2 : 0;
    const wd = Math.max(1, (I > 0.6 ? 3 : I > 0.3 ? 2 : 1) + wide - (crest ? 0 : 1));
    const jit = hash(id, b, 22);
    const xo = x - (wd >> 1) + rip.sh[d] + (jit < 0.15 ? -1 : jit > 0.85 ? 1 : 0);
    const ci = I > 0.75 ? 0 : I > 0.5 ? 1 : I > 0.3 ? 2 : I > 0.14 ? 3 : 4;
    out.push({ x: xo, y, wd, ci });
  }
  return out;
}

/** Per screen column, the rows the moored boat (and its reflection) cover. */
function boatCover(G, bt) {
  const cover = [];
  const Xi = CW - 2.3;
  const Xo = CW - 0.3;
  for (let x = 0; x < G.w; x++) {
    const u = (bt.side < 0 ? G.cx - x - 0.5 : x + 0.5 - G.cx) / G.f;
    if (u <= 0) continue;
    const z = Xi / u;
    if (z < bt.z0 || z > bt.z1) continue;
    const k = G.fy / z;
    cover[x] = [Math.floor(G.vy + (G.E - 2.05) * (G.fy * u) / Xo), Math.ceil(G.vy + (G.E + 2.05) * k)];
  }
  return cover;
}

const LAYOUTS = new Map();
function layout(w, h) {
  const key = `${w}x${h}`;
  let L = LAYOUTS.get(key);
  if (L) return L;
  const G = geometry(w, h);
  const W = world();
  const streaks = [];
  const lamps = [];
  const wallBase = (x) => G.vy + (G.E * G.fy * Math.abs(x + 0.5 - G.cx)) / (G.f * CW);

  // The swell, row by row below the horizon: how far each row of water
  // shifts sideways (reflections wobble with it), and which ripple band it
  // belongs to. Bands grow taller toward the viewer, so a streak breaks
  // into single-row flecks far off and into fat strokes up close.
  const below = h - G.vy;
  const rip = { sh: new Int8Array(below), band: new Int32Array(below) };
  for (let d = 1, acc = 0; d < below; d++) {
    const z = (G.E * G.fy) / d;
    rip.sh[d] = Math.round(Math.sin(z * 3.1 + Math.sin(z * 0.7) * 2) * clamp(9 / z, 0.3, 3));
    acc += 1 / clamp(d / 75, 1, 3.2);
    rip.band[d] = Math.floor(acc);
  }

  const addStreak = (x, Y, z, strength, cols, id) => {
    if (x < 0 || x >= w) return;
    const y0 = Math.max(wallBase(x), G.vy + 1);
    const ym = G.vy + ((G.E + Y) * G.fy) / z;
    const tail = Math.min(h, ym + (ym - G.vy) * (1.1 + strength * 2.4));
    if (y0 >= h || tail <= y0) return;
    const st = { x, y0, ym: Math.max(ym, y0 + 1), y1: tail, s: strength, cols, id };
    st.dashes = streakDashes(G, rip, st);
    streaks.push(st);
  };

  let id = 0;
  for (const bank of W.banks) {
    for (const t of bank.things) {
      if (t.kind === 'lamp' || t.kind === 'wall') {
        const x = Math.round(sxOf(G, t.X, t.z));
        if (x < -4 || x > w + 4) continue;
        const Y = SL + (t.kind === 'lamp' ? LAMP_H : 5);
        const lampObj = { x, y: syOf(G, Y, t.z), z: t.z, wall: t.kind === 'wall' };
        lamps.push(lampObj);
        const st = clamp(1.25 - t.z / 170, 0.12, 1) * (t.kind === 'wall' ? 0.6 : 1);
        addStreak(x, Y, t.z, st, WARM, id++);
      }
    }
  }
  const signs = [];
  for (const s of W.signs) {
    const x = Math.round(sxOf(G, s.X, s.z));
    const sc = (0.2 * G.f) / s.z;
    const glyph = sc >= 0.75 ? GLYPHS[s.glyph] : null;
    const gw = glyph ? glyph[0].length : 1;
    const gh = glyph ? glyph.length : Math.max(2, Math.round((2.2 * G.fy) / s.z));
    const yc = syOf(G, SL + 5.2, s.z);
    const sg = { ...s, x0: Math.round(x - gw / 2), y0: Math.round(yc - gh / 2), glyph, gw, gh };
    signs.push(sg);
    const cols = s.col === PINK ? NEON_PINK : NEON_CYAN;
    addStreak(Math.round(sg.x0 + gw / 2 - 0.5), SL + 5.2, s.z, 0.8, cols, id++);
  }

  // The nearest string of bulbs is placed on screen (it belongs in the top
  // strip, above the court); the farther ones hang where the street puts them.
  const strings = [];
  const zNear = 15;
  const lowY = h * (G.tall ? 0.112 : 0.1);
  const Ynear = G.E - ((lowY - G.vy) * zNear) / G.fy + 1.6;
  strings.push({ z: zNear, Y: Ynear, sag: 1.6 });
  strings.push({ z: 46, Y: 11.5, sag: 1.2 });
  strings.push({ z: 120, Y: 11, sag: 1 });
  const bulbs = [];
  for (const st of strings) {
    for (let X = -FX + 0.5; X <= FX - 0.5; X += 1.05) {
      const x = Math.round(sxOf(G, X, st.z));
      if (x < 0 || x >= w) continue;
      const t = X / FX;
      const y = Math.round(syOf(G, st.Y - st.sag * (1 - t * t), st.z)) + 1;
      bulbs.push({ x, y, big: st.z < 30, z: st.z });
    }
  }

  // Stars, and the handful that twinkle.
  const rs = mulberry(0x57a25);
  const stars = [];
  const n = Math.round((w * h) / 2200);
  for (let i = 0; i < n; i++) {
    const x = Math.floor(rs() * w);
    const y = Math.floor(rs() * rs() * G.vy * 0.6);
    stars.push({ x, y, bright: rs() < 0.18 });
  }

  // The moon sits in the top strip on a phone, in the gap between the
  // rooftops on a wide screen (the top strip there belongs to the bulbs).
  const moon = {
    x: Math.round(w * (G.tall ? 0.63 : 0.6)),
    y: Math.round(h * (G.tall ? 0.072 : 0.2)),
    r: Math.max(3, Math.round(Math.min(w, h) * 0.022)),
  };

  // The dashes that shimmer: on the brighter streaks, nearer than the first
  // bridge (beyond it the water is crowded with things painted over it), and
  // clear of the moored boat.
  const cut = G.vy + ((G.E - SL + 0.6) * G.fy) / W.bridges[0] + 2;
  const boat = boatCover(G, W.boats[0]);
  for (const st of streaks) {
    st.shim = st.s < 0.4 ? [] : st.dashes.filter((d, i) => (i & 3) === 0 && d.ci < 4 && d.y > cut &&
      !(boat[d.x] && d.y >= boat[d.x][0] && d.y < boat[d.x][1]) &&
      !(boat[d.x + d.wd] && d.y >= boat[d.x + d.wd][0] && d.y < boat[d.x + d.wd][1]));
  }

  L = { G, rip, streaks, lamps, signs, strings, bulbs, stars, moon };
  // One entry per canvas size; a handful covers rotation and fullscreen,
  // and a desktop drag-resize must not grow this without bound.
  if (LAYOUTS.size >= 8) LAYOUTS.delete(LAYOUTS.keys().next().value);
  LAYOUTS.set(key, L);
  return L;
}

const WARM = [LAMP, GOLD, AMBER, EMBER, RUST];
const NEON_PINK = ['#ffc0e4', PINK, '#c0307e', '#7a1f54', '#46183a'];
const NEON_CYAN = ['#c8ffff', CYAN, '#26a8c0', '#17606e', '#123a48'];

const GLYPHS = {
  // A vertical BAR, letters stacked the way blade signs run.
  bar: ['111', '101', '110', '101', '111', '000', '010', '101', '111', '101', '101', '000', '110', '101', '110', '101', '101'],
  glass: ['1111111', '1000001', '0100010', '0010100', '0001000', '0001000', '0001000', '0111110'],
};

/* ------------------------------------------------------------------ */
/* Sprites                                                             */

function figure(ctx, x, yF, hp, look) {
  const H = Math.round(hp);
  if (H < 1) return;
  if (H <= 2) { rect(ctx, x, yF - H, 1, H, look.top); return; }
  if (H <= 5) {
    rect(ctx, x, yF - H, 1, 1, look.skin);
    const body = Math.ceil((H - 1) / 2);
    rect(ctx, x, yF - H + 1, 1, body, look.top);
    rect(ctx, x, yF - H + 1 + body, 1, H - 1 - body, look.legs);
    return;
  }
  const hh = Math.max(1, Math.round(H * 0.15));
  const th = Math.max(2, Math.round(H * 0.38));
  const lh = H - hh - th;
  const tw = Math.max(2, Math.round(H * 0.27));
  const hw = Math.max(1, Math.round(tw * 0.55));
  const x0 = Math.round(x - tw / 2);
  const hx = Math.round(x - hw / 2);
  let y = yF - H;
  rect(ctx, hx, y, hw, hh, look.skin);
  if (hh >= 2) rect(ctx, hx, y, hw, 1, look.hair);
  y += hh;
  rect(ctx, x0, y, tw, th, look.top);
  if (tw >= 4) {
    rect(ctx, x0, y + 1, 1, th - 1, look.topDk);
    rect(ctx, x0 + tw - 1, y + 1, 1, th - 1, look.topDk);
  }
  y += th;
  const lw = Math.max(1, Math.floor(tw / 2));
  rect(ctx, x0, y, lw, lh, look.legs);
  rect(ctx, x0 + tw - lw, y, lw, lh, look.legs);
  if (tw - 2 * lw > 0) rect(ctx, x0 + lw, y, tw - 2 * lw, Math.ceil(lh * 0.3), look.legs);
}

function paintLamp(ctx, G, t) {
  const x = Math.round(sxOf(G, t.X, t.z));
  const px = G.f / t.z;
  const py = G.fy / t.z;
  if (t.kind === 'wall') {
    const y = syOf(G, SL + 5, t.z);
    glow(ctx, x, y, Math.min(12, Math.max(2, Math.round(1.5 * px))), GLOW);
    const lw = Math.max(1, Math.round(0.35 * px));
    rect(ctx, x - (lw >> 1), y - lw, lw, lw + (lw > 1 ? 1 : 0), LAMP);
    return;
  }
  const yB = syOf(G, SL, t.z);
  const yT = syOf(G, SL + LAMP_H, t.z);
  const pw = Math.max(1, Math.round(0.14 * px));
  const lw = Math.max(1, Math.round(0.45 * px));
  const lh = Math.max(1, Math.round(0.62 * py));
  glow(ctx, x, yT - lh / 2, Math.min(15, Math.max(2, Math.round(1.8 * px))), GLOW);
  rect(ctx, x - (pw >> 1), yT, pw, yB - yT, INK);
  rect(ctx, x - (lw >> 1), yT - lh, lw, lh, LAMP);
  if (lw >= 3) rect(ctx, x - (lw >> 1), yT - lh, lw, 1, GOLD);
  if (lh >= 3) rect(ctx, x - (lw >> 1) - 1, yT - lh - 1, lw + 2, 1, INK);
}

function paintPool(ctx, G, t) {
  // Warm light on the paving under a lamp: two bands of tint, clipped to the
  // pavement so none of it lands on the water.
  if (G.f / t.z < 2) return;
  const side = Math.sign(t.X);
  const y0 = Math.round(syOf(G, SL, t.z + 3));
  const y1 = Math.round(syOf(G, SL, t.z - 3));
  ctx.fillStyle = '#ff9a4a';
  for (let y = y0; y < y1; y++) {
    const zr = ((G.E - SL) * G.fy) / (y + 0.5 - G.vy);
    const dz = zr - t.z;
    for (const [k, a] of [[0.9, 0.1], [0.5, 0.12]]) {
      const hw = Math.sqrt(Math.max(0, 9 - dz * dz)) * k;
      if (hw <= 0) continue;
      const Xa = clamp(t.X - hw, side < 0 ? -FX : CW, side < 0 ? -CW : FX);
      const Xb = clamp(t.X + hw, side < 0 ? -FX : CW, side < 0 ? -CW : FX);
      const xa = Math.round(sxOf(G, Xa, zr));
      const xb = Math.round(sxOf(G, Xb, zr));
      ctx.globalAlpha = a;
      ctx.fillRect(Math.min(xa, xb), y, Math.abs(xb - xa), 1);
    }
  }
  ctx.globalAlpha = 1;
}

function paintTerrace(ctx, G, t) {
  const px = G.f / t.z;
  const py = G.fy / t.z;
  const x = sxOf(G, t.X, t.z);
  const yS = syOf(G, SL, t.z);
  if (py < 1.5) {
    rect(ctx, x, yS - 2, 1, 1, t.col);
    rect(ctx, x, yS - 1, 1, 1, GOLD);
    return;
  }
  // Seated people, the table, then the umbrella over them all.
  for (let i = 0; i < t.n; i++) {
    const off = [-0.62, 0.62, 0.05][i];
    figure(ctx, Math.round(x + off * px), Math.round(yS - 0.1 * py), 1.3 * py, t.sit[i]);
  }
  const tw = Math.max(1, Math.round(0.85 * px));
  const ty = Math.round(syOf(G, SL + 0.75, t.z));
  rect(ctx, Math.round(x - tw / 2), ty, tw, 1, '#d8b888');
  rect(ctx, Math.round(x), ty + 1, 1, Math.max(0, Math.round(yS) - ty - 1), INK);
  rect(ctx, Math.round(x), ty - 1, 1, 1, GOLD);                       // candle
  const yb = syOf(G, SL + 2.3, t.z);
  const yt = syOf(G, SL + 2.95, t.z);
  rect(ctx, Math.round(x), Math.round(yb), 1, ty - Math.round(yb), INK);     // pole
  const r0 = Math.round(yt);
  const r1 = Math.max(r0 + 1, Math.round(yb));
  for (let y = r0; y < r1; y++) {
    const f = (y - r0 + 1) / (r1 - r0);
    const hw = Math.max(1, Math.round((0.25 + 1.2 * f) * px));
    const c = y === r1 - 1 && r1 - r0 > 1 ? mx(t.col, GOLD, 0.35) : y === r0 ? mx(t.col, '#ffffff', 0.15) : t.col;
    rect(ctx, Math.round(x - hw), y, hw * 2 + 1, 1, c);
  }
}

function paintSign(ctx, G, sg) {
  const { x0, y0, gw, gh, glyph, col } = sg;
  ctx.globalAlpha = 0.12;
  rect(ctx, x0 - 4, y0 - 3, gw + 8, gh + 6, col);
  rect(ctx, x0 - 2, y0 - 2, gw + 4, gh + 4, col);
  ctx.globalAlpha = 1;
  if (!glyph) { rect(ctx, x0, y0, 1, gh, col); return; }
  rect(ctx, x0 - 1, y0 - 1, gw + 2, gh + 2, '#1a1026');
  // Bracket back to the wall.
  const wx = sg.side < 0 ? x0 - 1 - 2 : x0 + gw + 1;
  rect(ctx, wx, y0 + 1, 2, 1, INK);
  rect(ctx, wx, y0 + gh - 2, 2, 1, INK);
  paintGlyph(ctx, sg, col, sg.glyph === 'glass' ? '#ff4fa6' : null);
}

function paintGlyph(ctx, sg, col, olive) {
  ctx.fillStyle = col;
  for (let j = 0; j < sg.gh; j++) {
    const row = sg.glyph[j];
    for (let i = 0; i < sg.gw; i++) if (row[i] === '1') ctx.fillRect(sg.x0 + i, sg.y0 + j, 1, 1);
  }
  if (olive) rect(ctx, sg.x0 + 3, sg.y0 + 2, 1, 1, olive);
}

function paintBridge(ctx, G, z, mirror) {
  // An iron footbridge: arched girder, lattice parapet, a lamp at each end.
  const half = CW + 1;
  const k = G.fy / z;
  const yOf = mirror ? (Y) => G.vy + (G.E + Y) * k : (Y) => G.vy + (G.E - Y) * k;
  const xa = Math.round(sxOf(G, -half, z));
  const xb = Math.round(sxOf(G, half, z));
  const iron = mirror ? '#060817' : INK;
  const lit = mirror ? wet(EMBER, 0.4) : '#3a2a30';
  for (let x = xa; x <= xb; x++) {
    const X = ((x + 0.5 - G.cx) * z) / G.f;
    const t = X / half;
    const Yd = SL + 1.1 + 0.7 * (1 - t * t);
    const Ya = SL - 0.6 + 2.2 * Math.sqrt(Math.max(0, 1 - t * t));
    const yd = Math.round(yOf(Yd));
    const yr = Math.round(yOf(Yd + 1.15));
    const ya = Math.round(yOf(Math.min(Ya, Yd)));
    const lo = Math.min(yd, yr);
    const hi = Math.max(yd, yr);
    rect(ctx, x, yr, 1, 1, iron);                             // hand rail
    rect(ctx, x, mirror ? yd - 1 : yd, 1, 2, iron);           // deck
    rect(ctx, x, ya, 1, 1, iron);                             // arch
    // In the water the lattice and struts blur away: deck, rail and arch
    // are all a reflection keeps, and the ripples break those up.
    if (mirror) continue;
    for (let y = lo + 1; y < hi; y++) {
      if (((x + y) % 3 === 0) || ((x - y) % 3 === 0)) rect(ctx, x, y, 1, 1, iron);
    }
    if (x % 3 === 0) vspan(ctx, x, yd, ya, iron, -1e9, 1e9);
    if (Math.abs(t) < 0.9 && x % 7 === 0) rect(ctx, x, yd + 1, 1, 1, lit);
  }
  // Lamps at the ends.
  for (const X of [-half, half]) {
    const x = Math.round(sxOf(G, X, z));
    const y = Math.round(yOf(SL + 3.4));
    if (!mirror) {
      rect(ctx, x, y, 1, Math.round(yOf(SL + 1.2)) - y, INK);
      glow(ctx, x, y, 3, GLOW);
      rect(ctx, x, y - 1, 1, 2, LAMP);
    }
  }
}

function paintBoat(ctx, G, bt) {
  // Ray-cast like the banks: each column meets the boat's canal-side flank at
  // one depth. Hull, lit cabin, the pale roof seen from the bridge, and the
  // whole thing again upside down, ragged with ripples.
  const Xi = CW - 2.3;
  const Xo = CW - 0.3;
  const { w, h, cx, vy, f, fy, E } = G;
  for (let x = 0; x < w; x++) {
    const u = (bt.side < 0 ? cx - x - 0.5 : x + 0.5 - cx) / f;
    if (u <= 0) continue;
    const z = Xi / u;
    if (z < bt.z0 || z > bt.z1) continue;
    const k = fy / z;
    const y = (Y) => vy + (E - Y) * k;
    const m = (Y) => vy + (E + Y) * k;
    const s = z - bt.z0;
    const post = s % 1.5 < 0.28 || s < 0.4 || bt.z1 - z < 0.4;
    vspan(ctx, x, vy + (E - 2.05) * (fy * u) / Xo, y(2.05), '#77758c', 0, h);   // roof, from above
    vspan(ctx, x, y(2.05), y(1.85), '#a8a4b4', 0, h);
    vspan(ctx, x, y(1.85), y(0.95), post ? '#2a2838' : '#e0a458', 0, h);         // cabin glass, lit
    vspan(ctx, x, y(0.95), y(0.7), '#8e8a98', 0, h);
    vspan(ctx, x, y(0.7), y(0), '#1a2240', 0, h);                                // hull
    vspan(ctx, x, y(0.55), y(0.45), '#6a6a80', 0, h);
    // Reflection, broken into dashes.
    const r0 = Math.round(m(0));
    const r1 = Math.min(h, Math.round(m(2.05)));
    for (let yy = r0; yy < r1; yy++) {
      if (hash(x, yy, 97) < 0.3) continue;
      const Y = (yy + 0.5 - vy) / k - E;
      const c = Y < 0.7 ? '#0a0f22' : Y < 0.95 ? '#34324a' : Y < 1.85 ? (post ? '#141424' : '#7a5236') : '#3e3c52';
      rect(ctx, x, yy, 1, 1, c);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Backdrop                                                            */

function paintBackdrop(ctx, w, h) {
  const L = layout(w, h);
  const G = L.G;
  const W = world();
  const { cx, vy, f, fy, E } = G;

  // Sky: deep blue overhead, the last of the sunset low behind the city.
  const rows = new Array(h);
  const split = Math.round(vy * 0.7);
  vbands(ctx, 0, 0, w, split, SKY_HIGH, 3, rows);
  vbands(ctx, 0, split, w, vy - split, SKY_LOW, 3, rows);

  // Water: the sky mirrored about the horizon, sunk a shade deeper.
  const waterRows = new Array(h);
  for (let y = vy; y < h; y++) {
    const m = 2 * vy - y - 1;
    const c = wet(m >= 0 ? rows[m] : rows[0], m > split ? 0.3 : 0.4);
    waterRows[y] = c;
    rect(ctx, 0, y, w, 1, c);
  }

  // Stars and a thin moon.
  for (const s of L.stars) rect(ctx, s.x, s.y, 1, 1, s.bright ? '#dfe6ff' : '#6f7fc0');
  const mo = L.moon;
  glow(ctx, mo.x, mo.y, mo.r * 3, '#6a7ad0', 0.06);
  disc(ctx, mo.x, mo.y, mo.r, MOON);
  const bite = Math.max(1, Math.round(mo.r * 0.55));
  for (let j = -mo.r; j <= mo.r; j++) {
    const yy = mo.y + j - 1;
    const half = Math.round(Math.sqrt(Math.max(0, mo.r * mo.r - j * j)));
    rect(ctx, mo.x - half - bite, yy, half * 2 + 1, 1, rows[clamp(yy, 0, h - 1)]);
  }

  // The far city at the end of the canal, and its reflection.
  const rc = mulberry(0xc17e);
  for (let i = 0; i < 18; i++) {
    const z = 1300 + rc() * 400;
    const X = (rc() - 0.5) * 420;
    const bw = 16 + rc() * 34;
    const bh = 20 + rc() * rc() * 110;
    const x0 = Math.round(sxOf(G, X - bw / 2, z));
    const x1 = Math.max(x0 + 1, Math.round(sxOf(G, X + bw / 2, z)));
    const yT = Math.round(syOf(G, bh, z));
    const c = i % 3 ? '#2a2552' : '#342a58';
    rect(ctx, x0, yT, x1 - x0, vy + 1 - yT, c);
    rect(ctx, x0, vy + 1, x1 - x0, Math.max(1, Math.round((vy - yT) * 0.5)), wet(c, 0.35));
    for (let y = yT + 1; y < vy - 1; y += 2) {
      for (let x = x0; x < x1; x++) if (hash(i, x, y) < 0.18) rect(ctx, x, y, 1, 1, '#c88c48');
    }
    if (bh > 90) rect(ctx, Math.round((x0 + x1) / 2), yT - 1, 1, 1, '#ff4a3a');
  }

  // The banks, a column at a time, reflections included.
  for (const bank of W.banks) {
    const bl = bank.buildings;
    let bi = 0;
    const left = bank.side < 0;
    for (let i = 0; ; i++) {
      const x = left ? i : w - 1 - i;
      const u = left ? (cx - x - 0.5) / f : (x + 0.5 - cx) / f;
      if (u <= 0) break;
      const zw = CW / u;
      if (zw > ZFAR) break;
      const zf = FX / u;
      const kW = fy / zw;
      const yWT = vy + (E - SL) * kW;
      const yWB = vy + E * kW;
      const fog = zf > 200 ? 2 : zf > 80 ? 1 : 0;
      const reflLo = Math.round(yWB + SL * kW) + 1;
      if (zf <= ZFAR) {
        while (bi < bl.length - 1 && bl[bi].z1 < zf) bi++;
        const b = bl[bi];
        const P = palette(b, fog);
        paintFacade(ctx, G, x, zf, b, P, false, 0, h);
        paintFacade(ctx, G, x, zf, b, P.r, true, reflLo, h);
        vspan(ctx, x, syOf(G, SL, zf), yWT, fog ? mx(STREET, HAZE, 0.25 * fog) : STREET, 0, h);
      } else {
        vspan(ctx, x, syOf(G, SL, ZFAR), yWT, mx(STREET, HAZE, 0.5), 0, h);
      }
      // Embankment: coping stone, coursed stone, a dark line of weed at the water.
      const wt = Math.round(yWT);
      const wb = Math.round(yWB);
      vspan(ctx, x, wt, wb, fog ? mx(WALL, HAZE, 0.2 * fog) : WALL, 0, h);
      if (wb - wt >= 12) masonry(ctx, x, zw, kW, yWB, bank.side, (zw * zw) / (CW * f), h);
      if (wb - wt >= 3) {
        vspan(ctx, x, wt, wt + 1, COPING, 0, h);
        vspan(ctx, x, wb - 1, wb, ALGAE, 0, h);
      }
      // …and the embankment again, upside down in the water.
      vspan(ctx, x, wb, reflLo, wet(WALL, 0.45), 0, h);
      if (reflLo - wb >= 3) vspan(ctx, x, reflLo - 2, reflLo - 1, wet(COPING, 0.5), 0, h);
    }
  }

  // Bridge reflections go down before the ripples so they break up too.
  for (const z of W.bridges) paintBridge(ctx, G, z, true);

  ripple(ctx, G, L.rip, waterRows);

  // Light streaks: one per lamp and sign, broken into ripple dashes.
  for (const s of L.streaks) paintStreak(ctx, s);
  for (const bt of W.boats) paintBoat(ctx, G, bt);

  // Everything on the pavements, far to near, then the railing in front.
  for (const bank of W.banks) {
    for (const t of bank.things) {
      const x = sxOf(G, t.X, t.z);
      if (x < -30 || x > w + 30) continue;
      if (t.kind === 'lamp') { paintPool(ctx, G, t); paintLamp(ctx, G, t); }
      else if (t.kind === 'wall') paintLamp(ctx, G, t);
      else if (t.kind === 'terrace') paintTerrace(ctx, G, t);
      else if (t.kind === 'person') {
        const py = G.fy / t.z;
        figure(ctx, Math.round(x), Math.round(syOf(G, SL, t.z)), t.h * py, t.look);
      } else if (t.kind === 'sign') {
        paintSign(ctx, G, L.signs.find((s) => s.z === t.z && s.side === t.sign.side));
      }
    }
  }
  paintRailings(ctx, G);
  for (let i = W.bridges.length - 1; i >= 0; i--) paintBridge(ctx, G, W.bridges[i], false);
  paintStrings(ctx, L);
}

/**
 * The embankment close up: three courses of ashlar, each block its own shade
 * of stone, joints staggered course to course, a wet band at the waterline
 * and a thicker coping on top. dz is the metres of wall one column covers.
 */
function masonry(ctx, x, z, k, yW, side, dz, h) {
  const y = (Y) => yW - Y * k;
  vspan(ctx, x, y(0), y(0.32), WALL_WET, 0, h);
  for (let c = 0; c < 3; c++) {
    const Ya = 0.32 + c * 0.42;
    const off = c * 0.37 + (side > 0 ? 0.2 : 0);
    const j = Math.floor((z + off) / 0.85);
    if (j !== Math.floor((z - dz + off) / 0.85)) {
      vspan(ctx, x, y(Ya), y(Ya + 0.42), MORTAR, 0, h);
      continue;
    }
    const tone = hash(j, c, side);
    if (tone > 0.6) vspan(ctx, x, y(Ya), y(Ya + 0.42), tone > 0.82 ? WALL_LT : WALL_DK, 0, h);
    vspan(ctx, x, y(Ya), y(Ya) + 1, MORTAR, 0, h);
  }
  vspan(ctx, x, y(SL - 0.2), y(SL), COPING, 0, h);
  vspan(ctx, x, y(SL - 0.2) - 1, y(SL - 0.2), WALL_DK, 0, h);
}

/** Row wobble and ripple dashes over the whole water. */
function ripple(ctx, G, rip, waterRows) {
  const { w, h, cx, vy, f, fy, E } = G;
  const snap = document.createElement('canvas');
  snap.width = w;
  snap.height = h - vy;
  snap.getContext('2d').drawImage(ctx.canvas, 0, vy, w, h - vy, 0, 0, w, h - vy);
  ctx.imageSmoothingEnabled = false;
  const span = (d) => {
    const half = (d * CW * f) / (E * fy);
    return [Math.max(0, Math.ceil(cx - half) + 1), Math.min(w, Math.floor(cx + half) - 1)];
  };
  // Row wobble, bigger nearer: rows sharing a shift and a span move as one
  // blit from the snapshot.
  let run = null;
  const flush = () => {
    if (run && run.sh) {
      const ww = run.xr - run.xl;
      ctx.drawImage(snap, run.xl, run.d, ww, run.n, run.xl + run.sh, vy + run.d, ww, run.n);
    }
    run = null;
  };
  for (let d = 1; d < h - vy; d++) {
    const [xl, xr] = span(d);
    if (xr - xl < 3) { flush(); continue; }
    const sh = rip.sh[d];
    if (run && run.sh === sh && run.xl === xl && run.xr === xr) run.n++;
    else { flush(); run = { d, n: 1, xl, xr, sh }; }
  }
  flush();
  // Dashes of bare water break the reflections into strokes; a few lighter
  // ones catch the sky.
  for (let y = vy + 1; y < h; y++) {
    const [xl, xr] = span(y - vy);
    if (xr - xl < 3) continue;
    const near = clamp((9 * (y - vy)) / (E * fy), 0.3, 3);
    const c = waterRows[y];
    const len = Math.max(2, Math.round(2 + near * 3));
    const n = Math.ceil((xr - xl) / (len * 2.8));
    ctx.fillStyle = c;
    for (let i = 0; i < n; i++) {
      const x = xl + Math.floor(hash(y, i, 11) * (xr - xl));
      ctx.fillRect(x, y, Math.round(len * (0.5 + hash(i, y, 12))), 1);
    }
    if (hash(y, 5, 13) < 0.5) {
      ctx.fillStyle = mx(c, '#5a6ab0', 0.18);
      ctx.fillRect(xl + Math.floor(hash(y, 6, 14) * (xr - xl)), y, len + 1, 1);
    }
  }
}

function paintStreak(ctx, s) {
  // A hotter core down the middle of the wider strokes.
  for (const d of s.dashes) {
    rect(ctx, d.x, d.y, d.wd, 1, s.cols[d.ci]);
    if (d.wd >= 3 && d.ci > 0) rect(ctx, d.x + (d.wd >> 1), d.y, 1, 1, s.cols[d.ci - 1]);
  }
}

function paintRailings(ctx, G) {
  const { w, cx, vy, f, fy, E } = G;
  for (let x = 0; x < w; x++) {
    const u = Math.abs(x + 0.5 - cx) / f;
    if (u <= 0) continue;
    const zw = CW / u;
    if (zw > ZFAR) continue;
    const k = fy / zw;
    const yT = vy + (E - SL) * k;
    const yR = vy + (E - SL - 1.05) * k;
    const dzw = (zw * zw) / (CW * f);
    if (dzw < 0.5) {
      vspan(ctx, x, yR, yR + 1, INK, 0, G.h);
      if ((x & 1) === 0 || Math.floor(zw / 2.4) !== Math.floor((zw + dzw) / 2.4)) vspan(ctx, x, yR, yT, INK, 0, G.h);
    } else {
      vspan(ctx, x, yR, yT, (x & 1) ? INK : '#2a1e28', 0, G.h);
    }
  }
}

function paintStrings(ctx, L) {
  const G = L.G;
  for (const st of L.strings) {
    let prev = null;
    for (let x = 0; x < G.w; x++) {
      const X = ((x + 0.5 - G.cx) * st.z) / G.f;
      if (Math.abs(X) > FX) { prev = null; continue; }
      const t = X / FX;
      const y = Math.round(syOf(G, st.Y - st.sag * (1 - t * t), st.z));
      const a = prev === null ? y : prev;
      vspan(ctx, x, Math.min(a, y), Math.max(a, y) + 1, '#241722', 0, G.h);
      prev = y;
    }
  }
  for (const b of L.bulbs) {
    if (b.big) {
      // A round little glow, not a sparkle: a 4x4 blob with the corners off.
      rect(ctx, b.x - 2, b.y - 1, 2, 1, EMBER);
      rect(ctx, b.x - 3, b.y, 4, 2, EMBER);
      rect(ctx, b.x - 2, b.y + 2, 2, 1, EMBER);
      rect(ctx, b.x - 2, b.y, 2, 2, GOLD);
      rect(ctx, b.x - 2, b.y, 1, 1, LAMP);
    } else {
      rect(ctx, b.x, b.y, 1, 1, b.z < 80 ? GOLD : AMBER);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Court floor: the canal from above                                   */

// Deep blue water, darkest in the lee of each wall and a shade of sky down
// the middle. Every value here sits far below the ball and the paddles; the
// streaks and terraces carry the place in small warm steps.
const C_WATER = ['#050a1f', '#081027', '#0b1530', '#0e1a39'];
const C_RIPPLE = ['#111f45', '#15264f'];
const C_WARM = ['#7c5228', '#5e3f24', '#432e22', '#2b2026', '#1c1728'];
const C_PINK = ['#72285a', '#54204c', '#3a1b40', '#281734', '#1a1430'];
const C_CYAN = ['#236874', '#1c4e5c', '#163848', '#122838', '#0e1a30'];
const C_PAVE = ['#1b1520', '#161119'];
const C_RAIL = '#07060c';
const C_POST = '#3c3036';
const C_COPE = '#2c2533';
const C_TABLE = '#433428';
const C_CHAIR = '#262030';
const C_CANDLE = '#c48a42';
const C_POOL = '#ffb060';
// Parasols seen from above: canopy, shaded rim, a glint of lamplight. The
// pale canvas ones sink furthest, or they would read as pale discs.
const C_UMB = UMBRELLAS.map((c) => {
  const k = parseInt(c.slice(1, 3), 16) > 0xb0 ? 0.74 : 0.56;
  return [mix(c, '#0c0a18', k), mix(c, '#0c0a18', k + 0.15), mix(c, '#0c0a18', k - 0.12)];
});
const C_HEADS = ['#5a4032', '#3a2c2a', '#2a2230', '#6a4a38'];
const streakCols = (s) => (s.neon === 'p' ? C_PINK : s.neon === 'c' ? C_CYAN : C_WARM);

const COURT = new Map();
function courtLayout(w, h) {
  const key = `${w}x${h}`;
  let C = COURT.get(key);
  if (C) return C;
  const r = mulberry(0xca4a1);
  const eb = clamp(Math.round(w * 0.055), 3, 10);
  const pave = eb - 2;
  const half = Math.ceil(h / 2);
  const inner = w - eb * 2;

  // Lamps on each railing, staggered so the two banks don't mirror.
  const lamps = [];
  const step = Math.max(16, Math.round(half * 0.36));
  for (const side of [-1, 1]) {
    for (let y = Math.round(step * (side < 0 ? 0.3 : 0.8)); y < half - 3; y += step) lamps.push({ side, y });
  }

  // Terraces along the paving: parasols from above, bare tables between.
  const terraces = [];
  if (pave >= 4) {
    for (const side of [-1, 1]) {
      const rt = mulberry(side < 0 ? 0x7e11 : 0x7e12);
      // A bar's parasols come in a run of two or three of one colour.
      let run = 0;
      let col = null;
      for (let y = 1 + Math.floor(rt() * 3); y < half - 3;) {
        if (run > 0 || (pave >= 6 && rt() < 0.3)) {
          if (run <= 0) { run = 2 + Math.floor(rt() * 2); col = C_UMB[Math.floor(rt() * C_UMB.length)]; }
          run--;
          terraces.push({ side, umb: true, x: pave - 6 + Math.floor(rt() * 2), y, col });
          y += run > 0 ? 5 + Math.floor(rt() * 2) : 7 + Math.floor(rt() * 3);
        } else {
          const x = Math.floor(rt() * (pave - 3)) + 1;
          terraces.push({ side, umb: false, x, y, candle: rt() < 0.6, heads: [rt() < 0.7, rt() < 0.5, rt() < 0.4], hc: Math.floor(rt() * C_HEADS.length) });
          y += 4 + Math.floor(rt() * 3);
        }
      }
    }
  }

  // Streaks hug the banks, where the lights are; mid-canal keeps the dark of
  // the sky, which leaves the centre ring and the ball's path clean. Each is
  // a stack of short horizontal dashes — the lamp's light broken by ripples —
  // brightest at the goal end and calming toward the centre line.
  const streaks = [];
  const nS = clamp(Math.round(inner / 20), 4, 9);
  for (let i = 0; i < nS; i++) {
    const side = i % 2 ? 1 : -1;
    const d = 0.04 + Math.pow(r(), 1.7) * 0.28;
    let x = Math.round(side < 0 ? eb + 1 + d * inner : w - 2 - eb - d * inner);
    // Keep a little water between neighbours, or two lights read as one smear.
    while (streaks.some((o) => Math.abs(o.x - x) < 5)) x -= side * 5;
    const s = { x, neon: i === 2 ? 'p' : i === 5 ? 'c' : null, id: i, s: 0.95 - d * 1.2 + r() * 0.15, phase: r() * 100, len: 0.5 + r() * 0.5 };
    s.y0 = Math.round(half * (1 - s.len) * 0.6);
    // Strokes of two rows and a trough: a crest at full width, the row under
    // it narrower, then a row of bare water.
    s.dashes = [];
    for (let y = s.y0 + (i % 3); y < half - 1; y += 3) {
      const swell = 0.72 + 0.28 * Math.sin(y * 0.05 + s.phase);
      const calm = y > half * 0.64 ? Math.max(0.15, 1 - (y - half * 0.64) / (half * 0.36)) : 1;
      const I = s.s * swell * calm;
      if (hash(s.id, y, 41) > 0.3 + I * 0.85) continue;
      const hw = Math.min(2, Math.floor(hash(s.id, y, 43) * (0.7 + I * 2.4)));
      const cx = x + Math.round(Math.sin(y * 0.13 + s.phase) * 1.2);
      const ci = I > 0.72 ? 0 : I > 0.52 ? 1 : I > 0.32 ? 2 : 3;
      s.dashes.push({ y, x: cx - hw, wd: hw * 2 + 1, ci });
      if (hw > 0) s.dashes.push({ y: y + 1, x: cx - hw + 1, wd: hw * 2 - 1, ci: Math.min(3, ci + 1) });
    }
    streaks.push(s);
  }
  C = { eb, pave, half, streaks, lamps, terraces };
  if (COURT.size >= 8) COURT.delete(COURT.keys().next().value);
  COURT.set(key, C);
  return C;
}

function paintCourt(ctx, w, h) {
  const C = courtLayout(w, h);
  const { eb, half } = C;

  // Water: darkest in the lee of each embankment, a shade of sky mid-canal,
  // the steps between them checkered.
  const band = (d) => (d < 1 ? 0 : d < 3 ? 1 : d < 9 ? 2 : 3);
  for (let x = 0; x < w; x++) rect(ctx, x, 0, 1, half, C_WATER[band(Math.min(x - eb, w - 1 - eb - x))]);
  for (let x = eb; x < w - eb; x++) {
    const d = Math.min(x - eb, w - 1 - eb - x);
    if (d === 3 || d === 9) {
      ctx.fillStyle = C_WATER[band(d) - 1];
      for (let y = x & 1; y < half; y += 2) ctx.fillRect(x, y, 1, 1);
    }
  }
  // Ripple dashes, barely lighter than the water.
  const n = Math.max(1, Math.round((w - eb * 2) / 20));
  for (let y = 0; y < half; y++) {
    for (let i = 0; i < n; i++) {
      if (hash(y, i, 31) < 0.55) continue;
      const x = eb + 3 + Math.floor(hash(i, y, 32) * (w - eb * 2 - 8));
      rect(ctx, x, y, 2 + Math.floor(hash(y, i, 33) * 5), 1, C_RIPPLE[hash(y, i, 34) < 0.2 ? 1 : 0]);
    }
  }
  // The reflection streaks: a bright core, dimmer wings.
  for (const s of C.streaks) {
    const cols = streakCols(s);
    for (const d of s.dashes) {
      if (d.wd > 1) rect(ctx, d.x, d.y, d.wd, 1, cols[d.ci + 1]);
      rect(ctx, d.x + (d.wd >> 1), d.y, 1, 1, cols[d.ci]);
    }
  }

  for (const side of [-1, 1]) paintEmbankment(ctx, w, C, side);
  mirrorY(ctx, w, h);
}

function paintEmbankment(ctx, w, C, side) {
  const { eb, pave, half } = C;
  // Everything here is drawn as the left bank; box() mirrors it for the right.
  const box = (x, y, ww, hh, c) => {
    if (x < 0) { ww += x; x = 0; }
    if (ww > 0) rect(ctx, side < 0 ? x : w - x - ww, y, ww, hh, c);
  };

  // Paving with a joint every few rows.
  box(0, 0, pave, half, C_PAVE[0]);
  for (let y = 2; y < half; y += 4) box(0, y, pave, 1, C_PAVE[1]);

  // Terraces: parasols seen from above, bare tables with heads round them
  // and a candle. Small, muted and round-edged, so nothing here passes for a
  // crate or a ball.
  for (const t of C.terraces) {
    if (t.side !== side) continue;
    if (t.umb) {
      // A flat round canopy, its shaded rim toward the water.
      const [c, dk, hi] = t.col;
      box(t.x + 1, t.y, 3, 1, c);
      box(t.x, t.y + 1, 5, 3, c);
      box(t.x + 1, t.y + 4, 3, 1, dk);
      box(t.x + 4, t.y + 2, 1, 2, dk);
      box(t.x + 1, t.y + 1, 1, 1, hi);
    } else {
      box(t.x, t.y, 2, 2, C_TABLE);
      if (t.heads[0]) box(t.x - 1, t.y, 1, 1, C_HEADS[t.hc]);
      if (t.heads[1]) box(t.x + 2, t.y + 1, 1, 1, C_HEADS[(t.hc + 1) % 4]);
      if (t.heads[2]) box(t.x + 1, t.y + 2, 1, 1, C_CHAIR);
      if (t.candle) box(t.x + (t.hc & 1), t.y + (t.hc >> 1 & 1), 1, 1, C_CANDLE);
    }
  }

  // Railing with its posts, the coping stone at the water.
  box(pave, 0, 1, half, C_RAIL);
  for (let y = 1; y < half; y += 3) box(pave, y, 1, 1, C_POST);
  box(eb - 1, 0, 1, half, C_COPE);

  // Lamps: a pool of warm light over paving, railing and the edge of the
  // water (two banded discs of tint), a glint on the water under the wall,
  // and the lamp head itself.
  for (const l of C.lamps) {
    if (l.side !== side) continue;
    const hr = Math.max(3, Math.round(eb * 0.65));
    const reach = pave + hr + 1;
    ctx.fillStyle = C_POOL;
    for (const [k, a] of [[1, 0.07], [0.55, 0.09]]) {
      const rr = Math.max(2, Math.round(hr * k));
      ctx.globalAlpha = a;
      for (let j = -rr; j <= rr; j++) {
        const hw = Math.round(Math.sqrt(rr * rr - j * j));
        const x0 = Math.max(0, pave - hw);
        const x1 = Math.min(reach, pave + hw + 1);
        if (x1 > x0 && l.y + j >= 0) box(x0, l.y + j, x1 - x0, 1, null);
      }
    }
    ctx.globalAlpha = 1;
    for (let j = -3; j <= 4; j++) {
      if (hash(l.y, j, 44) < 0.35) continue;
      const len = 1 + Math.floor(hash(l.y, j, 45) * (4 - Math.abs(j) * 0.6));
      box(eb + Math.floor(hash(l.y, j, 46) * 2), l.y + j * 2, Math.max(1, len), 1, Math.abs(j) < 2 ? C_WARM[0] : C_WARM[1]);
    }
    box(pave - 1, l.y, 2, 2, '#b07a3a');
    box(pave, l.y, 1, 1, GOLD);
  }
}

/* ------------------------------------------------------------------ */
/* Animation                                                           */

/**
 * The pink BAR signs' duty cycle — a buzz, a dropout, the odd stutter —
 * shared with their streak on the court so the two blink together.
 */
function neonOff(t) {
  const beat = t % 4.2;
  return (beat > 3.1 && beat < 3.25) || (beat > 3.4 && beat < 3.9) || hash(7, Math.floor(t * 20), 71) < 0.04;
}

function animateBackdrop(ctx, w, h, t) {
  const L = layout(w, h);
  // Shimmer: a swell rolls down every bright streak toward the viewer,
  // lifting the strokes it passes a step brighter and a pixel wider.
  for (const s of L.streaks) {
    for (const d of s.shim) {
      if (Math.sin(d.y * 0.33 - t * 2.1 + s.id * 1.7) < 0.88) continue;
      rect(ctx, d.x - (d.y & 1), d.y, d.wd + 1, 1, s.cols[Math.max(0, d.ci - 1)]);
    }
  }
  // Two lamps with a loose connection.
  let f = 0;
  for (const l of L.lamps) {
    if (l.wall || l.z < 30 || l.z > 90 || f >= 2) continue;
    f++;
    const on = hash(f, Math.floor(t * 9), 61) > 0.12;
    rect(ctx, l.x, Math.round(l.y) - 2, 1, 2, on ? LAMP : EMBER);
  }
  // The pink BAR sign buzzes and drops out now and then.
  if (neonOff(t)) {
    for (const sg of L.signs) if (sg.glyph && sg.col === PINK) paintGlyph(ctx, sg, '#4a1c3a', null);
  }
  // A few bulbs and stars twinkle.
  for (let i = 0; i < L.bulbs.length; i += 5) {
    const b = L.bulbs[i];
    if (Math.sin(t * 2.3 + i * 1.7) > 0.55) rect(ctx, b.x - (b.big ? 2 : 0), b.y, b.big ? 2 : 1, b.big ? 2 : 1, LAMP);
  }
  for (let i = 0; i < L.stars.length; i += 6) {
    const s = L.stars[i];
    if (Math.sin(t * 1.3 + i) > 0.7) rect(ctx, s.x, s.y, 1, 1, '#ffffff');
  }
}

function animateCourt(ctx, w, h, t) {
  const C = courtLayout(w, h);
  // A swell rolls along each streak toward the goals, lifting the dashes it
  // passes one step brighter; the pink one is also lit by its sign, and goes
  // dim when the sign drops out. Both halves alike.
  const pinkOn = !neonOff(t);
  for (const s of C.streaks) {
    const cols = streakCols(s);
    const ds = s.dashes;
    for (let i = s.id % 3; i < ds.length; i += 3) {
      const d = ds[i];
      if (Math.sin(d.y * 0.42 + t * 2.4 + s.phase) < 0.88) continue;
      const c = d.ci > 0 ? cols[d.ci - 1] : cols[0];
      rect(ctx, d.x, d.y, d.wd, 1, c);
      rect(ctx, d.x, h - 1 - d.y, d.wd, 1, c);
    }
    if (s.neon === 'p' && pinkOn) {
      for (let i = 1; i < ds.length; i += 3) {
        const d = ds[i];
        const c = cols[Math.max(0, d.ci - 1)];
        rect(ctx, d.x + (d.wd >> 1), d.y, 1, 1, c);
        rect(ctx, d.x + (d.wd >> 1), h - 1 - d.y, 1, 1, c);
      }
    }
  }
  // A lamp or two on a loose connection.
  for (let i = 1; i < C.lamps.length; i += 3) {
    const l = C.lamps[i];
    const on = hash(i, Math.floor(t * 8), 91) > 0.15;
    const x = l.side < 0 ? C.pave : w - 1 - C.pave;
    rect(ctx, x, l.y, 1, 1, on ? LAMP : EMBER);
    rect(ctx, x, h - 1 - l.y, 1, 1, on ? LAMP : EMBER);
  }
}

export default {
  palette: { accent: '#ffb347', court: '#111a35', line: 'rgba(255,190,110,0.5)' },

  backdrop(ctx, w, h) {
    ctx.imageSmoothingEnabled = false;
    paintBackdrop(ctx, w, h);
  },

  court(ctx, w, h) {
    ctx.imageSmoothingEnabled = false;
    paintCourt(ctx, w, h);
  },

  animateBackdrop,
  animateCourt,
};
