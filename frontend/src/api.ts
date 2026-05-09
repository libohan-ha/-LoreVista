const BASE = '';
const API_TOKEN = import.meta.env.VITE_API_TOKEN as string | undefined;
export const DEEPSEEK_USAGE_URL = 'https://platform.deepseek.com/usage';
export const IMAGE2_CONSOLE_URL = 'https://api.duojie.games/console/token';

export interface ApiKeySettings {
  deepseekApiKey: string;
  imageApiKey: string;
}

// Stored in localStorage so multiple tabs share the same API key settings.
const LS_DEEPSEEK_API_KEY = 'lorevista.deepseekApiKey';
const LS_IMAGE_API_KEY = 'lorevista.imageApiKey';
export const API_KEY_CHANGE_EVENT = 'lorevista:api-key-change';

export function getApiKeySettings(): ApiKeySettings {
  return {
    deepseekApiKey: localStorage.getItem(LS_DEEPSEEK_API_KEY) || '',
    imageApiKey: localStorage.getItem(LS_IMAGE_API_KEY) || '',
  };
}

export function saveApiKeySettings(settings: ApiKeySettings): void {
  const deepseek = settings.deepseekApiKey.trim();
  const image = settings.imageApiKey.trim();
  if (deepseek) localStorage.setItem(LS_DEEPSEEK_API_KEY, deepseek);
  else localStorage.removeItem(LS_DEEPSEEK_API_KEY);
  if (image) localStorage.setItem(LS_IMAGE_API_KEY, image);
  else localStorage.removeItem(LS_IMAGE_API_KEY);
  // Notify same-tab listeners. Other tabs receive the browser 'storage' event.
  try {
    window.dispatchEvent(new Event(API_KEY_CHANGE_EVENT));
  } catch {
    // SSR / non-browser environment — ignore.
  }
}

export function clearApiKeySettings(): void {
  saveApiKeySettings({ deepseekApiKey: '', imageApiKey: '' });
}

function apiHeaders(json = false): HeadersInit {
  const keys = getApiKeySettings();
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(API_TOKEN ? { 'X-API-Token': API_TOKEN } : {}),
    ...(keys.deepseekApiKey ? { 'X-DeepSeek-API-Key': keys.deepseekApiKey } : {}),
    ...(keys.imageApiKey ? { 'X-Image-API-Key': keys.imageApiKey } : {}),
  };
}

export interface Story {
  id: number;
  title: string;
  description?: string;
  cover_image?: string | null;
  has_character_profiles?: boolean;
  has_ref_image?: boolean;
  created_at: string;
}

export interface ChatMessage {
  id: number;
  chapter_id: number;
  role: string;
  content: string;
  created_at: string;
}

export interface MangaImage {
  id: number;
  chapter_id: number;
  image_number: number;
  image_path: string;
  prompt: string | null;
  created_at: string;
}

export interface Chapter {
  id: number;
  story_id: number;
  chapter_number: number;
  novel_content: string | null;
  content_source?: 'chat' | 'import' | null;
  created_at: string;
  messages: ChatMessage[];
  images: MangaImage[];
}

// ─── Story ──────────────────────────────────────────────────

