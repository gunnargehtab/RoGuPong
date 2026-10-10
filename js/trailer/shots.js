// RoGuPong trailer — the shots.
//
// Each shot paints one frame from `lt`, the seconds since it started, so the
// whole cut is a pure function of the playhead and can be scrubbed. The few
// things that only happen while it plays (sparks, the live match) are kicked
// off when the playhead crosses their moment. Ambient motion that should keep
// going on a held frame (the logo's shine, the sunburst) runs on `g.time`.
//
// `g` is the trailer: ctx, W, H, u (one art pixel), portrait, layer, sparks,
// demo, qr, and the stage-art cache.

import { drawLogo, logoMetrics } from '../ui/logo.js';
import { measure } from '../ui/pixelfont.js';
import { drawFighter } from '../game/render.js';
import { byId } from '../game/characters.js';
import { STAGES } from '../game/stages.js';
import { HOOK_HITS, STEP } from './music.js';
import {
  BG0, BG2, GOLD, OUTLINE, INK, clamp, lerp, span, outCubic, outBack, inOut, crossed,
  mix, px32, sunburst, fit, text, slam, wrap, lineH, phone, qrCode, brackets, band,
  pixelArc, hash,
} from './art.js';

const RO = byId('ro');
const GU = byId('gu');
const GREEN = '#8affc1';
const MAGENTA = '#ff56d0';

const flashAlpha = (g, lt, at, life, strength = 0.9) =>
  (lt >= at && lt < at + life ? (1 - (lt - at) / life) * strength * (g.reduced ? 0.35 : 1) : 0);

function flash(g, a, color = '#ffffff') {
  if (a <= 0) return;
  g.ctx.globalAlpha = a;
  g.ctx.fillStyle = color;
  g.ctx.fillRect(0, 0, g.W, g.H);
  g.ctx.globalAlpha = 1;
}

/** Twinkling pixel stars, the same ones every frame. */
function stars(g, n, avoid = null) {
  const { ctx, W, H, u } = g;
  for (let i = 0; i < n; i++) {
    const x = Math.round(hash(i * 2 + 1) * W);
    const y = Math.round(hash(i * 2 + 7) * H);
    if (avoid && x > avoid.x - u * 2 && x < avoid.x + avoid.w + u * 2 && y > avoid.y && y < avoid.y + avoid.h) continue;
    ctx.globalAlpha = 0.25 + 0.6 * Math.abs(Math.sin(g.time * (1 + hash(i) * 2) + i));
    ctx.fillStyle = i % 5 ? '#a99cc8' : GOLD;
    ctx.fillRect(x, y, u, u);
  }
  ctx.globalAlpha = 1;
}

/** Lay `n` phones side by side between `top` and `bottom`, as big as fits. */
function phones(g, n, top, bottom, left = 0, right = g.W) {
  const aspect = 0.49;
  const availH = g.H - top - bottom;
  const room = right - left;
  let h = availH;
  let w = h * aspect;
  let gap = n > 1 ? Math.max(g.u * 6, w * 0.22) : 0;
  if (n * w + (n - 1) * gap > room * 0.94) {
    w = (room * 0.94) / (n + (n - 1) * 0.22);
    gap = n > 1 ? w * 0.22 : 0;
    h = w / aspect;
  }
  w = Math.round(w);
  h = Math.round(h);
  const x0 = left + (room - (n * w + (n - 1) * gap)) / 2;
  const y = Math.round(top + (availH - h) / 2);
  return Array.from({ length: n }, (_, i) => ({ x: Math.round(x0 + i * (w + gap)), y, w, h }));
}

/** A run of caption lines, each slamming in at its own time. */
function captions(g, lines, x, y, scale, lt, opts = {}) {
  const gap = Math.round(scale * 2.4);
  let k = 0;
  for (const [str, at, color] of lines) {
    if (lt < at) continue;
    slam(g.ctx, str, x, y + k * (lineH(scale) + gap), scale, lt - at, {
      color: color || INK, outline: OUTLINE, shadow: BG0, ...opts,
    });
    k++;
  }
}

/**
 * Copy that never drops below a readable scale: it shrinks to fit `maxW`,
 * then wraps. Draws the lines centred from `y` down; returns their height.
 */
function copy(ctx, str, x, y, maxW, hi, opts = {}, lo = 2) {
  const s = fit(str, maxW, hi, lo);
  const lines = measure(str, s) <= maxW ? [str] : wrap(str, maxW, s);
  const step = Math.round(lineH(s) * 1.5);
  lines.forEach((l, i) => text(ctx, l, x, y + lineH(s) / 2 + i * step, { scale: s, ...opts }));
  return lineH(s) + (lines.length - 1) * step;
}

/* ------------------------------------------------------------------ */
/* 1. Intro — pong in the dark, a line of copy on every half bar        */

// Where the ball meets each paddle (court widths, 0..1), and whether it
// gets there off the left (-1) or right (1) wall. The last entry is where the
// final ball is headed when the title cuts in.
const HITS = [...HOOK_HITS, 32].map((s) => s * STEP);
const HIT_X = [0.5, 0.26, 0.72, 0.34, 0.66, 0.2, 0.76, 0.42, 0.6, 0.38, 0.56, 0.5];
const VIA = [0, -1, 0, 1, 0, -1, 0, 0, 0, 0, 0];
const COPY = [
  ['TWO PHONES.', 0, RO.color],
  ['ONE WIFI.', 0.8, GU.color],
  ['NO SERVER.', 1.6, GOLD],
  ['JUST PONG.', 2.4, MAGENTA],
];

const fold = (x) => {
  const v = ((x % 2) + 2) % 2;
  return v > 1 ? 2 - v : v;
};

/** The ball at time t: x 0..1 across, y 1 at RO's paddle and 0 at GU's. */
function hookBall(t) {
  let i = 0;
  while (i < HITS.length - 2 && t >= HITS[i + 1]) i++;
  const p = clamp((t - HITS[i]) / (HITS[i + 1] - HITS[i]), 0, 1);
  const to = VIA[i] < 0 ? -HIT_X[i + 1] : VIA[i] > 0 ? 2 - HIT_X[i + 1] : HIT_X[i + 1];
  return { x: fold(lerp(HIT_X[i], to, p)), y: i % 2 === 0 ? 1 - p : p };
}

