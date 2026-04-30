import { useEffect, useState, useRef } from 'react';
import {
  Plus,
  BookOpenText,
  Pencil,
  Trash2,
  ImagePlus,
  ChevronRight,
  X,
  Check,
  Sparkles,
} from 'lucide-react';
import {
  listStories,
  createStory,
  updateStory,
  deleteStory,
  uploadStoryCover,
  coverImageUrl,
  type Story,
} from '../api';

interface Props {
  onSelectStory: (story: Story) => void;
}

export default function HomePage({ onSelectStory }: Props) {
  const [stories, setStories] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);

  // New story dialog
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');

  // Edit mode
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = useState<number | null>(null);

  useEffect(() => {
    loadStories();
  }, []);

  const loadStories = async () => {
    try {
      const list = await listStories();
      setStories(list);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    const title = newTitle.trim() || '未命名故事';
    const desc = newDesc.trim();
    const s = await createStory(title, desc);
    setStories((prev) => [s, ...prev]);
    setShowNew(false);
    setNewTitle('');
    setNewDesc('');
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这本小说吗？所有章节、对话、漫画都将被永久删除！')) return;
    await deleteStory(id);
    setStories((prev) => prev.filter((s) => s.id !== id));
  };

  const startEdit = (s: Story) => {
    setEditingId(s.id);
    setEditTitle(s.title);
    setEditDesc(s.description || '');
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    const updated = await updateStory(editingId, {
      title: editTitle.trim() || '未命名故事',
      description: editDesc.trim(),
    });
    setStories((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    setEditingId(null);
  };

  const handleCoverClick = (storyId: number) => {
    setUploadingCover(storyId);
    fileRef.current?.click();
  };

  const handleCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || uploadingCover === null) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const b64 = (reader.result as string).split(',')[1];
      const coverPath = await uploadStoryCover(uploadingCover, b64);
      setStories((prev) =>
        prev.map((s) => (s.id === uploadingCover ? { ...s, cover_image: coverPath } : s)),
      );
      setUploadingCover(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
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
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleCoverFile}
      />

      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-600 flex items-center justify-center">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">LoreVista</h1>
              <p className="text-xs text-gray-500">AI 小说 · 漫画工坊</p>
            </div>
          </div>
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-500
                       text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-violet-900/30"
          >
            <Plus size={16} />
            新建小说
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* New story dialog */}
        {showNew && (
          <div className="mb-8 bg-gray-900 border border-gray-700 rounded-xl p-6 shadow-2xl">
            <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
              <Plus size={16} className="text-violet-400" />
              创建新小说
            </h3>
            <div className="space-y-3">
              <input
                autoFocus
                placeholder="小说名称"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm
                           placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
              <textarea
                placeholder="简短描述（可选）"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                rows={2}
                className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm
                           placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowNew(false)}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  className="px-5 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  创建
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {stories.length === 0 && !showNew && (
          <div className="flex flex-col items-center justify-center py-32 text-gray-500">
            <BookOpenText size={56} className="mb-4 text-gray-700" />
            <p className="text-lg font-medium mb-2">还没有小说</p>
            <p className="text-sm mb-6">点击"新建小说"开始你的创作之旅</p>
            <button
              onClick={() => setShowNew(true)}
              className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={16} className="inline mr-1" />
              新建小说
            </button>
          </div>
        )}

        {/* Story cards grid */}
        {stories.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {stories.map((s) => (
              <div
                key={s.id}
                className="group bg-gray-900 border border-gray-800 rounded-xl overflow-hidden
                           hover:border-violet-600/50 hover:shadow-xl hover:shadow-violet-900/10
                           transition-all duration-200"
              >
                {/* Cover */}
                <div
                  className="relative h-48 bg-gradient-to-br from-gray-800 to-gray-900 cursor-pointer overflow-hidden"
                  onClick={() => handleCoverClick(s.id)}
                >
                  {s.cover_image ? (
                    <img
                      src={coverImageUrl(s.cover_image)!}
                      alt={s.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-gray-600 group-hover:text-gray-500 transition-colors">
                      <ImagePlus size={32} className="mb-2" />
                      <span className="text-xs">点击上传封面</span>
                    </div>
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
                </div>

                {/* Info */}
                <div className="p-4">
                  {editingId === s.id ? (
                    <div className="space-y-2">
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                        className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm
                                   focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                      <textarea
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        rows={2}
                        className="w-full px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm
                                   focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                        placeholder="简短描述（可选）"
                      />
                      <div className="flex gap-1 justify-end">
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1.5 text-gray-500 hover:text-gray-300"
                        >
                          <X size={14} />
                        </button>
                        <button
                          onClick={saveEdit}
                          className="p-1.5 text-violet-400 hover:text-violet-300"
                        >
                          <Check size={14} />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 className="font-semibold text-sm mb-1 line-clamp-1">{s.title}</h3>
                      {s.description && (
                        <p className="text-xs text-gray-500 mb-3 line-clamp-2">{s.description}</p>
                      )}
                      {!s.description && <div className="mb-3" />}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-600">
                          {new Date(s.created_at).toLocaleDateString('zh-CN')}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(s);
                            }}
                            className="p-1.5 text-gray-600 hover:text-gray-300 transition-colors rounded"
                            title="编辑"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(s.id);
                            }}
                            className="p-1.5 text-gray-600 hover:text-red-400 transition-colors rounded"
                            title="删除"
                          >
                            <Trash2 size={13} />
                          </button>
                          <button
                            onClick={() => onSelectStory(s)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-violet-600/20 hover:bg-violet-600
                                       text-violet-400 hover:text-white text-xs font-medium rounded-lg transition-colors"
                          >
                            进入
                            <ChevronRight size={13} />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
