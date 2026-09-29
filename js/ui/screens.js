// RoGuPong — every screen that isn't the match itself.
//
// Plain DOM over the game canvas: menus need to scroll, wrap text and accept
// typed input, all of which the browser does better than a canvas ever will.
// The retro look comes from the stylesheet plus pixel-font headings rendered
// into small canvases.

import { drawText, measure, GLYPH_H } from './pixelfont.js';
import { renderLogoTo } from './logo.js';
import { CHARACTERS, BALANCE, byId as charById } from '../game/characters.js';
import { STAGES } from '../game/stages.js';
import { itemById } from '../game/items.js';
import { drawFighter } from '../game/render.js';
import { drawQrToCanvas } from '../net/qr.js';
import { prettyCode, inviteLink, extractCode, CODE_RE } from '../net/sdp.js';
import { scannerSupported } from '../net/scanner.js';
import * as lb from '../data/leaderboard.js';
import { findLeagueCode } from '../data/league.js';
import { isIOS } from '../diag.js';

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

/**
 * A crate's glyph, drawn in the pixel font exactly as it appears on court.
 * Markup leaves a <span data-glyph="id"> where one goes; fillGlyphs swaps
 * the canvases in once the HTML is parsed.
 */
const glyphSlot = (id) => `<span data-glyph="${esc(id)}"></span>`;
function fillGlyphs(root) {
  for (const slot of root.querySelectorAll('[data-glyph]')) {
    const item = itemById(slot.dataset.glyph);
    const c = pixelLabel(item.glyph, { scale: 2, color: item.color, tracking: 0 });
    c.className = 'crate-glyph';
    c.style.display = 'inline-block';
    c.style.verticalAlign = 'middle';
    c.style.margin = '0 5px 0 0';
    slot.replaceWith(c);
  }
}

