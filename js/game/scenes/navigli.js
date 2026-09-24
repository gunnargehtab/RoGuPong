// RoGuPong — NAVIGLI NIGHT. Placeholder scene: a banded sky and a flat court,
// standing in until the real painting lands.

import { bands, rect } from './kit.js';

export default {
  palette: { accent: '#ffb347', court: '#0e1a36', line: 'rgba(255,196,110,0.5)' },

  backdrop(ctx, w, h) {
    bands(ctx, 0, 0, w, h, ['#0b1433', '#23305f', '#c77a3a']);
  },

  court(ctx, w, h) {
    rect(ctx, 0, 0, w, h, '#0e1a36');
  },
};
