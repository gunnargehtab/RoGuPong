// RoGuPong — thumbs.
//
// Slide anywhere on the screen and the paddle follows your finger's x
// position; the button in the corner fires your special. Multi-touch is
// handled properly, so holding the paddle with one thumb and mashing the
// special with the other works the way you'd expect it to.
//
// Arrow keys and space are wired up too, purely so the game can be developed
// on a laptop.

export class Input {
  constructor(canvas, renderer) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.x = 0.5;
    this.special = false;
    this.touched = false;
    this.paddlePointer = null;
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
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  onDown(e) {
    const [x, y] = this.local(e);
    if (this.renderer.hitSpecial(x, y)) {
      this.special = true;
      if (navigator.vibrate) navigator.vibrate(18);
      return;
    }
    e.preventDefault();
    this.paddlePointer = e.pointerId;
    this.touched = true;
    this.setFromX(x);
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  onMove(e) {
    if (e.pointerId !== this.paddlePointer) return;
    e.preventDefault();
    const [x] = this.local(e);
    this.setFromX(x);
  }

  onUp(e) {
    if (e.pointerId === this.paddlePointer) this.paddlePointer = null;
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
  }
}
