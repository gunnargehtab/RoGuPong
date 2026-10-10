// RoGuPong trailer — the conductor.
//
// An 18-second spot, cut to its own chiptune, made from the game's own parts:
// the logotype, the pixel font, RO and GU, the four painted stages, the QR
// encoder, the sound effects and a live match drawn by the game's renderer.
// Like the game it needs no files beyond these modules and no library.
//
// The playhead is the one source of truth. Every shot is painted from it and
// the music is scheduled from it, so pausing, scrubbing and jumping between
// shots all just move it. Clicking a phone in the gameplay shot holds it and
// hands you the match (free play) until you come back.
//
// window.trailer is the live instance, for poking at it from the console.

import { encodeQr } from '../net/qr.js';
import { Audio as GameAudio } from '../game/audio.js';
import { STAGES } from '../game/stages.js';
import { SHOTS, TOTAL, STEP, eventsAt, Synth } from './music.js';
import { SHOT_PAINTERS, gate, playLayout } from './shots.js';
import { Demo } from './demo.js';
import { Pixels, Sparks, BG0, clamp, hash, screenRect } from './art.js';

const GAME_URL = 'https://gunnargehtab.github.io/RoGuPong/';
const PLAY = SHOTS.find((s) => s.id === 'play');
const END = SHOTS.find((s) => s.id === 'end');
const IDLE_MS = 2200;

/** A reply code shaped like the real thing: RGP and the compact handshake in Base32. */
function replyCode() {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let s = 'RGP';
  for (let i = 0; i < 114; i++) s += A[Math.floor(hash(i + 404) * 32)];
  return s;
}

const fmt = (t) => `0:${String(Math.floor(t)).padStart(2, '0')}`;

class Trailer {
  constructor() {
    this.canvas = document.getElementById('screen');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.layer = new Pixels();
    this.sparks = new Sparks();
    this.stageCache = new Map();
    this.qr = { game: encodeQr(GAME_URL), reply: encodeQr(replyCode()) };
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.coarse = matchMedia('(pointer: coarse)').matches;

    this.state = 'gate';          // gate | playing | paused | ended | free
    this.t = 0;                   // the playhead, in seconds
    this.prevT = 0;
    this.time = 0;                // wall clock, for what moves on a held frame
    this.audio = null;
    this.muted = false;
    this.sfx = new GameAudio();   // the game's own effects, silent until audio starts
    this.demo = new Demo(this.sfx);
    this.phoneRects = [];
    this.shakeX = 0;
    this.shakeY = 0;
    this.lastActive = performance.now();
    this.warmKey = '';
    // 'low' once this device has shown it can't keep up, as the game does.
    this.low = false;
    this.fps = { frames: 0, time: 0 };

    this.ui = {
      gate: document.getElementById('gate'),
      cta: document.getElementById('cta'),
      back: document.getElementById('back'),
      bar: document.getElementById('bar'),
      toggle: document.getElementById('toggle'),
      sound: document.getElementById('sound'),
      full: document.getElementById('full'),
      clock: document.getElementById('clock'),
      label: document.getElementById('shot'),
      chapters: document.getElementById('chapters'),
    };
    this.buildChapters();
    this.bind();
    this.resize();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  get running() { return this.state === 'playing'; }

  /* ---------------------------------------------------------------- */
  /* Sizing and the stage art                                          */

  resize() {
    const W = this.canvas.clientWidth || innerWidth;
    const H = this.canvas.clientHeight || innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = W;
    this.H = H;
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    // One art pixel, the way the game sizes its stage art.
    this.u = Math.max(2, Math.round(Math.min(W, H) / 180));
    this.portrait = H > W;
    this.stageCache.clear();
    this.crt = null;
  }

  stageReady(stage) { return this.stageCache.has(stage.id); }

  stageArt(stage) {
    let e = this.stageCache.get(stage.id);
    if (!e) {
      const M = this.u * 8;
      const off = document.createElement('canvas');
      off.width = Math.ceil((this.W + M * 2) / this.u);
      off.height = Math.ceil((this.H + M * 2) / this.u);
      stage.scene.backdrop(off.getContext('2d', { alpha: false }), off.width, off.height);
      e = { canvas: off, M };
      this.stageCache.set(stage.id, e);
    }
    return e;
  }

  /** A stage's backdrop, panned `pan` pixels across its margin, with its live layer. */
  drawStage(stage, pan = 0) {
    const { canvas, M } = this.stageArt(stage);
    const u = this.u;
    const x = -M * 2 + Math.round(clamp(pan, 0, M * 2) / u) * u;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, x, -M, canvas.width * u, canvas.height * u);
    if (stage.scene.animateBackdrop && !this.low) {
      ctx.save();
      ctx.translate(x, -M);
      ctx.scale(u, u);
      stage.scene.animateBackdrop(ctx, canvas.width, canvas.height, this.time);
      ctx.restore();
    }
  }

