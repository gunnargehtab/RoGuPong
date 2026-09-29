// RoGuPong — thumbs.
//
// Slide anywhere on the screen and the paddle follows your finger's x
// position; a quick tap on your own paddle fires your special. Control is
// absolute, so tapping where the paddle already is barely moves it — which is
// what makes the paddle itself a safe place to put the trigger. Multi-touch is
// handled properly: the newest finger steers, and when it lifts, the one still
// holding the screen takes the paddle back.
//
// Arrow keys move and Space or Shift fire, so the game can be played on a
// laptop too.

// A tap is short and still: anything longer or further is a drag.
const TAP_MS = 200;
const TAP_SLOP = 10;            // CSS pixels

export class Input {
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.x = 0.5;
    this.special = false;
    this.touched = false;
    this.paddlePointer = null;
    this.pointers = new Map();  // pointerId -> last x, oldest first
    this.tap = null;            // a press on the paddle that may yet be a tap
    this.rect = null;
    this.keys = new Set();
    this.bind();
  }

  bind() {
    const opts = { passive: false };
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e), opts);
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e), opts);
    this.canvas.addEventListener('pointerup', (e) => this.onUp(e), opts);
    this.canvas.addEventListener('pointercancel', (e) => this.onUp(e), opts);
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
  }

  local(e) {
    // getBoundingClientRect forces layout; at pointermove rates on a slow
    // phone that adds up. The canvas is full-screen and static, so measure on
    // touch-down and reuse for the whole drag.
    const r = this.rect || (this.rect = this.canvas.getBoundingClientRect());
    return [e.clientX - r.left, e.clientY - r.top];
  }

  onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.rect = this.canvas.getBoundingClientRect();
    const [x, y] = this.local(e);
    // Judged against the paddle as drawn before this press moves it.
    this.tap = this.renderer.inPaddleColumn(x) ? { id: e.pointerId, x, y, at: e.timeStamp } : null;
    this.pointers.delete(e.pointerId);
    this.pointers.set(e.pointerId, x);
    this.paddlePointer = e.pointerId;
    this.touched = true;
    this.setFromX(x);
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) return;
    e.preventDefault();
    const [x, y] = this.local(e);
    this.pointers.set(e.pointerId, x);
    if (this.tap?.id === e.pointerId && Math.hypot(x - this.tap.x, y - this.tap.y) > TAP_SLOP) {
      this.tap = null;
    }
    if (e.pointerId === this.paddlePointer) this.setFromX(x);
  }

  onUp(e) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const tap = this.tap;
    if (tap?.id === e.pointerId) {
      this.tap = null;
      const [x, y] = this.local(e);
      if (e.type === 'pointerup' && e.timeStamp - tap.at <= TAP_MS
        && Math.hypot(x - tap.x, y - tap.y) <= TAP_SLOP) {
        this.special = true;
      }
    }
    if (e.pointerId !== this.paddlePointer) return;
    // A thumb still on the screen takes the paddle back.
    const held = [...this.pointers].pop();
    this.paddlePointer = held ? held[0] : null;
    if (held) this.setFromX(held[1]);
  }

  setFromX(px) {
    const c = this.renderer.court;
    this.x = Math.max(0, Math.min(1, (px - c.x) / c.w));
  }

  onKey(e, down) {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'a', 'd', ' '].includes(k)) e.preventDefault();
    if (down && (k === ' ' || k === 'shift')) this.special = true;
    if (down) this.keys.add(k); else this.keys.delete(k);
  }

  /** Called once per frame; folds keyboard movement into the same value. */
  update(dt) {
    let dir = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dir -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) dir += 1;
    if (dir) {
      this.touched = true;
      this.x = Math.max(0, Math.min(1, this.x + dir * dt * 1.6));
    }
  }

  /** Read and clear the one-shot special flag. */
  takeSpecial() {
    const s = this.special;
    this.special = false;
    return s;
  }

  reset() {
    this.x = 0.5;
    this.special = false;
    this.touched = false;
    this.paddlePointer = null;
    this.pointers.clear();
    this.tap = null;
    this.rect = null;
  }
}
