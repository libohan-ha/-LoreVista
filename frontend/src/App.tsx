import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, BookOpenText, Trash2, Home, MessageSquare, Image, PanelLeftClose, PanelLeftOpen, KeyRound, ExternalLink, X } from 'lucide-react';
import ChatPanel from './components/ChatPanel';
import MangaPanel from './components/MangaPanel';
import HomePage from './components/HomePage';
import {
  listChapters,
  listStories,
  createNextChapter,
  deleteChapter,
  getChapter,
  type Story,
  type Chapter,
  getApiKeySettings,
  saveApiKeySettings,
  clearApiKeySettings,
  API_KEY_CHANGE_EVENT,
  DEEPSEEK_USAGE_URL,
  IMAGE2_CONSOLE_URL,
} from './api';

type View = 'home' | 'editor';
type MobileTab = 'chat' | 'manga';

const LS_STORY_ID = 'lorevista.currentStoryId';
const LS_CHAPTER_ID = 'lorevista.currentChapterId';
const LS_CHAPTER_IDX = 'lorevista.currentChapterIdx';
const MOBILE_BREAKPOINT = 1024;

function chapterHash(chapterNumber: number) {
  return `chapter-${chapterNumber}`;
}

function parseChapterNumberHash(): number | null {
  const raw = window.location.hash.replace(/^#/, '');
  const match = raw.match(/^chapter-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function replaceHash(hash: string) {
  const next = `${window.location.pathname}${window.location.search}${hash ? `#${hash}` : ''}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.replaceState(null, '', next);
  }
}

function useIsMobile() {
  const read = () =>
    navigator.maxTouchPoints > 0 ||
    window.matchMedia('(any-pointer: coarse)').matches ||
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches ||
    window.matchMedia('(pointer: coarse)').matches;
  const [isMobile, setIsMobile] = useState(read);

  useEffect(() => {
    const widthMq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const touchMq = window.matchMedia('(pointer: coarse)');
    const anyTouchMq = window.matchMedia('(any-pointer: coarse)');
    let frame = 0;
    const sync = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => setIsMobile(read()));
    };
    widthMq.addEventListener('change', sync);
    touchMq.addEventListener('change', sync);
    anyTouchMq.addEventListener('change', sync);
    window.addEventListener('orientationchange', sync);
    window.addEventListener('resize', sync);
    return () => {
      window.cancelAnimationFrame(frame);
      widthMq.removeEventListener('change', sync);
      touchMq.removeEventListener('change', sync);
      anyTouchMq.removeEventListener('change', sync);
      window.removeEventListener('orientationchange', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return isMobile;
}

function useApiKeyConfigured() {
  const read = () => {
    const s = getApiKeySettings();
    return { deepseek: !!s.deepseekApiKey, image: !!s.imageApiKey };
  };
  const [state, setState] = useState(read);
  useEffect(() => {
    const sync = () => setState(read());
    window.addEventListener(API_KEY_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(API_KEY_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  return state;
}

function ApiKeySettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [deepseekApiKey, setDeepseekApiKey] = useState('');
  const [imageApiKey, setImageApiKey] = useState('');

  useEffect(() => {
    if (!open) return;
    const settings = getApiKeySettings();
    setDeepseekApiKey(settings.deepseekApiKey);
    setImageApiKey(settings.imageApiKey);
  }, [open]);

  if (!open) return null;

  const handleSave = () => {
    saveApiKeySettings({ deepseekApiKey, imageApiKey });
    onClose();
  };

  const handleClear = () => {
    if (!window.confirm('确定要清除已保存的两个 API Key 吗？')) return;
    clearApiKeySettings();
    setDeepseekApiKey('');
    setImageApiKey('');
  };

  const hasAny = !!(deepseekApiKey || imageApiKey);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-gray-800 bg-gray-950 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div className="flex items-center gap-2">
            <KeyRound size={18} className="text-violet-400" />
            <h2 className="text-sm font-semibold text-gray-100">API Key 设置</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-800 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium text-gray-300">DeepSeek API Key</label>
              <a
                href={DEEPSEEK_USAGE_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200"
              >
                充值 / 用量
                <ExternalLink size={12} />
              </a>
            </div>
            <input
              type="password"
              value={deepseekApiKey}
              onChange={(e) => setDeepseekApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500"
            />
            <p className="text-xs text-gray-500">用于 AI 对话、生成小说正文和生成分镜。</p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium text-gray-300">Image2 API Key</label>
              <a
                href={IMAGE2_CONSOLE_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200"
              >
                充值链接
                <ExternalLink size={12} />
              </a>
            </div>
            <input
              type="password"
              value={imageApiKey}
              onChange={(e) => setImageApiKey(e.target.value)}
              placeholder="填入图片生成 API Key"
              className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-500"
            />
            <p className="text-xs text-gray-500">用于生成漫画图片和重新生成单张图片。</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-gray-800 px-5 py-4">
          <button
            onClick={handleClear}
            disabled={!hasAny}
            className="rounded-lg px-3 py-2 text-xs text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:text-gray-600 disabled:hover:bg-transparent"
          >
            清除已保存
          </button>
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-400 hover:bg-gray-800 hover:text-white">
              取消
            </button>
            <button onClick={handleSave} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500">
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiKeyButton({ onClick, compact = false }: { onClick: () => void; compact?: boolean }) {
  const { deepseek, image } = useApiKeyConfigured();
  const status: 'ok' | 'partial' | 'none' =
    deepseek && image ? 'ok' : deepseek || image ? 'partial' : 'none';
  const dotColor =
    status === 'ok' ? 'bg-emerald-400' : status === 'partial' ? 'bg-amber-400' : 'bg-rose-500';
  const tipText =
    status === 'ok'
      ? '已配置 DeepSeek + Image2 API Key'
      : status === 'partial'
      ? `仅配置了 ${deepseek ? 'DeepSeek' : 'Image2'} API Key`
      : '未配置 API Key — 点击设置';
  return (
    <button
      onClick={onClick}
      className="relative inline-flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs font-medium text-gray-300 hover:border-violet-600 hover:text-white"
      title={tipText}
    >
      <KeyRound size={14} />
      {!compact && 'API Key'}
      <span
        className={`absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full ring-2 ring-gray-950 ${dotColor}`}
        aria-hidden
      />
    </button>
  );
}

function App() {
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>('home');
  const [story, setStory] = useState<Story | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentIdx, _setCurrentIdx] = useState(0);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');
  const [chapterNavOpen, setChapterNavOpen] = useState(true);
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false);

  const persistSelectedChapter = (chapter: Chapter | null | undefined) => {
    if (!chapter) return;
    replaceHash(chapterHash(chapter.chapter_number));
    localStorage.setItem(LS_CHAPTER_ID, String(chapter.id));
    localStorage.removeItem(LS_CHAPTER_IDX);
  };

  const setCurrentIdx = (idx: number | ((prev: number) => number), sourceChapters = chapters) => {
    _setCurrentIdx((prev) => {
      if (sourceChapters.length === 0) return 0;
      const rawNext = typeof idx === 'function' ? idx(prev) : idx;
      const next = Math.max(0, Math.min(rawNext, sourceChapters.length - 1));
      persistSelectedChapter(sourceChapters[next]);
      return next;
    });
  };

  const selectChapterNumber = (chapterNumber: number, sourceChapters = chapters) => {
    const idx = sourceChapters.findIndex((c) => c.chapter_number === chapterNumber);
    if (idx >= 0) setCurrentIdx(idx, sourceChapters);
  };
  const [loading, setLoading] = useState(true);
  const [creatingChapter, setCreatingChapter] = useState(false);

  // ─── Restore session from localStorage on mount ─────────
  useEffect(() => {
    const savedStoryId = localStorage.getItem(LS_STORY_ID);
    if (!savedStoryId) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const stories = await listStories();
        const s = stories.find((x) => x.id === Number(savedStoryId));
        if (!s) {
          localStorage.removeItem(LS_STORY_ID);
          localStorage.removeItem(LS_CHAPTER_ID);
          localStorage.removeItem(LS_CHAPTER_IDX);
          setLoading(false);
          return;
        }
        const chs = await listChapters(s.id);
        const hashChapterNumber = parseChapterNumberHash();
        const savedChapterId = Number(localStorage.getItem(LS_CHAPTER_ID) || '');
        const preferredIdx = hashChapterNumber
          ? chs.findIndex((c) => c.chapter_number === hashChapterNumber)
          : savedChapterId
            ? chs.findIndex((c) => c.id === savedChapterId)
          : -1;
        const idx = preferredIdx >= 0 ? preferredIdx : Math.max(0, chs.length - 1);
        setStory(s);
        setChapters(chs);
        _setCurrentIdx(idx);
        persistSelectedChapter(chs[idx]);
        setView('editor');
      } catch (err) {
        console.error('Failed to restore session:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const currentChapter = chapters[currentIdx] ?? null;

  const enterStory = async (s: Story) => {
    setLoading(true);
    try {
      setStory(s);
      localStorage.setItem(LS_STORY_ID, String(s.id));
      const chs = await listChapters(s.id);
      setChapters(chs);
      setCurrentIdx(Math.max(0, chs.length - 1), chs);
      setView('editor');
    } catch (err) {
      console.error('Failed to load story:', err);
    } finally {
      setLoading(false);
    }
  };

  const goHome = () => {
    setView('home');
    setStory(null);
    setChapters([]);
    _setCurrentIdx(0);
    replaceHash('');
    localStorage.removeItem(LS_STORY_ID);
    localStorage.removeItem(LS_CHAPTER_ID);
    localStorage.removeItem(LS_CHAPTER_IDX);
  };

  const refreshCurrentChapter = async () => {
    if (!currentChapter) return;
    const updated = await getChapter(currentChapter.id);
    setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const refreshChapter = async (chapterId: number) => {
    try {
      const updated = await getChapter(chapterId);
      setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
    } catch {
      // ignore
    }
  };

  const handlePrev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  const handleNext = async () => {
    if (creatingChapter) return;
    if (currentIdx < chapters.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else if (story) {
      setCreatingChapter(true);
      try {
        const newCh = await createNextChapter(story.id);
        const nextChapters = [...chapters, newCh];
        setChapters(nextChapters);
        setCurrentIdx(nextChapters.length - 1, nextChapters);
      } catch (err: any) {
        alert(`创建下一话失败: ${err.message}`);
      } finally {
        setCreatingChapter(false);
      }
    }
  };

  const handleDelete = async () => {
    if (!currentChapter) return;
    if (!confirm(`确定删除第 ${currentChapter.chapter_number} 话？对话和漫画都将被删除。`)) return;
    try {
      await deleteChapter(currentChapter.id);
      const remaining = chapters.filter((c) => c.id !== currentChapter.id);
      if (remaining.length === 0 && story) {
        const newCh = await createNextChapter(story.id);
        setChapters([newCh]);
        setCurrentIdx(0, [newCh]);
      } else {
        setChapters(remaining);
        setCurrentIdx(Math.min(currentIdx, remaining.length - 1), remaining);
      }
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

  useEffect(() => {
    if (view !== 'editor') return;
    const onHashChange = () => {
      const chapterNumber = parseChapterNumberHash();
      if (chapterNumber) selectChapterNumber(chapterNumber);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [view, chapters]);

  const chapterNav = (
    <aside
      className={`${
        chapterNavOpen ? 'w-64' : 'w-0'
      } hidden md:flex shrink-0 overflow-hidden border-r border-gray-800 bg-gray-950/95 transition-[width] duration-200`}
    >
      <div className="flex w-64 flex-col">
        <div className="flex h-11 items-center justify-between border-b border-gray-800 px-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">目录</span>
          <span className="text-[11px] text-gray-600">{chapters.length} 话</span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {chapters.map((chapter, idx) => {
            const active = chapter.id === currentChapter?.id;
            return (
              <button
                key={chapter.id}
                onClick={() => setCurrentIdx(idx)}
                className={`mb-1 w-full rounded-lg px-3 py-2 text-left transition-colors ${
                  active
                    ? 'bg-violet-600/20 text-violet-200 border border-violet-700/50'
                    : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200 border border-transparent'
                }`}
              >
                <div className="text-xs font-medium">第 {chapter.chapter_number} 话</div>
                <div className="mt-0.5 truncate text-[11px] text-gray-600">
                  {chapter.novel_content ? '已有正文' : chapter.messages.length ? '创作中' : '未开始'}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );

  // ─── Loading ───────────────────────────────────────────
  if (loading) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center text-gray-400">
        <div className="flex flex-col items-center gap-3">
          <BookOpenText size={40} className="animate-pulse" />
          <span className="text-sm">加载中…</span>
        </div>
      </div>
    );
  }

  // ─── Home page ─────────────────────────────────────────
  if (view === 'home') {
    return (
      <>
        <div className="fixed bottom-4 right-4 z-40">
          <ApiKeyButton onClick={() => setApiKeyModalOpen(true)} />
        </div>
        <HomePage onSelectStory={enterStory} />
        <ApiKeySettingsModal open={apiKeyModalOpen} onClose={() => setApiKeyModalOpen(false)} />
      </>
    );
  }

  // ─── Editor view ───────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="h-12 border-b border-gray-800 flex items-center justify-between px-3 md:px-5 shrink-0 bg-gray-950/80 backdrop-blur-sm">
        <div className="flex items-center gap-2 md:gap-3 min-w-0">
          <button
            onClick={goHome}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-gray-400 hover:text-white
                       hover:bg-gray-800 rounded-lg transition-colors shrink-0"
            title="返回首页"
          >
            <Home size={14} />
            {!isMobile && '首页'}
          </button>
          <div className="w-px h-5 bg-gray-800 shrink-0" />
          <button
            onClick={() => setChapterNavOpen((open) => !open)}
            className={`${isMobile ? 'hidden' : 'flex'} items-center justify-center w-8 h-8 text-gray-500 hover:text-white
                       hover:bg-gray-800 rounded-lg transition-colors shrink-0`}
            title={chapterNavOpen ? '收起目录' : '展开目录'}
            aria-label={chapterNavOpen ? '收起目录' : '展开目录'}
          >
            {chapterNavOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
          </button>
          <BookOpenText size={16} className="text-violet-400 shrink-0" />
          <span className="text-sm font-semibold tracking-wide truncate max-w-[120px] md:max-w-xs">
            {story?.title ?? '小说漫画生成器'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
          <ApiKeyButton onClick={() => setApiKeyModalOpen(true)} compact={isMobile} />
          <span>第 {currentChapter?.chapter_number ?? '–'} 话</span>
          {!isMobile && <span>·</span>}
          {!isMobile && <span>共 {chapters.length} 话</span>}
        </div>
      </header>
      <ApiKeySettingsModal open={apiKeyModalOpen} onClose={() => setApiKeyModalOpen(false)} />

      {/* Mobile tab bar */}
      {isMobile && (
        <div className="flex border-b border-gray-800 shrink-0">
          <button
            onClick={() => setMobileTab('chat')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${mobileTab === 'chat'
                ? 'text-violet-400 border-b-2 border-violet-400 bg-gray-900/50'
                : 'text-gray-500 hover:text-gray-300'}`}
          >
            <MessageSquare size={14} />
            对话
          </button>
          <button
            onClick={() => setMobileTab('manga')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition-colors
              ${mobileTab === 'manga'
                ? 'text-amber-400 border-b-2 border-amber-400 bg-gray-900/50'
                : 'text-gray-500 hover:text-gray-300'}`}
          >
            <Image size={14} />
            漫画
          </button>
        </div>
      )}

      {isMobile && chapters.length > 0 && (
        <div className="flex gap-1 overflow-x-auto border-b border-gray-800 bg-gray-950 px-2 py-2 shrink-0">
          {chapters.map((chapter, idx) => (
            <button
              key={chapter.id}
              onClick={() => setCurrentIdx(idx)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                chapter.id === currentChapter?.id
                  ? 'border-violet-500 bg-violet-600/20 text-violet-200'
                  : 'border-gray-800 bg-gray-900 text-gray-500 hover:text-gray-300'
              }`}
            >
              第 {chapter.chapter_number} 话
            </button>
          ))}
        </div>
      )}

      {/* Main content */}
      {isMobile ? (
        <main className="flex-1 min-h-0">
          <div className={`h-full ${mobileTab === 'chat' ? '' : 'hidden'}`}>
            <ChatPanel
              chapter={currentChapter}
              onMessageSent={refreshCurrentChapter}
              onChapterRefresh={refreshChapter}
              onGoToManga={() => setMobileTab('manga')}
            />
          </div>
          <div className={`h-full ${mobileTab === 'manga' ? '' : 'hidden'}`}>
            <MangaPanel chapter={currentChapter} onChapterRefresh={refreshChapter} />
          </div>
        </main>
      ) : (
        <main className="flex-1 flex min-h-0">
          {chapterNav}
          <div className="flex flex-1 min-w-0">
            <div className="w-1/2 border-r border-gray-800">
              <ChatPanel chapter={currentChapter} onMessageSent={refreshCurrentChapter} onChapterRefresh={refreshChapter} />
            </div>
            <div className="w-1/2">
              <MangaPanel chapter={currentChapter} onChapterRefresh={refreshChapter} />
            </div>
          </div>
        </main>
      )}

      {/* Bottom navigation */}
      <footer className="h-14 border-t border-gray-800 flex items-center justify-center gap-2 md:gap-4 shrink-0 bg-gray-950/80 backdrop-blur-sm px-2">
        <button
          onClick={handlePrev}
          disabled={currentIdx === 0}
          className="flex items-center gap-1 px-3 md:px-5 py-2 text-sm font-medium rounded-lg
                     bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-30
                     disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} />
          {!isMobile && '上一话'}
        </button>

        <button
          onClick={handleDelete}
          disabled={!currentChapter}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg
                     bg-red-900/50 hover:bg-red-800 text-red-300 disabled:opacity-30
                     disabled:cursor-not-allowed transition-colors"
          title="删除当前话"
          aria-label="删除当前话"
        >
          <Trash2 size={14} />
        </button>

        <div className="flex items-center gap-1 text-xs text-gray-600">
          {chapters.map((chapter, i) => (
            <button
              key={chapter.id}
              onClick={() => setCurrentIdx(i)}
              aria-label={`跳转到第 ${chapter.chapter_number} 话`}
              className={`w-2 h-2 rounded-full transition-colors ${
                i === currentIdx ? 'bg-violet-500' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            />
          ))}
        </div>

        <button
          onClick={handleNext}
          disabled={creatingChapter}
          className="flex items-center gap-1 px-3 md:px-5 py-2 text-sm font-medium rounded-lg
                     bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40
                     disabled:cursor-not-allowed transition-colors"
        >
          {currentIdx === chapters.length - 1 ? (
            <>
              <Plus size={16} />
              {creatingChapter ? '新建…' : (isMobile ? '新建' : '下一话（新建）')}
            </>
          ) : (
            <>
              {!isMobile && '下一话'}
              <ChevronRight size={16} />
            </>
          )}
        </button>
      </footer>
    </div>
  );
}

export default App;
