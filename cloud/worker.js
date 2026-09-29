// RoGuPong — cloud league sync.
//
// The project's one server, and an optional one: the game never waits on it
// and plays exactly the same without it. It keeps one copy of each league's
// match records, keyed by the league key the phones make up and pass around
// (js/data/cloud.js). There are no accounts — whoever has the key is in the
// league. Records are immutable and carry unique ids, so storing them is an
// INSERT OR IGNORE and syncing is "what came in since I last asked".
//
// Each league is one Durable Object with its own SQLite table, so its writes
// are serialised and its row numbers only ever grow: a phone's cursor is the
// last row it has seen. Deploy notes in cloud/README.md.

import { DurableObject } from 'cloudflare:workers';

const KEY = /^[A-Z2-7]{16}$/;
const PAGE = 500;              // records per request, each way
const MAX_LEAGUE = 10000;      // a league past this takes no more
const MAX_RECORD = 1024;       // characters of JSON per record; a real one is ~200
const MAX_BODY = 1 << 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const [, route, key] = new URL(request.url).pathname.split('/');
    if (!route) return new Response('RoGuPong league sync is up.\n', { headers: CORS });
    if (route !== 'league' || !KEY.test(key || '')) return json({ error: 'not found' }, 404);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);
    if (Number(request.headers.get('Content-Length')) > MAX_BODY) return json({ error: 'too big' }, 413);
    // The game posts plain text, which spares it a preflight round trip.
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ error: 'too big' }, 413);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: 'not JSON' }, 400);
    }
    const league = env.LEAGUE.get(env.LEAGUE.idFromName(key));
    return json(await league.sync(body?.since, body?.recs));
  },
};

/** Just enough to keep junk out of storage; the phones check every record again as they merge. */
const plausible = (rec) => typeof rec?.id === 'string' && rec.id.length > 0 && rec.id.length <= 32
  && Array.isArray(rec.players) && rec.players.length === 2 && Array.isArray(rec.score);

export class League extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS matches (seq INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, rec TEXT NOT NULL)');
  }

  last() {
    return this.sql.exec('SELECT MAX(seq) AS n FROM matches').one().n || 0;
  }

  /**
   * Take a phone's new records and hand back the ones after its cursor. A
   * cursor past the end means this league was lost or moved: `reset` asks
   * the phone to send everything again, and it starts from the beginning.
   */
  sync(since, recs) {
    const before = this.last();
    const lost = Number.isInteger(since) && since > before;
    const from = Number.isInteger(since) && since > 0 && !lost ? since : 0;
    const rows = this.sql.exec('SELECT seq, rec FROM matches WHERE seq > ? ORDER BY seq LIMIT ?', from, PAGE).toArray();
    // Read before writing: a phone this page catches up has its cursor moved
    // past the rows it adds, so its own records never echo back to it.
    if (before < MAX_LEAGUE && Array.isArray(recs)) {
      for (const rec of recs.slice(0, PAGE)) {
        const text = JSON.stringify(rec);
        if (plausible(rec) && text.length <= MAX_RECORD) {
          this.sql.exec('INSERT OR IGNORE INTO matches (id, rec) VALUES (?, ?)', rec.id, text);
        }
      }
    }
    const last = this.last();
    const caughtUp = rows.length < PAGE;
    const cursor = caughtUp ? last : rows[rows.length - 1].seq;
    return { recs: rows.map((r) => JSON.parse(r.rec)), cursor, last, more: cursor < last, reset: lost };
  }
}
