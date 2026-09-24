// RoGuPong — everything you see during a match.
//
// The court is a fixed-aspect portrait rectangle so both phones play on
// identical geometry no matter how tall their screens are; the leftover space
// above and below becomes the HUD. Each phone flips the y axis for player 1,
// so you are always the paddle at the bottom.

import { drawText, measure } from '../ui/pixelfont.js';
import { BALL_R, PADDLE_H, PADDLE_Y, SHIELD_Y, CRATE_R, COURT_ASPECT, ballRadius } from './match.js';
import { itemById } from './items.js';

const SHAKE_MARGIN = 24;        // slack the backdrop paints beyond the canvas
const HUD_TOP = 0.105;          // fraction of canvas height
const HUD_BOTTOM = 0.155;

/* ------------------------------------------------------------------ */
/* Fighter sprites — 11x12, hand-placed                                */

const BODY = [
  '..3333333..',
  '.333333333.',
  '.311111113.',
  '.314111413.',
  '.311111113.',
  '.312222213.',
  '.331111133.',
  '..3333333..',
  '...3...3...',
];

const CRESTS = {
  ro: ['....2......', '...222.....', '..22.22....'],
  gu: ['.2.......2.', '.22.....22.', '..2.....2..'],
  neo: ['.....2.....', '....2.2....', '...2...2...'],
  brio: ['..2..2..2..', '...2..2....', '..2222222..'],
  mag: ['..22...22..', '..22...22..', '...22222...'],   // a little horseshoe magnet
  boo: ['...22222...', '..22.2.22..', '..2.2.2.2..'],   // a wavy ghost fringe
};

/** Draw a character's little pixel mascot, centred on (cx, cy). */
export function drawFighter(ctx, char, cx, cy, px, t = 0) {
  const rows = [...(CRESTS[char.id] || CRESTS.ro), ...BODY];
  const w = 11, h = rows.length;
  const bob = Math.round(Math.sin(t * 2.4) * 0.5);
  const ox = Math.round(cx - (w * px) / 2);
  const oy = Math.round(cy - (h * px) / 2) + bob * px;
  const palette = { 1: char.color, 2: char.color2, 3: '#1a0d2b', 4: '#ffffff' };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = rows[y][x];
      if (c === '.' || !palette[c]) continue;
      ctx.fillStyle = palette[c];
      ctx.fillRect(ox + x * px, oy + y * px, px, px);
    }
  }
}

/* ------------------------------------------------------------------ */

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* Stage props — painted once per size in art pixels, like the scenery */

const PROP_RISE = 0.35;         // seconds a prop takes to rise out of the floor
const PROP_FALL = 0.5;          // ... and to crumble or melt away at the end
const ARCO_COLOR = itemById('arco').color;

// Candoglia marble, lit from the left like the rooftop's low sun.
const MARBLE = {
  ink: '#2a2233', shade: '#9a8c9c', mid: '#d8ccc3', lit: '#f7efe5',
  niche: '#4a3d58', gold: '#ffcf5a', slab: '#a99ba3', slabVein: '#968893', shadow: '#6f6376',
};
const SNOW = ['#ffffff', '#f6f9ff', '#e6eefd', '#c9d6f5', '#a3b4e6', '#7f90cc'];
const ALPENGLOW = '#ffc9de';        // the crest catching the sunset
const SNOW_INK = '#343a78';

/**
 * A pixel grid painter: set cells, ring the silhouette in ink, blit once.
 * Sprites are tiny (a few hundred cells) and painted only when their size
 * changes, so plain fillRects are plenty.
 */
function pixelSprite(w, h, paint, outline) {
  const cells = new Array(w * h).fill(null);
  const set = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = c;
  };
  paint(set);
  if (outline) {
    const ring = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (cells[y * w + x]) continue;
        const n = (x > 0 && cells[y * w + x - 1]) || (x < w - 1 && cells[y * w + x + 1])
          || (y > 0 && cells[(y - 1) * w + x]) || (y < h - 1 && cells[(y + 1) * w + x]);
        if (n) ring.push(y * w + x);
      }
    }
    for (const i of ring) cells[i] = outline;
  }
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const octx = off.getContext('2d');
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    octx.fillStyle = cells[i];
    octx.fillRect(i % w, (i / w) | 0, 1, 1);
  }
  return off;
}

/** The round slab the pinnacle stands on: exactly the circle the ball bounces off. */
function paintPlinth(rA, hw) {
  const d = rA * 2 + 1;
  return pixelSprite(d, d, (set) => {
    for (let y = 0; y < d; y++) {
      for (let x = 0; x < d; x++) {
        const dx = x - rA, dy = y - rA;
        const dist = Math.hypot(dx, dy);
        if (dist > rA + 0.3) continue;
        // A slab seen from above, a shade darker than the pinnacle so the
        // shaft stands off it.
        let c = MARBLE.slab;
        if (dist > rA - 0.9) c = MARBLE.ink;
        else if (dist > rA - 2.2) c = dx + dy < 0 ? MARBLE.lit : MARBLE.shade;   // bevelled rim
        else if (dist > rA - 3.2 && ((x + y) & 1)) c = MARBLE.slabVein;
        // The shaft's shadow falls to the right, away from the sun.
        if (dist <= rA - 0.9 && dx > hw && dx < hw + rA * 0.55 && Math.abs(dy + 1) < 2.2) c = MARBLE.shadow;
        set(x, y, c);
      }
    }
  });
}

