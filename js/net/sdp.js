// RoGuPong — squeezing a WebRTC handshake into something you can point a
// camera at.
//
// A raw Chrome SDP offer is ~1.2 KB of text, which makes a QR code far too
// dense to scan off a phone screen. Almost all of it is boilerplate that is
// identical on both ends, though: the only things that actually differ are the
// ICE credentials, the DTLS fingerprint and the candidate list. We extract
// those (~100 bytes), Base32 them into the QR "alphanumeric" charset — which
// packs at 5.5 bits per character instead of 8 — and rebuild the full SDP from
// a template on the far side.
//
// If anything about that round-trip looks wrong we fall back to shipping the
// whole SDP, deflate-compressed. Bigger code, same result.

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const TAG_COMPACT = 'RGP';
export const TAG_FULL = 'RGX';

function b32encode(bytes) {
  let out = '', buf = 0, bits = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(buf >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(buf << (5 - bits)) & 31];
  return out;
}

function b32decode(str) {
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of str) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('bad character in code: ' + ch);
    buf = (buf << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((buf >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/* ------------------------------------------------------------------ */

class Writer {
  constructor() { this.b = []; }
  u8(v) { this.b.push(v & 0xff); }
  u16(v) { this.b.push((v >>> 8) & 0xff, v & 0xff); }
  bytes(arr) { for (const v of arr) this.b.push(v & 0xff); }
  str(s) {
    const e = new TextEncoder().encode(s);
    this.u8(e.length);
    this.bytes(e);
  }
  done() { return Uint8Array.from(this.b); }
}

class Reader {
  constructor(bytes) { this.b = bytes; this.i = 0; }
  u8() { return this.b[this.i++]; }
  u16() { const v = (this.b[this.i] << 8) | this.b[this.i + 1]; this.i += 2; return v; }
  bytes(n) { const v = this.b.slice(this.i, this.i + n); this.i += n; return v; }
  str() { return new TextDecoder().decode(this.bytes(this.u8())); }
}

const hexToBytes = (hex) => {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
};
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/* ------------------------------------------------------------------ */
/* Candidates                                                          */

const CAND = { HOST_V4: 0, HOST_MDNS: 1, SRFLX_V4: 2, HOST_V6: 3, SRFLX_V6: 4 };
const MDNS_RE = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

function ipv4ToBytes(ip) {
  const p = ip.split('.').map(Number);
  return (p.length === 4 && p.every((n) => Number.isInteger(n) && n >= 0 && n < 256)) ? p : null;
}

function ipv6ToBytes(ip) {
  // Enough of RFC 4291 to round-trip what an ICE agent hands us.
  if (ip.indexOf(':') < 0) return null;
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const parse = (s) => (s ? s.split(':').filter(Boolean).map((h) => parseInt(h, 16)) : []);
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const groups = halves.length === 2
    ? [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail]
    : head;
  if (groups.length !== 8 || groups.some((g) => !Number.isFinite(g))) return null;
  const out = new Uint8Array(16);
  groups.forEach((g, i) => { out[i * 2] = g >>> 8; out[i * 2 + 1] = g & 0xff; });
  return out;
}

function bytesToIpv6(b) {
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(((b[i] << 8) | b[i + 1]).toString(16));
  return groups.join(':');
}

function packCandidate(w, c) {
  const { address, port, type } = c;
  const mdns = MDNS_RE.exec(address);
  if (mdns && type === 'host') {
    w.u8(CAND.HOST_MDNS);
    w.u16(port);
    w.bytes(hexToBytes(address.slice(0, 36).replace(/-/g, '')));
    return true;
  }
  const v4 = ipv4ToBytes(address);
  if (v4) {
    w.u8(type === 'srflx' ? CAND.SRFLX_V4 : CAND.HOST_V4);
    w.u16(port);
    w.bytes(v4);
    return true;
  }
  const v6 = ipv6ToBytes(address);
  if (v6) {
    w.u8(type === 'srflx' ? CAND.SRFLX_V6 : CAND.HOST_V6);
    w.u16(port);
    w.bytes(v6);
    return true;
  }
  return false;
}

function unpackCandidate(r, index) {
  const kind = r.u8();
  const port = r.u16();
  let address, type;
  switch (kind) {
    case CAND.HOST_MDNS: {
      const h = bytesToHex(r.bytes(16));
      address = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}.local`;
      type = 'host';
      break;
    }
    case CAND.HOST_V4: address = Array.from(r.bytes(4)).join('.'); type = 'host'; break;
    case CAND.SRFLX_V4: address = Array.from(r.bytes(4)).join('.'); type = 'srflx'; break;
    case CAND.HOST_V6: address = bytesToIpv6(r.bytes(16)); type = 'host'; break;
    case CAND.SRFLX_V6: address = bytesToIpv6(r.bytes(16)); type = 'srflx'; break;
    default: throw new Error('unknown candidate kind ' + kind);
  }
  const priority = type === 'host' ? 2122260223 - index : 1686052607 - index;
  const tail = type === 'srflx' ? ' raddr 0.0.0.0 rport 0' : '';
  return `a=candidate:${index + 1} 1 udp ${priority} ${address} ${port} typ ${type}${tail} generation 0`;
}

/* ------------------------------------------------------------------ */
/* SDP <-> compact bytes                                               */

function field(sdp, re) {
  const m = re.exec(sdp);
  return m ? m[1] : null;
}

/** Pull the handful of unique values out of a datachannel-only SDP. */
export function dissect(sdp) {
  const ufrag = field(sdp, /^a=ice-ufrag:(\S+)/m);
  const pwd = field(sdp, /^a=ice-pwd:(\S+)/m);
  const fp = field(sdp, /^a=fingerprint:sha-256 (\S+)/mi);
  if (!ufrag || !pwd || !fp) throw new Error('SDP is missing ICE credentials');

  const candidates = [];
  const seen = new Set();
  const re = /^a=candidate:(\S+) (\d+) (\S+) (\d+) (\S+) (\d+) typ (\S+)/gmi;
  let m;
  while ((m = re.exec(sdp))) {
    const [, , component, transport, , address, port, type] = m;
    if (component !== '1') continue;                       // RTP component only
    if (transport.toLowerCase() !== 'udp') continue;       // TCP candidates are useless here
    if (type !== 'host' && type !== 'srflx') continue;
    const key = address + ':' + port;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ address, port: parseInt(port, 10), type });
  }
  return { ufrag, pwd, fingerprint: fp, candidates };
}

const FMT_VERSION = 1;

function packCompact(sdp, role) {
  const { ufrag, pwd, fingerprint, candidates } = dissect(sdp);
  const fpBytes = hexToBytes(fingerprint.replace(/:/g, ''));
  if (fpBytes.length !== 32) throw new Error('unexpected fingerprint length');

  const w = new Writer();
  w.u8(FMT_VERSION | (role === 'answer' ? 0x80 : 0));
  w.str(ufrag);
  w.str(pwd);
  w.bytes(fpBytes);

  // Local candidates first — on the same WiFi those are the ones that connect.
  const ordered = [...candidates].sort((a, b) => (a.type === b.type ? 0 : a.type === 'host' ? -1 : 1));
  const packed = [];
  const probe = new Writer();
  for (const c of ordered) {
    if (packed.length >= 6) break;
    const before = probe.b.length;
    if (packCandidate(probe, c)) packed.push(c);
    else probe.b.length = before;
  }
  w.u8(packed.length);
  w.bytes(probe.b);
  return TAG_COMPACT + b32encode(w.done());
}

const SDP_HEAD = [
  'v=0',
  'o=- 1234567890123456789 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
];

function unpackCompact(code) {
  const r = new Reader(b32decode(code.slice(TAG_COMPACT.length)));
  const head = r.u8();
  if ((head & 0x7f) !== FMT_VERSION) throw new Error('this code came from a different version of RoGuPong');
  const role = (head & 0x80) ? 'answer' : 'offer';
  const ufrag = r.str();
  const pwd = r.str();
  const fingerprint = bytesToHex(r.bytes(32)).toUpperCase().replace(/(..)(?=.)/g, '$1:');
  const n = r.u8();
  const cands = [];
  for (let i = 0; i < n; i++) cands.push(unpackCandidate(r, i));

  const lines = [
    ...SDP_HEAD,
    `a=ice-ufrag:${ufrag}`,
    `a=ice-pwd:${pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${fingerprint}`,
    `a=setup:${role === 'offer' ? 'actpass' : 'active'}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    ...cands,
    'a=end-of-candidates',
  ];
  return { role, sdp: lines.join('\r\n') + '\r\n' };
}

/* ------------------------------------------------------------------ */
/* Full-SDP fallback                                                   */

async function deflate(bytes) {
  const cs = new CompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(buf);
}

async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(buf);
}

async function packFull(sdp, role) {
  const raw = new TextEncoder().encode((role === 'answer' ? 'A' : 'O') + sdp);
  const body = typeof CompressionStream === 'function' ? await deflate(raw) : raw;
  const flag = new Uint8Array(1 + body.length);
  flag[0] = typeof CompressionStream === 'function' ? 1 : 0;
  flag.set(body, 1);
  // Base32 keeps the payload inside the QR alphanumeric charset.
  return TAG_FULL + b32encode(flag);
}

async function unpackFull(code) {
  const bytes = b32decode(code.slice(TAG_FULL.length));
  const body = bytes.slice(1);
  const raw = bytes[0] === 1 ? await inflate(body) : body;
  const text = new TextDecoder().decode(raw);
  return { role: text[0] === 'A' ? 'answer' : 'offer', sdp: text.slice(1) };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */

/**
 * Turn a local description into a scannable/typable code. Tries the compact
 * encoding first and verifies it round-trips before trusting it.
 */
export async function packSignal(sdp, role) {
  try {
    const code = packCompact(sdp, role);
    const back = unpackCompact(code);
    const mine = dissect(sdp);
    const theirs = dissect(back.sdp);
    const ok = back.role === role
      && theirs.ufrag === mine.ufrag
      && theirs.pwd === mine.pwd
      && theirs.fingerprint.toUpperCase() === mine.fingerprint.toUpperCase()
      && theirs.candidates.length > 0;
    if (ok) return code;
  } catch (err) {
    console.warn('[sdp] compact encoding unavailable, sending the full description:', err.message);
  }
  return packFull(sdp, role);
}

/**
 * Pull a signalling code out of whatever the user gave us: the bare code, a
 * code with spaces in it, or the full invite link an iPhone's camera hands over.
 */
export function extractCode(input) {
  const text = String(input).trim();
  const fromLink = /[#?&]j=([A-Za-z2-7]+)/.exec(text);
  const candidate = fromLink ? fromLink[1] : text;
  return candidate.toUpperCase().replace(/[\s-]/g, '');
}

/** Turn a scanned/pasted code back into { role, sdp }. */
export async function unpackSignal(code) {
  const clean = extractCode(code);
  if (clean.startsWith(TAG_COMPACT)) return unpackCompact(clean);
  if (clean.startsWith(TAG_FULL)) return unpackFull(clean);
  throw new Error("that doesn't look like a RoGuPong code");
}

/**
 * The invite as a link.
 *
 * iOS has read QR codes in the Camera app since iOS 11, but only offers to open
 * one when it contains a URL — and no browser on iOS exposes a QR API to the
 * page. Encoding the invite as a link therefore turns "iPhones cannot join"
 * into "point the Camera at it and tap the banner", using whatever scanner the
 * phone already has. It costs a denser QR (37x37 to 49x49) and nothing else.
 */
export function inviteLink(code) {
  const base = location.origin + location.pathname;
  return base + '#j=' + code;
}

/** Group a code into 4-character blocks so a human can read it out loud. */
export function prettyCode(code) {
  return code.replace(/(.{4})/g, '$1 ').trim();
}
