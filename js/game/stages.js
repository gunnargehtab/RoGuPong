// RoGuPong — the four courts, all of them somewhere in Milano (or within sight
// of it on a clear day).
//
// Each stage is a scene module (js/game/scenes/) that paints two things in
// chunky art pixels: the backdrop — the place itself, seen side-on — and the
// court floor, the same place seen from above. The renderer caches both, so the
// painting can be as detailed as it likes. Each stage also deals its own crates:
// MULTIBALL everywhere (party mode is built on it), two classics picked to suit
// the place, and one signature crate that exists nowhere else.

import navigli from './scenes/navigli.js';
import duomo from './scenes/duomo.js';
import brera from './scenes/brera.js';
import alpi from './scenes/alpi.js';

/** The scene owns its palette (accent, court, line); the stage owns the rest. */
const stage = (scene, meta) => ({ ...meta, ...scene.palette, scene });

export const STAGES = [
  stage(navigli, {
    id: 'navigli',
    name: 'NAVIGLI NIGHT',
    blurb: 'Lamplight on the canal, terraces three deep, a very long aperitivo.',
    items: ['multi', 'ghost', 'turbo', 'mirror'],
  }),
  stage(duomo, {
    id: 'duomo',
    name: 'DUOMO ROOFTOP',
    blurb: 'Marble spires, the whole city below, the sun going gold.',
    items: ['multi', 'grow', 'shrink', 'spire'],
  }),
  stage(brera, {
    id: 'brera',
    name: 'BRERA ARCADE',
    blurb: 'A quiet courtyard of columns and arches. Mind the statue.',
    items: ['multi', 'grow', 'beach', 'arco'],
  }),
  stage(alpi, {
    id: 'alpi',
    name: 'ALPI SUNSET',
    blurb: 'Dolomite teeth on fire, and a long way down in the snow.',
    items: ['multi', 'frost', 'turbo', 'avalanche'],
  }),
];

export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];
