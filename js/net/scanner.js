// RoGuPong — reading the other phone's screen through the camera.
//
// Chrome on Android ships the Barcode Detection API, so the whole scanner is
// "point the rear camera at the other handset and poll". Where it is missing
// the UI falls back to pasting the code, which is why every failure here is
// reported rather than thrown into the void.

import { extractCode, CODE_RE } from './sdp.js';

export function scannerSupported() {
  return typeof window !== 'undefined'
    && 'BarcodeDetector' in window
    && !!navigator.mediaDevices?.getUserMedia;
}

export class Scanner {
  constructor() {
    this.stream = null;
    this.detector = null;
    this.timer = null;
    this.running = false;
  }

  /**
   * Start the rear camera and call `onCode` with the first RoGuPong code seen.
   * Returns a promise that resolves once the preview is actually playing.
   */
  async start(videoEl, onCode, onError) {
    if (!scannerSupported()) throw new Error('this browser has no camera scanner');

    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (!formats.includes('qr_code')) throw new Error('this browser cannot read QR codes');
    this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    videoEl.srcObject = this.stream;
    videoEl.setAttribute('playsinline', '');
    videoEl.muted = true;
    await videoEl.play();

    this.running = true;
    let busy = false;
    this.timer = setInterval(async () => {
      if (!this.running || busy || videoEl.readyState < 2) return;
      busy = true;
      try {
        const found = await this.detector.detect(videoEl);
        for (const b of found) {
          // The invite is a link now, so unwrap it before matching.
          const value = extractCode(b.rawValue || '');
          if (CODE_RE.test(value)) {
            this.stop();
            onCode(value);
            return;
          }
        }
      } catch (err) {
        if (onError) onError(err);
      } finally {
        busy = false;
      }
    }, 90);
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
    this.timer = null;
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }
}
