// RoGuPong — DUOMO ROOFTOP. Placeholder scene: a banded sky and a flat court,
// standing in until the real painting lands.

import { bands, rect } from './kit.js';

export default {
  palette: { accent: '#ffd166', court: '#1f2140', line: 'rgba(255,209,102,0.5)' },

  backdrop(ctx, w, h) {
    bands(ctx, 0, 0, w, h, ['#1d3f8a', '#4f7fc9', '#f2b36a']);
  },

  court(ctx, w, h) {
    rect(ctx, 0, 0, w, h, '#1f2140');
  },
};
