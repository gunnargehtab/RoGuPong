// RoGuPong — the logotype.
//
// Hand-drawn pixel letterforms (caps 9x12, lowercase 8x8, 'g' with a
// descender) rendered with a bevel, a hard outline, a drop shadow and an
// animated specular sweep. Every letter also rides a gentle arc, the way
// 16-bit console logos always did.

const CAP = 12;      // cap height in font pixels
const XH = 8;        // x-height
const BASE = 12;     // baseline row: caps occupy rows 0..11

const R = [
  '#######..',
  '########.',
  '##....##.',
  '##....##.',
  '##...##..',
  '#######..',
  '##..##...',
  '##...##..',
  '##....##.',
  '##....##.',
  '##.....##',
  '##.....##',
];
const G = [
  '..######.',
  '.########',
  '##......#',
  '##.......',
  '##.......',
  '##..#####',
  '##..#####',
  '##.....##',
  '##.....##',
  '##.....##',
  '.########',
  '..######.',
];
const P = [
  '#######..',
  '########.',
  '##....##.',
  '##....##.',
  '##....##.',
  '########.',
  '#######..',
  '##.......',
  '##.......',
  '##.......',
  '##.......',
  '##.......',
];
const o = [
  '.######.',
  '########',
  '##....##',
  '##....##',
  '##....##',
  '##....##',
  '########',
  '.######.',
];
const u = [
  '##....##',
  '##....##',
  '##....##',
  '##....##',
  '##....##',
  '##...###',
  '########',
  '.#####.#',
];
const n = [
  '##.####.',
  '########',
  '###...##',
  '##....##',
  '##....##',
  '##....##',
  '##....##',
  '##....##',
];
const g = [
  '.#######',
  '########',
  '##....##',
  '##....##',
  '##....##',
  '########',
  '.#######',
  '......##',
  '......##',
  '#######.',
  '######..',
];

// The word, letter by letter: glyph, vertical offset from the cap line, and
// which of the three colour ramps it belongs to.
const WORD = [
  { px: R, top: 0,        ramp: 0 },
  { px: o, top: CAP - XH, ramp: 0 },
  { px: G, top: 0,        ramp: 1 },
  { px: u, top: CAP - XH, ramp: 1 },
  { px: P, top: 0,        ramp: 2 },
  { px: o, top: CAP - XH, ramp: 2 },
  { px: n, top: CAP - XH, ramp: 2 },
  { px: g, top: CAP - XH, ramp: 2 },
];

// Ro = sunset red, Gu = arcade cyan, Pong = coin gold. Top-to-bottom ramps.
const RAMPS = [
  ['#ffd9a0', '#ff9b4a', '#f7452f', '#a51231'],
  ['#c8fbff', '#5fd9ff', '#2a7bf0', '#1b2f9c'],
  ['#fff6c2', '#ffd93b', '#ff9d17', '#c14e07'],
];
const OUTLINE = '#160b23';
const SHADOW = 'rgba(10,4,20,0.55)';

const KERN = 1;      // gap between letters, in logo pixels
const ARC = 1.15;    // how many pixels each letter lifts on the arc

function rampColor(ramp, t) {
  const stops = RAMPS[ramp];
  const f = Math.max(0, Math.min(0.999, t)) * (stops.length - 1);
  return stops[Math.floor(f)];
}

/** Total size of the logotype, in logo pixels. */
export function logoMetrics() {
  let w = 0;
  for (const l of WORD) w += l.px[0].length + KERN;
  w -= KERN;
  const h = BASE + 3;   // room for g's descender
  return { w, h };
}

/**
 * Draw the logo centred on (cx, cy).
 *   scale  size of one logo pixel
 *   time   seconds, drives the shine sweep and the idle bob
 */
export function drawLogo(ctx, cx, cy, scale, time = 0) {
  const { w, h } = logoMetrics();
  const bob = Math.round(Math.sin(time * 1.6) * 0.5);
  const ox = Math.round(cx - (w * scale) / 2);
  const oy = Math.round(cy - (h * scale) / 2) + bob * scale;

  // Shine sweeps left to right every few seconds.
  const sweep = ((time * 0.42) % 1.9) * (w + 14) - 7;

  const put = (x, y, fill) => {
    ctx.fillStyle = fill;
    ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
  };

  let penX = 0;
  const letters = [];
  for (let i = 0; i < WORD.length; i++) {
    const L = WORD[i];
    const gw = L.px[0].length;
    // Arc: outer letters sit slightly higher than the middle of the word.
    const t = WORD.length === 1 ? 0 : (i / (WORD.length - 1)) * 2 - 1;
    const lift = -Math.round((1 - t * t) * ARC) + Math.round(t * t * ARC);
    letters.push({ ...L, x: penX, y: L.top + lift, gw });
    penX += gw + KERN;
  }

  const isSolid = (L, x, y) => {
    const row = L.px[y];
    return !!row && row[x] === '#';
  };

  // Pass 1 — drop shadow, offset down-right.
  ctx.fillStyle = SHADOW;
  for (const L of letters) {
    for (let y = 0; y < L.px.length; y++) {
      for (let x = 0; x < L.gw; x++) {
        if (isSolid(L, x, y)) ctx.fillRect(ox + (L.x + x + 2) * scale, oy + (L.y + y + 2) * scale, scale, scale);
      }
    }
  }

  // Pass 2 — outline: any empty cell touching a solid one.
  for (const L of letters) {
    for (let y = -1; y <= L.px.length; y++) {
      for (let x = -1; x <= L.gw; x++) {
        if (isSolid(L, x, y)) continue;
        let touches = false;
        for (let dy = -1; dy <= 1 && !touches; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx || dy) && isSolid(L, x + dx, y + dy)) { touches = true; break; }
          }
        }
        if (touches) put(L.x + x, L.y + y, OUTLINE);
      }
    }
  }

  // Pass 3 — the letters themselves: vertical ramp, bevel highlight on the
  // top edge, dark lip on the bottom edge, plus the moving shine.
  for (const L of letters) {
    const hgt = L.px.length;
    for (let y = 0; y < hgt; y++) {
      for (let x = 0; x < L.gw; x++) {
        if (!isSolid(L, x, y)) continue;
        const gx = L.x + x;
        let fill = rampColor(L.ramp, y / (hgt - 1));
        if (!isSolid(L, x, y - 1)) fill = RAMPS[L.ramp][0];                 // top bevel
        else if (!isSolid(L, x, y + 1)) fill = RAMPS[L.ramp][RAMPS[L.ramp].length - 1]; // bottom lip
        const d = Math.abs(gx + y * 0.35 - sweep);
        if (d < 1.6) fill = '#ffffff';
        else if (d < 3.0) fill = RAMPS[L.ramp][0];
        put(gx, L.y + y, fill);
      }
    }
  }
}

/**
 * Render the logo into its own canvas, sized to fit `maxW`. Used by the title
 * screen, which re-renders every frame for the shine.
 */
export function renderLogoTo(canvas, maxW, time) {
  const { w, h } = logoMetrics();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const scale = Math.max(2, Math.floor((maxW / (w + 6))));
  const cw = Math.ceil((w + 6) * scale);
  const ch = Math.ceil((h + 6) * scale);
  if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
    canvas.width = cw * dpr;
    canvas.height = ch * dpr;
  }
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cw, ch);
  drawLogo(ctx, cw / 2, ch / 2, scale, time);
}
