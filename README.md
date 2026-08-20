# RoGuPong

a pong game for me and my friend (^.^)

- designed in the super nintendo era super Mario smash brothers game style
- gui contains a beautiful "RoGuPong" Logo
- gui has a small credit writing: "made in Milano with ❤️"
- this game boasts a leaderboard
- is played on android smart phones through wifi in 1 on 1 mode
- players are on the same wifi
- game is browser based
- should have visual effects, a menu

---

## What it turned into

A 16-bit pong duel for two phones, played **directly between the handsets** —
there is no game server anywhere. The two browsers connect to each other over
the WiFi with WebRTC, and they arrange that connection by showing each other a
QR code. One phone hosts, the other scans, and you are playing.

Everything in here is generated at runtime: no image files, no audio files, no
web fonts, no third-party libraries. The pixel font, the logotype, the QR
encoder, the chiptune soundtrack and the four stages are all code. That is what
makes it work on a WiFi network with no internet behind it.

**[DESIGN.md](DESIGN.md)** has the full design: the physics numbers and why they
are those numbers, the roster balance, the netcode model, and how a 1.2 KB
WebRTC handshake was squeezed into a code you can scan off a phone screen.

---

## Playing it

Both phones need to be on the **same WiFi**, and the page needs to be served
over **HTTPS** (or `localhost`) — browsers only give a page the camera on a
secure origin.

### It is already online

**<https://gunnargehtab.github.io/RoGuPong/>** — open that on both phones.

GitHub Pages serves it straight from `main` (Settings → Pages → Deploy from a
branch), so every push to `main` republishes it. Any other static host works
too; the game is just files.

Load it once with internet and a service worker caches the whole game, so from
then on it plays on a WiFi with no internet at all.

### Or run it locally

```sh
python3 -m http.server 8137
# then open http://<your-laptop-ip>:8137 on both phones
```

Cameras will not work over plain `http://` on a phone, so use the
**copy-and-paste code** option under each QR — the game offers it everywhere.

### Getting connected

1. Both phones open the page and tap **Play**.
2. One taps **Host a match** and shows the code on screen.
3. The other taps **Join a match** and points the camera at it.
4. The joiner's phone shows a reply code; the host scans that back.

Two scans and you are in the lobby. If either phone has no camera, every step
also gives you the code as text — send it over any chat app and paste it in.

> Some public and guest WiFi networks isolate clients from each other, which
> blocks any direct phone-to-phone connection. If the handshake completes but
> the link never comes up, put one phone on a personal hotspot and connect the
> other to it.

### Controls

Slide your thumb anywhere on the screen and your paddle follows it. **Where the
ball hits the paddle sets the angle** — middle sends it straight back, the edges
send it wide — and moving as you connect adds spin. The button in the corner
fires your special once the meter is full.

You are always the paddle at the bottom of your own screen.

---

## What is in the game

**Four fighters**, each with one signature move and a different paddle feel:
**RO** (all-rounder, AFTERBURN — a near-double-speed return), **GU** (wide and
slow, AEGIS — a barrier that saves one ball), **NEO** (small and fast, CURVE —
bends the ball through the air), **BRIO** (heavy, QUAKE — slams every ball back
and bogs the rival down).

**Four item crates** drift through the middle of the court: multiball, big
paddle, deep freeze, turbo. Hit one with the ball and the pickup is yours.

**Four stages**, all somewhere in Milano: Navigli Night, Duomo Rooftop, Brera
Arcade, Alpi Sunset.

**A leaderboard** with no server behind it. Each phone stores its own match
history; when two phones connect they swap histories and take the union, so
both friends end up looking at the same table — standings, win rate, point
difference, longest rally and head-to-head.

---

## Project layout

```
index.html            the whole app shell
css/style.css         16-bit console UI
sw.js                 service worker — makes the game work offline
js/
  main.js             screen router, connection lifecycle, frame loop
  ui/
    pixelfont.js      58-glyph 5x7 bitmap font
    logo.js           the RoGuPong logotype
    screens.js        menus, lobby, leaderboard, results
  net/
    qr.js             a complete QR encoder
    sdp.js            compresses a WebRTC offer into a scannable code
    peer.js           WebRTC data channels
    scanner.js        camera QR scanning
  game/
    match.js          the rules — physics, scoring, specials, items
    render.js         court, stages, sprites, HUD, CRT pass
    fx.js             particles, rings, screen shake, hitstop
    audio.js          the chiptune engine
    input.js          touch and keyboard
    characters.js     the roster
    items.js          the crates
    stages.js         the four courts
  data/
    leaderboard.js    local history and peer merging
```

---

## Notes for anyone poking at it

- **The QR encoder** was verified module-for-module against a reference encoder
  and read back with an independent decoder across 261 randomised payloads
  covering every mode, error-correction level and a wide range of versions.
- **The physics** were tuned against a headless harness that plays whole
  matches with scripted opponents at several skill levels, checking that balls
  never escape the court, speeds stay bounded and every match terminates.
- **The whole thing** was played end-to-end in two real browsers — host and
  guest, handshake to leaderboard.
- **`window.rogupong`** is the live app object in the console, which is the
  easiest way to poke at a running match.

---

Made in Milano with ❤️
