// RoGuPong — cloud league sync, the optional extra.
//
// The pass-along league reaches every phone that plays, or imports from, a
// phone that holds a match. Cloud sync closes the gaps between meetings: a
// small Worker (cloud/worker.js) keeps one copy of a league's records under a
// random league key, and each phone in the league sends it the matches it
// gains and fetches the ones it lacks whenever it is online. There are no
// accounts — the key is the league, and it spreads the way matches do: in
// 'hello' when two phones connect, and inside a shared league code.
//
// This phone's history stays the source of truth. The cloud only ever adds to
// it, through the same merge a connect uses, and with no internet — or no
// Worker at all — the game plays exactly as it did before.

import { b32encode } from '../net/sdp.js';
import * as lb from './leaderboard.js';

// Where the Worker answers (see cloud/README.md). Empty: this build has no
// cloud, and nothing offers it. A URL saved under OVERRIDE wins, for trying a
// Worker out before it goes in here.
const ENDPOINT = '';
const OVERRIDE = 'rogupong.cloud.endpoint';
const STORE = 'rogupong.cloud.v1';
// Records per request, each way — the Worker's page size.
const PAGE = 500;
// Enough rounds for a full phone to send all it holds and fetch a full league.
const MAX_ROUNDS = 40;
const TIMEOUT = 15000;

const KEY_RE = /^[A-Z2-7]{16}$/;
export const validKey = (key) => typeof key === 'string' && KEY_RE.test(key);

function endpoint() {
  let url = ENDPOINT;
  try { url = localStorage.getItem(OVERRIDE) || url; } catch { /* storage blocked */ }
  return url.replace(/\/+$/, '');
}

/** Whether this build knows a Worker to sync with. Without one, cloud sync never shows. */
export const cloudReady = () => !!endpoint();

/*
 * What this phone keeps: the league key; the cursor, the last row of the
 * league it has fetched; `out`, the ids of matches the league may not have
 * yet; `last`, how many the league held at the last sync; `at`, when that
 * sync finished; and `off`, set by leaving, which stops a friend's league
 * being joined automatically.
 */
const blank = () => ({ key: null, cursor: 0, out: [], last: null, at: 0, off: false });

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!s) return blank();
    return {
      key: validKey(s.key) ? s.key : null,
      cursor: Number.isInteger(s.cursor) && s.cursor >= 0 ? s.cursor : 0,
      out: Array.isArray(s.out) ? s.out.filter((id) => typeof id === 'string') : [],
      last: Number.isInteger(s.last) ? s.last : null,
      at: Number(s.at) || 0,
      off: !!s.off,
    };
  } catch {
    return blank();
  }
}

let state = load();
let running = null;          // the sync under way
let failure = null;          // why the last one failed, or null

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch { /* private mode, or a full quota */ }
}

// Another tab synced or joined meanwhile.
window.addEventListener('storage', (e) => {
  if (e.key === STORE || e.key === null) state = load();
});

let pending = null;
/** Called whenever there is something new to send. */
export const onPending = (fn) => { pending = fn; };

// Everything that lands here other than from the cloud is news to it.
lb.onNewMatches((ids, from) => {
  if (!state.key || from === 'cloud') return;
  const queued = new Set(state.out);
  for (const id of ids) if (!queued.has(id)) state.out.push(id);
  save();
  pending?.();
});

export const leagueKey = () => state.key;

/** For the leaderboard: which league, how fresh, what is waiting. */
export function cloudStatus() {
  return {
    key: state.key,
    tag: state.key ? state.key.slice(0, 4) : null,
    off: state.off,
    at: state.at,
    last: state.last,
    waiting: state.out.length,
    syncing: !!running,
    failure,
  };
}

/** Sync with this league from scratch: fetch all of it, send it everything here. */
export function joinLeague(key) {
  if (!validKey(key)) return;
  state = { ...blank(), key, out: lb.allMatches().map((r) => r.id) };
  failure = null;
  save();
}

