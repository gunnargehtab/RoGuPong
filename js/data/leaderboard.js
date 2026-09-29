// RoGuPong — the leaderboard.
//
// There is no server to keep score, so each phone keeps its own record of
// every match it played and the two handsets merge their histories whenever
// they connect. Match records are immutable and carry a unique id, so merging
// is just a union — no conflicts, no clock to argue about, and both friends
// end up looking at exactly the same table. Every phone passes on everything
// it holds, matches between other friends included, so a group that mixes
// partners converges on one league. Cloud sync (cloud.js), where a group turns
// it on, is one more way in for the same records; the phone's own copy stays
// the one the tables are read from.

const KEY = 'rogupong.matches.v1';
const PROFILE_KEY = 'rogupong.profile.v1';
// About 600 KB of storage at the cap: years of evenings for a group of
// friends, and far inside what any browser allows a page.
const MAX_RECORDS = 3000;

// What the game calls a player who never typed a name. Every nameless player
// shares them, so the leaderboard can't tell those players apart.
const STAND_INS = ['YOU', 'FRIEND', 'HOST', 'GUEST'];
export const isStandInName = (name) => !name || STAND_INS.includes(name);

// The parsed history, kept in memory: at a few thousand records it is too big
// to parse again every time a screen asks for standings or flair. Another tab
// writing the same storage throws it away ('storage' only fires in the others).
let cache = null;
let revision = 0;
window.addEventListener('storage', (e) => {
  if (e.key === KEY || e.key === null) { cache = null; revision++; }
});

function read() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(list) ? list : [];
  } catch {
    cache = [];
  }
  return cache;
}

function write(list) {
  cache = list.length > MAX_RECORDS ? list.slice(-MAX_RECORDS) : list;
  revision++;
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode, or a full quota — the game still plays */
  }
}

/** Changes whenever the history does, so a copy made from it can tell it is stale. */
export const historyRevision = () => revision;

// Told the ids of matches as they land on this phone, and where they came
// from — cloud sync queues everything that didn't come from the cloud.
const arrivals = [];
export const onNewMatches = (fn) => arrivals.push(fn);
const announce = (ids, from) => { for (const fn of arrivals) fn(ids, from); };

/**
 * Cosmetic flair, earned by playing. Unlocks are COMPUTED from the match
 * history every time they are asked for — nothing is written when a milestone
 * is reached, so records stay immutable and the merge stays conflict-free.
 * Losing your phone loses nothing the shared history can't re-earn you.
 */
export const FLAIRS = [
  { id: 'none', name: 'STANDARD', hint: 'The classic look — always yours' },
  { id: 'rainbow', name: 'RAINBOW', hint: 'Reach a 20-hit rally' },
  { id: 'flame', name: 'FLAME', hint: 'Win ten matches' },
  { id: 'star', name: 'STARLIGHT', hint: 'Play on all four stages' },
  { id: 'royal', name: 'ROYAL', hint: 'Win a match without conceding a point' },
];

export const flairById = (id) => FLAIRS.find((f) => f.id === id) || FLAIRS[0];

/** My milestone stats and which flairs they unlock. Names match exactly, like standings(). */
export function flairProgress(profile) {
  const me = profile.name || 'YOU';
  let wins = 0;
  let bestRally = 0;
  let shutouts = 0;
  const stages = new Set();
  for (const rec of read()) {
    const idx = rec.players.findIndex((p) => p?.name === me);
    if (idx === -1) continue;
    bestRally = Math.max(bestRally, rec.bestRally || 0);
    stages.add(rec.stage);
    if (rec.winner === idx) {
      wins++;
      if ((rec.score?.[1 - idx] ?? 1) === 0) shutouts++;
    }
  }
  return {
    stats: { wins, bestRally, stages: stages.size, shutouts },
    unlocked: {
      none: true,
      rainbow: bestRally >= 20,
      flame: wins >= 10,
      star: stages.size >= 4,
      royal: shutouts >= 1,
    },
  };
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return {
      name: p?.name || '',
      char: p?.char || 'ro',
      flair: FLAIRS.some((f) => f.id === p?.flair) ? p.flair : 'none',
      music: p?.music !== false,
      sfx: p?.sfx !== false,
      // Only a Graphics choice made by hand is kept. Older builds also saved
      // the frame-rate watcher's automatic switch — which on an iPhone in Low
      // Power Mode fired at the 30 fps cap — so an unmarked 'low' is let go
      // and the watcher takes a fresh look.
      quality: p?.quality === 'low' && p?.qualityChosen ? 'low' : 'high',
      qualityChosen: !!p?.qualityChosen,
      // Has fired a special by tapping the paddle (or a key): no more hint.
      tapLearned: !!p?.tapLearned,
    };
  } catch {
    return {
      name: '', char: 'ro', flair: 'none', music: true, sfx: true, quality: 'high', qualityChosen: false,
      tapLearned: false,
    };
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch { /* ignore */ }
}

