// RoGuPong — the link between the two phones.
//
// Direct WebRTC, no game server anywhere: the two handsets talk straight to
// each other across the WiFi. Two data channels ride the same connection:
//
//   'ctl'    reliable + ordered — menus, character picks, scores, emotes
//   'state'  unreliable + unordered — 30 Hz simulation snapshots and inputs,
//            where a late packet is worth less than the next one

import { packSignal, unpackSignal } from './sdp.js';
import { log } from '../diag.js';

const ICE_SERVERS = [
  // Only needed if the two phones somehow end up on different subnets; on the
  // same WiFi the local (host) candidates win and these are never used.
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const GATHER_TIMEOUT_MS = 3000;
const GATHER_SETTLE_MS = 400;
// Unsent state bytes allowed to queue before new packets are dropped at the
// source — about five snapshots, past which the radio is stalling and every
// queued packet is stale by the time it leaves.
const STATE_BACKLOG_MAX = 4096;
const HEARTBEAT_MS = 1500;
// This long without a word from the other phone and it is given up on.
const SILENCE_MS = 8000;
// How long a link WebRTC calls 'disconnected' gets to come back. The state is
// meant to be temporary — a WiFi power-save stall, a router blip, the other
// phone's radio napping — and usually clears by itself within seconds.
const DISCONNECT_GRACE_MS = 10000;

function waitForIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    let settle = null;
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
    // reaches 'complete' by burning the whole timeout, on both phones.
    const onCandidate = (ev) => {
      if (!ev.candidate) return;
      clearTimeout(settle);
      settle = setTimeout(finish, GATHER_SETTLE_MS);
    };
    pc.addEventListener('icegatheringstatechange', check);
    pc.addEventListener('icecandidate', onCandidate);
    const timer = setTimeout(finish, GATHER_TIMEOUT_MS);
  });
}

export class Peer {
  constructor(role) {
    this.role = role;                 // 'host' | 'guest'
    this.isHost = role === 'host';
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 2 });
    this.ctl = null;
    this.state = null;
    this.listeners = new Map();
    this.connected = false;
    this.closed = false;
    this.createdAt = performance.now();
    this.openedAt = 0;            // when the channels opened; 0 while still connecting
    this.lastSeen = 0;
    this.rtt = 0;
    this.grace = null;            // timer while a 'disconnected' link gets its chance
    this.stalledAt = 0;

    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc.connectionState;
      if (this.closed) return;
      log(`link: ${s}`);
      this.emit('status', s);
      if (s === 'disconnected') this.startGrace();
      else if (s === 'connected') this.endGrace();
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

  static async host() {
    const peer = new Peer('host');
    peer.ctl = peer.pc.createDataChannel('ctl', { ordered: true });
    peer.state = peer.pc.createDataChannel('state', {
      ordered: false, maxRetransmits: 0, negotiated: false,
    });
    peer.wireChannel(peer.ctl);
    peer.wireChannel(peer.state);

    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    await waitForIceGathering(peer.pc);
    peer.code = await packSignal(peer.pc.localDescription.sdp, 'offer');
    return peer;
  }

  static async join(offerCode) {
    const { role, sdp } = await unpackSignal(offerCode);
    if (role !== 'offer') throw new Error('that code is a reply, not an invite');

    const peer = new Peer('guest');
    peer.pc.addEventListener('datachannel', (ev) => {
      if (ev.channel.label === 'ctl') peer.ctl = ev.channel;
      else peer.state = ev.channel;
      peer.wireChannel(ev.channel);
    });

    await peer.pc.setRemoteDescription({ type: 'offer', sdp });
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    await waitForIceGathering(peer.pc);
    peer.code = await packSignal(peer.pc.localDescription.sdp, 'answer');
    return peer;
  }

  /** Host side: finish the handshake with the reply scanned off the guest. */
  async acceptAnswer(answerCode) {
    const { role, sdp } = await unpackSignal(answerCode);
    if (role !== 'answer') throw new Error('that code is an invite, not a reply');
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
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
      if (msg.t === 'pong') { this.rtt = Math.round(performance.now() - msg.n); return; }
      if (ch.label === 'state') this.emit('state', msg);
      else this.emit('msg', msg);
    });
  }

  startHeartbeat() {
    clearInterval(this.hb);
    this.hb = setInterval(() => {
      if (this.closed) return;
      this.raw(this.ctl, { t: 'ping', n: performance.now() });
      // While the link is down, silence is expected and its grace decides.
      if (!this.grace && performance.now() - this.lastSeen > SILENCE_MS) this.handleDrop('timeout');
    }, HEARTBEAT_MS);
  }

  /**
   * The link went 'disconnected'. Rather than drop on the spot, give it
   * DISCONNECT_GRACE_MS to come back — the heartbeat holds its verdict
   * meanwhile — and only then call it lost.
   */
  startGrace() {
    if (this.grace || this.closed) return;
    this.stalledAt = performance.now();
    this.grace = setTimeout(() => this.handleDrop('disconnected'), DISCONNECT_GRACE_MS);
    this.emit('stall');
  }

  endGrace() {
    if (!this.grace) return;
    clearTimeout(this.grace);
    this.grace = null;
    // The quiet was the stall's, not the other phone's: restart the clock so
    // the heartbeat doesn't hold it against the link it just got back.
    this.lastSeen = performance.now();
    this.emit('recover', this.lastSeen - this.stalledAt);
  }

  handleDrop(reason) {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    clearInterval(this.hb);
    clearTimeout(this.grace);
    this.grace = null;
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
    clearTimeout(this.grace);
    this.grace = null;
    try { this.pc.close(); } catch { /* already gone */ }
  }
}
