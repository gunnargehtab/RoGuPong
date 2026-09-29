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
becomes the HUD: a strip of 8% of the height above the court for the rival and
9% below it for you. With no special button to house (§3), that is about 12%
more court on a 16:9 phone than the old layout gave; a taller phone runs out of
width first. Court and HUD share the screen's *safe area*: a notch, a Dynamic
Island or a home indicator only ever covers backdrop, never a name or a score.

The HUD is sized by those strips and by the court's width, never by the
screen's width, and stays within the court's edges. Sized by the screen, a
tablet or a desktop window drew names six to eleven times too big, ran the
rival's meter across the court and pushed your own meter off the bottom of
the screen. Now each strip holds the biggest name, hero and meter stack that
fits it, with the name size shared by both strips and capped so a nine-letter
name takes at most half the court. A 16:9 phone gives up a step of text size
for its bigger court, a tall phone keeps its sizes, a tablet gets them a
little bigger, and a landscape window — letterboxed, with stage art filling
the sides — still fits everything, just small.

| Quantity | Value | Why |
| --- | --- | --- |
| Ball radius | 0.019 | Big enough to read at arm's length on a 5" screen |
| Paddle width | 0.20 base | A fifth of the court; generous, before character modifiers |
| Paddle line | y = 0.905 / 0.095 | Leaves room behind the paddle for the shield |
| Serve speed | 0.62 court-heights/s | ~1.6 s to cross — a beat to breathe |
| Speed ramp | ×1.035 per hit | Doubles over ~20 returns |
| Speed ceiling | 1.75, rising with rally heat | ~0.6 s to cross at the cap |
| Paddle speed | 2.35 court-widths/s | A full-court recovery is *just* possible |
| Heading floor | 35% of the speed toward a goal | No ball rattles wall to wall |
| Lean | up to 1.6×, below 55% toward a goal | No ball crosses slower than a 57° one |

That last row is the most important number in the game. It is tuned so a
committed player can reach a ball hit to the far corner, but only barely and
only if they start moving immediately. Faster and the game is a stalemate;
slower and wide angles become unreturnable and the whole angle-control system
stops mattering.

**Angle control.** Where the ball meets the paddle sets the departure angle, up
to 60° off vertical at the very edge. Paddle motion at the moment of contact
adds up to 10° more for GU and 15° for NEO, which is what lets a player
"carry" the ball sideways. (The code clamps motion at ±20°, but no hero's
paddle moves fast enough to reach it.) Those are angles in court units. The
court is only 0.56 as wide as it is tall, so on screen an edge hit leaves at
about 44°, and paddle motion swings a return 6–9° from a centre hit or 11–15°
near the edge. Nothing leaves flatter than the heading floor below: about 70°
in court units, 56° on screen.

**Every ball keeps heading somewhere.** Flat balls used to be the dullest
thing in the game. A return could leave at 72°, where only 31% of its speed
carries it toward the other goal. At early-rally pace it took 3.7 s to cross,
against 1.2 s for a straight one, and on screen it moved at 62% of a straight
ball's speed, visibly crawling from wall to wall. Worse were stuck balls,
untouched for more than 8 s: about 29 per 100 bot matches, one of them for
133 s. Paddle returns weren't the cause. CURVE's spin bends a ball toward flat
(about 55% of stuck balls), multiball fans its extras ±0.42 rad around an
already flat heading (30%), and QUAKE reversed balls that were already flat
(15%). Two host-side rules fix it:

- **The floor.** Every free ball keeps at least 35% of its speed heading for a
  goal (`MIN_VY`). It is applied after a return, on every step after spin
  bends the ball, to multiball's extras and after a QUAKE. It generalises the
  SPIRE's old rule. A CURVE still bends, but it can't go flat.
- **The lean.** A ball flatter than about 57° travels faster than its speed
  says: its speed toward the goal never drops below 55% of its speed
  (`LEAN_K`). That is a boost of at most 1.6× (`LEAN_MAX`), which the floor
  never quite needs. The path and the wall bounces don't change, so the ball
  just gets there sooner. No ball takes longer to cross than a 57° one: 2.4 s
  at serve pace and 1.8 s at 0.8, against 3.7–4.1 s and 2.9–3.2 s before.
  The lean never lifts a ball past the rally's current speed ceiling (or a
  beach ball's), so only slow balls get help. Two shots keep their own tuning
  and get no lean: a MAGNET fling until the next paddle touch, and an ARCO
  bend.

In the bot tournament behind these rules, stuck balls went to none, and early
crossings over 2 s fell from 4.1% to 0.8%, with none over 3 s. Flat returns
won the point outright about 2.5× as often, so aiming wide pays again: NEO's
"deeply unfair angles" are back. A CURVE's average crossing dropped from 1.8 s
to 0.9 s. Options rejected on the way:

- A tighter 60° clamp barely helped, because returns are mostly under 60°
  already.
