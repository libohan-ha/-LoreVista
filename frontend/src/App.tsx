import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, BookOpenText, Trash2, Home, MessageSquare, Image, PanelLeftClose, PanelLeftOpen, KeyRound, ExternalLink, X, Eye, EyeOff } from 'lucide-react';
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
  getOpenAIProfiles,
  getActiveOpenAIProfileId,
  saveApiKeySettings,
  saveOpenAIProfiles,
  clearApiKeySettings,
  API_KEY_CHANGE_EVENT,
  DEEPSEEK_USAGE_URL,
  IMAGE2_CONSOLE_URL,
  NEWAPI_SIGNUP_URL,
  type ImageProvider,
  type LLMProvider,
  type OpenAIProfile,
  listLlmModels,
} from './api';

type View = 'home' | 'editor';
type MobileTab = 'chat' | 'manga';
type SettingsTab = 'llm' | 'image';

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
    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
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
    const activeImageKey = s.imageProvider === 'newapi'
      ? s.newapiApiKey
      : s.imageProvider === 'ai98pro'
        ? s.ai98proApiKey
        : s.image2ApiKey;
    const llmConfigured = s.llmProvider === 'deepseek' ? !!s.deepseekApiKey : !!s.openaiApiKey;
    return { deepseek: llmConfigured, image: !!activeImageKey, provider: s.imageProvider };
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

function SecretInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className: string;
}) {
  const [visible, setVisible] = useState(false);
  const displayValue = visible ? value : '*'.repeat(value.length);
  const reveal = () => setVisible(true);
  return (
    <div className="relative">
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-lpignore="true"
        data-1p-ignore="true"
        name={`lorevista-secret-${placeholder}`}
        value={displayValue}
        onFocus={reveal}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${className} pr-10 font-mono`}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 hover:text-gray-200"
        title={visible ? '隐藏 API Key' : '显示 API Key'}
        aria-label={visible ? '隐藏 API Key' : '显示 API Key'}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

function ApiKeySettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('llm');
  const [deepseekApiKey, setDeepseekApiKey] = useState('');
  const [imageProvider, setImageProvider] = useState<ImageProvider>('image2');
  const [image2ApiKey, setImage2ApiKey] = useState('');
  const [newapiApiKey, setNewapiApiKey] = useState('');
  const [ai98proApiKey, setAi98proApiKey] = useState('');
  const [llmProvider, setLlmProvider] = useState<LLMProvider>('deepseek');
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('');
  const [openaiProfiles, setOpenaiProfiles] = useState<OpenAIProfile[]>([]);
  const [activeOpenaiProfileId, setActiveOpenaiProfileId] = useState('');
  const [modelList, setModelList] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [modelError, setModelError] = useState('');
  const modelRequestRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    setSettingsTab('llm');
    modelRequestRef.current?.abort();
    setFetchingModels(false);
    const settings = getApiKeySettings();
    setDeepseekApiKey(settings.deepseekApiKey);
    setImageProvider(settings.imageProvider);
    setImage2ApiKey(settings.image2ApiKey);
    setNewapiApiKey(settings.newapiApiKey);
    setAi98proApiKey(settings.ai98proApiKey);
    setLlmProvider(settings.llmProvider);
    setOpenaiBaseUrl(settings.openaiBaseUrl);
    setOpenaiApiKey(settings.openaiApiKey);
    setOpenaiModel(settings.openaiModel);
    const profiles = getOpenAIProfiles();
    const savedActiveId = getActiveOpenAIProfileId();
    const activeProfile = profiles.find((profile) => profile.id === savedActiveId)
      || profiles.find((profile) => profile.baseUrl === settings.openaiBaseUrl && profile.apiKey === settings.openaiApiKey);
    setOpenaiProfiles(profiles);
    setActiveOpenaiProfileId(activeProfile?.id || '');
    if (activeProfile) {
      setOpenaiBaseUrl(activeProfile.baseUrl);
      setOpenaiApiKey(activeProfile.apiKey);
      setOpenaiModel(activeProfile.model);
    }
    setModelList([]);
    setModelError('');
  }, [open]);

  const loadModels = useCallback(async (signal: AbortSignal) => {
    setFetchingModels(true);
    setModelError('');
    try {
      const result = await listLlmModels(
        {
          llmProvider,
          openaiBaseUrl,
          openaiApiKey,
          openaiModel,
        },
        signal,
      );
      if (signal.aborted) return;
      setModelList(result.models);
      const nextModel = result.models.includes(openaiModel) ? openaiModel : (result.models[0] || '');
      setOpenaiModel(nextModel);
    } catch (err: unknown) {
      if (signal.aborted) return;
      setModelError(err instanceof Error ? err.message : '拉取模型列表失败');
      setModelList([]);
    } finally {
      if (!signal.aborted) setFetchingModels(false);
    }
  }, [llmProvider, openaiBaseUrl, openaiApiKey, openaiModel]);

  const handleFetchModels = useCallback(() => {
    modelRequestRef.current?.abort();
    const controller = new AbortController();
    modelRequestRef.current = controller;
    void loadModels(controller.signal);
  }, [loadModels]);

  const selectOpenAIProfile = (profileId: string) => {
    setActiveOpenaiProfileId(profileId);
    const profile = openaiProfiles.find((item) => item.id === profileId);
    setOpenaiBaseUrl(profile?.baseUrl || '');
    setOpenaiApiKey(profile?.apiKey || '');
    setOpenaiModel(profile?.model || '');
    setModelList([]);
    setModelError('');
  };

  if (!open) return null;

  const handleSave = () => {
    let nextProfiles = openaiProfiles;
    let activeProfileId = activeOpenaiProfileId;
    if (llmProvider === 'openai_compat' && openaiBaseUrl.trim() && openaiApiKey.trim()) {
      activeProfileId = activeProfileId || `openai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const profile: OpenAIProfile = {
        id: activeProfileId,
        baseUrl: openaiBaseUrl.trim(),
        apiKey: openaiApiKey.trim(),
        model: openaiModel.trim(),
      };
      nextProfiles = [profile, ...openaiProfiles.filter((item) => item.id !== activeProfileId)];
      saveOpenAIProfiles(nextProfiles, activeProfileId);
    }
    saveApiKeySettings({ deepseekApiKey, imageProvider, image2ApiKey, newapiApiKey, ai98proApiKey, llmProvider, openaiBaseUrl, openaiApiKey, openaiModel });
    onClose();
  };

  const handleClear = () => {
    if (!window.confirm('确定要清除已保存的 API Key 吗？')) return;
    clearApiKeySettings();
    setDeepseekApiKey('');
    setImageProvider('image2');
    setImage2ApiKey('');
    setNewapiApiKey('');
    setAi98proApiKey('');
    setLlmProvider('deepseek');
    setOpenaiBaseUrl('');
    setOpenaiApiKey('');
    setOpenaiModel('');
    setOpenaiProfiles([]);
    setActiveOpenaiProfileId('');
    setModelList([]);
    modelRequestRef.current?.abort();
  };

  const handleDeleteOpenAIProfile = () => {
    if (!activeOpenaiProfileId) return;
    const nextProfiles = openaiProfiles.filter((profile) => profile.id !== activeOpenaiProfileId);
    const nextActive = nextProfiles[0];
    saveOpenAIProfiles(nextProfiles, nextActive?.id || '');
    saveApiKeySettings({
      deepseekApiKey,
      imageProvider,
      image2ApiKey,
      newapiApiKey,
      ai98proApiKey,
      llmProvider,
      openaiBaseUrl: nextActive?.baseUrl || '',
      openaiApiKey: nextActive?.apiKey || '',
      openaiModel: nextActive?.model || '',
    });
    setOpenaiProfiles(nextProfiles);
    selectOpenAIProfile(nextActive?.id || '');
  };

  const hasAny = !!(deepseekApiKey || image2ApiKey || newapiApiKey || ai98proApiKey || (llmProvider === 'openai_compat' ? openaiApiKey : ''));

  const openaiFields = llmProvider === 'openai_compat';

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
          <div className="grid grid-cols-2 rounded-lg border border-gray-800 bg-gray-900 p-1">
            <button
              type="button"
              onClick={() => setSettingsTab('llm')}
              className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${settingsTab === 'llm' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
            >
              <MessageSquare size={15} />
              对话模型
            </button>
            <button
              type="button"
              onClick={() => setSettingsTab('image')}
              className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${settingsTab === 'image' ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-100'}`}
            >
              <Image size={15} />
              图片生成服务
            </button>
          </div>

          {settingsTab === 'llm' && (
          <>
          {llmProvider === 'deepseek' && (
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
            <SecretInput
              value={deepseekApiKey}
              onChange={setDeepseekApiKey}
              placeholder="sk-..."
              className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-violet-500"
            />
            <p className="text-xs text-gray-500">用于 AI 对话、生成小说正文和生成分镜。</p>
          </div>
          )}

          {/* LLM Provider Selection */}
          <div className="space-y-3">
            <label className="text-xs font-medium text-gray-300">对话/分镜模型服务</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  modelRequestRef.current?.abort();
                  setFetchingModels(false);
                  setLlmProvider('deepseek');
                }}
                className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${llmProvider === 'deepseek' ? 'border-violet-500 bg-violet-500/10' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}
              >
                <div className="text-sm font-medium text-gray-100">DeepSeek 官方</div>
                <div className="mt-1 text-xs font-semibold text-violet-300">使用 DeepSeek API</div>
              </button>
              <button
                type="button"
                onClick={() => {
                  modelRequestRef.current?.abort();
                  setFetchingModels(false);
                  setLlmProvider('openai_compat');
                }}
                className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${llmProvider === 'openai_compat' ? 'border-sky-500 bg-sky-500/10' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}
              >
                <div className="text-sm font-medium text-gray-100">OpenAI 兼容中转</div>
                <div className="mt-1 text-xs font-semibold text-sky-300">自定义 Base URL + Model</div>
              </button>
            </div>

            {openaiFields && (
              <div className="space-y-3 rounded-lg border border-gray-800 bg-gray-900/60 p-3">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-300">已保存的中转配置</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={activeOpenaiProfileId}
                      onChange={(e) => selectOpenAIProfile(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-sky-500"
                    >
                      <option value="">新建中转配置</option>
                      {openaiProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>{profile.baseUrl}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleDeleteOpenAIProfile}
                      disabled={!activeOpenaiProfileId}
                      className="shrink-0 rounded-lg border border-gray-700 p-2 text-gray-400 hover:border-rose-700 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-40"
                      title="删除当前中转配置"
                      aria-label="删除当前中转配置"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-500">点击底部“保存”会记录当前 URL、Key 和模型，下次可直接切换。</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-300">Base URL</label>
                  <input
                    type="text"
                    value={openaiBaseUrl}
                    onChange={(e) => {
                      setOpenaiBaseUrl(e.target.value);
                      setModelList([]);
                      setModelError('');
                    }}
                    placeholder="https://api.openai.com 或中转地址"
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-sky-500 placeholder-gray-600"
                  />
                  <p className="text-[11px] text-gray-500">填写支持 OpenAI chat/completions 接口的中转地址，会自动补全 /v1。</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-300">API Key</label>
                  <SecretInput
                    value={openaiApiKey}
                    onChange={(value) => {
                      setOpenaiApiKey(value);
                      setModelList([]);
                      setModelError('');
                    }}
                    placeholder="sk-..."
                    className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-sky-500"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-gray-300">Model</label>
                    {modelList.length > 0 && (
                      <span className="text-[11px] text-gray-500">共 {modelList.length} 个模型</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={modelList.includes(openaiModel) ? openaiModel : ''}
                      onChange={(e) => setOpenaiModel(e.target.value)}
                      disabled={fetchingModels || modelList.length === 0}
                      className="min-w-0 flex-1 appearance-none rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-sky-500 disabled:opacity-50"
                    >
                      {modelList.length === 0 && !fetchingModels ? (
                        <option value="">请先填写 Base URL 和 API Key，再点击拉取</option>
                      ) : (
                        modelList.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))
                      )}
                    </select>
                    <button
                      type="button"
                      onClick={handleFetchModels}
                      disabled={fetchingModels || !openaiBaseUrl.trim() || !openaiApiKey.trim()}
                      className="shrink-0 rounded-lg border border-sky-700 px-3 py-2 text-xs font-medium text-sky-300 hover:border-sky-500 hover:text-sky-200 disabled:cursor-not-allowed disabled:border-gray-800 disabled:text-gray-600"
                    >
                      {fetchingModels ? '拉取中...' : '拉取'}
                    </button>
                  </div>
                  {modelError && <p className="text-[11px] text-red-400">{modelError}</p>}
                  <p className="text-[11px] text-gray-500">填写 Base URL 和 API Key 后，点击右侧按钮从 /models 端点拉取模型。</p>
                </div>
              </div>
            )}
          </div>
          </>
          )}

          {settingsTab === 'image' && (
          <div className="space-y-3">
            <label className="text-xs font-medium text-gray-300">图片生成服务</label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setImageProvider('newapi')}
                className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${imageProvider === 'newapi' ? 'border-emerald-500 bg-emerald-500/10' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}
              >
                <div className="text-sm font-medium text-gray-100">省钱生图</div>
                <div className="mt-1 text-xs font-semibold text-emerald-300">1 分一张 · 不支持垫图</div>
              </button>
              <button
                type="button"
                onClick={() => setImageProvider('image2')}
                className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${imageProvider === 'image2' ? 'border-amber-500 bg-amber-500/10' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}
              >
                <div className="text-sm font-medium text-gray-100">Image2</div>
                <div className="mt-1 text-xs font-semibold text-amber-300">5 分一张 · 支持垫图</div>
              </button>
              <button
                type="button"
                onClick={() => setImageProvider('ai98pro')}
                className={`min-w-0 rounded-lg border p-3 text-left transition-colors ${imageProvider === 'ai98pro' ? 'border-sky-500 bg-sky-500/10' : 'border-gray-800 bg-gray-900 hover:border-gray-700'}`}
              >
                <div className="text-sm font-medium text-gray-100">AI98Pro</div>
                <div className="mt-1 text-xs font-semibold text-sky-300">gpt-image-2 · 支持垫图</div>
              </button>
            </div>

            {imageProvider === 'newapi' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-gray-300">省钱生图 API Key</label>
                  <a href={NEWAPI_SIGNUP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:text-emerald-200">
                    注册 / 充值 <ExternalLink size={12} />
                  </a>
                </div>
                <SecretInput value={newapiApiKey} onChange={setNewapiApiKey} placeholder="填入省钱生图 API Key" className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-emerald-500" />
                <p className="text-xs leading-relaxed text-gray-500">使用 vidu-image-gpt2。选择该服务时，已上传的垫图会保留，但生成请求会自动取消使用垫图。</p>
              </div>
            ) : imageProvider === 'ai98pro' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-gray-300">AI98Pro API Key</label>
                  <span className="text-xs text-sky-300">ai98pro.xyz</span>
                </div>
                <SecretInput value={ai98proApiKey} onChange={setAi98proApiKey} placeholder="Enter AI98Pro API Key" className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-sky-500" />
                <p className="text-xs leading-relaxed text-gray-500">Uses gpt-image-2 via AI98Pro; uploaded reference images are sent through /v1/images/edits.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-medium text-gray-300">Image2 API Key</label>
                  <a href={IMAGE2_CONSOLE_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-amber-300 hover:text-amber-200">
                    充值链接 <ExternalLink size={12} />
                  </a>
                </div>
                <SecretInput value={image2ApiKey} onChange={setImage2ApiKey} placeholder="填入 Image2 API Key" className="w-full rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-amber-500" />
                <p className="text-xs text-gray-500">支持单张和多张垫图，用于保持角色外貌一致性。</p>
              </div>
            )}
          </div>
          )}
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
  const { deepseek, image, provider } = useApiKeyConfigured();
  const llmSettings = getApiKeySettings();
  const llmLabel = llmSettings.llmProvider === 'openai_compat' ? 'OpenAI中转' : 'DeepSeek';
  const status: 'ok' | 'partial' | 'none' =
    deepseek && image ? 'ok' : deepseek || image ? 'partial' : 'none';
  const dotColor =
    status === 'ok' ? 'bg-emerald-400' : status === 'partial' ? 'bg-amber-400' : 'bg-rose-500';
  const providerName = provider === 'newapi' ? '省钱生图' : 'Image2';
  const tipText =
    status === 'ok'
      ? `已配置 ${llmLabel} + ${providerName} API Key`
      : status === 'partial'
      ? `仅配置了 ${deepseek ? llmLabel : providerName}`
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
      <footer className="h-14 w-full max-w-full overflow-hidden border-t border-gray-800 flex items-center justify-center gap-2 md:gap-4 shrink-0 bg-gray-950/80 backdrop-blur-sm px-2">
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

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto overscroll-x-contain px-1 text-xs text-gray-600 md:flex-none md:overflow-visible">
          {chapters.map((chapter, i) => (
            <button
              key={chapter.id}
              onClick={() => setCurrentIdx(i)}
              aria-label={`跳转到第 ${chapter.chapter_number} 话`}
              className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
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
