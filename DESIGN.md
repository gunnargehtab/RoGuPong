# RoGuPong — game design

The brief was six lines in a README: a pong game for two friends, 16-bit
console styling, a logo, a leaderboard, two Android phones on the same WiFi,
browser-based, effects and a menu. This document is what those six lines turned
into, and why.

---

## 1. Design pillars

**It has to work in the ten seconds before someone loses interest.** Two people
standing in a kitchen should get from "want to play?" to a live match without
typing an address, making an account, or finding out that the WiFi has client
isolation turned on. One scans, one shows, done.

**Pong is the floor, not the ceiling.** The core is honest pong — angle control
off the paddle face, spin off paddle motion, speed that ramps with the rally.
Characters and items sit on top of that without ever taking the ball out of the
players' hands.

**Every point should end.** Two competent players can rally forever in classic
pong. Rallies are the best part right up until they are the worst part, so the
game applies pressure until someone wins the point (§4).

**Nothing outlives the match except the leaderboard.** No accounts, no cloud,
no telemetry. The only thing that persists is who beat whom.

---

## 2. The court

Play happens in a normalised space: x and y both run 0..1, player 0 defends the
bottom edge, player 1 the top. The renderer flips y for player 1, so **each
phone shows its own player at the bottom**. That single decision removes the
"which paddle is mine?" confusion that kills split-screen games on separate
devices.

The court is drawn at a fixed 0.56 width-to-height ratio on both phones and
letterboxed into whatever screen it finds, so a match between a small phone and
a big one is played on identical geometry. The space left over above and below
becomes the HUD.

| Quantity | Value | Why |
| --- | --- | --- |
| Ball radius | 0.019 | Big enough to read at arm's length on a 5" screen |
| Paddle width | 0.20 base | A fifth of the court; generous, before character modifiers |
| Paddle line | y = 0.905 / 0.095 | Leaves room behind the paddle for the shield |
| Serve speed | 0.62 court-heights/s | ~1.6 s to cross — a beat to breathe |
| Speed ramp | ×1.035 per hit | Doubles over ~20 returns |
| Speed ceiling | 1.75, rising with rally heat | ~0.6 s to cross at the cap |
| Paddle speed | 2.35 court-widths/s | A full-court recovery is *just* possible |

That last row is the most important number in the game. It is tuned so a
committed player can reach a ball hit to the far corner, but only barely and
only if they start moving immediately. Faster and the game is a stalemate;
slower and wide angles become unreturnable and the whole angle-control system
stops mattering.

**Angle control.** Where the ball meets the paddle sets the departure angle, up
to about 60° off vertical. Paddle motion at the moment of contact adds a
further ±20°, which is what lets a player "carry" the ball sideways. Both are
clamped so nothing ever leaves flatter than a returnable angle.

---

## 3. The roster

Six fighters. Nobody is strictly better: wide paddles are slow, fast paddles
are small, and every special costs a full meter.

| | Paddle | Speed | Special | What it does |
| --- | --- | --- | --- | --- |
| **RO**, the Crimson Comet | 1.00 | 1.05 | AFTERBURN | Next return leaves at ~1.9× speed, trailing fire |
| **GU**, the Azure Bulwark | 1.35 | 0.85 | AEGIS | A barrier behind the paddle saves one ball, then shatters |
| **NEO**, the Neon Trickster | 0.80 | 1.28 | CURVE | Next return bends through the air for three seconds |
| **BRIO**, the Bronze Bruiser | 1.12 | 0.95 | QUAKE | Slams every ball back and bogs the rival's paddle down |
| **MAG**, the Junkyard Magnet | 1.05 | 0.92 | MAGNET | Catches the next ball; slide to aim, it flings back at 1.3× |
| **BOO**, the Friendly Phantom | 0.85 | 1.18 | PHANTOM | Next return turns the ball into a ghost for three seconds |

The specials are deliberately of two kinds. AFTERBURN, CURVE and PHANTOM are
*armed* — they wait for your next hit, so using them well means choosing which
rally to spend them on. AEGIS and QUAKE are *immediate* — they change the
board the moment you press the button. MAGNET sits between the two: it arms
the paddle, but the payoff is interactive — the caught ball rides the paddle
for a second and the drag is the aim: however far you haul it from where it
was caught sets the launch angle, so dragging across the court slings a sharp
diagonal and holding your ground fires it dead straight. Position rather than
velocity, deliberately — no split-second flick timing required of a
seven-year-old thumb. A quake breaks the catch: the ball is slammed off the
magnet and comes back as a plain unaimed return, which keeps BRIO an honest
answer to a MAG who camps.