/** A paddle glides from one of its hits to its next. */
function hookPaddle(t, side) {
  const own = [];
  for (let i = 0; i < HITS.length; i++) if (i % 2 === side) own.push([HITS[i], HIT_X[i]]);
  if (side === 1) own.unshift([-0.4, 0.5]);
  let a = own[0];
  for (const h of own) if (h[0] <= t) a = h;
  const b = own[own.indexOf(a) + 1];
  if (!b) return a[1];
  return lerp(a[1], b[1], inOut(span(t, a[0] + 0.04, b[0] - a[0] - 0.08)));
}

function hookCourt(g) {
  let h = Math.round(g.H * 0.86);
  let w = Math.round(h * 0.56);
  if (w > g.W * 0.8) { w = Math.round(g.W * 0.8); h = Math.round(w / 0.56); }
  return { x: Math.round((g.W - w) / 2), y: Math.round((g.H - h) / 2), w, h };
}

const hook = {
  shake(lt) {
    let k = -1;
    for (let i = 0; i < HOOK_HITS.length; i++) if (HITS[i] <= lt) k = i;
    if (k < 0) return 0;
    const d = lt - HITS[k];
    return d < 0.08 ? (k >= 7 ? 1.2 : 0.6) * (1 - d / 0.08) : 0;
  },

  draw(g, lt, prev) {
    const { ctx, W, H, u } = g;
    ctx.fillStyle = BG0;
    ctx.fillRect(0, 0, W, H);
    const c = hookCourt(g);
    stars(g, 70, c);

    // The court: a floor, an edge and the midline, as on the game's icon.
    ctx.fillStyle = '#100a1e';
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = BG2;
    ctx.lineWidth = u;
    ctx.strokeRect(c.x + u / 2, c.y + u / 2, c.w - u, c.h - u);
    ctx.fillStyle = MAGENTA;
    ctx.globalAlpha = 0.55;
    for (let x = c.x + u * 3; x < c.x + c.w - u * 3; x += u * 6) {
      ctx.fillRect(x, Math.round(c.y + c.h / 2 - u / 2), u * 3, u);
    }
    ctx.globalAlpha = 1;

    const bs = Math.max(u * 2, Math.round(c.w * 0.04));
    const ph = Math.max(u, Math.round(c.h * 0.018));
    const pw = Math.round(c.w * 0.24);
    const margin = pw / 2 + u * 2;
    const X = (x) => c.x + margin + x * (c.w - margin * 2);
    const top = c.y + c.h * 0.1;
    const bot = c.y + c.h * 0.9;
    const Y = (y) => lerp(top + bs / 2, bot - bs / 2, y);

    // Paddles: RO's red at the bottom, GU's blue at the top.
    for (const [side, ch, y] of [[0, RO, bot], [1, GU, top - ph]]) {
      const x = Math.round(X(hookPaddle(lt, side)) - pw / 2);
      ctx.fillStyle = ch.color;
      ctx.fillRect(x, Math.round(y), pw, ph);
      ctx.fillStyle = ch.color2;
      ctx.fillRect(x + u, Math.round(y), pw - u * 2, Math.max(1, Math.round(ph / 3)));
    }

    // The ball and its trail — longer once it's flying on sixteenths.
    const fast = lt >= HITS[7];
    for (let j = fast ? 9 : 5; j >= 0; j--) {
      const b = hookBall(lt - j * 0.016);
      const s = Math.round(bs * (1 - j * 0.07));
      ctx.globalAlpha = j ? 0.55 * (1 - j / (fast ? 10 : 6)) : 1;
      ctx.fillStyle = j ? (fast ? '#ff9d17' : GOLD) : '#fff6c2';
      ctx.fillRect(Math.round(X(b.x) - s / 2), Math.round(Y(b.y) - s / 2), s, s);
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < HOOK_HITS.length; i++) {
      if (!crossed(prev, lt, HITS[i])) continue;
      const ch = i % 2 ? GU : RO;
      const b = hookBall(HITS[i]);
      g.sparks.burst(X(b.x), Y(b.y), {
        count: i >= 7 ? 22 : 14, colors: [ch.color, ch.color2, '#ffffff'], speed: u * 70,
        size: u, life: 0.4, gravity: u * 60, dir: i % 2 ? Math.PI / 2 : -Math.PI / 2, spread: 2.2,
      });
    }

    // The copy, slammed over a dark strip across the middle.
    const s = fit('TWO PHONES.', W * 0.88, Math.round(H * 0.12 / 7), 2);
    let line = null;
    for (const l of COPY) if (lt >= l[1]) line = l;
    if (line) {
      const h = lineH(s) + u * 6;
      band(ctx, Math.round(H / 2 - h / 2), h, W, 0.78);
      slam(ctx, line[0], W / 2, H / 2, s, lt - line[1], {
        color: '#ffffff', outline: OUTLINE, shadow: line[2],
      });
    }

    // Power-on: a line of light that opens into the picture.
    if (lt < 0.24) {
      const open = outCubic(span(lt, 0.05, 0.19));
      const bandH = Math.max(u, Math.round(H * open));
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, Math.round((H - bandH) / 2));
      ctx.fillRect(0, Math.round((H + bandH) / 2), W, H);
      const w = Math.round(W * outCubic(span(lt, 0, 0.06)));
      ctx.globalAlpha = 1 - open;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round((W - w) / 2), Math.round((H - bandH) / 2), w, bandH);
      ctx.globalAlpha = 1;
    }
  },
};

/* ------------------------------------------------------------------ */
/* 2. Title — the logotype, letter by letter on the sixteenths          */

const LETTER_W = [9, 8, 9, 8, 9, 8, 8, 8];
const PEN = LETTER_W.map((_, i) => LETTER_W.slice(0, i).reduce((a, w) => a + w + 1, 0));
const LETTER_SPARK = [RO, RO, GU, GU, null, null, null, null];

const logoCanvas = document.createElement('canvas');

