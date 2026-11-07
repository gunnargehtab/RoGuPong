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

import { packSignal, unpackSignal, listCandidates, familyOf, networkOf, isInternet } from './sdp.js';
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
// How often the connectivity checks are tallied while a link comes up.
const CHECKS_SAMPLE_MS = 2000;
// The longest a guest waits to hear from the host before taking its link as
// open anyway (Peer.channelOpened). The host speaks first within a round trip.
const ANNOUNCED_OPEN_MS = 1000;

/** 10/8, 172.16/12 or 192.168/16 — the ranges a WiFi router hands out — as bytes; else null. */
function privateV4(address) {
  const b = address.split('.').map(Number);
  if (b.length !== 4) return null;
  const ok = b[0] === 10 || (b[0] === 172 && b[1] >= 16 && b[1] < 32) || (b[0] === 192 && b[1] === 168);
  return ok ? b : null;
}

// How a host candidate's network reads in diagnostics.
const NET_LABEL = { wired: 'wired', wifi: 'wifi', other: 'other', cell: 'cell', any: 'default route' };
const NET_ORDER = ['wired', 'wifi', 'other', 'cell', 'default route', 'local'];

/**
 * One side's addresses in a few words, e.g. "wifi v4+v6×2, cell v4+v6×2,
 * internet v4 via wifi": host addresses by the network they're on where
 * Chrome says so ("local" where nothing does — any other browser, and every
 * description rebuilt from a compact code), then the internet (srflx)
 * addresses and the network that found them.
 */