**The meter** fills at 0.17 per return you make plus a slow trickle of 0.022/s,
so an aggressive rallying player charges in about five exchanges and a passive
one still gets there eventually. A full meter is announced by the button
lighting up and pulsing — no reading a number mid-rally.

---

## 4. Items and pressure

A crate drifts through the middle third of the court every 6–9.5 seconds, at
most two at a time, and only once a rally is at least two hits old. **Whoever
last touched the ball that breaks the crate gets the pickup**, immediately —
items reward winning the exchange, not standing in the right place.

| Item | Effect |
| --- | --- |
| MULTIBALL | Two extra balls join the rally (hard cap of five on the court) |
| BIG PADDLE | Your paddle swells 60% for seven seconds |
| DEEP FREEZE | Their paddle moves at half speed for four seconds |
| TURBO | The ball jumps to 1.45× speed with a flame trail |
| GHOST BALL | The ball goes near-invisible for four seconds, flashing briefly mid-court |
| SHRINK RAY | Their paddle drops to 55% width for five seconds |
| BEACH BALL | The ball inflates to 2.3× size, slow and floaty, for six seconds |

The three chaos items keep a fairness valve each: the ghost ball is always
visible in the last fifth of the court before either goal, so the save stays
makeable rather than a coin flip; the shrink ray stacks multiplicatively with
BIG PADDLE instead of overriding it; and the beach ball's speed is capped near
serve pace while inflated (only AFTERBURN punches through), because a huge
*fast* ball is not actually funny. GHOST BALL and BEACH BALL roll at weight 2
against the others' 3–4 — they are punchlines, and punchlines wear out if they
land every rally.

With multiball live, a ball leaving the court still scores and is removed while
the others keep playing, so a multiball can swing two or three points in one
frantic exchange.