/** The game's logotype at scale L, painted whole into its own canvas. */
function paintLogo(L, time) {
  const { w, h } = logoMetrics();
  const cw = (w + 6) * L;
  const ch = (h + 6) * L;
  if (logoCanvas.width !== cw || logoCanvas.height !== ch) {
    logoCanvas.width = cw;
    logoCanvas.height = ch;
  }
  const c = logoCanvas.getContext('2d');
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, cw, ch);
  drawLogo(c, cw / 2, ch / 2, L, time);
  return { cw, ch };
}

function logoScale(g, maxW, maxH) {
  const { w, h } = logoMetrics();
  return Math.max(2, Math.min(Math.floor(maxW / (w + 6)), Math.floor(maxH / (h + 6))));
}

function titleRays(g, cy, turn) {
  const lw = Math.ceil(g.W / g.u);
  const lh = Math.ceil(g.H / g.u);
  g.layer.size(lw, lh);
  sunburst(g.layer, lw / 2, cy / g.u, turn, [
    ['#3b1a6e', '#2a1152'], ['#2b1350', '#1d0d38'], ['#1a0d2b', '#140a22'], [BG0, '#0e0719'],
  ]);
  g.layer.blit(g.ctx, 0, 0, g.u);
}

const logo = {
  shake(lt) {
    const k = Math.floor(lt / STEP);
    return k < 8 && lt - k * STEP < 0.05 ? 0.8 : 0;
  },

  draw(g, lt, prev) {
    const { ctx, W, H, u } = g;
    const cy = Math.round(H * 0.42);
    titleRays(g, cy, g.time * 0.35);

    const L = logoScale(g, W * 0.86, H * 0.36);
    const { cw, ch } = paintLogo(L, g.time);
    const X0 = Math.round(W / 2 - cw / 2);
    const Y0 = Math.round(cy - ch / 2);
    for (let i = 0; i < 8; i++) {
      const land = i * STEP;
      const fall = span(lt, land - 0.12, 0.12);
      if (fall <= 0) continue;
      const bounce = Math.sin(span(lt, land, 0.1) * Math.PI) * L * 2;
      const off = Math.round(-Math.pow(1 - fall, 2) * H * 0.7 - bounce);
      const sx = i === 0 ? 0 : 3 * L + PEN[i] * L;
      const ex = i === 7 ? cw : 3 * L + PEN[i + 1] * L;
      ctx.drawImage(logoCanvas, sx, 0, ex - sx, ch, X0 + sx, Y0 + off, ex - sx, ch);
      if (crossed(prev, lt, land)) {
        const who = LETTER_SPARK[i];
        g.sparks.burst(X0 + (sx + ex) / 2, Y0 + ch - L * 3, {
          count: 12, colors: who ? [who.color, who.color2] : [GOLD, '#ff9d17', '#fff6c2'],
          speed: u * 50, size: u, life: 0.45, gravity: u * 90, dir: -Math.PI / 2, spread: 2.6,
        });
      }
    }

    // The line under it, typed fast.
    const s = fit('THE 16-BIT PONG DUEL', W * 0.7, Math.max(2, Math.round(L * 0.45)), 1);
    const y1 = Y0 + ch + lineH(s);
    const type = (str, at) => str.slice(0, Math.floor(span(lt, at, 0.16) * str.length));
    text(ctx, type('THE 16-BIT PONG DUEL', 0.8), W / 2, y1, { scale: s, color: GOLD, outline: OUTLINE });
    text(ctx, type('FOR TWO PHONES', 1.1), W / 2, y1 + lineH(s) * 1.8, { scale: s, color: INK, outline: OUTLINE });

    flash(g, flashAlpha(g, lt, 0, 0.22));
  },
};

/* ------------------------------------------------------------------ */
/* 3. Scan — the handshake, two scans and you're in                     */

const CHECK = ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....'];

function check(ctx, cx, cy, px, color) {
  ctx.fillStyle = color;
  const ox = Math.round(cx - (7 * px) / 2);
  const oy = Math.round(cy - (6 * px) / 2);
  CHECK.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') ctx.fillRect(ox + x * px, oy + y * px, px, px);
  });
}

/** The top of a phone's screen: whose phone it is. */
function screenHeader(g, s, ch, label) {
  const { ctx } = g;
  const hh = headerH(s);
  const px = Math.max(1, Math.round(hh / 16));
  const ts = Math.max(1, Math.round(s.w / 80));
  ctx.fillStyle = '#1a1030';
  ctx.fillRect(s.x, s.y, s.w, hh);
  drawFighter(ctx, ch, s.x + px * 8, s.y + hh / 2, px, 0);
  drawTextLeft(ctx, ch.name, s.x + px * 15, s.y + hh / 2, ts + 1, ch.color2);
  drawTextLeft(ctx, label, s.x + s.w - ts * 3 - measure(label, ts), s.y + hh / 2, ts, '#a99cc8');
}

const headerH = (s) => Math.round(s.h * 0.1);

function drawTextLeft(ctx, str, x, y, scale, color) {
  text(ctx, str, x, y, { scale, color, align: 'left' });
}

function showQr(g, s, qr, label) {
  const m = Math.max(1, Math.floor((s.w * 0.84) / (qr.size + 4)));
  const dim = (qr.size + 4) * m;
  const ts = fit(label, s.w * 0.9, Math.max(1, Math.round(s.w / 60)));
  const hh = headerH(s);
  const x = Math.round(s.x + (s.w - dim) / 2);
  const y = Math.round(s.y + hh + (s.h - hh - dim - lineH(ts) * 3) / 2);
  qrCode(g.ctx, qr, x, y, m, 2);
  text(g.ctx, label, s.x + s.w / 2, y + dim + lineH(ts) * 2, { scale: ts, color: INK });
}

