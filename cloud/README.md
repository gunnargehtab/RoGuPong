# Cloud league sync — the Worker

RoGuPong's one server, and an optional one. It keeps a copy of each league's
match records so friends' leaderboards catch up whenever their phones are
online, without meeting. The game never waits on it. With no internet, or with
no Worker deployed at all, everything plays exactly as before. How it fits into
the leaderboard is in [DESIGN.md §8](../DESIGN.md#8-the-leaderboard-and-the-optional-cloud).

`worker.js` is the whole thing: a Cloudflare Worker plus one SQLite-backed
Durable Object per league. It has no dependencies, and nothing here is loaded
by the game or cached by its service worker.

## Deploying

You need a free Cloudflare account and Node.js 20 or newer. Nothing gets
installed into the repo; `npx` fetches Wrangler, Cloudflare's CLI, on the fly.

```sh
cd cloud
npx wrangler login      # opens the browser once to authorise Wrangler
npx wrangler deploy
```

On a first deploy Wrangler may ask you to pick a `workers.dev` subdomain. It
then prints the Worker's address, something like
`https://rogupong-league.<your-subdomain>.workers.dev`. Opening that address in
a browser should say **RoGuPong league sync is up.**

### Trying it before switching it on for everyone

The game only offers cloud sync when it knows a Worker. To try yours on one
phone first, open the game, then in the browser console run:

```js
localStorage.setItem('rogupong.cloud.endpoint', 'https://rogupong-league.<your-subdomain>.workers.dev')
```

Reload. The leaderboard now has a **Cloud sync** section. `localStorage.removeItem`
on the same key takes it away again.

### Switching it on

Put the address in `ENDPOINT` at the top of `js/data/cloud.js` and push to
`main`. GitHub Pages republishes, and every phone offers cloud sync from its
next load with internet.

### Running it locally

```sh
cd cloud
npx wrangler dev --port 8787
```

That serves the Worker at `http://127.0.0.1:8787` with local storage under
`.wrangler/` (ignored by git). Point the console override above at it, and
serve the game from `localhost` as usual.

## What it does

`POST /league/<key>`, where the key is 16 Base32 characters the game makes up.
The body is JSON sent as plain text, which spares the browser a CORS
preflight:

```json
{ "since": 1200, "recs": [ { "id": "…", "at": 1759000000000, "players": [], "score": [7, 5], "winner": 0 } ] }
```

The Worker stores the records it hasn't seen (`INSERT OR IGNORE` by match id,
at most 500 a request), and answers with up to 500 records after row `since`:

```json
{ "recs": [], "cursor": 1236, "last": 1236, "more": false, "reset": false }
```

- `cursor` is the next `since`. A phone that was caught up has its cursor moved
  past the rows it just added, so it never fetches its own records back.
- `last` is how many matches the league holds.
- `more` says there are more pages to fetch.
- `reset` means the phone's cursor was past the end: the league was lost or
  moved. The phone then sends everything it holds again, and the league is
  rebuilt from the phones.

`GET /` answers the "is it up" line. Anything else is a 404.

## Limits

- A record over 1 KB of JSON, or one without an id, two players and a score,
  is dropped. A league past 10,000 matches takes no more. (A phone keeps 3,000.)
- The Workers Free plan allows 100,000 requests and 100,000 rows written a day,
  and 5 GB stored across all leagues. A group of friends uses a tiny fraction
  of that. A phone joining a league sends its whole history once, up to 3,000
  rows. After that, each finished match is one row.
- Past a limit, requests fail until the daily reset (00:00 UTC). A failed sync
  only shows as "Couldn't sync" on the leaderboard, and the phone tries again
  later. The game itself is unaffected.

## Security, such as it is

There are no accounts. Whoever holds a league's key can read and add to it.
The key spreads between friends' phones the same way matches do: when they
connect, and inside a shared league code. It's 80 random bits, so no one will
guess it. But anyone it's shared with can add fake records, just as they could
by connecting (DESIGN.md §8, known limits). Nothing is ever deleted through the
API. A phone that leaves stops syncing, but what it already sent stays in the
league. Anything removed from storage by hand comes back from any phone still
in the league on its next sync.
