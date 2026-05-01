import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Download, ImageIcon, Loader2, Sparkles, Pencil, RefreshCw, Check, X, ImagePlus, Trash2, Square } from 'lucide-react';
import {
  generateMangaStream,
  generateScenes,
  getScenes,
  updateScenes,
  regenerateImage,
  getCharacters,
  saveCharacters,
  resetChapterCharacters,
  getRefImage,
  uploadRefImage,
  deleteRefImage,
  getColorMode,
  setColorMode,
  getImageCount,
  setImageCount,
  ALLOWED_IMAGE_COUNTS,
  mangaImageUrl,
  type Chapter,
  type MangaProgress,
  type ColorMode,
  type RefSource,
} from '../api';
import { genStore } from '../genStore';

interface Props {
  chapter: Chapter | null;
  onChapterRefresh?: (chapterId: number) => void;
}

interface ImageItem {
  image_number: number;
  image_path: string;
  prompt: string;
}

type Phase = 'idle' | 'generating-scenes' | 'editing-scenes' | 'generating-images';
const DEFAULT_IMAGE_COUNT = 10;

export default function MangaPanel({ chapter, onChapterRefresh }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ current: 0, total: DEFAULT_IMAGE_COUNT });
  const [statusMsg, setStatusMsg] = useState('');
  const [images, setImages] = useState<ImageItem[]>([]);
  const [lightboxIdx, setLightboxIdx] = useState<number>(-1);
  const [errorMsg, setErrorMsg] = useState('');
  const [scenes, setScenes] = useState<string[]>([]);
  const [editingIdx, setEditingIdx] = useState<number>(-1);
  const [editText, setEditText] = useState('');
  const [savingScenes, setSavingScenes] = useState(false);
  const [regenIdx, setRegenIdx] = useState<number>(-1);
  const [charText, setCharText] = useState('');
  const [charSource, setCharSource] = useState<'chapter' | 'story' | 'none'>('none');
  const [charEditing, setCharEditing] = useState(false);
  const [charDraft, setCharDraft] = useState('');
  const [charSaving, setCharSaving] = useState(false);
  const [charExpanded, setCharExpanded] = useState(false);
  const [hasRefImage, setHasRefImage] = useState(false);
  const [refSource, setRefSource] = useState<RefSource>('none');
  const [refUploading, setRefUploading] = useState(false);
  const [colorMode, setColorModeState] = useState<ColorMode>('bw');
  const [imageCount, setImageCountState] = useState(DEFAULT_IMAGE_COUNT);
  const [showColorMenu, setShowColorMenu] = useState(false);
  const colorMenuRef = useRef<HTMLDivElement>(null);
  const refFileRef = useRef<HTMLInputElement>(null);
  const lightboxRef = useRef<HTMLDivElement>(null);
  const chapterLoadRequestRef = useRef(0);
  const sceneAbortRef = useRef<AbortController | null>(null);
  const mangaAbortRef = useRef<Map<number, AbortController>>(new Map());

  // Subscribe to module-level generation store so we re-render when any chapter's gen state changes
  const [, setStoreTick] = useState(0);
  useEffect(() => genStore.subscribe(() => setStoreTick((t) => t + 1)), []);
  const liveGen = chapter ? genStore.get(chapter.id) : undefined;
  const isLiveGenerating = !!(liveGen && liveGen.active);

  // Reset state when chapter changes
  useEffect(() => {
    // Abort any in-flight scene generation when switching chapters
    sceneAbortRef.current?.abort();
    sceneAbortRef.current = null;
    const requestId = ++chapterLoadRequestRef.current;
    setImages([]);
    // Don't downgrade phase if there's an ongoing generation for this new chapter;
    // the derived `generating` flag below will reflect it via genStore.
    setPhase('idle');
    setProgress({ current: 0, total: DEFAULT_IMAGE_COUNT });
    setStatusMsg('');
    setErrorMsg('');
    setLightboxIdx(-1);
    setScenes([]);
    setEditingIdx(-1);
    setRegenIdx(-1);
    setCharText('');
    setCharSource('none');
    setCharEditing(false);
    setCharExpanded(false);
    setHasRefImage(false);
    setRefSource('none');
    setColorModeState('bw');
    setImageCountState(DEFAULT_IMAGE_COUNT);
    setShowColorMenu(false);
    // Load existing scenes and characters if available
    if (chapter) {
      getRefImage(chapter.id).then((r) => {
        if (chapterLoadRequestRef.current !== requestId) return;
        setHasRefImage(r.has_ref);
        setRefSource(r.source);
      }).catch(() => {});
      getColorMode(chapter.id).then((m) => {
        if (chapterLoadRequestRef.current === requestId) setColorModeState(m);
      }).catch(() => {});
      getImageCount(chapter.id).then((c) => {
        if (chapterLoadRequestRef.current === requestId) setImageCountState(c);
      }).catch(() => {});
      getScenes(chapter.id).then((s) => {
        if (chapterLoadRequestRef.current !== requestId) return;
        if (s.length > 0) {
          setScenes(s);
          setPhase('editing-scenes');
        }
      }).catch(() => {});
      getCharacters(chapter.id).then((r) => {
        if (chapterLoadRequestRef.current !== requestId) return;
        setCharText(r.characters || '');
        setCharSource(r.source);
      }).catch(() => {});
    }
  }, [chapter?.id]);

  // Load existing images from chapter
  const existingImages: ImageItem[] =
    chapter?.images.map((img) => ({
      image_number: img.image_number,
      image_path: img.image_path,
      prompt: img.prompt || '',
    })) ?? [];

  // While generation is running for this chapter, prefer live images from the store
  const displayImages = isLiveGenerating
    ? liveGen!.images
    : images.length > 0
      ? images
      : existingImages;
  const lightboxImg = lightboxIdx >= 0 ? displayImages[lightboxIdx] : null;

  // ── Scene generation ──
  const handleGenerateScenes = async () => {
    if (!chapter) return;
    if (!chapter.messages || chapter.messages.length === 0) {
      alert('请先在左侧进行对话');
      return;
    }
    setPhase('generating-scenes');
    setErrorMsg('');
    const controller = new AbortController();
    sceneAbortRef.current = controller;
    const requestId = chapterLoadRequestRef.current;
    const hadScenes = scenes.length > 0;
    try {
      const result = await generateScenes(chapter.id, controller.signal);
      if (chapterLoadRequestRef.current !== requestId) return;
      setScenes(result);
      setPhase('editing-scenes');
    } catch (err: any) {
      if (chapterLoadRequestRef.current !== requestId) return;
      if (err.name === 'AbortError') {
        setPhase(hadScenes ? 'editing-scenes' : 'idle');
      } else {
        setErrorMsg(err.message);
        setPhase(hadScenes ? 'editing-scenes' : 'idle');
      }
    } finally {
      if (sceneAbortRef.current === controller) {
        sceneAbortRef.current = null;
      }
    }
  };

  const handleAbortScenes = () => {
    sceneAbortRef.current?.abort();
    sceneAbortRef.current = null;
  };

  // ── Scene editing ──
  const handleSceneEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditText(scenes[idx]);
  };

  const handleSceneSave = (idx: number) => {
    const updated = [...scenes];
    updated[idx] = editText;
    setScenes(updated);
    setEditingIdx(-1);
  };

  const handleSaveAllScenes = async () => {
    if (!chapter) return;
    setSavingScenes(true);
    try {
      await updateScenes(chapter.id, scenes);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSavingScenes(false);
    }
  };

  // ── Single image regeneration ──
  const handleRegenImage = async (imageNumber: number) => {
    if (!chapter) return;
    const prompt = scenes[imageNumber - 1];
    if (!prompt) return;
    setRegenIdx(imageNumber);
    setErrorMsg('');
    try {
      // Save scenes first
      await updateScenes(chapter.id, scenes);
      const result = await regenerateImage(chapter.id, imageNumber, prompt);
      // Update in images list
      const newItem: ImageItem = {
        image_number: result.image_number,
        image_path: result.image_path,
        prompt: result.prompt,
      };
      setImages((prev) => {
        const updated = prev.length > 0 ? [...prev] : [...existingImages];
        const idx = updated.findIndex((i) => i.image_number === imageNumber);
        if (idx >= 0) updated[idx] = newItem;
        else updated.push(newItem);
        return updated.sort((a, b) => a.image_number - b.image_number);
      });
    } catch (err: any) {
      setErrorMsg(`第${imageNumber}张重新生成失败: ${err.message}`);
    } finally {
      setRegenIdx(-1);
    }
  };

  // ── Close color menu on outside click ──
  useEffect(() => {
    if (!showColorMenu) return;
    const handler = (e: MouseEvent) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(e.target as Node)) {
        setShowColorMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showColorMenu]);

  // ── Color mode selection ──
  const handleSelectColorMode = async (mode: ColorMode) => {
    if (!chapter) return;
    setShowColorMenu(false);
    await setColorMode(chapter.id, mode);
    setColorModeState(mode);
  };

  // ── Image generation ──

  const handleGenerateImages = async () => {
    if (!chapter) return;
    // Already generating for this chapter — ignore
    if (genStore.get(chapter.id)?.active) return;
    // Save scenes first
    try {
      await updateScenes(chapter.id, scenes);
    } catch (err: any) {
      setErrorMsg(`保存分镜失败: ${err.message}`);
      return;
    }

    setImages([]);
    setErrorMsg('');

    const targetId = chapter.id;
    const targetTotal = imageCount;
    genStore.start(targetId, targetTotal);

    const controller = generateMangaStream(targetId, (event: MangaProgress) => {
      switch (event.type) {
        case 'status':
          genStore.patch(targetId, { statusMsg: event.data.message });
          break;
        case 'progress':
          genStore.patch(targetId, {
            current: event.data.current,
            total: event.data.total,
            statusMsg: `正在生成第 ${event.data.current}/${event.data.total} 张漫画…`,
          });
          break;
        case 'image':
          genStore.pushImage(targetId, {
            image_number: event.data.image_number,
            image_path: event.data.image_path,
            prompt: event.data.prompt,
          });
          if (event.data.image_number >= targetTotal) {
            mangaAbortRef.current.delete(targetId);
            genStore.finish(targetId);
            onChapterRefresh?.(targetId);
            setTimeout(() => genStore.clear(targetId), 800);
          }
          break;
        case 'done':
          mangaAbortRef.current.delete(targetId);
          genStore.finish(targetId);
          onChapterRefresh?.(targetId);
          setTimeout(() => genStore.clear(targetId), 800);
          break;
        case 'error':
          mangaAbortRef.current.delete(targetId);
          genStore.finish(targetId, event.data.error || '未知错误');
          break;
      }
    });
    mangaAbortRef.current.set(targetId, controller);
  };

  const handleAbortManga = () => {
    if (!chapter) return;
    const targetId = chapter.id;
    const state = genStore.get(targetId);
    mangaAbortRef.current.get(targetId)?.abort();
    mangaAbortRef.current.delete(targetId);
    if (state?.images.length) {
      setImages(state.images);
    }
    genStore.finish(targetId, '已中止生成');
    window.setTimeout(() => onChapterRefresh?.(targetId), 700);
  };

  // ── Lightbox keyboard/scroll navigation ──
  const handleLightboxNav = useCallback((dir: 'prev' | 'next') => {
    setLightboxIdx((cur) => {
      if (dir === 'prev' && cur > 0) return cur - 1;
      if (dir === 'next' && cur < displayImages.length - 1) return cur + 1;
      return cur;
    });
  }, [displayImages.length]);

  useEffect(() => {
    if (lightboxIdx < 0) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); handleLightboxNav('prev'); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); handleLightboxNav('next'); }
      if (e.key === 'Escape') setLightboxIdx(-1);
    };
    const wheelHandler = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) handleLightboxNav('prev');
      if (e.deltaY > 0) handleLightboxNav('next');
    };
    window.addEventListener('keydown', handler);
    const lb = lightboxRef.current;
    lb?.addEventListener('wheel', wheelHandler, { passive: false });
    return () => {
      window.removeEventListener('keydown', handler);
      lb?.removeEventListener('wheel', wheelHandler);
    };
  }, [lightboxIdx, handleLightboxNav]);

  const generating = isLiveGenerating || phase === 'generating-images';
  const liveProgress = isLiveGenerating
    ? { current: liveGen!.current, total: liveGen!.total }
    : progress;
  const liveStatusMsg = isLiveGenerating ? liveGen!.statusMsg : statusMsg;
  const liveErrorMsg = liveGen?.errorMsg || errorMsg;
  const hasImages = displayImages.length > 0;
  const canChangeImageCount = !generating && scenes.length === 0 && !hasImages;
  const activeImageCount = liveProgress.total || imageCount;

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="px-3 md:px-5 py-3 border-b border-gray-800 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-200 tracking-wide uppercase shrink-0 hidden md:block">
          第 {chapter?.chapter_number ?? '–'} 话 · 漫画
        </h2>
        <div className="flex items-center gap-1.5 md:gap-2 flex-wrap justify-end">
          {/* 垫图 (Reference Image) */}
          <div className="flex items-center gap-1">
            <input
              ref={refFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file || !chapter) return;
                setRefUploading(true);
                try {
                  const reader = new FileReader();
                  const b64 = await new Promise<string>((resolve) => {
                    reader.onload = () => resolve((reader.result as string).split(',')[1]);
                    reader.readAsDataURL(file);
                  });
                  await uploadRefImage(chapter.id, b64);
                  setHasRefImage(true);
                  setRefSource('chapter');
                } catch (err: any) {
                  setErrorMsg(`上传垫图失败: ${err.message}`);
                } finally {
                  setRefUploading(false);
                  e.target.value = '';
                }
              }}
            />
            <button
              onClick={() => refFileRef.current?.click()}
              disabled={!chapter || refUploading}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                ${hasRefImage
                  ? 'bg-emerald-900/50 hover:bg-emerald-800 text-emerald-300 border border-emerald-700'
                  : 'bg-gray-800 hover:bg-gray-700 text-gray-300'
                } disabled:opacity-40`}
              title={
                hasRefImage
                  ? refSource === 'story' ? '垫图（继承自全局）· 点击上传本章覆盖' : '已设置垫图（点击更换）'
                  : '上传垫图参考'
              }
            >
              {refUploading ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
              {hasRefImage
                ? refSource === 'story' ? '全局垫图' : '已垫图'
                : '垫图'}
            </button>
            {hasRefImage && refSource === 'chapter' && (
              <button
                onClick={async () => {
                  if (!chapter) return;
                  await deleteRefImage(chapter.id);
                  // Re-fetch to check if story-level fallback exists
                  try {
                    const r = await getRefImage(chapter.id);
                    setHasRefImage(r.has_ref);
                    setRefSource(r.source);
                  } catch {
                    setHasRefImage(false);
                    setRefSource('none');
                  }
                }}
                className="p-1.5 text-gray-600 hover:text-red-400 rounded transition-colors"
                title="移除本章垫图（恢复使用全局垫图）"
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
          {/* Image count selector */}
          {!generating && (phase === 'idle' || phase === 'editing-scenes') && (
            <select
              value={imageCount}
              onChange={async (e) => {
                const count = Number(e.target.value);
                const previous = imageCount;
                setImageCountState(count);
                if (chapter) {
                  try {
                    await setImageCount(chapter.id, count);
                  } catch (err: any) {
                    setImageCountState(previous);
                    setErrorMsg(`保存生成张数失败: ${err.message}`);
                  }
                }
              }}
              disabled={!canChangeImageCount}
              className="px-2 py-1.5 text-xs font-medium rounded-md bg-gray-800 text-gray-300 border border-gray-700 outline-none focus:border-violet-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              title={canChangeImageCount ? '生成张数' : '已有分镜或图片时不能修改生成张数'}
            >
              {ALLOWED_IMAGE_COUNTS.map((n) => (
                <option key={n} value={n}>{n}张</option>
              ))}
            </select>
          )}
          {hasImages && (
            <button
              onClick={() => {
                displayImages.forEach((img) => {
                  const a = document.createElement('a');
                  a.href = mangaImageUrl(img.image_path);
                  a.download = `panel_${img.image_number.toString().padStart(2, '0')}.png`;
                  a.click();
                });
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md
                         bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
            >
              <Download size={13} />
              下载
            </button>
          )}
          {!generating && (phase === 'idle' || phase === 'editing-scenes') && (
            <button
              onClick={handleGenerateScenes}
              disabled={!chapter || !chapter?.messages?.length}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md
                         bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40
                         disabled:cursor-not-allowed transition-colors"
            >
              <RefreshCw size={13} />
              {scenes.length > 0 ? '重新生成分镜' : '生成分镜'}
            </button>
          )}
          {!generating && phase === 'editing-scenes' && scenes.length > 0 && (
            <>
              {/* Color mode selector */}
              <div className="relative" ref={colorMenuRef}>
                <button
                  onClick={() => setShowColorMenu((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors
                    ${colorMode === 'color'
                      ? 'bg-pink-900/50 hover:bg-pink-800 text-pink-300 border border-pink-700'
                      : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                >
                  {colorMode === 'color' ? (
                    <span className="w-3 h-3 rounded-full bg-gradient-to-br from-pink-400 via-blue-400 to-green-400 shrink-0" />
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-gradient-to-br from-white to-gray-600 shrink-0" />
                  )}
                  {colorMode === 'color' ? '彩色' : '黑白'}
                  <ChevronDown size={11} className={`transition-transform ${showColorMenu ? 'rotate-180' : ''}`} />
                </button>
                {showColorMenu && (
                  <div className="absolute right-0 top-full mt-1 w-40 rounded-lg border border-gray-700 bg-gray-900 shadow-xl z-50 overflow-hidden">
                    <button
                      onClick={() => handleSelectColorMode('bw')}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-gray-800
                        ${colorMode === 'bw' ? 'text-amber-400 font-semibold' : 'text-gray-300'}`}
                    >
                      <span className="w-4 h-4 rounded border-2 border-gray-500 bg-gradient-to-br from-white to-gray-900 shrink-0" />
                      黑白漫画
                      {colorMode === 'bw' && <Check size={12} className="ml-auto text-amber-400" />}
                    </button>
                    <button
                      onClick={() => handleSelectColorMode('color')}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-gray-800
                        ${colorMode === 'color' ? 'text-amber-400 font-semibold' : 'text-gray-300'}`}
                    >
                      <span className="w-4 h-4 rounded border-2 border-gray-500 bg-gradient-to-br from-pink-400 via-blue-400 to-green-400 shrink-0" />
                      彩色漫画
                      {colorMode === 'color' && <Check size={12} className="ml-auto text-amber-400" />}
                    </button>
                  </div>
                )}
              </div>
              {/* Generate button */}
              <button
                onClick={handleGenerateImages}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md
                           bg-amber-500 hover:bg-amber-400 text-gray-950 transition-colors"
              >
                <Sparkles size={13} />
                {existingImages.length > 0 && existingImages.length < imageCount ? '继续生成漫画' : '生成漫画'}
              </button>
            </>
          )}
          {phase === 'generating-scenes' && (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-gray-400">
                <Loader2 size={13} className="animate-spin" />
                AI 生成分镜中…
              </span>
              <button
                onClick={handleAbortScenes}
                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-md
                           bg-red-900/50 hover:bg-red-800 text-red-300 border border-red-700 transition-colors"
                title="停止生成分镜"
              >
                <Square size={11} />
                停止
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {generating && (
        <div className="px-5 py-4 border-b border-gray-800 bg-gray-900/50">
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="text-gray-300 font-medium">{liveStatusMsg}</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAbortManga}
                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded-md
                           bg-red-900/50 hover:bg-red-800 text-red-300 border border-red-700 transition-colors"
                title="停止生成漫画"
              >
                <Square size={10} />
                停止
              </button>
              <span className="text-amber-400 font-mono font-bold">
                {Math.round((liveProgress.current / liveProgress.total) * 100)}%
              </span>
            </div>
          </div>
          <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
              style={{
                width: `${Math.max((liveProgress.current / liveProgress.total) * 100, 2)}%`,
                background: 'linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b)',
                boxShadow: '0 0 12px rgba(245, 158, 11, 0.5)',
              }}
            >
              <div
                className="absolute inset-0 animate-[barbershop_1s_linear_infinite]"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(115deg, transparent, transparent 8px, rgba(255,255,255,0.15) 8px, rgba(255,255,255,0.15) 16px)',
                }}
              />
            </div>
          </div>
          <div className="flex justify-between mt-2 text-[10px] text-gray-600">
            {Array.from({ length: liveProgress.total }, (_, i) => (
              <span key={i} className={i < liveProgress.current ? 'text-amber-500' : ''}>
                {i + 1}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error banner */}
      {liveErrorMsg && (
        <div className="mx-5 mt-3 px-4 py-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-start gap-2">
          <span className="shrink-0 mt-0.5">⚠</span>
          <div>
            <div className="font-medium mb-0.5">生成出错</div>
            <div className="text-xs text-red-400">{liveErrorMsg}</div>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4">
        {/* Character profiles card */}
        {(phase === 'idle' || phase === 'editing-scenes') && (
          <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/60 overflow-hidden">
            <button
              onClick={() => setCharExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:bg-gray-800/40 transition-colors"
            >
              <span className="flex items-center gap-1.5">
                🎭 角色外貌卡
                {charText && charSource === 'story' && (
                  <span className="text-[10px] font-normal normal-case px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 border border-blue-800/50">继承自首页</span>
                )}
                {charText && charSource === 'chapter' && (
                  <span className="text-[10px] font-normal normal-case px-1.5 py-0.5 rounded bg-emerald-900/50 text-emerald-400 border border-emerald-800/50">本话自定义</span>
                )}
                {!charText && '（未设定）'}
              </span>
              {charExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            {charExpanded && (
              <div className="px-3 pb-3">
                {charEditing ? (
                  <>
                    <textarea
                      value={charDraft}
                      onChange={(e) => setCharDraft(e.target.value)}
                      className="w-full bg-gray-800 text-xs text-gray-200 rounded p-2 resize-none outline-none border border-gray-700 focus:border-violet-500 leading-relaxed"
                      rows={12}
                      placeholder={`角色名：塞蕾娜\n性别：女\n发色与发型：银灰色长发...\n（粘贴完整角色卡）`}
                      autoFocus
                    />
                    <div className="flex justify-end gap-2 mt-2">
                      <button
                        onClick={() => setCharEditing(false)}
                        className="px-2 py-1 text-xs rounded text-gray-500 hover:text-gray-300 hover:bg-gray-700 transition-colors"
                      >取消</button>
                      <button
                        disabled={charSaving}
                        onClick={async () => {
                          if (!chapter) return;
                          setCharSaving(true);
                          try {
                            await saveCharacters(chapter.id, charDraft);
                            setCharText(charDraft);
                            setCharSource('chapter');
                            setCharEditing(false);
                          } catch (err: any) {
                            setErrorMsg(err.message);
                          } finally {
                            setCharSaving(false);
                          }
                        }}
                        className="px-3 py-1 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
                      >{charSaving ? '保存中…' : '保存（本话覆盖）'}</button>
                    </div>
                  </>
                ) : charText ? (
                  <>
                    <pre className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">{charText}</pre>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => { setCharDraft(charText); setCharEditing(true); }}
                        className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                      ><Pencil size={11} /> 编辑</button>
                      {charSource === 'chapter' && (
                        <button
                          onClick={async () => {
                            if (!chapter) return;
                            try {
                              await resetChapterCharacters(chapter.id);
                              const r = await getCharacters(chapter.id);
                              setCharText(r.characters || '');
                              setCharSource(r.source);
                            } catch (err: any) {
                              setErrorMsg(err.message);
                            }
                          }}
                          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                        ><RefreshCw size={11} /> 恢复全局设定</button>
                      )}
                    </div>
                  </>
                ) : (
                  <button
                    onClick={() => { setCharDraft(''); setCharEditing(true); }}
                    className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                  >+ 添加角色卡（粘贴 AI 生成的角色外貌描述）</button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Scene-only editor (when no images yet) */}
        {scenes.length > 0 && displayImages.length === 0 && !generating && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide">分镜脚本（可编辑）</h3>
              <button
                onClick={handleSaveAllScenes}
                disabled={savingScenes}
                className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
              >
                {savingScenes ? '保存中…' : '保存修改'}
              </button>
            </div>
            <div className="space-y-2">
              {scenes.map((scene, idx) => (
                <div key={idx} className="rounded-lg border border-gray-800 bg-gray-900/60 overflow-hidden">
                  <div className="flex items-start gap-2 p-3">
                    <span className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-gray-800 text-[10px] text-gray-400 font-mono mt-0.5">
                      {idx + 1}
                    </span>
                    {editingIdx === idx ? (
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        className="flex-1 bg-gray-800 text-sm text-gray-200 rounded p-2 resize-none outline-none border border-gray-700 focus:border-violet-500"
                        rows={4}
                        autoFocus
                      />
                    ) : (
                      <p className="flex-1 text-xs text-gray-400 leading-relaxed line-clamp-2 hover:line-clamp-none cursor-default">
                        {scene}
                      </p>
                    )}
                    <div className="shrink-0 flex gap-1">
                      {editingIdx === idx ? (
                        <>
                          <button onClick={() => handleSceneSave(idx)} className="p-1 rounded hover:bg-gray-700 text-green-400 transition-colors"><Check size={14} /></button>
                          <button onClick={() => setEditingIdx(-1)} className="p-1 rounded hover:bg-gray-700 text-gray-500 transition-colors"><X size={14} /></button>
                        </>
                      ) : (
                        <button onClick={() => handleSceneEdit(idx)} className="p-1 rounded hover:bg-gray-700 text-gray-600 hover:text-gray-300 transition-colors"><Pencil size={12} /></button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {displayImages.length === 0 && !generating && scenes.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3">
            <ImageIcon size={48} strokeWidth={1} />
            <span className="text-sm">对话后点击上方按钮生成分镜</span>
          </div>
        )}

        {/* Images gallery with inline scene editor */}
        <div className="space-y-6">
          {displayImages.map((img, idx) => {
            const sceneIdx = img.image_number - 1;
            const scene = scenes[sceneIdx] || '';
            const isEditing = editingIdx === sceneIdx;
            const isRegenerating = regenIdx === img.image_number;
            return (
              <div key={img.image_number} className="group">
                <div
                  className="relative rounded-xl overflow-hidden border border-gray-800 bg-gray-900 cursor-pointer
                             hover:border-gray-600 transition-colors"
                  onClick={() => setLightboxIdx(idx)}
                >
                  <img
                    src={mangaImageUrl(img.image_path, isRegenerating ? Date.now() : undefined)}
                    alt={`Panel ${img.image_number}`}
                    className={`w-full object-contain ${isRegenerating ? 'opacity-30' : ''}`}
                    loading="lazy"
                  />
                  <div className="absolute top-3 left-3 px-2 py-0.5 bg-black/70 rounded text-[10px] text-gray-300 font-mono">
                    {img.image_number}/{imageCount}
                  </div>
                  {isRegenerating && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="flex flex-col items-center gap-2">
                        <Loader2 size={32} className="animate-spin text-amber-400" />
                        <span className="text-sm text-gray-300">重新生成中…</span>
                      </div>
                    </div>
                  )}
                  {!isRegenerating && (
                    <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
                      <span className="bg-black/60 text-white text-xs px-3 py-1 rounded-full">点击放大</span>
                    </div>
                  )}
                </div>
                {/* Inline scene editor under image */}
                {scene && (
                  <div className="mt-2 rounded-lg border border-gray-800 bg-gray-900/40 p-2.5">
                    <div className="flex items-start gap-2">
                      {isEditing ? (
                        <textarea
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                          className="flex-1 bg-gray-800 text-xs text-gray-200 rounded p-2 resize-none outline-none border border-gray-700 focus:border-violet-500 leading-relaxed"
                          rows={3}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <p className="flex-1 text-xs text-gray-500 leading-relaxed line-clamp-2 group-hover:line-clamp-none">
                          {scene}
                        </p>
                      )}
                      <div className="shrink-0 flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <button onClick={() => handleSceneSave(sceneIdx)} className="p-1 rounded hover:bg-gray-700 text-green-400 transition-colors" title="保存"><Check size={13} /></button>
                            <button onClick={() => setEditingIdx(-1)} className="p-1 rounded hover:bg-gray-700 text-gray-500 transition-colors" title="取消"><X size={13} /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => handleSceneEdit(sceneIdx)} className="p-1 rounded hover:bg-gray-700 text-gray-600 hover:text-gray-300 transition-colors" title="编辑分镜"><Pencil size={12} /></button>
                            <button
                              onClick={() => handleRegenImage(img.image_number)}
                              disabled={isRegenerating || generating}
                              className="p-1 rounded hover:bg-gray-700 text-gray-600 hover:text-amber-400 disabled:opacity-30 transition-colors"
                              title="重新生成此图"
                            >
                              <RefreshCw size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Loading placeholders */}
        {generating && displayImages.length < activeImageCount && (
          <div className="mt-6 space-y-6">
            {Array.from({ length: Math.max(activeImageCount - displayImages.length, 0) }, (_, i) => (
              <div
                key={`placeholder-${i}`}
                className="rounded-xl border border-gray-800 bg-gray-900/50 h-64 flex items-center justify-center"
              >
                <div className="flex flex-col items-center gap-2 text-gray-700">
                  <Loader2 size={24} className="animate-spin" />
                  <span className="text-xs">等待生成…</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox with scroll navigation */}
      {lightboxImg && (
        <div
          ref={lightboxRef}
          className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center cursor-pointer select-none"
          onClick={() => setLightboxIdx(-1)}
        >
          {/* Close */}
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
            onClick={(e) => { e.stopPropagation(); setLightboxIdx(-1); }}
          >
            <X size={24} />
          </button>
          {/* Counter */}
          <div className="absolute top-4 left-4 px-3 py-1 bg-white/10 rounded-full text-sm text-white font-mono">
            {lightboxImg.image_number} / {imageCount}
          </div>
          {/* Nav up */}
          {lightboxIdx > 0 && (
            <button
              className="absolute top-16 left-1/2 -translate-x-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              onClick={(e) => { e.stopPropagation(); handleLightboxNav('prev'); }}
            >
              <ChevronUp size={20} />
            </button>
          )}
          {/* Image */}
          <img
            src={mangaImageUrl(lightboxImg.image_path)}
            alt={`Panel ${lightboxImg.image_number}`}
            className="max-w-[90%] max-h-[75vh] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
          {/* Nav down */}
          {lightboxIdx < displayImages.length - 1 && (
            <button
              className="absolute bottom-16 left-1/2 -translate-x-1/2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
              onClick={(e) => { e.stopPropagation(); handleLightboxNav('next'); }}
            >
              <ChevronDown size={20} />
            </button>
          )}
          {/* Prompt */}
          {lightboxImg.prompt && (
            <div className="absolute bottom-4 left-4 right-4 text-center text-sm text-gray-400 bg-black/60 rounded-lg px-4 py-2">
              {lightboxImg.prompt}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
