import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, BookOpenText, Trash2 } from 'lucide-react';
import ChatPanel from './components/ChatPanel';
import MangaPanel from './components/MangaPanel';
import {
  createStory,
  listStories,
  listChapters,
  createNextChapter,
  deleteChapter,
  getChapter,
  type Story,
  type Chapter,
} from './api';

function App() {
  const [story, setStory] = useState<Story | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentIdx, _setCurrentIdx] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    const n = parseInt(hash, 10);
    return isNaN(n) ? 0 : n;
  });

  const setCurrentIdx = (idx: number | ((prev: number) => number)) => {
    _setCurrentIdx((prev) => {
      const next = typeof idx === 'function' ? idx(prev) : idx;
      window.location.hash = String(next);
      return next;
    });
  };
  const [loading, setLoading] = useState(true);

  const currentChapter = chapters[currentIdx] ?? null;

  // On mount: load or create story
  useEffect(() => {
    (async () => {
      try {
        const stories = await listStories();
        let s: Story;
        if (stories.length > 0) {
          s = stories[0];
        } else {
          s = await createStory('我的第一个故事');
        }
        setStory(s);
        const chs = await listChapters(s.id);
        setChapters(chs);
        const hash = window.location.hash.replace('#', '');
        const saved = parseInt(hash, 10);
        const idx = !isNaN(saved) && saved < chs.length ? saved : 0;
        setCurrentIdx(idx);
      } catch (err) {
        console.error('Init failed:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const refreshCurrentChapter = async () => {
    if (!currentChapter) return;
    const updated = await getChapter(currentChapter.id);
    setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handleChapterUpdate = (updated: Chapter) => {
    setChapters((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));
  };

  const handlePrev = () => {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  };

  const handleNext = async () => {
    if (currentIdx < chapters.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else if (story) {
      // Create next chapter
      const newCh = await createNextChapter(story.id);
      setChapters((prev) => [...prev, newCh]);
      setCurrentIdx(chapters.length);
    }
  };

  const handleDelete = async () => {
    if (!currentChapter) return;
    if (!confirm(`确定删除第 ${currentChapter.chapter_number} 话？对话和漫画都将被删除。`)) return;
    try {
      await deleteChapter(currentChapter.id);
      const remaining = chapters.filter((c) => c.id !== currentChapter.id);
      if (remaining.length === 0 && story) {
        // Create a fresh chapter 1
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

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
      {/* Top bar */}
      <header className="h-12 border-b border-gray-800 flex items-center justify-between px-5 shrink-0 bg-gray-950/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <BookOpenText size={18} className="text-violet-400" />
          <span className="text-sm font-semibold tracking-wide">{story?.title ?? '小说漫画生成器'}</span>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>第 {currentChapter?.chapter_number ?? '–'} 话</span>
          <span>·</span>
          <span>共 {chapters.length} 话</span>
        </div>
      </header>

      {/* Main content: left chat + right manga */}
      <main className="flex-1 flex min-h-0">
        {/* Left: Chat */}
        <div className="w-1/2 border-r border-gray-800">
          <ChatPanel chapter={currentChapter} onMessageSent={refreshCurrentChapter} />
        </div>

        {/* Right: Manga */}
        <div className="w-1/2">
          <MangaPanel chapter={currentChapter} />
        </div>
      </main>

      {/* Bottom navigation */}
      <footer className="h-14 border-t border-gray-800 flex items-center justify-center gap-4 shrink-0 bg-gray-950/80 backdrop-blur-sm">
        <button
          onClick={handlePrev}
          disabled={currentIdx === 0}
          className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg
                     bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-30
                     disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={16} />
          上一话
        </button>

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
          className="flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg
                     bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          {currentIdx === chapters.length - 1 ? (
            <>
              <Plus size={16} />
              下一话（新建）
            </>
          ) : (
            <>
              下一话
              <ChevronRight size={16} />
            </>
          )}
        </button>
      </footer>
    </div>
  );
}

export default App;