function describeAddresses(cands) {
  if (!cands.length) return 'none';
  const groups = new Map();
  const vias = new Set();
  for (const c of cands) {
    const net = NET_LABEL[networkOf(c)] || 'local';
    const group = c.type === 'srflx' ? 'internet' : net;
    if (c.type === 'srflx' && networkOf(c) && networkOf(c) !== 'any') vias.add(net);
    if (!groups.has(group)) groups.set(group, new Map());
    const fams = groups.get(group);
    fams.set(familyOf(c), (fams.get(familyOf(c)) || 0) + 1);
  }
  const fams = (m) => ['v4', 'v6', 'mdns'].filter((f) => m.has(f))
    .map((f) => (m.get(f) > 1 ? `${f}×${m.get(f)}` : f)).join('+');
  const parts = NET_ORDER.filter((g) => groups.has(g)).map((g) => `${g} ${fams(groups.get(g))}`);
  if (groups.has('internet')) parts.push(`internet ${fams(groups.get('internet'))}${vias.size ? ` via ${[...vias].join('+')}` : ''}`);
  return parts.join(', ');
}

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
    this.sent = null;             // the candidates this phone's code carried
    // The connectivity checks while connecting, per candidate pair (sampleChecks).
    this.pairs = new Map();
    this.strangers = new Set();
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
    // Chrome never says 'failed' here: it remaps that to 'disconnected'
    // (crbug 957487), so a link that never came up reads 'disconnected',
    // and only connectionState says 'failed'.
    this.pc.addEventListener('iceconnectionstatechange', () => {
      if (!this.closed) log(`ice: ${this.pc.iceConnectionState}`);
    });
    this.sampleChecks();
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
      await peer.noteSent();
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
      await peer.noteSent();
    } catch (err) {
      peer.close();
      throw err;
    }
    peer.logGathered();
    return peer;
  }

  /** Which candidates this phone's code carried: a compact code has room for six. */
  async noteSent() {
    try {
      this.sent = listCandidates((await unpackSignal(this.code)).sdp);
    } catch {
      this.sent = null;   // diagnostics only
    }
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
    ch.addEventListener('open', () => this.channelOpened());
    ch.addEventListener('close', () => this.handleDrop('closed'));
    ch.addEventListener('message', (ev) => {
      this.lastSeen = performance.now();
      // A word from the host: the guest's end can send now (channelOpened).
      // The link opens before the message is handled, so the app's opening
      // moves don't undo what the message brings.
      if (!this.connected && ch === this.ctl) this.channelOpened(true);
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
   * The link is open once the reliable channel is — and, on the guest, once
   * the host has been heard on it. The guest's channels are the host's,
   * announced to it, and Chrome calls an announced channel open a moment
   * before it can send. A message sent in that moment is dropped without a
   * word: on a busy phone that was the guest's hello, now and then, which
   * left the host without the guest's name, build and history. Anything that
   * arrives on the channel shows it can send as well; failing that, a
   * second's wait does. The host's own channels open ready.
   */
  channelOpened(heard = false) {
    if (this.connected || this.closed || !this.ctl || this.ctl.readyState !== 'open') return;
    if (!this.isHost && !heard) {
      this.openWait ??= setTimeout(() => this.channelOpened(true), ANNOUNCED_OPEN_MS);
      return;
    }
    clearTimeout(this.openWait);
    this.connected = true;
    this.openedAt = this.lastSeen = performance.now();
    log(`link: open after ${((this.openedAt - this.createdAt) / 1000).toFixed(1)} s · ${this.candidates()}`);
    this.startHeartbeat();
    this.emit('open');
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
   * missed meanwhile is still on its way in. Nor does a beat that comes
   * late: the page was stopped (iOS may run the overdue timer before telling
   * the page it is back), and its silence was its own.
   */
  startHeartbeat() {
    clearInterval(this.hb);
    let last = performance.now();
    this.hb = setInterval(() => {
      if (this.closed) return;
      const now = performance.now();
      if (now - last > HEARTBEAT_MS * 3) this.judgeFrom = Math.max(this.judgeFrom, now + HEARTBEAT_MS * 2);
      last = now;
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
    clearTimeout(this.checkTimer);
    clearTimeout(this.openWait);
    this.emit('drop', reason);
  }

  /**
   * What each end offered, e.g. "ours wifi v4+v6×2, cell v4+v6×2, internet
   * v4 via wifi, 6 of 7 in the code · theirs local mdns×2, internet v4+v6".
   * Only the UDP candidates a code can carry count, not Chrome's TCP twins.
   * Diagnostics only: it tells a phone whose game would go over mobile data,
   * or one not on the WiFi at all, from two that knew where to look.
   */
  candidates() {
    const ours = this.pc.localDescription ? listCandidates(this.pc.localDescription.sdp) : null;
    const theirs = this.pc.remoteDescription ? listCandidates(this.pc.remoteDescription.sdp) : null;
    const cut = this.sent && ours && this.sent.length < ours.length
      ? `, ${this.sent.length} of ${ours.length} in the code` : '';
    return `ours ${ours ? describeAddresses(ours) + cut : 'none yet'} · `
      + `theirs ${theirs ? describeAddresses(theirs) : 'none yet'}`;
  }

  /**
   * Tally the connectivity checks every couple of seconds while the link is
   * coming up: how many this phone sent, how many were answered, and how many
   * came in from the other phone. The verdict on a handshake that never
   * connected hangs on these — a WiFi that keeps phones apart lets nothing
   * through either way — and Chrome forgets a pair the moment it fails, so
   * each pair keeps the most it was seen with.
   */
  async sampleChecks() {
    if (this.closed || this.openedAt) return;
    try {
      const stats = await this.pc.getStats();
      stats.forEach((s) => {
        if (s.type === 'candidate-pair') {
          const was = this.pairs.get(s.id) || { sent: 0, answered: 0, heard: 0 };
          this.pairs.set(s.id, {
            sent: Math.max(was.sent, s.requestsSent || 0),
            answered: Math.max(was.answered, s.responsesReceived || 0),
            heard: Math.max(was.heard, s.requestsReceived || 0),
          });
        } else if (s.type === 'remote-candidate' && s.candidateType === 'prflx') {
          this.strangers.add(s.id);
        }
      });
    } catch { /* closed meanwhile */ }
    if (!this.closed && !this.openedAt) this.checkTimer = setTimeout(() => this.sampleChecks(), CHECKS_SAMPLE_MS);
  }

  /** The checks so far, summed over every pair: { sent, answered, heard }. */
  checkTotals() {
    const t = { sent: 0, answered: 0, heard: 0 };
    for (const p of this.pairs.values()) {
      t.sent += p.sent;
      t.answered += p.answered;
      t.heard += p.heard;
    }
    return t;
  }

  /**
   * What got through while connecting: 'both' once a check of this phone's
   * was answered, 'theirs' when only the other phone's checks arrived, 'none'
   * when neither did. null until there is someone to check with.
   */
  reach() {
    const t = this.checkTotals();
    if (t.answered) return 'both';
    if (t.heard) return 'theirs';
    return this.pc.remoteDescription ? 'none' : null;
  }

  /** The checks in a line, for diagnostics. */
  checksText() {
    const t = this.checkTotals();
    const odd = this.strangers.size ? `, ${this.strangers.size} from addresses not in their code` : '';
    return `checks ${t.sent} sent, ${t.answered} answered, ${t.heard} heard${odd}`;
  }

  /**
   * Whether this phone's own addresses say it can't play over the WiFi:
   * 'no-wifi' when it lists only mobile-data addresses, and 'mobile-data'
   * when it is on a WiFi but its one way to the internet is mobile data. That
   * is a WiFi with no internet behind it, and while mobile data is on,
   * Android sends everything that isn't tied to a network over mobile data —
   * the game's link included, which Chrome never ties to one. null when all
   * looks well, or when nothing says: only Chrome gives the networks, and
   * only once the page may list them (the camera allowed).
   */
  wifiTrouble() {
    const ours = this.pc.localDescription ? listCandidates(this.pc.localDescription.sdp) : [];
    const hosts = ours.filter((c) => c.type === 'host').map(networkOf);
    if (!hosts.length || hosts.some((n) => n == null || n === 'any')) return null;
    if (hosts.every((n) => n === 'cell')) return 'no-wifi';
    const nets = ours.filter(isInternet).map(networkOf);
    return hosts.includes('wifi') && nets.length && nets.every((n) => n === 'cell') ? 'mobile-data' : null;
  }

  /**
   * Whether the two phones' local IPv4 addresses put them on one network, as
   * far as the codes show: true, false, or null when either side shows none
   * (an iPhone hides its own behind mDNS names). A home network is a /24;
   * the 10/8 and 172.16/12 ranges compare on /16, cut wider in offices and
   * schools.
   */
  sameNetwork() {
    const lan = (desc, mine) => (desc ? listCandidates(desc.sdp) : [])
      .filter((c) => c.type === 'host' && familyOf(c) === 'v4' && !(mine && networkOf(c) === 'cell'))
      .map((c) => privateV4(c.address))
      .filter(Boolean);
    const key = (b) => b.slice(0, b[0] === 192 ? 3 : 2).join('.');
    const ours = new Set(lan(this.pc.localDescription, true).map(key));
    const theirs = lan(this.pc.remoteDescription, false).map(key);
    if (!ours.size || !theirs.length) return null;
    return theirs.some((k) => ours.has(k));
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
    clearTimeout(this.checkTimer);
    clearTimeout(this.openWait);
    try { this.pc.close(); } catch { /* already gone */ }
  }
}
