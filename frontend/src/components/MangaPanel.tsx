import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, Download, ImageIcon, Loader2, Sparkles, Pencil, RefreshCw, Check, X } from 'lucide-react';
import {
  generateMangaStream,
  generateScenes,
  getScenes,
  updateScenes,
  regenerateImage,
  getCharacters,
  saveCharacters,
  mangaImageUrl,
  type Chapter,
  type MangaProgress,
} from '../api';

interface Props {
  chapter: Chapter | null;
}

interface ImageItem {
  image_number: number;
  image_path: string;
  prompt: string;
}

type Phase = 'idle' | 'generating-scenes' | 'editing-scenes' | 'generating-images';

const DEFAULT_CHARACTERS = `角色名：塞蕾娜（Serena）
性别：女
年龄段：青年
发色与发型：银灰色长发，发尾带冷白光泽，长度过腰；前额有细碎刘海，两侧留有贴脸发束；战斗时通常束成高马尾或半高马尾，日常多为自然披发或低束发
瞳色：冰灰蓝色
面部特征：瓜子脸偏冷感轮廓，下颌线清晰；鼻梁挺直，嘴唇偏薄；表情常年克制平静，战斗时眼神锐利压迫，面对公主时会出现极淡的温柔和隐约红晕
体型：高挑纤细，肩背挺直，腰线明显，四肢修长有力量感，约170cm左右
标志性服装：固定为黑白主色的高阶战斗女仆装；上身为黑色收腰束身长袖女仆上衣，胸前白色荷叶边内衬与黑色丝带领结；下身为多层不规则裙摆的黑白短前长后裙，方便行动；外披深黑偏蓝的长摆披风或后摆外层；腿部为黑色过膝袜或贴身长袜，搭配银黑色高跟战斗短靴；战斗时加装银色护臂、护腿与轻型腰甲
标志性配饰/道具：白色女仆头饰；黑色缎带发饰；腰间佩一把银黑色长剑；必要时手背、脚踝与腰侧会显现银蓝色术式纹路；影庭展开时脚下会浮现黑色影纹法阵
气质关键词：冷静、克制、锋利、忠诚、禁欲

角色名：艾莉西娅（Alicia）
性别：女
年龄段：少女
发色与发型：金色长发，带柔和蜂蜜金与浅日光色层次，长度过腰；发量丰厚，发尾微卷；前额为轻薄空气刘海，两侧有柔软脸侧发；正式场合多为半披发配编发与王族发饰，日常则多为自然披发
瞳色：浅金琥珀色
面部特征：小巧鹅蛋脸，五官精致柔和，眼睛大而明亮，睫毛纤长；嘴唇饱满柔软；平时神情温柔高贵，撒娇时眼神湿润黏人，认真时会显出王女式的理性与坚定
体型：高挑偏纤细，曲线柔和，肩颈线条优美，体态轻盈端庄，约165cm左右
标志性服装：固定为白金与淡紫主色的王女礼裙；上身为收腰露肩或半露肩宫廷式礼服胸衣，点缀金线与花纹刺绣；下身为多层轻纱长裙，裙摆宽大飘逸；袖口常为垂坠式薄纱长袖或花边袖；搭配白色或浅金高跟鞋；正式出行可披浅紫白金短披肩
标志性配饰/道具：王女冠饰或小型王族发冠；紫晶与白蔷薇元素发饰；耳坠与颈饰常为金色与淡紫宝石；手背或胸前在动用王权共鸣时会浮现浅金色魔法纹路；偶尔携带象征王女身份的细身手杖或礼仪短扇
气质关键词：高贵、温柔、明亮、黏人、王者感`;

