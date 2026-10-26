import { Injectable, signal } from '@angular/core';

// Teams-like virtual camera background, processed entirely on this device.
// The segmentation model runs locally (MediaPipe Selfie Segmentation); no
// frame is sent anywhere by this service. Coaching stills are a separate,
// explicit Mode 2 feature in the room component.

export type BackgroundMode = 'none' | 'blur' | 'color' | 'image';

export const BACKGROUND_MODES: BackgroundMode[] = ['none', 'blur', 'color', 'image'];

export interface BackgroundColor {
  id: string;
  label: string;
  hex: string;
}

export const BACKGROUND_COLORS: BackgroundColor[] = [
  { id: 'indigo', label: 'Indigo', hex: '#312e81' },
  { id: 'teal', label: 'Teal', hex: '#134e4a' },
  { id: 'charcoal', label: 'Charcoal', hex: '#1f2937' },
];

export const BACKGROUND_MODE_KEY = 'interviewmate.bg.mode';

export function isBackgroundMode(value: unknown): value is BackgroundMode {
  return typeof value === 'string' && (BACKGROUND_MODES as string[]).includes(value);
}

interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadBackgroundMode(storage?: SimpleStorage | null): BackgroundMode {
  try {
    const raw = storage?.getItem(BACKGROUND_MODE_KEY) ?? null;
    return isBackgroundMode(raw) ? raw : 'none';
  } catch {
    return 'none';
  }
}

export function saveBackgroundMode(mode: BackgroundMode, storage?: SimpleStorage | null): void {
  try {
    storage?.setItem(BACKGROUND_MODE_KEY, mode);
  } catch {
    // Persistence is a convenience only; a failed save must not break video.
  }
}

function safeStorage(): SimpleStorage | null {
  try { return window.localStorage; } catch { return null; }
}

function initialMode(): BackgroundMode {
  const mode = loadBackgroundMode(safeStorage());
  return mode === 'image' ? 'none' : mode; // the image itself is never persisted
}

export interface BackgroundOptions {
  color?: string;
  image?: HTMLImageElement | null;
}

type Segmenter = {
  onResults(cb: (results: { image: CanvasImageSource; segmentationMask: CanvasImageSource }) => void): void;
  setOptions(opts: { modelSelection?: number }): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): Promise<void>;
};

type SegmenterCtor = new (config: { locateFile: (file: string) => string }) => unknown;
let scriptLoad: Promise<SegmenterCtor> | null = null;

