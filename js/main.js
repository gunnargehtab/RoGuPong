// RoGuPong — the conductor.
//
// Owns the screen router, the connection lifecycle and the frame loop. The
// host runs the authoritative simulation and broadcasts snapshots; the guest
// sends its paddle position, renders what it is told, and predicts only its
// own paddle so the controls never feel rubbery.

import { Screens, EMOTES, QUICK_CHAT_FROM, STALE_INVITE, madeAgo } from './ui/screens.js';
import { Renderer } from './game/render.js';
import { Input } from './game/input.js';
import { Fx, reactTo } from './game/fx.js';
import { audio } from './game/audio.js';
import { Match } from './game/match.js';
import { byId as charById, BALANCE } from './game/characters.js';
import { STAGES, stageById } from './game/stages.js';
import { itemById } from './game/items.js';
import { Peer } from './net/peer.js';
import { extractCode, inviteLink, unpackSignal, CODE_RE } from './net/sdp.js';
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
//   2  stage crates (REFLECTION, SPIRE, ARCO, AVALANCHE)
//   3  balance version 2: the narrower AEGIS barrier's position rides the
//      snapshot, and GU's midline wall is a prop older builds can't draw
//   4  a match pauses while a phone is off its screen; the hold rides the
//      snapshot
const PROTOCOL = 4;
// GU's midline wall waits for both phones to speak this: an older guest would
// see the ball bounce off nothing, to the sound and spray of a snowdrift.
const MIDLINE_SINCE = 3;
// Likewise the pause: an older phone would neither hold its match for this
// one nor count back in, and gives up on a quiet friend after 8 s regardless.
const PAUSE_SINCE = 4;
// How long the other phone may go unheard before the link is given up on. In
// play, a silent opponent is a point being lost; anywhere else nothing is, and
// a friend who is sharing their reply from a chat app needs the time.
const MATCH_SILENCE = 8000;
const LOBBY_SILENCE = 30000;
// How long a paused match waits for a phone to come back before calling it off.
const AWAY_LIMIT = 30000;
// How far back predictPaddle remembers where our own paddle has been. Sized to
// cover the whole staleness of the echoed paddle position with room to spare:
// input send interval + RTT + host frame (and its up-to-6-step backlog) +
// snapshot interval + a 30 Hz low-power-mode guest frame is ~0.25 s at worst
// on a WiFi. Online the round trip alone can be most of that, so the memory
// grows with it (predictMemory).
const PREDICT_MEMORY = 0.45;
// The lag fixes (DESIGN.md §5) work in half round trips: the guest draws the
// ball that far ahead, and the host gives the guest's saves that much grace.
// Capped, past which they would make the ball jump about more than they help.
const LAG_CAP = 0.1;
// The lobby calls the link laggy above this smoothed round trip, and stops
// below the second, so a link hovering on the line doesn't flicker the note.
const LAGGY_MS = 120;
const LAGGY_CLEAR_MS = 100;
// A handshake that has sent its reply and is connecting: after `slow` ms it
// says what to try, after `limit` it gives up with Couldn't connect rather
// than pulse forever. Online both run longer — a route through two home
// routers takes some finding.
const CONNECT_TIMES = {
  wifi: { slow: 12000, limit: 35000 },
  online: { slow: 25000, limit: 60000 },
};
// A guest waiting for the host to take its reply gets a hint after this long.
// It sets no limit of its own: online, a friend may take minutes to paste it.
const REPLY_SLOW = { wifi: 45000, online: 150000 };

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
const ONLINE_HINT = 'Some networks — mobile data especially — can\'t connect two phones directly, '
  + 'and there is no relay server in between to fall back on. Try again with one of you on a '
  + 'WiFi or a phone hotspot, and swap the codes promptly: the longer a reply waits to be '
  + 'pasted, the less likely it gets through.';
const AWAY_HINT = 'Switching apps or letting the screen lock pauses the game, and the other '
  + 'phone gives up if it stays away too long — 30 seconds, when both games are up to date. '
  + 'Keep RoGuPong on screen on both phones while you play.';
