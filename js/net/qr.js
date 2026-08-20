// RoGuPong — a self-contained QR Code encoder (ISO/IEC 18004).
//
// The two phones hand each other their WebRTC handshake by showing a QR code
// on screen and scanning it with the camera. No server, no CDN, no library:
// this file is the whole encoder.
//
// Supports numeric, alphanumeric and byte segments, versions 1-40 and all four
// error-correction levels, with automatic mask selection.

const ECC = { L: 0, M: 1, Q: 2, H: 3 };
const ECC_FORMAT_BITS = { 0: 1, 1: 0, 2: 3, 3: 2 };   // L=01, M=00, Q=11, H=10

// Error-correction codewords per block, indexed [level][version].
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

// Number of error-correction blocks, indexed [level][version].
const NUM_ECC_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/* ------------------------------------------------------------------ */
/* Galois field GF(256) with the QR primitive polynomial x^8+x^4+x^3+x^2+1 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initGf() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a] + LOG[b]];
}

function rsGeneratorPoly(degree) {
  const poly = new Uint8Array(degree);
  poly[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      poly[j] = gfMul(poly[j], root);
      if (j + 1 < degree) poly[j] ^= poly[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return poly;
}

function rsRemainder(data, generator) {
  const degree = generator.length;
  const result = new Uint8Array(degree);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i++) result[i] ^= gfMul(generator[i], factor);
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Bit buffer + segments                                              */

class BitBuffer {
  constructor() { this.bits = []; }
  append(val, len) {
    for (let i = len - 1; i >= 0; i--) this.bits.push((val >>> i) & 1);
  }
  get length() { return this.bits.length; }
}

function isNumeric(s) { return /^[0-9]*$/.test(s); }
function isAlnum(s) { for (const c of s) if (ALNUM.indexOf(c) < 0) return false; return true; }

function charCountBits(mode, version) {
  const i = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  if (mode === 'numeric') return [10, 12, 14][i];
  if (mode === 'alnum') return [9, 11, 13][i];
  return [8, 16, 16][i];
}

function segmentBitLength(mode, text, version) {
  const ccb = charCountBits(mode, version);
  if (mode === 'numeric') {
    const n = text.length;
    return 4 + ccb + 10 * Math.floor(n / 3) + [0, 4, 7][n % 3];
  }
  if (mode === 'alnum') {
    const n = text.length;
    return 4 + ccb + 11 * Math.floor(n / 2) + (n % 2) * 6;
  }
  return 4 + ccb + utf8(text).length * 8;
}

function utf8(text) {
  return Array.from(new TextEncoder().encode(text));
}