function loadSelfieSegmentation(): Promise<SegmenterCtor> {
  const existing = (window as unknown as { SelfieSegmentation?: SegmenterCtor }).SelfieSegmentation;
  if (existing) return Promise.resolve(existing);
  scriptLoad ??= new Promise<SegmenterCtor>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'mediapipe/selfie_segmentation.js';
    script.onload = () => {
      const ctor = (window as unknown as { SelfieSegmentation?: SegmenterCtor }).SelfieSegmentation;
      if (ctor) resolve(ctor);
      else reject(new Error('segmentation model did not load'));
    };
    script.onerror = () => { scriptLoad = null; reject(new Error('segmentation script not found')); };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

const MAX_WIDTH = 640;
const FRAME_INTERVAL_MS = 50; // ~20 fps — segmentation is the expensive part.

@Injectable({ providedIn: 'root' })
export class VirtualBackgroundService {
  private segmenter: Segmenter | null = null;
  private segmenterReady: Promise<void> | null = null;
  private rafId: number | null = null;
  private lastSentAt = 0;
  private sending = false;
  private running = false;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private personCanvas: HTMLCanvasElement | null = null;
  private mode: BackgroundMode = 'none';
  private color = BACKGROUND_COLORS[0].hex;
  private image: HTMLImageElement | null = null;
  private stopped = false;

  // Shared selection: chosen on the setup camera test, reused in the interview room.
  readonly selectedMode = signal<BackgroundMode>(initialMode());
  readonly selectedColorId = signal<string>(BACKGROUND_COLORS[0].id);
  readonly selectedImage = signal<HTMLImageElement | null>(null);
  readonly active = signal(false);
  readonly notice = signal('');
  private host: { video: HTMLVideoElement; canvas: HTMLCanvasElement } | null = null;

  /** Render the current selection from `video` into `canvas` until detach(). */
  async attach(video: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<void> {
    this.host = { video, canvas };
    await this.refresh();
  }

  async detach(): Promise<void> {
    this.host = null;
    this.active.set(false);
    await this.stop();
  }

  async select(mode: BackgroundMode, colorId?: string): Promise<void> {
    if (colorId) this.selectedColorId.set(colorId);
    this.selectedMode.set(mode);
    saveBackgroundMode(mode === 'image' ? 'none' : mode, safeStorage()); // images are never persisted
    await this.refresh();
  }

  /** Load a user image into memory only (never saved or sent anywhere). */
  selectImageFile(file: File): Promise<void> {
    return new Promise((resolve) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        // Keep the blob URL alive for the picker thumbnail; free the previous one.
        const previous = this.selectedImage();
        if (previous) URL.revokeObjectURL(previous.src);
        this.selectedImage.set(image);
        void this.select('image').then(resolve);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        this.notice.set('That image could not be loaded. Try a JPG or PNG file.');
        resolve();
      };
      image.src = url;
    });
  }

  private async refresh(): Promise<void> {
    const host = this.host;
    if (!host) return;
    const mode = this.selectedMode();
    if (mode === 'none' || (mode === 'image' && !this.selectedImage())) {
      this.active.set(false);
      await this.stop();
      return;
    }
    try {
      const color = BACKGROUND_COLORS.find((c) => c.id === this.selectedColorId())?.hex;
      await this.start(host.video, host.canvas, mode, { color, image: this.selectedImage() });
      this.active.set(this.running);
      this.notice.set('');
    } catch (err) {
      // Non-blocking: fall back to the original camera, never block the interview.
      await this.stop();
      this.active.set(false);
      this.selectedMode.set('none');
      this.notice.set(`Background effect unavailable (${err instanceof Error ? err.message : String(err)}) — showing your original camera.`);
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  getMode(): BackgroundMode {
    return this.mode;
  }

  /** Start (or reconfigure) processing. Throws on model-load failure. */
  async start(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    mode: BackgroundMode,
    options: BackgroundOptions = {},
  ): Promise<void> {
    this.video = video;
    this.canvas = canvas;
    this.mode = mode;
    if (options.color) this.color = options.color;
    if (options.image !== undefined) this.image = options.image;
    this.stopped = false;

    if (mode === 'none') {
      await this.stop();
      return;
    }

    await this.ensureSegmenter();
    if (this.stopped) return;
    if (!this.running) {
      this.running = true;
      this.loop(); // one loop only; option changes just update fields above
    }
  }

  async updateOptions(mode: BackgroundMode, options: BackgroundOptions = {}): Promise<void> {
    if (!this.video || !this.canvas) return;
    await this.start(this.video, this.canvas, mode, options);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    // The segmenter is deliberately kept: MediaPipe's wasm module cannot be
    // re-created after close() in the same page (the new instance never loads),
    // which broke "preview on setup -> use in interview". Idle, it costs nothing.
  }

  private async ensureSegmenter(): Promise<void> {
    if (this.segmenter) return;
    if (!this.segmenterReady) {
      this.segmenterReady = (async () => {
        // The MediaPipe build is a classic script that registers a global
        // (bundling it as an ES module leaves SelfieSegmentation undefined).
        // It and its wasm/model files are copied into dist/ui/browser/mediapipe/
        // by angular.json assets, so everything loads locally, never from a CDN.
        const Ctor = await loadSelfieSegmentation();
        const segmenter = new Ctor({
          locateFile: (file: string) => `mediapipe/${file}`,
        }) as unknown as Segmenter;
        segmenter.setOptions({ modelSelection: 1 });
        segmenter.onResults((results) => this.draw(results));
        this.segmenter = segmenter;
        await segmenter.send({ image: this.video! });
      })();
    }
    await this.segmenterReady;
  }

  private loop = (): void => {
    if (!this.running || this.stopped) return;
    const now = performance.now();
    const video = this.video;
    const segmenter = this.segmenter;
    if (video && segmenter && video.readyState >= 2 && !this.sending && now - this.lastSentAt >= FRAME_INTERVAL_MS) {
      this.sending = true;
      this.lastSentAt = now;
      segmenter.send({ image: video }).catch(() => undefined).finally(() => {
        this.sending = false;
      });
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private draw(results: { image: CanvasImageSource; segmentationMask: CanvasImageSource }): void {
    const canvas = this.canvas;
    const video = this.video;
    if (!canvas || !video || !video.videoWidth) return;
    const width = Math.min(MAX_WIDTH, video.videoWidth);
    const height = Math.round((video.videoHeight / video.videoWidth) * width);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Person-only layer: mask, then keep the camera image where the mask is.
    if (!this.personCanvas) this.personCanvas = document.createElement('canvas');
    if (this.personCanvas.width !== width) this.personCanvas.width = width;
    if (this.personCanvas.height !== height) this.personCanvas.height = height;
    const pctx = this.personCanvas.getContext('2d');
    if (!pctx) return;
    pctx.save();
    pctx.clearRect(0, 0, width, height);
    pctx.drawImage(results.segmentationMask, 0, 0, width, height);
    pctx.globalCompositeOperation = 'source-in';
    pctx.drawImage(results.image, 0, 0, width, height);
    pctx.restore();

    // Background, then the person on top.
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    if (this.mode === 'blur') {
      ctx.filter = 'blur(14px)';
      this.drawCover(ctx, results.image, width, height);
      ctx.filter = 'none';
    } else if (this.mode === 'color') {
      ctx.fillStyle = this.color;
      ctx.fillRect(0, 0, width, height);
    } else if (this.mode === 'image' && this.image) {
      this.drawCover(ctx, this.image, width, height);
    } else {
      this.drawCover(ctx, results.image, width, height);
    }
    ctx.drawImage(this.personCanvas, 0, 0, width, height);
    ctx.restore();
  }

  private drawCover(
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    width: number,
    height: number,
  ): void {
    const sw = (source as { width?: number }).width ?? width;
    const sh = (source as { height?: number }).height ?? height;
    if (!sw || !sh) {
      ctx.drawImage(source, 0, 0, width, height);
      return;
    }
    const scale = Math.max(width / sw, height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }
}
