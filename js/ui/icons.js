// RoGuPong — the menu buttons' icons: 12×12 one-colour pixel glyphs drawn
// in code, in whatever colour the button's text is.
//
// A button is matched by its data-action (buttonIcons in screens.js), so a
// screen built from HTML strings gets its icons without naming them.

const ART = {
  play: [
    '............',
    '...##.......',
    '...###......',
    '...####.....',
    '...#####....',
    '...######...',
    '...#######..',
    '...######...',
    '...#####....',
    '...####.....',
    '...###......',
    '...##.......',
  ],
  // A QR code: three finders and a scatter of modules.
  host: [
    '#####..#####',
    '#...#..#...#',
    '#.#.#..#.#.#',
    '#...#..#...#',
    '#####..#####',
    '......#.....',
    '.#.#.#.##.#.',
    '#####..#..##',
    '#...#.##.#..',
    '#.#.#..#..##',
    '#...#.#.##..',
    '#####..#.#.#',
  ],
  // A camera, lens out.
  join: [
    '............',
    '...####.....',
    '############',
    '############',
    '####....####',
    '###..##..###',
    '###.####.###',
    '###.####.###',
    '###..##..###',
    '####....####',
    '############',
    '############',
  ],
  // A trophy.
  board: [
    '#.########.#',
    '#.########.#',
    '#.########.#',
    '##.######.##',
    '.#.######.#.',
    '..########..',
    '...######...',
    '....####....',
    '.....##.....',
    '.....##.....',
    '...######...',
    '..########..',
  ],
  howto: [
    '...######...',
    '..##....##..',
    '..##....##..',
    '........##..',
    '.......##...',
    '......##....',
    '.....##.....',
    '.....##.....',
    '............',
    '.....##.....',
    '.....##.....',
    '............',
  ],
  back: [
    '............',
    '............',
    '....##......',
    '...###......',
    '..####......',
    '.###########',
    '############',
    '.###########',
    '..####......',
    '...###......',
    '....##......',
    '............',
  ],
  // Round again: an arrow chasing its tail.
  rematch: [
    '....######..',
    '...##....##.',
    '..##......##',
    '..##.....###',
    '........####',
    '.......#####',
    '............',
    '#####.......',
    '####........',
    '###.....##..',
    '##......##..',
    '.##....##...',
  ],
};

/** The icon a button with this data-action carries, if any. */
export const ICON_FOR_ACTION = {
  play: 'play', start: 'play', host: 'host', join: 'join', board: 'board',
  howto: 'howto', title: 'back', leave: 'back', rematch: 'rematch',
};

export const ICON_SIZE = 12;

/** Draw icon `id` in `color`, top-left at (x, y), `px` canvas units a pixel. */
export function drawIcon(ctx, id, x, y, px, color) {
  const rows = ART[id];
  if (!rows) return;
  ctx.fillStyle = color;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === '#') ctx.fillRect(x + c * px, y + r * px, px, px);
    }
  }
}

/** A canvas element showing icon `id`, `px` CSS pixels a pixel, crisp on any screen. */
export function iconCanvas(id, px, color) {
  const dpr = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
  const size = ICON_SIZE * px;
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.className = 'btn-icon';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  drawIcon(ctx, id, 0, 0, px, color);
  return canvas;
}
