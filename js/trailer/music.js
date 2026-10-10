// RoGuPong trailer — the cut and its score.
//
// The trailer is cut to the music: 150 BPM, sixteen steps a bar, so one step
// is exactly a tenth of a second and every shot starts on a downbeat. The score
// is a pure function of the step, which is what lets the music follow the
// timeline wherever it is scrubbed to. It is the game's own A-minor loop
// (Am | G | F | E) with a hook in front and a fanfare at the end, played on the
// same kind of oscillators the game uses: no audio files here either.

export const BPM = 150;
export const STEP = 60 / BPM / 4;            // 0.1 s
export const BAR = STEP * 16;                // 1.6 s

/** The shots, in bars. Eleven bars: 17.6 seconds. */
export const SHOTS = [
  { id: 'hook', label: 'Intro', bars: 2 },
  { id: 'logo', label: 'Title', bars: 1 },
  { id: 'scan', label: 'Scan', bars: 1 },
  { id: 'duel', label: 'RO vs GU', bars: 2 },
  { id: 'stages', label: 'Stages', bars: 1 },
  { id: 'play', label: 'Gameplay', bars: 2 },
  { id: 'end', label: 'Play now', bars: 2 },
];
let at = 0;
for (const s of SHOTS) {
  s.start = at * BAR;
  s.step = at * 16;
  s.dur = s.bars * BAR;
  at += s.bars;
}
export const TOTAL = at * BAR;

/** The cold open's ball: the steps it meets a paddle on, RO's and GU's in turn. */
export const HOOK_HITS = [0, 4, 8, 12, 16, 20, 24, 28, 29, 30, 31];

const NOTE = (s) => 440 * Math.pow(2, (s - 9) / 12);    // 0 = C4, as in the game

// The game's lead, an octave down from how the game plays it (the game doubles
// the frequency), and its bass in the same notation.
const LEAD = [
  [9, 12, 16, 12, 14, 12, 9, null],
  [7, 11, 14, 11, 12, 11, 7, null],
  [5, 9, 12, 9, 11, 12, 14, 16],
  [16, 14, 12, 11, 9, null, null, null],
];
const ROOTS = [-15, -17, -19, -20];          // A2 G2 F2 E2: Am | G | F | E

/* ------------------------------------------------------------------ */
/* The score: what sounds on a given step                              */

function drums(q, ev, { four = true, snare = true, hats = 2 } = {}) {
  if (four ? q % 4 === 0 : q % 8 === 0) ev.push({ v: 'kick' });
  if (snare && (q === 4 || q === 12)) ev.push({ v: 'snare' });
  if (hats && q % hats === hats - 1) ev.push({ v: 'hat', g: q % 4 === 2 ? 1 : 0.6 });
}

function bass(q, root, ev) {
  if (q % 2 === 0) ev.push({ v: 'bass', n: root + (q % 4 === 2 ? 12 : 0), d: 1.6 });
}

function theme(q, bar, ev, up = 12) {
  if (q % 2) return;
  const n = LEAD[bar % 4][q / 2];
  if (n != null) ev.push({ v: 'lead', n: n + up, d: 1.8 });
}

