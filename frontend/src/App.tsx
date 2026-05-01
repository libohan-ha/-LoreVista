import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, BookOpenText, Trash2, Home, MessageSquare, Image } from 'lucide-react';
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
} from './api';

type View = 'home' | 'editor';
type MobileTab = 'chat' | 'manga';

const LS_STORY_ID = 'lorevista.currentStoryId';
const LS_CHAPTER_IDX = 'lorevista.currentChapterIdx';
const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

function App() {
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>('home');
  const [story, setStory] = useState<Story | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentIdx, _setCurrentIdx] = useState(0);
  const [mobileTab, setMobileTab] = useState<MobileTab>('chat');

  const setCurrentIdx = (idx: number | ((prev: number) => number)) => {
    _setCurrentIdx((prev) => {
      const next = typeof idx === 'function' ? idx(prev) : idx;
      window.location.hash = String(next);
      localStorage.setItem(LS_CHAPTER_IDX, String(next));
      return next;
    });
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
          localStorage.removeItem(LS_CHAPTER_IDX);
          setLoading(false);
          return;
        }
        const chs = await listChapters(s.id);
        const savedIdx = Number(localStorage.getItem(LS_CHAPTER_IDX) ?? '0');
        const idx = Math.max(0, Math.min(savedIdx, chs.length - 1));
        setStory(s);
        setChapters(chs);
        _setCurrentIdx(idx);
        window.location.hash = String(idx);
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
      setCurrentIdx(0);
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
    window.location.hash = '';
    localStorage.removeItem(LS_STORY_ID);
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
        setChapters((prev) => [...prev, newCh]);
        setCurrentIdx(chapters.length);
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
        setCurrentIdx(0);
      } else {
        setChapters(remaining);
        setCurrentIdx(Math.min(currentIdx, remaining.length - 1));
      }
    } catch (err: any) {
      alert(`删除失败: ${err.message}`);
    }
  };

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
    return <HomePage onSelectStory={enterStory} />;
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
          <BookOpenText size={16} className="text-violet-400 shrink-0" />
          <span className="text-sm font-semibold tracking-wide truncate max-w-[120px] md:max-w-xs">
            {story?.title ?? '小说漫画生成器'}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500 shrink-0">
          <span>第 {currentChapter?.chapter_number ?? '–'} 话</span>
          {!isMobile && <span>·</span>}
          {!isMobile && <span>共 {chapters.length} 话</span>}
        </div>
      </header>

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

      {/* Main content */}
      {isMobile ? (
        <main className="flex-1 min-h-0">
          <div className={`h-full ${mobileTab === 'chat' ? '' : 'hidden'}`}>
            <ChatPanel
              chapter={currentChapter}
              onMessageSent={refreshCurrentChapter}
              onGoToManga={() => setMobileTab('manga')}
            />
          </div>
          <div className={`h-full ${mobileTab === 'manga' ? '' : 'hidden'}`}>
            <MangaPanel chapter={currentChapter} onChapterRefresh={refreshChapter} />
          </div>
        </main>
      ) : (
        <main className="flex-1 flex min-h-0">
          <div className="w-1/2 border-r border-gray-800">
            <ChatPanel chapter={currentChapter} onMessageSent={refreshCurrentChapter} />
          </div>
          <div className="w-1/2">
            <MangaPanel chapter={currentChapter} onChapterRefresh={refreshChapter} />
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

        {!isMobile && (
          <button
            onClick={handleDelete}
            disabled={!currentChapter}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg
                       bg-red-900/50 hover:bg-red-800 text-red-300 disabled:opacity-30
                       disabled:cursor-not-allowed transition-colors"
            title="删除当前话"
          >
            <Trash2 size={14} />
          </button>
        )}

        <div className="flex items-center gap-1 text-xs text-gray-600">
          {chapters.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIdx(i)}
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
