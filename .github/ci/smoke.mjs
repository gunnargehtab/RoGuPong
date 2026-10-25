// RoGuPong — headless smoke test, run by CI on every push and pull request.
//
//   node .github/ci/smoke.mjs            (CHROME=/path/to/chrome to pick one)
//
// No dependencies: a static server from node:http, and Chrome driven over the
// DevTools protocol with Node's own WebSocket. Two phones, each in a browser
// context of its own (storage apart, like two handsets):
//
// 1. The game loads to the title screen, and the service worker installs
//    with every file of ASSETS in its cache.
// 2. The menus that need no friend open: How to play, every leaderboard tab,
//    both connect tabs.
// 3. The two connect over WebRTC by pasting codes (Same WiFi), meet in the
//    lobby, start a match and play it for a few seconds: the host's court
//    runs and the guest draws the host's snapshots.
// 4. The trailer plays every shot, and its free-play demo runs.
//
// Any uncaught exception, console.error or failed load on any page fails it.

import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* A static server, like GitHub Pages                                  */

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  const file = join(ROOT, path || 'index.html');
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------------ */
/* Chrome                                                              */

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const n of names) {
    const hit = spawnSync('which', [n], { encoding: 'utf8' }).stdout.trim();
    if (hit) return hit;
  }
  throw new Error('No Chrome found — set CHROME to its path');
}

const profile = mkdtempSync(join(tmpdir(), 'rogupong-smoke-'));
const chrome = spawn(findChrome(), [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  // CI runners can't give Chrome its sandbox; the only page here is ours.
  '--no-sandbox',
  '--mute-audio',
  // Nothing but the local server: no update checks, no Google services.
  '--disable-background-networking',
  '--disable-component-update',
  '--autoplay-policy=no-user-gesture-required',
  // Plain host candidates, so two contexts on one machine reach each other.
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeLog = '';
chrome.stderr.on('data', (d) => { chromeLog += d; });

// A cold Chrome on a CI runner takes the best part of ten seconds to come up.
let exited = false;
chrome.on('exit', () => { exited = true; });
let wsUrl = null;
for (let i = 0; i < 600 && !wsUrl && !exited; i++) {
  await sleep(100);
  const port = join(profile, 'DevToolsActivePort');
  if (existsSync(port)) {
    const [p, path] = readFileSync(port, 'utf8').trim().split('\n');
    if (path) wsUrl = `ws://127.0.0.1:${p}${path}`;
  }
}
if (!wsUrl) {
  console.error(chromeLog);
  chrome.kill();
  throw new Error('Chrome did not start');
}
// However it goes wrong, the run ends well inside CI's own timeout.
setTimeout(() => {
  console.error('✗ gave up after 3 minutes');
  chrome.kill();
  process.exit(1);
}, 180000).unref();

/* ------------------------------------------------------------------ */
/* The DevTools protocol                                               */

const ws = new WebSocket(wsUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error('Could not reach Chrome'));
});
let nextId = 0;
const pending = new Map();
const listeners = new Map();   // sessionId → handler(method, params)
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id != null) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
    else p.resolve(msg.result);
  } else if (msg.sessionId) {
    listeners.get(msg.sessionId)?.(msg.method, msg.params);
  }
};
ws.onclose = () => {
  for (const p of pending.values()) p.reject(new Error(`${p.method}: Chrome went away`));
  pending.clear();
};
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  if (ws.readyState !== WebSocket.OPEN) { reject(new Error(`${method}: Chrome went away`)); return; }
  const id = ++nextId;
  pending.set(id, { resolve, reject, method });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const problems = [];
const pages = [];