export default function MangaPanel({ chapter }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 10 });
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
  const [charEditing, setCharEditing] = useState(false);
  const [charDraft, setCharDraft] = useState('');
  const [charSaving, setCharSaving] = useState(false);
  const [charExpanded, setCharExpanded] = useState(false);
  const lightboxRef = useRef<HTMLDivElement>(null);

  // Reset state when chapter changes
  useEffect(() => {
    setImages([]);
    setPhase('idle');
    setProgress({ current: 0, total: 10 });
    setStatusMsg('');
    setErrorMsg('');
    setLightboxIdx(-1);
    setScenes([]);
    setEditingIdx(-1);
    setRegenIdx(-1);
    setCharText('');
    setCharEditing(false);
    setCharExpanded(false);
    // Load existing scenes and characters if available
    if (chapter) {
      getScenes(chapter.id).then((s) => {
        if (s.length === 10) {
          setScenes(s);
          setPhase('editing-scenes');
        }
      }).catch(() => {});
      getCharacters(chapter.id).then((c) => {
        if (c) {
          setCharText(c);
        } else {
          // Auto-fill default character profiles for new chapters
          setCharText(DEFAULT_CHARACTERS);
          saveCharacters(chapter.id, DEFAULT_CHARACTERS).catch(() => {});
        }
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

  const displayImages = images.length > 0 ? images : existingImages;
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
    try {
      const result = await generateScenes(chapter.id);
      setScenes(result);
      setPhase('editing-scenes');
    } catch (err: any) {
      setErrorMsg(err.message);
      setPhase('idle');
    }
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
        image_path: result.image_path + '?t=' + Date.now(),
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

  // ── Image generation ──
  const handleGenerateImages = async () => {
    if (!chapter || phase === 'generating-images') return;
    // Save scenes first
    try {
      await updateScenes(chapter.id, scenes);
    } catch (err: any) {
      setErrorMsg(`保存分镜失败: ${err.message}`);
      return;
    }

    setPhase('generating-images');
    setImages([]);
    setProgress({ current: 0, total: 10 });
    setStatusMsg('正在生成漫画…');
    setErrorMsg('');

    generateMangaStream(chapter.id, (event: MangaProgress) => {
      switch (event.type) {
        case 'status':
          setStatusMsg(event.data.message);
          break;
        case 'progress':
          setProgress({ current: event.data.current, total: event.data.total });
          setStatusMsg(`正在生成第 ${event.data.current}/10 张漫画…`);
          break;
        case 'image':
          setImages((prev) => [
            ...prev,
            {
              image_number: event.data.image_number,
              image_path: event.data.image_path,
              prompt: event.data.prompt,
            },
          ]);
          break;
        case 'done':
          setPhase('editing-scenes');
          setStatusMsg('');
          break;
        case 'error':
          setPhase('editing-scenes');
          setStatusMsg('');
          setErrorMsg(event.data.error || '未知错误');
          break;
      }
    });
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

  const generating = phase === 'generating-images';
  const hasImages = displayImages.length > 0;

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-200 tracking-wide uppercase shrink-0">
          第 {chapter?.chapter_number ?? '–'} 话 · 漫画
        </h2>
        <div className="flex items-center gap-2">
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
          {(phase === 'idle' || phase === 'editing-scenes') && (
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
          {phase === 'editing-scenes' && scenes.length === 10 && (
            <button
              onClick={handleGenerateImages}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-md
                         bg-amber-500 hover:bg-amber-400 text-gray-950 transition-colors"
            >
              <Sparkles size={13} />
              {existingImages.length > 0 && existingImages.length < 10 ? '继续生成漫画' : '生成漫画'}
            </button>
          )}
          {phase === 'generating-scenes' && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <Loader2 size={13} className="animate-spin" />
              AI 生成分镜中…
            </span>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {generating && (
        <div className="px-5 py-4 border-b border-gray-800 bg-gray-900/50">
          <div className="flex items-center justify-between text-xs mb-3">
            <span className="text-gray-300 font-medium">{statusMsg}</span>
            <span className="text-amber-400 font-mono font-bold">
              {Math.round((progress.current / progress.total) * 100)}%
            </span>
          </div>
          <div className="w-full h-3 bg-gray-800 rounded-full overflow-hidden relative">
            <div
              className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
              style={{
                width: `${Math.max((progress.current / progress.total) * 100, 2)}%`,
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
            {Array.from({ length: 10 }, (_, i) => (
              <span key={i} className={i < progress.current ? 'text-amber-500' : ''}>
                {i + 1}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error banner */}
      {errorMsg && (
        <div className="mx-5 mt-3 px-4 py-3 rounded-lg bg-red-900/30 border border-red-800 text-red-300 text-sm flex items-start gap-2">
          <span className="shrink-0 mt-0.5">⚠</span>
          <div>
            <div className="font-medium mb-0.5">生成出错</div>
            <div className="text-xs text-red-400">{errorMsg}</div>
          </div>
        </div>
      )}

      {/* Main content area */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Character profiles card */}
        {(phase === 'idle' || phase === 'editing-scenes') && (
          <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/60 overflow-hidden">
            <button
              onClick={() => setCharExpanded((v) => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide hover:bg-gray-800/40 transition-colors"
            >
              <span>🎭 角色外貌卡 {charText ? '（已设定）' : '（未设定）'}</span>
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
                            setCharEditing(false);
                          } catch (err: any) {
                            setErrorMsg(err.message);
                          } finally {
                            setCharSaving(false);
                          }
                        }}
                        className="px-3 py-1 text-xs rounded bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 transition-colors"
                      >{charSaving ? '保存中…' : '保存'}</button>
                    </div>
                  </>
                ) : charText ? (
                  <>
                    <pre className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">{charText}</pre>
                    <button
                      onClick={() => { setCharDraft(charText); setCharEditing(true); }}
                      className="mt-2 flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                    ><Pencil size={11} /> 编辑</button>
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
        {scenes.length === 10 && displayImages.length === 0 && !generating && (
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
                    src={mangaImageUrl(img.image_path)}
                    alt={`Panel ${img.image_number}`}
                    className={`w-full object-contain ${isRegenerating ? 'opacity-30' : ''}`}
                    loading="lazy"
                  />
                  <div className="absolute top-3 left-3 px-2 py-0.5 bg-black/70 rounded text-[10px] text-gray-300 font-mono">
                    {img.image_number}/10
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
        {generating && images.length < 10 && (
          <div className="mt-6 space-y-6">
            {Array.from({ length: 10 - images.length }, (_, i) => (
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
            {lightboxImg.image_number} / 10
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
