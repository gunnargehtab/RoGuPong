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
import { byId as charById } from './game/characters.js';
import { STAGES, stageById } from './game/stages.js';
import { Peer } from './net/peer.js';
import { Scanner, scannerSupported } from './net/scanner.js';
import * as lb from './data/leaderboard.js';

const SNAPSHOT_HZ = 30;
const INPUT_HZ = 30;
const HISTORY_SHARED = 80;      // how many past matches to hand the other phone

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
    this.myChar = this.profile.char;
    this.theirChar = 'gu';
    this.theirName = '';
    this.theirReady = false;
    this.myReady = false;
    this.myRematch = false;
    this.theirRematch = false;
    this.guestInput = { x: 0.5 };
    this.netAccum = 0;
    this.predictX = 0.5;
    this.lastFrame = performance.now();
    this.menuTime = 0;
    this.wakeLock = null;

    audio.setMusic(this.profile.music);
    audio.setSfx(this.profile.sfx);

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 300));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) audio.stopMusic();
      else if (this.mode === 'match') audio.playMusic('match');
      else audio.playMusic('menu');
    });

    this.go('title');
    requestAnimationFrame((t) => this.frame(t));
  }

  get view() { return this.peer && !this.peer.isHost ? 1 : 0; }

  saveProfile() {
    this.profile.char = this.myChar;
    lb.saveProfile(this.profile);
  }

  go(screen, data = {}) {
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
    const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.menuTime += dt;

    if (this.mode === 'match' && this.match) this.stepMatch(dt);
    else this.stepMenu(dt);

    requestAnimationFrame((t) => this.frame(t));
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
      m.step(dt);
      this.netAccum += dt;
      if (this.peer && this.netAccum >= 1 / SNAPSHOT_HZ) {
        this.netAccum = 0;
        this.peer.sendState(m.snapshot());
      }
    } else {
      if (this.input.takeSpecial()) this.peer.send({ t: 'sp' });
      this.netAccum += dt;
      if (this.netAccum >= 1 / INPUT_HZ) {
        this.netAccum = 0;
        this.peer.sendState({ k: 'i', x: +this.input.x.toFixed(4) });
      }
      m.extrapolate(dt);
    }

    this.predictPaddle(dt);

    for (const ev of m.drainEvents()) {
      reactTo(ev, this.fx, m.chars, audio, { accent: this.stage.accent });
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
    const half = m.paddleWidth(i) / 2;
    const target = Math.max(half, Math.min(1 - half, this.input.x));
    const max = m.paddleSpeed(i) * dt;
    this.predictX += Math.max(-max, Math.min(max, target - this.predictX));
    const server = m.paddles[i].x;
    if (Math.abs(server - this.predictX) > 0.14) this.predictX = server;
    else this.predictX += (server - this.predictX) * Math.min(1, dt * 2.5);
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

  /* ------------------------------------------------------------------ */
  /* Match lifecycle                                                     */

  startMatch({ seed, stage, target, chars, mid }) {
    this.stage = stageById(stage);
    this.target = target;
    this.matchId = mid;
    this.match = new Match({ chars, stage, target, seed });
    this.finishing = false;
    this.pendingResult = null;
    this.predictX = 0.5;
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
      lb.recordMatch(rec);
      this.pendingResult = null;
      this.keepAwake(false);
      audio.playMusic('menu');
      this.go('results', {
        rec, view: this.view, wantsRematch: false, theirRematch: this.theirRematch,
      });
    };
    tryShow();
  }

  async keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } else if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch { /* not supported, or denied — harmless */ }
  }

  /* ------------------------------------------------------------------ */
  /* Connection                                                          */

  attachPeer(peer) {
    this.peer = peer;
    peer.on('open', () => {
      audio.blip(880, 0.1);
      this.screens.toast('Connected', 'good');
      peer.send({
        t: 'hello',
        name: this.profile.name || (peer.isHost ? 'HOST' : 'GUEST'),
        char: this.myChar,
        matches: lb.allMatches().slice(-HISTORY_SHARED),
      });
      if (peer.isHost) peer.send({ t: 'setup', stage: this.stage.id, target: this.target });
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

  lobbyData() {
    return {
      isHost: this.peer.isHost,
      myChar: this.myChar,
      theirChar: this.theirChar,
      theirName: this.theirName,
      theirReady: this.theirReady,
      myReady: this.myReady,
      stage: this.stage.id,
      target: this.target,
      rtt: this.peer.rtt,
    };
  }

  refreshLobby() {
    if (this.screens.current === 'lobby') this.screens.show('lobby', this.lobbyData());
  }

  onMessage(msg) {
    switch (msg.t) {
      case 'hello': {
        this.theirName = String(msg.name || '').slice(0, 10).toUpperCase();
        this.theirChar = charById(msg.char).id;
        const added = lb.mergeMatches(msg.matches);
        if (added) this.screens.toast(`Merged ${added} match${added === 1 ? '' : 'es'}`, 'good');
        this.refreshLobby();
        break;
      }
      case 'setup':
        if (!this.peer.isHost) {
          this.stage = stageById(msg.stage);
          this.target = msg.target;
          this.refreshLobby();
        }
        break;
      case 'pick':
        this.theirChar = charById(msg.char).id;
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
      case 'bye':
        this.onDrop('Your friend left the match.');
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
      this.match.applySnapshot(msg);
    }
  }

  onDrop(reason) {
    this.stopScanner();
    audio.stopMusic();
    audio.playMusic('menu');
    this.keepAwake(false);
    this.match = null;
    if (this.peer) { this.peer.close(); this.peer = null; }
    const text = typeof reason === 'string' && reason.length > 12
      ? reason
      : 'The other phone dropped off the network.';
    this.go('lost', { reason: text });
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
      this.go('host', { stage: 'code', code: peer.code });
    } catch (err) {
      this.screens.toast('Could not start: ' + err.message, 'bad');
      this.go('connect');
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
      this.go('host', { stage: 'waiting' });
    } catch (err) {
      this.screens.toast('Reply rejected: ' + err.message, 'bad');
      this.go('host', { stage: 'code', code: this.peer.code });
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
      });
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
      case 'wipe':
        if (confirm('Erase all match history on this phone?')) {
          lb.clearHistory();
          this.screens.refresh();
          this.screens.toast('History cleared');
        }
        break;
      case 'toggle-music':
        this.profile.music = !this.profile.music;
        audio.setMusic(this.profile.music);
        if (this.profile.music) audio.playMusic('menu');
        lb.saveProfile(this.profile);
        this.screens.refresh();
        break;
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
      case 'host-scan':
        if (scannerSupported()) {
          this.go('host', { stage: 'scan' });
          requestAnimationFrame(() => this.startScanner((code) => this.acceptAnswer(code)));
        } else {
          this.go('pasteAnswer');
        }
        break;
      case 'paste-answer': this.stopScanner(); this.go('pasteAnswer'); break;
      case 'use-answer': {
        const v = document.getElementById('paste-input')?.value.trim();
        if (v) this.acceptAnswer(v);
        break;
      }
      case 'host-back':
        this.stopScanner();
        this.go('host', { stage: 'code', code: this.peer?.code });
        break;
      case 'copy-code': this.copyCode(); break;
      case 'cancel':
        this.stopScanner();
        this.leave(true);
        this.go('connect');
        break;

      case 'pick-char':
        this.myChar = data.char;
        this.saveProfile();
        this.peer?.send({ t: 'pick', char: this.myChar });
        this.refreshLobby();
        break;
      case 'cycle-stage': {
        const i = STAGES.findIndex((s) => s.id === this.stage.id);
        this.stage = STAGES[(i + 1) % STAGES.length];
        this.peer?.send({ t: 'setup', stage: this.stage.id, target: this.target });
        this.refreshLobby();
        break;
      }
      case 'cycle-target': {
        const options = [5, 7, 11];
        this.target = options[(options.indexOf(this.target) + 1) % options.length];
        this.peer?.send({ t: 'setup', stage: this.stage.id, target: this.target });
        this.refreshLobby();
        break;
      }
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
      chars: [this.myChar, this.theirChar],
      mid: lb.newMatchId(),
    };
    this.peer.send(setup);
    this.startMatch(setup);
  }

  leave(notify) {
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