**Party mode.** A lobby toggle (host's call, like stage and target) that turns
the chaos dial without touching the tuned classic game: crates arrive every
2.4–4 s instead of 6–9.5, three may share the court instead of two, the rally
only needs one return before crates start, and multiball rolls at triple
weight — a full court is the whole point. Everything else — physics, speeds,
paddles, specials — is untouched, so party mode is the same game played in a
hailstorm. It rides the `setup` and `start` messages like every other match
parameter, and the leaderboard deliberately does not distinguish the two modes:
one family table beats two half-empty ones.

**Rally pressure.** Past twenty returns two things start happening: the speed
ceiling creeps up (to about 2.4 court-heights/s) and both paddles shrink,
losing up to a third of their width. It is symmetric, visible, and it means no
point can run forever. In headless testing against a near-perfect returner it
brought unbounded rallies down to something that resolves; against humans it
mostly shows up as the moment a long rally starts to feel dangerous.

---

## 5. Netcode

**Host-authoritative with local prediction of one paddle.**

The host simulates everything and broadcasts a snapshot 30 times a second over
an *unreliable, unordered* data channel — for a stream where the next packet
supersedes this one, retransmitting a stale ball position is worse than
dropping it. Snapshots carry a tick counter and anything older than the last
one applied is discarded.

The guest sends only its paddle x, also at 30 Hz on the unreliable channel, and
renders what it is told — with one exception. Its own paddle is simulated
locally from the raw finger position and gently pulled back toward the
authoritative value (snapping only if they diverge by more than 0.14 of the
court). The paddle therefore never lags the thumb, while the host stays the
single source of truth for every collision.

Between snapshots the guest extrapolates ball positions along their last known
velocity, which on a LAN's few milliseconds of latency is visually exact. In
testing, host and guest ball positions stayed within about 0.01 of the court of
each other.

Anything that must not be lost — character picks, the match start, the final
result, emotes, the special-move button press — goes on a second, **reliable
and ordered** channel. Both channels ride one peer connection.

---

## 6. Getting the two phones connected

This is the part the brief made hard. "Browser based", "no server", and
"two Android phones" together rule out the obvious answers: a phone cannot
listen on a socket from inside a browser, and WebRTC needs the two ends to
exchange a session description before it can connect.

So the phones exchange it **optically**.

The obstacle is size. A Chrome data-channel offer is about 1.2 KB of SDP, which
produces a QR code far too dense to read off a phone screen. But almost all of
that text is boilerplate identical on both ends. The only parts that actually
differ are:

- the ICE username fragment and password
- the DTLS certificate fingerprint (32 bytes)
- the candidate list — and Chrome's mDNS candidates are UUIDs, which pack from
  36 characters down to 16 bytes

Extracting exactly those, packing them binary, and Base32-encoding the result
gives a **117-character code** that fits in a 41×41 QR — comfortably scannable
at arm's length. The far side rebuilds a complete, valid SDP from a template.
Before trusting the compact form the encoder decodes its own output and checks
that the credentials and fingerprint survived; if anything looks wrong it falls
back to shipping the whole SDP deflate-compressed, which produces a denser code
that still works.

The handshake is therefore: **host shows a code → guest scans it → guest shows
a reply → host scans that**. Two scans, no typing, no server. The host's camera
runs *while its invite is on screen*, so the second scan needs no tap at all:
the moment the guest holds up the reply, pointing the host phone at it is the
whole remaining step. Every step also offers the code as text with a share
button, so two friends can send it to each other in any chat app if a camera
is unavailable — which is also the fallback on any browser without the Barcode
Detection API. A shared invite travels as a link the friend just taps, and a
pasted code connects the instant it lands in the box.

STUN servers are configured but unused on a shared WiFi, where local candidates
win immediately. ICE gathering is treated as settled 0.4 s after the last
candidate arrives, with a three-second hard cap: a WiFi with no internet behind
it never reaches "complete" — its STUN requests just vanish — so waiting for
the cap on both phones used to add six seconds of dead air to every handshake.
Local candidates arrive within milliseconds and are the ones that connect.

### iPhones

No browser on iOS can scan a QR code. The Barcode Detection API is Chromium's,
and on iOS every browser is Safari underneath, so an iPhone could display the
invite but never read one.

iOS *has* read QR codes since iOS 11 — in the Camera app, not the browser — but
it only offers a tappable action when the code contains a URL. So the invite is
encoded as one: `https://…/RoGuPong/#j=<code>`. The iPhone points its own camera
at the host's screen, taps the banner, and the game opens with the code in the
fragment and joins itself. Any scanner app works, not just ours, and there is no
camera permission prompt inside the page.

The cost is a denser symbol — the URL prefix adds 43 characters and forces byte
mode instead of alphanumeric, taking the invite from 37x37 modules to 49x49,
which is still comfortable at arm's length. The reply code stays bare: it is
only ever read by the scanner inside the game, and making it a link would
navigate the host away from its own live connection.

Two consequences follow. Opening an invite while the game is already running
changes only the fragment, so the page listens for `hashchange` as well as
checking on startup. And because only the joining direction is solved, an
iPhone should be the one that joins — it can host, but takes the reply by paste.

Decoding QR in JavaScript would have covered every combination including two
iPhones. It was started and then deliberately dropped: roughly seven hundred
lines of binarizer, perspective sampling and Reed-Solomon error correction, to
give an iPhone a *worse* scanning experience than the camera it already has, for
a pairing neither of the two players in this game has.

---

## 7. Presentation

**Everything is generated.** There are no image files, no audio files and no
web fonts in this game, which is what lets it run from a cache on a WiFi with
no internet.

- **The logotype** is a bespoke pixel letterform — hand-drawn 9×12 capitals and
  8×8 lowercase — rendered with a hard outline, a drop shadow, a vertical
  colour ramp per letter (Ro warm, Gu cool, Pong gold), a gentle arc across the
  word and a specular highlight that sweeps across it every few seconds.
- **All in-game text** uses a 58-glyph 5×7 bitmap font defined in this repo, so
  the game looks identical on every handset. Outlines are drawn thinner than
  one font pixel, because a full-pixel outline swallows the counters of glyphs
  like 0 and 8 and turns a score into an unreadable brick.
- **The stages** are procedural: a sky gradient, two parallax skylines built
  from a seeded generator, and per-stage extras — canal shimmer at Navigli,
  cathedral spires at the Duomo, an arcade checkerboard at Brera, mountains
  over the Alps.
- **The feedback layer** is where the 16-bit feel actually lives: hit sparks
  fired along the return angle, expanding rings, screen shake scaled to the
  weight of the event, freeze-frames on a big hit, ball trails that turn to
  flame when the ball is hot, full-screen colour washes on specials and goals,
  pixel text that pops and drifts off a milestone rally, and a CRT scanline and
  vignette pass over the whole thing — menus included.
- **The celebrations** escalate with the stakes. Reaching match point adds a
  red wash and a court-wide ring to the goal blast; three points in a row puts
  an "N IN A ROW!" banner on the court and a pulsing ×N marker under the
  scorer's score until the run ends; and winning the match fires a fireworks
  volley plus a confetti rain — winner's phone only, falling toward whichever
  screen edge is "down" in that player's flipped view. Confetti rides the
  existing particle budget, so low-quality phones get a thinner rain rather
  than a dropped frame.
- **The audio** is synthesised live with Web Audio: square-wave lead, triangle
  bass and a noise hat over a four-bar loop in A minor, faster during a match
  than in the menus, plus about a dozen one-shot effects whose pitch rises with
  the rally count.

---

## 8. The leaderboard without a server

Each phone keeps its own list of finished matches in `localStorage`. Records
are immutable and carry a random id, so when two phones connect they simply
send each other their recent history and take the **union** — no conflicts, no
clocks to reconcile, and both friends end up looking at exactly the same table.
Standings, win rates, point differential, longest rally and head-to-head are
all derived from that list at render time.

The practical effect is that the leaderboard survives even if one phone is
wiped, as long as the other one has played those matches too.

**Flair.** Cosmetic unlocks ride the same records. Four looks — RAINBOW (reach
a 20-hit rally), FLAME (win ten matches), STARLIGHT (play all four stages),
ROYAL (win without conceding) — are *computed* from the match history every
time they are asked for, never written down when earned: records stay
immutable, the merge stays conflict-free, and because histories are shared,
flair earned on one phone is already earned on the other. The chosen flair
lives in the profile and rides the `hello`/`pick` messages, so the rival's
phone renders your look; in play it colours your paddle's trim and the trail
of any ball you touched last, so a rally visibly trades ownership. There is no
anti-cheat — a guest claims whatever flair it likes and the host draws it,
because the threat model is two kids on a sofa.

---

## 9. Failure modes, and what happens

| What goes wrong | What the game does |
| --- | --- |
| No camera / no Barcode Detection API | Falls back to copy-and-paste codes, and says so up front |
| Compact SDP encoding not viable | Silently ships the full description, compressed |
| ICE gathering stalls (no internet) | Settled 0.4 s after the last candidate (3 s hard cap); local candidates are enough |
| Camera denied while hosting | The preview is removed; share and paste still work |
| WiFi has client isolation | Connection fails cleanly with a note suggesting a hotspot |
| Connection drops mid-match | Heartbeat notices within 8 s and shows a link-lost screen |
| A snapshot arrives late | Discarded by tick number |
| The special press is dropped | It cannot be — it travels on the reliable channel |
| Screen sleeps mid-match | Wake lock requested for the duration of the match |
| No internet on the second visit | Service worker serves the whole game from cache |
| The phone can't hold 45 fps | Demoted to the cheap render path within seconds, stickily (see below) |

**The cheap render path.** A budget phone's GPU is fill-rate-bound, and the
game's look is mostly full-screen fills, so `low` quality attacks exactly that:
the canvas renders at 1× instead of device pixels (on a 720p phone that halves
the pixels filled), the whole backdrop — sky, skylines, water — is painted once
per stage into an offscreen canvas and blitted as a single composite instead of
~a hundred fills a frame, canvas shadows (the single most expensive 2D feature
on a weak GPU) are off, and the CRT scanline/vignette passes are skipped. The
gameplay stays pixel-identical; only the dressing thins. Gradients everywhere
are cached rather than rebuilt per frame, in both quality levels.

The demotion watcher judges tumbling windows of 45 frames — or 1.5 s of wall
clock, whichever comes first, so a phone crawling at a few fps is judged in a
couple of seconds rather than after 45 slow frames. Two windows under 45 fps,
or a single window under 32 fps, drop the profile to `low`; the choice is
sticky for the session and persisted, so an old handset settles once. The
canvas is also created `desynchronized`, letting Chrome present frames without
waiting on the compositor — a real slice of touch-to-paddle latency on Android.

---

## 10. Deliberately not built

- **No AI opponent.** The brief is a game for two friends. A single-player mode
  would have eaten the time that went into making the handshake painless.
- **No matchmaking or lobbies beyond the two phones.** Anything that finds
  players for you needs a server.
- **No rollback netcode.** On a shared WiFi the round trip is a handful of
  milliseconds; prediction of one paddle covers it, and rollback would have
  added a large amount of machinery for something nobody would feel.
- **No account system.** A name typed on the title screen is the whole
  identity, and that is enough for a leaderboard between friends.
