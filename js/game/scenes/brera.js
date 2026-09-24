// RoGuPong — BRERA ARCADE. The cortile d'onore of the Palazzo di Brera on a
// clear morning: two storeys of round arches on paired columns wrapping three
// sides of the courtyard, warm stone under a deep blue sky with a few combed
// wisps of cirrus, and Canova's bronze Napoleon on his tall pedestal in the
// middle of the paving. The one daytime stage — soft light, gentle value
// bands, and the only real darks are the cool shade inside the arcades.
//
// The courtyard is ray-cast one art pixel at a time into a palette-index
// buffer. A pixel's ray meets the back wall, a side wing or the paving. On a
// facade it is tested against the wall's front face, then the free-standing
// columns (widened by the viewing angle, so a wing seen edge-on closes up into
// a wall of shafts the way a real colonnade does), then the wall's back face —
// which is what paints the arch soffits and reveals — and only a ray that
// clears all three carries on into the shade of the portico. The buffer goes
// to the canvas in one putImageData.
//
// The court is the same paving from above, in the arcade's shade: the same
// harlequin of diagonal slabs at a whisper, a pebble border, the compass rose
// inlaid at the centre, and the column pairs down both walls with their soft
// shadows on the stone.
//
// The animation is as quiet as the place: a cloud's shade drifting over the
// paving, a few pigeons crossing the sky and pecking by the statue.

import { mulberry, clamp, lerp } from './kit.js';

/* ------------------------------------------------------------------ */
/* Palette                                                             */

const PAL = [
  // 0–5 sky, zenith to roofline: deep, but never pale where the HUD sits
  '#193c83', '#1f4893', '#2754a2', '#3061b0', '#3c6fbc', '#4b7fc6',
  // 6–8 cirrus: veil, body, sunlit tops
  '#7394d0', '#adc2e6', '#dfe8f4',
  // 9–15 warm stone, light to dark
  '#f0e2c3', '#e2cda2', '#d1b88b', '#bca073', '#a1865e', '#836c4e', '#65533f',
  // 16–20 the cool shade of the porticoes, light to dark
  '#7a7689', '#5e5b70', '#474559', '#343346', '#242335',
  // 21–23 granite shafts: lit, turned, shade
  '#f5f0e5', '#d8d0c1', '#aca393',
  // 24–25 gutter and roof
  '#3f2c25', '#6e4431',
  // 26–31 paving, light to dark
  '#b7aa95', '#a69883', '#938672', '#7c7160', '#665c50', '#50483f',
  // 32–35 bronze, dark to patina; 36–37 the gilt Victory
  '#151a18', '#27302b', '#3f4d44', '#63796a', '#e2bb55', '#9b7a32',
  // 38–39 marble scholars in the portico shade
  '#a9a5b3', '#858194',
  // 40–48 the court: the paving from above, in shade
  '#39322b', '#322c26', '#2c2722', '#25211d', '#1e1b18', '#17151a', '#433a31', '#52483c', '#675b4c',
];

const SKY = 0, CIR = 6, ST = 9, SH = 16, GR = 21, GUT = 24, TILE = 25, PV = 26;
const BZ = 32, GOLD = 36, GOLD_D = 37, MARB = 38, MARB_D = 39, CF = 40;

// The palette packed as the canvas stores pixels (RGBA bytes, read as one
// 32-bit word in the platform's byte order).
const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const PACKED = new Uint32Array(PAL.map((hex) => {
  const n = parseInt(hex.slice(1), 16);
  const r = n >>> 16, g = (n >>> 8) & 255, b = n & 255;
  return LITTLE ? ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((n << 8) | 255) >>> 0;
}));

/**
 * Paint a palette-index buffer onto the canvas in one call. Like the painters
 * it works a row per call, which the engine optimises sooner than one long
 * loop — the first, cold paint is the one that costs.
 */
function flush(ctx, buf, w, h) {
  const img = ctx.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  for (let i = 0; i < buf.length; i += w) unpack(px, buf, i, i + w);
  ctx.putImageData(img, 0, 0);
}

function unpack(px, buf, a, b) {
  for (let i = a; i < b; i++) px[i] = PACKED[buf[i]];
}

/**
 * A step on a ramp: `v` is a fractional tone, and the half-way zone between
 * two steps is a checkerboard — flat bands with 16-bit seams, never a blend.
 */
function ramp(base, n, v, chk) {
  const i = Math.floor(v + (chk ? 0.62 : 0.38));
  return base + (i < 0 ? 0 : i >= n ? n - 1 : i);
}
const shadeTone = (v, chk) => ramp(SH, 5, v, chk);
const paveTone = (v, chk) => ramp(PV, 6, v, chk);

/** Integer hash → 0..1: per-slab and per-pebble choices that never drift. */
function hash(a, b, seed = 0) {
  let t = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x165667b1, 0x85ebca6b) ^ Math.imul(seed, 0x9e3779b1);
  t ^= t >>> 15; t = Math.imul(t, 0x2c1b3c6d);
  t ^= t >>> 12; t = Math.imul(t, 0x297a2d39);
  t ^= t >>> 15;
  return (t >>> 0) / 4294967296;
}

/**
 * Value noise, read from a block of hashed lattice values covering just the
 * range one painting needs: the cirrus takes tens of thousands of lookups,
 * and a table is far cheaper than hashing four corners for each. `fa` and
 * `fb` scale the combed (along, across) pixel coordinates the cirrus uses.
 */
function lattice(w, yEnd, fa, fb, seed) {
  const ax = Math.floor(-0.54 * yEnd * fa) - 1, bx = Math.ceil(0.84 * w * fa) + 2;
  const ay = -1, by = Math.ceil((0.54 * w + 0.84 * yEnd) * fb) + 2;
  const nx = bx - ax;
  const t = new Float32Array(nx * (by - ay));
  for (let iy = ay, i = 0; iy < by; iy++) for (let ix = ax; ix < bx; ix++, i++) t[i] = hash(ix, iy, seed);
  return { t, nx, ax, ay };
}