function viewfinder(g, s, qr, lt, ok) {
  const { ctx, u } = g;
  ctx.fillStyle = '#1b1430';
  ctx.fillRect(s.x, s.y, s.w, s.h);
  // Sensor noise, shuffled on every frame of the shot.
  const f = Math.floor(lt * 30);
  ctx.fillStyle = '#2a2244';
  for (let i = 0; i < 40; i++) {
    ctx.fillRect(s.x + Math.floor(hash(f * 97 + i) * s.w), s.y + Math.floor(hash(f * 89 + i + 3) * s.h), u, u);
  }
  // The other phone's code, as the camera sees it.
  const m = Math.max(1, Math.floor((s.w * 0.6) / (qr.size + 4)));
  const dim = (qr.size + 4) * m;
  const x = Math.round(s.x + (s.w - dim) / 2 + Math.sin(lt * 9) * u);
  const y = Math.round(s.y + s.h * 0.46 - dim / 2);
  ctx.globalAlpha = 0.28;
  qrCode(ctx, qr, x, y, m, 2);
  ctx.globalAlpha = 1;
  const pad = u * 2;
  brackets(ctx, x - pad, y - pad, dim + pad * 2, dim + pad * 2, Math.round(dim * 0.22), u, ok ? GREEN : '#ffffff');
  if (!ok) {
    const sy = Math.round(y + (0.5 + 0.5 * Math.sin(lt * 16)) * dim);
    ctx.fillStyle = GREEN;
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - pad, sy, dim + pad * 2, u);
    ctx.globalAlpha = 1;
  } else {
    check(ctx, s.x + s.w / 2, y + dim / 2, Math.max(u, Math.round(dim / 12)), GREEN);
  }
  const label = ok ? 'GOT IT' : 'SCANNING';
  const ts = Math.max(1, Math.round(s.w / 60));
  text(ctx, label, s.x + s.w / 2, y + dim + pad + lineH(ts) * 2, { scale: ts, color: ok ? GREEN : INK });
}

function linked(g, s, ch, lt) {
  const { ctx } = g;
  ctx.fillStyle = '#0e0818';
  ctx.fillRect(s.x, s.y, s.w, s.h);
  const ts = fit('LINKED!', s.w * 0.86, Math.round(s.w / 22));
  slam(ctx, 'LINKED!', s.x + s.w / 2, s.y + s.h * 0.3, ts, lt, { color: GREEN, outline: OUTLINE });
  const px = Math.max(2, Math.round(s.w / 20));
  drawFighter(ctx, ch, s.x + s.w / 2, s.y + s.h * 0.58, px, lt * 3 + (ch === GU ? 1 : 0));
  const ls = Math.max(1, Math.round(s.w / 70));
  text(ctx, 'IN THE LOBBY', s.x + s.w / 2, s.y + s.h * 0.82, { scale: ls, color: '#a99cc8' });
}

function inScreen(g, s, paint) {
  g.ctx.save();
  g.ctx.beginPath();
  g.ctx.rect(s.x, s.y, s.w, s.h);
  g.ctx.clip();
  paint();
  g.ctx.restore();
}

/** Light running from one screen to the other: one phone reading the other's code. */
function beam(g, from, to, lt, color) {
  const { ctx, u } = g;
  const x0 = from.x + from.w / 2, y0 = from.y + from.h * 0.42;
  const x1 = to.x + to.w / 2, y1 = to.y + to.h * 0.42;
  for (let k = 0; k < 14; k++) {
    const p = (k / 14 + lt * 2.2) % 1;
    const x = lerp(x0, x1, p);
    const y = lerp(y0, y1, p) - Math.sin(p * Math.PI) * g.H * 0.05;
    ctx.globalAlpha = Math.sin(p * Math.PI);
    ctx.fillStyle = k % 2 ? color : '#ffffff';
    ctx.fillRect(Math.round(x - u), Math.round(y - u), u * 2, u * 2);
  }
  ctx.globalAlpha = 1;
}

function dotGrid(g, drift) {
  const { ctx, W, H, u } = g;
  ctx.fillStyle = BG0;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1d1233';
  const step = u * 8;
  const off = Math.round(drift % step);
  for (let y = -step + off; y < H; y += step) {
    for (let x = -step + off; x < W; x += step) ctx.fillRect(x, y, u, u);
  }
}

const scan = {
  draw(g, lt, prev) {
    const { ctx, W, H, u } = g;
    dotGrid(g, lt * u * 20);

    const capS = fit('SCAN BACK.', W * 0.8, Math.round(H * 0.075 / 7), 2);
    const top = Math.round(H * 0.06 + lineH(capS) + u * 6);
    const [A, B] = phones(g, 2, top, Math.round(H * 0.04));
    const lift = (1 - outCubic(span(lt, 0, 0.14))) * H * 0.7;
    const sa = phone(ctx, A.x, A.y + lift, A.w, A.h, u, RO.color);
    const sb = phone(ctx, B.x, B.y + lift * 1.15, B.w, B.h, u, GU.color);

    // RO hosts: invite, then reads GU's reply. GU joins: reads, then replies.
    inScreen(g, sa, () => {
      if (lt < 0.6) {
        ctx.fillStyle = '#0e0818';
        ctx.fillRect(sa.x, sa.y, sa.w, sa.h);
        screenHeader(g, sa, RO, 'HOST');
        showQr(g, sa, g.qr.game, 'SCAN TO JOIN');
      } else if (lt < 1.2) {
        viewfinder(g, sa, g.qr.reply, lt, lt >= 1.0);
      } else {
        linked(g, sa, RO, lt - 1.2);
      }
    });
    inScreen(g, sb, () => {
      if (lt < 0.6) {
        viewfinder(g, sb, g.qr.game, lt, lt >= 0.4);
      } else if (lt < 1.2) {
        ctx.fillStyle = '#0e0818';
        ctx.fillRect(sb.x, sb.y, sb.w, sb.h);
        screenHeader(g, sb, GU, 'JOIN');
        showQr(g, sb, g.qr.reply, 'YOUR REPLY');
      } else {
        linked(g, sb, GU, lt - 1.2);
      }
    });

    if (lt > 0.05 && lt < 0.42) beam(g, sa, sb, lt, '#5fd9ff');
    if (lt > 0.65 && lt < 1.02) beam(g, sb, sa, lt, '#ff9b4a');
    if (lt >= 1.2) {
      // Linked: WiFi rings between the phones and packets both ways.
      const cx = (sa.x + sa.w + sb.x) / 2;
      const cy = sa.y + sa.h * 0.5;
      for (let k = 0; k < 3; k++) {
        const r = ((lt - 1.2) * u * 40 + k * u * 8) % (u * 24) + u * 4;
        pixelArc(ctx, cx, cy, r, -Math.PI * 0.8, -Math.PI * 0.2, u, k % 2 ? GREEN : '#ffffff');
      }
      beam(g, sa, sb, lt, RO.color);
      beam(g, sb, sa, lt + 0.23, GU.color);
    }
    for (const at of [0.4, 1.0]) {
      if (!crossed(prev, lt, at)) continue;
      const s = at < 0.5 ? sb : sa;
      g.sparks.burst(s.x + s.w / 2, s.y + s.h * 0.42, {
        count: 16, colors: [GREEN, '#ffffff'], speed: u * 50, size: u, life: 0.4, gravity: 0,
      });
    }

    const copy = lt < 0.6 ? ['SCAN.', 0] : lt < 1.2 ? ['SCAN BACK.', 0.6] : ['PLAY!', 1.2];
    slam(ctx, copy[0], W / 2, Math.round(H * 0.06 + lineH(capS) / 2), capS, lt - copy[1], {
      color: lt >= 1.2 ? GREEN : '#ffffff', outline: OUTLINE, shadow: lt >= 1.2 ? '#1e6b45' : GU.color,
    });
  },
};

