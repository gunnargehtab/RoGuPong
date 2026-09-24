// RoGuPong — BRERA ARCADE. Placeholder scene: a banded sky and a flat court,
// standing in until the real painting lands.

import { bands, rect } from './kit.js';

export default {
  palette: { accent: '#e8c98a', court: '#231f1b', line: 'rgba(232,201,138,0.45)' },

  backdrop(ctx, w, h) {
    bands(ctx, 0, 0, w, h, ['#123a78', '#3f6fb5', '#9fb8d8']);
  },

  court(ctx, w, h) {
    rect(ctx, 0, 0, w, h, '#231f1b');
  },
};