/** The pinnacle itself: shaft, niche, crocketed spire and a gold figure on top. */
function paintSpireShaft(rA, hw) {
  const bodyH = Math.max(6, Math.round(rA * 1.15));
  const spireH = Math.max(6, Math.round(rA * 1.3));
  const w = hw * 2 + 5, h = bodyH + spireH + 6;
  const cx = hw + 2;
  const sprite = pixelSprite(w, h, (set) => {
    const at = (row) => h - 1 - row;                     // rows counted up from the base
    const tone = (x, half) => (x <= -half + 1 ? MARBLE.lit : x >= half - 1 ? MARBLE.shade : MARBLE.mid);
    for (let r = 0; r < bodyH; r++) {
      const band = r < 2 || r === bodyH - 1;             // plinth and cornice mouldings stand proud
      const half = band ? hw + 1 : hw;
      for (let x = -half; x <= half; x++) set(cx + x, at(r), tone(x, half));
    }
    // A gothic niche, pointed at the top.
    const n0 = Math.round(bodyH * 0.3), n1 = Math.round(bodyH * 0.78);
    for (let r = n0; r <= n1; r++) {
      const nw = r === n1 ? 0 : Math.max(0, Math.min(1, hw - 2));
      for (let x = -nw; x <= nw; x++) set(cx + x, at(r), MARBLE.niche);
    }
    // Corner pinnacles on the cornice.
    for (const side of [-1, 1]) {
      for (let r = bodyH; r < bodyH + 3; r++) set(cx + side * hw, at(r), side < 0 ? MARBLE.lit : MARBLE.shade);
    }
    // The spire tapers to a point, crockets up both edges.
    for (let r = 0; r < spireH; r++) {
      const half = Math.round((hw - 1) * (1 - r / spireH));
      for (let x = -half; x <= half; x++) set(cx + x, at(bodyH + r), tone(x, Math.max(1, half)));
      if (r % 3 === 1 && half > 0) {
        set(cx - half - 1, at(bodyH + r), MARBLE.lit);
        set(cx + half + 1, at(bodyH + r), MARBLE.shade);
      }
    }
    // The little gilded figure on top.
    const top = bodyH + spireH;
    set(cx, at(top), MARBLE.gold);
    set(cx - 1, at(top + 1), MARBLE.gold); set(cx, at(top + 1), MARBLE.gold); set(cx + 1, at(top + 1), MARBLE.gold);
    set(cx, at(top + 2), MARBLE.gold);
    set(cx, at(top + 3), '#fff2c4');
  }, MARBLE.ink);
  return { sprite, cx };
}

