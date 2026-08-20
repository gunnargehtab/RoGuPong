// RoGuPong — 5x7 pixel font used for every bit of canvas text (HUD, banners,
// countdowns). Shipping our own glyphs means the game looks identical on every
// phone, no matter which fonts Android happens to have.
//
// Each glyph is 7 rows packed as a 14-char hex string; one byte per row, the
// low 5 bits of each byte are the pixels, MSB-first (left to right).

const FONT = {
  'A': '0E11111F111111', 'B': '1E11111E11111E', 'C': '0E11101010110E',
  'D': '1E11111111111E', 'E': '1F10101E10101F', 'F': '1F10101E101010',
  'G': '0E11101711110F', 'H': '1111111F111111', 'I': '0E04040404040E',
  'J': '0702020202120C', 'K': '11121418141211', 'L': '1010101010101F',
  'M': '111B1515111111', 'N': '11191915131311', 'O': '0E11111111110E',
  'P': '1E11111E101010', 'Q': '0E11111115120D', 'R': '1E11111E141211',
  'S': '0F10100E01011E', 'T': '1F040404040404', 'U': '1111111111110E',
  'V': '11111111110A04', 'W': '11111115151B11', 'X': '11110A040A1111',
  'Y': '11110A04040404', 'Z': '1F01020408101F',
  '0': '0E11131519110E', '1': '040C040404040E', '2': '0E11010204081F',
  '3': '1F02040201110E', '4': '02060A121F0202', '5': '1F101E0101110E',
  '6': '0608101E11110E', '7': '1F010204080808', '8': '0E11110E11110E',
  '9': '0E11110F01020C',
  ' ': '00000000000000', '.': '00000000000C0C', ',': '00000000000C08',
  ':': '000C0C000C0C00', ';': '000C0C000C0C08', '-': '0000001F000000',
  '_': '0000000000001F', '!': '04040404040004', '?': '0E110102040004',
  "'": '04040000000000', '"': '0A0A0000000000', '/': '01020204080810',
  '+': '0004041F040400', '=': '00001F001F0000', '(': '02040808080402',
  ')': '08040202020408', '<': '02040810080402', '>': '08040201020408',
  '#': '0A0A1F0A1F0A0A', '*': '00150E1F0E1500', '%': '191A0204080B13',
  '$': '041F101F011F04',
  // '@' is drawn as a little heart — for "MADE IN MILANO WITH @".
  '@': '0A1F1F1F0E0400',
};

export const GLYPH_W = 5;
export const GLYPH_H = 7;

const rowCache = new Map();
function rows(ch) {
  let r = rowCache.get(ch);
  if (r) return r;
  const hex = FONT[ch] || FONT['?'];
  r = [];
  for (let i = 0; i < GLYPH_H; i++) r.push(parseInt(hex.substr(i * 2, 2), 16));
  rowCache.set(ch, r);
  return r;
}

/** Width, in canvas units, of `text` drawn at the given pixel scale. */
export function measure(text, scale = 1, tracking = 1) {
  const n = String(text).length;
  if (n === 0) return 0;
  return (n * (GLYPH_W + tracking) - tracking) * scale;
}

/**
 * Draw pixel text.
 *
 *   scale     size of one font pixel, in canvas units
 *   color     fill colour — a string, or fn(col, row) => string for gradients
 *   align     'left' | 'center' | 'right'
 *   baseline  'top' | 'middle' | 'bottom'
 *   shadow    colour of a 1-pixel drop shadow, or null
 *   outline   colour of a full 8-way outline, or null
 *   tracking  gap between glyphs, in font pixels
 */
export function drawText(ctx, text, x, y, opts = {}) {
  const {
    scale = 3, color = '#fff', align = 'left', baseline = 'top',
    shadow = null, outline = null, tracking = 1, alpha = 1,
  } = opts;
  const str = String(text).toUpperCase();
  const w = measure(str, scale, tracking);
  const h = GLYPH_H * scale;

  let ox = x;
  if (align === 'center') ox = x - w / 2;
  else if (align === 'right') ox = x - w;
  let oy = y;
  if (baseline === 'middle') oy = y - h / 2;
  else if (baseline === 'bottom') oy = y - h;
  ox = Math.round(ox);
  oy = Math.round(oy);

  // Flatten the string into pixel cells once, then stamp it as many times as
  // the outline/shadow passes need.
  const cells = [];
  for (let i = 0; i < str.length; i++) {
    const r = rows(str[i]);
    const colBase = i * (GLYPH_W + tracking);
    for (let ry = 0; ry < GLYPH_H; ry++) {
      for (let rx = 0; rx < GLYPH_W; rx++) {
        if ((r[ry] >> (GLYPH_W - 1 - rx)) & 1) {
          cells.push([colBase * scale + rx * scale, ry * scale, colBase + rx, ry]);
        }
      }
    }
  }

  const prevAlpha = ctx.globalAlpha;
  if (alpha !== 1) ctx.globalAlpha = prevAlpha * alpha;

  const stamp = (dx, dy, fill) => {
    ctx.fillStyle = fill;
    for (const c of cells) ctx.fillRect(ox + c[0] + dx, oy + c[1] + dy, scale, scale);
  };

  if (outline) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (dx || dy) stamp(dx * scale, dy * scale, outline);
    }
  }
  if (shadow) stamp(scale, scale, shadow);

  if (typeof color === 'function') {
    for (const c of cells) {
      ctx.fillStyle = color(c[2], c[3]);
      ctx.fillRect(ox + c[0], oy + c[1], scale, scale);
    }
  } else {
    stamp(0, 0, color);
  }

  ctx.globalAlpha = prevAlpha;
  return { x: ox, y: oy, w, h };
}
