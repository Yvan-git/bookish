/**
 * Barcode scanning.
 * Primary: the native BarcodeDetector API — implemented by Chrome/Edge on
 * **Android** and on macOS, but *not* on Windows/Linux desktops.
 * Fallback: jsQR, vendored in `app/vendor/jsQR.js` so it works offline and
 * without any CDN; a remote copy is used only if the local file is missing.
 * A USB/Bluetooth barcode keyboard ("douchette") is always supported through
 * the dedicated input field — it simply types the digits and presses Enter.
 */
import { toIsbn13, normalizeIsbn } from './apis.js';

const WANTED_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
// Resolved against *this module*, not against the document: a classic
// <script src> would look for /vendor/jsQR.js and 404.
const JSQR_LOCAL = new URL('../vendor/jsQR.js', import.meta.url).href;
const JSQR_CDN = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';

let jsQrPromise = null;

/** Load a script once and resolve when it is ready. */
function injectScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('script unavailable: ' + src));
    document.head.append(script);
  });
}

/** Load jsQR on demand (only if the native detector is unavailable). */
export async function loadJsQr() {
  if (window.jsQR) return window.jsQR;
  if (!jsQrPromise) {
    jsQrPromise = injectScript(JSQR_LOCAL)
      .catch(() => injectScript(JSQR_CDN))
      .then(() => {
        if (!window.jsQR) throw new Error('jsQR unavailable');
        return window.jsQR;
      })
      .catch((err) => { jsQrPromise = null; throw err; });
  }
  return jsQrPromise;
}

export class Scanner {
  constructor() {
    this.stream = null;
    this.detector = null;
    this.raf = null;
    this.running = false;
    this.lastCode = '';
    this.lastHitAt = 0;
    this.video = null;
    this.onDetect = null;
    this.onError = null;
    this.mode = 'native';
    this.fallbackReady = false;
  }

  static get supported() {
    return typeof window !== 'undefined' && 'BarcodeDetector' in window;
  }

  async #createDetector() {
    if (!Scanner.supported) return null;
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      const wanted = WANTED_FORMATS.filter((f) => formats.includes(f));
      if (!wanted.length) return null;
      return new window.BarcodeDetector({ formats: wanted });
    } catch (_) {
      try { return new window.BarcodeDetector({ formats: ['ean_13'] }); } catch (__) { return null; }
    }
  }

  /** Start the camera and the detection loop. */
  async start(video, { onDetect, onError } = {}) {
    this.video = video;
    this.onDetect = onDetect;
    this.onError = onError;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('camera-unavailable');
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    video.srcObject = this.stream;
    video.setAttribute('playsinline', 'true');
    await video.play().catch(() => {});

    this.detector = await this.#createDetector();
    this.mode = this.detector ? 'native' : 'jsqr';
    this.fallbackReady = false;
    if (!this.detector) {
      try { await loadJsQr(); this.fallbackReady = true; } catch (_) { this.fallbackReady = false; }
    }
    this.running = true;
    this.#loop();
    return this.mode;
  }

  #loop() {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this.#loop());
    const video = this.video;
    if (!video || video.readyState < 2 || !video.videoWidth) return;

    if (this.detector) {
      this.detector.detect(video)
        .then((codes) => {
          if (codes && codes.length) this.#handle(codes[0].rawValue);
        })
        .catch(() => {});
      return;
    }

    if (window.jsQR) {
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 640 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code && code.data) this.#handle(code.data);
    }
  }

  /** Debounce repeated detections of the same barcode. */
  #handle(raw) {
    const clean = normalizeIsbn(raw);
    if (!clean || clean.length < 8) return;
    const now = Date.now();
    if (clean === this.lastCode && now - this.lastHitAt < 2500) return;
    this.lastCode = clean;
    this.lastHitAt = now;
    const isbn = toIsbn13(clean);
    if (this.onDetect) this.onDetect({ raw: clean, isbn13: isbn, valid: Boolean(isbn) });
  }

  /** Toggle the camera torch (if the device exposes it). */
  async toggleTorch() {
    if (!this.stream) return false;
    const track = this.stream.getVideoTracks()[0];
    if (!track?.getCapabilities) return false;
    const caps = track.getCapabilities();
    if (!caps.torch) return false;
    const on = !this.torchOn;
    await track.applyConstraints({ advanced: [{ torch: on }] }).catch(() => {});
    this.torchOn = on;
    return on;
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
    if (this.stream) {
      this.stream.getTracks().forEach((tr) => tr.stop());
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
  }
}

/**
 * Detect a barcode inside a still image (used by the desktop simulator to
 * "scan" a printed barcode).
 */
export async function detectInImage(imageBitmapOrElement) {
  const formats = Scanner.supported ? await window.BarcodeDetector.getSupportedFormats() : [];
  const wanted = WANTED_FORMATS.filter((f) => formats.includes(f));
  if (wanted.length) {
    const detector = new window.BarcodeDetector({ formats: wanted });
    const codes = await detector.detect(imageBitmapOrElement);
    if (codes && codes.length) return codes[0].rawValue;
  }
  try {
    const jsQR = await loadJsQr();
    const canvas = document.createElement('canvas');
    const w = imageBitmapOrElement.width;
    const h = imageBitmapOrElement.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imageBitmapOrElement, 0, 0);
    const img = ctx.getImageData(0, 0, w, h);
    const code = jsQR(img.data, w, h);
    return code ? code.data : '';
  } catch (_) {
    return '';
  }
}
