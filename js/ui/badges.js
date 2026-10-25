// RoGuPong — the small badges that sit in a line of text: the flair tracks'
// marks on the standings and in the lobby, the padlock of a tier not yet
// reached, and the rivalry's crossed swords. 12×12 pixel glyphs drawn in
// code, like the emotes they replaced emoji alongside.

import { artCanvas } from './emotes.js';

const COLORS = {
  k: '#1a0d2b',   // outline
  r: '#ff4d3d',
  o: '#ff9a2e',
  y: '#ffd93b',
  b: '#3da5ff',
  g: '#a99cc8',   // the padlock, in the menus' dim ink
  s: '#d8d8e8',   // blades
  c: '#d98b3c',   // hilts
};

const ART = {
  rainbow: [
    '............',
    '............',
    '....kkkk....',
    '..kkrrrrkk..',
    '.krryyyyrrk.',
    '.kryybbyyrk.',
    'kryybkkbyyrk',
    'krybk..kbyrk',
    'krybk..kbyrk',
    'kkkkk..kkkkk',
    '............',
    '............',
  ],
  flame: [
    '......k.....',
    '.....kr.....',
    '....krrk.k..',
    '...krrrkkrk.',
    '...krorrrrk.',
    '..krooorrok.',
    '..kroyyoork.',
    '.kroyyyyork.',
    '.kroyyyyork.',
    '.kkoyyyyok..',
    '..kkoyyokk..',
    '...kkkkkk...',
  ],
  star: [
    '.....kk.....',
    '....kyyk....',
    '....kyyk....',
    'kkkkkyykkkkk',
    'kyyyyyyyyyyk',
    '.kyyyyyyyyk.',
    '..kyyyyyyk..',
    '..kyyyyyyk..',
    '.kyyyykyyyk.',
    '.kyyk..kyyk.',
    '.kkk....kkk.',
    '............',
  ],
  crown: [
    '............',
    '.k...kk...k.',
    'kyk.kyyk.kyk',
    'kyk.kyyk.kyk',
    'kyyyyyyyyyyk',
    'kyyryyyyryyk',
    'kyyyyyyyyyyk',
    'kkkkkkkkkkkk',
    'kyyyyyyyyyyk',
    'kkkkkkkkkkkk',
    '............',
    '............',
  ],
  lock: [
    '....kkkk....',
    '...kggggk...',
    '..kgk..kgk..',
    '..kg....gk..',
    '.kkkkkkkkkk.',
    '.kggggggggk.',
    '.kgggkkgggk.',
    '.kgggkkgggk.',
    '.kggggkgggk.',
    '.kggggggggk.',
    '.kkkkkkkkkk.',
    '............',
  ],
  // A party popper, confetti flying.
  party: [
    '........y.r.',
    '......b...y.',
    '.......r.b..',
    '.....y..y...',
    '....kkk.....',
    '...kyyyk....',
    '..kyyyyk....',
    '.kyyyykk....',
    'kyyyykk.....',
    'kyykkk......',
    'kkkk........',
    '............',
  ],
  // A level up.
  up: [
    '.....kk.....',
    '....kyyk....',
    '...kyyyyk...',
    '..kyyyyyyk..',
    '.kyyyyyyyyk.',
    'kkkkyyyykkkk',
    '...kyyyyk...',
    '...kyyyyk...',
    '...kyyyyk...',
    '...kyyyyk...',
    '...kkkkkk...',
    '............',
  ],
  // A sparkle, for a flair unlocked.
  spark: [
    '.....kk.....',
    '.....ky.....',
    '....kyyk....',
    '....kyyk....',
    'kk.kyyyyk.kk',
    'kyykyyyykyyk',
    'kyykyyyykyyk',
    'kk.kyyyyk.kk',
    '....kyyk....',
    '....kyyk....',
    '.....ky.....',
    '.....kk.....',
  ],
  swords: [
    's.........s.',
    '.s.......s..',
    '..s.....s...',
    '...s...s....',
    '....s.s.....',
    '.....s......',
    '....s.s.....',
    '...s...s....',
    '..cs...sc...',
    '.ccc...ccc..',
    'cc.......cc.',
    '............',
  ],
};

export const BADGE_LABELS = {
  rainbow: 'Rainbow', flame: 'Flame', star: 'Starlight', crown: 'Royal',
  lock: 'Locked', swords: 'Rivalry', party: 'Party mode', up: 'Level up', spark: 'Unlocked',
};

/** A canvas element showing badge `id`, `px` CSS pixels a pixel. */
export function badgeCanvas(id, px = 1) {
  const canvas = artCanvas(ART[id] || ART.lock, COLORS, px, 'badge');
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', BADGE_LABELS[id] || id);
  return canvas;
}