/* ------------------------------------------------------------------ */
/* 4. RO vs GU                                                          */

const DUEL = [
  { ch: RO, at: 0, line: 'NEAR-DOUBLE-SPEED RETURN' },
  { ch: GU, at: 0.8, line: 'A BARRIER THAT SAVES A BALL' },
];
const VS_AT = 1.6;
const MOVES_AT = 2.4;
const IMPACT = 2.8;

let streakRows = null;
function rowHashes(n) {
  if (!streakRows || streakRows.length !== n) {
    streakRows = Array.from({ length: n }, (_, y) => [hash(y + 11), hash(y + 23), hash(y + 37)]);
  }
  return streakRows;
}

/** Speed lines on both sides of a diagonal split, each in its fighter's colours. */
function duelBackdrop(g, lt) {
  const lw = Math.ceil(g.W / g.u);
  const lh = Math.ceil(g.H / g.u);
  g.layer.size(lw, lh);
  const rows = rowHashes(lh);
  const side = (ch) => ({
    dark: px32(mix(ch.color, BG0, 0.86)),
    mid: px32(mix(ch.color, BG0, 0.72)),
    hot: px32(mix(ch.color2, BG0, 0.3)),
  });
  const ro = side(RO);
  const gu = side(GU);
  const off = px32(mix(GU.color, BG0, 0.94));
  const edge = px32(lt >= VS_AT ? GOLD : '#ffffff');
  const guIn = lt >= DUEL[1].at;
  const tt = lt * 70;
  const portrait = g.portrait;
  g.layer.shade((x, y) => {
    // Which side of the split: left/right on a wide screen, bottom/top on a tall one.
    const d = portrait ? (lh / 2 - y) - (x - lw / 2) * 0.35 : (lw / 2 - x) - (y - lh / 2) * 0.3;
    if (d > -0.8 && d < 0.8) return edge;
    const isRo = d > 0;
    if (!isRo && !guIn) return off;
    const c = isRo ? ro : gu;
    const run = portrait ? y : x;
    const across = portrait ? x : y;
    const dir = isRo ? 1 : -1;
    const r = rows[portrait ? x % lh : y];
    const lane = (run * dir + across * 0.6 - tt * 0.6) % 14;
    if (r[0] < 0.1) {
      const len = 10 + r[1] * 24;
      const head = ((r[2] * 400 + tt * 3) % (portrait ? lh : lw) + (portrait ? lh : lw)) % (portrait ? lh : lw);
      const pos = dir > 0 ? head : (portrait ? lh : lw) - head;
      if (run > pos - len && run < pos) return c.hot;
    }
    return (lane + 14) % 14 < 4 ? c.mid : c.dark;
  });
  g.layer.blit(g.ctx, 0, 0, g.u);
}

function duelLayout(g) {
  const { W, H } = g;
  if (g.portrait) {
    return [
      { cx: W * 0.3, cy: H * 0.7, tx: W * 0.68, ty: H * 0.64, from: [-1, 0], room: W * 0.56 },
      { cx: W * 0.7, cy: H * 0.26, tx: W * 0.32, ty: H * 0.2, from: [1, 0], room: W * 0.56 },
    ];
  }
  return [
    { cx: W * 0.25, cy: H * 0.34, tx: W * 0.25, ty: H * 0.62, from: [-1, 0], room: W * 0.42 },
    { cx: W * 0.75, cy: H * 0.34, tx: W * 0.75, ty: H * 0.62, from: [1, 0], room: W * 0.42 },
  ];
}

function fighterCard(g, d, pos, lt) {
  const { ctx, W, H, u } = g;
  const age = lt - d.at;
  if (age < 0) return;
  const slide = (1 - outCubic(span(age, 0, 0.14))) * W * 0.55 * pos.from[0];
  const px = Math.max(3, Math.floor(Math.min(pos.room * 0.5 / 11, H * (g.portrait ? 0.26 : 0.4) / 12)));
  const bounce = Math.round(Math.abs(Math.sin(((lt - d.at) / (STEP * 4)) * Math.PI)) * -px);
  drawFighter(ctx, d.ch, pos.cx + slide, pos.cy + bounce, px, 0);

  const ns = fit(d.ch.name, pos.room * 0.6, Math.round(H * (g.portrait ? 0.08 : 0.12) / 7), 3);
  const x = pos.tx + slide;
  let y = pos.ty;
  slam(ctx, d.ch.name, x, y, ns, age, { color: d.ch.color, outline: '#ffffff', shadow: OUTLINE });
  y += lineH(ns) * 0.5 + u * 4;
  const ts = Math.max(2, Math.round(ns / 3));
  y += copy(ctx, d.ch.title.toUpperCase(), x, y, pos.room * 0.92, ts, { color: INK, outline: OUTLINE }) + u * 4;

  // The special, in a chip that flashes when the move goes off.
  const move = d.ch.special.name;
  const hot = lt >= MOVES_AT + (d.ch === GU ? 0.2 : 0);
  const ms = fit(move, pos.room * 0.8, ts + 1);
  const mw = measure(move, ms) + u * 6;
  const mh = lineH(ms) + u * 4;
  ctx.fillStyle = hot && Math.floor(lt * 12) % 2 ? d.ch.color2 : OUTLINE;
  ctx.fillRect(Math.round(x - mw / 2), Math.round(y), Math.round(mw), Math.round(mh));
  ctx.strokeStyle = d.ch.color2;
  ctx.lineWidth = Math.max(1, Math.round(u / 2));
  ctx.strokeRect(Math.round(x - mw / 2) + 0.5, Math.round(y) + 0.5, Math.round(mw) - 1, Math.round(mh) - 1);
  text(ctx, move, x, y + mh / 2, {
    scale: ms, color: hot && Math.floor(lt * 12) % 2 ? OUTLINE : d.ch.color2,
  });
  y += mh + u * 3;
  copy(ctx, d.line, x, y, pos.room * 0.9, Math.max(2, ts - 1), { color: '#d9cdf2', outline: OUTLINE });
}