const CALLED_OFF_HINT = 'A match waits 30 seconds for a phone that leaves the screen — for a '
  + 'notification, another app or a locked screen — then calls it off. Keep RoGuPong on screen '
  + 'on both phones while you play.';

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;

/** A wait on a handshake screen: "42 s", then "3:05". */
function waited(ms) {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

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
    this.online = false;          // playing over the internet rather than a shared WiFi
    this.role = null;             // 'host' | 'guest': this phone's side, kept past a drop
    this.hs = null;               // the handshake under way: { stage, at, slow }
    this.handshakeSeq = 0;        // bumped whenever a handshake is abandoned mid-flight
    this.rejoin = null;           // back in the handshake after a drop: { name, drop }
    this.laggy = false;           // the lobby's laggy-connection note is up
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
    this.matchAt = 0;             // when this match began, for how long a phone has been away from it
    this.missedEmote = null;      // the last one that came in while this page was hidden
    this.stallShown = false;      // the hiccup toast is up, so its recovery gets one too
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
   * friend who switched apps mid-match is waited for — the match holds on
   * both phones — and a friend who went quiet because they switched apps is a
   * different problem from a WiFi that went quiet, which the Link Lost screen
   * tells apart.
   */
  onVisibility() {
    const now = performance.now();
    const hidden = document.hidden;
    if (this.peer?.connected) this.peer.send({ t: 'away', v: hidden });
    if (hidden) {
      this.hiddenAt = now;
      log('page hidden');
      audio.stopMusic();
      this.updateHold();
      return;
    }
    const since = this.hiddenAt;
    if (since != null) {
      this.lastAway = { for: now - since, back: now };
      log(`page visible after ${secs(now - since)}`);
    }
    this.hiddenAt = null;
    // The first frames back span the whole absence; they say nothing about
    // how fast this phone draws, and a match shouldn't leap across it either.
    this.fpsCount = 0;
    this.fpsSum = 0;
    this.fpsNear30 = 0;
    this.fpsSkip = 2;
    this.lastFrame = now;
    audio.resume();
    audio.playMusic(this.mode === 'match' ? 'match' : 'menu');
    if (this.wantAwake) this.keepAwake(true);
    this.peer?.backOnScreen();
    this.offerPaste();
    if (this.missedEmote) {
      const { i, theirs } = this.missedEmote;
      this.missedEmote = null;
      setTimeout(() => this.popEmote(i, theirs), 300);
    }
    // Away past the limit: the other phone has called the match off, or is
    // about to — whether or not word of it has arrived yet.
    if (since != null && this.canPause() && now - Math.max(since, this.matchAt) > AWAY_LIMIT) {
      this.callOff(this.view);
      return;
    }
    this.updateHold();
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
    // Never below zero: onVisibility restarts the clock, and a frame's
    // timestamp can predate that.
    const dt = Math.max(0, Math.min(0.25, (now - this.lastFrame) / 1000));
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
    this.watchHandshake();
  }

  stepMatch(dt) {
    const m = this.match;
    const isHost = !this.peer || this.peer.isHost;
    this.input.update(dt);

    if (isHost) {
      m.setInput(0, { x: this.input.x, special: this.input.takeSpecial() });
      m.setInput(1, { x: this.guestInput.x });
      // The guest's paddle reaches us half a round trip late, so its saves
      // get that much grace.
      m.grace[1] = this.peer ? this.halfTrip() : 0;

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
      if (ev.t === 'special' && ev.p === this.view && !this.profile.tapLearned) {
        // Fired one: the TAP PADDLE hint has done its job for good.
        this.profile.tapLearned = true;
        this.saveProfile();
      }
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
      showTouchHint: !this.input.touched && m.phase === 'countdown' && !m.holding,
      showTapHint: !this.profile.tapLearned && m.phase === 'play' && !m.holding && m.meter[this.view] >= 1,
    });

    if (m.phase === 'over' && !this.finishing) this.finishMatch();
    else this.watchAway();
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
    const memory = this.predictMemory();
    log.push({ t: this.menuTime, x: this.predictX });
    while (log.length && log[0].t < this.menuTime - memory) log.shift();

    // No fresh authority, no correction: during a snapshot stall the echo is
    // frozen, and on the host (which never applies snapshots) the simulation
    // chases the same finger this does — either way there is nothing to learn.
    if (this.menuTime - this.lastSnapAt > memory) return;

    let lo = this.predictX, hi = this.predictX;
    for (const h of log) { if (h.x < lo) lo = h.x; else if (h.x > hi) hi = h.x; }
    const server = p.x;
    const err = server < lo ? server - lo : server > hi ? server - hi : 0;
    if (Math.abs(err) > 0.14) this.predictX = server;
    else if (err) this.predictX += err * Math.min(1, dt * 2.5);
  }

  /**
   * How far back predictPaddle's memory reaches: the echo is a round trip
   * stale plus the send intervals and frames around it, so a slow link needs
   * a longer memory or ordinary lag starts reading as desync.
   */
  predictMemory() {
    return Math.max(PREDICT_MEMORY, (this.peer?.rttAvg || 0) / 1000 + 0.2);
  }

  /** Half the smoothed round trip, in seconds: how late the guest sees the court. */
  halfTrip() {
    return Math.min(LAG_CAP, (this.peer?.rttAvg || 0) / 2000);
  }

  /** The match's opening countdown, and a paused match's counting back in. */
  countdownBeeps(m) {
    const t = m.resume > 0 ? m.resume : m.phase === 'countdown' && !m.paused ? m.phaseTime : null;
    if (t == null) {
      // Back in mid-point, there is no serve to say the ball is moving.
      if (this.resuming && m.phase === 'play' && !m.paused) audio.count(0);
      this.lastBeep = null;
      this.resuming = false;
      return;
    }
    this.resuming = m.resume > 0;
    const n = Math.ceil(t);
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
    // never has to travel — and likewise for GU's midline wall.
    this.match = new Match({
      chars, stage, target, seed, party,
      items: this.stageCrates(this.stage),
      midline: this.sharedProtocol() >= MIDLINE_SINCE,
    });
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
    // Started with a phone already away — a rematch the guest asked for
    // before switching apps — it waits for them from the first second.
    this.matchAt = performance.now();
    this.updateHold();
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
  /* Pausing for a phone that left the screen                            */

  /** A match in play that can hold for an absent phone: both builds must know how. */
  canPause() {
    return this.mode === 'match' && !!this.match && !!this.peer && !this.finishing
      && this.match.phase !== 'over' && this.sharedProtocol() >= PAUSE_SINCE;
  }

  /**
   * Hold the match while either phone is off its screen, and put the pause
   * screen up on this one while it waits for the other. Called whenever
   * either page hides or comes back. The host's hold is the one that counts
   * and rides its snapshots; a guest holds its own copy meanwhile, so nothing
   * drifts in the moments before the host's word arrives.
   */
  updateHold() {
    const m = this.match;
    if (!this.canPause()) return;
    const was = m.paused;
    m.hold(this.hiddenAt != null || this.theirHiddenAt != null);
    if (m.paused !== was) log(m.paused ? 'match paused' : 'match resuming');
    const waiting = this.theirHiddenAt != null;
    if (waiting && this.screens.current !== 'paused') {
      this.screens.show('paused', { name: this.theirName, left: Math.ceil(this.awayLeft() / 1000) });
    } else if (!waiting && this.screens.current === 'paused') {
      this.screens.hide();
    }
  }

  /** Milliseconds before a match waiting for the other phone is called off. */
  awayLeft() {
    return AWAY_LIMIT - (performance.now() - Math.max(this.theirHiddenAt, this.matchAt));
  }

  /** Each frame of a match: tick the pause screen down, and call time on it. */
  watchAway() {
    if (this.theirHiddenAt == null || !this.canPause()) return;
    const left = this.awayLeft();
    if (left <= 0) this.callOff(1 - this.view);
    else this.screens.tickPause(Math.ceil(left / 1000));
  }

  /**
   * A phone stayed away past AWAY_LIMIT: the match is off. Both phones keep
   * the clock, so whichever notices first says so, naming who was away.
   */
  callOff(p) {
    log(`match called off: ${p === this.view ? 'this phone' : 'the other phone'} away too long`);
    this.peer?.send({ t: 'bye', why: 'away', p });
    this.onDrop(p === this.view ? 'away-self' : 'away');
  }

  /**
   * How long the other phone may go unheard, where the players are now. A
   * friend who went away mid-match is waited for by the pause, which calls
   * the match off itself — the heartbeat only steps in a little after it.
   */
  linkPatience() {
    if (this.mode !== 'match') return LOBBY_SILENCE;
    if (this.theirHiddenAt != null && this.canPause()) return AWAY_LIMIT + 5000;
    return MATCH_SILENCE;
  }

  /* ------------------------------------------------------------------ */
  /* Connection                                                          */

  attachPeer(peer) {
    this.peer = peer;
    this.theirHiddenAt = null;
    this.theirLastAway = null;
    this.missedEmote = null;
    this.laggy = false;
    peer.patience = () => this.linkPatience();
    this.keepAwake(true);
    audio.setDucked(peer.online);
    log(`${peer.isHost ? 'hosting' : 'joining'}${peer.online ? ' online' : ''}: code ready`);
    peer.on('rtt', () => this.onRtt());
    peer.on('stall', () => {
      log('link: stalled, waiting for it to come back');
      // A friend who left the screen takes their end of the link with them
      // (iOS parks the whole page): expected, not a hiccup.
      this.stallShown = this.theirHiddenAt == null;
      if (this.stallShown) this.screens.toast('Connection hiccup — hold on…', 'warn');
    });
    peer.on('recover', (ms) => {
      log(`link: back after ${secs(ms)}`);
      if (this.stallShown) this.screens.toast('Connection back', 'good');
      this.stallShown = false;
    });
    peer.on('open', () => {
      this.stopScanner();
      audio.blip(880, 0.1);
      this.screens.toast(this.rejoin ? 'Reconnected' : 'Connected', 'good');
      this.hs = null;
      this.rejoin = null;
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
      theirAway: this.theirHiddenAt != null,
      myReady: this.myReady,
      myFlair: this.profile.flair,
      flairProgress: lb.flairProgress(this.profile),
      stage: this.stage.id,
      crates: this.knownCrates(),
      target: this.target,
      party: this.party,
      rtt: this.peer?.rtt || 0,
      laggy: this.laggy,
      online: this.online,
      protocol: PROTOCOL,
      theirProtocol: this.theirProtocol,
    };
  }

  refreshLobby() {
    if (this.screens.current === 'lobby') this.screens.update(this.lobbyData());
  }

  /**
   * A heartbeat came back. The lobby's latency figure follows it in place,
   * and its laggy-connection note comes and goes with the smoothed figure.
   */
  onRtt() {
    const avg = this.peer?.rttAvg || 0;
    const laggy = avg > (this.laggy ? LAGGY_CLEAR_MS : LAGGY_MS);
    if (laggy !== this.laggy) {
      this.laggy = laggy;
      log(`link: ${laggy ? 'laggy' : 'no longer laggy'} at ${Math.round(avg)} ms`);
      this.refreshLobby();
    } else if (this.screens.current === 'lobby') {
      this.screens.tickLobby(this.peer.rtt);
    }
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
        this.popEmote(Number.isInteger(msg.i) ? msg.i : -1, true);
        break;
      case 'away': {
        // Their page hid or came back. It holds a match when both builds
        // speak PAUSE_SINCE, and tells the Link Lost screen a paused phone
        // from a lost WiFi. Builds from before it never send it, so nothing
        // else may depend on hearing it.
        const now = performance.now();
        if (msg.v) {
          if (this.theirHiddenAt == null) this.theirHiddenAt = now;
        } else if (this.theirHiddenAt != null) {
          this.theirLastAway = { for: now - this.theirHiddenAt, back: now };
          this.theirHiddenAt = null;
        }
        log(`friend: page ${msg.v ? 'hidden' : 'visible'}`);
        this.updateHold();
        this.refreshLobby();
        break;
      }
      case 'bye':
        // A match called off for a phone that stayed away says which one.
        if (msg.why === 'away') this.onDrop(msg.p === this.view ? 'away-self' : 'away');
        else this.onDrop('bye');
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
      // A host off its screen sends nothing, so a snapshot arriving meanwhile
      // left before it did — overtaking its 'away' on the other channel — and
      // would set a held court moving again.
      if (this.theirHiddenAt != null && this.canPause()) return;
      const m = this.match;
      // Half a round trip old by now: the balls are drawn that far ahead.
      if (!m.applySnapshot(msg, this.halfTrip())) return;
      this.lastSnapAt = this.menuTime;
      // Paused with both phones on screen: the host has yet to hear that this
      // one is back. Keep counting in rather than flicker back to a pause.
      if (m.paused && this.hiddenAt == null && this.canPause()) m.hold(false);
    }
  }

  /**
   * reason: 'bye'; 'away' or 'away-self' for a match called off because the
   * other phone or this one stayed away too long; 'timeout' for a handshake
   * that never connected; or the peer's 'timeout' | 'disconnected' |
   * 'failed' | 'closed'.
   *
   * A handshake that never connected ends on Couldn't connect, with a Try
   * again. A link that was up and went down unasked goes straight back into
   * the handshake (beginRejoin); one the friend ended, or a match called off,
   * lands on Link Lost with a Reconnect button.
   */
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
    this.hs = null;
    this.handshakeSeq++;
    if (this.peer) { this.peer.close(); this.peer = null; }
    audio.setDucked(false);
    if (drop.auto) this.beginRejoin();
    else this.go('lost', drop);
  }

  /**
   * What the Link Lost screen and the diagnostics say about a drop, taken
   * before the connection is torn down: why, at which step, how long the line
   * had been quiet, and whether either phone had left the screen — which is
   * what tells a WiFi problem from a phone that was paused. `next` is the way
   * on the screen offers: 'retry' a handshake that never connected, or
   * 'rejoin' a friend who was connected; `auto` takes that way at once.
   */
  describeDrop(reason) {
    const now = performance.now();
    const p = this.peer;
    const opened = !!p?.openedAt;
    const step = !opened ? 'handshake' : this.mode === 'match' ? 'match' : this.screens.current;
    const who = this.theirName || 'your friend';
    const Who = this.theirName || 'Your friend';
    const quiet = opened ? now - p.lastSeen : 0;
    const limit = AWAY_LIMIT / 1000;
    const calledOff = reason === 'away' || reason === 'away-self';

    let text;
    if (!opened) {
      // The friend's name only arrives once connected, so no names here.
      const host = p ? p.isHost : this.role === 'host';
      text = this.online
        ? (host ? 'Couldn\'t connect over the internet.'
          : 'Couldn\'t connect over the internet — or the host never got your reply.')
        : (host ? 'The two phones couldn\'t reach each other.'
          : 'The connection never came up. Did the host scan your reply?');
    } else {
      text = {
        bye: `${Who} left.`,
        away: `${Who} left the game for over ${limit} seconds, so the match was called off.`,
        'away-self': `You left the game for over ${limit} seconds, so the match was called off.`,
        timeout: `Nothing came through from ${who}'s phone for ${Math.round(quiet / 1000)} seconds.`,
        disconnected: `The link to ${who}'s phone went down and didn't come back.`,
        failed: `The link to ${who}'s phone failed.`,
        closed: `${Who}'s phone closed the connection.`,
      }[reason] || 'The connection dropped.';
    }

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
    facts.push(['Playing', this.online ? 'Online' : 'On the same WiFi']);

    const leftScreen = this.hiddenAt != null || this.theirHiddenAt != null
      || (this.lastAway && now - this.lastAway.back < 30000)
      || (this.theirLastAway && now - this.theirLastAway.back < 30000);
    const netHint = this.online ? ONLINE_HINT : WIFI_HINT;
    const hint = reason === 'bye' ? null : calledOff ? CALLED_OFF_HINT
      : opened && leftScreen ? AWAY_HINT : netHint;

    return {
      reason, step, text, facts, hint, wall: Date.now(),
      title: calledOff ? 'CALLED OFF' : opened ? 'LINK LOST' : 'COULDN\'T CONNECT',
      next: opened ? 'rejoin' : 'retry',
      auto: opened && reason !== 'bye' && !calledOff,
      link: p ? this.linkSummary(p, now) : 'none',
    };
  }

  /**
   * Straight back into the handshake after a drop, on the same side — the
   * host making a fresh invite, the guest ready to take it — with the stage,
   * the rules and both picks as they were, so picking up where they left off
   * takes one scan on each phone rather than the trip through the menus. The
   * screens say what happened, and Leave gives up.
   */
  beginRejoin() {
    this.rejoin = { name: this.theirName, drop: this.lastDrop };
    log(`reconnecting as ${this.role}`);
    this.retryHandshake();
  }

  /** Start this phone's side of the handshake over. */
  retryHandshake() {
    if (this.role === 'host') this.beginHost();
    else this.openJoin();
  }

  /** Couldn't connect, for an online invite that found no internet address to put in it. */
  noInternet() {
    const drop = {
      reason: 'no-internet', step: 'handshake', wall: Date.now(), next: 'retry', link: 'none',
      title: 'NO INTERNET',
      text: 'This phone couldn\'t find its address on the internet, so there was nothing to put in an invite.',
      facts: [['When', 'Making an online invite']],
      hint: 'Check this phone is online — a WiFi with no internet behind it won\'t do — and try again. '
        + 'On the same WiFi as your friend? Pick Same WiFi instead: it needs no internet at all.',
    };
    this.lastDrop = drop;
    return drop;
  }

  /** The connection in one line, for diagnostics. */
  linkSummary(p, now = performance.now()) {
    const age = p.openedAt ? `open ${secs(now - p.openedAt)}` : `connecting ${secs(now - p.createdAt)}`;
    return [
      `${p.isHost ? 'host' : 'guest'}${p.online ? ' online' : ''}`,
      `${p.pc.connectionState} (ice ${p.pc.iceConnectionState})`,
      age,
      p.openedAt ? `last heard ${secs(now - p.lastSeen)} ago` : null,
      p.rtt ? `rtt ${p.rtt} ms (avg ${Math.round(p.rttAvg)})` : null,
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
        + `on ${this.mode === 'match' ? (this.match?.holding ? 'a paused match' : 'a match') : this.screens.current || '?'}`,
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

  /**
   * Pop emote i, sent by the other phone or by this one. A quick-chat line
   * comes in a speech bubble saying who it is from; an index this build
   * doesn't know — a newer phone's — pops as a wave. One that arrives while
   * this page is hidden would play to nobody, so the latest waits for the
   * page to come back.
   */
  popEmote(i, theirs) {
    if (document.hidden) {
      if (theirs) this.missedEmote = { i, theirs };
      return;
    }
    const el = document.getElementById('emote-pop');
    const say = i >= QUICK_CHAT_FROM && i < EMOTES.length;
    el.classList.remove('show');
    el.classList.toggle('say', say);
    if (say) {
      const who = document.createElement('small');
      who.textContent = theirs ? this.theirName || 'FRIEND' : 'YOU';
      el.replaceChildren(who, EMOTES[i]);
    } else {
      el.textContent = EMOTES[i] || '👋';
    }
    void el.offsetWidth;
    el.classList.add('show');
    audio.blip(1000, 0.08, 'square', 0.1);
  }

  /* ------------------------------------------------------------------ */
  /* Signalling                                                          */

  /** What every handshake screen is told besides its stage. */
  signalData(data) {
    return { ...data, online: this.online, rejoin: this.rejoin, slow: !!this.hs?.slow };
  }

  async beginHost() {
    const ticket = ++this.handshakeSeq;
    this.role = 'host';
    this.hs = null;
    this.go('host', this.signalData({ stage: 'making' }));
    this.screens.toast(this.online ? 'Preparing online invite…' : 'Preparing invite…');
    try {
      const peer = await Peer.host({ online: this.online });
      // Cancelled while the invite was being made.
      if (ticket !== this.handshakeSeq) { peer.close(); return; }
      this.attachPeer(peer);
      this.hs = { stage: 'invite', at: performance.now() };
      this.showHostCode();
    } catch (err) {
      if (ticket !== this.handshakeSeq) return;
      if (err.code === 'no-internet') {
        this.go('lost', this.noInternet());
        return;
      }
      this.screens.toast('Could not start: ' + err.message, 'bad');
      this.go('connect', { online: this.online });
    }
  }

  /**
   * The invite screen doubles as the reply scanner: the camera runs while the
   * code is showing, so once the guest holds up their reply the host only has
   * to point the phone at it — no extra tap in between. Online there is no
   * one to point it at; the reply comes back through a chat app, and the
   * invite screen has the box to paste it into.
   */
  showHostCode() {
    this.go('host', this.signalData({ stage: 'code', code: this.peer?.code }));
    if (!this.online && scannerSupported()) {
      requestAnimationFrame(() => this.startScanner((code) => this.acceptAnswer(code)));
    }
  }

  /** The guest's first step: the camera on the host's invite, or a box to paste it into. */
  openJoin() {
    this.role = 'guest';
    this.hs = null;
    if (!this.online && scannerSupported()) {
      this.go('join', this.signalData({ stage: 'scan' }));
      requestAnimationFrame(() => this.startScanner((code) => this.beginJoin(code)));
    } else {
      this.go('join', this.signalData({ stage: 'paste' }));
    }
  }

  async beginJoin(offerCode) {
    const ticket = ++this.handshakeSeq;
    this.role = 'guest';
    this.hs = null;
    this.go('join', this.signalData({ stage: 'making' }));
    try {
      const peer = await Peer.join(offerCode);
      if (ticket !== this.handshakeSeq) { peer.close(); return; }
      // The invite says where the players are: one made for online play makes
      // this an online game, whichever way this phone came to it.
      this.online = peer.online;
      this.attachPeer(peer);
      this.hs = { stage: 'reply', at: performance.now() };
      if (peer.inviteAt != null) log(`invite made ${madeAgo(Date.now() - peer.inviteAt)}`);
      this.go('join', this.signalData({ stage: 'reply', code: peer.code, inviteAt: peer.inviteAt }));
    } catch (err) {
      if (ticket !== this.handshakeSeq) return;
      this.screens.toast('Bad code: ' + err.message, 'bad');
      this.openJoin();
    }
  }

  async acceptAnswer(code) {
    const peer = this.peer;
    if (!peer || peer.connected) return;
    // Easily done online: copy the invite link to send, then paste it back.
    if (extractCode(code) === peer.code) {
      this.screens.toast('That\'s your own invite — paste your friend\'s reply', 'bad');
      return;
    }
    try {
      await peer.acceptAnswer(code);
      if (peer !== this.peer || peer.connected) return;
      this.stopScanner();
      this.hs = { stage: 'connecting', at: performance.now() };
      this.go('host', this.signalData({ stage: 'waiting' }));
    } catch (err) {
      if (peer !== this.peer) return;
      this.screens.toast('Reply rejected: ' + err.message, 'bad');
      this.showHostCode();
    }
  }

  /**
   * Each menu frame of a handshake: keep its status line current, say what
   * to try once it has taken a while, and give up on connecting past the
   * limit rather than pulse forever. An online invite that has sat unanswered
   * a long time is flagged, since it may no longer reach this phone.
   */
  watchHandshake() {
    const hs = this.hs;
    const p = this.peer;
    if (!hs || !p || p.connected || p.closed) return;
    const ms = performance.now() - hs.at;
    const mode = this.online ? 'online' : 'wifi';
    let slowAfter = Infinity;
    let status = null;
    if (hs.stage === 'connecting') {
      const t = CONNECT_TIMES[mode];
      if (ms > t.limit) {
        this.onDrop('timeout');
        return;
      }
      slowAfter = t.slow;
      const ice = p.pc.iceConnectionState;
      status = `${ice === 'connected' || ice === 'completed' ? 'Securing the link' : 'Connecting'} · ${waited(ms)}`;
    } else if (hs.stage === 'reply') {
      slowAfter = REPLY_SLOW[mode];
      status = `${this.online ? 'Waiting for them to paste it' : 'Waiting for the host'} · ${waited(ms)}`;
    } else if (hs.stage === 'invite' && this.online) {
      slowAfter = STALE_INVITE;
      status = `Waiting for their reply · invite made ${madeAgo(ms)}`;
    }
    if (!hs.slow && ms > slowAfter) {
      hs.slow = true;
      log(`handshake: slow at the ${hs.stage} step`);
      this.screens.showLater();
    }
    if (status) this.screens.tickStatus(status);
  }

  /**
   * The online host is back from the chat app it sent the invite through, and
   * the friend's reply may be on the clipboard. Where the browser lets a page
   * read it unasked — once the player has allowed it — it is taken at once;
   * everywhere else the Paste button is lit up, one tap away.
   */
  async offerPaste() {
    const d = this.screens.data;
    if (!this.online || this.screens.current !== 'host' || d?.stage !== 'code') return;
    this.screens.nudgePaste();
    let granted = false;
    try {
      granted = (await navigator.permissions.query({ name: 'clipboard-read' })).state === 'granted';
    } catch { /* this browser can't say; only a tap reads the clipboard */ }
    if (!granted) return;
    let text;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    // Whatever else is on the clipboard — this phone's own invite, a link,
    // last week's code — is none of the game's business.
    const code = extractCode(text);
    if (!CODE_RE.test(code) || code === this.peer?.code) return;
    try {
      if ((await unpackSignal(code)).role !== 'answer') return;
    } catch {
      return;
    }
    log('handshake: reply taken from the clipboard');
    this.acceptAnswer(code);
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
      // would navigate the host away from its own live connection. Online,
      // each says in a line what it is for, since it arrives in a chat.
      if (kind === 'link') {
        await navigator.share(this.online
          ? { title: 'RoGuPong', text: 'Play RoGuPong with me! Tap to join:', url: inviteLink(code) }
          : { title: 'RoGuPong', url: inviteLink(code) });
      } else {
        await navigator.share({ text: this.online ? this.replyMessage(code) : code });
      }
    } catch { /* the user closed the share sheet */ }
  }

  /** An online reply as a chat message: a line for the friend, then the code the paste box finds in it. */
  replyMessage(code) {
    return `My RoGuPong reply — paste it into your game:\n${code}`;
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
        this.go('connect', { online: this.online });
        break;
      case 'connect-mode':
        this.online = data.mode === 'online';
        this.go('connect', { online: this.online });
        break;
      case 'title':
        this.leave(false);
        this.rejoin = null;
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
      case 'join': this.openJoin(); break;
      case 'join-paste': this.stopScanner(); this.go('join', this.signalData({ stage: 'paste' })); break;
      case 'use-pasted': {
        const v = document.getElementById('paste-input')?.value.trim();
        if (v) this.beginJoin(v);
        break;
      }
      case 'paste-answer': this.stopScanner(); this.go('pasteAnswer', this.signalData({})); break;
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
        this.rejoin = null;
        this.go('connect', { online: this.online });
        break;
      // Couldn't connect's Try again, or a slow handshake's fresh start: the
      // same side over again, in the same mode.
      case 'retry':
        this.leave(false);
        this.retryHandshake();
        break;
      case 'rejoin': this.beginRejoin(); break;

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
        this.popEmote(i, false);
        this.peer?.send({ t: 'emote', i });
        break;
      }
      case 'leave':
        this.leave(true);
        this.rejoin = null;
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
    // Any handshake still being made is abandoned with it.
    this.handshakeSeq++;
    this.hs = null;
    if (this.peer) {
      if (notify) this.peer.send({ t: 'bye' });
      this.peer.close();
      this.peer = null;
    }
    this.match = null;
    this.finishing = false;
    this.keepAwake(false);
    audio.setDucked(false);
    audio.playMusic('menu');
  }

  async copyCode() {
    const code = this.peer?.code;
    if (!code) return;
    // Online, an invite pasted into a chat should arrive as a link to tap.
    const invite = this.online && this.peer.isHost;
    const text = !this.online ? code : invite ? inviteLink(code) : this.replyMessage(code);
    try {
      await navigator.clipboard.writeText(text);
      this.screens.toast(!this.online ? 'Code copied — send it however you like'
        : invite ? 'Invite copied — paste it into your chat' : 'Reply copied — send it back to your friend', 'good');
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