class Page {
  static async open(name, contextId) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId: contextId });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = new Page(name, sessionId, targetId);
    pages.push(page);
    await Promise.all(['Runtime.enable', 'Log.enable', 'Page.enable'].map((m) => page.cmd(m)));
    await page.cmd('Emulation.setDeviceMetricsOverride', PHONE);
    await page.cmd('Emulation.setTouchEmulationEnabled', { enabled: true });
    // Both phones on screen at once, as they would be.
    await page.cmd('Emulation.setFocusEmulationEnabled', { enabled: true });
    return page;
  }

  constructor(name, sessionId, targetId) {
    this.name = name;
    this.session = sessionId;
    this.target = targetId;
    this.loaded = null;
    listeners.set(sessionId, (method, p) => this.onEvent(method, p));
  }

  cmd(method, params) {
    return send(method, params, this.session);
  }

  async close() {
    pages.splice(pages.indexOf(this), 1);
    listeners.delete(this.session);
    await send('Target.closeTarget', { targetId: this.target });
  }

  problem(text) {
    problems.push(`[${this.name}] ${text}`);
  }

  onEvent(method, p) {
    if (method === 'Runtime.exceptionThrown') {
      const d = p.exceptionDetails;
      const at = d.url ? ` (${d.url.replace(ORIGIN + '/', '')}:${d.lineNumber + 1})` : '';
      this.problem(`uncaught: ${d.exception?.description?.split('\n')[0] || d.text}${at}`);
    } else if (method === 'Runtime.consoleAPICalled' && (p.type === 'error' || p.type === 'assert')) {
      this.problem(`console.${p.type}: ${p.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (method === 'Log.entryAdded' && p.entry.level === 'error') {
      this.problem(`${p.entry.text}${p.entry.url ? ` (${p.entry.url.replace(ORIGIN + '/', '')})` : ''}`);
    } else if (method === 'Page.loadEventFired') {
      this.loaded?.();
    }
  }

  async goto(path) {
    const loaded = new Promise((r) => { this.loaded = r; });
    await this.cmd('Page.navigate', { url: `${ORIGIN}/${path}` });
    await loaded;
  }

  /** Run an expression in the page (awaiting it if it's a promise) and return its value. */
  async eval(expression) {
    const r = await this.cmd('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) {
      throw new Error(`[${this.name}] ${expression}: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
    }
    return r.result.value;
  }

  async waitFor(expression, what, ms = 15000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await this.eval(`!!(${expression})`)) return;
      await sleep(100);
    }
    throw new Error(`[${this.name}] timed out waiting for ${what}`);
  }

  /**
   * Tap a button with a real touch, so the page gets the user activation a
   * thumb gives it. A screen can redraw between finding the button and
   * touching it (the lobby does when the friend's hello lands), so the point
   * is checked first and, given `until`, the tap is tried again until it
   * has done what it is for.
   */
  async tap(selector, what = selector, until = null) {
    const sel = JSON.stringify(selector);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.waitFor(`document.querySelector(${sel})?.disabled === false`, `${what} to be tappable`);
      const at = await this.eval(`(() => {
        const el = document.querySelector(${sel});
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        const x = r.x + r.width / 2, y = r.y + r.height / 2;
        return document.elementFromPoint(x, y)?.closest(${sel}) === el ? { x, y } : null;
      })()`);
      if (at) {
        await this.cmd('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at] });
        await this.cmd('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
      await sleep(250);   // a few frames of the screen it opened
      if (at && !until) return;
      if (at && await this.waitFor(until, '', 2000).then(() => true, () => false)) return;
    }
    throw new Error(`[${this.name}] tapped ${what} three times and it didn't take`);
  }

  async action(name, extra = '', until = null) {
    await this.tap(`[data-action="${name}"]${extra}`, `${name}${extra}`, until);
  }

  async paste(text, button) {
    await this.waitFor(`document.getElementById('paste-input')`, 'the paste box');
    await this.eval(`document.getElementById('paste-input').value = ${JSON.stringify(text)}`);
    await this.action(button);
  }
}

/* ------------------------------------------------------------------ */
/* The test                                                            */

/** A step that throws ends the run: the ones after it build on it. */
const STOP = new Error('stop');
async function step(name, fn) {
  const before = problems.length;
  const t0 = Date.now();
  let threw = false;
  try {
    await fn();
  } catch (err) {
    problems.push(err.message);
    threw = true;
  }
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`${problems.length > before ? '✗' : '✓'} ${name} (${s} s)`);
  if (threw) throw STOP;
}

