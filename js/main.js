// RoGuPong — the conductor.
//
// Owns the screen router, the connection lifecycle and the frame loop. The
// host runs the authoritative simulation and broadcasts snapshots; the guest
// sends its paddle position, renders what it is told, and predicts only its
// own paddle so the controls never feel rubbery.

import { Screens, EMOTES } from './ui/screens.js';
import { Renderer } from './game/render.js';
import { Input } from './game/input.js';
import { Fx, reactTo } from './game/fx.js';
import { audio } from './game/audio.js';
import { Match } from './game/match.js';
import { byId as charById, BALANCE } from './game/characters.js';
import { STAGES, stageById } from './game/stages.js';
import { itemById } from './game/items.js';
import { Peer } from './net/peer.js';
import { extractCode, inviteLink, CODE_RE } from './net/sdp.js';
import { Scanner, scannerSupported } from './net/scanner.js';
import * as lb from './data/leaderboard.js';
import * as league from './data/league.js';
import { log, logLines, clock, device, isIOS } from './diag.js';

const SNAPSHOT_HZ = 30;
const INPUT_HZ = 30;
// The simulation always advances in fixed slices. A phone that can only paint
// 20 frames a second still gets a full second of game per second of wall clock;
// it just gets fewer pictures of it.
const FIXED_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 6;
// The newest matches ride in 'hello', which is all a build from before full
// history exchange reads; the rest follows in 'hist' chunks small enough for
// any browser's data channel.
const HISTORY_SHARED = 80;
const HISTORY_CHUNK = 40;
// What this build speaks, sent in 'hello'. Bump it whenever a change needs both
// phones on the same build to look right — snapshot fields a guest has to draw,
// crates it has to know — and tag new crates with it (items.js `since`). Builds
// from before the number existed send none, which reads as 1.
const PROTOCOL = 2;
// How far back predictPaddle remembers where our own paddle has been. Sized to
// cover the whole staleness of the echoed paddle position with room to spare:
// input send interval + RTT + host frame (and its up-to-6-step backlog) +
// snapshot interval + a 30 Hz low-power-mode guest frame is ~0.25 s at worst.
const PREDICT_MEMORY = 0.45;

// Where a drop happened, as the Link Lost screen says it.
const STEP_LABEL = {
  handshake: 'While connecting',
  lobby: 'In the lobby',
  match: 'During a match',
  results: 'On the results screen',
  board: 'On the leaderboard',
};
const WIFI_HINT = 'Both phones need to stay on the same WiFi. Some guest networks block '
  + 'phones from talking to each other — a personal hotspot works around that.';
const AWAY_HINT = 'Switching apps or letting the screen lock pauses the game, and the other '
  + 'phone gives up after a few seconds of silence. Keep RoGuPong on screen on both phones '
  + 'while you play.';

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** A phone's last trip off the screen, as the Link Lost screen tells it. */
function awayText(hiddenAt, last, now, theirs) {
  if (hiddenAt != null) return `In the background for ${secs(now - hiddenAt)}`;
  if (last && now - last.back < 60000) {
    return `In the background for ${secs(last.for)}, back ${secs(now - last.back)} before`;
  }
  // An older build never says when it leaves the screen, so silence proves nothing.
  return theirs ? 'No word of leaving the screen' : 'On screen';
}