/** A wind-packed snowbank, crest up; `hits` bites chunks out of it. */
function paintDrift(wA, hA, hits, floor) {
  const h = hA + 2;                                     // headroom for the ink line
  return pixelSprite(wA, h, (set) => {
    for (let x = 0; x < wA; x++) {
      const u = ((x + 0.5) / wA) * 2 - 1;
      // Steep-ended, so the bank stops in a short wall rather than a long
      // slope a ball could visibly bounce off thin air above.
      const body = Math.pow(Math.max(0, 1 - u * u * u * u), 0.3);
      const lumps = 1 + 0.10 * Math.sin(u * 9 + 1.3) + 0.06 * Math.sin(u * 23 + 0.4);
      // The mound sits on a floor as high as the bounce line, so a block
      // shrinks and bites the mound but never the part a ball bounces off.
      const mound = hA - floor;
      let top = floor + mound * body * lumps * (1 - 0.34 * hits);
      // A block leaves a bite where the snow gave.
      if (hits) top -= mound * 0.6 * Math.max(0, 1 - Math.abs(u + 0.18) * 4);
      // Never below the line the ball actually bounces off, bitten or not.
      const colH = Math.max(floor, Math.min(hA, Math.round(top)));
      for (let r = 0; r < colH; r++) {
        const depth = colH - 1 - r;                    // 0 at the crest
        const y = h - 1 - r;
        let c;
        if (depth === 0) c = x % 5 === 2 ? SNOW[0] : ALPENGLOW;
        else if (depth === 1) c = SNOW[1];
        else {
          // Bands deepen toward the base, dithered where they meet.
          const f = r / Math.max(1, colH);
          const band = f > 0.6 ? 2 : f > 0.28 ? 3 : 4;
          const seam = (f > 0.55 && f < 0.66) || (f > 0.23 && f < 0.33);
          c = SNOW[seam && ((x + y) & 1) ? band + 1 : band];
        }
        set(x, y, c);
      }
      if (colH > 0 && x % 7 === 3 && colH > 3) set(x, h - 1 - Math.round(colH * 0.45), SNOW[1]);
    }
  }, SNOW_INK);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    // desynchronized lets Chrome present the canvas without waiting on the
    // compositor, which is a real chunk of the touch-to-paddle latency on
    // Android. It is a hint: browsers that don't support it ignore it.
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.trails = new Map();
    this.scanlines = null;
    this.gradCache = new Map();
    this.sceneCache = {};
    this.ap = 2;
    // 'high' draws the full 16-bit treatment. 'low' drops everything that costs
    // a lot of fill rate for a little polish — canvas shadows above all, which
    // are the single most expensive thing an older phone GPU can be asked to do
    // here — and keeps the game itself pixel-identical.
    this.quality = 'high';
    this.dpr = 1;
    this.W = 0;
    this.H = 0;
    this.specialRect = null;
    this.resize();
  }

  setQuality(quality) {
    const next = quality === 'low' ? 'low' : 'high';
    if (next === this.quality) return;
    this.quality = next;
    this.resize();
  }

  /** Canvas shadows are the expensive one; everything else is bookkeeping. */
  glow(colour, blur) {
    if (this.quality === 'low') return;
    this.ctx.shadowColor = colour;
    this.ctx.shadowBlur = blur;
  }

  /**
   * Per-frame gradients are surprisingly costly on weak devices — cache them
   * by key. Cleared on resize, and stage/character changes alter the keys.
   */
  grad(key, make) {
    let g = this.gradCache.get(key);
    if (!g) { g = make(); this.gradCache.set(key, g); }
    return g;
  }

  resize() {
    // 'low' renders at 1x. On a 720p phone that halves every pixel the GPU
    // has to fill, and the chunkier look suits the game anyway.
    const cap = this.quality === 'low' ? 1 : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.dpr = dpr;
    this.W = w;
    this.H = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.scanlines = null;
    this.vignette = null;
    this.gradCache.clear();
    // The scene cache survives: stage art depends only on the CSS size (its
    // keys carry it), not on DPR or quality, so a Graphics switch — or the
    // automatic one, mid-match on a phone already struggling — costs no repaint.
    this.ap = this.artPixel();
    this.layout();
  }

  layout() {
    const pad = Math.round(this.W * 0.025);
    const top = this.H * HUD_TOP;
    const bottom = this.H * HUD_BOTTOM;
    const availH = this.H - top - bottom;
    let ch = availH;
    let cw = ch * COURT_ASPECT;
    if (cw > this.W - pad * 2) {
      cw = this.W - pad * 2;
      ch = cw / COURT_ASPECT;
    }
    this.court = {
      x: Math.round((this.W - cw) / 2),
      y: Math.round(top + (availH - ch) / 2),
      w: Math.round(cw),
      h: Math.round(ch),
    };
    const stripH = this.H - (this.court.y + this.court.h);
    const bw = Math.min(this.W * 0.32, 160);
    const bh = Math.min(stripH * 0.52, 62);
    this.specialRect = {
      x: this.W - bw - pad,
      y: this.court.y + this.court.h + (stripH - bh) / 2,
      w: bw,
      h: bh,
    };
    this.pad = pad;
    this.unit = this.court.w;      // one "court width" in screen pixels
  }

  /* ---------------------------------------------------------------- */

  /** Court space -> screen space, honouring the per-player view flip. */
  pt(x, y, flip) {
    const c = this.court;
    return [c.x + x * c.w, c.y + (flip ? 1 - y : y) * c.h];
  }

  draw(m, opts) {
    const {
      view = 0, stage, fx, time = 0, names = ['P1', 'P2'], chars,
      flairs = ['none', 'none'],
      localPaddleX = null, rtt = 0, showTouchHint = false,
    } = opts;
    const ctx = this.ctx;
    const flip = view === 1;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const shake = Math.min(m.shake, 1.5);
    if (shake > 0.01) {
      const s = shake * this.W * 0.016;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    this.drawBackdrop(stage, time, true);
    this.drawCourt(m, stage, flip, chars, view, time);
    this.drawProps(m, flip, time);
    this.drawCrates(m, flip, time);
    this.drawBalls(m, flip, chars, time, flairs);
    this.drawPaddles(m, flip, chars, view, localPaddleX, flairs, time);
    this.drawFx(fx, flip);
    this.drawBanners(m, flip, chars, view, time);
    this.drawHud(m, chars, names, view, time, rtt);
    if (showTouchHint) this.drawTouchHint(time);
    this.drawOverlay(fx);
  }

  /* ---------------------------------------------------------------- */
  /* Scenery                                                           */

  /**
   * Stage art is painted in art pixels — a canvas a few times smaller than the
   * screen — and scaled up with nearest-neighbour sampling. That is the 16-bit
   * look and the cheap path at once: each scene is painted once per stage and
   * size, so however detailed the painting, a frame costs one blit. 'high' adds
   * the scene's small animation layer on top (lamp flicker, water shimmer,
   * drifting snow); 'low' shows the still painting.
   */
  artPixel() {
    return Math.max(2, Math.round(Math.min(this.W, this.H) / 180));
  }

  sceneLayer(slot, key, w, h, paint) {
    let entry = this.sceneCache[slot];
    if (!entry || entry.key !== key) {
      const off = document.createElement('canvas');
      off.width = Math.max(1, Math.ceil(w / this.ap));
      off.height = Math.max(1, Math.ceil(h / this.ap));
      const octx = off.getContext('2d', { alpha: false });
      paint(octx, off.width, off.height);
      entry = { key, canvas: off };
      this.sceneCache[slot] = entry;
    }
    return entry.canvas;
  }

  drawBackdrop(stage, time, hud = false) {
    // Overdraw the edges: screen shake translates the canvas, and a backdrop
    // that stopped at the old bounds would leave the previous frame showing in
    // the gap.
    const M = SHAKE_MARGIN;
    const ap = this.ap;
    const scene = stage.scene;
    const key = `${stage.id}:${this.W}x${this.H}@${ap}`;
    const live = this.quality !== 'low' && scene.animateBackdrop;
    let art = this.sceneLayer('backdrop', key,
      this.W + M * 2, this.H + M * 2, (octx, w, h) => scene.backdrop(octx, w, h));
    if (hud && !live) {
      // A still backdrop gets its HUD scrim baked in: free every frame.
      const base = art;
      art = this.sceneLayer('backdropHud', key, this.W + M * 2, this.H + M * 2, (octx, w, h) => {
        octx.drawImage(base, 0, 0);
        this.paintHudScrim(octx, w, h);
      });
    }
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(art, -M, -M, art.width * ap, art.height * ap);
    if (!live) return;
    ctx.save();
    ctx.translate(-M, -M);
    ctx.scale(ap, ap);
    scene.animateBackdrop(ctx, art.width, art.height, time);
    // An animated one gets it on top of the animation, or a lamp flickering
    // in a strip would flash at full brightness against the dimmed rest.
    if (hud) this.paintHudScrim(ctx, art.width, art.height);
    ctx.restore();
  }

  /**
   * During a match the scores and names sit on the strips of backdrop above
   * and below the court, and a daylit stage (Brera's paving, the Duomo's
   * marble) would swallow the dimmer HUD text. Darken those strips in a few
   * flat bands, deepest at the screen edge. Drawn in art pixels, into a baked
   * copy of the backdrop on fast graphics or over the animation layer on full;
   * the menus keep the full view either way.
   */
  paintHudScrim(ctx, w, h) {
    const M = SHAKE_MARGIN;
    const ap = this.ap;
    const c = this.court;
    const top = Math.round((c.y + M) / ap);
    const bottom = Math.round((c.y + c.h + M) / ap);
    const BANDS = 5;
    ctx.fillStyle = '#07040f';
    for (let k = 0; k < BANDS; k++) {
      ctx.globalAlpha = 0.5 - k * 0.09;
      const th = Math.round(top * (k + 1) / BANDS) - Math.round(top * k / BANDS);
      ctx.fillRect(0, Math.round(top * k / BANDS), w, th);
      const bh = h - bottom;
      const y0 = h - Math.round(bh * (k + 1) / BANDS);
      ctx.fillRect(0, y0, w, h - Math.round(bh * k / BANDS) - y0);
    }
    ctx.globalAlpha = 1;
  }

  /** The court floor: the same place seen from above. Called inside the court clip. */
  drawCourtFloor(stage, time) {
    const c = this.court;
    const ap = this.ap;
    const scene = stage.scene;
    // Keyed on the art pixel too: two screens can share a court size but not
    // an art pixel, and the cache now outlives a resize.
    const art = this.sceneLayer('court', `${stage.id}:${c.w}x${c.h}@${ap}`,
      c.w, c.h, (octx, w, h) => scene.court(octx, w, h));
    // The art canvas rounds up to whole art pixels; centre the overhang so a
    // floor painted symmetric stays symmetric on screen.
    const ox = c.x - Math.floor((art.width * ap - c.w) / 2);
    const oy = c.y - Math.floor((art.height * ap - c.h) / 2);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(art, ox, oy, art.width * ap, art.height * ap);
    if (this.quality === 'low' || !scene.animateCourt) return;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(ap, ap);
    scene.animateCourt(ctx, art.width, art.height, time);
    ctx.restore();
  }

  /* ---------------------------------------------------------------- */
  /* Court                                                             */

  drawCourt(m, stage, flip, chars, view, time) {
    const ctx = this.ctx;
    const c = this.court;

    ctx.save();
    this.glow('rgba(0,0,0,0.6)', 24);
    ctx.fillStyle = stage.court;
    roundRect(ctx, c.x, c.y, c.w, c.h, 10);
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, c.x, c.y, c.w, c.h, 10);
    ctx.clip();

    this.drawCourtFloor(stage, time);

    // Centre line
    ctx.strokeStyle = stage.line;
    ctx.lineWidth = Math.max(2, c.w * 0.008);
    ctx.setLineDash([c.w * 0.045, c.w * 0.035]);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y + c.h / 2);
    ctx.lineTo(c.x + c.w, c.y + c.h / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Centre ring
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(c.x + c.w / 2, c.y + c.h / 2, c.w * 0.15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Goal strips, tinted by whoever defends them
    for (let i = 0; i < 2; i++) {
      const atBottom = (i === view);
      const gy = atBottom ? c.y + c.h - c.h * 0.012 : c.y;
      ctx.fillStyle = this.grad(`goal:${chars[i].color}:${gy}:${atBottom}`, () => {
        const grad = ctx.createLinearGradient(0, gy, 0, gy + (atBottom ? -c.h * 0.09 : c.h * 0.09));
        grad.addColorStop(0, chars[i].color + 'cc');
        grad.addColorStop(1, chars[i].color + '00');
        return grad;
      });
      ctx.fillRect(c.x, atBottom ? gy - c.h * 0.09 : gy, c.w, c.h * 0.09 + c.h * 0.012);
      ctx.fillStyle = chars[i].color;
      ctx.fillRect(c.x, atBottom ? c.y + c.h - 3 : c.y, c.w, 3);
    }

    // Rally counter, ghosted behind play
    if (m.rally > 2 && m.phase === 'play') {
      drawText(ctx, String(m.rally), c.x + c.w / 2, c.y + c.h / 2, {
        scale: Math.max(3, c.w / 42), color: 'rgba(255,255,255,0.10)',
        align: 'center', baseline: 'middle',
      });
    }

    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    roundRect(ctx, c.x, c.y, c.w, c.h, 10);
    ctx.stroke();
  }

  /* ---------------------------------------------------------------- */
  /* Actors                                                            */

  /** A prop sprite, painted once per size and art pixel. */
  propSprite(key, make) {
    if (!this.propArt) this.propArt = new Map();
    let art = this.propArt.get(key);
    if (!art) {
      if (this.propArt.size > 24) this.propArt.clear();    // old screen sizes
      art = make();
      this.propArt.set(key, art);
    }
    return art;
  }

  /**
   * SPIRE pinnacles and AVALANCHE snowdrifts. Both are cached pixel sprites;
   * rising and crumbling are just how much of the sprite shows above the
   * floor, so a prop costs a couple of blits in either quality.
   */
  drawProps(m, flip, time) {
    if (!m.props || !m.props.length) return;
    for (const q of m.props) {
      if (q.kind === 'spire') this.drawSpire(q, flip, time);
      else if (q.kind === 'drift') this.drawDrift(q, flip, time);
    }
  }

  /** How much of a prop stands: rising at the start, sinking at the end. */
  propStanding(q) {
    const rise = Math.min(1, (q.age || 0) / PROP_RISE);
    const fall = Math.min(1, Math.max(0, q.t) / PROP_FALL);
    return Math.min(rise * (2 - rise), fall);            // ease out of the floor
  }

  drawSpire(q, flip, time) {
    const ctx = this.ctx;
    const ap = this.ap;
    // The plinth is the collision circle, so it is sized from the court width
    // and drawn round on screen whichever way up the view is.
    const rA = Math.max(4, Math.round((q.size * this.court.w) / ap));
    const hw = Math.max(2, Math.round(rA * 0.36));
    const plinth = this.propSprite(`plinth:${rA}:${hw}`, () => paintPlinth(rA, hw));
    const shaft = this.propSprite(`shaft:${rA}:${hw}`, () => paintSpireShaft(rA, hw));
    const [sx, sy] = this.pt(q.x, q.y, flip);
    const k = this.propStanding(q);
    const ending = q.t < PROP_FALL;
    // Crumbling: the whole thing shudders as it goes down.
    const jit = ending ? Math.round(Math.sin(time * 70)) * ap : 0;
    const px = Math.round(sx - (rA + 0.5) * ap) + jit;
    const py = Math.round(sy - (rA + 0.5) * ap);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = Math.min(1, 0.35 + k);
    ctx.drawImage(plinth, px, py, plinth.width * ap, plinth.height * ap);
    ctx.globalAlpha = 1;
    // Upright on screen for both views; only its footing flips with the court.
    const show = Math.round(shaft.sprite.height * k);
    if (show > 0) {
      const baseY = Math.round(sy + ap);                  // stands on the slab's centre
      const left = Math.round(sx - (shaft.cx + 0.5) * ap) + jit;
      this.glow('rgba(255,214,150,0.35)', 8);
      ctx.drawImage(shaft.sprite, 0, 0, shaft.sprite.width, show,
        left, baseY - show * ap, shaft.sprite.width * ap, show * ap);
    }
    ctx.restore();
  }

  drawDrift(q, flip, time) {
    const ctx = this.ctx;
    const c = this.court;
    const ap = this.ap;
    // As wide as the hitbox (the half span plus half a ball either side), and
    // never lower than the line a ball bounces off, so the snow is always
    // where the bounce is.
    const reach = q.size + BALL_R * 0.5;
    const wA = Math.max(6, Math.round((reach * 2 * c.w) / ap));
    const line = Math.abs((q.p === 0 ? 1 : 0) - q.y) * c.h / ap;
    const floor = Math.round(line) + 1;
    const hA = floor + Math.max(3, Math.round(0.018 * c.h / ap));
    const hits = Math.min(1, q.hits || 0);
    const art = this.propSprite(`drift:${wA}:${hA}:${hits}:${floor}`, () => paintDrift(wA, hA, hits, floor));
    const k = this.propStanding(q);
    const show = Math.round(art.height * k);
    if (show <= 0) return;
    const [x0, edge] = this.pt(q.x - reach, q.p === 0 ? 1 : 0, flip);
    const left = Math.round(x0);
    const up = Math.round(edge) >= c.y + c.h / 2;         // this goal is at the bottom of the screen
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(left, Math.round(edge));
    if (!up) ctx.scale(1, -1);                            // the far goal's drift hangs toward the court
    ctx.drawImage(art, 0, 0, art.width, show, 0, -show * ap, art.width * ap, show * ap);
    if (this.quality !== 'low' && k >= 1) {
      // A few crystals catching the sun.
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 3; i++) {
        const tw = Math.floor(time * 2.5 + i * 1.7);
        const fx = ((tw * 37 + i * 53) % 97) / 97;
        if (Math.sin(time * 9 + i * 2) < 0.2) continue;
        const col = Math.floor(fx * wA);
        ctx.fillRect(col * ap, -Math.round(show * (0.55 + 0.3 * ((i * 0.37) % 1))) * ap, ap, ap);
      }
    }
    ctx.restore();
  }

  drawCrates(m, flip, time) {
    const ctx = this.ctx;
    const r = CRATE_R * this.court.w;
    for (const c of m.crates) {
      const [sx, sy] = this.pt(c.x, c.y, flip);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(Math.sin(c.spin) * 0.25);
      const pulse = 1 + Math.sin(time * 6) * 0.06;
      ctx.scale(pulse, pulse);
      ctx.fillStyle = 'rgba(20,10,32,0.85)';
      roundRect(ctx, -r, -r, r * 2, r * 2, r * 0.28);
      ctx.fill();
      ctx.lineWidth = Math.max(2, r * 0.16);
      ctx.strokeStyle = c.item.color;
      roundRect(ctx, -r, -r, r * 2, r * 2, r * 0.28);
      ctx.stroke();
      this.glow(c.item.color, 14);
      drawText(ctx, c.item.glyph, 0, 0, {
        scale: Math.max(2, r / 4), color: c.item.color, align: 'center', baseline: 'middle',
      });
      ctx.restore();
    }
  }

  drawBalls(m, flip, chars, time, flairs = ['none', 'none']) {
    const ctx = this.ctx;
    const live = new Set();

    for (const b of m.balls) {
      live.add(b.id);
      const r = ballRadius(b) * this.court.w;
      const hot = b.fire > 0;
      const ghosted = b.ghost > 0;

      // A ghost ball flickers: brief flashes mid-court, but always visible in
      // the last stretch before either goal so the save stays makeable.
      let alpha = 1;
      if (ghosted) {
        const nearGoal = b.y < 0.20 || b.y > 0.80;
        const blink = Math.sin(time * 13 + b.id * 2.1) > 0.6;
        alpha = nearGoal ? 0.85 : blink ? 0.4 : 0.05;
      }

      let trail = this.trails.get(b.id);
      if (!trail) { trail = []; this.trails.set(b.id, trail); }
      if (ghosted) {
        // A trail would give the ghost away.
        trail.length = 0;
      } else {
        trail.push([b.x, b.y]);
        const maxTrail = this.quality === 'low' ? 7 : 14;
        while (trail.length > maxTrail) trail.shift();
      }

      // The trail wears the flair of whoever last touched the ball, so your
      // returns carry your look. Fire (turbo/afterburn) always outranks it.
      const flair = b.owner >= 0 ? flairs[b.owner] : 'none';

      // REFLECTION: a decoy runs mirror-image across the court's long axis,
      // blinking with the ball if it is ghosted and dragging a mirrored trail.
      // The fairness valve: it fades out before the last fifth of the court at
      // either end, so the save is always made against the real ball. A sharp
      // eye can tell them apart anyway — the decoy is a shade dimmer and a
      // ripple keeps running through it, the way reflections do on water.
      if (b.mirror > 0 && b.held < 0) {
        const edge = Math.min(b.y, 1 - b.y);
        const valve = Math.max(0, Math.min(1, (edge - 0.2) / 0.1));
        const fade = alpha * 0.8 * valve * Math.min(1, b.mirror / 0.4);
        if (fade > 0.01) {
          this.drawTrail(trail, flip, r, hot, flair, time, fade, true);
          const [dx, dy] = this.pt(1 - b.x, b.y, flip);
          this.drawBallBody(b, dx, dy, r, fade, time);
          ctx.save();
          ctx.globalAlpha = fade;
          const ry = Math.round(dy + Math.sin(time * 7 + b.id) * r * 0.55);
          ctx.fillStyle = 'rgba(8,24,60,0.75)';
          ctx.fillRect(dx - r - 2, ry, r * 2 + 4, Math.max(1, Math.round(r * 0.2)));
          ctx.fillStyle = 'rgba(160,215,255,0.8)';
          ctx.fillRect(dx - r - 1, ry + Math.max(1, Math.round(r * 0.2)), r * 2 + 2, 1);
          ctx.restore();
        }
      }

      this.drawTrail(trail, flip, r, hot, flair, time, 1, false);
      const [sx, sy] = this.pt(b.x, b.y, flip);
      this.drawBallBody(b, sx, sy, r, alpha, time);
    }

    for (const id of [...this.trails.keys()]) if (!live.has(id)) this.trails.delete(id);
  }

  /** A ball's trail; `mirrored` draws it reflected for the REFLECTION decoy. */
  drawTrail(trail, flip, r, hot, flair, time, fade, mirrored) {
    const ctx = this.ctx;
    for (let i = 0; i < trail.length; i++) {
      const [tx, ty] = trail[i];
      const [sx, sy] = this.pt(mirrored ? 1 - tx : tx, ty, flip);
      const f = i / trail.length;
      let alpha = f * (hot ? 0.55 : 0.32);
      let color = '#ffffff';
      if (hot) color = i % 2 ? '#ffd166' : '#ff5b2e';
      else if (flair === 'rainbow') { color = `hsl(${Math.round(f * 300 + time * 180) % 360} 90% 65%)`; alpha = f * 0.5; }
      else if (flair === 'flame') { color = i % 2 ? '#ffd166' : '#ff7a3d'; alpha = f * 0.45; }
      else if (flair === 'star') { color = '#ffffff'; alpha = f * (i % 3 === 0 ? 0.6 : 0.15); }
      else if (flair === 'royal') { color = '#ffd93b'; alpha = f * 0.45; }
      ctx.globalAlpha = alpha * fade;
      ctx.fillStyle = color;
      const rr = r * (0.35 + f * 0.65);
      ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 1;
  }

  drawBallBody(b, sx, sy, r, alpha, time) {
    const ctx = this.ctx;
    const hot = b.fire > 0;
    const ghosted = b.ghost > 0;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (b.beach > 0) {
      this.glow('#ff5b5b', 18);
      const stripes = ['#ff5b5b', '#ffffff', '#ffd93b', '#ffffff', '#3da5ff'];
      const sh = (r * 2) / stripes.length;
      for (let i = 0; i < stripes.length; i++) {
        ctx.fillStyle = stripes[i];
        ctx.fillRect(sx - r, sy - r + i * sh, r * 2, Math.ceil(sh));
      }
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(sx - r * 0.55, sy - r * 0.8, r * 0.6, r * 0.3);
    } else {
      const caught = b.held >= 0;
      const body = caught ? '#b8ffd9' : ghosted ? '#c9a2ff' : hot ? '#ffd166' : '#ffffff';
      this.glow(caught ? '#3ddc84' : ghosted ? '#c9a2ff' : hot ? '#ff7a3d' : 'rgba(255,255,255,0.9)', hot ? 26 : 14);
      ctx.fillStyle = body;
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      ctx.fillStyle = caught ? '#ffffff' : ghosted ? '#e9dcff' : hot ? '#fff3c4' : '#ffffff';
      ctx.fillRect(sx - r * 0.45, sy - r * 0.9, r * 0.9, r * 0.5);
      if (caught) {
        // Crackle so a caught ball reads as "held", not "frozen".
        ctx.fillStyle = '#3ddc84';
        const k = Math.floor(time * 10) % 2;
        ctx.fillRect(sx - r - 3, sy + (k ? -r : r) - 1, 2, 2);
        ctx.fillRect(sx + r + 1, sy + (k ? r : -r) - 1, 2, 2);
      }
    }
    ctx.restore();
  }

  drawPaddles(m, flip, chars, view, localPaddleX, flairs = ['none', 'none'], time = 0) {
    const ctx = this.ctx;
    const c = this.court;
    for (let i = 0; i < 2; i++) {
      const p = m.paddles[i];
      const w = (p.netWidth != null ? p.netWidth : m.paddleWidth(i)) * c.w;
      const h = PADDLE_H * c.h * 1.6;
      const px = (i === view && localPaddleX != null ? localPaddleX : p.x);
      const [sx, sy] = this.pt(px, PADDLE_Y[i], flip);
      const ch = chars[i];

      ctx.save();
      this.glow(ch.color, p.pending ? 26 : 12);
      ctx.fillStyle = p.frost > 0 ? '#9df3ff' : ch.color;
      roundRect(ctx, sx - w / 2, sy - h / 2, w, h, h * 0.45);
      ctx.fill();
      ctx.restore();

      // bevel
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillRect(sx - w / 2 + h * 0.3, sy - h / 2 + 1, w - h * 0.6, Math.max(1, h * 0.22));
      ctx.fillStyle = ch.color2;
      ctx.fillRect(sx - w * 0.12, sy - h * 0.12, w * 0.24, h * 0.24);

      // Flair — the earned paddle skin. The court side is where the decoration
      // goes, and the local player always sits at the bottom of the screen.
      const flair = flairs[i];
      const courtY = i === view ? sy - h / 2 : sy + h / 2;
      const outward = i === view ? -1 : 1;
      if (flair === 'rainbow') {
        const seg = w / 6;
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = `hsl(${(k * 60 + Math.round(time * 120)) % 360} 90% 62%)`;
          ctx.fillRect(sx - w / 2 + k * seg, sy + h * 0.14, Math.ceil(seg), Math.max(1, h * 0.2));
        }
      } else if (flair === 'flame') {
        for (let k = 0; k < 4; k++) {
          ctx.fillStyle = (k + Math.floor(time * 8)) % 2 ? '#ffd166' : '#ff7a3d';
          const fh = 3 + ((k + Math.floor(time * 6)) % 2) * 2;
          ctx.fillRect(sx - w / 2 + (k + 0.5) * (w / 4) - 2, courtY + (outward < 0 ? -fh - 1 : 1), 4, fh);
        }
      } else if (flair === 'star') {
        ctx.fillStyle = '#ffffff';
        for (let k = 0; k < 3; k++) {
          ctx.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(time * 4 + k * 2.1));
          ctx.fillRect(sx - w / 2 + (k + 0.5) * (w / 3) - 1, sy - 1, 2, 2);
        }
        ctx.globalAlpha = 1;
      } else if (flair === 'royal') {
        ctx.strokeStyle = '#ffd93b';
        ctx.lineWidth = 2;
        roundRect(ctx, sx - w / 2 - 2, sy - h / 2 - 2, w + 4, h + 4, h * 0.5);
        ctx.stroke();
        ctx.fillStyle = '#ffd93b';
        for (const [dx, dh] of [[-6, 3], [0, 5], [6, 3]]) {
          ctx.fillRect(sx + dx - 1, courtY + (outward < 0 ? -dh - 2 : 2), 3, dh);
        }
      }

      if (p.grow > 0) {
        ctx.strokeStyle = '#ffd93b';
        ctx.lineWidth = 2;
        roundRect(ctx, sx - w / 2 - 3, sy - h / 2 - 3, w + 6, h + 6, h * 0.6);
        ctx.stroke();
      }
      if (p.frost > 0) {
        ctx.fillStyle = 'rgba(157,243,255,0.5)';
        for (let k = 0; k < 4; k++) {
          ctx.fillRect(sx - w / 2 + (k + 0.5) * (w / 4) - 2, sy + h / 2 + 2, 4, 4);
        }
      }
      if (p.shrink > 0) {
        // Pink pips off both ends: the shrink ray is on you.
        ctx.fillStyle = '#ff8ae2';
        ctx.fillRect(sx - w / 2 - 7, sy - 2, 4, 4);
        ctx.fillRect(sx + w / 2 + 3, sy - 2, 4, 4);
      }
      if (p.magnet > 0) {
        // Green field lines arcing toward the court: this paddle is waiting
        // to catch. The local player always sits at the bottom of the screen,
        // so their arcs open upward and the opponent's open downward.
        ctx.strokeStyle = '#3ddc84';
        ctx.lineWidth = 2;
        const atBottom = i === view;
        for (let k = 0; k < 3; k++) {
          const rr = h * (1.4 + k * 0.8);
          ctx.globalAlpha = 0.55 - k * 0.15;
          ctx.beginPath();
          if (atBottom) ctx.arc(sx, sy, rr, Math.PI, 0);
          else ctx.arc(sx, sy, rr, 0, Math.PI);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      if (p.arco > 0 && (p.arco > 1 || Math.floor(time * 8) % 2 === 0)) {
        // A little arcade of stone arches along the court side: returns off
        // this paddle bend. Blinks through its last second.
        this.drawArcade(sx, courtY, w, h, outward);
      }

      if (p.shield > 0) {
        const [, shy] = this.pt(0.5, SHIELD_Y[i], flip);
        ctx.fillStyle = this.grad(`shield:${shy}:${ch.color2}`, () => {
          const grad = ctx.createLinearGradient(0, shy - 8, 0, shy + 8);
          grad.addColorStop(0, ch.color2 + '00');
          grad.addColorStop(0.5, ch.color2 + 'dd');
          grad.addColorStop(1, ch.color2 + '00');
          return grad;
        });
        ctx.fillRect(c.x, shy - 8, c.w, 16);
        ctx.fillStyle = ch.color2;
        for (let k = 0; k < 14; k++) ctx.fillRect(c.x + (k + 0.5) * (c.w / 14) - 2, shy - 2, 4, 4);
      }
    }
  }

  /** ARCO's badge: three stone arches standing on the paddle's court side. */
  drawArcade(sx, courtY, w, h, outward) {
    const ctx = this.ctx;
    const u = Math.max(1, Math.round(h * 0.1));          // sized to the paddle, not the art pixel
    // Rows from the paddle outward; the keystone takes the crate's colour.
    const ARCH = ['.#K#.', '#...#', '#...#', '#...#'];
    for (let a = -1; a <= 1; a++) {
      const ox = Math.round(sx + a * w * 0.3 - 2.5 * u);
      for (let r = 0; r < ARCH.length; r++) {
        const row = ARCH[ARCH.length - 1 - r];            // legs on the paddle
        const y = Math.round(courtY + outward * (r + 1) * u - (outward < 0 ? 0 : u));
        for (let x = 0; x < 5; x++) {
          const ch = row[x];
          if (ch === '.') continue;
          ctx.fillStyle = ch === 'K' ? ARCO_COLOR : '#efe2c4';
          ctx.fillRect(ox + x * u, y, u, u);
        }
      }
    }
  }

  drawFx(fx, flip) {
    const ctx = this.ctx;
    const c = this.court;
    for (const p of fx.particles) {
      const [sx, sy] = this.pt(p.x, p.y, flip);
      const k = 1 - p.age / p.life;
      ctx.globalAlpha = Math.max(0, k);
      ctx.fillStyle = p.color;
      const s = Math.max(1, p.size * c.w * (0.4 + k * 0.6));
      ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    for (const r of fx.rings) {
      const [sx, sy] = this.pt(r.x, r.y, flip);
      const k = r.age / r.life;
      const rad = (r.from + (r.to - r.from) * k) * c.w;
      ctx.globalAlpha = Math.max(0, 1 - k);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = Math.max(1, r.width * c.w * (1 - k));
      ctx.beginPath();
      ctx.arc(sx, sy, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const t of fx.texts) {
      const k = t.age / t.life;
      const [sx, sy] = this.pt(t.x, t.y - t.rise * k, flip);
      const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.5 : 1;
      drawText(ctx, t.str, sx, sy, {
        scale: Math.max(1, (c.w / 90) * t.scale * pop),
        color: t.color, outline: t.outline, align: 'center', baseline: 'middle',
        alpha: Math.max(0, 1 - Math.pow(k, 2)),
      });
    }
  }

  /* ---------------------------------------------------------------- */
  /* HUD and banners                                                   */

  drawHud(m, chars, names, view, time, rtt) {
    const ctx = this.ctx;
    const c = this.court;
    const foe = 1 - view;
    const pad = this.pad;

    const nameScale = Math.max(2, Math.round(this.W / 130));
    const subScale = Math.max(1, nameScale - 1);

    /* ---- opponent, in the strip above the court ---- */
    const topH = c.y;
    const topScore = Math.max(3, Math.min(10, Math.floor((topH * 0.55) / 7)));
    const topScoreW = measure(String(m.scores[foe]), topScore);

    drawText(ctx, names[foe].slice(0, 9), pad, topH * 0.10, {
      scale: nameScale, color: chars[foe].color2, shadow: '#0b0616',
    });
    drawText(ctx, chars[foe].name, pad, topH * 0.10 + nameScale * 9, {
      scale: subScale, color: 'rgba(255,255,255,0.55)',
    });
    drawText(ctx, String(m.scores[foe]), this.W - pad, topH / 2, {
      scale: topScore, color: '#ffffff', outline: '#1a0d2b',
      align: 'right', baseline: 'middle',
    });
    const streak = m.streak || [0, 0];
    if (streak[foe] >= 3) {
      drawText(ctx, 'X' + streak[foe], this.W - pad, topH / 2 + topScore * 4.5, {
        scale: Math.max(1, Math.round(topScore / 3)), color: '#ff9b4a',
        align: 'right', baseline: 'middle', alpha: 0.65 + Math.sin(time * 7) * 0.35,
      });
    }
    const topMeterW = Math.max(60, this.W - pad * 2 - topScoreW - 18);
    this.meterBar(pad, topH * 0.10 + nameScale * 9 + subScale * 9 + 3,
      topMeterW, Math.max(6, nameScale * 2), m.meter[foe], chars[foe], time, false);

    /* ---- you, in the strip below the court ---- */
    const botY = c.y + c.h;
    const botH = this.H - botY;
    const btn = this.specialRect;
    const botScore = Math.max(4, Math.min(12, Math.floor((botH * 0.52) / 7)));
    const scoreW = measure(String(m.scores[view]), botScore);

    drawText(ctx, String(m.scores[view]), pad, botY + botH * 0.46, {
      scale: botScore, color: '#ffffff', outline: '#1a0d2b', baseline: 'middle',
    });
    if (streak[view] >= 3) {
      drawText(ctx, 'X' + streak[view], pad, botY + botH * 0.46 + botScore * 4.5, {
        scale: Math.max(1, Math.round(botScore / 3)), color: '#ff9b4a',
        baseline: 'middle', alpha: 0.65 + Math.sin(time * 7) * 0.35,
      });
    }

    const textX = pad + scoreW + 14;
    drawText(ctx, names[view].slice(0, 9), textX, botY + botH * 0.16, {
      scale: nameScale, color: chars[view].color2, shadow: '#0b0616',
    });
    drawText(ctx, chars[view].name, textX, botY + botH * 0.16 + nameScale * 9, {
      scale: subScale, color: 'rgba(255,255,255,0.55)',
    });
    const meterW = Math.max(50, btn.x - textX - 14);
    this.meterBar(textX, botY + botH * 0.16 + nameScale * 9 + subScale * 9 + 4,
      meterW, Math.max(7, nameScale * 2.4), m.meter[view], chars[view], time, false);

    /* ---- special button ---- */
    const ready = m.meter[view] >= 1;
    ctx.save();
    ctx.globalAlpha = ready ? 1 : 0.45;
    if (ready) this.glow(chars[view].color2, 18 + Math.sin(time * 8) * 8);
    ctx.fillStyle = ready ? chars[view].color : 'rgba(255,255,255,0.10)';
    roundRect(ctx, btn.x, btn.y, btn.w, btn.h, btn.h * 0.32);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = ready ? '#ffffff' : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    roundRect(ctx, btn.x, btn.y, btn.w, btn.h, btn.h * 0.32);
    ctx.stroke();

    const label = ready ? chars[view].special.name : 'CHARGING';
    let labelScale = Math.max(1, Math.floor((btn.w - 16) / (label.length * 6)));
    drawText(ctx, label, btn.x + btn.w / 2, btn.y + btn.h / 2, {
      scale: labelScale,
      color: ready ? '#ffffff' : 'rgba(255,255,255,0.5)',
      align: 'center', baseline: 'middle', shadow: ready ? '#1a0d2b' : null,
    });

    if (rtt) {
      drawText(ctx, rtt + 'MS', this.W - pad, this.H - 4, {
        scale: 1, color: 'rgba(255,255,255,0.25)', align: 'right', baseline: 'bottom',
      });
    }
  }

  meterBar(x, y, w, h, value, char, time, big) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    const full = value >= 1;
    ctx.save();
    if (full) this.glow(char.color2, 10 + Math.sin(time * 9) * 6);
    ctx.fillStyle = this.grad(`meter:${x}:${w}:${char.color}`, () => {
      const grad = ctx.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, char.color);
      grad.addColorStop(1, char.color2);
      return grad;
    });
    roundRect(ctx, x, y, Math.max(2, w * value), h, h / 2);
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.stroke();
    if (full && big) {
      drawText(ctx, 'READY', x + w + 6, y + h / 2, {
        scale: 1, color: char.color2, baseline: 'middle',
      });
    }
  }

  drawBanners(m, flip, chars, view, time) {
    const ctx = this.ctx;
    const c = this.court;
    const cx = c.x + c.w / 2;
    const cy = c.y + c.h * 0.42;
    const scale = Math.max(2, c.w / 60);

    if (m.phase === 'countdown') {
      const n = Math.ceil(m.phaseTime);
      const frac = 1 - (m.phaseTime - Math.floor(m.phaseTime));
      const pop = 1 + (1 - Math.min(1, frac * 3)) * 0.8;
      drawText(ctx, n > 0 ? String(n) : 'GO', cx, cy, {
        scale: scale * 2.2 * pop, color: n > 0 ? '#ffffff' : '#8affc1',
        outline: '#1a0d2b', align: 'center', baseline: 'middle',
      });
      drawText(ctx, 'FIRST TO ' + m.target, cx, cy + scale * 22, {
        scale: Math.max(1, scale * 0.6), color: 'rgba(255,255,255,0.7)',
        align: 'center', baseline: 'middle',
      });
      if (m.party) {
        const pulse = 0.6 + Math.sin(time * 6) * 0.4;
        drawText(ctx, 'PARTY MODE', cx, cy + scale * 30, {
          scale: Math.max(1, scale * 0.7), color: '#ffd93b', outline: '#1a0d2b',
          align: 'center', baseline: 'middle', alpha: pulse,
        });
      }
    } else if (m.phase === 'point') {
      drawText(ctx, 'POINT', cx, cy, {
        scale: scale * 1.3, color: '#ffd93b', outline: '#1a0d2b',
        align: 'center', baseline: 'middle',
      });
    } else if (m.phase === 'over') {
      const youWon = m.winner === view;
      drawText(ctx, youWon ? 'YOU WIN' : 'YOU LOSE', cx, cy, {
        scale: scale * 1.5, color: youWon ? '#ffd93b' : '#9aa4c8',
        outline: '#1a0d2b', align: 'center', baseline: 'middle',
      });
    }

    const mp = m.matchPoint;
    if (m.phase === 'play' && (mp[0] || mp[1])) {
      const who = mp[view] && !mp[foeOf(view)] ? 'MATCH POINT'
        : mp[foeOf(view)] && !mp[view] ? 'DEFEND!' : 'MATCH POINT';
      const a = 0.55 + Math.sin(time * 6) * 0.35;
      drawText(ctx, who, cx, c.y + c.h * 0.30, {
        scale: Math.max(1, scale * 0.7), color: '#ff4d3d', outline: '#1a0d2b',
        align: 'center', baseline: 'middle', alpha: a,
      });
    }
  }

  drawTouchHint(time) {
    const c = this.court;
    const a = 0.35 + Math.sin(time * 3) * 0.2;
    drawText(this.ctx, 'SLIDE TO MOVE', c.x + c.w / 2, c.y + c.h * 0.78, {
      scale: Math.max(1, c.w / 130), color: '#ffffff', align: 'center',
      baseline: 'middle', alpha: a, outline: '#1a0d2b',
    });
  }

  /* ---------------------------------------------------------------- */
  /* Post                                                              */

  drawOverlay(fx) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    if (fx.flash) {
      const k = 1 - fx.flash.age / fx.flash.life;
      ctx.globalAlpha = k * fx.flash.strength;
      ctx.fillStyle = fx.flash.color;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    }

    if (this.quality === 'low') return;

    if (!this.scanlines) {
      const off = document.createElement('canvas');
      off.width = 1;
      off.height = 3;
      const octx = off.getContext('2d');
      octx.fillStyle = 'rgba(0,0,0,0.16)';
      octx.fillRect(0, 0, 1, 1);
      this.scanlines = ctx.createPattern(off, 'repeat');
    }
    ctx.fillStyle = this.scanlines;
    ctx.fillRect(0, 0, this.W, this.H);

    if (!this.vignette) {
      const g = ctx.createRadialGradient(
        this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.32,
        this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.78,
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      this.vignette = g;
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  /**
   * The attract-mode backdrop behind the menus: the same stage art, dimmed,
   * with one ghost ball drifting around to keep the screen alive.
   */
  drawMenuBackdrop(stage, time, fx) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackdrop(stage, time);

    if (!this.ghost) {
      this.ghost = { x: 0.3, y: 0.4, vx: 0.16, vy: 0.21, trail: [] };
    }
    const g = this.ghost;
    const dt = 1 / 60;
    g.x += g.vx * dt;
    g.y += g.vy * dt;
    if (g.x < 0.06 || g.x > 0.94) g.vx = -g.vx;
    if (g.y < 0.10 || g.y > 0.90) g.vy = -g.vy;
    g.trail.push([g.x, g.y]);
    if (g.trail.length > 22) g.trail.shift();

    const r = this.W * 0.012;
    for (let i = 0; i < g.trail.length; i++) {
      const f = i / g.trail.length;
      ctx.globalAlpha = f * 0.18;
      ctx.fillStyle = stage.accent;
      const rr = r * (0.3 + f * 0.7);
      ctx.fillRect(g.trail[i][0] * this.W - rr, g.trail[i][1] * this.H - rr, rr * 2, rr * 2);
    }
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(g.x * this.W - r, g.y * this.H - r, r * 2, r * 2);
    ctx.globalAlpha = 1;

    // Darken so the menu panels stay legible over any stage.
    ctx.fillStyle = 'rgba(8, 3, 18, 0.48)';
    ctx.fillRect(0, 0, this.W, this.H);

    if (fx) this.drawFx(fx, false);
    this.drawOverlay(fx || { flash: null });
  }

  hitSpecial(x, y) {
    const b = this.specialRect;
    return b && x >= b.x - 12 && x <= b.x + b.w + 12 && y >= b.y - 12 && y <= b.y + b.h + 12;
  }
}

const foeOf = (i) => 1 - i;
