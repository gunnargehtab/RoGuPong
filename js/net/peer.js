// RoGuPong — the link between the two phones.
//
// Direct WebRTC, no game server anywhere: the two handsets talk straight to
// each other across the WiFi — or, online, across the internet, with no relay
// in between. Two data channels ride the same connection:
//
//   'ctl'    reliable + ordered — menus, character picks, scores, emotes,
//            the match history
//   'state'  unreliable + unordered — 30 Hz simulation snapshots and inputs,
//            where a late packet is worth less than the next one

import { packSignal, unpackSignal } from './sdp.js';
import { log } from '../diag.js';

const ICE_SERVERS = [
  // What online play connects through: each phone asks where the internet
  // sees it, and that address goes in its code. On the same WiFi the local
  // (host) candidates win and these are never used.
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const GATHER_TIMEOUT_MS = 3000;
const GATHER_SETTLE_MS = 400;
// Online, the code is worth nothing without the internet address, and a STUN
// answer over mobile data can take a few seconds to come back.
const ONLINE_GATHER_TIMEOUT_MS = 8000;
// Unsent state bytes allowed to queue before new packets are dropped at the
// source — about five snapshots, past which the radio is stalling and every
// queued packet is stale by the time it leaves.
const STATE_BACKLOG_MAX = 4096;
// How much of a paced run may wait in the reliable channel at once: a few
// history chunks, so a message sent meanwhile queues behind milliseconds of
// data rather than the whole run.
const PACED_BACKLOG = 32768;
const HEARTBEAT_MS = 1500;
// This long without a word from the other phone and it is given up on — unless
// the app says how patient to be where the players are (Peer.patience).
const SILENCE_MS = 8000;
// How long a link WebRTC calls 'disconnected' gets to come back, at the least.
// The state is meant to be temporary — a WiFi power-save stall, a router blip,
// the other phone's radio napping — and usually clears by itself within seconds.
const DISCONNECT_GRACE_MS = 10000;

function waitForIceGathering(pc, online) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let settle = null;
    let reflexive = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      pc.removeEventListener('icecandidate', onCandidate);
      clearTimeout(timer);
      clearTimeout(settle);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
    // Local candidates arrive within milliseconds and STUN ones, when the
    // internet is reachable at all, a couple hundred more; once the list has
    // been quiet for a beat it is as complete as it is going to get. Without
    // this, an internet-less WiFi — the network this game is for — only ever
    // reaches 'complete' by burning the whole timeout, on both phones. Online,
    // the quiet only counts once the internet address has turned up.
    const onCandidate = (ev) => {
      if (!ev.candidate) return;
      if (/ typ srflx/.test(ev.candidate.candidate)) reflexive = true;
      if (online && !reflexive) return;
      clearTimeout(settle);
      settle = setTimeout(finish, GATHER_SETTLE_MS);
    };
    pc.addEventListener('icegatheringstatechange', check);
    pc.addEventListener('icecandidate', onCandidate);
    const timer = setTimeout(finish, online ? ONLINE_GATHER_TIMEOUT_MS : GATHER_TIMEOUT_MS);
  });
}