function vnoise(N, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const t = N.t, i = (iy - N.ay) * N.nx + (ix - N.ax);
  const a = t[i], b = t[i + 1], c = t[i + N.nx], d = t[i + N.nx + 1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/* ------------------------------------------------------------------ */
/* The courtyard, in metres: x across, y up, z away from the eye       */

const D = 30;          // the back wall
const HW = 10;         // half the courtyard, eye to either arcade face
const EYE = 3.5;       // standing on the entrance steps
const PORT = 4.5;      // portico depth, arcade face to inner wall
const PITCH = 4;       // column pair to column pair
const ZS = 17;         // the statue, a little past the middle of the paving
const ROOF = 16.25;    // top of the gutter

// Ground storey: paired Doric columns under round arches.
const G_PLINTH = 0.3, G_IMPOST = 4.75, G_SPRING = 5.3, G_R = 1.28, G_TOP = 8.15;
// Upper loggia: balustrade, paired Ionic columns, arches, the main cornice.
const U_PED = 9.2, U_IMPOST = 12.45, U_SPRING = 12.85, U_R = 1.26;

const BACK = 0, LEFT = 1, RIGHT = 2;
const OPEN = -1;

/**
 * Fit the courtyard to the canvas: on a phone the back wall takes a little
 * under half the width, so the wings still show their arcades down both
 * edges; on a landscape screen it takes a little under half the height and
 * the wings fill the open sides. The bay pitch is snapped to whole art
 * pixels so every back-wall bay is identical.
 */
const layouts = new Map();
let lastLayout = null;
function layout(w, h) {
  if (lastLayout && lastLayout.w === w && lastLayout.h === h) return lastLayout;
  const key = `${w}x${h}`;
  let L = layouts.get(key);
  if (L) return (lastLayout = L);
  const tA = clamp((w / h - 0.55) / 0.85, 0, 1);      // 0 portrait → 1 landscape
  let s = Math.min((0.23 * w) / HW, (lerp(0.26, 0.43, tA) * h) / ROOF);
  const pitch = Math.max(8, Math.round(s * PITCH));
  s = pitch / PITCH;                                    // px per metre at the back wall
  const f = s * D;
  const baseY = h * lerp(0.645, 0.735, tA);
  L = { w, h, s, f, cx: w / 2, vy: baseY - EYE * s, baseY, roofY: baseY - ROOF * s, bw: HW * s };
  // One entry per canvas size; a handful covers rotation and fullscreen,
  // and a desktop drag-resize must not grow this without bound.
  if (layouts.size >= 8) layouts.delete(layouts.keys().next().value);
  layouts.set(key, L);
  return (lastLayout = L);
}

/* ------------------------------------------------------------------ */
/* Facades                                                             */

/**
 * The wall's front face at (u along the facade, y up): a stone palette index,
 * or OPEN where the arcade lets the ray through. `cot` is how obliquely the
 * ray meets the wall — blocks that stand proud (imposts, pedestals) show
 * their side faces when seen at an angle, so they widen by it.
 */
function wall(u, y, cot, sn, lit, corner, fp) {
  const k = Math.round((u - 2) / PITCH);
  const pc = 2 + k * PITCH;
  const e = u - pc;
  const ae = e < 0 ? -e : e;
  const a = 2 - ae;                       // distance from the arch axis
  // Tones are whole steps of the stone ramp: 0 sunlit edges, 1 the loggia's
  // face, 2 the ground storey's (a little less sky reaches it), 3 lines and
  // side faces, 4 the undersides of cornices. `lit` darkens a wing in shade.
  const st = ST + lit;
  if (y < G_PLINTH) return y > G_PLINTH - 0.09 ? st + 1 : st + 3;
  if (y < G_TOP) {
    if (y < G_IMPOST) return corner ? st + 2 : OPEN;
    if (y < G_SPRING) {
      if (ae < 0.72 + 0.35 * cot || corner) {
        if (y > G_SPRING - 0.1) return st;
        if (y < G_IMPOST + 0.07) return st + 3;
        return ae > 0.72 ? st + 3 : st + 1;
      }
      return OPEN;
    }
    const dy = y - G_SPRING;
    const r2 = a * a + dy * dy;
    if (!corner) {
      if (r2 < G_R * G_R) return OPEN;
      if (r2 < 1.55 * 1.55) return r2 < 1.35 * 1.35 ? st + 3 : st + 1;   // archivolt
      if (a < 0.19 && dy < 1.95) return st;                          // keystone
    }
    if (y < 7.0) return st + 2;                                          // spandrel
    if (y < 7.3) return y < 7.06 ? st + 3 : st + 1;                       // architrave
    if (y < 7.85) return st + 2;                                         // frieze
    if (y < 7.96) return st + 4;                                         // under the cornice
    return st;
  }
  if (y < U_PED) {
    if (ae < 0.72 + 0.3 * cot || corner) {                              // pedestals
      if (y > U_PED - 0.14) return st;
      if (y < G_TOP + 0.14) return st + 3;
      return ae > 0.72 ? st + 3 : st + 2;
    }
    if (y < 8.35) return st + 2;                                         // plinth rail
    if (y > 9.0) return y > 9.12 ? st : st + 1;                       // handrail
    if (y > 8.93) return OPEN;                                          // shade under it
    // Balusters, vase-turned where they are big enough to show it; seen
    // edge-on they close ranks into a solid screen.
    const t = (y - 8.35) / 0.6;
    const bulge = fp > 0.14 ? 0.5 : t < 0.35 ? t / 0.35 : Math.max(0, 1 - (t - 0.35) / 0.45);
    const hw = (0.09 + 0.08 * bulge) / sn;
    let q = (u - pc) / 0.5;
    q = (q - Math.floor(q)) - 0.5;
    const aq = (q < 0 ? -q : q) * 0.5;
    if (aq < hw) return aq > hw * 0.45 && q > 0 ? st + 3 : st + 1;
    return OPEN;
  }
  if (y < U_IMPOST) return corner ? st + 1 : OPEN;
  if (y < U_SPRING) {
    if (ae < 0.7 + 0.3 * cot || corner) {
      if (y > U_SPRING - 0.1) return st;
      if (y < U_IMPOST + 0.07) return st + 3;
      return ae > 0.7 ? st + 3 : st + 1;
    }
    return OPEN;
  }
  const dy = y - U_SPRING;
  const r2 = a * a + dy * dy;
  if (!corner) {
    if (r2 < U_R * U_R) return OPEN;
    if (r2 < 1.5 * 1.5) return r2 < 1.32 * 1.32 ? st + 3 : st;
    if (a < 0.18 && dy < 1.85) return st;
  }
  if (y < 14.6) return st + 1;                                           // spandrel
  if (y < 14.85) return y < 14.66 ? st + 3 : st + 1;                      // architrave
  if (y < 15.55) {                                                      // frieze, mezzanine windows
    if (!corner && a < 0.34 && y > 14.98 && y < 15.42) return SH + 3;
    if (!corner && a < 0.44 && y > 14.92 && y < 15.48) return st;
    return st + 2;
  }
  if (y < 15.72) return ((u * 4) & 1) ? st + 1 : st + 4;                 // dentils
  if (y < 16.0) return st;
  return y < 16.1 ? GUT : TILE;
}

/**
 * The free-standing columns under the arches. A column is hit when the ray
 * passes within its radius of the axis; in facade units that is the radius
 * over sin(angle), which is what makes a far wing's shafts crowd together.
 * Returns a granite index or OPEN.
 */
function columns(u, y, sn, sdir, lit) {
  let r, gap;
  if (y >= G_PLINTH && y < G_IMPOST) {
    gap = 0.38;
    if (y < 0.42) r = 0.36;                  // square plinth
    else if (y < 0.55) r = 0.32;             // torus
    else if (y < 4.52) r = 0.24 - (y - 0.55) * 0.008;  // shaft, a touch of taper
    else r = 0.31;                           // echinus
  } else if (y >= U_PED && y < U_IMPOST) {
    gap = 0.35;
    if (y < 9.36) r = 0.29;
    else if (y < 12.2) r = 0.205 - (y - 9.36) * 0.007;
    else r = 0.3;                            // Ionic volutes
  } else return OPEN;
  const pc = 2 + Math.round((u - 2) / PITCH) * PITCH;
  // Nearer column first: on a wing that is the one with the smaller z.
  for (let side = -1; side <= 1; side += 2) {
    const ax = pc + side * gap;
    const dp = (u - ax) * sn;
    if (dp > -r && dp < r) {
      const t = ((dp * sdir) / r + 1) / 2;  // 0 = screen-left edge, the lit side
      if (y > 12.2 && y < U_IMPOST && (t < 0.12 || t > 0.88)) return SH + 2;    // volute eyes
      return GR + Math.min(2, (t < 0.34 ? 0 : t < 0.74 ? 1 : 2) + lit);
    }
  }
  return OPEN;
}

/**
 * Past the arcade: the ray carries on into the portico and meets its floor,
 * its vault or the inner wall — doors below, windows above, pilasters behind
 * every column pair, all in cool shade that warms a little near the floor.
 */
function portico(surf, L, dx, dy, y0, chk) {
  const upper = y0 >= G_TOP;
  const floorY = upper ? G_TOP : G_PLINTH;
  const vaultY = upper ? U_SPRING + 0.2 : G_SPRING + 0.2;
  const adx = dx < 0 ? -dx : dx;
  // Parametrise the ray by its distance past the arcade face (metres).
  let per;       // screen units per metre of depth along the wall normal
  let u0;        // facade coordinate of the hit on the arcade face
  let du;        // change in u per metre of depth
  if (surf === BACK) { per = L.f; u0 = (dx * D) / L.f; du = dx / L.f; }
  else { per = adx; const z = (L.f * HW) / adx; u0 = z; du = L.f / adx; }
  const dyPer = -dy / per;                  // change in world y per metre of depth
  let q = PORT;
  let hit = 0;                              // 0 wall, 1 floor, 2 vault
  const yWall = y0 + dyPer * PORT;
  if (yWall < floorY) { q = (floorY - y0) / dyPer; hit = 1; }
  else if (yWall > vaultY) { q = (vaultY - y0) / dyPer; hit = 2; }
  const u = u0 + du * q;
  const pc = 2 + Math.round((u - 2) / PITCH) * PITCH;
  const e = u - pc;
  const ae = e < 0 ? -e : e;
  const a = 2 - ae;
  // Floor warmest near the arcade, where the courtyard's light bounces in.
  if (hit === 1) return shadeTone(q < 1.3 ? 0 : q < 2.8 ? 1 : 1.5, chk);
  if (hit === 2) {
    if (q < 0.9) return SH + 2;                               // back of the arch
    return ae < 0.4 ? SH + 3 : SH + 4;                        // ribs over the pairs
  }
  const y = yWall;
  if (ae < 0.5) return SH + 1;                                // pilaster
  if (!upper) {
    if (a < 0.6 && y < 3.3) return SH + 4;                    // doorway
    if (a < 0.74 && y < 3.46) return SH;                      // door frame
    const ly = y - 4.3;
    if (a * a + ly * ly < 0.2) return SH + 3;                 // lunette
  } else {
    if (a < 0.52 && y > 9.3 && y < 11.5) return SH + 4;       // window
    if (a < 0.64 && y > 9.18 && y < 11.64) return SH + 1;
  }
  return y - floorY < 0.9 ? SH + 1 : SH + 2;
}

/** One facade pixel: front face, columns, back face (reveals), portico. */
function facade(surf, L, dx, dy, u, y, chk) {
  let sn, cot, sdir, lit, corner;
  if (surf === BACK) {
    const r = Math.sqrt(D * D + u * u);
    sn = D / r; cot = (u < 0 ? -u : u) / D; sdir = 1; lit = 0;
    corner = u > HW - 0.62 || u < -HW + 0.62;
  } else {
    const r = Math.sqrt(HW * HW + u * u);
    sn = HW / r; cot = u / HW;
    // Light comes from the upper left: the right wing turns towards it.
    sdir = surf === LEFT ? 1 : -1; lit = surf === LEFT ? 2 : 0;
    corner = u > D - 0.62;
  }
  const fp = surf === BACK ? D / L.f : (u * u) / (L.f * HW);   // metres per pixel along the wall
  let c = wall(u, y, cot, sn, lit, corner, fp);
  if (c !== OPEN) return c;
  c = columns(u, y, sn, sdir, lit > 0 ? 1 : 0);
  if (c !== OPEN) return c;
  // The back face of the arcade, thickness T deeper: reveals and soffits.
  const T = y < G_TOP ? 0.7 : 0.55;
  const adx = dx < 0 ? -dx : dx;
  let u2, y2;
  if (surf === BACK) { u2 = u + (T * dx) / L.f; y2 = y - (T * dy) / L.f; }
  else { u2 = u + (T * L.f) / adx; y2 = y - (T * dy) / adx; }
  if (!(y >= G_TOP && y < U_PED)) {
    const b = wall(u2, y2, cot, sn, lit, false, fp);
    if (b !== OPEN) return ST + (y2 > y + 0.02 ? 4 : 3) + lit;
  }
  return portico(surf, L, dx, dy, y, chk);
}

/* ------------------------------------------------------------------ */
/* Paving                                                              */

/**
 * The courtyard floor at (x, z): panels of diagonal slabs framed by granite
 * bands, a pebble border along the arcades, the compass rose round the
 * statue. Joints are drawn only while a slab is still several pixels deep,
 * so the far paving settles into flat tone instead of shimmering moiré.
 * The foreground lies in the soft shadow of the wing behind the eye.
 */
const BANDS_Z = [6.4, 11.6, 23.2];
function paving(x, z, fpx, fpz, chk) {
  const ax = x < 0 ? -x : x;
  let v = 1;
  // Shadow of the near wing, in bands that deepen towards the eye: the
  // foreground frames the view and keeps the HUD strip below mid-value.
  if (z < 10.4) v += z < 6.2 ? 3 : z < 8.6 ? 2 : 1;
  // A little less sky reaches the paving along the arcades.
  if (ax > HW - 2.2) v += 0.5;
  if (ax > HW - 0.35 || z > D - 0.35) return paveTone(v - 1, chk);             // kerb
  if (ax > HW - 1.5 || z > D - 1.5) {                                            // pebbles
    if (fpx > 0.14) return paveTone(v + 1.1, chk);
    const p = hash(Math.floor(x / 0.13), Math.floor(z / 0.13), 7);
    return paveTone(v + (p < 0.35 ? 0.6 : p < 0.8 ? 1.2 : 2), false);
  }
  // The compass rose around the statue.
  const rz = z - ZS;
  const r = Math.sqrt(x * x + rz * rz);
  if (r < 4.4) {
    if (r > 4.1 || (r > 3.3 && r < 3.55)) return paveTone(v - 1, chk);      // marble rings
    if (r > 3.55) {
      if (fpx > 0.14) return paveTone(v + 1, chk);
      const p = hash(Math.floor(x / 0.13), Math.floor(z / 0.13), 9);
      return paveTone(v + (p < 0.5 ? 0.7 : 1.4), false);
    }
    // Eight rays, long on the axes, each split light and dark down its spine.
    const oct = Math.atan2(x, rz) / (Math.PI / 4) + 8;
    const k = Math.round(oct);
    const d = oct - k;
    const len = (k & 1) ? 2.4 : 3.3;
    if (r < len * (1 - (d < 0 ? -d : d) * 2.2)) return paveTone(d > 0 ? v + 1 : v - 1, chk);
    if (r < 2.0 && r > 1.75) return paveTone(v + 2, chk);
    return paveTone(v, chk);
  }
  // Granite bands: the axis, two long bands, and three across.
  if (ax < 0.4 || (ax > 4.8 && ax < 5.2)) return paveTone(v - 1, chk);
  for (let i = 0; i < BANDS_Z.length; i++) {
    const dz = z - BANDS_Z[i];
    if (dz > -0.2 && dz < 0.2 + fpz * 0.5) return paveTone(v - 1, chk);
  }
  // Diagonal slabs, 1.25 m on the diagonal, in two barely different stones.
  const g1 = (ax + z) / 1.25, g2 = (z - ax) / 1.25;
  const step = (fpx + fpz) / 1.25;
  if (step < 0.45) {
    if (Math.floor(g1) !== Math.floor(g1 + step) || Math.floor(g2) !== Math.floor(g2 + step)) {
      return paveTone(v + 1, chk);
    }
  }
  // Every other diamond is a 50% checker of the next stone down: a harlequin
  // floor at a whisper.
  return paveTone(v + (((Math.floor(g1) + Math.floor(g2)) & 1) ? 0.5 : 0), chk);
}

/* ------------------------------------------------------------------ */
/* Sky                                                                 */

// Cirrus strokes in sky-relative units: x0, y0, x1, y1, width, strength.
const STROKES = [
  0.42, 0.9, 1.08, 0.36, 0.13, 1.0,
  0.62, 0.62, 1.05, 0.2, 0.07, 0.7,
  -0.05, 0.72, 0.36, 0.52, 0.06, 0.55,
  0.1, 0.95, 0.4, 0.86, 0.04, 0.45,
  // High wisps across the top strip, the one piece of sky a portrait match
  // leaves showing: between the opponent's name and score, clear of both.
  0.22, 0.25, 0.8, 0.09, 0.04, 0.85,
  0.5, 0.29, 0.7, 0.22, 0.025, 0.5,
];

/**
 * Cirrus over the open sky. `cloud` arrives holding 1 wherever the sky shows
 * and leaves holding a level, 0 clear to 3 sunlit tops. Each stroke adds its
 * weight to the rows it reaches; streaky noise combed along one wind
 * direction then decides how much of that weight is cloud. Levels are whole
 * steps with a checker seam where one gives way to the next — the same
 * banding as the sky and the stone, never an ordered-dither fog.
 *
 * The work is done a row per call on purpose: a short function called a few
 * hundred times is optimised by the engine far sooner than one long loop, and
 * this painting's cost is almost all in its first, cold run.
 */
function cirrus(cloud, L, yEnd) {
  const { w } = L, top = L.roofY;
  const m = new Float32Array(w * yEnd);
  for (let i = 0; i < STROKES.length; i += 6) {
    const x0 = STROKES[i], y0 = STROKES[i + 1], wd = STROKES[i + 4];
    const vx = STROKES[i + 2] - x0, vy = STROKES[i + 3] - y0;
    const rx = wd * Math.sqrt(3), ry = rx / 0.9;
    const ya = Math.max(0, Math.floor((Math.min(y0, y0 + vy) - ry) * top));
    const yb = Math.min(yEnd, Math.ceil((Math.max(y0, y0 + vy) + ry) * top));
    for (let y = ya; y < yb; y++) {
      const ny = y / top;
      // Only the stretch of the stroke within reach of this row can touch it.
      let ta = (ny - ry - y0) / vy, tb = (ny + ry - y0) / vy;
      if (ta > tb) { const q = ta; ta = tb; tb = q; }
      ta = ta < 0 ? 0 : ta > 1 ? 1 : ta;
      tb = tb < 0 ? 0 : tb > 1 ? 1 : tb;
      const xa = Math.max(0, Math.floor((x0 + vx * (vx < 0 ? tb : ta) - rx) * w));
      const xb = Math.min(w, Math.ceil((x0 + vx * (vx < 0 ? ta : tb) + rx) * w));
      strokeRow(m, cloud, y * w, xa, xb, w, ny, i);
    }
  }
  const n1 = lattice(w, yEnd, 0.035, 0.2, 11), n2 = lattice(w, yEnd, 0.11, 0.6, 12);
  for (let y = 0; y < yEnd; y++) cloudRow(m, cloud, y, w, n1, n2);
}

function strokeRow(m, cloud, row, xa, xb, w, ny, i) {
  const x0 = STROKES[i], y0 = STROKES[i + 1], wd = STROKES[i + 4], k = STROKES[i + 5];
  const vx = STROKES[i + 2] - x0, vy = STROKES[i + 3] - y0;
  const vv = vx * vx + vy * vy, spread = wd * wd * 3;
  for (let x = xa, j = row + xa; x < xb; x++, j++) {
    if (!cloud[j]) continue;
    const nx = x / w;
    let tt = ((nx - x0) * vx + (ny - y0) * vy) / vv;
    tt = tt < 0 ? 0 : tt > 1 ? 1 : tt;
    const ex = nx - (x0 + vx * tt), ey = (ny - (y0 + vy * tt)) * 0.9;
    const dd = (ex * ex + ey * ey) / spread;
    if (dd < 1) m[j] += k * (1 - dd) * (1 - dd) * Math.min(1, tt * 5, (1 - tt) * 4 + 0.2);
  }
}

function cloudRow(m, cloud, y, w, n1, n2) {
  for (let x = 0, j = y * w; x < w; x++, j++) {
    if (!cloud[j]) continue;
    cloud[j] = 0;
    if (m[j] < 0.1) continue;                  // too thin to ever show
    const along = x * 0.84 - y * 0.54, across = x * 0.54 + y * 0.84;
    const n = vnoise(n1, along * 0.035, across * 0.2) * 0.65
      + vnoise(n2, along * 0.11, across * 0.6) * 0.35;
    const dens = m[j] * (n * 1.9 - 0.62);
    if (dens <= 0) continue;
    const v = dens * 3.4 + (((x + y) & 1) ? 0.57 : 0.33);
    cloud[j] = v < 1 ? 0 : v >= 3 ? 3 : v | 0;
  }
}

/* ------------------------------------------------------------------ */
/* Sprites                                                             */

// Canova's Napoleon as Mars the Peacemaker: a gilt Victory on a globe in the
// right hand, the staff in the left, a cloak over the left shoulder.
const NAPOLEON = [
  '.............d...',
  '.............c...',
  '.......abb...c...',
  '......abccb..c...',
  '......bddcb..c...',
  '......bdccb..c...',
  '.......ddb..bab..',
  '.......cb...bab..',
  '.....abccccbcc...',
  '...aabddcccbbc...',
  '...bd.bddccbbc...',
  '...bd.ddccccbc...',
  '.g.bd.bdcdcbbc...',
  'gg.bd.bdcccbbc...',
  '.g.bd.bddccbbc...',
  'gGGdc.bdccbbbc...',
  'GGGb..bdcccbbc...',
  '......bddccbac...',
  '......bdccccbc...',
  '......bdccbabc...',
  '......bdccbabc...',
  '......bdc.dbbc...',
  '......bdc.dcbc...',
  '......bdcb.dbc...',
  '......bdc..dbc...',
  '......bdc..dbc...',
  '......bdc..dbc...',
  '......bdc..dbc...',
  '.....abdcb.dbc...',
  '....abbccbbbcb...',
];
const SPRITE_INK = { a: BZ, b: BZ + 1, c: BZ + 2, d: BZ + 3, g: GOLD, G: GOLD_D, m: MARB, n: MARB_D, s: SH + 3 };

// A marble scholar on a plinth, in the portico's shade.
const SCHOLAR = [
  '..m..',
  '.mmn.',
  '..m..',
  '.mmn.',
  'mmmnn',
  '.mmn.',
  '.mmn.',
  '.mnn.',
  '.mmn.',
  '.mnn.',
  '.m.n.',
  'nnnnn',
  'nsssn',
  'nsssn',
];

function sprite(buf, w, h, rows, x0, y0) {
  for (let j = 0; j < rows.length; j++) {
    const y = y0 + j;
    if (y < 0 || y >= h) continue;
    const row = rows[j];
    for (let i = 0; i < row.length; i++) {
      const c = SPRITE_INK[row[i]];
      const x = x0 + i;
      if (c !== undefined && x >= 0 && x < w) buf[y * w + x] = c;
    }
  }
}

function fill(buf, w, h, x0, y0, rw, rh, c) {
  const xa = Math.max(0, Math.round(x0)), xb = Math.min(w, Math.round(x0 + rw));
  const ya = Math.max(0, Math.round(y0)), yb = Math.min(h, Math.round(y0 + rh));
  for (let y = ya; y < yb; y++) buf.fill(c, y * w + xa, y * w + xb);
}

/** The statue's pedestal: stepped base, a tall die with its inscription panel, cornice. */
function pedestal(buf, L) {
  const { w, h, f, cx, vy } = L;
  const s = f / ZS;                                  // px per metre at the statue
  const foot = vy + (EYE * f) / ZS;
  const box = (wd, y0, y1, c) => fill(buf, w, h, cx - (wd * s) / 2, foot - y1 * s, wd * s, (y1 - y0) * s, c);
  // A step's tread is seen from above: the eye is higher than the pedestal base.
  box(3.6, 0, 0.32, ST + 3);
  box(3.6, 0.26, 0.32, ST + 1);
  box(3.0, 0.32, 0.62, ST + 3);
  box(3.0, 0.56, 0.62, ST + 1);
  box(2.4, 0.62, 0.95, ST + 2);
  box(2.0, 0.95, 3.35, ST + 2);
  // The die's right-hand arris turns out of the light.
  fill(buf, w, h, cx + (1.0 - 0.3) * s, foot - 3.35 * s, 0.3 * s, 2.4 * s, ST + 3);
  box(1.3, 1.5, 2.8, ST + 3);                        // inscription panel
  box(1.1, 1.62, 2.68, ST + 2);
  box(2.5, 3.35, 3.5, ST + 4);
  box(2.5, 3.5, 3.72, ST + 1);
  box(1.5, 3.72, 3.95, BZ + 1);                      // the bronze's own plinth
  box(1.5, 3.72, 3.78, BZ + 2);
  return Math.round(foot - 3.95 * s);
}

/* ------------------------------------------------------------------ */
/* Backdrop                                                            */

/**
 * One row of the courtyard, ray-cast pixel by pixel. Open sky gets its band
 * (six flat bands, zenith to roofline, with a checker seam row) and is marked
 * in `cloud` for the cirrus pass.
 */
function courtyardRow(buf, cloud, L, surfOf, zOf, y) {
  const { w, f, cx, vy } = L;
  const dy = y + 0.5 - vy;
  const row = y * w;
  const bandH = L.roofY / 6;
  const bt = Math.min(5.999, Math.max(0, y / bandH));
  const band = SKY + (bt | 0);
  const seam = bt >= 1 && (bt % 1) * bandH < 1;
  for (let x = 0; x < w; x++) {
    const dx = x + 0.5 - cx;
    const surf = surfOf[x];
    const z = zOf[x];
    const yw = EYE - (dy * z) / f;
    const chk = (x + y) & 1;
    let c;
    if (yw >= ROOF) {
      c = seam && chk ? band - 1 : band;
      cloud[row + x] = 1;
    } else if (yw < 0) {
      const zg = (EYE * f) / dy;
      const xg = (dx * zg) / f;
      c = paving(xg, zg, zg / f, (zg * zg) / (EYE * f), chk);
    } else {
      const u = surf === BACK ? (dx * D) / f : z;
      c = facade(surf, L, dx, dy, u, yw, chk);
    }
    buf[row + x] = c;
  }
}

/**
 * Lay a row of cirrus over the sky. A veil pixel needs two cloudy neighbours
 * and a brighter one needs one, so the wisps keep clean edges instead of a
 * sprinkle of loose dots.
 */
function skyRow(buf, cloud, y, w) {
  for (let x = 1, i = y * w + 1; x < w - 1; x++, i++) {
    const lv = cloud[i];
    if (!lv) continue;
    const n = (cloud[i - w - 1] > 0) + (cloud[i - w] > 0) + (cloud[i - w + 1] > 0)
      + (cloud[i - 1] > 0) + (cloud[i + 1] > 0)
      + (cloud[i + w - 1] > 0) + (cloud[i + w] > 0) + (cloud[i + w + 1] > 0);
    if (n >= (lv === 1 ? 2 : 1)) buf[i] = CIR + lv - 1;
  }
}

function paintBackdrop(ctx, w, h) {
  const L = layout(w, h);
  const { f, cx, vy, bw } = L;
  const buf = new Uint8Array(w * h);
  // Per screen column: which surface, and its depth if it is a wing.
  const surfOf = new Int8Array(w);
  const zOf = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const dx = x + 0.5 - cx;
    const adx = Math.abs(dx);
    if (adx <= bw) { surfOf[x] = BACK; zOf[x] = D; }
    else { surfOf[x] = dx < 0 ? LEFT : RIGHT; zOf[x] = (f * HW) / adx; }
  }
  const cloud = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) courtyardRow(buf, cloud, L, surfOf, zOf, y);
  // Lay the cirrus over the sky, dropping stray pixels on the way.
  const yEnd = Math.min(h - 1, Math.ceil(L.roofY) + 1);
  cirrus(cloud, L, yEnd);
  for (let y = 1; y < yEnd; y++) skyRow(buf, cloud, y, w);
  // Scholars in the back portico, either side of the statue.
  const sb = f / (D + PORT - 0.5);
  for (const bx of [-8, -4, 4, 8]) {
    const sx = Math.round(cx + bx * sb - 2.5);
    const sy = Math.round(vy + (EYE - G_PLINTH) * sb - SCHOLAR.length);
    sprite(buf, w, h, SCHOLAR, sx, sy);
  }
  const top = pedestal(buf, L);
  sprite(buf, w, h, NAPOLEON, Math.round(cx - 8.5), top - NAPOLEON.length);
  flush(ctx, buf, w, h);
}