export function allMatches() {
  return read();
}

function matchId(rec) {
  return rec.id;
}

/** Record a finished match. Returns the stored record. */
export function recordMatch(rec) {
  const list = read();
  if (!list.some((r) => matchId(r) === matchId(rec))) {
    list.push(rec);
    write(list);
    announce([rec.id], 'match');
  }
  return rec;
}

const isScore = (v) => Number.isInteger(v) && v >= 0 && v < 1000;

/**
 * Whether a record from elsewhere — another phone, a pasted league code — has
 * everything the tables read. A broken one would break them for everybody it
 * is passed on to.
 */
function sane(rec) {
  return !!rec && typeof rec.id === 'string' && rec.id.length > 0 && rec.id.length <= 32
    && Array.isArray(rec.players) && rec.players.length === 2
    && rec.players.every((p) => typeof p?.name === 'string' && p.name.length > 0 && p.name.length <= 16
      && typeof p.char === 'string')
    && Array.isArray(rec.score) && rec.score.length === 2 && rec.score.every(isScore)
    && (rec.winner === 0 || rec.winner === 1);
}

/**
 * Union of local history with records from elsewhere, keeping ours
 * authoritative on ties. `from` says where they came from ('peer', 'import'
 * or 'cloud'). Returns how many new matches it kept.
 */
export function mergeMatches(incoming, from = 'peer') {
  if (!Array.isArray(incoming)) return 0;
  const list = read();
  const seen = new Set(list.map(matchId));
  let fresh = [];
  for (const rec of incoming) {
    if (!sane(rec) || seen.has(rec.id)) continue;
    seen.add(rec.id);
    list.push(rec);
    fresh.push(rec.id);
  }
  if (!fresh.length) return 0;
  list.sort((a, b) => (a.at || 0) - (b.at || 0));
  write(list);
  // Past the cap the oldest fall off again, and a match that came in only to
  // be trimmed is no news — otherwise a full phone would announce the same
  // old matches on every connect.
  if (list.length > MAX_RECORDS) {
    const kept = new Set(read().map(matchId));
    fresh = fresh.filter((id) => kept.has(id));
  }
  if (fresh.length) announce(fresh, from);
  return fresh.length;
}

/** Aggregate standings, one row per player name. */
export function standings() {
  const rows = new Map();
  const row = (name) => {
    if (!rows.has(name)) {
      rows.set(name, {
        name, played: 0, won: 0, lost: 0, pointsFor: 0, pointsAgainst: 0,
        bestRally: 0, streak: 0, bestStreak: 0, favourite: {},
      });
    }
    return rows.get(name);
  };

  for (const rec of read()) {
    const [a, b] = rec.players;
    if (!a?.name || !b?.name) continue;
    const ra = row(a.name);
    const rb = row(b.name);
    ra.played++; rb.played++;
    ra.pointsFor += rec.score[0]; ra.pointsAgainst += rec.score[1];
    rb.pointsFor += rec.score[1]; rb.pointsAgainst += rec.score[0];
    ra.bestRally = Math.max(ra.bestRally, rec.bestRally || 0);
    rb.bestRally = Math.max(rb.bestRally, rec.bestRally || 0);
    ra.favourite[a.char] = (ra.favourite[a.char] || 0) + 1;
    rb.favourite[b.char] = (rb.favourite[b.char] || 0) + 1;
    const winner = rec.winner === 0 ? ra : rb;
    const loser = rec.winner === 0 ? rb : ra;
    winner.won++;
    loser.lost++;
    winner.streak = Math.max(1, winner.streak + 1);
    winner.bestStreak = Math.max(winner.bestStreak, winner.streak);
    loser.streak = 0;
  }

  return [...rows.values()]
    .map((r) => ({
      ...r,
      winRate: r.played ? r.won / r.played : 0,
      diff: r.pointsFor - r.pointsAgainst,
      topChar: Object.entries(r.favourite).sort((x, y) => y[1] - x[1])[0]?.[0] || null,
    }))
    .sort((a, b) => b.won - a.won || b.winRate - a.winRate || b.diff - a.diff || a.name.localeCompare(b.name));
}