  /** Paint ahead while nothing is moving: one stage per frame, then the match screens. */
  warm() {
    const missing = STAGES.find((s) => !this.stageReady(s));
    if (missing) { this.stageArt(missing); return; }
    const key = `${this.W}x${this.H}`;
    if (this.warmKey === key) return;
    this.warmKey = key;
    playLayout(this).phones.forEach((r, i) => {
      const s = screenRect(r.x, r.y, r.w, r.h, this.u);
      this.demo.screens[i].resize(s.w, s.h);
      this.demo.draw(i, 0, 0, false);
    });
  }

  /** Copy a phone screen's canvas into its rectangle: pixel for pixel, or 2x on the cheap path. */
  blitScreen(canvas, s) {
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(canvas, s.x, s.y, s.w, s.h);
  }

  /* ---------------------------------------------------------------- */
  /* The playhead                                                      */

  shotAt(t) {
    let shot = SHOTS[0];
    for (const s of SHOTS) if (t >= s.start) shot = s;
    return shot;
  }

  now() {
    return this.running ? this.anchorT + Math.max(0, (performance.now() - this.anchorPerf) / 1000) : this.t;
  }

  play() {
    if (this.t >= TOTAL - 0.01) this.t = 0;
    this.state = 'playing';
    const A = this.audio;
    // The picture waits for the sound's own latency, so a hit lands on its blip.
    const lat = A ? 0.05 + (A.ctx.outputLatency || A.ctx.baseLatency || 0) : 0;
    this.anchorT = this.t;
    this.anchorPerf = performance.now() + lat * 1000;
    if (A) {
      A.ctx.resume?.().catch(() => {});
      A.synth.cut();
      A.anchor = A.ctx.currentTime + 0.05;
    }
    this.nextStep = Math.ceil(this.t / STEP - 1e-6);
    this.prevT = this.t;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.t = this.now();
    this.state = 'paused';
    this.audio?.synth.cut();
  }

  toggle() {
    if (this.state === 'free') this.exitFree();
    else if (this.state === 'playing') this.pause();
    else if (this.state !== 'gate') this.play();
  }

  seek(t) {
    if (this.state === 'free') this.exitFree(false);
    this.t = clamp(t, 0, TOTAL);
    this.prevT = this.t;
    this.sparks.clear();
    if (this.state === 'playing') this.play();
    else if (this.state === 'ended' && this.t < TOTAL) this.state = 'paused';
  }

  jump(dir) {
    const cur = this.shotAt(this.now());
    const i = SHOTS.indexOf(cur);
    if (dir < 0 && this.now() - cur.start > 0.5) this.seek(cur.start);
    else this.seek(SHOTS[clamp(i + dir, 0, SHOTS.length - 1)].start);
  }

  finish() {
    this.t = TOTAL;
    this.state = 'ended';
  }

  start(muted) {
    if (this.state !== 'gate') return;
    this.initAudio(muted);
    this.state = 'paused';
    this.t = 0;
    this.play();
    this.ui.toggle.focus({ preventScroll: true });
  }

  /* ---------------------------------------------------------------- */
  /* Sound                                                             */

