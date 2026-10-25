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
import { nightColour, toNight } from './scenes/kit.js';

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
    nightName: 'DUOMO BY NIGHT',
    nightBlurb: 'The spires lit from below, and the whole city a field of lights.',
    name: 'DUOMO ROOFTOP',
    blurb: 'Marble spires, the whole city below, the sun going gold.',
    items: ['multi', 'grow', 'shrink', 'spire'],
  }),
  stage(brera, {
    id: 'brera',
    nightName: 'BRERA BY NIGHT',
    nightBlurb: 'The arcade after closing, lamplit, with the statue keeping watch.',
    name: 'BRERA ARCADE',
    blurb: 'A quiet courtyard of columns and arches. Mind the statue.',
    items: ['multi', 'grow', 'beach', 'arco'],
  }),
  stage(alpi, {
    id: 'alpi',
    nightName: 'ALPI BY MOONLIGHT',
    nightBlurb: 'Moonlight on the Dolomite teeth, and the snow glowing blue.',
    name: 'ALPI SUNSET',
    blurb: 'Dolomite teeth on fire, and a long way down in the snow.',
    items: ['multi', 'frost', 'turbo', 'avalanche'],
  }),
];

export const stageById = (id) => STAGES.find((s) => s.id === id) || STAGES[0];

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const shade = (h) => hex(nightColour(...[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))));

const nights = new Map();
/**
 * A stage by night, the level-15 reward (DESIGN.md §8): the same scene with
 * its painting recoloured once as it is cached (kit.toNight). It keeps the
 * day stage's id, so records, crates and the stage tour don't tell them
 * apart; `variant` keys the renderer's cache. Its day animations are left
 * out: they would light the night back up. Navigli is a night already and
 * has none.
 */
export function nightOf(stage) {
  if (!stage.nightName) return stage;
  let n = nights.get(stage.id);
  if (!n) {
    const { scene } = stage;
    n = {
      ...stage,
      name: stage.nightName,
      blurb: stage.nightBlurb,
      variant: 'night',
      court: shade(stage.court),
      scene: {
        ...scene,
        backdrop: (ctx, w, h) => { scene.backdrop(ctx, w, h); toNight(ctx, w, h); },
        court: (ctx, w, h) => { scene.court(ctx, w, h); toNight(ctx, w, h); },
        animateBackdrop: null,
        animateCourt: null,
      },
    };
    nights.set(stage.id, n);
  }
  return n;
}

/** The stage to show: `id`'s day stage, or its night when asked for and it has one. */
export const stageView = (id, night) => (night ? nightOf(stageById(id)) : stageById(id));