/** The last few matches, newest first. */
export function recentMatches(n = 12) {
  return read().slice(-n).reverse();
}

/** Head-to-head between two names. */
export function headToHead(nameA, nameB) {
  let a = 0, b = 0;
  for (const rec of read()) {
    const names = rec.players.map((p) => p.name);
    if (!names.includes(nameA) || !names.includes(nameB)) continue;
    const winner = rec.players[rec.winner]?.name;
    if (winner === nameA) a++;
    else if (winner === nameB) b++;
  }
  return { a, b, total: a + b };
}

// A hero's rates show from this many matches; below it they are noise.
export const HERO_MIN = 5;
// And it is only called strong or weak from this many, when the numbers agree.
const VERDICT_MIN = 10;

const tally = () => ({ played: 0, won: 0, pointsFor: 0, pointsAgainst: 0 });

function addResult(row, won, pf, pa) {
  row.played++;
  if (won) row.won++;
  row.pointsFor += pf;
  row.pointsAgainst += pa;
}

/** The balance version a record was played at. Records from before the field are version 1. */
export const balanceOf = (rec) => rec.balance || 1;

/** Every balance version the history holds, oldest first. */
export function balancesSeen() {
  return [...new Set(read().map(balanceOf))].sort((a, b) => a - b);
}

/**
 * Results per hero, keyed by hero id, each with the same split by player —
 * between two friends a hero's record is also the record of whoever keeps
 * picking it. Mirror matches say nothing about which hero is stronger and are
 * left out. `balance` limits it to matches played at that balance version.
 */
export function heroStats(balance = null) {
  const heroes = new Map();
  for (const rec of read()) {
    if (balance != null && balanceOf(rec) !== balance) continue;
    const [a, b] = rec.players;
    if (!a?.char || !b?.char || a.char === b.char) continue;
    rec.players.forEach((p, i) => {
      if (!heroes.has(p.char)) heroes.set(p.char, { id: p.char, ...tally(), players: new Map() });
      const hero = heroes.get(p.char);
      if (!hero.players.has(p.name)) hero.players.set(p.name, { name: p.name, ...tally() });
      const won = rec.winner === i;
      addResult(hero, won, rec.score[i], rec.score[1 - i]);
      addResult(hero.players.get(p.name), won, rec.score[i], rec.score[1 - i]);
    });
  }
  return heroes;
}

/**
 * 'strong', 'weak', 'early' (too early to tell) or null (too few to say even
 * that). A hero is only called strong or weak once the 95% Wilson interval
 * around its win rate clears 50% — so 8–4 is still too early, 15–5 is not.
 */
export function heroVerdict(won, played) {
  if (played < HERO_MIN) return null;
  if (played < VERDICT_MIN) return 'early';
  const z2 = 1.96 * 1.96;
  const p = won / played;
  const centre = (p + z2 / (2 * played)) / (1 + z2 / played);
  const spread = Math.sqrt(z2 * (p * (1 - p) / played + z2 / (4 * played * played))) / (1 + z2 / played);
  if (centre - spread > 0.5) return 'strong';
  if (centre + spread < 0.5) return 'weak';
  return 'early';
}

export function clearHistory() {
  write([]);
}

export function newMatchId() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(r, (x) => x.toString(16).padStart(2, '0')).join('');
}