/* ------------------------------------------------------------------ */
/* Court                                                               */

/**
 * The paving from above, in the shade of the arcade. Everything is a function
 * of the distance from the nearest side wall and from the centre line, so the
 * floor is mirror-symmetric both ways by construction.
 */
function paintCourt(ctx, w, h) {
  const buf = new Uint8Array(w * h);
  const k = w / 175;                                   // 1 on a typical phone
  const port = Math.max(1, Math.round(2 * k));         // portico floor beyond the columns
  const plinth = Math.max(2, Math.round(3 * k));       // a column plinth, seen from above
  const kerb = port + plinth;                          // the arcade's step edge
  const band = kerb + 1 + Math.max(2, Math.round(5 * k)); // pebble border
  const pitch = Math.max(14, Math.round(w * 0.2));     // column pair to column pair
  const slab = Math.max(8, Math.round(w * 0.16));      // diagonal slabs
  const shadeLen = 3 + 4 * k;
  const R = w * 0.3;                                   // compass rose
  const cxw = w / 2, cyh = h / 2;
  // Paint the top half; the bottom is its mirror image, row for row.
  const half = Math.ceil(h / 2);
  for (let y = 0; y < half; y++) {
    const fy = Math.abs(y + 0.5 - cyh);
    const ey = cyh - fy;                               // from the nearest goal end
    // Column pairs sit half a pitch off the centre line, so the middle of
    // each wall is an arch rather than a column.
    const py = fy % pitch;
    const dp = Math.abs(py - pitch / 2);               // from the nearest pair's centre
    // Each pair's shadow is a tongue with a rounded end: longest in line
    // with the pair, shortening towards its ends.
    const pe = plinth + 1.6;
    const tongue = dp < pe ? shadeLen * Math.sqrt(1 - (dp * dp) / (pe * pe)) : 0;
    for (let x = 0; x < w; x++) {
      const ex = Math.min(x + 0.5, w - x - 0.5);       // from the nearest side wall
      const fx = Math.abs(x + 0.5 - cxw);
      let c;
      if (ex < port) c = CF + 5;
      else if (ex < kerb) {
        // Two plinths per pair, a pixel apart, on a continuous stylobate.
        if (dp > 0.6 && dp < 0.6 + plinth) c = ex > kerb - 1 ? CF + 8 : ex < port + 1 ? CF + 6 : CF + 7;
        else c = CF + 3;
      } else if (ex < kerb + 1) c = CF + 6;
      else {
        const e = Math.min(ex, ey + kerb);             // pebble band runs round the ends too
        if (e < band) {
          const p = hash(Math.floor(e * 1.7), Math.floor(fy * 1.7) + Math.floor(fx * 3.1), 5);
          c = p < 0.34 ? CF + 2 : p < 0.86 ? CF + 3 : CF + 1;
        } else if (e < band + 1) c = CF + 1;
        else {
          const r = Math.sqrt(fx * fx + fy * fy);
          if (r < R + 1.5) {
            if (r >= R) c = CF + 6;                    // marble inlay
            else if (r >= R - 3) c = CF + 3;
            else if (r >= R - 4) c = CF + 1;
            else if (r < R * 0.09) c = r < R * 0.05 ? CF : CF + 1;
            else {
              // Eight-point star: long rays on the axes, short ones between,
              // each ray split light/dark down its spine.
              const th = Math.atan2(fx, fy);            // folded into one quadrant
              const oct = th / (Math.PI / 4);           // 0 = along the court, 2 = across
              const kk = Math.round(oct);
              const d = oct - kk;
              const len = (kk & 1) ? R * 0.6 : R - 5;
              if (r < len * (1 - Math.abs(d) * 2.3)) {
                if (kk === 0) c = x + 0.5 < cxw ? CF : CF + 1;
                else if (kk === 1) c = d < 0 ? CF : CF + 1;
                else c = Math.abs(d) * r < 0.8 ? CF : CF + 1;
              } else c = CF + 3;
            }
          } else {
            // Diagonal slabs, the same harlequin as the courtyard seen from
            // the gate, a diamond point on the centre of each end.
            const g1 = (fx + fy) / slab, g2 = (fy - fx) / slab + 64;
            if (g1 % 1 < 1 / slab || g2 % 1 < 1 / slab) c = CF + 3;
            else {
              c = ((Math.floor(g1) + Math.floor(g2)) & 1) ? CF + 1 : CF + 2;
              // A sparse grain in the stone.
              const g = hash(Math.floor(fx), Math.floor(fy), 8);
              if (g < 0.015) c = CF + 3;
              else if (g > 0.99) c = CF + 1;
            }
          }
        }
        // The arcade's shade on the stones: a checker along the foot of the
        // wall, and each column pair's shadow reaching further in — a solid
        // core that breaks into a checker towards its end.
        const sd = ex - kerb - 1;
        if (sd < tongue - 2) c = CF + 4;
        else if (sd < tongue || sd < 1.5) {
          if ((((ex | 0) + y) & 1) === 0) c = CF + 4;
        }
      }
      buf[y * w + x] = c;
    }
    buf.copyWithin((h - 1 - y) * w, y * w, y * w + w);
  }
  flush(ctx, buf, w, h);
}

