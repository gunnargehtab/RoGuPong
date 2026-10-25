// RoGuPong — the emotes, as 12×12 pixel icons drawn in code.
//
// The emote bar used to show the platform's own emoji: the one set of glyphs
// in the game that came from outside it, smooth-edged and different on every
// phone. These are hand-placed like the hero sprites and the logo, so an
// emote looks the same on both ends of the line. The index still rides the
// wire as {t:'emote', i}; only what an index looks like changed.

const COLORS = {
  k: '#1a0d2b',   // outline
  w: '#ffffff',
  y: '#ffd93b',   // faces, the hand
  r: '#ff4d3d',
  o: '#ff9a2e',
  p: '#fff3c4',   // the hottest part of the fire
  b: '#3da5ff',
  c: '#d98b3c',   // pizza crust
  h: '#ffd166',   // cheese
  s: '#d63a2f',   // pepperoni, and a laughing mouth
  g: '#c9c2e8',   // ghost shade
  n: '#8b5a2b',   // the poop
  m: '#b07a3c',
};

const ART = {
  fire: [
    '......r.....',
    '.....rr.....',
    '....rrr..r..',
    '....rrrr.r..',
    '...rrorrrr..',
    '..rroooorrr.',
    '..rooyyooor.',
    '.rrooyyyoor.',
    '.rroyyyyyor.',
    '..royypyyo..',
    '..rooyyyoo..',
    '...ooooooo..',
  ],
  cool: [
    '...kkkkkk...',
    '..kyyyyyyk..',
    '.kyyyyyyyyk.',
    'kyyyyyyyyyyk',
    'kkkkkyykkkkk',
    'kykkkyykkkyk',
    'kyyyyyyyyyyk',
    'kyyyyyyyyyyk',
    'kyykyyyyykyk',
    'kyyykkkkkyyk',
    '.kyyyyyyyyk.',
    '..kkkkkkkk..',
  ],
  scream: [
    '...kkkkkk...',
    '..kyyyyyyk..',
    '.kyyyyyyyyk.',
    'kywwyyyywwyk',
    'kywkyyyywkyk',
    'kyyyyyyyyyyk',
    'kyyykkkkyyyk',
    'kyykkkkkkyyk',
    'kyykkkkkkyyk',
    'kyyykkkkyyyk',
    '.kyyyyyyyyk.',
    '..kkkkkkkk..',
  ],
  pizza: [
    'kkkkkkkkkkkk',
    'kcccccccccck',
    'kcccccccccck',
    '.khhhhhhhhk.',
    '.khshhhhshk.',
    '.khsshhsshk.',
    '..khhhhhhk..',
    '..khhsshhk..',
    '...khsshk...',
    '...khhhhk...',
    '....khhk....',
    '.....kk.....',
  ],
  lol: [
    '...kkkkkk...',
    '..kyyyyyyk..',
    '.kyyyyyyyyk.',
    'kykkkyykkkyk',
    'kykykyykykyk',
    'kyyyyyyyyyyk',
    'kykkkkkkkkyk',
    'kykwwwwwwkyk',
    'kyksssssskyk',
    'kyykssssskyk',
    '.kyyykkkyyk.',
    '..kkkkkkkk..',
  ],
  ghost: [
    '....kkkk....',
    '...kwwwwk...',
    '..kwwwwwwk..',
    '.kwwwwwwwwk.',
    '.kwkkwwkkwk.',
    '.kwkkwwkkwk.',
    '.kwwwwwwwwk.',
    '.kwwwwwwwwk.',
    '.kwwwwwwggk.',
    '.kwwwwwgggk.',
    '.kwwkwwkwwk.',
    '..kk.kk.kk..',
  ],
  rocket: [
    '.....kk.....',
    '....krrk....',
    '....krrk....',
    '...kwwwwk...',
    '...kwbbwk...',
    '...kwbbwk...',
    '..kkwwwwkk..',
    '.krrwwwwrrk.',
    'krrrwwwwrrrk',
    '.kkkkkkkkkk.',
    '...koyyok...',
    '....kyyk....',
  ],
  poop: [
    '.....kk.....',
    '....knnk....',
    '....knnk....',
    '...knmnnk...',
    '..knnnnnnk..',
    '..kmnnnnnk..',
    '.knnnnnnnnk.',
    '.knwknnwknk.',
    '.knnnnnnnnk.',
    'knnnkkkknnnk',
    'knnnnnnnnnnk',
    '.kkkkkkkkkk.',
  ],
  // What an index this build doesn't know pops as — a newer phone's emote.
  wave: [
    '..k.k.k.....',
    '.kykykyk.k..',
    '.kykykykkyk.',
    '.kyyyyyykyk.',
    '.kyyyyyyyyk.',
    'kkyyyyyyyyk.',
    'kyyyyyyyyyk.',
    'kkyyyyyyyyk.',
    '.kyyyyyyyk..',
    '..kyyyyyyk..',
    '..kyyyyyyk..',
    '..kkkkkkkk..',
  ],
};

export const EMOTE_SIZE = 12;

/** Spoken names, for the buttons' labels. */
export const EMOTE_LABELS = {
  fire: 'Fire', cool: 'Cool', scream: 'Scream', pizza: 'Pizza', lol: 'Laughing',
  ghost: 'Ghost', rocket: 'Rocket', poop: 'Poop', wave: 'Wave',
};

/** Draw emote `id` with its top-left corner at (x, y), `px` canvas units a pixel. */
export function drawEmote(ctx, id, x, y, px) {
  const rows = ART[id] || ART.wave;
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const color = COLORS[rows[r][c]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x + c * px, y + r * px, px, px);
    }
  }
}

/** A canvas element showing emote `id`, `px` CSS pixels a pixel, crisp on any screen. */
export function emoteCanvas(id, px) {
  const dpr = Math.max(1, Math.min(3, Math.round(window.devicePixelRatio || 1)));
  const size = EMOTE_SIZE * px;
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.className = 'emote';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  drawEmote(ctx, id, 0, 0, px);
  return canvas;
}