- A 0.50 floor deleted every return over 60°, NEO's included.
- The 0.35 floor alone still left flat returns taking 2–3.4 s.
- A speed-up on each wall bounce sped up the whole game and left stuck balls.
- A speed-up while a ball goes untouched was hard to read and left stuck
  balls too.

The snapshot carries the velocity a ball actually travels at, so the guest
needs to know nothing about either rule.

---

## 3. The roster

Six fighters. Nobody is strictly better: wide paddles are slow, fast paddles
are small, and every special costs a full meter.

| | Paddle | Speed | Meter | Special | What it does |
| --- | --- | --- | --- | --- | --- |
| **RO**, the Crimson Comet | 1.00 | 1.05 | 1.00 | AFTERBURN | Next return leaves at ~1.9× speed, trailing fire |
| **GU**, the Azure Bulwark | 1.35 | 0.85 | 0.95 | AEGIS | A barrier over 0.4 of the goal saves one ball within 6 s; a second press that point raises a midline wall |
| **NEO**, the Neon Trickster | 0.80 | 1.28 | 1.05 | CURVE | Next return bends through the air for three seconds |
| **BRIO**, the Bronze Bruiser | 1.12 | 0.95 | 0.95 | QUAKE | Slams every ball on the rival's side back at them and bogs their paddle down for 1 s |
| **MAG**, the Junkyard Magnet | 1.12 | 1.00 | 1.00 | MAGNET | Catches the next ball; slide to aim, it flings back at 1.45× |
| **BOO**, the Friendly Phantom | 0.85 | 1.18 | 1.05 | PHANTOM | Next return turns the ball into a ghost for three seconds |

The specials are deliberately of two kinds. AFTERBURN, CURVE and PHANTOM are
*armed* — they wait for your next hit, so using them well means choosing which
rally to spend them on. AEGIS and QUAKE are *immediate* — they change the
board the moment you fire them. MAGNET sits between the two: it arms
the paddle, but the payoff is interactive. The caught ball rides the paddle
for 0.6 s and the drag is the aim: however far you haul it from where it
was caught sets the launch angle, so dragging across the court slings a sharp
diagonal and holding your ground fires it dead straight. Position rather than
velocity, deliberately — no split-second flick timing required of a
seven-year-old thumb. A magnetised paddle reaches a little wider than a
bouncing one (1.6 half-widths from its centre instead of 1.12), and the catch
earns meter like any return. A quake breaks the catch: the ball is slammed off
the magnet and comes back as a plain unaimed return, which keeps BRIO an
honest answer to a MAG who camps.

**AEGIS** raises a barrier across 0.4 of GU's goal, centred where GU stood when
pressing. It saves one ball, or runs out after 6 s, blinking through its last
second. A ball wide of it is a goal. **The second press in the same point
raises a wall on the midline** instead, on the same terms: 0.4 of the court
wide, centred where GU stood, one save, six seconds. It works whether or not
the barrier still stands. Each press costs a full meter, so the wall is a
reward for a long rally of about twelve hits or more. The wall is one-way: it
stops only balls heading for GU's goal, so GU's own shots sail through, and
chevrons on it point the way it sends balls. It can't be sneaked past, because
collisions are checked along the ball's whole path, and a block ends a CURVE
or an ARCO bend. With multiball, the first ball to reach it uses it up. A
caught ball isn't stopped, only the fling that follows it.

A wall that close to the rival could have been a counter-attack: a ball
bounced back from the midline leaves the rival half the court to react in,
about 0.3 s at a high pace. So a block drops the ball to serve speed, which
gives even the slowest paddle, BRIO's, about 0.67 s. The snowdrift already
follows the same rule: a save, not a counter-attack. Like a barrier save, a
wall block makes GU the ball's owner and earns no rally or meter credit.
BRIO's QUAKE shatters the wall, which would otherwise bat the quake straight
back, and that keeps BRIO the hard counter. Crates never collide with walls,
so they drift straight across it. One wall at a time: pressing while one
stands is refused. Every press after the first in a point raises a wall.

**QUAKE** is an attack, not a panic button. It sends every ball on the rival's
side back at them, and it rips a caught ball off a magnet. A ball already on
BRIO's half and bearing down on BRIO's goal is left alone, because BRIO has to
return that one. The rival's paddle is bogged down at half speed for a second.

**A press that would change nothing is refused**, and the meter stays full:
arming AFTERBURN, CURVE or PHANTOM while it is already armed, a MAGNET that is
already waiting, or a second midline wall. Before, such a press emptied a full
meter for nothing.

**The meter** fills at 0.17 per return you make plus a slow trickle of 0.022/s,
each scaled by the hero's meter rate in the table, so an aggressive rallying
player charges in about five exchanges and a passive one still gets there
eventually.