/* ------------------------------------------------------------------ */
/* Animation                                                           */

// The calm stage moves slowly: a cloud's shade drifting over the stones, a
// few pigeons. Everything is a pure function of t over positions seeded once
// per canvas size.
const anims = new Map();
let lastAnim = null;
function animState(w, h) {
  if (lastAnim && lastAnim.w === w && lastAnim.h === h) return lastAnim;
  const key = `${w}x${h}`;
  let A = anims.get(key);
  if (A) return (lastAnim = A);
  const rand = mulberry(0xb7e7a);
  // The cloud's outline: a lumpy half-width per step of its length, so the
  // shade has the stepped edge of a sprite rather than a perfect ellipse.
  const lumps = [];
  for (let i = 0; i < 24; i++) lumps.push(0.78 + rand() * 0.22);
  const flock = [];
  for (let i = 0; i < 4; i++) flock.push({ dx: i * 7 + rand() * 4, dy: (i & 1) * 3 + rand() * 3, ph: rand() * 6 });
  const peck = [];
  for (let i = 0; i < 3; i++) {
    peck.push({ x: (i - 1) * 2.4 + (rand() - 0.5), z: ZS - 5.2 + rand() * 1.4, ph: rand() * 10, rate: 0.5 + rand() * 0.4 });
  }
  A = { w, h, lumps, flock, peck };
  if (anims.size >= 8) anims.delete(anims.keys().next().value);
  anims.set(key, A);
  return (lastAnim = A);
}