  initAudio(muted) {
    this.muted = muted;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor || this.audio) return;
    try {
      const ctx = new Ctor();
      // A soft ceiling, so a crash on top of a chord never clips.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      const master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(comp);
      const music = ctx.createGain();
      music.gain.value = 0.75;
      music.connect(master);
      const sfx = ctx.createGain();
      sfx.gain.value = 0.5;
      sfx.connect(master);
      this.sfx.ctx = ctx;
      this.sfx.master = master;
      this.sfx.musicGain = music;
      this.sfx.sfxGain = sfx;
      this.audio = { ctx, master, synth: new Synth(ctx, music), anchor: 0, loopAt: 0 };
    } catch {
      this.audio = null;
    }
  }

  setMuted(on) {
    this.muted = on;
    const A = this.audio;
    if (A) {
      A.ctx.resume?.().catch(() => {});
      A.master.gain.setTargetAtTime(on ? 0 : 0.9, A.ctx.currentTime, 0.02);
    }
  }

  scheduleMusic() {
    const A = this.audio;
    if (!A) return;
    const horizon = Math.min(this.t + 0.15, TOTAL);
    while (this.nextStep * STEP < horizon) {
      const at = this.nextStep * STEP;
      const when = A.anchor + (at - this.anchorT);
      if (at >= this.t - 0.03 && when >= A.ctx.currentTime - 0.01) {
        for (const e of eventsAt(this.nextStep)) A.synth.play(e, Math.max(when, A.ctx.currentTime));
      }
      this.nextStep++;
    }
  }

  /** Free play loops the gameplay shot's two bars for as long as you play. */
  scheduleLoop() {
    const A = this.audio;
    if (!A) return;
    const now = A.ctx.currentTime;
    while (A.loopAt + this.loopK * STEP < now + 0.15) {
      const when = A.loopAt + this.loopK * STEP;
      if (when >= now - 0.01) for (const e of eventsAt(PLAY.step + (this.loopK % 32))) A.synth.play(e, when);
      this.loopK++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Free play                                                         */

  enterFree(i) {
    if (this.state === 'gate' || this.state === 'free') return;
    this.t = this.now();
    if (this.t < PLAY.start || this.t >= PLAY.start + PLAY.dur) this.t = PLAY.start + 0.4;
    this.state = 'free';
    this.sparks.clear();
    const A = this.audio;
    if (A) {
      A.synth.cut();
      A.loopAt = A.ctx.currentTime + 0.05;
      this.loopK = 0;
    }
    this.demo.startFree(i);
  }

  exitFree(resume = true) {
    if (this.state !== 'free') return;
    this.demo.endFree(this.t - PLAY.start);
    this.state = 'paused';
    this.audio?.synth.cut();
    if (resume) this.play();
  }

  /** Pointer x on the screen to the free-play paddle. */
  aim(clientX) {
    const r = this.phoneRects.find((p) => p.view === this.demo.human);
    if (!r) return;
    this.demo.input.x = this.demo.screens[this.demo.human].courtX(clientX - r.x);
  }

  /* ---------------------------------------------------------------- */
  /* The frame                                                         */

  frame(perf) {
    const dt = clamp((perf - this.last) / 1000, 0, 0.1);
    this.last = perf;
    this.time += dt;

    if (this.state === 'playing') {
      this.t = this.now();
      if (this.t >= TOTAL) this.finish();
      else this.scheduleMusic();
    } else if (this.state === 'free') {
      this.demo.stepFree(dt);
      this.scheduleLoop();
    } else if (this.state === 'gate' || this.state === 'paused') {
      this.warm();
    }

    this.watchFrames(dt);
    this.paint(dt);
    this.prevT = this.t;
    this.updateUi(perf);
    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * The game's rule for slow phones: if a second and a half of playback runs
   * under ~40 fps, drop the CRT pass, the stages' live layers and the phones'
   * glow for the rest of the visit. Never switched back, so it can't flicker.
   */
  watchFrames(dt) {
    if (this.low || (this.state !== 'playing' && this.state !== 'free') || dt <= 0) return;
    const f = this.fps;
    f.frames++;
    f.time += dt;
    if (f.time < 1.5) return;
    if (f.frames / f.time < 40) {
      this.low = true;
      for (const s of this.demo.screens) s.renderer.setQuality('low');
      for (const s of this.demo.screens) s.noNotch();
    }
    f.frames = 0;
    f.time = 0;
  }

  paint(dt) {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = BG0;
    ctx.fillRect(0, 0, this.W, this.H);
    this.shakeX = this.shakeY = 0;

    if (this.state === 'gate') {
      gate(this);
    } else {
      const shot = this.shotAt(this.t);
      const lt = Math.min(this.t - shot.start, shot.dur);
      const prevLt = this.running ? this.prevT - shot.start : lt;
      const painter = SHOT_PAINTERS[shot.id];
      const amp = this.running && !this.reduced && painter.shake ? painter.shake(lt) : 0;
      if (amp > 0) {
        const f = Math.floor(this.time * 60);
        this.shakeX = Math.round((hash(f) - 0.5) * 2 * amp * this.u);
        this.shakeY = Math.round((hash(f + 77) - 0.5) * 2 * amp * this.u);
        ctx.translate(this.shakeX, this.shakeY);
      }
      painter.draw(this, lt, prevLt, dt);
      this.sparks.update(dt);
      this.sparks.draw(ctx);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (!this.low) this.paintCrt();
  }

  /** Scanlines and a vignette over everything, the game's own CRT pass, baked into one layer. */
  paintCrt() {
    const ctx = this.ctx;
    if (!this.crt) {
      const off = document.createElement('canvas');
      off.width = this.canvas.width;
      off.height = this.canvas.height;
      const o = off.getContext('2d');
      o.scale(this.dpr, this.dpr);
      o.fillStyle = 'rgba(0,0,0,0.16)';
      for (let y = 0; y < this.H; y += 3) o.fillRect(0, y, this.W, 1);
      const v = o.createRadialGradient(this.W / 2, this.H / 2, Math.min(this.W, this.H) * 0.32,
        this.W / 2, this.H / 2, Math.max(this.W, this.H) * 0.78);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(1, 'rgba(0,0,0,0.5)');
      o.fillStyle = v;
      o.fillRect(0, 0, this.W, this.H);
      this.crt = off;
    }
    ctx.drawImage(this.crt, 0, 0, this.W, this.H);
  }

  /* ---------------------------------------------------------------- */
  /* The page around the canvas                                        */

  buildChapters() {
    this.segments = SHOTS.map((s) => {
      const b = document.createElement('button');
      b.className = 'seg';
      b.type = 'button';
      b.style.flexGrow = s.bars;
      b.setAttribute('aria-label', `Jump to ${s.label}`);
      b.title = s.label;
      const fill = document.createElement('span');
      b.appendChild(fill);
      b.addEventListener('click', () => {
        if (this.state === 'gate') return;
        this.seek(s.start);
        if (this.state !== 'playing') this.play();
      });
      this.ui.chapters.appendChild(b);
      return fill;
    });
  }

  updateUi(perf) {
    const ui = this.ui;
    const t = this.t;
    const shot = this.shotAt(t);
    SHOTS.forEach((s, i) => {
      const p = clamp((t - s.start) / s.dur, 0, 1);
      this.segments[i].style.width = `${(p * 100).toFixed(1)}%`;
    });
    const set = (el, key, val, fn) => { if (el[key] !== val) fn(val); };
    const readout = fmt(t) + shot.label + this.state;
    set(ui.clock, '_t', readout, () => {
      ui.clock._t = readout;
      ui.clock.textContent = `${fmt(t)} / ${fmt(TOTAL)}`;
      ui.label.textContent = this.state === 'free' ? 'Free play' : shot.label;
    });
    const playing = this.state === 'playing';
    set(ui.toggle, '_p', playing, () => {
      ui.toggle._p = playing;
      ui.toggle.dataset.state = playing ? 'pause' : 'play';
      ui.toggle.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    });
    set(ui.sound, '_m', this.muted, () => {
      ui.sound._m = this.muted;
      ui.sound.dataset.state = this.muted ? 'off' : 'on';
      ui.sound.setAttribute('aria-label', this.muted ? 'Sound on' : 'Mute');
    });
    ui.gate.hidden = this.state !== 'gate';
    ui.bar.hidden = this.state === 'gate';
    ui.back.hidden = this.state !== 'free';
    ui.chapters.hidden = this.state === 'free';
    ui.cta.hidden = !(this.state !== 'free' && shot === END && t - END.start >= 1.6);
    const idle = playing && perf - this.lastActive > IDLE_MS;
    document.body.classList.toggle('idle', idle);
  }

  bind() {
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    const active = () => { this.lastActive = performance.now(); };
    addEventListener('pointermove', active, { passive: true });
    addEventListener('pointerdown', active, { passive: true });

    document.getElementById('start').addEventListener('click', () => this.start(false));
    document.getElementById('start-muted').addEventListener('click', () => this.start(true));
    document.getElementById('try').addEventListener('click', () => this.enterFree(0));
    document.getElementById('replay').addEventListener('click', () => { this.seek(0); this.play(); });
    document.getElementById('back').addEventListener('click', () => this.exitFree());
    this.ui.toggle.addEventListener('click', () => this.toggle());
    this.ui.sound.addEventListener('click', () => {
      if (!this.audio) this.initAudio(false);
      this.setMuted(!this.muted);
    });
    if (!document.fullscreenEnabled) this.ui.full.hidden = true;
    this.ui.full.addEventListener('click', () => this.fullscreen());

    // The canvas: start from the title screen, take a phone, or pause.
    const c = this.canvas;
    let down = null;
    c.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, at: performance.now() };
      if (this.state === 'free') this.aim(e.clientX);
    });
    c.addEventListener('pointermove', (e) => {
      if (this.state === 'free' && (e.pointerType === 'mouse' || down)) this.aim(e.clientX);
    });
    c.addEventListener('pointerup', (e) => {
      const tap = down && performance.now() - down.at < 300 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12;
      down = null;
      if (!tap) return;
      if (this.state === 'gate') { this.start(false); return; }
      if (this.state === 'free') { this.demo.input.fire = true; return; }
      if (this.shotAt(this.now()) === PLAY) {
        const hit = this.phoneRects.find((r) => e.clientX >= r.x && e.clientX < r.x + r.w && e.clientY >= r.y && e.clientY < r.y + r.h);
        if (hit) { this.enterFree(hit.view); return; }
      }
      if (this.state !== 'ended') this.toggle();
    });
    c.addEventListener('pointercancel', () => { down = null; });

    addEventListener('keydown', (e) => {
      active();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const onControl = e.target instanceof Element && e.target.closest('button, a');
      if (onControl && (e.key === ' ' || e.key === 'Enter')) return;
      const k = e.key;
      if (this.state === 'gate') {
        if (k === ' ' || k === 'Enter') { e.preventDefault(); this.start(false); }
        return;
      }
      if (this.state === 'free') {
        if (k === 'ArrowLeft' || k === 'ArrowRight') {
          e.preventDefault();
          this.demo.input.x = clamp(this.demo.input.x + (k === 'ArrowLeft' ? -0.08 : 0.08), 0, 1);
        } else if (k === ' ' || k === 'Shift') {
          e.preventDefault();
          this.demo.input.fire = true;
        } else if (k === 'Escape') {
          this.exitFree();
        }
        return;
      }
      if (k === ' ' || k === 'k') { e.preventDefault(); this.toggle(); }
      else if (k === 'ArrowLeft') { e.preventDefault(); this.jump(-1); }
      else if (k === 'ArrowRight') { e.preventDefault(); this.jump(1); }
      else if (k === 'm') this.ui.sound.click();
      else if (k === 'f') this.fullscreen();
      else if (k === 'r' || k === 'Home') { this.seek(0); this.play(); }
    });
  }

  fullscreen() {
    if (!document.fullscreenEnabled) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
}

window.trailer = new Trailer();
