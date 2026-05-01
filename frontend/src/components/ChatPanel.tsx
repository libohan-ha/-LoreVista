import { useEffect, useRef, useState } from 'react';
import { Send, Image, Square } from 'lucide-react';
import { chatStream, type Chapter } from '../api';

interface Props {
  chapter: Chapter | null;
  onMessageSent?: () => void;
  onChapterRefresh?: (chapterId: number) => void;
  onGoToManga?: () => void;
}

export default function ChatPanel({ chapter, onMessageSent, onChapterRefresh, onGoToManga }: Props) {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamingChapterIdRef = useRef<number | null>(null);
  const userScrolledUp = useRef(false);

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  useEffect(() => {
    // Abort any in-progress stream when switching chapters
    if (abortRef.current) {
      const abortedChapterId = streamingChapterIdRef.current;
      abortRef.current.abort();
      abortRef.current = null;
      if (abortedChapterId !== null) {
        window.setTimeout(() => onChapterRefresh?.(abortedChapterId), 500);
      }
    }
    streamingChapterIdRef.current = null;
    if (chapter) {
      setMessages(chapter.messages.map((m) => ({ role: m.role, content: m.content })));
    } else {
      setMessages([]);
    }
    setStreamContent('');
    setStreaming(false);
  }, [chapter?.id]);

  // Auto-scroll only if user hasn't scrolled up.
  // Use instant scroll during streaming to avoid animation fighting with user scroll.
  useEffect(() => {
    if (!userScrolledUp.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: streaming ? 'instant' : 'smooth' });
    }
  }, [messages, streamContent]);

  // Reset scroll lock when user sends a new message
  useEffect(() => {
    userScrolledUp.current = false;
  }, [messages.length]);

  // Detect manual scroll
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      userScrolledUp.current = !atBottom;
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSend = () => {
    if (!input.trim() || !chapter || streaming) return;
    const userMsg = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setStreaming(true);
    setStreamContent('');

    let accumulated = '';
    streamingChapterIdRef.current = chapter.id;
    abortRef.current = chatStream(
      chapter.id,
      userMsg.content,
      (token) => {
        accumulated += token;
        setStreamContent(accumulated);
      },
      (fullContent) => {
        abortRef.current = null;
        streamingChapterIdRef.current = null;
        setMessages((prev) => [...prev, { role: 'assistant', content: fullContent }]);
        setStreamContent('');
        setStreaming(false);
        onMessageSent?.();
      },
      (err) => {
        abortRef.current = null;
        streamingChapterIdRef.current = null;
        setMessages((prev) => [...prev, { role: 'assistant', content: `错误: ${err}` }]);
        setStreamContent('');
        setStreaming(false);
      },
    );
  };

  const handleAbort = () => {
    const abortedChapterId = streamingChapterIdRef.current;
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    streamingChapterIdRef.current = null;
    if (streamContent) {
      setMessages((prev) => [...prev, { role: 'assistant', content: streamContent + '\n\n[已中止]' }]);
    }
    setStreamContent('');
    setStreaming(false);
    window.setTimeout(() => {
      if (abortedChapterId !== null) {
        onChapterRefresh?.(abortedChapterId);
      } else {
        onMessageSent?.();
      }
    }, 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="px-5 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-200 tracking-wide uppercase">
          第 {chapter?.chapter_number ?? '–'} 话 · 对话
        </h2>
      </div>

      {/* Messages */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex items-center justify-center h-full text-gray-600 text-sm">
            开始和 AI 讨论你的小说创意吧…
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-violet-600 text-white rounded-br-md'
                  : 'bg-gray-800 text-gray-200 rounded-bl-md'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {streaming && !streamContent && (
          <div className="flex justify-start">
            <div className="flex items-center gap-3 px-4 py-3 rounded-2xl rounded-bl-md bg-gray-800">
              <svg className="w-5 h-5 animate-spin text-violet-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-gray-400">AI 思考中…</span>
            </div>
          </div>
        )}
        {streaming && streamContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-gray-800 text-gray-200 text-sm leading-relaxed whitespace-pre-wrap">
              {streamContent}
              <span className="inline-block w-1.5 h-4 ml-0.5 bg-violet-400 animate-pulse rounded-sm" />
            </div>
          </div>
        )}
        {/* Mobile: Go to manga button */}
        {onGoToManga && messages.length > 0 && !streaming && (
          <div className="flex justify-center py-3">
            <button
              onClick={onGoToManga}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg
                         bg-amber-600/20 hover:bg-amber-600/30 text-amber-400 border border-amber-700/50
                         transition-colors"
            >
              <Image size={14} />
              查看漫画 / 生成分镜
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-800">
        <div className="flex items-end gap-2 bg-gray-900 rounded-xl px-3 py-2 border border-gray-800 focus-within:border-violet-600 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize(e.target);
            }}
            onKeyDown={handleKeyDown}
            placeholder="描述你的小说想法…"
            rows={1}
            className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-600 resize-none outline-none"
            style={{ maxHeight: '160px', overflow: 'auto' }}
          />
          {streaming ? (
            <button
              onClick={handleAbort}
              className="p-2 rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors shrink-0"
              title="停止生成"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-30
                         disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
