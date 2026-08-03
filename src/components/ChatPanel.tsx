import { useEffect, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import type { ChatMessage } from '../types';
import { getScenarios } from '../data/scenarios';
import { ChatBubble, StreamingBubble, TypingIndicator } from './ChatBubble';

interface ChatPanelProps {
  brand: BrandConfig;
  messages: ChatMessage[];
  isTyping: boolean;
  streamingText: string;
  disabled: boolean;
  onSend: (text: string) => void;
}

export function ChatPanel({ brand, messages, isTyping, streamingText, disabled, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const [scenarioOpen, setScenarioOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isTyping, streamingText]);

  const scenarios = getScenarios(brand.id);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setDraft('');
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#ece5dd]">
      <div className="flex items-center gap-3 bg-[#f0f2f5] px-4 py-2.5 shadow-sm">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold text-white"
          style={{ backgroundColor: brand.colors.primary }}
        >
          {brand.agentName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-[#111b21]">
            {brand.agentName} · {brand.name} Returns
          </p>
          <p className="truncate text-[12.5px] text-[#667781]">
            {isTyping ? 'typing…' : `${brand.waNumber} · online`}
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setScenarioOpen((o) => !o)}
            className="rounded-md border border-[#d1d7db] bg-white px-2.5 py-1.5 text-xs font-medium text-[#3b4a54] hover:bg-[#f5f6f6]"
          >
            Play scenario ▾
          </button>
          {scenarioOpen && (
            <div className="absolute right-0 z-10 mt-1 w-64 rounded-md border border-[#d1d7db] bg-white py-1 shadow-lg">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setScenarioOpen(false);
                    submit(s.message);
                  }}
                  className="block w-full px-3 py-2 text-left text-[13px] text-[#111b21] hover:bg-[#f5f6f6] disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 space-y-1.5 overflow-y-auto py-3"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.035) 1px, transparent 0)',
          backgroundSize: '18px 18px',
        }}
      >
        {messages.map((m) => (
          <ChatBubble key={m.id} message={m} />
        ))}
        {isTyping && (streamingText ? <StreamingBubble text={streamingText} /> : <TypingIndicator />)}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex items-end gap-2 bg-[#f0f2f5] px-3 py-2.5"
      >
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={disabled ? 'Add an OpenRouter API key to start chatting' : 'Type a message'}
          className="flex-1 rounded-full border-none bg-white px-4 py-2.5 text-sm text-[#111b21] outline-none placeholder:text-[#8696a0] disabled:bg-[#e9edef]"
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
          style={{ backgroundColor: brand.colors.primary }}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
            <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