export class Peer {
  constructor(role, online = false) {
    this.role = role;                 // 'host' | 'guest'
    this.isHost = role === 'host';
    this.online = online;         // made for online play, over the internet
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 });
    this.ctl = null;
    this.state = null;
    this.listeners = new Map();
    this.connected = false;
    this.closed = false;
    this.createdAt = performance.now();
    this.openedAt = 0;            // when the channels opened; 0 while still connecting
    this.lastSeen = 0;
    this.rtt = 0;                 // the latest round trip, in ms
    this.rttAvg = 0;              // ... smoothed, for anything that adjusts to it
    this.stalledAt = 0;           // when the link went 'disconnected'; 0 while it is up
    this.judgeFrom = 0;           // no verdicts before this: the page just came back
    // Milliseconds of silence to put up with. The app swaps in its own: how
    // patient to be depends on whether a match is on.
    this.patience = () => SILENCE_MS;

    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc.connectionState;
      if (this.closed) return;
      log(`link: ${s}`);
      this.emit('status', s);
      if (s === 'disconnected') this.startGrace();
      else if (s === 'connected') this.endGrace();
      // An online reply goes back through a chat app, which can take minutes,
      // and the guest's browser gives up checking after about 15 s with no
      // answer from the host's router. It isn't final, though: a check from
      // the host, once it has the reply, still gets through and brings the
      // link up. So an online handshake stays open until the app gives up.
      else if (s === 'failed' && this.online && !this.openedAt) return;
      else if (s === 'failed' || s === 'closed') this.handleDrop(s);
    });
    this.pc.addEventListener('iceconnectionstatechange', () => {
      if (!this.closed) log(`ice: ${this.pc.iceConnectionState}`);
    });
  }

  /* -------- events -------- */

  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(fn);
    return () => this.listeners.get(name).delete(fn);
  }

  emit(name, ...args) {
    const set = this.listeners.get(name);
    if (set) for (const fn of [...set]) fn(...args);
  }

  /* -------- setup -------- */

  /** Throws with err.code 'no-internet' when an online invite finds no internet address. */
  static async host({ online = false } = {}) {
    const peer = new Peer('host', online);
    peer.ctl = peer.pc.createDataChannel('ctl', { ordered: true });
    peer.state = peer.pc.createDataChannel('state', {
      ordered: false, maxRetransmits: 0, negotiated: false,
    });
    peer.wireChannel(peer.ctl);
    peer.wireChannel(peer.state);

    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      await waitForIceGathering(peer.pc, online);
      peer.code = await packSignal(peer.pc.localDescription.sdp, 'offer', { online });
    } catch (err) {
      log(`invite failed: ${err.code || err.message} · ${peer.candidates()}`);
      peer.close();
      throw err;
    }
    peer.logGathered();
    return peer;
  }

  /**
   * The guest's half. An invite made for online play makes this an online
   * peer too; `inviteAt` is when the invite was made (null if it doesn't say).
   */
  static async join(offerCode) {
    const { role, sdp, online, at } = await unpackSignal(offerCode);
    if (role !== 'offer') throw new Error('that code is a reply, not an invite');

    const peer = new Peer('guest', online);
    peer.inviteAt = at;
    peer.pc.addEventListener('datachannel', (ev) => {
      if (ev.channel.label === 'ctl') peer.ctl = ev.channel;
      else peer.state = ev.channel;
      peer.wireChannel(ev.channel);
    });

    try {
      await peer.pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await waitForIceGathering(peer.pc, online);
      peer.code = await packSignal(peer.pc.localDescription.sdp, 'answer', { online });
    } catch (err) {
      peer.close();
      throw err;
    }
    peer.logGathered();
    return peer;
  }

  /** Host side: finish the handshake with the reply scanned off the guest. */
  async acceptAnswer(answerCode) {
    const { role, sdp } = await unpackSignal(answerCode);
    if (role !== 'answer') throw new Error('that code is an invite, not a reply');
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  logGathered() {
    const secs = ((performance.now() - this.createdAt) / 1000).toFixed(1);
    log(`${this.online ? 'online ' : ''}${this.isHost ? 'invite' : 'reply'} ready in ${secs} s · ${this.candidates()}`);
  }

  wireChannel(ch) {
    ch.binaryType = 'arraybuffer';
    ch.addEventListener('open', () => {
      if (this.ctl && this.ctl.readyState === 'open' && !this.connected) {
        this.connected = true;
        this.openedAt = this.lastSeen = performance.now();
        log(`link: open after ${((this.openedAt - this.createdAt) / 1000).toFixed(1)} s · ${this.candidates()}`);
        this.startHeartbeat();
        this.emit('open');
      }
    });
    ch.addEventListener('close', () => this.handleDrop('closed'));
    ch.addEventListener('message', (ev) => {
      this.lastSeen = performance.now();
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.t === 'ping') { this.raw(this.ctl, { t: 'pong', n: msg.n }); return; }
      if (msg.t === 'pong') { this.measured(performance.now() - msg.n); return; }
      if (ch.label === 'state') this.emit('state', msg);
      else this.emit('msg', msg);
    });
  }

  /**
   * A heartbeat came back after `ms`. The smoothed figure is what the lag
   * fixes lean on, so one slow ping — a busy frame on the other phone, a
   * history chunk queued ahead of it — moves it only a little.
   */
  measured(ms) {
    this.rtt = Math.round(ms);
    this.rttAvg = this.rttAvg ? this.rttAvg * 0.75 + ms * 0.25 : ms;
    this.emit('rtt', this.rtt);
  }

  /**
   * Ping every HEARTBEAT_MS, and give the link up once the other phone has
   * been quiet for longer than the app's patience. A hidden page passes no
   * verdicts at all: its timers are throttled or stopped, and whatever it
   * missed meanwhile is still on its way in.
   */
  startHeartbeat() {
    clearInterval(this.hb);
    this.hb = setInterval(() => {
      if (this.closed) return;
      const now = performance.now();
      this.raw(this.ctl, { t: 'ping', n: now });
      if (document.hidden || now < this.judgeFrom || now - this.lastSeen <= this.patience()) return;
      // A link that is down gets its grace however patient the app is.
      if (!this.stalledAt) this.handleDrop('timeout');
      else if (now - this.stalledAt > DISCONNECT_GRACE_MS) this.handleDrop('disconnected');
    }, HEARTBEAT_MS);
  }

  /**
   * This page is back on screen. Replies to its pings, and whatever else it
   * missed, may take a moment to land — so ask at once, and pass no verdict
   * for a couple of heartbeats.
   */
  backOnScreen() {
    if (!this.connected) return;
    this.judgeFrom = performance.now() + HEARTBEAT_MS * 2;
    this.raw(this.ctl, { t: 'ping', n: performance.now() });
  }

  /**
   * The link went 'disconnected'. Rather than drop on the spot, give it at
   * least DISCONNECT_GRACE_MS to come back — the heartbeat's patience, if
   * that is longer — and only then call it lost.
   */
  startGrace() {
    if (this.stalledAt || this.closed) return;
    this.stalledAt = performance.now();
    this.emit('stall');
  }

  endGrace() {
    if (!this.stalledAt) return;
    const now = performance.now();
    const ms = now - this.stalledAt;
    this.stalledAt = 0;
    // The quiet was the stall's, not the other phone's: restart the clock so
    // the heartbeat doesn't hold it against the link it just got back.
    this.lastSeen = now;
    this.emit('recover', ms);
  }

  handleDrop(reason) {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    clearInterval(this.hb);
    this.emit('drop', reason);
  }

  /**
   * What kinds of address each end offered, e.g. "ours mdns×1 srflx×1 ·
   * theirs mdns×1". Diagnostics only: it tells a WiFi that blocks phones from
   * each other apart from one where they never learned where to look.
   */
  candidates() {
    const kinds = (desc) => {
      if (!desc) return 'none yet';
      const seen = new Map();
      for (const line of desc.sdp.split(/\r?\n/)) {
        const m = line.match(/^a=candidate:\S+ \d+ \S+ \d+ (\S+) \d+ typ (\w+)/);
        if (!m) continue;
        const kind = m[2] === 'host' && m[1].endsWith('.local') ? 'mdns' : m[2];
        seen.set(kind, (seen.get(kind) || 0) + 1);
      }
      return [...seen].map(([k, n]) => `${k}×${n}`).join(' ') || 'none';
    };
    return `ours ${kinds(this.pc.localDescription)} · theirs ${kinds(this.pc.remoteDescription)}`;
  }

  /* -------- sending -------- */

  raw(ch, msg) {
    if (!ch || ch.readyState !== 'open') return false;
    try {
      ch.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  /** Reliable, ordered. Menus, picks, results — anything that must arrive. */
  send(msg) { return this.raw(this.ctl, msg); }

  /**
   * Reliable and ordered too, but fed to the channel only as fast as it
   * drains: a long run of messages (the whole match history) would otherwise
   * sit in one queue ahead of every lobby message and heartbeat sent after it.
   */
  sendPaced(msgs) {
    const ch = this.ctl;
    if (!ch) return;
    let i = 0;
    ch.bufferedAmountLowThreshold = PACED_BACKLOG;
    const pump = () => {
      while (i < msgs.length && !this.closed && ch.readyState === 'open' && ch.bufferedAmount <= PACED_BACKLOG) {
        this.raw(ch, msgs[i++]);
      }
      if (i < msgs.length && !this.closed && ch.readyState === 'open') {
        ch.addEventListener('bufferedamountlow', pump, { once: true });
      }
    };
    pump();
  }

  /** The radio can't keep up with the state stream right now. */
  stateBackedUp() {
    return !!this.state && this.state.bufferedAmount > STATE_BACKLOG_MAX;
  }

  /**
   * Unreliable. Snapshots and inputs, where the next packet supersedes this
   * one — so when the radio is backed up, queueing another would only add
   * latency that then never drains. Drop at the source instead; the next
   * packet is at most 33 ms away and fresher anyway. (Anything that must not
   * be lost — like a snapshot's event list — is the caller's job to hold
   * back: check stateBackedUp() before building the message.)
   */
  sendState(msg) {
    if (this.stateBackedUp()) return false;
    return this.raw(this.state, msg);
  }

  close() {
    this.closed = true;
    clearInterval(this.hb);
    try { this.pc.close(); } catch { /* already gone */ }
  }
}
