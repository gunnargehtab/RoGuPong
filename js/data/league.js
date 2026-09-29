// RoGuPong — match history in and out of a phone by hand.
//
// Phones swap their whole history whenever they connect, but friends don't
// always meet. Two ways out cover the rest:
//
//   League code   the whole history as one line of text for any chat app.
//                 Pasted into Import league on another phone it merges just
//                 like a connect does: a union, nothing replaced or removed.
//                 It carries the cloud league's key too, where there is one.
//   History CSV   the matches as a table, for a bug report or a balance
//                 discussion. Names become P1, P2… unless asked for.

import { b32encode, b32decode, deflate, inflate } from '../net/sdp.js';
import { allMatches, balanceOf } from './leaderboard.js';

const TAG = 'RGL';
const FORMAT = 1;
// One chat message's worth: WhatsApp takes 65,536 characters. A bigger history
// shares the newest matches that fit — a couple of thousand.
const MAX_CODE = 60000;

const canDeflate = () => typeof CompressionStream === 'function';

/**
 * Records as compact JSON: names, heroes and stages pooled into tables, each
 * match one array, its time the gap in seconds since the one before. Deflate
 * does the rest; the random ids are most of what is left.
 */
function pack(records, key) {
  const tables = { n: [], c: [], s: [] };
  const index = new Map();
  const ref = (t, v) => {
    const key = `${t}:${v}`;
    let i = index.get(key);
    if (i === undefined) {
      i = tables[t].length;
      tables[t].push(v);
      index.set(key, i);
    }
    return i;
  };
  let last = 0;
  const m = records.map((r) => {
    const at = Math.round((r.at || 0) / 1000);
    const [a, b] = r.players;
    const row = [
      r.id, at - last,
      ref('n', a.name), ref('c', a.char), ref('n', b.name), ref('c', b.char),
      r.score[0], r.score[1], r.winner, r.bestRally || 0,
      ref('s', r.stage || ''), r.target || 0, r.balance || 0,
      r.party == null ? null : r.party ? 1 : 0,
    ];
    last = at;
    return row;
  });
  // A field older builds never look for, so the format stays the same.
  return key ? { v: FORMAT, ...tables, m, k: key } : { v: FORMAT, ...tables, m };
}

/** Back to match records. Anything malformed is weeded out by mergeMatches. */
function unpack({ n, c, s, m }) {
  const pick = (table, i) => (Array.isArray(table) && typeof table[i] === 'string' ? table[i] : undefined);
  const out = [];
  let at = 0;
  for (const row of m) {
    if (!Array.isArray(row)) continue;
    const [id, gap, n0, c0, n1, c1, s0, s1, winner, bestRally, stage, target, balance, party] = row;
    at += Number(gap) || 0;
    const rec = {
      id,
      at: at * 1000,
      players: [{ name: pick(n, n0), char: pick(c, c0) }, { name: pick(n, n1), char: pick(c, c1) }],
      score: [s0, s1],
      winner,
      bestRally: Number(bestRally) || 0,
      stage: pick(s, stage) || undefined,
      target: Number(target) || 7,
    };
    if (Number.isInteger(balance) && balance > 0) rec.balance = balance;
    if (party === 0 || party === 1) rec.party = party === 1;
    out.push(rec);
  }
  return out;
}

async function encode(records, key) {
  const json = new TextEncoder().encode(JSON.stringify(pack(records, key)));
  const body = canDeflate() ? await deflate(json) : json;
  const bytes = new Uint8Array(body.length + 1);
  bytes[0] = canDeflate() ? 1 : 0;
  bytes.set(body, 1);
  // Base32, like the handshake codes: nothing a chat app will reformat, and
  // it survives being uppercased.
  return TAG + b32encode(bytes);
}

/**
 * The history as a league code: { code, count, total, key }. A history too
 * big for one chat message carries only its newest `count` matches. `key`,
 * the cloud league's, rides along for the phone that imports it.
 */
export async function leagueCode(records = allMatches(), key = null) {
  let count = records.length;
  let code = await encode(records, key);
  while (code.length > MAX_CODE && count > 0) {
    count = Math.floor(count * (MAX_CODE / code.length) * 0.97);
    code = await encode(records.slice(records.length - count), key);
  }
  return { code, count, total: records.length, key };
}

/** The text that gets shared: what it is, what to do with it, then the code. */
export function leagueMessage({ code, count, total, key }) {
  const what = count < total
    ? `the newest ${count} of ${total} matches`
    : `${count} match${count === 1 ? '' : 'es'}`;
  const cloud = key ? ' Importing it also joins you to the league\'s cloud sync.' : '';
  return `RoGuPong league: ${what}. To add them to yours, open RoGuPong, `
    + `go to Leaderboard → Import league and paste this whole message.${cloud}\n\n${code}`;
}

/** The league code inside whatever was pasted — the bare code or the whole message. */
export function findLeagueCode(text) {
  const found = String(text).toUpperCase().replace(/\s+/g, '').match(/RGL[A-Z2-7]{8,}/g);
  return found ? found.reduce((a, b) => (b.length > a.length ? b : a)) : null;
}

/**
 * A league code back to { records, key }: match records ready for
 * mergeMatches, and the cloud league's key if it carries one (unchecked).
 * Throws on a bad code.
 */
export async function readLeague(code) {
  const bytes = b32decode(code.slice(TAG.length));
  if (bytes[0] === 1 && typeof DecompressionStream !== 'function') throw new Error('this browser can\'t unpack it');
  let data;
  try {
    if (bytes[0] !== 0 && bytes[0] !== 1) throw new Error('unknown packing');
    const body = bytes[0] === 1 ? await inflate(bytes.subarray(1)) : bytes.subarray(1);
    data = JSON.parse(new TextDecoder().decode(body));
  } catch {
    // Most often a code cut short on its way through a chat app.
    throw new Error('it looks damaged or cut short');
  }
  if (data?.v > FORMAT) throw new Error('it comes from a newer RoGuPong — reload to update');
  if (data?.v !== FORMAT || !Array.isArray(data.m)) throw new Error('it looks damaged or cut short');
  return { records: unpack(data), key: typeof data.k === 'string' ? data.k : null };
}

const csvField = (v) => {
  const s = String(v ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const pad = (n) => String(n).padStart(2, '0');
const day = (ms) => {
  const d = new Date(ms || 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * The history as CSV, oldest first. Names become P1, P2… in order of first
 * appearance unless `names` is set, since it is meant for pasting into a
 * public issue. Ids are cut to eight characters — still enough to match up
 * the copies from two phones.
 */
export function historyCsv({ names = false } = {}) {
  const alias = new Map();
  const who = (name) => {
    if (names) return name;
    if (!alias.has(name)) alias.set(name, `P${alias.size + 1}`);
    return alias.get(name);
  };
  const rows = allMatches().map((r) => [
    r.id.slice(0, 8), day(r.at), balanceOf(r), r.party == null ? '' : r.party ? 'party' : 'classic',
    r.stage, r.target,
    who(r.players[0].name), r.players[0].char, who(r.players[1].name), r.players[1].char,
    r.score[0], r.score[1], r.winner + 1, r.bestRally || 0,
  ].map(csvField).join(','));
  return ['id,date,balance,mode,stage,target,player1,hero1,player2,hero2,score1,score2,winner,rally', ...rows]
    .join('\n');
}