const PARTS = {
  hook(s, ev) {
    const bar = s >> 4, q = s & 15;
    if (q % 4 === 0 && !(bar === 1 && q === 12)) ev.push({ v: 'kick' });
    bass(q, ROOTS[bar === 0 ? 0 : 1], ev);
    const hit = HOOK_HITS.indexOf(s);
    // The ball's own blips: RO's paddle answers high, GU's a fourth below,
    // and the last four climb into the title.
    if (hit >= 0) ev.push({ v: 'blip', n: hit < 7 ? (hit % 2 ? 16 : 21) : [24, 28, 31, 36][hit - 7] + 12 });
    if (bar === 1) {
      if (q === 4) ev.push({ v: 'snare' });
      if (q % 2 === 1) ev.push({ v: 'hat', g: 0.6 });
      if (q === 8) ev.push({ v: 'riser', d: 0.8 });
      if (q >= 12) ev.push({ v: 'snare', g: 0.5 + (q - 12) * 0.15 });
    }
    // Each line of copy lands on a stab.
    if (q === 0 || q === 8) ev.push({ v: 'stab', n: [9, 12, 16].map((n) => n - (bar ? 2 : 0)), d: 1.2, g: 0.7 });
  },

  logo(q, ev) {
    if (q === 0) ev.push({ v: 'crash' }, { v: 'kick' });
    // A letter lands on each of the first eight steps, climbing an A minor arpeggio.
    if (q < 8) ev.push({ v: 'blip', n: [21, 24, 28, 33, 36, 40, 45, 48][q], g: 0.8 });
    if (q === 8) ev.push({ v: 'stab', n: [9, 12, 16, 21], d: 3, g: 1 }, { v: 'kick' });
    if (q === 12) ev.push({ v: 'snare' }, { v: 'kick' });
    if (q >= 8 && q % 2 === 1) ev.push({ v: 'hat', g: 0.7 });
    if (q % 2 === 0) ev.push({ v: 'bass', n: -15 + (q % 4 === 2 ? 12 : 0), d: 1.6 });
  },

  scan(q, ev) {
    const root = q < 12 ? -19 : -20;              // F, then E pulling back to A
    bass(q, root, ev);
    if (q % 8 === 0) ev.push({ v: 'kick' });
    ev.push({ v: 'arp', n: [5, 9, 12, 17][q % 4] + 12 - (q >= 12 ? 1 : 0), d: 0.8 });
    if (q === 0 || q === 6) ev.push({ v: 'scan' });
    if (q === 4 || q === 10) ev.push({ v: 'beep' });
    if (q === 12) ev.push({ v: 'crash', g: 0.6 }, { v: 'kick' }, { v: 'stab', n: [8, 11, 16], d: 3, g: 0.9 });
  },

  duel(s, ev) {
    const bar = s >> 4, q = s & 15;
    drums(q, ev, { hats: 1 });
    bass(q, ROOTS[bar], ev);
    theme(q, bar, ev);
    // RO crashes in on the first beat, GU on the third, VS on the next bar.
    if ((bar === 0 && (q === 0 || q === 8)) || (bar === 1 && q === 0)) ev.push({ v: 'crash', g: bar ? 1 : 0.7 });
    if (bar === 1 && q === 0) ev.push({ v: 'stab', n: [7, 11, 14, 19], d: 2, g: 1 });
    if (bar === 1 && q === 8) ev.push({ v: 'riser', d: 0.8, g: 0.6 });
  },

  stages(q, ev) {
    drums(q, ev);
    bass(q, ROOTS[2], ev);
    theme(q, 2, ev);
    if (q % 4 === 0) ev.push({ v: 'whoosh' });
  },

  play(s, ev) {
    const bar = s >> 4, q = s & 15;
    // The game's own match loop picks up where the stages left it.
    drums(q, ev, { hats: 1 });
    const root = bar === 0 ? [-15, -10, -8, -8][q >> 2] : ROOTS[0];
    bass(q, root, ev);
    theme(q, bar === 0 ? 3 : 0, ev);
    if (bar === 1 && q >= 12) ev.push({ v: 'snare', g: 0.5 + (q - 12) * 0.15 });
  },

  end(s, ev) {
    const bar = s >> 4, q = s & 15;
    if (bar === 0) {
      if (q === 0) ev.push({ v: 'crash' }, { v: 'kick' }, { v: 'stab', n: [9, 12, 16, 21], d: 2, g: 1 });
      // The game's victory jingle, a step apart: A major, the way a win sounds.
      if (q < 6) ev.push({ v: 'lead', n: [21, 25, 28, 33, 37, 40][q], d: 1.6, g: 1.1 });
      if (q === 8) ev.push({ v: 'stab', n: [5, 9, 12, 17], d: 2, g: 0.9 }, { v: 'kick' });
      if (q === 12) ev.push({ v: 'stab', n: [7, 11, 14, 19], d: 2, g: 0.9 }, { v: 'kick' }, { v: 'snare' });
      if (q === 14) ev.push({ v: 'snare', g: 0.8 });
      if (q === 15) ev.push({ v: 'snare', g: 1 });
      if (q % 2 === 0) bass(q, [-15, -15, -19, -17][q >> 2], ev);
    } else if (q === 0) {
      ev.push({ v: 'crash' }, { v: 'kick' },
        { v: 'chord', n: [-3, 1, 4, 9, 13, 16], d: 14 },
        { v: 'bass', n: -15, d: 14 });
    }
  },
};

/** Everything that sounds on global step `step`. */
export function eventsAt(step) {
  const ev = [];
  for (const shot of SHOTS) {
    const local = step - shot.step;
    if (local < 0 || local >= shot.bars * 16) continue;
    PARTS[shot.id](local, ev);
    break;
  }
  return ev;
}

/* ------------------------------------------------------------------ */
/* The synth                                                           */

