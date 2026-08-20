// RoGuPong — the link between the two phones.
//
// Direct WebRTC, no game server anywhere: the two handsets talk straight to
// each other across the WiFi. Two data channels ride the same connection:
//
//   'ctl'    reliable + ordered — menus, character picks, scores, emotes
//   'state'  unreliable + unordered — 30 Hz simulation snapshots and inputs,
//            where a late packet is worth less than the next one

import { packSignal, unpackSignal } from './sdp.js';

const ICE_SERVERS = [
  // Only needed if the two phones somehow end up on different subnets; on the
  // same WiFi the local (host) candidates win and these are never used.
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const GATHER_TIMEOUT_MS = 3000;

function waitForIceGathering(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
    pc.addEventListener('icegatheringstatechange', check);
    // Offline or firewalled STUN can stall gathering forever. The local
    // candidates arrive in milliseconds, so don't wait around for the rest.
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
    this.lastSeen = 0;
    this.rtt = 0;

    this.pc.addEventListener('connectionstatechange', () => {
      const s = this.pc.connectionState;
      this.emit('status', s);
      if (s === 'failed' || s === 'closed' || s === 'disconnected') this.handleDrop(s);
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
        this.lastSeen = performance.now();
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
      if (performance.now() - this.lastSeen > 8000) this.handleDrop('timeout');
    }, 1500);
  }

  handleDrop(reason) {
    if (this.closed) return;
    this.closed = true;
    this.connected = false;
    clearInterval(this.hb);
    this.emit('drop', reason);
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

  /** Unreliable. Snapshots and inputs, where the next packet supersedes this one. */
  sendState(msg) { return this.raw(this.state, msg); }

  close() {
    this.closed = true;
    clearInterval(this.hb);
    try { this.pc.close(); } catch { /* already gone */ }
  }
}