class App {
  constructor() {
    this.canvas = document.getElementById('stage');
    this.renderer = new Renderer(this.canvas);
    this.input = new Input(this.canvas, this.renderer);
    this.fx = new Fx();
    this.audio = audio;
    this.profile = lb.loadProfile();
    this.screens = new Screens(document.getElementById('app'), this);

    this.mode = 'menu';           // menu | match
    this.peer = null;
    this.scanner = null;
    this.match = null;
    this.stage = STAGES[0];
    this.target = 7;
    this.party = false;
    this.balance = BALANCE;       // the host's, for the match being played
    this.histIn = null;           // their history while it streams in after 'hello'
    this.league = null;           // a league code made ahead of the Share tap
    this.myChar = this.profile.char;
    this.theirChar = 'gu';
    this.theirFlair = 'none';
    this.theirName = '';
    this.theirProtocol = null;    // from their 'hello'; null until it arrives
    this.theirReady = false;
    this.myReady = false;
    this.myRematch = false;
    this.theirRematch = false;
    this.guestInput = { x: 0.5 };
    this.netAccum = 0;
    this.simAccum = 0;
    this.predictX = 0.5;
    this.predictLog = [];
    this.lastSnapAt = -Infinity;
    this.lastFrame = performance.now();
    this.menuTime = 0;
    this.wakeLock = null;
    this.wakeLockPending = false;
    this.wantAwake = false;
    this.wakeLockNote = 'wakeLock' in navigator ? 'off' : 'not supported';
    this.simAccum = 0;
    // This session's graphics. The profile holds only what was picked by hand;
    // the frame-rate watcher's switch lasts until the page closes.
    this.quality = this.profile.quality;
    this.qualityPinned = false;
    this.fps = 0;
    this.fpsCount = 0;
    this.fpsSum = 0;
    this.fpsNear30 = 0;
    this.fpsSkip = 0;
    this.slowFrames = 0;
    this.capNoted = false;
    // When each phone last left the screen, for the Link Lost screen.
    this.hiddenAt = document.hidden ? performance.now() : null;
    this.lastAway = null;         // { for, back } — our last spell in the background
    this.theirHiddenAt = null;
    this.theirLastAway = null;
    this.lastDrop = null;
    this.storageNote = 'unknown';

    audio.setMusic(this.profile.music);
    audio.setSfx(this.profile.sfx);
    this.renderer.setQuality(this.quality);
    this.fx.setQuality(this.quality);

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 300));
    document.addEventListener('visibilitychange', () => this.onVisibility());
    // Closing the tab can tear the link down without a word, leaving the other
    // phone to wait out the silence and a grace period. Say goodbye on the way.
    window.addEventListener('pagehide', () => { if (this.peer?.connected) this.peer.send({ t: 'bye' }); });
    // Audio can only start — or restart after iOS parks it — inside a real
    // gesture, and mid-match every gesture is a paddle drag on the canvas,
    // which never reaches the menus' click handler.
    for (const type of ['pointerup', 'touchend', 'keydown']) {
      window.addEventListener(type, () => audio.unlock(), { capture: true, passive: true });
    }

    // Tapping an invite while the game is already open only changes the
    // fragment — the page never reloads — so listen for that as well as
    // checking on startup.
    window.addEventListener('hashchange', () => this.consumeInviteLink());

    this.watchForDiagnostics();
    this.keepStorage();
    this.go('title');
    requestAnimationFrame((t) => this.frame(t));
    this.consumeInviteLink();
  }

  /** The moments worth having in the log when something goes wrong later. */
  watchForDiagnostics() {
    const nav = performance.getEntriesByType?.('navigation')?.[0]?.type || 'navigate';
    log(`page loaded (${nav}) · protocol ${PROTOCOL}`);
    window.addEventListener('error', (e) => {
      log(`error: ${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno})`);
    });
    window.addEventListener('unhandledrejection', (e) => log(`error: ${e.reason?.message || e.reason}`));
    window.addEventListener('online', () => log('network: online'));
    window.addEventListener('offline', () => log('network: offline'));
    // Chrome freezes a background page outright after a while; iOS just
    // suspends it, which only shows up as the gap between hidden and visible.
    document.addEventListener('freeze', () => log('page frozen'));
    document.addEventListener('resume', () => log('page resumed'));
    window.addEventListener('pagehide', (e) => log(`page hide${e.persisted ? ' (kept in memory)' : ''}`));
  }

  /**
   * Safari may clear a site's storage — the match history and flair with it —
   * when the phone runs short of space or the site goes unvisited for a while.
   * Asking for persistent storage is the one lever a page has. Only on iOS:
   * the eviction is Safari's, and some other browsers put a permission prompt
   * in front of the request.
   */
  async keepStorage() {
    const s = navigator.storage;
    if (!s?.persisted) { this.storageNote = 'no storage manager'; return; }
    try {
      let kept = await s.persisted();
      if (!kept && isIOS() && s.persist) kept = await s.persist();
      this.storageNote = kept ? 'persistent' : 'best effort';
    } catch {
      this.storageNote = 'unknown';
    }
  }

  /**
   * The page hid or came back. A hidden page is paused — on iOS entirely,
   * timers and audio included — and loses its wake lock, so coming back
   * means picking all of that up again. The other phone is told too: a
   * friend who went quiet because they switched apps is a different problem
   * from a WiFi that went quiet, and the Link Lost screen tells them apart.
   */
  onVisibility() {
    const now = performance.now();
    const hidden = document.hidden;
    if (this.peer?.connected) this.peer.send({ t: 'away', v: hidden });
    if (hidden) {
      this.hiddenAt = now;
      log('page hidden');
      audio.stopMusic();
      return;
    }
    if (this.hiddenAt != null) {
      this.lastAway = { for: now - this.hiddenAt, back: now };
      log(`page visible after ${secs(now - this.hiddenAt)}`);
    }
    this.hiddenAt = null;
    // The first frames back span the whole absence; they say nothing about
    // how fast this phone draws.
    this.fpsCount = 0;
    this.fpsSum = 0;
    this.fpsNear30 = 0;
    this.fpsSkip = 2;
    audio.resume();
    audio.playMusic(this.mode === 'match' ? 'match' : 'menu');
    if (this.wantAwake) this.keepAwake(true);
  }

  get view() { return this.peer && !this.peer.isHost ? 1 : 0; }

  /**
   * Opened from a scanned invite? Join it straight away.
   *
   * This is how an iPhone gets in: iOS reads QR codes in the Camera app but
   * gives no browser API for it, so the invite is a link and the phone's own
   * camera does the scanning.
   */
  consumeInviteLink() {
    const hash = location.hash || '';
    if (!/[#?&]j=/.test(hash)) return;
    const code = extractCode(hash);
    // Clear it before connecting, so a reload does not try to rejoin a match
    // that is long over.
    history.replaceState(null, '', location.pathname + location.search);

    if (!CODE_RE.test(code)) {
      this.screens.toast('That invite link looks damaged', 'bad');
      return;
    }
    if (this.mode === 'match') {
      this.screens.toast('Finish this match first', 'bad');
      return;
    }
    // Opening a second invite from the menus is a deliberate act: drop
    // whatever half-made connection is lying around and take the new one.
    if (this.peer) this.leave(true);

    this.screens.toast('Invite found — joining…');
    this.beginJoin(code);
  }

  saveProfile() {
    this.profile.char = this.myChar;
    lb.saveProfile(this.profile);
  }

  go(screen, data = {}) {
    log(`screen: ${screen}${data.stage && typeof data.stage === 'string' ? ` (${data.stage})` : ''}`);
    if (screen === 'match') {
      this.mode = 'match';
      this.screens.hide();
      return;
    }
    this.mode = 'menu';
    this.screens.show(screen, data);
  }

  /* ------------------------------------------------------------------ */
  /* Frame loop                                                          */

  frame(now) {
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.menuTime += dt;
    this.sampleFrameRate(dt);

    if (this.mode === 'match' && this.match) this.stepMatch(dt);
    else this.stepMenu(dt);

    requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Watch the real frame rate and drop the renderer to its cheap path if the
   * phone cannot keep up. Sticky for the session, so an older handset settles
   * once instead of oscillating between looks.
   *
   * Every laggy second before the switch is a second of mushy paddle, so this
   * decides fast: a phone that is merely struggling gets a second opinion, one
   * that is drowning is demoted on the first window. Windows close on elapsed
   * time as well as frame count, so a phone crawling at a few fps doesn't take
   * most of a minute to accumulate enough frames to be judged.
   *
   * A steady 30 fps is left alone. That is a frame-rate cap, not a phone
   * struggling — iOS holds every page to 30 in Low Power Mode — and the cheap
   * path can't beat a cap; it only makes the game look worse. Nor is the
   * switch saved: Low Power Mode ends and phones cool down, so the next
   * session takes its own look.
   */
  sampleFrameRate(dt) {
    if (dt <= 0) return;
    if (this.fpsSkip > 0) { this.fpsSkip--; return; }
    this.fpsCount++;
    this.fpsSum += dt;
    if (dt > 1 / 36 && dt < 1 / 25) this.fpsNear30++;
    if (this.fpsCount < 45 && !(this.fpsSum >= 1.5 && this.fpsCount >= 8)) return;
    const mean = this.fpsSum / this.fpsCount;
    const capped = this.fpsNear30 >= this.fpsCount * 0.8;
    this.fpsCount = 0;
    this.fpsSum = 0;
    this.fpsNear30 = 0;
    this.fps = Math.round(1 / mean);
    if (capped && !this.capNoted) {
      this.capNoted = true;
      log(`steady ${this.fps} fps: looks like a frame-rate cap (Low Power Mode?)`);
    }
    if (this.quality === 'low' || this.qualityPinned) return;
    if (mean > 1 / 27) { this.setQuality('low', true); return; }
    if (mean > 1 / 45 && !capped) {
      // Two bad windows in a row, so a one-off hitch does not demote a phone
      // that is actually fine.
      this.slowFrames++;
      if (this.slowFrames >= 2) this.setQuality('low', true);
    } else {
      this.slowFrames = 0;
    }
  }

  /**
   * Switch the graphics path. A choice made on the Graphics toggle is saved,
   * and the frame-rate watcher leaves it be for the rest of the session; the
   * watcher's own switch lasts for this session only.
   */
  setQuality(quality, automatic = false) {
    if (!automatic) {
      this.qualityPinned = true;
      this.profile.quality = quality;
      this.profile.qualityChosen = true;
      lb.saveProfile(this.profile);
    }
    if (this.quality === quality) return;
    this.quality = quality;
    this.renderer.setQuality(quality);
    this.fx.setQuality(quality);
    this.fpsCount = 0;
    this.fpsSum = 0;
    this.fpsNear30 = 0;
    this.slowFrames = 0;
    if (automatic && quality === 'low') {
      log(`graphics: switched to fast at ${this.fps} fps`);
      this.screens.toast('Switched to fast graphics for a smoother game');
    }
  }

  stepMenu(dt) {
    this.fx.update(dt);
    this.renderer.drawMenuBackdrop(this.stage, this.menuTime, this.fx);
    this.screens.tickLogo(this.menuTime);
  }

  stepMatch(dt) {
    const m = this.match;
    const isHost = !this.peer || this.peer.isHost;
    this.input.update(dt);

    if (isHost) {
      m.setInput(0, { x: this.input.x, special: this.input.takeSpecial() });
      m.setInput(1, { x: this.guestInput.x });

      // Fixed-step accumulator. Feeding a long frame straight into step() would
      // have it clamped, quietly turning a slow phone into a slow-motion game.
      this.simAccum += dt;
      let steps = 0;
      while (this.simAccum >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
        m.step(FIXED_STEP);
        this.simAccum -= FIXED_STEP;
        steps++;
      }
      // Far enough behind that catching up would make things worse: drop the
      // backlog rather than spiral.
      if (steps === MAX_STEPS_PER_FRAME) this.simAccum = 0;

      this.netAccum += dt;
      if (this.peer && this.netAccum >= 1 / SNAPSHOT_HZ) {
        // Subtract the interval instead of zeroing: zeroing rounds the send
        // cadence up to whole frames, which quietly stretches 30 Hz to 22 Hz
        // on a phone rendering at 45 fps — extra echo lag exactly when the
        // phone is already struggling. Capped so a long stall can't bank a
        // burst of sends.
        this.netAccum = Math.min(this.netAccum - 1 / SNAPSHOT_HZ, 1 / SNAPSHOT_HZ);
        // Build the snapshot only if it will actually go out: snapshot()
        // flushes the event outbox, and events are the one thing in the state
        // stream the next packet does not supersede. Held back, they simply
        // ride the next snapshot that does send.
        if (!this.peer.stateBackedUp()) this.peer.sendState(m.snapshot());
      }
    } else {
      if (this.input.takeSpecial()) this.peer.send({ t: 'sp' });
      this.netAccum += dt;
      if (this.netAccum >= 1 / INPUT_HZ) {
        this.netAccum = Math.min(this.netAccum - 1 / INPUT_HZ, 1 / INPUT_HZ);
        this.peer.sendState({ k: 'i', x: +this.input.x.toFixed(4) });
      }
      m.extrapolate(dt);
    }

    this.predictPaddle(dt);

    for (const ev of m.drainEvents()) {
      reactTo(ev, this.fx, m.chars, audio, { accent: this.stage.accent, view: this.view });
      if (ev.t === 'goal' && !ev.quiet && navigator.vibrate) navigator.vibrate(ev.p === this.view ? 30 : [12, 40, 12]);
      if (ev.t === 'special' && navigator.vibrate) navigator.vibrate(45);
    }
    this.countdownBeeps(m);
    this.fx.update(dt);

    this.renderer.draw(m, {
      view: this.view,
      stage: this.stage,
      fx: this.fx,
      time: this.menuTime,
      names: this.names(),
      chars: m.chars,
      flairs: this.flairs(),
      localPaddleX: this.predictX,
      rtt: this.peer ? this.peer.rtt : 0,
      showTouchHint: !this.input.touched && m.phase === 'countdown',
    });

    if (m.phase === 'over' && !this.finishing) this.finishMatch();
  }

  /** Keep our own paddle glued to the thumb even while snapshots trickle in. */
  predictPaddle(dt) {
    const m = this.match;
    const i = this.view;
    const p = m.paddles[i];
    // Clamp inside the width the host is actually using — netWidth carries
    // grow, which is not otherwise synced — so prediction can never slide the
    // paddle closer to a wall than the authority allows.
    const half = (p.netWidth != null ? p.netWidth : m.paddleWidth(i)) / 2;
    const target = Math.max(half, Math.min(1 - half, this.input.x));
    const max = m.paddleSpeed(i) * dt;
    this.predictX += Math.max(-max, Math.min(max, target - this.predictX));

    // Reconciliation. The echoed paddle position is a whole network round
    // stale: it says where the paddle WAS ~60–130 ms ago, not where it is.
    // Judging it against the current position alone reads that lag as desync —
    // after every sharp reversal the two diverge at twice the paddle speed,
    // cross the snap threshold within a few frames, and the paddle teleports
    // backwards off the thumb: a twitch, worst on the laggiest phones and
    // networks. So the echo is compared against the whole
    // span the paddle has covered recently: an echo inside that span is merely
    // the past and needs no fixing. Only the distance beyond the span is
    // genuine desync — a lost input burst, a clamp mismatch — eased away
    // gently, or snapped when it is too big to ease.
    const log = this.predictLog;
    log.push({ t: this.menuTime, x: this.predictX });
    while (log.length && log[0].t < this.menuTime - PREDICT_MEMORY) log.shift();

    // No fresh authority, no correction: during a snapshot stall the echo is
    // frozen, and on the host (which never applies snapshots) the simulation
    // chases the same finger this does — either way there is nothing to learn.
    if (this.menuTime - this.lastSnapAt > PREDICT_MEMORY) return;

    let lo = this.predictX, hi = this.predictX;
    for (const h of log) { if (h.x < lo) lo = h.x; else if (h.x > hi) hi = h.x; }
    const server = p.x;
    const err = server < lo ? server - lo : server > hi ? server - hi : 0;
    if (Math.abs(err) > 0.14) this.predictX = server;
    else if (err) this.predictX += err * Math.min(1, dt * 2.5);
  }

  countdownBeeps(m) {
    if (m.phase !== 'countdown') { this.lastBeep = null; return; }
    const n = Math.ceil(m.phaseTime);
    if (this.lastBeep !== n) {
      this.lastBeep = n;
      audio.count(Math.max(0, n));
    }
  }

  names() {
    const mine = this.profile.name || 'YOU';
    const theirs = this.theirName || 'FRIEND';
    return this.view === 0 ? [mine, theirs] : [theirs, mine];
  }

  /** Flair by player index (0 host, 1 guest), for the renderer. */
  flairs() {
    const mine = this.profile.flair || 'none';
    return this.view === 0 ? [mine, this.theirFlair] : [this.theirFlair, mine];
  }

  /* ------------------------------------------------------------------ */
  /* Match lifecycle                                                     */

  startMatch({ seed, stage, target, chars, mid, party, balance }) {
    this.stage = stageById(stage);
    this.target = target;
    this.party = !!party;
    this.matchId = mid;
    // A host from before balance versions sends none, and runs version 1.
    this.balance = Number.isInteger(balance) && balance > 0 ? balance : 1;
    // The stage deals its own crates: its pool, minus anything newer than the
    // older phone's build. Only the host's copy is ever rolled, so the pool
    // never has to travel.
    this.match = new Match({ chars, stage, target, seed, party, items: this.stageCrates(this.stage) });
    this.finishing = false;
    this.pendingResult = null;
    this.simAccum = 0;
    this.predictX = 0.5;
    this.predictLog.length = 0;
    this.lastSnapAt = -Infinity;
    this.guestInput.x = 0.5;
    this.netAccum = 0;
    this.myRematch = false;
    this.theirRematch = false;
    this.fx.clear();
    this.input.reset();
    this.renderer.trails.clear();
    audio.playMusic('match');
    this.keepAwake(true);
    this.go('match');
  }

  /**
   * Both phones build the same record from the same match id, names and
   * character picks, so the host's copy and the guest's fallback agree — which
   * is what lets the two leaderboards merge cleanly later.
   */
  buildRecord() {
    const m = this.match;
    const names = this.names();
    return {
      id: this.matchId || lb.newMatchId(),
      at: Date.now(),
      players: [
        { name: names[0], char: m.chars[0].id },
        { name: names[1], char: m.chars[1].id },
      ],
      score: [...m.scores],
      winner: m.winner,
      bestRally: m.bestRally,
      stage: this.stage.id,
      target: this.target,
      party: this.party,
      balance: this.balance,
    };
  }

  finishMatch() {
    this.finishing = true;
    const m = this.match;
    const isHost = !this.peer || this.peer.isHost;
    audio.stopMusic();
    if (m.winner === this.view) audio.victory(); else audio.defeat();

    // Send the record straight away rather than after the celebration, so the
    // guest is never left waiting on a message that has not been sent yet.
    if (isHost) {
      this.pendingResult = this.buildRecord();
      this.peer?.send({ t: 'result', rec: this.pendingResult });
    }

    const showAt = performance.now() + 2600;
    const giveUpAt = showAt + 5000;
    const tryShow = () => {
      if (!this.finishing || !this.match) return;      // player bailed out
      const now = performance.now();
      if (now < showAt || (!this.pendingResult && now < giveUpAt)) {
        setTimeout(tryShow, 120);
        return;
      }
      const rec = this.pendingResult || this.buildRecord();
      // A milestone crossed by this match unlocks its flair the moment the
      // record lands — worth announcing over the results screen.
      const before = lb.flairProgress(this.profile).unlocked;
      lb.recordMatch(rec);
      const after = lb.flairProgress(this.profile).unlocked;
      for (const f of lb.FLAIRS) {
        if (!before[f.id] && after[f.id]) {
          this.screens.toast(`✨ ${f.name} flair unlocked!`, 'good');
        }
      }
      this.pendingResult = null;
      this.keepAwake(!!this.peer);        // still connected: the rematch is a tap away
      audio.playMusic('menu');
      this.go('results', {
        rec, view: this.view, wantsRematch: false, theirRematch: this.theirRematch,
      });
    };
    tryShow();
  }

  /**
   * Keep the screen on for as long as a connection is up or being made —
   * handshake, lobby, match, results. A phone that dims and locks pauses the
   * page, and the other phone soon gives up on it. Browsers drop the lock
   * whenever the page hides (iOS on every notification or app switch), so
   * onVisibility asks for it again each time the page comes back.
   */
  async keepAwake(on) {
    this.wantAwake = on;
    if (!('wakeLock' in navigator)) return;
    if (!on) {
      const lock = this.wakeLock;
      this.wakeLock = null;
      if (lock) {
        this.wakeLockNote = 'off';
        lock.release().catch(() => { /* already gone */ });
      }
      return;
    }
    // Only a visible page may hold one.
    if (this.wakeLock || this.wakeLockPending || document.hidden) return;
    this.wakeLockPending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        if (this.wakeLock !== lock) return;          // we let it go ourselves
        this.wakeLock = null;
        this.wakeLockNote = 'released by the browser';
        log('wake lock released');
      });
      if (this.wantAwake) {
        this.wakeLock = lock;
        this.wakeLockNote = 'held';
        log('wake lock held');
      } else {
        lock.release().catch(() => { /* already gone */ });
      }
    } catch (err) {
      this.wakeLockNote = `refused (${err.name})`;
      log(`wake lock refused: ${err.name}`);
    } finally {
      this.wakeLockPending = false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Connection                                                          */

  attachPeer(peer) {
    this.peer = peer;
    this.theirHiddenAt = null;
    this.theirLastAway = null;
    this.keepAwake(true);
    log(`${peer.isHost ? 'hosting' : 'joining'}: code ready`);
    peer.on('stall', () => {
      log('link: stalled, waiting for it to come back');
      this.screens.toast('Connection hiccup — hold on…', 'warn');
    });
    peer.on('recover', (ms) => {
      log(`link: back after ${secs(ms)}`);
      this.screens.toast('Connection back', 'good');
    });
    peer.on('open', () => {
      this.stopScanner();
      audio.blip(880, 0.1);
      this.screens.toast('Connected', 'good');
      this.theirProtocol = null;
      this.histIn = null;
      const history = lb.allMatches();
      const older = history.slice(0, Math.max(0, history.length - HISTORY_SHARED));
      peer.send({
        t: 'hello',
        v: PROTOCOL,
        name: this.profile.name || (peer.isHost ? 'HOST' : 'GUEST'),
        char: this.myChar,
        flair: this.profile.flair,
        matches: history.slice(-HISTORY_SHARED),
        more: older.length,
      });
      if (peer.isHost) peer.send(this.setupMsg());
      // The rest of the history, matches between other friends included, so
      // a group that mixes partners converges on one league. A build from
      // before this ignores 'hist' and makes do with the hello's share.
      const chunks = [];
      for (let i = 0; i < older.length; i += HISTORY_CHUNK) {
        const m = older.slice(i, i + HISTORY_CHUNK);
        chunks.push({ t: 'hist', m, end: i + HISTORY_CHUNK >= older.length });
      }
      peer.sendPaced(chunks);
      // Opened behind a chat app, while the reply was still being shared.
      if (document.hidden) peer.send({ t: 'away', v: true });
      this.openLobby();
    });
    peer.on('msg', (msg) => this.onMessage(msg));
    peer.on('state', (msg) => this.onState(msg));
    peer.on('drop', (reason) => this.onDrop(reason));
  }

  openLobby() {
    this.myReady = false;
    this.theirReady = false;
    this.go('lobby', this.lobbyData());
  }

  /**
   * The newest protocol both phones speak. A phone still running an older
   * cached build (loaded on a WiFi with no internet) can't draw what newer
   * crates put on the court, so the match sticks to what both can show.
   */
  sharedProtocol() {
    // No phone on the other end (a console match, or the one after a drop):
    // whatever the last friend was running no longer matters.
    if (!this.peer) return PROTOCOL;
    // Connected but not yet told: assume the oldest build until 'hello' says
    // otherwise. Their ready follows their hello on the ordered channel, so a
    // match never actually starts on this guess — it is only the safe side.
    return Math.min(PROTOCOL, this.theirProtocol ?? 1);
  }

  /** The stage's crate pool, minus anything the other phone's build predates. */
  stageCrates(stage) {
    const shared = this.sharedProtocol();
    return stage.items.filter((id) => (itemById(id).since || 1) <= shared);
  }

  /**
   * The crates this match will actually deal, as far as this phone can tell —
   * only the host rolls them. A host that sent no protocol predates this
   * filtering and deals whatever its own build does, so a guest can't know
   * (null).
   */
  knownCrates() {
    if (this.peer && !this.peer.isHost && this.theirProtocol === 1) return null;
    return this.stageCrates(this.stage);
  }

  setupMsg() {
    return { t: 'setup', stage: this.stage.id, target: this.target, party: this.party };
  }

  lobbyData() {
    return {
      isHost: !this.peer || this.peer.isHost,
      myChar: this.myChar,
      theirChar: this.theirChar,
      theirName: this.theirName,
      theirReady: this.theirReady,
      myReady: this.myReady,
      myFlair: this.profile.flair,
      flairProgress: lb.flairProgress(this.profile),
      stage: this.stage.id,
      crates: this.knownCrates(),
      target: this.target,
      party: this.party,
      rtt: this.peer?.rtt || 0,
      protocol: PROTOCOL,
      theirProtocol: this.theirProtocol,
    };
  }

  refreshLobby() {
    if (this.screens.current === 'lobby') this.screens.update(this.lobbyData());
  }

  /** Merge the history that streamed in: all of it, or after a drop whatever made it across. */
  finishHistory() {
    const h = this.histIn;
    if (!h) return;
    this.histIn = null;
    this.reportMerge(h.added + lb.mergeMatches(h.recs), h.received + h.recs.length);
  }

  reportMerge(added, received) {
    log(`history: ${received} received, ${added} new`);
    if (!added) return;
    this.screens.toast(`Merged ${added} match${added === 1 ? '' : 'es'}`, 'good');
    // New matches can unlock flair, and change every table on the board.
    if (this.screens.current === 'board') this.screens.refresh();
    else this.refreshLobby();
  }

  onMessage(msg) {
    switch (msg.t) {
      case 'hello': {
        this.theirName = String(msg.name || '').slice(0, 10).toUpperCase();
        this.theirChar = charById(msg.char).id;
        this.theirFlair = lb.flairById(msg.flair).id;
        this.theirProtocol = Number.isInteger(msg.v) && msg.v > 0 ? msg.v : 1;
        const added = lb.mergeMatches(msg.matches);
        const received = Array.isArray(msg.matches) ? msg.matches.length : 0;
        // More to come: gather it all and merge once, so thousands of matches
        // cost one storage write and one toast rather than dozens.
        const more = Math.min(Math.floor(Number(msg.more)) || 0, 10000);
        if (more > 0) this.histIn = { added, received, recs: [], expect: more };
        else this.reportMerge(added, received);
        // A build from before the protocol can't notice a mismatch at all, so
        // whichever phone can names the one that needs updating — itself
        // included.
        if (this.theirProtocol < PROTOCOL) {
          this.screens.toast(`${this.theirName || 'Your friend'}'s game is out of date`, 'warn');
        } else if (this.theirProtocol > PROTOCOL) {
          this.screens.toast('This phone\'s game is out of date', 'warn');
        }
        this.refreshLobby();
        break;
      }
      case 'hist':
        if (!this.histIn || !Array.isArray(msg.m)) break;
        // Never hold more than was announced, whatever the other end sends.
        this.histIn.recs.push(...msg.m.slice(0, this.histIn.expect - this.histIn.recs.length));
        if (msg.end) this.finishHistory();
        break;
      case 'setup':
        if (!this.peer.isHost) {
          this.stage = stageById(msg.stage);
          this.target = msg.target;
          this.party = !!msg.party;
          this.refreshLobby();
        }
        break;
      case 'pick':
        this.theirChar = charById(msg.char).id;
        if (msg.flair != null) this.theirFlair = lb.flairById(msg.flair).id;
        this.refreshLobby();
        break;
      case 'ready':
        this.theirReady = !!msg.v;
        this.refreshLobby();
        break;
      case 'start':
        if (!this.peer.isHost) this.startMatch(msg);
        break;
      case 'sp':
        if (this.peer.isHost && this.match) this.match.setInput(1, { x: this.guestInput.x, special: true });
        break;
      case 'result':
        this.pendingResult = msg.rec;
        break;
      case 'rematch':
        this.theirRematch = true;
        if (this.screens.current === 'results') {
          this.screens.show('results', {
            rec: this.screens.data.rec, view: this.view,
            wantsRematch: this.myRematch, theirRematch: true,
          });
        }
        if (this.peer.isHost && this.myRematch) this.hostStart();
        break;
      case 'emote':
        this.popEmote(EMOTES[msg.i] || '👋');
        break;
      case 'away': {
        // Their page hid or came back. Diagnostics only, for now: older
        // builds never send it, so nothing may depend on hearing it.
        const now = performance.now();
        if (msg.v) {
          this.theirHiddenAt = now;
        } else if (this.theirHiddenAt != null) {
          this.theirLastAway = { for: now - this.theirHiddenAt, back: now };
          this.theirHiddenAt = null;
        }
        log(`friend: page ${msg.v ? 'hidden' : 'visible'}`);
        break;
      }
      case 'bye':
        this.onDrop('bye');
        break;
      default:
        break;
    }
  }

  onState(msg) {
    if (!this.match) return;
    if (msg.k === 'i') {
      this.guestInput.x = msg.x;
    } else if (msg.k === 's' && !this.peer.isHost) {
      if (this.match.applySnapshot(msg)) this.lastSnapAt = this.menuTime;
    }
  }

  /** reason: 'bye', or the peer's 'timeout' | 'disconnected' | 'failed' | 'closed'. */
  onDrop(reason) {
    const drop = this.describeDrop(reason);
    this.lastDrop = drop;
    log(`drop: ${reason} · ${drop.facts.map(([k, v]) => `${k.toLowerCase()}: ${v}`).join(' · ')}`);
    this.finishHistory();
    this.stopScanner();
    audio.stopMusic();
    audio.playMusic('menu');
    this.keepAwake(false);
    this.match = null;
    if (this.peer) { this.peer.close(); this.peer = null; }
    this.go('lost', drop);
  }

  /**
   * What the Link Lost screen and the diagnostics say about a drop, taken
   * before the connection is torn down: why, at which step, how long the line
   * had been quiet, and whether either phone had left the screen — which is
   * what tells a WiFi problem from a phone that was paused.
   */
  describeDrop(reason) {
    const now = performance.now();
    const p = this.peer;
    const opened = !!p?.openedAt;
    const step = !opened ? 'handshake' : this.mode === 'match' ? 'match' : this.screens.current;
    const who = this.theirName || 'your friend';
    const Who = this.theirName || 'Your friend';
    const quiet = opened ? now - p.lastSeen : 0;
    const text = {
      bye: `${Who} left.`,
      timeout: `Nothing came through from ${who}'s phone for ${Math.round(quiet / 1000)} seconds.`,
      disconnected: `The link to ${who}'s phone went down and didn't come back.`,
      failed: opened ? `The link to ${who}'s phone failed.` : 'The two phones couldn\'t reach each other.',
      closed: `${Who}'s phone closed the connection.`,
    }[reason] || 'The connection dropped.';

    const facts = [['When', STEP_LABEL[step] || 'In the menus']];
    if (opened) {
      facts.push(
        ['Last heard', `${secs(quiet)} before`],
        ['This phone', awayText(this.hiddenAt, this.lastAway, now, false)],
        ['Their phone', awayText(this.theirHiddenAt, this.theirLastAway, now, true)],
      );
    } else if (p) {
      facts.push(['Trying for', secs(now - p.createdAt)]);
    }

    const leftScreen = this.hiddenAt != null || this.theirHiddenAt != null
      || (this.lastAway && now - this.lastAway.back < 30000)
      || (this.theirLastAway && now - this.theirLastAway.back < 30000);
    const hint = reason === 'bye' ? null : opened && leftScreen ? AWAY_HINT : WIFI_HINT;

    return {
      reason, step, text, facts, hint, wall: Date.now(),
      link: p ? this.linkSummary(p, now) : 'none',
    };
  }

  /** The connection in one line, for diagnostics. */
  linkSummary(p, now = performance.now()) {
    const age = p.openedAt ? `open ${secs(now - p.openedAt)}` : `connecting ${secs(now - p.createdAt)}`;
    return [
      p.isHost ? 'host' : 'guest',
      `${p.pc.connectionState} (ice ${p.pc.iceConnectionState})`,
      age,
      p.openedAt ? `last heard ${secs(now - p.lastSeen)} ago` : null,
      p.rtt ? `rtt ${p.rtt} ms` : null,
      p.openedAt ? `their protocol ${this.theirProtocol ?? '?'}` : null,
      p.candidates(),
    ].filter(Boolean).join(' · ');
  }

  /** The Copy diagnostics report: this phone, the link, the last drop and the event log. */
  diagnostics() {
    const r = this.renderer;
    const s = r.safe;
    const onOff = (v) => (v ? 'on' : 'off');
    const graphics = this.quality === 'low' ? 'fast' : 'full';
    const why = this.qualityPinned ? 'picked' : this.quality !== this.profile.quality ? 'switched automatically' : null;
    const d = this.lastDrop;
    const lines = [
      `RoGuPong diagnostics · ${new Date().toISOString().slice(0, 10)} ${clock()}`,
      `build: protocol ${PROTOCOL}`,
      `device: ${device()}`,
      `browser: ${navigator.userAgent}`,
      `screen: ${r.W}x${r.H} at ${window.devicePixelRatio || 1}x, canvas ${r.dpr}x · `
        + `safe area ${s.top}/${s.right}/${s.bottom}/${s.left} (top/right/bottom/left)`,
      `graphics: ${graphics}${why ? ` (${why})` : ''} · ${this.fps ? this.fps + ' fps' : 'fps not measured yet'}`,
      `audio: ${audio.ctx ? audio.ctx.state : 'not started'} · music ${onOff(this.profile.music)} · sfx ${onOff(this.profile.sfx)}`,
      `wake lock: ${this.wakeLockNote}`,
      `storage: ${this.storageNote} · ${lb.allMatches().length} matches kept`,
      `page: ${document.hidden ? 'hidden' : 'visible'} · ${navigator.onLine ? 'online' : 'offline'} · `
        + `on ${this.mode === 'match' ? 'a match' : this.screens.current || '?'}`,
      `link: ${this.peer ? this.linkSummary(this.peer) : 'none'}`,
      d ? `last drop: ${d.reason} at ${clock(d.wall)} — ${d.text}` : 'last drop: none this session',
      ...(d ? [`  ${d.facts.map(([k, v]) => `${k}: ${v}`).join(' · ')}`, `  link then: ${d.link}`] : []),
      '',
      'events:',
      ...logLines(),
    ];
    return lines.join('\n');
  }

  async copyDiagnostics() {
    const text = this.diagnostics();
    try {
      await navigator.clipboard.writeText(text);
      this.screens.toast('Diagnostics copied — paste them into your report', 'good');
    } catch {
      this.screens.revealText(text);
      this.screens.toast('Selected — long-press to copy');
    }
  }

  popEmote(glyph) {
    const el = document.getElementById('emote-pop');
    el.textContent = glyph;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    audio.blip(1000, 0.08, 'square', 0.1);
  }

  /* ------------------------------------------------------------------ */
  /* Signalling                                                          */

  async beginHost() {
    this.go('host', { stage: 'making' });
    this.screens.toast('Preparing invite…');
    try {
      const peer = await Peer.host();
      this.attachPeer(peer);
      this.showHostCode();
    } catch (err) {
      this.screens.toast('Could not start: ' + err.message, 'bad');
      this.go('connect');
    }
  }

  /**
   * The invite screen doubles as the reply scanner: the camera runs while the
   * code is showing, so once the guest holds up their reply the host only has
   * to point the phone at it — no extra tap in between.
   */
  showHostCode() {
    this.go('host', { stage: 'code', code: this.peer?.code });
    if (scannerSupported()) {
      requestAnimationFrame(() => this.startScanner((code) => this.acceptAnswer(code)));
    }
  }

  async beginJoin(offerCode) {
    this.go('join', { stage: 'making' });
    try {
      const peer = await Peer.join(offerCode);
      this.attachPeer(peer);
      this.go('join', { stage: 'reply', code: peer.code });
    } catch (err) {
      this.screens.toast('Bad code: ' + err.message, 'bad');
      this.go('join', { stage: 'scan' });
      this.startScanner((code) => this.beginJoin(code));
    }
  }

  async acceptAnswer(code) {
    try {
      await this.peer.acceptAnswer(code);
      this.stopScanner();
      this.go('host', { stage: 'waiting' });
    } catch (err) {
      this.screens.toast('Reply rejected: ' + err.message, 'bad');
      this.showHostCode();
    }
  }

  startScanner(onCode) {
    this.stopScanner();
    const video = document.getElementById('camera');
    if (!video) return;
    this.scanner = new Scanner();
    this.scanner.start(video, (code) => {
      this.stopScanner();
      audio.blip(1200, 0.1);
      if (navigator.vibrate) navigator.vibrate(40);
      onCode(code);
    }, () => { /* a frame failed to decode; the next one will do */ })
      .catch((err) => {
        this.screens.toast('Camera unavailable: ' + err.message, 'bad');
        // Don't leave a dead black preview sitting on the screen.
        document.getElementById('camera')?.remove();
      });
  }

  async shareCode(kind) {
    const code = this.peer?.code;
    if (!code || !navigator.share) return;
    try {
      // The invite travels as a link so the friend just taps it and the game
      // joins itself; the reply stays a bare code, because tapping a link
      // would navigate the host away from its own live connection.
      if (kind === 'link') {
        await navigator.share({ title: 'RoGuPong', url: inviteLink(code) });
      } else {
        await navigator.share({ text: code });
      }
    } catch { /* the user closed the share sheet */ }
  }

  async pasteFromClipboard(next) {
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      this.screens.toast('Clipboard unavailable — long-press the box and paste', 'bad');
      return;
    }
    if (next === 'use-league') {
      this.importLeague(text);
      return;
    }
    const code = extractCode(text);
    if (!CODE_RE.test(code)) {
      this.screens.toast('No RoGuPong code in the clipboard', 'bad');
      return;
    }
    if (next === 'use-answer') this.acceptAnswer(code);
    else this.beginJoin(code);
  }

  /* ------------------------------------------------------------------ */
  /* History in and out by hand                                          */

  /**
   * Make the league code before anyone taps Share — the board asks for it
   * each time it is drawn. The share sheet only opens inside the tap's user
   * gesture, which some browsers let lapse across the await deflating takes.
   */
  prepareLeague() {
    const rev = lb.historyRevision();
    if (this.league?.rev === rev) return;
    const pending = { rev, made: null };
    this.league = pending;
    league.leagueCode()
      .then((made) => { pending.made = made; })
      .catch((err) => log(`league code failed: ${err.message}`));
  }

  async shareLeague() {
    const made = this.league?.rev === lb.historyRevision() ? this.league.made : null;
    if (!made) {
      this.prepareLeague();
      this.screens.toast('Packing the league — tap again in a moment');
      return;
    }
    if (!made.count) {
      this.screens.toast('No matches to share yet', 'bad');
      return;
    }
    if (made.count < made.total) {
      this.screens.toast(`Only the newest ${made.count} matches fit in one message`, 'warn');
    }
    const text = league.leagueMessage(made);
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;      // the share sheet was closed
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      this.screens.toast('League copied — send it to your friends', 'good');
    } catch {
      this.screens.revealText(text);
      this.screens.toast('Selected — long-press to copy');
    }
  }

  async importLeague(text) {
    const code = league.findLeagueCode(text);
    if (!code) {
      this.screens.toast('No league code in there', 'bad');
      return;
    }
    let recs;
    try {
      recs = await league.readLeague(code);
    } catch (err) {
      this.screens.toast(`Can't read that league: ${err.message}`, 'bad');
      return;
    }
    const added = lb.mergeMatches(recs);
    log(`league import: ${recs.length} in the code, ${added} new`);
    this.screens.toast(added
      ? `Added ${added} match${added === 1 ? '' : 'es'}`
      : `Nothing new — you already had all ${recs.length}`, added ? 'good' : '');
    this.go('board', { tab: 'standings' });
  }

  /** The history as CSV for a bug report or balance discussion; names hidden unless asked. */
  async copyHistory(names) {
    const n = lb.allMatches().length;
    if (!n) {
      this.screens.toast('No matches yet', 'bad');
      return;
    }
    const text = league.historyCsv({ names });
    try {
      await navigator.clipboard.writeText(text);
      this.screens.toast(`${n} match${n === 1 ? '' : 'es'} copied${names ? '' : ' — names hidden'}`, 'good');
    } catch {
      this.screens.revealText(text);
      this.screens.toast('Selected — long-press to copy');
    }
  }

  stopScanner() {
    if (this.scanner) {
      this.scanner.stop();
      this.scanner = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Actions from the UI                                                 */

  handleAction(action, data) {
    switch (action) {
      case 'play':
        this.tryImmersive();
        audio.playMusic('menu');
        this.go('connect');
        break;
      case 'title':
        this.leave(false);
        this.go('title');
        break;
      case 'howto': this.go('howto'); break;
      case 'board': this.go('board', { tab: 'standings' }); break;
      case 'board-tab': this.go('board', { tab: data.tab }); break;
      // Unfolding a hero or widening the balance filter stays on the same
      // board, so it skips go() and its log line.
      case 'board-hero': {
        const d = this.screens.data;
        this.screens.update({ ...d, hero: d.hero === data.hero ? null : data.hero });
        break;
      }
      case 'board-balance': {
        const d = this.screens.data;
        this.screens.update({ ...d, allBalances: !d.allBalances });
        break;
      }
      case 'wipe':
        if (confirm('Erase all match history on this phone? Friends who hold these matches '
          + 'will pass them back the next time you connect.')) {
          lb.clearHistory();
          this.screens.refresh();
          this.screens.toast('History cleared');
        }
        break;
      case 'copy-history': this.copyHistory(data.names === 'yes'); break;
      case 'share-league': this.shareLeague(); break;
      case 'import-league': this.go('league'); break;
      case 'use-league': {
        const v = document.getElementById('paste-input')?.value;
        if (v?.trim()) this.importLeague(v);
        break;
      }
      case 'toggle-music':
        this.profile.music = !this.profile.music;
        audio.setMusic(this.profile.music);
        if (this.profile.music) audio.playMusic('menu');
        lb.saveProfile(this.profile);
        this.screens.refresh();
        break;
      case 'toggle-quality':
        // An explicit choice also stops the frame-rate watcher from second
        // guessing it later in the session.
        this.setQuality(this.quality === 'low' ? 'high' : 'low');
        this.screens.refresh();
        break;
      case 'copy-diag': this.copyDiagnostics(); break;
      case 'toggle-sfx':
        this.profile.sfx = !this.profile.sfx;
        audio.setSfx(this.profile.sfx);
        lb.saveProfile(this.profile);
        this.screens.refresh();
        break;

      case 'host': this.beginHost(); break;
      case 'join':
        if (scannerSupported()) {
          this.go('join', { stage: 'scan' });
          requestAnimationFrame(() => this.startScanner((code) => this.beginJoin(code)));
        } else {
          this.go('join', { stage: 'paste' });
        }
        break;
      case 'join-paste': this.stopScanner(); this.go('join', { stage: 'paste' }); break;
      case 'use-pasted': {
        const v = document.getElementById('paste-input')?.value.trim();
        if (v) this.beginJoin(v);
        break;
      }
      case 'paste-answer': this.stopScanner(); this.go('pasteAnswer'); break;
      case 'use-answer': {
        const v = document.getElementById('paste-input')?.value.trim();
        if (v) this.acceptAnswer(v);
        break;
      }
      case 'host-back':
        this.stopScanner();
        this.showHostCode();
        break;
      case 'copy-code': this.copyCode(); break;
      case 'share-code': this.shareCode(data.share); break;
      case 'clip-paste': this.pasteFromClipboard(data.next); break;
      case 'cancel':
        this.stopScanner();
        this.leave(true);
        this.go('connect');
        break;

      case 'pick-char':
        this.myChar = data.char;
        this.saveProfile();
        this.peer?.send({ t: 'pick', char: this.myChar, flair: this.profile.flair });
        this.refreshLobby();
        break;
      case 'pick-flair': {
        if (!lb.flairProgress(this.profile).unlocked[data.flair]) break;
        this.profile.flair = lb.flairById(data.flair).id;
        lb.saveProfile(this.profile);
        this.peer?.send({ t: 'pick', char: this.myChar, flair: this.profile.flair });
        this.refreshLobby();
        break;
      }
      case 'cycle-stage': {
        const i = STAGES.findIndex((s) => s.id === this.stage.id);
        this.stage = STAGES[(i + 1) % STAGES.length];
        this.peer?.send(this.setupMsg());
        this.refreshLobby();
        break;
      }
      case 'cycle-target': {
        const options = [5, 7, 11];
        this.target = options[(options.indexOf(this.target) + 1) % options.length];
        this.peer?.send(this.setupMsg());
        this.refreshLobby();
        break;
      }
      case 'cycle-party':
        this.party = !this.party;
        this.peer?.send(this.setupMsg());
        this.refreshLobby();
        break;
      case 'ready':
        this.myReady = !this.myReady;
        this.peer?.send({ t: 'ready', v: this.myReady });
        this.refreshLobby();
        break;
      case 'start': this.hostStart(); break;
      case 'rematch':
        this.myRematch = true;
        this.peer?.send({ t: 'rematch' });
        if (this.peer?.isHost && this.theirRematch) this.hostStart();
        else {
          this.screens.show('results', {
            rec: this.screens.data.rec, view: this.view,
            wantsRematch: true, theirRematch: this.theirRematch,
          });
        }
        break;
      case 'emote': {
        const i = Number(data.emote) || 0;
        this.popEmote(EMOTES[i]);
        this.peer?.send({ t: 'emote', i });
        break;
      }
      case 'leave':
        this.leave(true);
        this.go('title');
        break;
      default:
        break;
    }
  }

  hostStart() {
    if (!this.peer?.isHost) return;
    const setup = {
      t: 'start',
      seed: (Math.random() * 0xffffffff) >>> 0,
      stage: this.stage.id,
      target: this.target,
      party: this.party,
      chars: [this.myChar, this.theirChar],
      mid: lb.newMatchId(),
      balance: BALANCE,
    };
    this.peer.send(setup);
    this.startMatch(setup);
  }

  leave(notify) {
    this.finishHistory();
    this.stopScanner();
    if (this.peer) {
      if (notify) this.peer.send({ t: 'bye' });
      this.peer.close();
      this.peer = null;
    }
    this.match = null;
    this.finishing = false;
    this.keepAwake(false);
    audio.playMusic('menu');
  }

  async copyCode() {
    const code = this.peer?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      this.screens.toast('Code copied — send it however you like', 'good');
    } catch {
      const box = document.getElementById('rawcode');
      if (box) {
        const range = document.createRange();
        range.selectNodeContents(box);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        this.screens.toast('Selected — long-press to copy');
      }
    }
  }

  tryImmersive() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation?.lock?.('portrait'))
        .catch(() => { /* the game plays fine in a normal tab */ });
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.rogupong = new App();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline play is a bonus */ });
  }
});