export async function createStory(title: string = '未命名故事', description: string = ''): Promise<Story> {
  const res = await fetch(`${BASE}/api/stories`, {
    method: 'POST',
    headers: apiHeaders(true),
    body: JSON.stringify({ title, description }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listStories(): Promise<Story[]> {
  const res = await fetch(`${BASE}/api/stories`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function updateStory(storyId: number, data: { title?: string; description?: string }): Promise<Story> {
  const res = await fetch(`${BASE}/api/stories/${storyId}`, {
    method: 'PUT',
    headers: apiHeaders(true),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteStory(storyId: number): Promise<void> {
  const res = await fetch(`${BASE}/api/stories/${storyId}`, { method: 'DELETE', headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
}

export async function exportStory(story: Story): Promise<void> {
  const res = await fetch(`${BASE}/api/stories/${story.id}/export`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const safeTitle = (story.title || `story-${story.id}`).replace(/[\\/:*?"<>|]+/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safeTitle}_lorevista.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function importStoryPackage(file: File): Promise<Story> {
  const res = await fetch(`${BASE}/api/stories/import`, {
    method: 'POST',
    headers: {
      ...apiHeaders(),
      'Content-Type': 'application/zip',
    },
    body: file,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function uploadStoryCover(storyId: number, base64: string): Promise<string> {
  const res = await fetch(`${BASE}/api/stories/${storyId}/upload-cover`, {
    method: 'POST',
    headers: apiHeaders(true),
    body: JSON.stringify({ image: base64 }),
  });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.cover_image;
}

export function coverImageUrl(coverPath: string | null | undefined): string | null {
  if (!coverPath) return null;
  return `${BASE}/static/manga/${coverPath.replace('manga_outputs/', '')}`;
}

// ─── Chapter ────────────────────────────────────────────────

export async function getChapter(chapterId: number): Promise<Chapter> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function listChapters(storyId: number): Promise<Chapter[]> {
  const res = await fetch(`${BASE}/api/stories/${storyId}/chapters`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function createNextChapter(storyId: number): Promise<Chapter> {
  const res = await fetch(`${BASE}/api/stories/${storyId}/chapters`, { method: 'POST', headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteChapter(chapterId: number): Promise<void> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}`, { method: 'DELETE', headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
}

// ─── Chat (SSE) ─────────────────────────────────────────────

export function chatStream(
  chapterId: number,
  content: string,
  onToken: (token: string) => void,
  _onDone: (fullContent: string) => void,
  onError: (err: string) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE}/api/chapters/${chapterId}/chat`, {
    method: 'POST',
    headers: apiHeaders(true),
    body: JSON.stringify({ content }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        onError(await res.text());
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';
      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) return;
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          try {
            const data = JSON.parse(dataStr);
            if (currentEvent === 'token' && data.content !== undefined) {
              onToken(data.content);
            } else if (currentEvent === 'done' && data.content !== undefined) {
              _onDone(data.content);
            } else if (currentEvent === 'error' || data.error) {
              onError(data.error);
            }
          } catch {
            // ignore
          }
          currentEvent = 'message';
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          handleLine(line);
        }
      }
      if (buffer.trim()) handleLine(buffer);

      // If stream ended without a done event, call onDone with empty
      // This handles edge cases where connection closes unexpectedly
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err.message);
      }
    });

  return controller;
}

// ─── Generate Novel ─────────────────────────────────────────

export async function generateNovel(chapterId: number): Promise<Chapter> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/generate-novel`, {
    method: 'POST',
    headers: apiHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function importNovel(chapterId: number, content: string): Promise<Chapter> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/import-novel`, {
    method: 'POST',
    headers: { ...apiHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Scenes ─────────────────────────────────────────────────

export async function generateScenes(chapterId: number, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/generate-scenes`, { method: 'POST', headers: apiHeaders(), signal });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.scenes;
}

export async function getScenes(chapterId: number): Promise<string[]> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/scenes`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.scenes;
}

export async function updateScenes(chapterId: number, scenes: string[]): Promise<void> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/scenes`, {
    method: 'PUT',
    headers: apiHeaders(true),
    body: JSON.stringify({ scenes }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ─── Character Profiles ─────────────────────────────────────

// Story-level (global)
export async function getStoryCharacters(storyId: number): Promise<string> {
  const res = await fetch(`${BASE}/api/stories/${storyId}/characters`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.characters;
}

export async function saveStoryCharacters(storyId: number, characters: string): Promise<void> {
  const res = await fetch(`${BASE}/api/stories/${storyId}/characters`, {
    method: 'PUT',
    headers: apiHeaders(true),
    body: JSON.stringify({ characters }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// Chapter-level (with source info)
export async function getCharacters(chapterId: number): Promise<{ characters: string; source: 'chapter' | 'story' | 'none' }> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/characters`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

export async function saveCharacters(chapterId: number, characters: string): Promise<void> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/characters`, {
    method: 'PUT',
    headers: apiHeaders(true),
    body: JSON.stringify({ characters }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function resetChapterCharacters(chapterId: number): Promise<void> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/characters`, {
    method: 'DELETE',
    headers: apiHeaders(),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ─── Reference Images (垫图，支持多图) ────────────────────────

export type RefSource = 'chapter' | 'story' | 'none';

export interface RefImage {
  filename: string;
  image_path: string;
  size_kb: number;
}

export interface RefImagesPayload {
  images: RefImage[];
  max: number;
  source?: RefSource;
}

export function refImageUrl(imagePath: string): string {
  return `${BASE}/static/manga/${imagePath.replace('manga_outputs/', '')}`;
}

// Story-level
export async function getStoryRefImages(storyId: number): Promise<RefImagesPayload> {
  const res = await fetch(`${BASE}/api/stories/${storyId}/ref-images`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addStoryRefImage(storyId: number, base64: string): Promise<RefImagesPayload> {
  const res = await fetch(`${BASE}/api/stories/${storyId}/ref-images`, {
    method: 'POST',
    headers: apiHeaders(true),
    body: JSON.stringify({ image: base64 }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteStoryRefImage(storyId: number, filename: string): Promise<RefImagesPayload> {
  const res = await fetch(
    `${BASE}/api/stories/${storyId}/ref-images/${encodeURIComponent(filename)}`,
    { method: 'DELETE', headers: apiHeaders() },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// Chapter-level (with story fallback)
export async function getChapterRefImages(chapterId: number): Promise<RefImagesPayload> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/ref-images`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function addChapterRefImage(chapterId: number, base64: string): Promise<RefImagesPayload> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/ref-images`, {
    method: 'POST',
    headers: apiHeaders(true),
    body: JSON.stringify({ image: base64 }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export async function deleteChapterRefImage(chapterId: number, filename: string): Promise<RefImagesPayload> {
  const res = await fetch(
    `${BASE}/api/chapters/${chapterId}/ref-images/${encodeURIComponent(filename)}`,
    { method: 'DELETE', headers: apiHeaders() },
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Color Mode ─────────────────────────────────────────────

export type ColorMode = 'bw' | 'color';

export async function getColorMode(chapterId: number): Promise<ColorMode> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/color-mode`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.color_mode || 'bw';
}

export async function setColorMode(chapterId: number, mode: ColorMode): Promise<void> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/color-mode`, {
    method: 'PUT',
    headers: apiHeaders(true),
    body: JSON.stringify({ color_mode: mode }),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ─── Image Count ─────────────────────────────────────────────

export const ALLOWED_IMAGE_COUNTS = [4, 6, 8, 10, 12, 15, 20] as const;

export async function getImageCount(chapterId: number): Promise<number> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/image-count`, { headers: apiHeaders() });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  return data.image_count || 10;
}

export async function setImageCount(chapterId: number, count: number): Promise<void> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/image-count`, {
    method: 'PUT',
    headers: apiHeaders(true),
    body: JSON.stringify({ image_count: count }),
  });
  if (!res.ok) throw new Error(await res.text());
}

export async function regenerateImage(
  chapterId: number,
  imageNumber: number,
  prompt: string,
): Promise<{ id: number; image_number: number; image_path: string; prompt: string }> {
  const res = await fetch(`${BASE}/api/chapters/${chapterId}/regenerate-image/${imageNumber}`, {
    method: 'POST',
    headers: apiHeaders(true),
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ─── Generate Manga (SSE with progress) ─────────────────────

export interface MangaProgress {
  type: 'status' | 'scenes' | 'progress' | 'image' | 'done' | 'error';
  data: any;
}

export function generateMangaStream(
  chapterId: number,
  onEvent: (event: MangaProgress) => void,
): AbortController {
  const controller = new AbortController();

  fetch(`${BASE}/api/chapters/${chapterId}/generate-manga-stream`, {
    method: 'POST',
    headers: apiHeaders(),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        onEvent({ type: 'error', data: { error: await res.text() } });
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'message';
      const handleLine = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(':')) return;
        if (trimmed.startsWith('event:')) {
          currentEvent = trimmed.slice(6).trim();
        } else if (trimmed.startsWith('data:')) {
          const dataStr = trimmed.slice(5).trim();
          try {
            const data = JSON.parse(dataStr);
            const eventType = currentEvent as MangaProgress['type'];
            onEvent({ type: eventType, data });
          } catch {
            // ignore unparseable data
          }
          currentEvent = 'message';
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          handleLine(line);
        }
      }
      if (buffer.trim()) handleLine(buffer);
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onEvent({ type: 'error', data: { error: err.message } });
      }
    });

  return controller;
}

export function mangaImageUrl(imagePath: string, cacheBust?: number): string {
  // imagePath is like "manga_outputs/chapter_1/panel_01_abc12345.png"
  // Served at /static/manga/chapter_1/panel_01_abc12345.png
  const url = `${BASE}/static/manga/${imagePath.replace('manga_outputs/', '')}`;
  return cacheBust ? `${url}?t=${cacheBust}` : url;
}
