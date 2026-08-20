// RoGuPong — the four courts, all of them somewhere in Milano.
//
// Backdrops are generated rather than drawn: each stage is a sky gradient plus
// a couple of parallax silhouette layers built from a seeded skyline, so the
// whole game stays a few kilobytes and still looks like a different place
// every round.

function mulberry(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A row of blocky buildings, as fractions of the court width. */
function skyline(seed, count, minH, maxH) {
  const rand = mulberry(seed);
  const out = [];
  let x = -0.05;
  while (x < 1.05) {
    const w = 0.05 + rand() * 0.09;
    const h = minH + rand() * (maxH - minH);
    const spire = rand() < 0.18;
    out.push({ x, w, h, spire });
    x += w + rand() * 0.015;
    if (out.length > count) break;
  }
  return out;
}

/** Cathedral spires: a symmetric wedge of pointed towers. */
function spires(seed) {
  const rand = mulberry(seed);
  const out = [];
  for (let i = 0; i < 15; i++) {
    const t = i / 14;
    const centre = 1 - Math.abs(t - 0.5) * 2;
    out.push({
      x: t * 1.06 - 0.03,
      w: 0.035 + rand() * 0.02,
      h: 0.10 + centre * 0.20 + rand() * 0.04,
      spire: true,
    });
  }
  return out;
}

export const STAGES = [
  {
    id: 'navigli',
    name: 'NAVIGLI NIGHT',
    blurb: 'Canal water, cheap neon, a very long evening.',
    sky: ['#1b0f3a', '#4a1b5c', '#c0407a'],
    far: { color: '#2a1450', shapes: skyline(1337, 26, 0.08, 0.20), y: 0.62 },
    near: { color: '#160a2c', shapes: skyline(90210, 22, 0.05, 0.14), y: 0.72 },
    water: { top: 0.72, color: 'rgba(46,18,86,0.85)', shimmer: '#ff7ac6' },
    accent: '#ff56d0',
    court: '#2b1350',
    line: 'rgba(255,138,226,0.55)',
    stars: 0,
  },
  {
    id: 'duomo',
    name: 'DUOMO ROOFTOP',
    blurb: 'Marble underfoot, pigeons in the stands.',
    sky: ['#0d1440', '#2f3f86', '#f0a05a'],
    far: { color: '#1a2058', shapes: spires(7), y: 0.58 },
    near: { color: '#0b0f2e', shapes: skyline(4242, 18, 0.04, 0.11), y: 0.70 },
    water: null,
    accent: '#ffd166',
    court: '#151b47',
    line: 'rgba(255,209,102,0.5)',
    stars: 60,
  },
  {
    id: 'brera',
    name: 'BRERA ARCADE',
    blurb: 'Back room, CRT hum, coin-op carpet.',
    sky: ['#07110f', '#0d2b25', '#134b3c'],
    far: { color: '#0a1f1b', shapes: skyline(555, 24, 0.10, 0.22), y: 0.60 },
    near: { color: '#05100e', shapes: skyline(777, 20, 0.06, 0.15), y: 0.74 },
    water: null,
    accent: '#8affc1',
    court: '#0a1a17',
    line: 'rgba(138,255,193,0.45)',
    stars: 0,
    checker: true,
  },
  {
    id: 'alpi',
    name: 'ALPI SUNSET',
    blurb: 'The mountains you can only see on a clear day.',
    sky: ['#2b1a4d', '#c0486a', '#ffb347'],
    far: { color: '#5b2f63', shapes: skyline(31415, 14, 0.14, 0.30), y: 0.55 },
    near: { color: '#2e1440', shapes: skyline(27182, 20, 0.05, 0.13), y: 0.70 },
    water: null,
    accent: '#ff9b4a',
    court: '#33184a',
    line: 'rgba(255,155,74,0.5)',
    stars: 25,
  },
];

export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