/** AFTERBURN meets AEGIS: RO's fireball, GU's barrier, one bounce. */
function moves(g, lt, prev, L) {
  if (lt < MOVES_AT) return;
  const { ctx, u } = g;
  const [ro, gu] = L;
  const px = Math.max(3, Math.floor(Math.min(ro.room * 0.5 / 11, g.H * (g.portrait ? 0.26 : 0.4) / 12)));
  // The barrier stands in front of GU, facing RO.
  const bw = px * 16;
  const bx = g.portrait ? gu.cx : gu.cx - px * 9;
  const by = g.portrait ? gu.cy + px * 9 : gu.cy;
  const rise = outBack(span(lt, MOVES_AT + 0.2, 0.15));
  if (lt >= MOVES_AT + 0.2) {
    for (let k = 0; k < 8; k++) {
      ctx.globalAlpha = (0.55 + 0.45 * Math.sin(g.time * 18 + k)) * rise;
      ctx.fillStyle = k % 2 ? GU.color2 : GU.color;
      const t = (k - 4) * (bw / 8);
      if (g.portrait) ctx.fillRect(Math.round(bx + t), Math.round(by), Math.round(bw / 8), u * 2);
      else ctx.fillRect(Math.round(bx), Math.round(by + t), u * 2, Math.round(bw / 8));
    }
    ctx.globalAlpha = 1;
  }
  // The fireball: out of RO, into the barrier on the snare, then back.
  const start = [ro.cx, ro.cy];
  const hit = g.portrait ? [bx, by + u * 3] : [bx - u * 3, by];
  const out = span(lt, MOVES_AT, IMPACT - MOVES_AT);
  const back = span(lt, IMPACT, 0.35);
  const p = lt < IMPACT ? out * out : 1;
  let bx2 = lerp(start[0], hit[0], p);
  let by2 = lerp(start[1], hit[1], p);
  if (lt >= IMPACT) {
    bx2 = lerp(hit[0], lerp(start[0], hit[0], 0.5), back);
    by2 = lerp(hit[1], lerp(start[1], hit[1], 0.5) + (g.portrait ? 0 : g.H * 0.1), back);
  }
  const bs = Math.max(u * 3, px * 2);
  if (back < 1) {
    for (let j = 6; j >= 0; j--) {
      const q = lt < IMPACT ? Math.max(0, out - j * 0.04) ** 2 : 1;
      const tx = lt < IMPACT ? lerp(start[0], hit[0], q) : bx2;
      const ty = lt < IMPACT ? lerp(start[1], hit[1], q) : by2;
      const s = Math.round(bs * (1 - j * 0.1));
      ctx.globalAlpha = j ? 0.7 * (1 - j / 7) : 1 - back;
      ctx.fillStyle = j ? (j % 2 ? '#ff7a3d' : RO.color2) : '#fff6c2';
      ctx.fillRect(Math.round(tx - s / 2), Math.round(ty - s / 2), s, s);
    }
    ctx.globalAlpha = 1;
  }
  if (g.running && lt < IMPACT && Math.floor(lt * 40) !== Math.floor(prev * 40)) {
    g.sparks.burst(bx2, by2, { count: 3, colors: ['#ff7a3d', RO.color2], speed: u * 15, size: u, life: 0.3, gravity: -u * 20 });
  }
  if (crossed(prev, lt, IMPACT)) {
    g.sparks.burst(hit[0], hit[1], { count: 30, colors: [GU.color2, '#ffffff', '#ff7a3d'], speed: u * 90, size: u, life: 0.5, gravity: u * 40 });
  }
  const ps = fit('AFTERBURN!', ro.room * 0.9, Math.max(2, Math.round(px * 0.35)), 2);
  const pop = (str, x, y, at, color) => {
    if (lt >= at) slam(ctx, str, x, y - px * 6 - lineH(ps), ps, lt - at, { color, outline: OUTLINE });
  };
  pop('AFTERBURN!', ro.cx, ro.cy, MOVES_AT, RO.color2);
  pop('AEGIS!', gu.cx, gu.cy, MOVES_AT + 0.2, GU.color2);
}

const duel = {
  shake(lt) {
    if (lt >= VS_AT && lt < VS_AT + 0.12) return 1.6;
    if (lt >= IMPACT && lt < IMPACT + 0.1) return 1.2;
    return 0;
  },

  draw(g, lt, prev) {
    const { ctx, W, H } = g;
    duelBackdrop(g, lt);
    const L = duelLayout(g);
    fighterCard(g, DUEL[0], L[0], lt);
    fighterCard(g, DUEL[1], L[1], lt);
    moves(g, lt, prev, L);

    if (lt >= VS_AT) {
      const vs = fit('VS', W * 0.3, Math.round(H * (g.portrait ? 0.1 : 0.16) / 7), 3);
      slam(ctx, 'VS', W / 2, H / 2, vs, lt - VS_AT, {
        color: (col) => (col < 5 ? RO.color : GU.color), outline: '#ffffff', shadow: OUTLINE,
        outlineWidth: Math.max(2, Math.round(vs * 0.5)),
      });
      if (crossed(prev, lt, VS_AT)) {
        g.sparks.burst(W / 2, H / 2, { count: 40, colors: [RO.color, GU.color, GOLD, '#ffffff'], speed: g.u * 110, size: g.u, life: 0.6, gravity: g.u * 30 });
      }
    }
    flash(g, flashAlpha(g, lt, 0, 0.12, 0.6), RO.color);
    flash(g, flashAlpha(g, lt, DUEL[1].at, 0.12, 0.6), GU.color);
    flash(g, flashAlpha(g, lt, VS_AT, 0.2, 0.85));
  },
};

