// RoGuPong — what happened, for when something goes wrong.
//
// Drops and glitches on phones are brief and hinge on timing — a notification,
// an app switch, a WiFi power-save stall — so "what were you doing?" asked
// afterwards rarely pins one down. The game keeps a short log of the moments
// that matter: the page hiding and coming back, the link changing state, audio
// and wake-lock interruptions. The Copy diagnostics button hands it over with a
// description of the phone, ready to paste into a bug report. Nothing leaves
// the phone any other way.
//
// The log lives in sessionStorage, so it survives the reload iOS does when it
// has thrown a tab away in the background — often the very moment worth seeing.

const KEY = 'rogupong.diag.v1';
const MAX_ENTRIES = 60;

let entries = load();

function load() {
  try {
    const list = JSON.parse(sessionStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.slice(-MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

/** Note something that happened. For rare events only: every call is a storage write. */
export function log(text) {
  entries.push([Date.now(), String(text).slice(0, 200)]);
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(entries));
  } catch { /* private mode, or storage off — the log still lives in memory */ }
}

/** Wall-clock time to a tenth of a second, e.g. 14:03:12.4. */
export function clock(ms = Date.now()) {
  const d = new Date(ms);
  const two = (n) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
}

/** The log as text, oldest first. */
export function logLines() {
  return entries.map(([t, text]) => `${clock(t)} ${text}`);
}

export function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent)
    // iPadOS asks for the desktop site and says it is a Mac.
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

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
