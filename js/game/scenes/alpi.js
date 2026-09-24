// RoGuPong — ALPI SUNSET. Placeholder scene: a banded sky and a flat court,
// standing in until the real painting lands.

import { bands, rect } from './kit.js';

export default {
  palette: { accent: '#ff9b4a', court: '#221c38', line: 'rgba(255,155,74,0.5)' },

  backdrop(ctx, w, h) {
    bands(ctx, 0, 0, w, h, ['#3a2a6a', '#c0507a', '#ffa060']);
  },

  court(ctx, w, h) {
    rect(ctx, 0, 0, w, h, '#221c38');
  },
};