/* ------------------------------------------------------------------ */
/* 5. Stages — four places in Milano, a beat each                       */

const BEAT = STEP * 4;

const stages = {
  draw(g, lt) {
    const { ctx, W, H, u } = g;
    const k = Math.min(3, Math.floor(lt / BEAT));
    const local = lt - k * BEAT;
    const paint = (i) => g.drawStage(STAGES[i], (lt - i * BEAT) * u * 10);
    if (k > 0 && local < 0.07) {
      // A hard diagonal wipe from the last stage into this one.
      paint(k - 1);
      const p = local / 0.07;
      ctx.save();
      ctx.beginPath();
      const edge = p * (W + H * 0.5);
      ctx.moveTo(0, 0);
      ctx.lineTo(edge, 0);
      ctx.lineTo(edge - H * 0.5, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.clip();
      paint(k);
      ctx.restore();
    } else {
      paint(k);
    }

    const st = STAGES[k];
    const ns = fit(st.name, W * 0.86, Math.round(H * 0.085 / 7), 2);
    const h = lineH(ns) + u * 8;
    const y = Math.round(H * 0.72 - h / 2);
    band(ctx, y, h, W, 0.8);
    slam(ctx, st.name, W / 2, y + h / 2, ns, local, { color: st.accent, outline: OUTLINE, shadow: BG0 });
    const cs = fit('4 STAGES, PAINTED IN CODE', W * 0.8, Math.max(2, Math.round(ns * 0.55)), 1);
    const ch = lineH(cs) + u * 6;
    band(ctx, Math.round(H * 0.08), ch, W, 0.7);
    text(ctx, '4 STAGES, PAINTED IN CODE', W / 2, Math.round(H * 0.08 + ch / 2), { scale: cs, color: INK, outline: OUTLINE });
    const ps = Math.max(1, Math.round(cs * 0.7));
    text(ctx, `${k + 1} / 4`, W / 2, y + h + u * 6, { scale: ps, color: '#ffffff', outline: OUTLINE });
    flash(g, flashAlpha(g, local, 0, 0.08, 0.5));
  },
};

/* ------------------------------------------------------------------ */
/* 6. Gameplay — the real match, on RO's phone and on GU's              */

const PLAY_COPY = [
  ['SLIDE TO MOVE.', 0],
  ['TAP TO FIRE.', 0.8],
  ['SPECIALS.', 1.6, RO.color2],
  ['CRATES.', 2.0, GREEN],
  ['CHAOS!', 2.4, GOLD],
];

/** Where the phones and the words go: wide, medium or tall screens. */
export function playLayout(g) {
  const { W, H, u } = g;
  const ratio = W / H;
  if (ratio >= 1.45) {
    const textW = W * 0.38;
    return { mode: 'wide', textW, phones: phones(g, 2, Math.round(H * 0.1), Math.round(H * 0.04), textW, W) };
  }
  const capS = fit('SLIDE TO MOVE.', W * 0.86, Math.round(H * 0.06 / 7), 2);
  const n = ratio >= 0.9 ? 2 : 1;
  const hint = Math.max(1, Math.round(capS * 0.5));
  const top = Math.round(H * 0.05 + lineH(capS) + lineH(hint) * 5 + u * 8);
  return { mode: n === 2 ? 'mid' : 'tall', capS, phones: phones(g, n, top, Math.round(H * 0.04)) };
}

const play = {
  draw(g, lt, prev, dt) {
    const { ctx, W, H, u } = g;
    const demo = g.demo;
    g.drawStage(demo.stage, 0);
    ctx.fillStyle = BG0;
    ctx.globalAlpha = 0.66;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    const free = demo.human >= 0;
    if (!free) demo.sync(lt, g.running);
    const lay = playLayout(g);
    g.phoneRects = [];
    const labels = ['YOUR PHONE', "FRIEND'S PHONE"];
    lay.phones.forEach((r, i) => {
      const s = phone(ctx, r.x, r.y, r.w, r.h, u, i ? GU.color : RO.color);
      g.phoneRects.push({ ...s, view: i });
      demo.screens[i].resize(s.w, s.h);
      const canvas = demo.draw(i, g.time, dt, g.running || free);
      g.blitScreen(canvas, s);
      const ls = Math.max(1, Math.round(r.w / 90));
      const mine = free && demo.human === i;
      text(ctx, mine ? 'YOU' : free ? 'CPU' : labels[i], r.x + r.w / 2, r.y - lineH(ls), {
        scale: ls, color: mine ? GOLD : '#d9cdf2', outline: OUTLINE,
      });
    });

    const hint = (g.coarse ? 'TAP' : 'CLICK') + ' A PHONE TO PLAY';
    const lines = free
      ? [['FREE PLAY', 0, GOLD], [`YOU ARE ${demo.human ? 'GU' : 'RO'}`, 0, demo.human ? GU.color2 : RO.color2],
        ['SLIDE TO MOVE.', 0], [g.coarse ? 'TAP YOUR PADDLE.' : 'CLICK TO FIRE.', 0]]
      : PLAY_COPY;
    const blink = Math.floor(g.time * 2.5) % 2 === 0;
    if (lay.mode === 'wide') {
      const s = fit('SLIDE TO MOVE.', lay.textW * 0.86, Math.round(H * 0.075 / 7), 2);
      const x = lay.textW * 0.52;
      const y0 = H * 0.5 - (lines.length * (lineH(s) + s * 2.4)) / 2;
      captions(g, lines, x, y0, s, free ? 1 : lt);
      const hs = Math.max(1, Math.round(s * 0.45));
      if (!free && blink) text(ctx, hint, x, H * 0.86, { scale: hs, color: GOLD, outline: OUTLINE });
      if (free && !g.coarse) text(ctx, 'ESC: BACK TO THE TRAILER', x, H * 0.86, { scale: hs, color: '#a99cc8', outline: OUTLINE });
    } else {
      const s = lay.capS;
      let cur = lines[0];
      for (const l of lines) if ((free ? 1 : lt) >= l[1]) cur = l;
      const y = Math.round(H * 0.05 + lineH(s) / 2);
      if (free) {
        const str = `FREE PLAY - YOU ARE ${demo.human ? 'GU' : 'RO'}`;
        text(ctx, str, W / 2, y, { scale: fit(str, W * 0.92, s, 1), color: GOLD, outline: OUTLINE });
      } else {
        slam(ctx, cur[0], W / 2, y, s, lt - cur[1], { color: cur[2] || INK, outline: OUTLINE, shadow: BG0 });
      }
      const hs = Math.max(1, Math.round(s * 0.5));
      if (!free && blink) text(ctx, hint, W / 2, y + lineH(s) + u * 3, { scale: hs, color: GOLD, outline: OUTLINE });
    }
    if (!free) flash(g, flashAlpha(g, lt, 0, 0.12, 0.5));
  },
};

/* ------------------------------------------------------------------ */
/* 7. Play now                                                          */

/** The space the page's buttons take at the foot of the end card, in CSS pixels. */
export const ctaRoom = (g) => (g.W < 560 ? 250 : 184);

function endCard(g, lt) {
  const { ctx, W, H, u } = g;
  const bottom = H - ctaRoom(g);
  const L = logoScale(g, W * 0.82, H * 0.22);
  const { h: lh } = logoMetrics();
  const logoH = (lh + 6) * L;
  const logoY = Math.round(Math.max(H * 0.03, u * 3) + logoH / 2);
  const { cw, ch } = paintLogo(L, g.time);
  const pop = outBack(span(lt, 0, 0.18));
  ctx.drawImage(logoCanvas, Math.round(W / 2 - cw / 2), Math.round(logoY - ch / 2 - (1 - pop) * H * 0.3), cw, ch);

  let y = logoY + logoH / 2 + u;
  const ts = fit('PLAY FREE IN YOUR BROWSER', W * 0.86, Math.max(2, Math.round(L * 0.6)), 1);
  if (lt >= 0.8) {
    slam(ctx, 'PLAY FREE IN YOUR BROWSER', W / 2, y + lineH(ts) / 2, ts, lt - 0.8, { color: GOLD, outline: OUTLINE, shadow: BG0 });
  }
  y += lineH(ts) + u * 5;

  // Made in Milano, just above the buttons.
  const ms = Math.max(2, Math.round(ts * 0.6));
  const my = bottom - lineH(ms);
  if (lt >= 1.6) {
    const str = 'MADE IN MILANO WITH';
    const w = measure(str + ' @', ms);
    const x = Math.round(W / 2 - w / 2);
    text(ctx, str, x, my, { scale: ms, color: '#d9cdf2', align: 'left', outline: OUTLINE });
    text(ctx, '@', x + w, my, { scale: ms, color: RO.color, align: 'right', outline: OUTLINE });
  }

  // The code to scan, between the two of them. It opens the game.
  const qr = g.qr.game;
  const ss = Math.max(1, Math.round(ts * 0.8));
  const labelH = lineH(ss) + u * 5;
  const room = Math.max(u * 20, my - lineH(ms) * 1.5 - y - labelH);
  const m = Math.max(2, Math.floor(Math.min(room, W * (g.portrait ? 0.52 : 0.4)) / (qr.size + 4)));
  const dim = (qr.size + 4) * m;
  const qy = Math.round(y + (room - dim) / 2);
  if (lt >= 1.2) {
    const k = outBack(span(lt, 1.2, 0.15));
    ctx.save();
    ctx.translate(W / 2, qy + dim / 2);
    ctx.scale(k, k);
    ctx.fillStyle = OUTLINE;
    ctx.fillRect(-dim / 2 - u * 2, -dim / 2 - u * 2, dim + u * 4, dim + u * 4);
    qrCode(ctx, qr, -dim / 2, -dim / 2, m, 2);
    ctx.restore();
    text(ctx, 'SCAN TO PLAY', W / 2, qy + dim + u * 4 + lineH(ss) / 2, { scale: ss, color: INK, outline: OUTLINE });
  }
  const px = Math.max(2, Math.floor(Math.min(dim * 0.8, (W - dim) / 2 * 0.45) / 12));
  const side = dim / 2 + u * 4 + px * 8;
  drawFighter(ctx, RO, W / 2 - side, qy + dim / 2, px, g.time * 2);
  drawFighter(ctx, GU, W / 2 + side, qy + dim / 2, px, g.time * 2 + 1.3);
}

const end = {
  shake(lt) { return lt < 0.12 ? 1.4 : 0; },

  draw(g, lt) {
    titleRays(g, g.H * 0.3, g.time * 0.25);
    stars(g, 40);
    endCard(g, lt);
    flash(g, flashAlpha(g, lt, 0, 0.25));
  },
};

export const SHOT_PAINTERS = { hook, logo, scan, duel, stages, play, end };

/* ------------------------------------------------------------------ */
/* Before the start: the title screen                                   */

export function gate(g) {
  const { ctx, W, H, u } = g;
  if (g.stageReady(STAGES[0])) {
    g.drawStage(STAGES[0], g.time * u * 4);
    ctx.fillStyle = BG0;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  } else {
    titleRays(g, H * 0.36, g.time * 0.2);
  }
  const L = logoScale(g, W * 0.9, H * 0.3);
  const { cw, ch } = paintLogo(L, g.time);
  const cy = Math.round(H * 0.34);
  ctx.drawImage(logoCanvas, Math.round(W / 2 - cw / 2), Math.round(cy - ch / 2), cw, ch);
  let y = cy + ch / 2 + u * 2;
  y += copy(ctx, 'A 16-BIT PONG DUEL FOR TWO PHONES', W / 2, y, W * 0.84, Math.max(2, Math.round(L * 0.55)), { color: GOLD, outline: OUTLINE });
  copy(ctx, '17-SECOND TRAILER. SOUND ON.', W / 2, y + u * 5, W * 0.84, Math.max(2, Math.round(L * 0.4)), { color: '#d9cdf2', outline: OUTLINE });
}