let exit = 0;
try {
  const contexts = [];
  for (let i = 0; i < 2; i++) contexts.push((await send('Target.createBrowserContext')).browserContextId);
  const host = await Page.open('host', contexts[0]);
  const guest = await Page.open('guest', contexts[1]);

  await step('the game loads to the title screen', async () => {
    await Promise.all([host.goto('index.html'), guest.goto('index.html')]);
    for (const p of [host, guest]) await p.waitFor(`window.rogupong?.screens.current === 'title'`, 'the title screen');
  });

  await step('the service worker installs with every asset cached', async () => {
    const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
    const cacheName = sw.match(/const CACHE = '([^']+)'/)[1];
    const assets = [...sw.match(/const ASSETS = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const missing = await host.eval(`(async () => {
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((r) => setTimeout(r, 15000)),
      ]);
      if (!ready) return null;
      const cache = await caches.open(${JSON.stringify(cacheName)});
      const have = new Set((await cache.keys()).map((r) => r.url));
      return ${JSON.stringify(assets)}.filter((a) => !have.has(new URL(a, location.href).href));
    })()`);
    if (!missing) host.problem('the service worker never installed — does every file in ASSETS exist?');
    else for (const m of missing) host.problem(`not in the service worker's cache: ${m}`);
  });

  await step('the menus open', async () => {
    await host.action('howto');
    await host.action('title');
    await host.action('board');
    for (const tab of ['recent', 'heroes', 'standings']) await host.action('board-tab', `[data-tab="${tab}"]`);
    await host.action('title');
    await host.action('play');
    await host.action('connect-mode', '[data-mode="online"]');
    await host.action('connect-mode', '[data-mode="wifi"]');
    await host.waitFor(`rogupong.online === false`, 'the Same WiFi tab');
  });

  await step('two phones connect by pasting codes', async () => {
    // Headless Chrome now and then never hands a page its list of networks,
    // and that page's first RTCPeerConnection gathers no candidates at all.
    // A throwaway connection that waits for one keeps that out of the game's
    // handshake, and tells it apart from a fault in the game when it persists.
    for (const p of [host, guest]) {
      const ok = await p.eval(`(async () => {
        const pc = new RTCPeerConnection();
        pc.createDataChannel('warm-up');
        const got = new Promise((r) => {
          pc.onicecandidate = (e) => e.candidate && r(true);
          setTimeout(() => r(false), 10000);
        });
        await pc.setLocalDescription(await pc.createOffer());
        const ok = await got;
        pc.close();
        return ok;
      })()`);
      if (!ok) throw new Error(`[${p.name}] Chrome found no network to connect over — a problem with the machine, not the game`);
    }

    await host.action('host');
    await host.waitFor(`rogupong.peer?.code`, 'the invite');
    const invite = await host.eval(`rogupong.peer.code`);

    await guest.action('play');
    await guest.action('join');
    if (await guest.eval(`rogupong.screens.data.stage === 'scan'`)) await guest.action('join-paste');
    await guest.paste(invite, 'use-pasted');
    await guest.waitFor(`rogupong.screens.data.stage === 'reply' && rogupong.peer?.code`, 'the reply');
    const reply = await guest.eval(`rogupong.peer.code`);

    await host.action('paste-answer');
    await host.paste(reply, 'use-answer');
    for (const p of [host, guest]) await p.waitFor(`rogupong.screens.current === 'lobby'`, 'the lobby');
    // Each lobby redraws once the friend's hello lands; settle before tapping.
    for (const p of [host, guest]) await p.waitFor(`rogupong.theirProtocol != null`, "the friend's hello");
  });

  await step('a match starts and plays on both phones', async () => {
    await guest.action('ready', '', `rogupong.myReady`);
    await host.waitFor(`rogupong.theirReady`, "the guest's Ready to reach the host");
    await host.action('start', '', `rogupong.mode === 'match'`);
    for (const p of [host, guest]) await p.waitFor(`rogupong.mode === 'match' && rogupong.match`, 'the match');
    // Past the countdown and well into a rally.
    await sleep(6000);
    for (const p of [host, guest]) {
      if (await p.eval(`document.hidden || rogupong.match.holding`)) p.problem('the match is paused: this phone thinks a page is off screen');
    }
    const ticks = await Promise.all([host, guest].map((p) => p.eval(`rogupong.match.tick`)));
    if (!(ticks[0] > 200)) host.problem(`the match isn't running: tick ${ticks[0]} after 6 s`);
    if (!(ticks[1] > 200)) guest.problem(`the guest isn't drawing the host's snapshots: tick ${ticks[1]} after 6 s`);
    const ball = await guest.eval(`rogupong.match.balls.map((b) => [b.x, b.y])`);
    if (!ball.flat().every(Number.isFinite)) guest.problem(`a ball is off the map: ${JSON.stringify(ball)}`);
    await host.eval(`rogupong.handleAction('leave', {})`);
    await Promise.all([host.close(), guest.close()]);
  });

  await step('the trailer plays every shot and the free-play demo runs', async () => {
    const trailer = await Page.open('trailer', contexts[0]);
    await trailer.goto('trailer.html');
    await trailer.waitFor(`window.trailer`, 'the trailer');
    await trailer.tap('#start-muted');
    const starts = await trailer.eval(`(async () => (await import('./js/trailer/music.js')).SHOTS.map((s) => s.start))()`);
    for (const t of starts) {
      await trailer.eval(`trailer.seek(${t} + 0.05)`);
      await sleep(400);
    }
    await trailer.eval(`trailer.seek(0)`);
    await sleep(500);
    await trailer.eval(`trailer.enterFree(0)`);
    await trailer.waitFor(`trailer.state === 'free'`, 'free play');
    await sleep(2000);
  });
} catch (err) {
  if (err !== STOP) problems.push(err.message);
} finally {
  if (problems.length) {
    // One error per frame is still one problem.
    const counts = new Map();
    for (const p of problems) counts.set(p, (counts.get(p) || 0) + 1);
    console.error(`\n${counts.size} problem${counts.size === 1 ? '' : 's'}:`);
    for (const [p, n] of counts) console.error(`  ${p}${n > 1 ? ` (×${n})` : ''}`);
    exit = 1;
    // The game's own Copy diagnostics report, from each phone still open.
    for (const p of pages) {
      const report = await p.eval(`window.rogupong?.diagnostics()`).catch(() => null);
      if (report) console.error(`\n--- ${p.name}'s diagnostics ---\n${report}`);
    }
  }
  ws.close();
  chrome.kill();
  server.close();
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
}
process.exit(exit);
