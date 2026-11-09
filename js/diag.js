// RoGuPong — what happened, for when something goes wrong.
//
// Drops and glitches on phones are brief and hinge on timing — a notification,
// an app switch, a WiFi power-save stall — so "what were you doing?" asked
// afterwards rarely pins one down. The game keeps a short log of the moments
// that matter: the page hiding and coming back, the link changing state, audio
// and wake-lock interruptions. The Copy diagnostics button hands it over with a
// description of the phone, ready to paste into a bug report. Nothing leaves
// the phone any other way, bar that one-line description, which goes to the
// friend's phone so its report can say what was on the other end.
//
// The log lives in localStorage and outlasts the session it describes. It
// survives the reload iOS does when it has thrown a tab away in the background,
// often the very moment worth seeing, and a game closed after a glitch: the
// friend whose phone it was can still copy the report hours later. Each page
// load starts with a line of its own, so the sessions stay apart.

const KEY = 'rogupong.diag.v1';
// A couple of evenings' play: the handshakes, strings of matches and whatever
// went wrong in between, without each write growing heavy.
const MAX_ENTRIES = 200;

let entries = stored() || [];

/** The log as stored, or null when storage is out of reach. */
function stored() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.slice(-MAX_ENTRIES) : [];
  } catch {
    return null;
  }
}

/** Note something that happened. For rare events only: every call is a storage write. */
export function log(text) {
  // Another copy of the game in this browser writes to the same log, so this
  // adds to what is stored rather than writing this page's copy over it.
  const list = stored() || entries;
  list.push([Date.now(), String(text).slice(0, 200)]);
  entries = list.slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch { /* private mode, storage off or full: the log still lives in memory */ }
}

const two = (n) => String(n).padStart(2, '0');

/** Wall-clock time to a tenth of a second, e.g. 14:03:12.4. */
export function clock(ms = Date.now()) {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
}

/** The local date, e.g. 2026-11-09: the day clock() belongs to. */
export function day(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** The log as text, oldest first, with a line for each day it covers. */
export function logLines() {
  const lines = [];
  let last = null;
  for (const [t, text] of stored() || entries) {
    if (day(t) !== last) lines.push((last = day(t)));
    lines.push(`${clock(t)} ${text}`);
  }
  return lines;
}

export function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    // iPadOS asks for the desktop site and says it is a Mac.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export const isAndroid = () => /Android/.test(navigator.userAgent);

/**
 * Opened inside another app — a chat app's built-in browser, not the phone's
 * own. It keeps a storage of its own, and closing it to get back to the chat
 * ends the page, handshake and all. On iOS every real browser carries the
 * Safari token and only the home-screen app and app-embedded views drop it;
 * on Android an embedded view says `wv`.
 */
export function inAppBrowser() {
  const ua = navigator.userAgent;
  if (/FBAN|FBAV|Instagram|Snapchat|musical_ly|Line\//.test(ua)) return true;
  if (isIOS()) return !navigator.standalone && !/Safari\//.test(ua);
  return /Android/.test(ua) && /; wv\)/.test(ua);
}

/**
 * The browser on an iPhone that iOS makes ask before it reaches other devices
 * on the WiFi: any but Safari. Since iOS 14 an app needs Local Network access
 * for that (Settings → Privacy & Security → Local Network), and Chrome, Firefox
 * and the rest are apps like any other there, though Safari's engine runs them.
 * Until it is allowed, iOS stops the game's checks to the other phone, so a
 * same-WiFi link never comes up. Safari never asks, nor does a copy of the game
 * on the home screen. Returns the browser's name for the advice, 'this app' for
 * a chat app's own browser, or null where nothing stands in the way. The
 * permission itself is out of a page's reach: this says only that it applies.
 */
export function localNetworkGate() {
  if (!isIOS() || navigator.standalone) return null;
  const ua = navigator.userAgent;
  const named = [
    [/CriOS\//, 'Chrome'], [/FxiOS\//, 'Firefox'], [/EdgiOS\//, 'Edge'], [/OPiOS\/|OPT\//, 'Opera'],
    [/DuckDuckGo\/|Ddg\//, 'DuckDuckGo'], [/GSA\//, 'the Google app'],
  ];
  for (const [re, name] of named) if (re.test(ua)) return name;
  return inAppBrowser() ? 'this app' : null;
}

/**
 * Log any other copy of the game open in this browser. iOS opens an invite
 * read by the Camera app in Safari, possibly as a new tab beside one already
 * running the game: two copies, each wanting the wake lock, the camera and the
 * sound. A home-screen app keeps a storage of its own, so it never hears a
 * Safari tab, nor the other way round.
 */
export function watchOtherCopies() {
  if (typeof BroadcastChannel !== 'function') return;
  const ch = new BroadcastChannel('rogupong.copies');
  ch.onmessage = (e) => {
    if (e.data === 'opened') {
      log('another copy of the game opened in this browser');
      ch.postMessage('here');
    } else if (e.data === 'here') {
      log('another copy of the game is already open in this browser');
    }
  };
  ch.postMessage('opened');
}

/** Home-screen app, installed app, a chat app's built-in browser, or a plain browser tab. */
export function displayMode() {
  if (navigator.standalone) return 'home-screen app';
  try {
    if (matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches) return 'installed app';
  } catch { /* no media queries for it */ }
  return inAppBrowser() ? 'in-app browser' : 'browser tab';
}

function browserName(ua) {
  const known = [
    [/CriOS\/(\d+)/, 'Chrome'],
    [/FxiOS\/(\d+)/, 'Firefox'],
    [/EdgiOS\/(\d+)/, 'Edge'],
    [/SamsungBrowser\/(\d+)/, 'Samsung Internet'],
    [/EdgA?\/(\d+)/, 'Edge'],
    [/OPR\/(\d+)/, 'Opera'],
    [/Firefox\/(\d+)/, 'Firefox'],
    [/Chrome\/(\d+)/, 'Chrome'],
    [/Version\/(\d+)[\d.]* .*Safari/, 'Safari'],
  ];
  for (const [re, name] of known) {
    const m = ua.match(re);
    if (m) return `${name} ${m[1]}`;
  }
  // A home-screen app on iOS drops the Safari token, but it is Safari underneath.
  return isIOS() ? 'Safari' : 'unknown browser';
}

/** One line on the phone and browser, e.g. "iPhone · iOS 17.5 · Safari 17 · home-screen app". */
export function device() {
  const ua = navigator.userAgent;
  const parts = [];
  if (isIOS()) {
    parts.push(/iPhone|iPod/.test(ua) ? 'iPhone' : 'iPad');
    const v = ua.match(/OS (\d+)_(\d+)(?:_(\d+))? like Mac/);
    // From iOS 26 the system version in the user agent stays at 18.6, but
    // Safari's own version, numbered with the system's since, keeps counting.
    const safari = ua.match(/Version\/(\d+(?:\.\d+)?)/);
    if (safari && parseFloat(safari[1]) >= 26) parts.push(`iOS ${safari[1]}`);
    else if (v) parts.push(`iOS ${v.slice(1).filter(Boolean).join('.')}`);
  } else {
    const v = ua.match(/Android (\d+(?:\.\d+)?)/);
    parts.push(v ? `Android ${v[1]}` : /Android/.test(ua) ? 'Android' : 'desktop');
  }
  parts.push(browserName(ua), displayMode());
  return parts.join(' · ');
}
