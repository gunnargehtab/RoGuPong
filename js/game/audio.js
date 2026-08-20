// RoGuPong — the soundtrack, synthesised on the spot.
//
// No audio files: every blip, whoosh and bassline is generated with Web Audio
// oscillators, which keeps the whole game a few tens of kilobytes and means it
// works the first time even on a WiFi with no internet behind it.
//
// Browsers refuse to start audio until the user touches something, so nothing
// is created until unlock() is called from a real tap.

const NOTE = (semitone) => 440 * Math.pow(2, (semitone - 9) / 12);   // 0 = C4

// A little two-part loop in A minor: square lead over a triangle bass, with a
// noise hat on the offbeats. Sixteen steps per bar, four bars.
const LEAD = [
  9, null, 12, null, 16, null, 12, null, 14, null, 12, null, 9, null, null, null,
  7, null, 11, null, 14, null, 11, null, 12, null, 11, null, 7, null, null, null,
  5, null, 9, null, 12, null, 9, null, 11, null, 12, null, 14, null, 16, null,
  16, null, 14, null, 12, null, 11, null, 9, null, null, null, null, null, null, null,
];
const BASS = [
  -3, null, null, null, -3, null, null, null, -3, null, null, null, 2, null, null, null,
  -5, null, null, null, -5, null, null, null, -5, null, null, null, 0, null, null, null,
  -7, null, null, null, -7, null, null, null, -7, null, null, null, -3, null, null, null,
  -3, null, null, null, 2, null, null, null, 4, null, null, null, 4, null, null, null,
];

// Slower, moodier variant for the menus.
const MENU_LEAD = [
  9, null, null, null, 12, null, null, null, 14, null, null, 12, null, null, null, null,
  7, null, null, null, 11, null, null, null, 12, null, null, 11, null, null, null, null,
  5, null, null, null, 9, null, null, null, 11, null, null, 12, null, null, null, null,
  4, null, null, null, 7, null, null, null, 9, null, null, null, null, null, null, null,
];

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.musicOn = true;
    this.sfxOn = true;
    this.timer = null;
    this.step = 0;
    this.track = null;
  }

  /** Must be called from inside a real user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicOn ? 0.28 : 0;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxOn ? 0.55 : 0;
    this.sfxGain.connect(this.master);
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.28 : 0;
  }

  setSfx(on) {
    this.sfxOn = on;
    if (this.sfxGain) this.sfxGain.gain.value = on ? 0.55 : 0;
  }

  /* ---------------------------------------------------------------- */
  /* One-shots                                                         */

  tone(freq, dur, type = 'square', gain = 0.2, dest = null, detune = 0) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.detune.value = detune;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(dest || this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  sweep(from, to, dur, type = 'sawtooth', gain = 0.22) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  noise(dur = 0.2, gain = 0.18, filterFreq = 1800, sweepTo = null) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(this.sfxGain);
    src.start(t);
  }

  blip(freq = 700, dur = 0.06, type = 'square', gain = 0.14) { this.tone(freq, dur, type, gain); }

  hit(big = false, rally = 0) {
    const base = 420 + Math.min(rally, 24) * 22;
    if (big) {
      this.tone(base * 0.6, 0.18, 'sawtooth', 0.26);
      this.noise(0.22, 0.22, 900, 300);
    } else {
      this.tone(base, 0.055, 'square', 0.18);
    }
  }

  wall() { this.tone(240, 0.05, 'triangle', 0.14); }
  shield() { this.tone(1100, 0.12, 'sine', 0.2); this.noise(0.25, 0.14, 3200, 900); }
  item() { [0, 4, 7, 12].forEach((n, i) => setTimeout(() => this.tone(NOTE(9 + n) * 2, 0.09, 'square', 0.15), i * 55)); }
  special() { this.sweep(180, 1400, 0.45, 'sawtooth', 0.26); this.noise(0.5, 0.2, 600, 4000); }
  goal() { this.sweep(600, 90, 0.5, 'square', 0.24); this.noise(0.4, 0.2, 1400, 200); }
  count(n) { this.tone(n === 0 ? 880 : 520, n === 0 ? 0.22 : 0.1, 'square', 0.2); }
  menu() { this.tone(720, 0.045, 'square', 0.12); }
  back() { this.tone(320, 0.07, 'square', 0.12); }

  victory() {
    [0, 4, 7, 12, 16, 19].forEach((n, i) => {
      setTimeout(() => this.tone(NOTE(9 + n) * 2, 0.16, 'square', 0.18), i * 95);
    });
  }

  defeat() {
    [0, -3, -7, -12].forEach((n, i) => {
      setTimeout(() => this.tone(NOTE(9 + n) * 2, 0.22, 'triangle', 0.16), i * 140);
    });
  }

  /* ---------------------------------------------------------------- */
  /* The loop                                                          */

  playMusic(which = 'menu') {
    if (!this.ctx) return;
    if (this.track === which && this.timer) return;
    this.stopMusic();
    this.track = which;
    this.step = 0;
    const bpm = which === 'match' ? 138 : 104;
    const stepMs = (60000 / bpm) / 4;
    const lead = which === 'match' ? LEAD : MENU_LEAD;
    this.timer = setInterval(() => this.tickMusic(lead), stepMs);
  }

  tickMusic(lead) {
    if (!this.ctx || !this.musicOn) return;
    const i = this.step % lead.length;
    const l = lead[i];
    if (l != null) this.voice(NOTE(l) * 2, 0.16, 'square', 0.12);
    const b = BASS[i % BASS.length];
    if (b != null) this.voice(NOTE(b) / 2, 0.30, 'triangle', 0.16);
    if (i % 4 === 2) this.hat();
    this.step++;
  }

  voice(freq, dur, type, gain) {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  hat() {
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * 0.04);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.value = 0.07;
    src.connect(f).connect(g).connect(this.musicGain);
    src.start(t);
  }

  stopMusic() {
    clearInterval(this.timer);
    this.timer = null;
    this.track = null;
  }
}

export const audio = new Audio();
