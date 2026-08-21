// RoGuPong — every screen that isn't the match itself.
//
// Plain DOM over the game canvas: menus need to scroll, wrap text and accept
// typed input, all of which the browser does better than a canvas ever will.
// The retro look comes from the stylesheet plus pixel-font headings rendered
// into small canvases.

import { drawText, measure, GLYPH_H } from './pixelfont.js';
import { renderLogoTo } from './logo.js';
import { CHARACTERS, byId as charById } from '../game/characters.js';
import { STAGES } from '../game/stages.js';
import { ITEMS } from '../game/items.js';
import { drawFighter } from '../game/render.js';
import { drawQrToCanvas } from '../net/qr.js';
import { prettyCode, inviteLink, extractCode, CODE_RE } from '../net/sdp.js';
import { scannerSupported } from '../net/scanner.js';
import * as lb from '../data/leaderboard.js';

// Two grid rows of four. Indices ride the wire ({t:'emote', i}), so only ever
// append — reordering would make old phones pop the wrong glyph.
export const EMOTES = ['🔥', '😎', '😱', '🍕', '🤣', '👻', '🚀', '💩'];

/** A heading rendered in the game's own pixel font. */
export function pixelLabel(text, opts = {}) {
  const { scale = 3, color = '#ffd93b', outline = '#1a0d2b', tracking = 1 } = opts;
  const canvas = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const w = measure(text, scale, tracking) + scale * 2;
  const h = GLYPH_H * scale + scale * 2;
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvas.className = 'pixel-label';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  drawText(ctx, text, w / 2, h / 2, {
    scale, color, outline, tracking, align: 'center', baseline: 'middle',
  });
  return canvas;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Screens {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    this.current = null;
    this.logoCanvas = null;
    this.toastHost = document.getElementById('toast');
    root.addEventListener('click', (e) => this.onClick(e));
  }

  get profile() { return this.app.profile; }

  /* ---------------------------------------------------------------- */

  show(name, data = {}) {
    this.current = name;
    this.data = data;
    this.logoCanvas = null;
    this.root.classList.remove('hidden');
    this.root.scrollTop = 0;
    const build = this['screen' + name[0].toUpperCase() + name.slice(1)];
    if (!build) throw new Error('unknown screen: ' + name);
    this.root.innerHTML = '';
    this.root.appendChild(build.call(this, data));
  }

  hide() {
    this.current = null;
    this.root.classList.add('hidden');
    this.root.innerHTML = '';
  }

  refresh() {
    if (this.current) this.show(this.current, this.data);
  }

  onClick(e) {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    this.app.audio.unlock();
    this.app.audio.menu();
    this.app.handleAction(el.dataset.action, el.dataset, el);
  }

  toast(message, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = message;
    this.toastHost.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 320);
    }, kind === 'bad' ? 4200 : 2400);
  }

  tickLogo(time) {
    if (this.logoCanvas && this.logoCanvas.isConnected) {
      renderLogoTo(this.logoCanvas, Math.min(this.root.clientWidth - 36, 420), time);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Title                                                             */

  screenTitle() {
    const wrap = document.createElement('div');
    wrap.className = 'screen';

    const logo = document.createElement('canvas');
    logo.className = 'pixel-label';
    this.logoCanvas = logo;
    wrap.appendChild(logo);
    renderLogoTo(logo, Math.min(this.root.clientWidth - 36, 420), 0);

    const tag = document.createElement('div');
    tag.className = 'credit';
    tag.innerHTML = 'Two phones &middot; one WiFi &middot; no server';
    wrap.appendChild(tag);

    const menu = document.createElement('div');
    menu.className = 'panel';
    menu.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px">
        <button class="btn" data-action="play">Play</button>
        <button class="btn secondary" data-action="board">Leaderboard</button>
        <button class="btn secondary" data-action="howto">How to play</button>
      </div>`;
    wrap.appendChild(menu);

    const who = document.createElement('div');
    who.className = 'panel tight';
    who.innerHTML = `
      <div class="title-bar" style="margin-bottom:8px">
        <h3>Player</h3>
        <small class="muted">tap to change</small>
      </div>
      <input type="text" id="pname" maxlength="10" placeholder="YOUR NAME"
             value="${esc(this.profile.name)}" autocomplete="off" spellcheck="false">
      <div class="row" style="margin-top:10px">
        <button class="btn small secondary" data-action="toggle-music">Music: ${this.profile.music ? 'on' : 'off'}</button>
        <button class="btn small secondary" data-action="toggle-sfx">Sfx: ${this.profile.sfx ? 'on' : 'off'}</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn small secondary" data-action="toggle-quality">
          Graphics: ${this.profile.quality === 'low' ? 'fast' : 'full'}</button>
      </div>
      <small class="muted" style="display:block;margin-top:6px">
        Fast drops the glows and scanlines. Older phones get a much smoother game.</small>`;
    wrap.appendChild(who);

    const input = who.querySelector('#pname');
    const commit = () => {
      const v = input.value.trim().toUpperCase().slice(0, 10);
      this.profile.name = v;
      this.app.saveProfile();
    };
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);

    const credit = document.createElement('div');
    credit.className = 'credit';
    credit.innerHTML = 'Made in Milano with <span class="heart">&#10084;</span>';
    wrap.appendChild(credit);
    return wrap;
  }

  /* ---------------------------------------------------------------- */
  /* How to play                                                       */

  screenHowto() {
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel('HOW TO PLAY', { scale: 3 }));

    const items = ITEMS.map((i) => `<li><b>${esc(i.name)}</b> — ${esc(i.blurb)}</li>`).join('');
    const chars = CHARACTERS.map((c) =>
      `<li><b>${esc(c.name)}</b> — ${esc(c.special.name)}: ${esc(c.special.desc)}</li>`).join('');

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <h3>Getting connected</h3>
      <p>One of you picks <b>Host</b> and shows the code on screen. The other picks
      <b>Join</b> and points their camera at it, then shows the reply back — the
      host&rsquo;s camera is already watching for it. That is the whole handshake:
      after that the phones talk straight to each other over the WiFi. No camera?
      Every step can also <b>share</b> or paste the code through any chat app.</p>
      <h3 style="margin-top:12px">Controls</h3>
      <p>Slide your thumb anywhere to move your paddle. Where the ball hits the paddle
      decides the angle: middle sends it straight, edges send it wide. Moving as you
      connect adds spin.</p>
      <h3 style="margin-top:12px">The meter</h3>
      <p>Every return charges your special. Fill it and the button lights up.</p>
      <ul style="margin:6px 0 0;padding-left:16px">${chars}</ul>
      <h3 style="margin-top:12px">Crates</h3>
      <p>Hit one with the ball and the pickup is yours.</p>
      <ul style="margin:6px 0 0;padding-left:16px">${items}</ul>
      <h3 style="margin-top:12px">Pressure</h3>
      <p>Past twenty returns the paddles start shrinking and the ball keeps
      accelerating. No rally lasts forever.</p>`;
    wrap.appendChild(panel);

    const back = document.createElement('button');
    back.className = 'btn secondary';
    back.dataset.action = 'title';
    back.textContent = 'Back';
    wrap.appendChild(back);
    return wrap;
  }

  /* ---------------------------------------------------------------- */
  /* Leaderboard                                                       */

  screenBoard(data) {
    const tab = data.tab || 'standings';
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel('LEADERBOARD', { scale: 3 }));

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.innerHTML = `
      <button data-action="board-tab" data-tab="standings" aria-selected="${tab === 'standings'}">Standings</button>
      <button data-action="board-tab" data-tab="recent" aria-selected="${tab === 'recent'}">Recent</button>`;
    wrap.appendChild(tabs);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = tab === 'standings' ? this.standingsHtml() : this.recentHtml();
    wrap.appendChild(panel);

    const note = document.createElement('div');
    note.className = 'credit';
    note.textContent = 'Histories merge automatically when you connect';
    wrap.appendChild(note);

    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <button class="btn secondary" data-action="title">Back</button>
      <button class="btn small danger" data-action="wipe">Clear</button>`;
    wrap.appendChild(row);
    return wrap;
  }

  standingsHtml() {
    const rows = lb.standings();
    if (!rows.length) return '<p class="center">No matches yet. Go and play one.</p>';
    const me = this.profile.name;
    const medal = (i) => (i < 3 ? `<span class="medal-${i + 1}">${['1ST', '2ND', '3RD'][i]}</span>` : `${i + 1}TH`);
    return `<table>
      <thead><tr>
        <th>#</th><th>Player</th><th class="num">W</th><th class="num">L</th>
        <th class="num">Win%</th><th class="num">Diff</th><th class="num">Best</th>
      </tr></thead><tbody>
      ${rows.map((r, i) => `
        <tr class="${r.name === me ? 'me' : ''}">
          <td class="rank">${medal(i)}</td>
          <td><b>${esc(r.name)}</b>${r.topChar ? `<br><small>${esc(charById(r.topChar).name)}</small>` : ''}</td>
          <td class="num">${r.won}</td>
          <td class="num">${r.lost}</td>
          <td class="num">${Math.round(r.winRate * 100)}%</td>
          <td class="num">${r.diff > 0 ? '+' : ''}${r.diff}</td>
          <td class="num">${r.bestRally}</td>
        </tr>`).join('')}
      </tbody></table>`;
  }

  recentHtml() {
    const recent = lb.recentMatches(15);
    if (!recent.length) return '<p class="center">Nothing played yet.</p>';
    return `<table><tbody>${recent.map((m) => {
      const [a, b] = m.players;
      const when = new Date(m.at || Date.now());
      const day = when.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
      return `<tr>
        <td><b class="${m.winner === 0 ? 'warn' : ''}">${esc(a.name)}</b>
            <small class="muted"> ${esc(charById(a.char).name)}</small></td>
        <td class="num"><b>${m.score[0]}&ndash;${m.score[1]}</b></td>
        <td><b class="${m.winner === 1 ? 'warn' : ''}">${esc(b.name)}</b>
            <small class="muted"> ${esc(charById(b.char).name)}</small></td>
        <td class="num"><small>${day}<br>${m.bestRally || 0} rally</small></td>
      </tr>`;
    }).join('')}</tbody></table>`;
  }

  /* ---------------------------------------------------------------- */
  /* Connect                                                           */

  screenConnect() {
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel('TWO PLAYERS', { scale: 3 }));

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <p>Both phones need to be on the <b>same WiFi</b>. One hosts, the other joins.</p>
      <p style="margin-top:8px"><small>If one of you is on an <b>iPhone</b>, let the
      Android phone host — the iPhone can then join straight from its Camera app.</small></p>
      <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
        <button class="btn" data-action="host">Host a match</button>
        <button class="btn secondary" data-action="join">Join a match</button>
      </div>
      ${scannerSupported() ? '' :
        '<p class="warn" style="margin-top:10px">This browser has no QR scanner, so you will be swapping codes by copy and paste. Chrome on Android has one.</p>'}`;
    wrap.appendChild(panel);

    const back = document.createElement('button');
    back.className = 'btn secondary';
    back.dataset.action = 'title';
    back.textContent = 'Back';
    wrap.appendChild(back);
    return wrap;
  }

  /** Shared layout for both sides of the handshake. */
  signalScreen({ title, step, steps, instruction, code, showCamera, actions, status, asLink }) {
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel(title, { scale: 2 }));

    const dots = document.createElement('div');
    dots.className = 'steps';
    dots.innerHTML = Array.from({ length: steps }, (_, i) =>
      `<span class="${i <= step ? 'on' : ''}"></span>`).join('');
    wrap.appendChild(dots);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `<p>${instruction}</p>`;
    wrap.appendChild(panel);

    const makeVideo = (mini) => {
      const video = document.createElement('video');
      video.id = 'camera';
      video.playsInline = true;
      video.muted = true;
      if (mini) video.className = 'mini';
      return video;
    };
    if (showCamera && showCamera !== 'mini') wrap.appendChild(makeVideo(false));

    if (code) {
      const box = document.createElement('div');
      box.className = 'qr-wrap';
      const canvas = document.createElement('canvas');
      const size = Math.min(this.root.clientWidth - 70, 320);
      // The invite goes in as a link so any phone's built-in camera can open
      // it; the reply stays a bare code, because it is only ever read by the
      // scanner inside the game and following a link would navigate the host
      // away from its own live connection.
      const payload = asLink ? inviteLink(code) : code;
      let drawn = true;
      try {
        drawQrToCanvas(canvas, payload, size, { ecl: asLink ? 'L' : 'M' });
      } catch {
        drawn = false;
      }
      const hint = document.createElement('div');
      hint.className = 'qr-hint';
      if (drawn) {
        canvas.style.width = size + 'px';
        canvas.style.height = size + 'px';
        box.appendChild(canvas);
        hint.textContent = asLink
          ? 'Any camera app can read this — including the iPhone Camera'
          : 'Point the other phone at this';
      } else {
        hint.textContent = 'This code is too long for a QR — send it with the button below.';
      }
      box.appendChild(hint);
      wrap.appendChild(box);

      const details = document.createElement('details');
      // navigator.share hands the code to any chat app in one tap; an invite
      // shared that way is a link, so the friend just taps it and the game
      // joins itself.
      const shareBtn = navigator.share
        ? `<button class="btn small secondary" data-action="share-code" data-share="${asLink ? 'link' : 'text'}">Share</button>`
        : '';
      details.innerHTML = `<summary><small>Can't scan? Send the code instead</small></summary>
        <div class="code-box" id="rawcode">${esc(prettyCode(code))}</div>
        <div class="row" style="margin-top:8px">
          ${shareBtn}
          <button class="btn small secondary" data-action="copy-code">Copy code</button>
        </div>`;
      wrap.appendChild(details);

      if (showCamera === 'mini') wrap.appendChild(makeVideo(true));
    }

    if (status) {
      const st = document.createElement('div');
      st.className = 'status';
      st.innerHTML = `<span class="dot ${status.kind || ''} ${status.pulse ? 'pulse' : ''}"></span>${esc(status.text)}`;
      wrap.appendChild(st);
    }

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.flexDirection = 'column';
    row.style.gap = '10px';
    row.innerHTML = actions;
    wrap.appendChild(row);
    return wrap;
  }

  screenHost(data) {
    if (data.stage === 'making') {
      return this.signalScreen({
        title: 'HOSTING',
        step: 0, steps: 3,
        instruction: 'Working out how this phone can be reached on the WiFi&hellip;',
        status: { text: 'Preparing invite', kind: 'warn', pulse: true },
        actions: '<button class="btn secondary" data-action="cancel">Cancel</button>',
      });
    }
    if (data.stage === 'waiting') {
      return this.signalScreen({
        title: 'HOSTING',
        step: 2, steps: 3,
        instruction: 'Got the reply. Shaking hands over the WiFi&hellip;',
        status: { text: 'Connecting', kind: 'warn', pulse: true },
        actions: '<button class="btn secondary" data-action="cancel">Cancel</button>',
      });
    }
    // The camera runs while the invite is on screen: the moment the friend's
    // reply code exists, pointing this phone at it is the whole remaining job.
    const scanning = scannerSupported();
    return this.signalScreen({
      title: 'HOSTING',
      step: 0, steps: 3,
      instruction: 'Show this to your friend. <b>On an iPhone</b> they just open the '
        + 'Camera app, point it here and tap the banner. On Android they tap '
        + '<b>Join</b> in the game. '
        + (scanning
          ? 'When their reply code appears, point this phone at it — it connects by itself.'
          : 'They will show you a reply code to enter back.'),
      code: data.code,
      asLink: true,
      showCamera: scanning ? 'mini' : false,
      status: scanning
        ? { text: 'Watching for their reply', kind: 'warn', pulse: true }
        : { text: 'Waiting for a reply', kind: 'warn', pulse: true },
      actions: `
        <button class="btn ${scanning ? 'secondary' : ''}" data-action="paste-answer">
          ${scanning ? 'Paste the reply instead' : 'Enter their reply'}</button>
        <button class="btn secondary" data-action="cancel">Cancel</button>`,
    });
  }

  /**
   * The box a code gets pasted into. A paste is the submit: a complete code is
   * unmistakable, so there is nothing to confirm. The clipboard button saves
   * even the long-press when the browser allows reading it.
   */
  pasteArea(action) {
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '8px';
    const ta = document.createElement('textarea');
    ta.id = 'paste-input';
    ta.placeholder = 'RGP…';
    ta.autocapitalize = 'characters';
    ta.spellcheck = false;
    ta.addEventListener('input', (e) => {
      if (e.inputType !== 'insertFromPaste') return;
      if (CODE_RE.test(extractCode(ta.value))) this.app.handleAction(action);
    });
    box.appendChild(ta);
    if (navigator.clipboard?.readText) {
      const btn = document.createElement('button');
      btn.className = 'btn small secondary';
      btn.dataset.action = 'clip-paste';
      btn.dataset.next = action;
      btn.textContent = 'Paste from clipboard';
      box.appendChild(btn);
    }
    return box;
  }

  screenJoin(data) {
    if (data.stage === 'making') {
      return this.signalScreen({
        title: 'JOINING',
        step: 1, steps: 3,
        instruction: 'Code read. Writing your reply&hellip;',
        status: { text: 'Preparing reply', kind: 'warn', pulse: true },
        actions: '<button class="btn secondary" data-action="cancel">Cancel</button>',
      });
    }
    if (data.stage === 'reply') {
      return this.signalScreen({
        title: 'YOUR REPLY',
        step: 1, steps: 3,
        instruction: 'Now show <b>this</b> code to the host — their camera is already '
          + 'looking for it. If they can&rsquo;t scan, send it to them instead.',
        code: data.code,
        status: { text: 'Waiting for the host', kind: 'warn', pulse: true },
        actions: '<button class="btn secondary" data-action="cancel">Cancel</button>',
      });
    }
    if (data.stage === 'paste') {
      const wrap = this.signalScreen({
        title: 'PASTE CODE',
        step: 0, steps: 3,
        instruction: 'Paste the code your friend sent you — it connects as soon as it lands.',
        actions: `
          <button class="btn" data-action="use-pasted">Connect</button>
          <button class="btn secondary" data-action="cancel">Cancel</button>`,
      });
      wrap.insertBefore(this.pasteArea('use-pasted'), wrap.lastChild);
      return wrap;
    }
    return this.signalScreen({
      title: 'JOINING',
      step: 0, steps: 3,
      instruction: 'Point your camera at the code on the host&rsquo;s phone.',
      showCamera: true,
      status: { text: 'Looking for a code', kind: 'warn', pulse: true },
      actions: `
        <button class="btn secondary" data-action="join-paste">Paste it instead</button>
        <button class="btn secondary" data-action="cancel">Cancel</button>`,
    });
  }

  /** Shown when the host has to type in a reply by hand. */
  screenPasteAnswer() {
    const wrap = this.signalScreen({
      title: 'PASTE REPLY',
      step: 1, steps: 3,
      instruction: 'Paste the reply code from your friend&rsquo;s phone.',
      actions: `
        <button class="btn" data-action="use-answer">Connect</button>
        <button class="btn secondary" data-action="host-back">Back</button>`,
    });
    wrap.insertBefore(this.pasteArea('use-answer'), wrap.lastChild);
    return wrap;
  }

  /* ---------------------------------------------------------------- */
  /* Lobby                                                             */

  screenLobby(data) {
    const { isHost, myChar, theirChar, theirName, theirReady, myReady, stage, target, party, rtt } = data;
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel('CHOOSE YOUR FIGHTER', { scale: 2 }));

    const versus = document.createElement('div');
    versus.className = 'panel tight';
    versus.innerHTML = `
      <div class="status" style="justify-content:space-between">
        <span><span class="dot ok"></span>${esc(this.profile.name || 'YOU')}</span>
        <span class="muted">${rtt ? rtt + 'ms' : 'linked'}</span>
        <span>${esc(theirName || 'FRIEND')}<span class="dot ${theirReady ? 'ok' : 'warn'}" style="margin-left:8px"></span></span>
      </div>`;
    wrap.appendChild(versus);

    const grid = document.createElement('div');
    grid.className = 'grid2';
    for (const c of CHARACTERS) {
      const cell = document.createElement('button');
      cell.className = 'fighter';
      cell.dataset.action = 'pick-char';
      cell.dataset.char = c.id;
      cell.setAttribute('aria-pressed', String(c.id === myChar));
      const cv = document.createElement('canvas');
      const px = 5;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      cv.width = 11 * px * dpr;
      cv.height = 12 * px * dpr;
      cv.style.width = 11 * px + 'px';
      cv.style.height = 12 * px + 'px';
      const cx = cv.getContext('2d');
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.imageSmoothingEnabled = false;
      drawFighter(cx, c, (11 * px) / 2, (12 * px) / 2, px, 0);
      cell.appendChild(cv);
      const meta = document.createElement('div');
      meta.innerHTML = `
        <div class="nm" style="color:${c.color2}">${esc(c.name)}</div>
        <div class="ti">${esc(c.title)}</div>
        <div class="statbar" style="margin-top:6px">SIZE
          <span class="track"><span class="fill" style="width:${Math.round(c.paddle / 1.5 * 100)}%"></span></span></div>
        <div class="statbar">SPD
          <span class="track"><span class="fill" style="width:${Math.round(c.speed / 1.4 * 100)}%"></span></span></div>`;
      cell.appendChild(meta);
      if (c.id === theirChar) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = 'THEM';
        cell.appendChild(tag);
      }
      grid.appendChild(cell);
    }
    wrap.appendChild(grid);

    const chosen = charById(myChar);
    const info = document.createElement('div');
    info.className = 'panel tight';
    info.innerHTML = `
      <h3 style="color:${chosen.color2}">${esc(chosen.special.name)}</h3>
      <p style="margin-top:4px">${esc(chosen.special.desc)}</p>
      <p style="margin-top:6px"><small>${esc(chosen.blurb)}</small></p>`;
    wrap.appendChild(info);

    const stageSel = document.createElement('div');
    stageSel.className = 'panel tight';
    const st = STAGES.find((s) => s.id === stage) || STAGES[0];
    stageSel.innerHTML = `
      <div class="title-bar">
        <h3>Stage</h3>
        <small class="muted">${isHost ? 'your call' : 'host picks'}</small>
      </div>
      <div style="margin:8px 0"><b style="color:${st.accent}">${esc(st.name)}</b>
        <br><small>${esc(st.blurb)}</small></div>
      ${isHost ? `<div class="row">
        <button class="btn small secondary" data-action="cycle-stage">Next stage</button>
        <button class="btn small secondary" data-action="cycle-target">First to ${target}</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn small ${party ? '' : 'secondary'}" data-action="cycle-party">${party ? '🎉 Party mode' : 'Classic mode'}</button>
      </div>` : `<small class="muted">First to ${target}${party ? ' · 🎉 PARTY MODE' : ''}</small>`}`;
    wrap.appendChild(stageSel);

    const emotes = document.createElement('div');
    emotes.className = 'emotes';
    emotes.innerHTML = EMOTES.map((e, i) =>
      `<button data-action="emote" data-emote="${i}">${e}</button>`).join('');
    wrap.appendChild(emotes);

    const go = document.createElement('div');
    go.style.display = 'flex';
    go.style.flexDirection = 'column';
    go.style.gap = '10px';
    if (isHost) {
      go.innerHTML = `
        <button class="btn" data-action="start" ${theirReady ? '' : 'disabled'}>
          ${theirReady ? 'Start match' : 'Waiting for them…'}</button>
        <button class="btn secondary" data-action="leave">Leave</button>`;
    } else {
      go.innerHTML = `
        <button class="btn" data-action="ready">${myReady ? 'Ready ✓' : 'I am ready'}</button>
        <button class="btn secondary" data-action="leave">Leave</button>`;
    }
    wrap.appendChild(go);
    return wrap;
  }

  /* ---------------------------------------------------------------- */
  /* Results                                                           */

  screenResults(data) {
    const { rec, view, wantsRematch, theirRematch } = data;
    const won = rec.winner === view;
    const me = rec.players[view];
    const them = rec.players[1 - view];
    const h2h = lb.headToHead(me.name, them.name);

    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel(won ? 'WINNER' : 'DEFEAT', {
      scale: 4, color: won ? '#ffd93b' : '#9aa4c8',
    }));

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="center" style="font-size:2rem;font-weight:800;letter-spacing:.1em">
        ${rec.score[view]} &ndash; ${rec.score[1 - view]}
      </div>
      <div class="center" style="margin-top:6px">
        <small>${esc(me.name)} (${esc(charById(me.char).name)})
        vs ${esc(them.name)} (${esc(charById(them.char).name)})</small>
      </div>
      <table style="margin-top:12px">
        <tr><td>Longest rally</td><td class="num"><b>${rec.bestRally}</b></td></tr>
        <tr><td>Stage</td><td class="num">${esc((STAGES.find((s) => s.id === rec.stage) || STAGES[0]).name)}</td></tr>
        <tr><td>Head to head</td><td class="num">
          <b>${h2h.a}</b> &ndash; <b>${h2h.b}</b></td></tr>
      </table>`;
    wrap.appendChild(panel);

    const emotes = document.createElement('div');
    emotes.className = 'emotes';
    emotes.innerHTML = EMOTES.map((e, i) =>
      `<button data-action="emote" data-emote="${i}">${e}</button>`).join('');
    wrap.appendChild(emotes);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexDirection = 'column';
    actions.style.gap = '10px';
    actions.innerHTML = `
      <button class="btn" data-action="rematch" ${wantsRematch ? 'disabled' : ''}>
        ${wantsRematch ? 'Waiting for them…' : theirRematch ? 'They want a rematch!' : 'Rematch'}</button>
      <button class="btn secondary" data-action="board">Leaderboard</button>
      <button class="btn secondary" data-action="leave">Back to title</button>`;
    wrap.appendChild(actions);
    return wrap;
  }

  /* ---------------------------------------------------------------- */
  /* Disconnected                                                      */

  screenLost(data) {
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel('LINK LOST', { scale: 3, color: '#ff4d3d' }));
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <p>${esc(data.reason || 'The connection dropped.')}</p>
      <p style="margin-top:8px"><small>Both phones need to stay on the same WiFi. Some
      guest networks block phones from talking to each other — a personal hotspot works
      around that.</small></p>`;
    wrap.appendChild(panel);
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.dataset.action = 'title';
    btn.textContent = 'Back to title';
    wrap.appendChild(btn);
    return wrap;
  }
}
