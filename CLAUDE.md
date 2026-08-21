# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

RoGuPong is a 16-bit-styled pong duel for two phones on the same WiFi. There is no game server: the two browsers connect directly over WebRTC, exchanging the handshake by QR code. It is plain static files — no build step, no package.json, no framework, no third-party libraries, and no binary assets. The pixel font, logotype, QR encoder, audio and stages are all generated in code at runtime.

**Keep it that way.** The zero-dependency, everything-generated constraint is deliberate: it is what lets the game run from the service-worker cache on a WiFi network with no internet behind it. Do not add npm packages, CDN scripts, image/audio files or web fonts.

## Running it

```sh
python3 -m http.server 8137     # any static server works
```

Open `http://localhost:8137`. There are no tests, linters or build commands in the repo — verification is playing it. Camera access (QR scanning) requires HTTPS or `localhost`; over plain http on a phone, use the copy-and-paste code fallback that every connect screen offers.

`window.rogupong` is the live `App` instance in the console — the easiest way to poke at a running match (e.g. `rogupong.match`, `rogupong.peer`).

Deployment is GitHub Pages serving straight from `main`; every push to `main` republishes.

## Architecture

`js/main.js` defines `App`, the conductor: screen router (`go()`), connection lifecycle, and the frame loop. Menus are DOM (`js/ui/screens.js`) layered over a single full-screen canvas that renders both the menu backdrop and the match (`js/game/render.js`).

**Court model.** The match simulation (`js/game/match.js`) runs in a normalised court: x and y both 0..1, player 0 defends the bottom, player 1 the top. The renderer flips y for player 1, so each phone shows its own player at the bottom. `App.view` (0 host, 1 guest) is the local player index.

**Netcode: host-authoritative, guest predicts only its own paddle.** The host runs the full simulation at a fixed 1/60 timestep (accumulator in `App.stepMatch`) and broadcasts snapshots at 30 Hz. The guest sends only its paddle x at 30 Hz, extrapolates ball motion between snapshots, and simulates its own paddle locally (`App.predictPaddle`), snapping to the authoritative value only past 0.14 court divergence. Two data channels ride one `RTCPeerConnection` (`js/net/peer.js`):

- `ctl` — reliable + ordered: lobby messages, character picks, special presses, match start/result, emotes. Handled in `App.onMessage` (typed `{t: ...}` messages).
- `state` — unreliable + unordered: 30 Hz snapshots and paddle inputs, discarded if older than the last applied tick. Handled in `App.onState`.

Anything that must not be lost goes on `ctl`; anything superseded by the next packet goes on `state`.

**Signalling is optical.** `js/net/sdp.js` compresses a ~1.2 KB SDP offer to a ~117-char code by extracting only what differs between ends (ICE credentials, DTLS fingerprint, candidates), packing binary and Base32-encoding — prefix `RGP`. If the compact round-trip self-check fails it falls back to deflate-compressed full SDP, prefix `RGX`. `js/net/qr.js` is a complete from-scratch QR encoder; `js/net/scanner.js` scans via the Barcode Detection API (Chromium-only). ICE gathering is treated as settled 0.4 s after the last candidate (3 s hard cap) so internet-less networks don't stall. While the host's invite is on screen its camera is already scanning for the guest's reply, so the second scan needs no tap; codes can also be shared as text (Web Share API) and auto-connect when pasted.

**iPhone path.** iOS browsers cannot scan QR codes, so the host's invite is encoded as a URL (`…/#j=<code>`) that the iPhone's own Camera app reads. `App.consumeInviteLink` handles it on startup *and* on `hashchange` (tapping an invite while the page is open only changes the fragment). The reply code stays bare, scanned inside the game by the host.

**Leaderboard without a server** (`js/data/leaderboard.js`): each phone keeps immutable match records with random ids in `localStorage`; on connect, phones exchange recent history and take the union. Host and guest build identical records from the shared match id (`App.buildRecord`), which is what makes the merge conflict-free.

**Performance.** `App.sampleFrameRate` watches the real frame rate and stickily drops `renderer`/`fx` to a `low` quality path (persisted in the profile) if the phone can't hold ~45 fps.

## Things to know when editing

- **`sw.js` precache list**: every file the game loads must be listed in `ASSETS`, so adding or renaming a JS/CSS file means updating `sw.js` too. Fetch is network-first with cache fallback, so redeploys are picked up automatically.
- **DESIGN.md is the source of truth for tuning.** Every physics constant (paddle speed 2.35, speed ramp ×1.035, rally-pressure shrink, meter rates…) was deliberately balanced — the file explains why each number is what it is. Read the relevant section before changing gameplay values, and keep the doc in sync with the code.
- Both `README.md` and `DESIGN.md` describe behavior in detail; user-visible changes usually need a matching edit there.
- In-game text renders through the 58-glyph 5×7 bitmap font in `js/ui/pixelfont.js`; new glyphs must be added there before they can appear on the canvas.