/** A pulse wave of the given duty cycle, for that 16-bit console reed. */
function pulseWave(ctx, duty) {
  const N = 64;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    // Fourier series of a pulse that is high for `duty` of the period.
    real[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * duty);
    imag[n] = (2 / (n * Math.PI)) * (1 - Math.cos(2 * Math.PI * n * duty));
  }
  return ctx.createPeriodicWave(real, imag);
}

export class Synth {
  /** `out` is where the music goes: a gain the app owns, so it can mute it. */
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.bus = null;
    this.wide = pulseWave(ctx, 0.25);
    this.thin = pulseWave(ctx, 0.125);
    const len = ctx.sampleRate;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    // Seeded, so the hats sound the same on every pass.
    let a = 0x2f6b;
    for (let i = 0; i < len; i++) {
      a = (a * 1103515245 + 12345) & 0x7fffffff;
      d[i] = (a / 0x3fffffff) - 1;
    }
    this.cut();
  }

  /**
   * Silence everything already scheduled: notes go to a bus, and a paused or
   * scrubbed trailer drops the bus they were queued on.
   */
  cut() {
    if (this.bus) {
      const old = this.bus;
      old.gain.setTargetAtTime(0, this.ctx.currentTime, 0.015);
      setTimeout(() => old.disconnect(), 200);
    }
    this.bus = this.ctx.createGain();
    this.bus.gain.value = 1;
    this.bus.connect(this.out);
  }

  osc(type, freq, when, dur, gain, attack = 0.004, wave = null) {
    const c = this.ctx;
    const o = c.createOscillator();
    if (wave) o.setPeriodicWave(wave); else o.type = type;
    o.frequency.setValueAtTime(freq, when);
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(gain, when + attack);
    g.gain.setValueAtTime(gain, when + Math.max(attack, dur * 0.55));
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g).connect(this.bus);
    o.start(when);
    o.stop(when + dur + 0.05);
    return o;
  }

  noise(when, dur, gain, { type = 'bandpass', freq = 1800, to = null, q = 0.8 } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, when);
    if (to) f.frequency.exponentialRampToValueAtTime(to, when + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    src.connect(f).connect(g).connect(this.bus);
    src.start(when, Math.random() * 0.5);
    src.stop(when + dur + 0.05);
  }

  play(e, when) {
    const g = e.g ?? 1;
    const d = (e.d ?? 1) * STEP;
    switch (e.v) {
      case 'lead':
        this.osc(null, NOTE(e.n), when, d, 0.11 * g, 0.004, this.wide);
        break;
      case 'arp':
        this.osc(null, NOTE(e.n), when, d, 0.05 * g, 0.003, this.thin);
        break;
      case 'bass':
        this.osc('triangle', NOTE(e.n), when, d, 0.3 * g);
        break;
      case 'blip':
        this.osc('square', NOTE(e.n), when, 0.07, 0.09 * g, 0.002);
        break;
      case 'stab':
        for (const n of e.n) this.osc(null, NOTE(n), when, d, 0.05 * g, 0.004, this.wide);
        break;
      case 'chord':
        for (const n of e.n) this.osc(null, NOTE(n), when, d, 0.045, 0.01, this.wide);
        break;
      case 'kick': {
        const o = this.osc('sine', 150, when, 0.18, 0.55 * g, 0.002);
        o.frequency.exponentialRampToValueAtTime(42, when + 0.12);
        break;
      }
      case 'snare':
        this.noise(when, 0.16, 0.22 * g, { freq: 2200, q: 0.6 });
        this.osc('triangle', 190, when, 0.08, 0.12 * g);
        break;
      case 'hat':
        this.noise(when, 0.035, 0.07 * g, { type: 'highpass', freq: 7500 });
        break;
      case 'crash':
        this.noise(when, 1.3, 0.16 * g, { type: 'highpass', freq: 3200 });
        this.noise(when, 0.5, 0.12 * g, { freq: 900, q: 0.5 });
        break;
      case 'riser':
        this.noise(when, d, 0.12 * g, { freq: 400, to: 6000, q: 2 });
        break;
      case 'whoosh':
        this.noise(when, 0.25, 0.1, { freq: 3000, to: 500, q: 1.2 });
        break;
      case 'scan': {
        const o = this.osc('sine', 700, when, 0.36, 0.06);
        o.frequency.exponentialRampToValueAtTime(2600, when + 0.34);
        break;
      }
      case 'beep':
        this.osc('square', 1320, when, 0.06, 0.07, 0.002);
        this.osc('square', 1760, when + 0.07, 0.09, 0.07, 0.002);
        break;
      default:
        break;
    }
  }
}
