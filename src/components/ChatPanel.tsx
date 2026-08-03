import { useEffect, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import type { ChatMessage } from '../types';
import { getScenarios } from '../data/scenarios';
import { getActiveProvider } from '../lib/llmProvider';
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
      <div className="flex items-center gap-2.5 bg-[#f0f2f5] px-3 py-2 shadow-sm">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white"
          style={{ backgroundColor: brand.colors.primary }}
        >
          {brand.agentName.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14.5px] font-medium leading-tight text-[#111b21]">
            {brand.agentName} · {brand.name} Returns
          </p>
          <p className="truncate text-[12px] leading-tight text-[#667781]">
            {isTyping ? 'typing…' : `${brand.waNumber} · online`}
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setScenarioOpen((o) => !o)}
            className="rounded-md border border-[#d1d7db] bg-white px-2 py-1 text-[11.5px] font-medium text-[#3b4a54] hover:bg-[#f5f6f6]"
          >
            Play scenario ▾
          </button>
          {scenarioOpen && (
            <div className="absolute right-0 z-10 mt-1 w-60 rounded-md border border-[#d1d7db] bg-white py-1 shadow-lg">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    setScenarioOpen(false);
                    submit(s.message);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-[12.5px] text-[#111b21] hover:bg-[#f5f6f6] disabled:opacity-50"
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
        className="min-h-0 flex-1 overflow-y-auto py-2"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.035) 1px, transparent 0)',
          backgroundSize: '18px 18px',
        }}
      >
        {/* min-h-full + justify-end anchors a short thread to the bottom
            of the panel, like a real WhatsApp chat on open, instead of
            pinning it to the top with empty space below. */}
        <div className="flex min-h-full flex-col justify-end gap-0.75">
          {messages.map((m) => (
            <ChatBubble key={m.id} message={m} />
          ))}
          {isTyping && (streamingText ? <StreamingBubble text={streamingText} /> : <TypingIndicator />)}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
        className="flex items-end gap-2 bg-[#f0f2f5] px-2.5 py-2"
      >
        <input
          type="text"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={disabled ? `Add a ${getActiveProvider().name} API key to start chatting` : 'Type a message'}
          className="flex-1 rounded-full border-none bg-white px-3.5 py-2 text-sm text-[#111b21] outline-none placeholder:text-[#8696a0] disabled:bg-[#e9edef]"
        />
        <button
          type="submit"
          disabled={disabled || !draft.trim()}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
          style={{ backgroundColor: brand.colors.primary }}
          aria-label="Send"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
            <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
