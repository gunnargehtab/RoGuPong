// RoGuPong — the leaderboard.
//
// There is no server to keep score, so each phone keeps its own record of
// every match it played and the two handsets merge their histories whenever
// they connect. Match records are immutable and carry a unique id, so merging
// is just a union — no conflicts, no clock to argue about, and both friends
// end up looking at exactly the same table.

const KEY = 'rogupong.matches.v1';
const PROFILE_KEY = 'rogupong.profile.v1';
const MAX_RECORDS = 400;

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    const trimmed = list.slice(-MAX_RECORDS);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    /* private mode, or a full quota — the game still plays */
  }
}

export function loadProfile() {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    const p = raw ? JSON.parse(raw) : null;
    return { name: p?.name || '', char: p?.char || 'ro', music: p?.music !== false, sfx: p?.sfx !== false };
  } catch {
    return { name: '', char: 'ro', music: true, sfx: true };
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
  }
  return rec;
}

/** Union of local history with a peer's, keeping ours authoritative on ties. */
export function mergeMatches(incoming) {
  if (!Array.isArray(incoming)) return 0;
  const list = read();
  const seen = new Set(list.map(matchId));
  let added = 0;
  for (const rec of incoming) {
    if (!rec || typeof rec.id !== 'string' || seen.has(rec.id)) continue;
    if (!Array.isArray(rec.players) || rec.players.length !== 2) continue;
    seen.add(rec.id);
    list.push(rec);
    added++;
  }
  if (added) {
    list.sort((a, b) => (a.at || 0) - (b.at || 0));
    write(list);
  }
  return added;
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

export function clearHistory() {
  write([]);
}

export function newMatchId() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(r, (x) => x.toString(16).padStart(2, '0')).join('');
}