function writeSegment(bb, mode, text, version) {
  const ccb = charCountBits(mode, version);
  if (mode === 'numeric') {
    bb.append(1, 4);
    bb.append(text.length, ccb);
    let i = 0;
    for (; i + 3 <= text.length; i += 3) bb.append(parseInt(text.substr(i, 3), 10), 10);
    const rem = text.length - i;
    if (rem > 0) bb.append(parseInt(text.substr(i), 10), rem * 3 + 1);
  } else if (mode === 'alnum') {
    bb.append(2, 4);
    bb.append(text.length, ccb);
    let i = 0;
    for (; i + 2 <= text.length; i += 2) {
      bb.append(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
    }
    if (i < text.length) bb.append(ALNUM.indexOf(text[i]), 6);
  } else {
    const bytes = utf8(text);
    bb.append(4, 4);
    bb.append(bytes.length, ccb);
    for (const b of bytes) bb.append(b, 8);
  }
}

/* ------------------------------------------------------------------ */
/* Version geometry                                                   */

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver, ecl) {
  return Math.floor(numRawDataModules(ver) / 8)
    - ECC_CODEWORDS_PER_BLOCK[ecl][ver] * NUM_ECC_BLOCKS[ecl][ver];
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/* ------------------------------------------------------------------ */
/* The code itself                                                    */

class QrCode {
  constructor(version, ecl, dataCodewords, forcedMask = -1) {
    this.version = version;
    this.ecl = ecl;
    this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (let y = 0; y < this.size; y++) {
      this.modules.push(new Uint8Array(this.size));
      this.isFunction.push(new Uint8Array(this.size));
    }
    this.drawFunctionPatterns();
    this.drawCodewords(this.addEccAndInterleave(dataCodewords));

    let mask = forcedMask;
    if (mask < 0) {
      let best = Infinity;
      for (let m = 0; m < 8; m++) {
        this.applyMask(m);
        this.drawFormatBits(m);
        const p = this.penaltyScore();
        if (p < best) { best = p; mask = m; }
        this.applyMask(m);   // XOR is its own inverse
      }
    }
    this.mask = mask;
    this.applyMask(mask);
    this.drawFormatBits(mask);
  }

  get(x, y) { return this.modules[y][x] === 1; }

  setFunction(x, y, dark) {
    this.modules[y][x] = dark ? 1 : 0;
    this.isFunction[y][x] = 1;
  }

  drawFunctionPatterns() {
    const size = this.size;
    for (let i = 0; i < size; i++) {
      this.setFunction(6, i, i % 2 === 0);
      this.setFunction(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(size - 4, 3);
    this.drawFinder(3, size - 4);

    const align = alignmentPositions(this.version);
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1)
          || (i === align.length - 1 && j === 0);
        if (!corner) this.drawAlignment(align[i], align[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  }

  drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx, y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) {
          this.setFunction(x, y, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  drawFormatBits(mask) {
    const data = (ECC_FORMAT_BITS[this.ecl] << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.setFunction(8, i, bit(i));
    this.setFunction(8, 7, bit(6));
    this.setFunction(8, 8, bit(7));
    this.setFunction(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFunction(14 - i, 8, bit(i));

    const size = this.size;
    for (let i = 0; i < 8; i++) this.setFunction(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFunction(8, size - 15 + i, bit(i));
    this.setFunction(8, size - 8, true);   // always-dark module
  }

  drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunction(a, b, dark);
      this.setFunction(b, a, dark);
    }
  }

  addEccAndInterleave(data) {
    const ver = this.version, ecl = this.ecl;
    const numBlocks = NUM_ECC_BLOCKS[ecl][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    const blocks = [];
    const gen = rsGeneratorPoly(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const dat = data.slice(k, k + len);
      k += len;
      const ecc = rsRemainder(dat, gen);
      blocks.push({ dat, ecc });
    }

    const result = [];
    for (let i = 0; i < shortBlockLen - blockEccLen + 1; i++) {
      for (let j = 0; j < numBlocks; j++) {
        if (i < blocks[j].dat.length) result.push(blocks[j].dat[i]);
      }
    }
    for (let i = 0; i < blockEccLen; i++) {
      for (let j = 0; j < numBlocks; j++) result.push(blocks[j].ecc[i]);
    }
    return result;
  }

  drawCodewords(data) {
    let i = 0;   // bit index
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = (data[i >>> 3] >>> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = x * y % 2 + x * y % 3 === 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
          default: throw new Error('bad mask');
        }
        if (invert) this.modules[y][x] ^= 1;
      }
    }
  }

  penaltyScore() {
    const size = this.size;
    let result = 0;
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;

    const finderPenalty = (runHistory) => {
      const n = runHistory[1];
      const core = n > 0 && runHistory[2] === n && runHistory[3] === n * 3
        && runHistory[4] === n && runHistory[5] === n;
      return (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 1 : 0)
        + (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 1 : 0);
    };

    for (const horizontal of [true, false]) {
      for (let i = 0; i < size; i++) {
        let runColor = false, runLen = 0;
        const hist = [0, 0, 0, 0, 0, 0, 0];
        const pushRun = (len) => { hist.pop(); hist.unshift(len); };
        for (let j = 0; j < size; j++) {
          const dark = horizontal ? this.get(j, i) : this.get(i, j);
          if (dark === runColor) {
            runLen++;
            if (runLen === 5) result += N1;
            else if (runLen > 5) result++;
          } else {
            pushRun(runLen === 0 && j === 0 ? size : runLen);
            if (!runColor) result += finderPenalty(hist) * N3;
            runColor = dark;
            runLen = 1;
          }
        }
        // terminate the line: pad with the light run that surrounds the symbol
        pushRun(runLen);
        if (runColor) pushRun(0);
        pushRun(size);
        result += finderPenalty(hist) * N3;
      }
    }

    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = this.get(x, y);
        if (c === this.get(x + 1, y) && c === this.get(x, y + 1) && c === this.get(x + 1, y + 1)) {
          result += N2;
        }
      }
    }

    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (this.get(x, y)) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * N4;
    return result;
  }
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */

/**
 * Encode `text` into a QR symbol.
 * Returns { size, get(x,y), version, mask, ecl }.
 */
export function encodeQr(text, { ecl = 'M', minVersion = 1, maxVersion = 40 } = {}) {
  const level = ECC[ecl];
  const mode = isNumeric(text) ? 'numeric' : isAlnum(text) ? 'alnum' : 'byte';

  let version = -1;
  let dataCapacityBits = 0;
  for (let v = minVersion; v <= maxVersion; v++) {
    const cap = numDataCodewords(v, level) * 8;
    if (segmentBitLength(mode, text, v) <= cap) { version = v; dataCapacityBits = cap; break; }
  }
  if (version < 0) throw new Error('QR: payload too large (' + text.length + ' chars)');

  const bb = new BitBuffer();
  writeSegment(bb, mode, text, version);
  const bits = bb.bits;
  for (let i = 0; i < 4 && bits.length < dataCapacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }
  for (let pad = 0xec; codewords.length < dataCapacityBits / 8; pad ^= 0xec ^ 0x11) codewords.push(pad);

  const qr = new QrCode(version, level, codewords);
  return {
    size: qr.size,
    version: qr.version,
    mask: qr.mask,
    mode,
    ecl,
    get: (x, y) => qr.get(x, y),
  };
}

/**
 * Draw a QR symbol into a canvas, sized to fit `pxSize` device-independent
 * pixels, including a 4-module quiet zone. Light modules are drawn opaque so
 * the code stays scannable over any background.
 */
export function drawQrToCanvas(canvas, text, pxSize, opts = {}) {
  const { dark = '#120a1c', light = '#ffffff', quiet = 4, ecl = 'M' } = opts;
  const qr = encodeQr(text, { ecl });
  const total = qr.size + quiet * 2;
  const scale = Math.max(1, Math.floor(pxSize / total));
  const dim = total * scale;

  canvas.width = dim;
  canvas.height = dim;
  canvas.style.width = dim + 'px';
  canvas.style.height = dim + 'px';

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, dim, dim);
  ctx.fillStyle = dark;
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.get(x, y)) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
  }
  return qr;
}
