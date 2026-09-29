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
QR code. One phone hosts, the other scans, and you are playing. Friends who
aren't on the same WiFi can play **online** too, swapping the codes through a
chat app instead.

Everything in here is generated at runtime: no image files, no audio files, no
web fonts, no third-party libraries. The pixel font, the logotype, the QR
encoder, the chiptune soundtrack and the four stages are all code. That is what
makes it work on a WiFi network with no internet behind it.

**[DESIGN.md](DESIGN.md)** has the full design: the physics numbers and why they
are those numbers, the roster balance, the netcode model, and how a 1.2 KB
WebRTC handshake was squeezed into a code you can scan off a phone screen.

---

## Playing it

Both phones need to be on the **same WiFi** — or both online, for
[online play](#playing-online) — and the page needs to be served over
**HTTPS** (or `localhost`): browsers only give a page the camera on a secure
origin.

### It is already online

**<https://gunnargehtab.github.io/RoGuPong/>** — open that on both phones.

GitHub Pages serves it straight from `main` (Settings → Pages → Deploy from a
branch), so every push to `main` republishes it. Any other static host works
too; the game is just files.

Load it once with internet and a service worker caches the whole game, so from
then on it plays on a WiFi with no internet at all. If one phone last loaded it
before an update, the lobby says which phone's game is out of date — reloading
that phone once it has internet updates it. The two can still play meanwhile;
crates the older game can't show are simply left out.

### Or run it locally

```sh
python3 -m http.server 8137
# then open http://<your-laptop-ip>:8137 on both phones
```

Cameras will not work over plain `http://` on a phone, so use the
**copy-and-paste code** option under each QR — the game offers it everywhere.

### Getting connected

1. Both phones open the page and tap **Play**.
2. One taps **Host a match** and shows the invite on screen.
3. The other scans it — **on Android** tap *Join a match* in the game, **on an
   iPhone** just open the Camera app, point it at the invite and tap the banner.
4. The joiner's phone shows a reply code; the host's camera is already
   watching for it, so they just point their phone at it.

Two scans, zero taps in between, and you are in the lobby. If either phone has
no camera, every step also offers the code as text with a **Share** button — a
shared invite is a link your friend just taps, and a pasted code connects the
moment it lands in the box.

> **If one of you is on an iPhone, let the Android phone host.** No browser on
> iOS gives a web page access to a QR scanner, so the invite is encoded as a
> link and read by the phone's own Camera app instead — which only helps in the
> joining direction. An iPhone can still host, it just has to take the reply
> code by paste rather than by scanning. The Camera app opens invites in
> Safari, not in a copy of the game added to the home screen, and the two keep
> separate names and histories (Share league and Import league move a history
> from one to the other).

> Some public and guest WiFi networks isolate clients from each other, which
> blocks any direct phone-to-phone connection. If the handshake completes but
> the link never comes up, put one phone on a personal hotspot and connect the
> other to it.

> **If you have to step away** mid-match — a notification, another app — the
> match pauses on both phones and picks up with a countdown when you're back.
> After 30 seconds away it is called off. Outside a match, the other phone
> waits 30 seconds for yours before giving up. Both phones need an up-to-date
> game for this; against an older one, 8 seconds of silence in a match still
> ends it.

> **If the phones can't connect**, the game says so after a while — with
> what to try and a **Try again** — rather than showing "Connecting…" forever.

> **If the link drops**, both phones go straight back to connecting, on the
> same sides, with the stage, the rules and both picks kept: one more
> handshake and you're back in the lobby. The screen says what happened, and
> whether either phone had left the screen. If your friend left on purpose,
> Link Lost offers **Reconnect** instead. **Copy diagnostics** (on those
> screens, and at the foot of the title screen) copies the details of the
> phone and what just happened, ready to paste into an issue. A brief WiFi
> hiccup doesn't end the session: the game waits at least ten seconds for the
> link to come back.

### Playing online

Not on the same WiFi? Pick **Online** on the connect screen.

1. The host taps **Send an invite** and shares it through any chat app.
2. The friend taps the invite in the chat. Their game opens, joins, and makes
   a reply: they tap **Share reply** and send it straight back.
3. The host pastes the reply into the box under the invite, and you're in
   the lobby. Coming back from the chat app, the Paste button is lit up. On
   browsers that allow it, once you've let the game read the clipboard, it
   picks the reply up by itself.

**Keep your usual WhatsApp or FaceTime call going alongside** to talk while
you play. Online, the game plays its music quieter for it. (On an iPhone, a
call may silence the game's sound altogether.)

There's no relay server in between, so some pairs of networks — mobile data
especially — can't connect two phones directly. If yours won't, the game says
so; try again with one of you on a WiFi or a phone hotspot. Swap the codes
promptly: the longer a reply waits to be pasted, the less likely it gets
through. An invite says how old it is, and an old one gets flagged.

Over the internet a round trip is often a tenth of a second or more, and the
game makes up for it: the guest sees the ball where it really is, and a save
made in time on the guest's screen counts. The lobby says when a connection
is laggy.

### Controls

Slide your thumb anywhere on the screen and your paddle follows it. **Where the
ball hits the paddle sets the angle** — middle sends it straight back, the edges
send it wide — and moving as you connect adds spin. A strip inside your paddle
fills as your special charges; once the paddle blinks, **tap it** to fire. On a
keyboard, arrows move and Space or Shift fires.

You are always the paddle at the bottom of your own screen.

---

## What is in the game

**Six fighters**, each with one signature move and a different paddle feel:
**RO** (all-rounder, AFTERBURN — a near-double-speed return), **GU** (wide and
slow, AEGIS — a barrier behind you that saves one ball; fire it again in the
same point and a wall rises on the midline), **NEO** (small and fast, CURVE —
bends the ball through the air), **BRIO** (heavy, QUAKE — slams every ball on
the rival's side back at them and bogs them down), **MAG** (patient, MAGNET —
catches the next ball so you can aim it, then flings it back fast), **BOO**
(small and spooky, PHANTOM — your next return turns into a ghost).

**Item crates** drift through the middle of the court, and every stage deals
its own four. Multiball drops everywhere; each court adds two classics that
suit the place and one signature crate found nowhere else — **REFLECTION** on
the Navigli (a mirror-image decoy shadows the ball across the water),
**SPIRE** on the Duomo (a marble pinnacle rises on your rival's half and the
ball caroms off it), **ARCO** in Brera (your returns bend back in an arch) and
**AVALANCHE** in the Alps (a snowdrift guards part of your goal). The classics
are big paddle, deep freeze, turbo, ghost ball, shrink ray and a giant beach
ball. Hit a crate with the ball and the pickup is yours.

**Party mode** is a lobby toggle for when a clean duel is not the mood: crates
rain three times as fast, three fit on the court at once, and multiball turns
up far more often. Same physics, same specials — just played in a hailstorm.

**Emotes and quick-chat** in the lobby, on the results and on the pause
screen: eight emoji, and eight lines like "GG", "Nice shot!" and "Rematch?"
that pop up in a speech bubble on the other phone. Never mid-rally.

**Flair** is earned, not bought: a rainbow trail for a 20-hit rally, flames
for ten wins, starlight for touring all four stages, gold for a shutout. Pick
yours in the lobby — your paddle wears it and every ball you return carries
your trail, on both phones.

**Four stages**, each a real place painted in code as a 16-bit scene, with a
court floor that is the same place seen from above: **Navigli Night** — the
canal at blue hour, lamplight streaking the water, terraces three deep;
**Duomo Rooftop** — among the marble spires as the sun goes gold, the city
framed between the statues; **Brera Arcade** — the columned courtyard of the
Palazzo di Brera in soft daylight; **Alpi Sunset** — the Dolomites on fire
over a long slope of snow.

**A leaderboard** with no server behind it. Each phone stores its own match
history; when two phones connect they swap their whole histories and take the
union, so both friends end up looking at the same table — standings, win rate,
point difference, longest rally and head-to-head. Phones pass on every match
they hold, not just their own, so a group of friends who mix partners ends up
with one league. Friends who don't meet can **Share league** through any chat
app and **Import league** on the other end. The **Heroes** tab shows each
hero's win rate and share of points, and a tap splits a hero by player; with
small samples it says "too early to tell" rather than guess. **Copy history**
copies the matches as a CSV table, names hidden, for a bug report or a balance
discussion.

---

## Project layout

```
index.html            the whole app shell
css/style.css         16-bit console UI
sw.js                 service worker — makes the game work offline
js/
  main.js             screen router, connection lifecycle, frame loop
  diag.js             event log and the Copy diagnostics report
  ui/
    pixelfont.js      62-glyph 5x7 bitmap font
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
    stages.js         the four courts and the crates each one deals
    scenes/           each stage painted in pixel art — backdrop and court floor
  data/
    leaderboard.js    local history, peer merging, standings and hero stats
    league.js         league codes and the history CSV
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
