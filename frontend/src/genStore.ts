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
  errorMsg: string;
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
      errorMsg: '',
    });
    emit();
  },
  patch(chapterId: number, p: Partial<GenState>) {
    const cur = states.get(chapterId);
    if (!cur) return;
    states.set(chapterId, { ...cur, ...p });
    emit();
  },
  pushImage(chapterId: number, img: GenImage) {
    const cur = states.get(chapterId);
    if (!cur) return;
    states.set(chapterId, { ...cur, images: [...cur.images, img] });
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