**The meter lives on the paddle**, because that is where the player is already
looking. A strip inside each paddle fills left to right with the charge; once
it is full the whole paddle blinks three times a second in the hero's colour
lit halfway to white — never gold, which already means the grow ring and the
royal flair — and sheds little pips toward the rival. Both paddles show it, so
you can see the rival's QUAKE coming too. It is all flat fills and works the
same on fast graphics; full graphics adds a glow. The meters in the HUD stay
as a second readout, their rim blinking in step.

**Tap your paddle to fire.** Control is absolute — the paddle goes where your
finger is — so tapping the paddle where it already stands barely moves it,
which makes the paddle itself the one place a trigger costs nothing. A press
anywhere in your paddle's column (a fingertip's slack either side, above or
below it) fires the special on release if it lifted within 200 ms and moved
less than 10 px; anything longer or further is an ordinary drag, so grabbing
the paddle mid-rally never fires it by accident. A second finger can tap while
a thumb holds the screen, and the thumb takes the paddle straight back. A
mouse click works the same, and Space or Shift fire on a keyboard. MAGNET's
drag-to-aim is untouched: by the time a ball is caught the meter is already
spent. The special button this replaced cost the bottom strip its height;
removing it is what gave the court its extra 12% (§2). The first time your
meter fills, TAP PADDLE stands over your paddle until you have fired once;
the profile remembers, so it is taught once per phone.

**Balance version.** The numbers above are balance version 2 (`BALANCE` in
`characters.js`). Every match record carries the version it was played at, so
any change here — or to how a special plays out — bumps it, and the Heroes
tab can then show win rates since the patch (§8).