/** A league of our own, under a fresh random key: 80 bits, nothing to guess. */
export function startLeague() {
  joinLeague(b32encode(crypto.getRandomValues(new Uint8Array(10))));
}

/** Stop syncing. The matches stay; the league just stops hearing from this phone. */
export function leaveLeague() {
  state = { ...blank(), off: true };
  failure = null;
  save();
}

async function post(key, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    // Sent as plain text, which a browser posts across origins without a
    // preflight: one round trip, not two.
    const res = await fetch(`${endpoint()}/league/${key}`, {
      method: 'POST', body: JSON.stringify(body), cache: 'no-store', signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`the server said ${res.status}`);
    const data = await res.json().catch(() => null);
    if (!Array.isArray(data?.recs) || !Number.isInteger(data.cursor)) throw new Error('an odd answer');
    return data;
  } catch (err) {
    if (ctl.signal.aborted) throw new Error('timed out');
    // What a browser throws for a request that never got an answer — worded
    // differently by each of them.
    throw err instanceof TypeError ? new Error('no connection') : err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send what the league lacks and fetch what this phone does, a page at a
 * time. What arrives is merged once at the end — one storage write — and only
 * then does the cursor move past it, so a sync cut short fetches the rest
 * next time. `stop` is asked between pages: true drops what was fetched,
 * unmerged, and leaves the cursor for next time — a match has started, and
 * a big storage write would stall a frame of it. Resolves
 * { up, down, added, failure }; never rejects.
 */
export function syncLeague(stop = () => false) {
  if (!running) running = runSync(stop).finally(() => { running = null; });
  return running;
}

async function runSync(stop) {
  const key = state.key;
  const result = { up: 0, down: 0, added: 0, failure: null };
  if (!key || !cloudReady()) return result;
  const got = [];
  let cursor = state.cursor;
  let behind = false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      if (round > 0 && stop()) return result;
      const have = new Map(lb.allMatches().map((r) => [r.id, r]));
      // Trimmed or cleared since they were queued: nothing left to send.
      state.out = state.out.filter((id) => have.has(id));
      // Behind the league, fetch first: what is sent meanwhile would only
      // come back in a later page.
      const batch = behind ? [] : state.out.slice(0, PAGE);
      const res = await post(key, { since: cursor, recs: batch.map((id) => have.get(id)) });
      if (state.key !== key) return result;           // left or switched meanwhile
      const sent = new Set(batch);
      state.out = state.out.filter((id) => !sent.has(id));
      // The league was lost or moved: it starts again from what the phones hold.
      if (res.reset) state.out = lb.allMatches().map((r) => r.id).filter((id) => !sent.has(id));
      got.push(...res.recs);
      cursor = res.cursor;
      state.last = Number.isInteger(res.last) ? res.last : state.last;
      behind = !!res.more;
      result.up += batch.length;
      save();
      if (!behind && !state.out.length) break;
    }
  } catch (err) {
    result.failure = err.message || 'failed';
  }
  if (state.key !== key || stop()) return result;
  result.down = got.length;
  result.added = got.length ? lb.mergeMatches(got, 'cloud') : 0;
  state.cursor = cursor;
  if (!result.failure) state.at = Date.now();
  failure = result.failure;
  save();
  return result;
}

/** One line for the diagnostics. Never the key: reports get pasted into public issues. */
export function describeCloud() {
  if (!cloudReady()) return 'not set up in this build';
  if (!state.key) return state.off ? 'off (left)' : 'off';
  const ago = state.at ? `${Math.round((Date.now() - state.at) / 60000)} min ago` : 'never';
  return [
    `in a league of ${state.last ?? '?'} matches`,
    `synced ${ago}`,
    `${state.out.length} waiting`,
    running ? 'syncing' : null,
    failure ? `last failure: ${failure}` : null,
  ].filter(Boolean).join(' · ');
}