const SHADE = 'rgba(20,26,58,0.16)';
const BIRD = '#243052';
const PIGEON = '#6d6f82';
const PIGEON_D = '#4a4c5e';

function animateBackdrop(ctx, w, h, t) {
  const L = layout(w, h);
  const A = animState(w, h);
  const { f, cx, vy } = L;

  // Cloud shade over the paving: an ellipse in courtyard metres, drawn a
  // pair of rows at a time and clipped to the courtyard's width. The rows
  // step round the pedestal's base, which would otherwise be shaded below
  // the far wall's foot and lit above it.
  const sp = f / ZS, foot = vy + EYE * sp;
  const span = 2 * HW + 18;
  const xc = -HW - 9 + ((t * 0.3) % span);
  const zc = 15.5 + Math.sin(t * 0.021) * 3;
  const rx = 6.5, rz = 4.2;
  const yTop = Math.max(Math.ceil(vy + (EYE * f) / (zc + rz)), Math.ceil(L.baseY));
  const yBot = Math.min(h, Math.floor(vy + (EYE * f) / Math.max(1, zc - rz)));
  ctx.fillStyle = SHADE;
  for (let y = yTop; y < yBot; y += 2) {
    const z = (EYE * f) / (y + 1 - vy);
    const q = (z - zc) / rz;
    if (q <= -1 || q >= 1) continue;
    const lump = A.lumps[Math.floor((q + 1) * 11.99)];
    const hx = rx * Math.sqrt(1 - q * q) * lump;
    const x0 = Math.max(-HW, xc - hx), x1 = Math.min(HW, xc + hx);
    if (x1 <= x0) continue;
    const s0 = Math.round(cx + (x0 * f) / z), s1 = Math.round(cx + (x1 * f) / z);
    if (y < foot) {
      const up = Math.max(0, (foot - y - 2) / sp);      // metres up the pedestal
      const ph = (up < 0.32 ? 1.8 : up < 0.62 ? 1.5 : up < 0.95 ? 1.2 : 1.0) * sp;
      const p0 = Math.round(cx - ph), p1 = Math.round(cx + ph);
      if (s0 < p0) ctx.fillRect(s0, y, Math.min(s1, p0) - s0, 2);
      if (s1 > p1) ctx.fillRect(Math.max(s0, p1), y, s1 - Math.max(s0, p1), 2);
    } else ctx.fillRect(s0, y, s1 - s0, 2);
  }

  // A few pigeons crossing the sky every forty-odd seconds, each pass at its
  // own height and in its own direction — some of them through the top strip.
  const period = w + 60;
  const run = (t * w) / 9;                             // about nine seconds across
  const pass = Math.floor(run / (period * 4));
  const fx = run - pass * period * 4 - 30;
  if (fx < period) {
    ctx.fillStyle = BIRD;
    const fy = L.roofY * (0.12 + 0.5 * hash(pass, 3, 21));
    const back = hash(pass, 5, 21) < 0.5;
    for (const b of A.flock) {
      const x = Math.round(back ? w - fx + b.dx : fx - b.dx);
      const y = Math.round(fy + b.dy + Math.sin(t * 1.1 + b.ph) * 1.5);
      const flap = Math.floor(t * 7 + b.ph) & 3;       // three beats, one glide
      ctx.fillRect(x, y, 2, 1);
      if (flap === 0) { ctx.fillRect(x - 1, y - 1, 1, 1); ctx.fillRect(x + 2, y - 1, 1, 1); }
      else if (flap === 2) { ctx.fillRect(x - 1, y + 1, 1, 1); ctx.fillRect(x + 2, y + 1, 1, 1); }
      else { ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1); }
    }
  }

  // Pigeons pecking about in front of the statue.
  for (const p of A.peck) {
    const walk = Math.sin(t * 0.23 + p.ph);
    const x = p.x + walk * 0.6;
    const sx = Math.round(cx + (x * f) / p.z);
    const sy = Math.round(vy + (EYE * f) / p.z) - 2;
    const dir = Math.cos(t * 0.23 + p.ph) >= 0 ? 1 : -1;
    const pecking = ((t * p.rate + p.ph) % 1) < 0.22;
    ctx.fillStyle = PIGEON;
    ctx.fillRect(sx - 1, sy, 3, 2);
    ctx.fillRect(dir > 0 ? sx + 2 : sx - 2, pecking ? sy + 1 : sy - 1, 1, 1);
    ctx.fillStyle = PIGEON_D;
    ctx.fillRect(dir > 0 ? sx - 2 : sx + 2, sy, 1, 1);
  }
}

/** The court: the same cloud's shade passing over, fainter still. */
function animateCourt(ctx, w, h, t) {
  const A = animState(w, h);
  const rx = w * 0.5, ry = h * 0.2;
  const span = w + rx * 2.4;
  const xc = -rx * 1.2 + ((t * w) / 60) % span;
  const yc = h * (0.5 + Math.sin(t * 0.017) * 0.22);
  ctx.fillStyle = 'rgba(8,10,24,0.1)';
  for (let y = Math.floor(yc - ry); y < yc + ry; y += 2) {
    const q = (y + 1 - yc) / ry;
    if (q <= -1 || q >= 1) continue;
    const hx = rx * Math.sqrt(1 - q * q) * A.lumps[Math.floor((q + 1) * 11.99)];
    const x0 = Math.max(0, Math.round(xc - hx)), x1 = Math.min(w, Math.round(xc + hx));
    if (x1 > x0) ctx.fillRect(x0, y, x1 - x0, 2);
  }
}

export default {
  palette: { accent: '#86c8ff', court: '#2c2722', line: 'rgba(236,214,172,0.5)' },
  backdrop: paintBackdrop,
  court: paintCourt,
  animateBackdrop,
  animateCourt,
};
