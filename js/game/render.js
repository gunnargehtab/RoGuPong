// RoGuPong — everything you see during a match.
//
// The court is a fixed-aspect portrait rectangle so both phones play on
// identical geometry no matter how tall their screens are; the leftover space
// above and below becomes the HUD. Each phone flips the y axis for player 1,
// so you are always the paddle at the bottom.

import { drawText, measure } from '../ui/pixelfont.js';
import { BALL_R, PADDLE_H, PADDLE_Y, SHIELD_Y, CRATE_R } from './match.js';

const COURT_ASPECT = 0.56;      // width / height
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

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.trails = new Map();
    this.scanlines = null;
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

  resize() {
    const cap = this.quality === 'low' ? 1.5 : 2;
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
    this.skyGradient = null;
    this.skyGradientFor = null;
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

    this.drawBackdrop(stage, time, shake);
    this.drawCourt(m, stage, flip, chars, view, time);
    this.drawCrates(m, flip, time);
    this.drawBalls(m, flip, chars, time);
    this.drawPaddles(m, flip, chars, view, localPaddleX);
    this.drawFx(fx, flip);
    this.drawBanners(m, flip, chars, view, time);
    this.drawHud(m, chars, names, view, time, rtt);
    if (showTouchHint) this.drawTouchHint(time);
    this.drawOverlay(fx);
  }

  /* ---------------------------------------------------------------- */
  /* Backdrop                                                          */

  drawBackdrop(stage, time, shake) {
    const ctx = this.ctx;
    if (!this.skyGradient || this.skyGradientFor !== stage.id) {
      const g = ctx.createLinearGradient(0, 0, 0, this.H);
      g.addColorStop(0, stage.sky[0]);
      g.addColorStop(0.55, stage.sky[1]);
      g.addColorStop(1, stage.sky[2]);
      this.skyGradient = g;
      this.skyGradientFor = stage.id;
    }
    ctx.fillStyle = this.skyGradient;
    // Overdraw the edges: screen shake translates the canvas, and a backdrop
    // that stopped at the old bounds would leave the previous frame showing in
    // the gap.
    ctx.fillRect(-SHAKE_MARGIN, -SHAKE_MARGIN, this.W + SHAKE_MARGIN * 2, this.H + SHAKE_MARGIN * 2);

    if (stage.stars) {
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      const count = this.quality === 'low' ? Math.min(stage.stars, 20) : stage.stars;
      for (let i = 0; i < count; i++) {
        const x = ((i * 97) % 100) / 100 * this.W;
        const y = ((i * 53) % 60) / 100 * this.H * 0.9;
        const tw = 0.5 + 0.5 * Math.sin(time * 2 + i);
        ctx.globalAlpha = 0.25 + tw * 0.55;
        const s = i % 7 === 0 ? 2 : 1;
        ctx.fillRect(Math.round(x), Math.round(y), s, s);
      }
      ctx.globalAlpha = 1;
    }

    const drift = Math.sin(time * 0.12) * this.W * 0.012;
    this.drawSkyline(stage.far, drift * 0.5 + shake * 3, time);
    this.drawSkyline(stage.near, drift + shake * 6, time);

    if (stage.water) {
      const wy = stage.water.top * this.H;
      ctx.fillStyle = stage.water.color;
      ctx.fillRect(0, wy, this.W, this.H - wy);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = stage.water.shimmer;
      const shimmer = this.quality === 'low' ? 8 : 26;
      for (let i = 0; i < shimmer; i++) {
        const y = wy + ((i * 37) % 100) / 100 * (this.H - wy);
        const w = 12 + ((i * 17) % 40);
        const x = ((i * 83) % 100) / 100 * this.W + Math.sin(time * 1.6 + i) * 10;
        ctx.fillRect(x, y, w, 2);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawSkyline(layer, offset, time) {
    if (!layer) return;
    const ctx = this.ctx;
    const baseY = layer.y * this.H;
    ctx.fillStyle = layer.color;
    for (const s of layer.shapes) {
      const x = s.x * this.W + offset;
      const w = s.w * this.W;
      const h = s.h * this.H;
      ctx.fillRect(Math.round(x), Math.round(baseY - h), Math.ceil(w), Math.ceil(h + this.H));
      if (s.spire) {
        ctx.beginPath();
        ctx.moveTo(x, baseY - h);
        ctx.lineTo(x + w / 2, baseY - h - h * 0.5);
        ctx.lineTo(x + w, baseY - h);
        ctx.closePath();
        ctx.fill();
      }
    }
    // A few lit windows.
    if (this.quality === 'low') return;
    ctx.fillStyle = 'rgba(255,220,140,0.20)';
    for (let i = 0; i < 40; i++) {
      const s = layer.shapes[i % layer.shapes.length];
      const x = s.x * this.W + offset + ((i * 13) % Math.max(1, s.w * this.W - 6)) + 3;
      const y = baseY - s.h * this.H + 6 + ((i * 29) % Math.max(1, s.h * this.H - 10));
      if (Math.sin(time * 0.7 + i * 2.3) > -0.2) ctx.fillRect(Math.round(x), Math.round(y), 2, 3);
    }
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

    if (stage.checker) {
      const n = 8;
      const s = c.w / n;
      for (let y = 0; y * s < c.h; y++) {
        for (let x = 0; x < n; x++) {
          if ((x + y) % 2) continue;
          ctx.fillStyle = 'rgba(255,255,255,0.025)';
          ctx.fillRect(c.x + x * s, c.y + y * s, s, s);
        }
      }
    }

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
      const grad = ctx.createLinearGradient(0, gy, 0, gy + (atBottom ? -c.h * 0.09 : c.h * 0.09));
      grad.addColorStop(0, chars[i].color + 'cc');
      grad.addColorStop(1, chars[i].color + '00');
      ctx.fillStyle = grad;
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

  drawBalls(m, flip, chars, time) {
    const ctx = this.ctx;
    const r = BALL_R * this.court.w;
    const live = new Set();

    for (const b of m.balls) {
      live.add(b.id);
      let trail = this.trails.get(b.id);
      if (!trail) { trail = []; this.trails.set(b.id, trail); }
      trail.push([b.x, b.y]);
      const maxTrail = this.quality === 'low' ? 7 : 14;
      while (trail.length > maxTrail) trail.shift();

      const hot = b.fire > 0;
      const tint = hot ? '#ff9b4a' : '#ffffff';
      for (let i = 0; i < trail.length; i++) {
        const [tx, ty] = trail[i];
        const [sx, sy] = this.pt(tx, ty, flip);
        const f = i / trail.length;
        ctx.globalAlpha = f * (hot ? 0.55 : 0.32);
        ctx.fillStyle = hot ? (i % 2 ? '#ffd166' : '#ff5b2e') : tint;
        const rr = r * (0.35 + f * 0.65);
        ctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
      }
      ctx.globalAlpha = 1;

      const [sx, sy] = this.pt(b.x, b.y, flip);
      ctx.save();
      this.glow(hot ? '#ff7a3d' : 'rgba(255,255,255,0.9)', hot ? 26 : 14);
      ctx.fillStyle = hot ? '#ffd166' : '#ffffff';
      ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
      ctx.fillStyle = hot ? '#fff3c4' : '#ffffff';
      ctx.fillRect(sx - r * 0.45, sy - r * 0.9, r * 0.9, r * 0.5);
      ctx.restore();
    }

    for (const id of [...this.trails.keys()]) if (!live.has(id)) this.trails.delete(id);
  }

  drawPaddles(m, flip, chars, view, localPaddleX) {
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

      if (p.shield > 0) {
        const [, shy] = this.pt(0.5, SHIELD_Y[i], flip);
        const grad = ctx.createLinearGradient(0, shy - 8, 0, shy + 8);
        grad.addColorStop(0, ch.color2 + '00');
        grad.addColorStop(0.5, ch.color2 + 'dd');
        grad.addColorStop(1, ch.color2 + '00');
        ctx.fillStyle = grad;
        ctx.fillRect(c.x, shy - 8, c.w, 16);
        ctx.fillStyle = ch.color2;
        for (let k = 0; k < 14; k++) ctx.fillRect(c.x + (k + 0.5) * (c.w / 14) - 2, shy - 2, 4, 4);
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
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, char.color);
    grad.addColorStop(1, char.color2);
    ctx.fillStyle = grad;
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
    this.drawBackdrop(stage, time, 0);

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