/** A crate as a compact line: glyph, then its name in its own colour. */
const crateName = (item) =>
  `${glyphSlot(item.id)}<b style="color:${item.color}">${esc(item.name)}</b>`;

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
    if (this.current) this.update(this.data);
  }

  /** Draw the current screen again with new data, where the player had scrolled to. */
  update(data) {
    const y = this.root.scrollTop;
    this.show(this.current, data);
    this.root.scrollTop = y;
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
    }, kind === 'bad' || kind === 'warn' ? 4200 : 2400);
  }

  /**
   * Put a block of text on the current screen, selected, for when the
   * clipboard is out of reach. The box is selectable, so a long-press copies it.
   */
  revealText(text) {
    const screen = this.root.querySelector('.screen');
    if (!screen) return;
    let box = screen.querySelector('#reveal');
    if (!box) {
      box = document.createElement('div');
      box.id = 'reveal';
      box.className = 'code-box report';
      screen.appendChild(box);
    }
    box.textContent = text;
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    box.scrollIntoView({ block: 'nearest' });
  }

  tickLogo(time) {
    if (this.logoCanvas && this.logoCanvas.isConnected) {
      renderLogoTo(this.logoCanvas, Math.min(this.root.clientWidth - 36, 420), time);
    }
  }

  /** The name box, saved as it is left: uppercase, ten characters at most. */
  nameInput() {
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'pname';
    input.maxLength = 10;
    input.placeholder = 'YOUR NAME';
    input.value = this.profile.name;
    input.autocomplete = 'off';
    input.spellcheck = false;
    const commit = () => {
      this.profile.name = input.value.trim().toUpperCase().slice(0, 10);
      this.app.saveProfile();
    };
    input.addEventListener('change', commit);
    input.addEventListener('blur', commit);
    return input;
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
      <div class="row" style="margin-top:10px">
        <button class="btn small secondary" data-action="toggle-music">Music: ${this.profile.music ? 'on' : 'off'}</button>
        <button class="btn small secondary" data-action="toggle-sfx">Sfx: ${this.profile.sfx ? 'on' : 'off'}</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn small secondary" data-action="toggle-quality">
          Graphics set to ${this.app.quality === 'low' ? 'fast' : 'full'}</button>
      </div>
      <small class="muted" style="display:block;margin-top:6px">
        Tap to switch. Fast drops the glows, scanlines and animated scenery.
        Older phones get a much smoother game.</small>`;
    who.insertBefore(this.nameInput(), who.querySelector('.row'));
    wrap.appendChild(who);

    // For a glitch that never reached the Link Lost screen: a dead sound, a
    // phone that went to sleep, a drop the page was reloaded after.
    const diag = document.createElement('button');
    diag.className = 'textbtn';
    diag.dataset.action = 'copy-diag';
    diag.textContent = 'Copy diagnostics';
    wrap.appendChild(diag);

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

    // Crates by stage. MULTIBALL is dealt everywhere, so it is told once.
    const multi = itemById('multi');
    const crateItem = (i) => `<li style="margin-top:3px">${crateName(i)} — ${esc(i.blurb)}</li>`;
    const crateList = (list) => `<ul style="margin:4px 0 0;padding:0;list-style:none">${list}</ul>`;
    const items = crateList(`<li style="margin-top:3px">${crateName(multi)} — ${esc(multi.blurb)} On every stage.</li>`)
      + STAGES.map((st) => `
        <p style="margin-top:8px"><b style="color:${st.accent}">${esc(st.name)}</b></p>
        ${crateList(st.items.filter((id) => id !== 'multi').map((id) => crateItem(itemById(id))).join(''))}`).join('');
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
      <p>Hit one with the ball and the pickup is yours. Every stage deals its
      own four: two classics that suit the place, and one you'll find nowhere else.</p>
      ${items}
      <h3 style="margin-top:12px">Pressure</h3>
      <p>Past twenty returns the paddles start shrinking and the ball keeps
      accelerating. No rally lasts forever.</p>`;
    fillGlyphs(panel);
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
    // Packed ahead of a Share tap; free when the history hasn't changed.
    this.app.prepareLeague();
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel('LEADERBOARD', { scale: 3 }));

    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.innerHTML = [['standings', 'Standings'], ['recent', 'Recent'], ['heroes', 'Heroes']].map(([id, label]) =>
      `<button data-action="board-tab" data-tab="${id}" aria-selected="${tab === id}">${label}</button>`).join('');
    wrap.appendChild(tabs);

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = tab === 'heroes' ? this.heroesHtml(data)
      : tab === 'recent' ? this.recentHtml() : this.standingsHtml();
    wrap.appendChild(panel);

    const note = document.createElement('div');
    note.className = 'credit';
    note.textContent = 'Histories merge automatically when you connect';
    wrap.appendChild(note);

    // For friends who can't meet up: the whole history through a chat app.
    const n = lb.allMatches().length;
    const leagueBox = document.createElement('div');
    leagueBox.className = 'panel tight';
    leagueBox.innerHTML = `
      <div class="title-bar">
        <h3>League</h3>
        <small class="muted">${n} match${n === 1 ? '' : 'es'} on this phone</small>
      </div>
      <p style="margin-top:4px"><small>Not meeting up? Share your league through any chat app —
        your friends import it and their tables catch up with yours.</small></p>
      <div class="row" style="margin-top:8px">
        <button class="btn small secondary" data-action="share-league">Share league</button>
        <button class="btn small secondary" data-action="import-league">Import league</button>
      </div>`;
    wrap.appendChild(leagueBox);

    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `
      <button class="btn secondary" data-action="title">Back</button>
      <button class="btn small danger" data-action="wipe">Clear</button>`;
    wrap.appendChild(row);

    // The match list as a table, for a bug report or a balance discussion.
    const out = document.createElement('div');
    out.className = 'row';
    out.innerHTML = `
      <button class="textbtn" data-action="copy-history" data-names="no">Copy history</button>
      <button class="textbtn" data-action="copy-history" data-names="yes">Copy with names</button>`;
    wrap.appendChild(out);
    return wrap;
  }

  /**
   * Win rates per hero, strongest first. With two friends the samples are
   * tiny and a hero's numbers are partly its player's, so rates wait for
   * HERO_MIN matches, a verdict waits for the numbers to be clear, and a tap
   * splits a hero by player.
   */
  heroesHtml({ hero: open, allBalances }) {
    // Once a patch has changed the roster, older matches say little about
    // the heroes as they are now — so they are left out unless asked for.
    const patched = lb.balancesSeen().some((b) => b !== BALANCE);
    const current = patched && !allBalances;
    const stats = lb.heroStats(current ? BALANCE : null);
    const none = () => ({ played: 0, won: 0, pointsFor: 0, pointsAgainst: 0, players: new Map() });
    const rated = (r) => (r.played >= lb.HERO_MIN ? 1 : 0);
    const rows = CHARACTERS.map((c) => ({ ...none(), ...stats.get(c.id), c }))
      .sort((a, b) => rated(b) - rated(a) || (rated(a) ? b.won / b.played - a.won / a.played : 0));

    const filter = patched ? `
      <div class="title-bar" style="margin-bottom:6px">
        <small class="muted">${current ? 'Since the last balance patch' : 'Every balance version'}</small>
        <button class="btn small secondary" style="width:auto" data-action="board-balance">
          ${current ? 'Show all' : 'Since the patch'}</button>
      </div>` : '';
    if (!rows.some((r) => r.played)) {
      return `${filter}<p class="center">No matches between two different heroes yet.</p>`;
    }

    const pct = (part, whole, played) => (played >= lb.HERO_MIN && whole ? `${Math.round(part / whole * 100)}%` : '&mdash;');
    const cells = (r) => `
      <td class="num">${r.won}</td>
      <td class="num">${r.played - r.won}</td>
      <td class="num">${pct(r.won, r.played, r.played)}</td>
      <td class="num">${pct(r.pointsFor, r.pointsFor + r.pointsAgainst, r.played)}</td>`;
    const VERDICT = {
      strong: '<small class="verdict-strong">looks strong</small>',
      weak: '<small class="verdict-weak">looks weak</small>',
      early: '<small class="muted">too early to tell</small>',
    };
    const me = this.profile.name;
    const body = rows.map((r) => {
      const isOpen = open === r.c.id;
      const verdict = VERDICT[lb.heroVerdict(r.won, r.played)];
      let html = `
        <tr class="hero" data-action="board-hero" data-hero="${esc(r.c.id)}" aria-expanded="${isOpen}">
          <td><b style="color:${r.c.color2}">${esc(r.c.name)}</b> <small>${isOpen ? '&#9662;' : '&#9656;'}</small>
            ${verdict ? `<br>${verdict}` : ''}</td>
          ${cells(r)}
        </tr>`;
      if (isOpen) {
        const players = [...r.players.values()].sort((a, b) => b.played - a.played || a.name.localeCompare(b.name));
        html += players.length
          ? players.map((p) => `
            <tr class="split${p.name === me ? ' me' : ''}"><td>${esc(p.name)}</td>${cells(p)}</tr>`).join('')
          : `<tr class="split"><td colspan="5"><small>Nobody has played ${esc(r.c.name)} here yet</small></td></tr>`;
      }
      return html;
    }).join('');

    return `${filter}<table>
      <thead><tr>
        <th>Hero</th><th class="num">W</th><th class="num">L</th>
        <th class="num">Win%</th><th class="num">Pts%</th>
      </tr></thead><tbody>${body}</tbody></table>
      <p style="margin-top:10px"><small>Pts% is the share of points won. Mirror matches are
        left out. Rates show from ${lb.HERO_MIN} matches, and a hero is only called strong or
        weak once the numbers are clear. Between the same friends a hero's record is partly
        its player's &mdash; tap a hero to split it by player.</small></p>`;
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

    // Before connecting is the moment to fix a missing name: in the lobby it
    // already takes leaving and reconnecting.
    if (lb.isStandInName(this.profile.name)) {
      const who = document.createElement('div');
      who.className = 'panel tight notice';
      who.innerHTML = `
        <h3 class="warn">Who&rsquo;s playing?</h3>
        <p style="margin:4px 0 8px">Type your name, so the leaderboard can tell you apart.
        Without one you share a stand-in with every nameless player.</p>`;
      who.appendChild(this.nameInput());
      wrap.appendChild(who);
    }

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
   * even the long-press when the browser allows reading it. Handshake codes
   * unless `found` says what else to look for.
   */
  pasteArea(action, { found = (text) => CODE_RE.test(extractCode(text)), placeholder = 'RGP…' } = {}) {
    const box = document.createElement('div');
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.gap = '8px';
    const ta = document.createElement('textarea');
    ta.id = 'paste-input';
    ta.placeholder = placeholder;
    ta.autocapitalize = 'characters';
    ta.spellcheck = false;
    ta.addEventListener('input', (e) => {
      if (e.inputType !== 'insertFromPaste') return;
      if (found(ta.value)) this.app.handleAction(action);
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
      // An invite the Camera app reads opens in the browser, which keeps its
      // own name, history and offline copy apart from a home-screen install.
      const iosNote = isIOS()
        ? '<small style="display:block;margin-top:8px">On iPhone, invites scanned with the Camera app '
          + 'open in Safari (or your default browser), not in the home-screen app.</small>'
        : '';
      const wrap = this.signalScreen({
        title: 'PASTE CODE',
        step: 0, steps: 3,
        instruction: 'Paste the code your friend sent you — it connects as soon as it lands.' + iosNote,
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

  /** Import league: a history a friend shared, merged into this phone's. */
  screenLeague() {
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel('IMPORT LEAGUE', { scale: 2 }));

    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `<p>Paste the league a friend shared &mdash; the whole message is fine.
      Its matches join your leaderboard. Nothing on this phone is replaced or removed.</p>`;
    wrap.appendChild(panel);
    wrap.appendChild(this.pasteArea('use-league', { found: (text) => !!findLeagueCode(text), placeholder: 'RGL…' }));

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexDirection = 'column';
    actions.style.gap = '10px';
    actions.innerHTML = `
      <button class="btn" data-action="use-league">Import</button>
      <button class="btn secondary" data-action="board">Back</button>`;
    wrap.appendChild(actions);
    return wrap;
  }

  /* ---------------------------------------------------------------- */
  /* Lobby                                                             */

  screenLobby(data) {
    const {
      isHost, myChar, theirChar, theirName, theirReady, myReady, myFlair, flairProgress,
      stage, crates, target, party, rtt, protocol, theirProtocol,
    } = data;
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

    // A phone on an older cached build — loaded on a WiFi with no internet —
    // still plays, but can't show everything a newer one can. Say which phone
    // needs the update and what reloading it takes; the match itself carries on
    // with the crates both can draw.
    if (theirProtocol != null && theirProtocol !== protocol) {
      const theirsOlder = theirProtocol < protocol;
      const who = esc(theirName || 'your friend');
      const notice = document.createElement('div');
      notice.className = 'panel tight notice';
      // An older host picks the crates itself, so only a host can promise
      // which ones stay off.
      const crateNote = isHost
        ? 'the newest crates stay off — their phone might not be able to show them'
        : 'their older game picks the crates';
      notice.innerHTML = theirsOlder
        ? `<h3 class="warn">${who}&rsquo;s game is out of date</h3>
          <p style="margin-top:4px">You can still play, but ${crateNote}. Once their
          phone has internet, they can reload RoGuPong to update it, then you reconnect.</p>`
        : `<h3 class="warn">This phone&rsquo;s game is out of date</h3>
          <p style="margin-top:4px">${who} has a newer version. You can still play, but
          the newest crates stay off. Once this phone has internet, reload RoGuPong to
          update it, then reconnect.</p>`;
      wrap.appendChild(notice);
    }

    // The leaderboard knows players only by name, so two phones with the same
    // one — or a stand-in every nameless player shares — merge into one row.
    const myName = this.profile.name;
    const nameIssues = [];
    if (lb.isStandInName(myName)) {
      nameIssues.push('<b>You have no name yet</b>, so your matches are saved under a stand-in '
        + 'that every nameless player shares.');
    }
    if (theirName && lb.isStandInName(theirName)) {
      nameIssues.push(`<b>Your friend has no name yet</b>, so their matches go under
        ${esc(theirName)}, a stand-in that every nameless player shares.`);
    } else if (theirName && theirName === myName) {
      nameIssues.push(`<b>You&rsquo;re both called ${esc(myName)}</b>, so the leaderboard will
        count you as one player.`);
    }
    if (nameIssues.length) {
      const notice = document.createElement('div');
      notice.className = 'panel tight notice';
      notice.innerHTML = `<h3 class="warn">Check your names</h3>
        ${nameIssues.map((t) => `<p style="margin-top:4px">${t}</p>`).join('')}
        <p style="margin-top:4px"><small>Names are set on the title screen. To fix one
        now, leave, change it and reconnect.</small></p>`;
      wrap.appendChild(notice);
    }

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

    if (flairProgress) {
      const flairSel = document.createElement('div');
      flairSel.className = 'panel tight';
      const locked = lb.FLAIRS.filter((f) => !flairProgress.unlocked[f.id]);
      flairSel.innerHTML = `
        <div class="title-bar">
          <h3>Flair</h3>
          <small class="muted">earned by playing</small>
        </div>
        <div class="row" style="flex-wrap:wrap;gap:6px;margin:8px 0">${lb.FLAIRS.map((f) => {
    const open = flairProgress.unlocked[f.id];
    return `<button class="btn small ${f.id === myFlair ? '' : 'secondary'}"
              data-action="pick-flair" data-flair="${f.id}" ${open ? '' : 'disabled'}
              title="${esc(f.hint)}">${open ? '' : '🔒 '}${esc(f.name)}</button>`;
  }).join('')}</div>
        ${locked.map((f) => `<small class="muted">🔒 ${esc(f.name)}: ${esc(f.hint)}</small><br>`).join('')}`;
      wrap.appendChild(flairSel);
    }

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
      ${crates ? `<div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:0 0 10px;font-size:0.72rem;letter-spacing:0.06em">
        ${crates.map((id) => `<span style="white-space:nowrap">${crateName(itemById(id))}</span>`).join('')}</div>
      ${crates.length < st.items.length ? `<small class="muted" style="display:block;margin:-4px 0 10px">
        ${esc(st.items.filter((id) => !crates.includes(id)).map((id) => itemById(id).name).join(', '))}
        off until both phones run the same version</small>` : ''}`
    : `<small class="muted" style="display:block;margin:0 0 10px">Crates: the host&rsquo;s older game picks them</small>`}
      ${isHost ? `<div class="row">
        <button class="btn small secondary" data-action="cycle-stage">Next stage</button>
        <button class="btn small secondary" data-action="cycle-target">First to ${target}</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button class="btn small ${party ? '' : 'secondary'}" data-action="cycle-party">${party ? '🎉 Party mode' : 'Classic mode'}</button>
      </div>` : `<small class="muted">First to ${target}${party ? ' · 🎉 PARTY MODE' : ''}</small>`}`;
    fillGlyphs(stageSel);
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

  /**
   * Why the link went, when, and whether either phone had left the screen —
   * enough to tell a WiFi problem from a paused phone at a glance, and the
   * Copy diagnostics button carries the rest to a bug report.
   */
  screenLost(data) {
    const { text, facts = [], hint } = data;
    const wrap = document.createElement('div');
    wrap.className = 'screen';
    wrap.appendChild(pixelLabel('LINK LOST', { scale: 3, color: '#ff4d3d' }));
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <p><b>${esc(text || 'The connection dropped.')}</b></p>
      ${facts.length ? `<table style="margin-top:10px"><tbody>${facts.map(([k, v]) => `
        <tr><td class="muted">${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${hint ? `<p style="margin-top:10px"><small>${esc(hint)}</small></p>` : ''}`;
    wrap.appendChild(panel);
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.flexDirection = 'column';
    actions.style.gap = '10px';
    actions.innerHTML = `
      <button class="btn" data-action="title">Back to title</button>
      <button class="btn secondary" data-action="copy-diag">Copy diagnostics</button>`;
    wrap.appendChild(actions);
    return wrap;
  }
}
