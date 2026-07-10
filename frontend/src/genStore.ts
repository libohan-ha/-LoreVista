// Module-level store for ongoing manga generation state.
// Keyed by chapterId so state survives chapter switching in the UI.

export interface GenImage {
  image_number: number;
  image_path: string;
  prompt: string;
}

export interface GenState {
  active: boolean;        // true while SSE is streaming
  current: number;
  total: number;
  statusMsg: string;
  images: GenImage[];
  skippedNumbers: number[];
  skipPendingNumber: number | null;
  errorMsg: string;
  lastEventAt: number;    // epoch ms of most recent SSE event for stall detection
}

const states = new Map<number, GenState>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export const genStore = {
  get(chapterId: number): GenState | undefined {
    return states.get(chapterId);
  },
  start(chapterId: number, total = 10) {
    states.set(chapterId, {
      active: true,
      current: 0,
      total,
      statusMsg: '正在生成漫画…',
      images: [],
      skippedNumbers: [],
      skipPendingNumber: null,
      errorMsg: '',
      lastEventAt: Date.now(),
    });
    emit();
  },
  patch(chapterId: number, p: Partial<GenState>) {
    const cur = states.get(chapterId);
    if (!cur) return;
    states.set(chapterId, { ...cur, ...p, lastEventAt: Date.now() });
    emit();
  },
  pushImage(chapterId: number, img: GenImage) {
    const cur = states.get(chapterId);
    if (!cur) return;
    const images = cur.images
      .filter((existing) => existing.image_number !== img.image_number)
      .concat(img)
      .sort((a, b) => a.image_number - b.image_number);
    states.set(chapterId, { ...cur, images, lastEventAt: Date.now() });
    emit();
  },
  markSkipped(chapterId: number, imageNumber: number) {
    const cur = states.get(chapterId);
    if (!cur) return;
    const skippedNumbers = cur.skippedNumbers.includes(imageNumber)
      ? cur.skippedNumbers
      : [...cur.skippedNumbers, imageNumber].sort((a, b) => a - b);
    states.set(chapterId, {
      ...cur,
      skippedNumbers,
      skipPendingNumber: cur.skipPendingNumber === imageNumber ? null : cur.skipPendingNumber,
      statusMsg: `Skipped image ${imageNumber}; continuing...`,
      lastEventAt: Date.now(),
    });
    emit();
  },
  finish(chapterId: number, errorMsg?: string) {
    const cur = states.get(chapterId);
    if (!cur) return;
    states.set(chapterId, { ...cur, active: false, errorMsg: errorMsg ?? cur.errorMsg });
    emit();
  },
  clear(chapterId: number) {
    if (states.delete(chapterId)) emit();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