*Version 2* was the first balance pass, made before there was much real match
data. It came from a read of each special in the code and a headless bot
tournament on the real `Match`: all 30 pairings, 1,200 matches a run, crates
on, with a "kid" and an "adult" bot skill. In version 1, BRIO won 92%/95% of
the bot matches and GU 83%/83%, while MAG won only 11%/13%. NEO (45%/39%), BOO
(39%/35%) and RO (32%/37%) sat in between. Bots are perfect at some things
(they never hesitate over the special) and bad at others (aiming MAG's fling),
so the numbers are a direction, not the truth. The Heroes tab's real matches
decide the next pass.

- **GU.** AEGIS was a full-width free life that never expired: its 6 s
  duration was never counted down, so the best play was to fire it the moment
  it lit up. GU also had the fastest meter (1.10). Now the barrier runs out
  after 6 s and covers 0.4 of the goal where GU stood, and the meter rate
  drops to 0.95. The rule fix alone brought GU to about 65%. Leaving GU as it
  was would have been worse once BRIO was fixed: QUAKE was GU's only real
  counter, and GU would have won about 95%.
- **BRIO.** QUAKE was a guaranteed save *and* a counter-attack. It sent every
  ball back from anywhere, even one already behind BRIO's paddle, sped it up
  ×1.15 and slowed the rival for 2.5 s. BRIO won 81–90% of the points in which
  it used QUAKE. Now it leaves balls on BRIO's half heading at BRIO's goal
  alone, with no speed-up, and slows the rival for only 1.0 s. The rule change
  alone left the adult bots at about 81%, so the numbers went too.
- **MAG.** MAGNET added almost nothing: MAG's point win rate was about the
  same with or without it. MAG was narrower and slower than BRIO, couldn't
  save a ball it couldn't reach, showed its aim for a full second, and a catch
  earned no meter. Now the paddle is 1.12 (was 1.05) and the speed 1.00 (was
  0.92), the magnet catches out to 1.6 half-widths (was 1.12), the hold lasts
  0.6 s (was 1.0) and the fling hits ×1.45 (was ×1.3). A catch also earns
  meter.
- **Unchanged:** RO, NEO and BOO, and GU's width and speed. With specials off,
  which of width and speed wins depends on how precise thumbs are. With
  perfect aim NEO won 90% and GU 32%; with 3–5 mm of thumb error it was the
  reverse. So those numbers wait for real data.

For the whole package the bots estimated every hero between 26% and 66%, down
from 11–95%. The kid bots gave RO 45%, GU 59%, NEO 61%, BRIO 43%, MAG 37% and
BOO 54%; the adult bots gave 50%, 66%, 51%, 63%, 26% and 45%. MAG stays lowest
for the adult bots, but bots are worst at exactly MAG's skill, aiming the
fling. GU's midline wall and the heading floor and lean (§2) came in the same
release; the floor and lean moved hero win rates only within noise, and
slightly toward parity.

---

## 4. Items and pressure

A crate drifts through the middle third of the court every 6–9.5 seconds, at
most two at a time, and only once a rally is at least two hits old. **Whoever
last touched the ball that breaks the crate gets the pickup**, immediately —
items reward winning the exchange, not standing in the right place.

| Item | Effect |
| --- | --- |
| MULTIBALL | Two extra balls join the rally, fanned either side of its heading (hard cap of five on the court) |
| BIG PADDLE | Your paddle swells 60% for seven seconds |
| DEEP FREEZE | Their paddle moves at half speed for four seconds |
| TURBO | The ball jumps to 1.45× speed with a flame trail |
| GHOST BALL | The ball goes near-invisible for four seconds, flashing briefly mid-court |
| SHRINK RAY | Their paddle drops to 55% width for five seconds |
| BEACH BALL | The ball inflates to 2.3× size, slow and floaty, for six seconds |
| REFLECTION | For five seconds a decoy ball mirrors the real one across the court's long axis |
| SPIRE | A marble pinnacle rises mid-way into their half for six seconds; balls bounce off it |
| ARCO | For six seconds your returns bend back toward the middle in an arch |
| AVALANCHE | A snowdrift guards the half of your goal line your paddle isn't covering — 7 s or two saves |

**Every stage deals its own four.** MULTIBALL drops everywhere (party mode is
built on it); each stage adds two classics that suit the place and one
signature crate found nowhere else, so the four courts play a little
differently as well as looking different:

| Stage | Crates |
| --- | --- |
| Navigli Night | MULTIBALL, GHOST BALL, TURBO, **REFLECTION** |
| Duomo Rooftop | MULTIBALL, BIG PADDLE, SHRINK RAY, **SPIRE** |
| Brera Arcade | MULTIBALL, BIG PADDLE, BEACH BALL, **ARCO** |
| Alpi Sunset | MULTIBALL, DEEP FREEZE, TURBO, **AVALANCHE** |

The pool rides nothing new on the wire: only the host rolls crates, and it
takes the pool from the stage — minus any crate newer than the other phone's
build (see *Mixed builds* in §5) — while the weighted roll walks the item list
in its own order, so how a pool is written never changes what gets dealt. The
signature crates all weigh 3 — about one crate in four — against the classics'
existing 2–4.

The three chaos items keep a fairness valve each: the ghost ball is always
visible in the last fifth of the court before either goal, so the save stays
makeable rather than a coin flip; the shrink ray stacks multiplicatively with
BIG PADDLE instead of overriding it; and the beach ball's speed is capped near
serve pace while inflated (only AFTERBURN punches through), because a huge
*fast* ball is not actually funny. GHOST BALL and BEACH BALL roll at weight 2
against the others' 3–4 — they are punchlines, and punchlines wear out if they
land every rally.

The signature crates carry valves of their own:

- **REFLECTION** is drawn, never simulated: the decoy can't collide, score or
  break crates. It is a shade dimmer than the real ball with a ripple running
  through it, so a sharp eye can tell them apart, and it fades out between 0.3
  and 0.2 of the court from either goal — every save is made against the real
  ball. It blinks along with a ghost ball, so the pair can't be read by which
  one flickers, and it vanishes while the ball sits on a magnet.
- **SPIRE** stands only on the rival's half, 0.2 short of their paddle, and it
  never rises in the path of the shot that raised it — it keeps clear of where
  that ball will cross its line, further for a slanting ball — so the picker's
  own attack isn't batted straight back at them. Its radius (0.06 court widths) leaves at least 0.146 to
  each wall, so a ball always fits past. Collision is tested along the ball's
  whole path in true court proportions, so nothing tunnels through, and a
  spire rising onto a ball pushes it clear. A bounce keeps the ball's speed and
  its last toucher, and like every ball (§2) it leaves with at least 35% of its
  speed vertical, here heading away from the spire, so a glancing hit can't go
  flat and rattle between spire and wall. One per player; a second pick moves
  it.
- **ARCO** bends only the picker's own returns, and the bend ends on the next
  touch of anything — paddle, wall, spire, the rival's AEGIS — so it never leaks
  into the reply. The spin scales with the shot's width and with pace
  (`2.2 · |sin angle| · (speed/0.62)^1.75`, none under 0.15 rad), which gives
  the same arch at every speed: a 60° return peaks around x 0.7 and arrives
  about 15° back the other way, never wider than it left and never looping. A
  mid-flight TURBO or BEACH BALL rescales the bend to the new pace, NEO's CURVE
  outranks it on the same hit, and MAG's fling is never bent, so aiming by
  dragging stays exact. Three stone arches on the paddle warn the rival.
- **AVALANCHE** covers only the half of your goal your paddle isn't already
  covering (36% of the line), sits behind the shield line so paddle and AEGIS
  play first, and takes 12% off a ball it saves — a save, not a counter-attack.
  The first block visibly bites a chunk out of it; the second clears it.

With multiball live, a ball leaving the court still scores and is removed while
the others keep playing, so a multiball can swing two or three points in one
frantic exchange.

**Party mode.** A lobby toggle (host's call, like stage and target) that turns
the chaos dial without touching the tuned classic game: crates arrive every
2.4–4 s instead of 6–9.5, three may share the court instead of two, the rally
only needs one return before crates start, and multiball rolls at triple
weight within the stage's pool — about half of all crates — because a full
court is the whole point. Everything else — physics, speeds,
paddles, specials — is untouched, so party mode is the same game played in a
hailstorm. It rides the `setup` and `start` messages like every other match
parameter, and the leaderboard deliberately does not distinguish the two modes:
one family table beats two half-empty ones. (Each record does note its mode,
for the balance data in §8.)

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
locally from the raw finger position, and the authoritative echo of it is used
only to detect *genuine* desync, never to fight the thumb. The subtlety is that
the echo is a whole network round stale — input interval, RTT, snapshot
interval, a frame at each end, ~60–130 ms in all — so it reports where the
paddle *was*, not where it is; after a sharp thumb reversal the two ends
diverge at twice the paddle speed and any naive "pull toward the server"
correction reads that pure lag as error. (An earlier version did exactly that,
snapping past 0.14 court of divergence — which fired on every hard reversal
and teleported the paddle backwards mid-swipe, a visible twitch, worst on
phones and networks with the most latency.) Instead the guest keeps
0.45 s of its own paddle's history — nearly twice the worst staleness stack,
including a 30 Hz low-power-mode frame at each end — and compares the echo
against the whole span covered in that window. An echo inside the span is merely the past
and is left alone; only distance beyond the span is real desync (a lost input
burst, a clamp mismatch), eased away at 2.5/s, or snapped when it exceeds 0.14
of the court. If no fresh snapshot has arrived within the window the echo
proves nothing and no correction is applied at all. The paddle therefore never
lags or fights the thumb, while the host stays the single source of truth for
every collision.

Two details keep the echo's staleness from growing when a phone starts
struggling: the 30 Hz send accumulators subtract their interval instead of
resetting to zero (zeroing rounds the cadence up to whole frames — 22 Hz on a
45 fps phone), and a state packet is dropped at the source rather than queued
once the channel is holding more than 4 KB of unsent bytes (about five
snapshots), because the next packet supersedes it anyway and a queue on a
stalling radio only ever adds latency.

Between snapshots the guest extrapolates ball positions along their last known
velocity, which on a LAN's few milliseconds of latency is visually exact. In
testing, host and guest ball positions stayed within about 0.01 of the court of
each other. The ball velocities in a snapshot are the ones the balls actually
travel at, the lean (§2) included, so the guest extrapolates a flat ball at
its real pace without knowing the rule. The stage objects — the signature
crates' spires and snowdrifts, and GU's midline wall — travel in each snapshot
as a short list (kind, position, size, time left, owner, blocks), and the guest
bounces its extrapolated balls off them with the same geometry the host uses
(no scoring, no events), so a ball never sails through a spire for a frame
while the correction is in flight. REFLECTION, ARCO and the AEGIS barrier ride
as seconds-left values on the ball and paddle entries, so the decoy's fade and
the badge's and barrier's last-second blinks match on both phones. The
barrier's position is appended after them. Its seconds-left value never drops
under 0.1 while it stands, so a build that reads it as an on/off flag still
sees it. Every new field is appended to the end of its array, so a phone still
on an older build never trips over it — and a guest ignores prop kinds it
doesn't know.

**Mixed builds.** The service worker makes the game playable offline, which
also means a phone that last loaded it before an update keeps running the old
build on a WiFi with no internet — and an old guest can't draw what newer crates
put on the court (it would see balls bounce off spires it doesn't know exist).
So each phone sends a protocol number in its `hello` (builds from before the
number existed send none, which reads as 1). A build without the number can't
notice a mismatch at all; any build with it names whichever phone is out of
date — the other one or itself — in a toast and a notice in the lobby saying
reloading that phone with internet updates it. Meanwhile the match sticks to
what both can show: every crate carries the first protocol whose phones can
draw it, and a host leaves out anything newer than the other phone's from the
stage's pool (its lobby lists what's off). An older host simply deals what its
own build knows — all of which a newer guest can draw — so a guest facing one
says the host picks the crates rather than guessing. GU's midline wall follows
the same rule: it needs protocol 3 on both phones, because an older guest would
see the ball bounce off nothing, to the spray and thump of a snowdrift. Without
it, a second AEGIS press just raises the barrier again once the first has
gone. The rules never diverge either way — the host decides everything, balance
version included — so this is about both players seeing the same court, not
about keeping score. An older guest does draw a newer host's AEGIS wrong: it
knows nothing of the barrier's position, so it draws it across the whole goal. A newer guest facing an older host draws that host's
full-width barrier as it is. (The first build with stage crates predates the
number, so it too reads as 1: the signature crates stay off against it until
it's reloaded — conservative, but never a court one phone can't draw.)

| Protocol | What it added |
| --- | --- |
| 1 | Everything before the number existed |
| 2 | The stage crates: REFLECTION, SPIRE, ARCO, AVALANCHE |
| 3 | Balance version 2: the narrower, timed AEGIS barrier and GU's midline wall |
| 4 | The mid-match pause (§9): the hold rides the snapshot |

Anything that must not be lost — character picks, the match start, the final
result, emotes, the guest's special press — goes on a second, **reliable
and ordered** channel. Both channels ride one peer connection.

**Holding a match.** When either phone leaves its screen mid-match (§9), both
phones hold the match: the clock, the balls, the crates and every timer
freeze, and only the paddles still follow their thumbs. When everyone is back,
a 3-second countdown runs before anything moves, so the returning player finds
their paddle first. The host's hold is the one that counts. It rides the
snapshot as one number, sent only while there is a hold: -1 for paused, or
else the seconds of countdown left. The tick keeps counting through a hold, so
those snapshots are fresh. A guest also holds its own copy of the match the
moment it hears either phone has gone, rather than waiting for a snapshot to
say so, and drops any snapshot that reaches it while the host is away.
Those snapshots left before the host hid (a hidden page draws no frames, so
it sends none), overtaking its `away` message on the other channel, and would
set the court moving again. Counting back in, the guest waits for the host's
countdown rather than running its own, so the ball never sets off early on
one phone.

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

A third is easy to trip over: the Camera app opens the link in Safari (or
whichever browser is the default), never in a copy of the game added to the
home screen, and the two keep separate storage — name, match history, flair
and offline copy. On iPhones the join screen says so in a line. The game also
asks Safari for persistent storage, so the history isn't cleared when the
phone runs short of space or the site goes unvisited for a while.

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
- **All in-game text** uses a 62-glyph 5×7 bitmap font defined in this repo, so
  the game looks identical on every handset. Outlines are drawn thinner than
  one font pixel, because a full-pixel outline swallows the counters of glyphs
  like 0 and 8 and turns a score into an unreadable brick.
- **The stages** are real places, painted in code. Each is a scene module that
  paints two pictures: the backdrop, the place seen side-on, and the court
  floor, the same place seen from above — the Navigli canal at blue hour with
  lamplight streaking the water and terraces along both banks; the Duomo roof
  among its marble spires in the golden hour, the Madonnina catching the light
  and the skyline framed between the pinnacles; the arcaded courtyard of the
  Palazzo di Brera in soft daylight; the Brenta Dolomites burning at sunset
  over a snowfield. They are painted in *art pixels* — a canvas about
  min(W, H)/180 times smaller than the screen and at most half its size (on a
  phone, exactly half), scaled up without smoothing — with flat
  colours, banding and dithering instead of gradients, so every stage has the
  same 16-bit grain on every handset. During a match the court covers most of
  a portrait screen, which is why the floor carries the theme: canal water,
  marble slabs, courtyard paving, wind-rippled snow. Floors are kept dark and
  low-contrast so the ball and paddles always pop, and mirrored top to bottom
  so both phones see the same court from their own end. On full graphics each
  scene adds a small animation layer — lamp flicker, water shimmer, drifting
  snow — over the still painting. During a match the strips of backdrop behind
  the HUD are darkened in a few flat bands, so the scores read over the daylit
  stages too.
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
send each other their history and take the **union** — no conflicts, no
clocks to reconcile, and both friends end up looking at exactly the same table.
Standings, win rates, point differential, longest rally, head-to-head and the
hero stats are all derived from that list at render time.

**A pass-along league.** A phone sends *everything* it holds, not just its
owner's matches, so a group of friends who mix partners converges on one
league: Anna plays Ben, Ben plays Carlo, and Carlo's phone now knows how Anna
did. The newest 80 matches ride in `hello`, which is all a build from before
full exchange reads. The rest follows in `hist` chunks of 40, fed to the
reliable channel only as fast as it drains, so a lobby message sent meanwhile
never queues behind a whole history. The receiver gathers the chunks and
merges once at the end — one storage write and one toast — or, if the link
drops mid-stream, merges whatever made it across. Each phone keeps up to 3,000
matches (about 600 KB), the oldest falling off first; a match that arrives
only to be trimmed again isn't announced as news. The practical effect is
that the leaderboard survives a wiped phone as long as anyone in the group has
played those matches too.

**Share league / Import league** covers friends who don't meet up. Share packs
the history into a *league code* — names, heroes and stages pooled into
tables, times stored as gaps, deflated, then Base32 like the handshake codes,
with the prefix `RGL` — and hands it to any chat app inside a one-line
explanation. The random match ids dominate what is left, at about 30
characters a match, so a code kept under 60,000 characters (one WhatsApp
message) carries about two thousand matches; a longer history shares its
newest and says so. Import finds the code in whatever is pasted, the whole
message included, and merges it exactly like a connect does: nothing is
replaced or removed. The code is packed as the leaderboard opens rather than
on the tap, because the share sheet only opens inside the tap's user gesture
and some browsers let that lapse across the await that deflating takes.

**Hero stats.** The Heroes tab shows each hero's wins, losses, win rate and
share of points won, strongest first. Mirror matches are left out — they say
nothing about which hero is stronger. Between two friends the samples are
tiny and a hero's record is partly its player's, so the tab is deliberately
cautious. A rate only shows from 5 matches, with "—" before that. A hero is
only called *looks strong* or *looks weak* from 10 matches, and only once the
95% Wilson interval around its win rate clears 50%: 8–4 is still "too early to
tell", 15–5 is not. Tapping a hero splits its record by player, which tells a
strong hero from a strong player who always picks it.

Every record carries the host's `balance` version (`BALANCE` in
`characters.js`, bumped with any tuning change; records from before the field
count as version 1). Once a patch has landed, the tab shows only matches since
it, with a toggle for all. Records also note whether the match was a party
match, for the balance data below.

**Getting the data out.** Copy history, at the foot of the leaderboard, puts
the matches on the clipboard as compact CSV — about 60 bytes a match — for
pasting into an issue during balance work. Names become P1, P2… in order of
first appearance unless Copy with names is used, because issues are public.

**Names.** A typed name is the whole identity (§10), so a missing name, or two
friends with the same one, quietly merges different people into one row. A
player with no name — or one of the stand-ins the game uses for nameless
players, YOU, FRIEND, HOST and GUEST — is asked for one on the connect screen,
where fixing it costs nothing. In the lobby, where it would take leaving and
reconnecting, both phones warn when either player is nameless or both share a
name.

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

**Known limits, accepted.** The same threat model covers the league: a faked
record spreads to everyone just as a real one does. And Clear only empties
this phone — the next connect or import brings back whatever friends still
hold.

---

## 9. Failure modes, and what happens

| What goes wrong | What the game does |
| --- | --- |
| No camera / no Barcode Detection API | Falls back to copy-and-paste codes, and says so up front |
| Compact SDP encoding not viable | Silently ships the full description, compressed |
| ICE gathering stalls (no internet) | Settled 0.4 s after the last candidate (3 s hard cap); local candidates are enough |
| Camera denied while hosting | The preview is removed; share and paste still work |
| WiFi has client isolation | Link Lost says the phones couldn't reach each other, with a note suggesting a hotspot |
| The link blips (WiFi power save, a router hiccup) | WebRTC calls it `disconnected`; the game waits at least 10 s for it to recover, with a toast, before calling it lost |
| The other phone goes silent | The heartbeat gives up after 8 s with nothing heard in a match, 30 s anywhere else, and shows the Link Lost screen |
| This phone leaves the screen | No verdict on the link while it's hidden, nor for a couple of heartbeats after it comes back |
| A phone leaves the screen mid-match | The match holds on both phones, and the waiting one shows a pause screen with emotes and quick-chat. It resumes with a 3 s countdown, or is called off after 30 s |
| A friend closes the tab or reloads | Their page says goodbye on the way out, so the other phone knows at once |
| Any drop | Link Lost says why, when, how long the line had been quiet and whether either phone had left the screen (see below) |
| A match history too long for one message | Streamed after `hello` in paced chunks; a drop mid-stream keeps what arrived |
| A league code too long for a chat message | It carries the newest matches that fit, and says so |
| A snapshot arrives late | Discarded by tick number |
| The radio backs up mid-match | Superseded state packets are dropped at the source, not queued |
| The special press is dropped | It cannot be — it travels on the reliable channel |
| A screen would sleep | A wake lock is held whenever a connection is up or being made, and asked for again each time the page comes back |
| Audio interrupted (a call, Siri, an app switch) | Resumed when the page comes back and on the next touch, mid-match included |
| No internet on the second visit | Service worker serves the whole game from cache |
| The phone can't hold 45 fps | Demoted to the cheap render path within seconds, for the session (see below) |

**Keeping the link.** The heartbeat's patience depends on where the players
are. In a match, 8 s with nothing heard is an opponent gone, and every second
of it is a point being lost to a frozen paddle. Anywhere else — the lobby, the
results, the moments after a handshake while a friend is still sharing their
reply from a chat app — nothing is lost by waiting, so the phone waits 30 s.
WebRTC's `disconnected` state is meant to be temporary — a WiFi power-save
stall, a router blip, the other phone's radio napping — and usually clears by
itself. So a link WebRTC calls down gets at least 10 s, or the heartbeat's
patience if that is longer, before it is called lost. The cost is that a
phone that really vanishes (its WiFi gone, its browser killed) is reported
about 15 s later in a match rather than 8: WebRTC takes around 5 s to call the
link down, then the grace runs. A page that closes or reloads doesn't pay it,
since it sends `bye` on its way out.

A hidden page passes no verdicts at all: its timers are throttled or stopped,
and on iOS the whole page is parked, so its heartbeat would only be judging its
own absence. Coming back, it pings at once and gives the replies a couple of
heartbeats to land before judging, since what it missed is still on its way in.
The wake lock matters as much as all this: a phone that dims and locks pauses
the page. So the lock is held from the moment a handshake starts until the
phones part. Browsers drop it whenever the page hides (iOS on every
notification or app switch), so it is asked for again each time the page
comes back.

**Stepping away mid-match.** A notification, an app switch or an accidental
swipe home used to cost the point in play and, 8 s later, the whole session.
Now each phone tells the other when its page hides or comes back (`away` on
the reliable channel), and a match holds while either phone is gone (§5).
The phone still on screen puts up a pause screen: who left, the seconds left
to wait, and the emotes and quick-chat lines, whose latest one waits for the
away phone to come back before it pops. A match waits 30 s for a phone that
left, then calls it off, and both phones keep that clock. The waiting phone
ends it on time and says so in its `bye`. The phone that was away, coming
back too late, ends it too, even if that word hasn't reached it yet. A match
called off this way lands on the Link Lost screen under its own title, naming
who was away. While the friend is away the heartbeat's patience stretches to
35 s, so the pause's own verdict, which says what actually happened, always
comes first. The link stalling meanwhile raises no hiccup toast either: iOS
parks the away phone's end of the link along with its page. The pause needs
protocol 4 on both phones. Against an older build nothing holds, and 8 s of
silence in a match still ends it.

**When it drops anyway.** Every drop lands on Link Lost with its real reason
(the friend left, nothing heard for 8 or 30 s, the link went down and didn't
come back, the connection failed, the other phone closed it, the match was
called off), the step it happened at, how long since the last message, and
whether either phone had left the screen. That last one is what tells a WiFi
problem from a paused phone. It comes from the same `away` messages. Builds
from before them never send them, so nothing but the pause and the diagnostics
depends on hearing them. A **Copy diagnostics** button, on Link Lost and at the foot of
the title screen, copies that with a description of the phone (browser,
home-screen app or tab, safe area, graphics and frame rate, audio and
wake-lock state) and a log of the last 60 moments that matter: the page hiding
and coming back, link and ICE states, drops, audio and wake-lock interruptions,
errors. The log lives in `sessionStorage`, so it survives the reload iOS does
after throwing a background tab away. No player names go in it, because
reports get pasted into public issues.

**The cheap render path.** A budget phone's GPU is fill-rate-bound, and the
game's look is mostly full-screen fills, so `low` quality attacks exactly that:
the canvas renders at 1× instead of device pixels (on a 720p phone that halves
the pixels filled), the scenes' per-frame animation layers are skipped, canvas
shadows (the single most expensive 2D feature on a weak GPU) are off, and the
CRT scanline/vignette passes are skipped. The stage art itself costs the same
in both levels, and very little: backdrop and court floor are painted into
small art-pixel canvases only when the stage or the screen size changes, and
blitted as two composites a frame, however much detail the painting holds. The
gameplay stays pixel-identical; only the dressing thins. Gradients everywhere
are cached rather than rebuilt per frame, in both quality levels.

The demotion watcher judges tumbling windows of 45 frames — or 1.5 s of wall
clock, whichever comes first, so a phone crawling at a few fps is judged in a
couple of seconds rather than after 45 slow frames. Two windows under 45 fps,
or a single window under 27 fps, drop the game to `low`, and it stays there
for the rest of the session so an old handset settles once. A steady 30 fps is
not counted as slow: when at least 80% of a window's frames land near 33 ms,
that is a frame-rate cap — iOS holds every page to 30 in Low Power Mode — and
the cheap path can't beat a cap; it only makes the game look worse (at 1× on a
3× screen). The automatic switch is never saved, because Low Power Mode ends
and phones cool down, so each session takes its own look. Only a choice made
on the Graphics toggle is remembered, and the watcher leaves a hand-picked
setting alone. Earlier builds saved the automatic switch as well, which
stranded iPhones on `low` for good, so a saved `low` that wasn't picked by
hand is let go once. The first frames after the page comes back from the
background span the whole absence and are skipped. The canvas is also created
`desynchronized`, letting Chrome present frames without waiting on the
compositor — a real slice of touch-to-paddle latency on Android.

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
  identity, and that is enough for a leaderboard between friends — with a
  nudge when a name is missing or taken (§8).
- **No in-game voice, video or free-text chat.** Players talk through eight
  emoji and eight quick-chat lines ("GG", "Nice shot!", "Rematch?", "One
  sec!"…) in the lobby, on the results and on the pause screen, never over a
  rally in progress. They travel as an index into one list, so new lines are
  only ever appended, and a build from before them pops a 👋 instead. A line
  arrives in a speech bubble naming who sent it. Voice was ruled out because
  turning on the microphone changes how iOS routes the game's sound. Video
  was ruled out because a video tile covers the court on a portrait phone.
  Free text was ruled out because it would need moderating for the kids this
  is played by.
