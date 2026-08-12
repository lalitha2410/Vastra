import { useEffect, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import type { ChatMessage } from '../types';
import { getScenarios, type Scenario } from '../data/scenarios';
import { getActiveProvider } from '../lib/llmProvider';
import { ChatBubble, StreamingBubble, TypingIndicator } from './ChatBubble';

/**
 * WhatsApp Business verified-badge convention — on WhatsApp Business the
 * customer is messaging the BRAND's account, so the thread header shows
 * the business name with a scalloped verified seal (see e.g. LimeChat's
 * own demos, which show "Mahindra Auto ✓", or the classic Twitter/Meta
 * verified badge this shape borrows from), never the agent's name or a
 * paraphrase like "Riya · Vastra Returns". Blue rather than the brand's
 * own accent deliberately: this needs to read as "a genuine WhatsApp
 * Business badge," not a custom brand touch.
 *
 * The scalloped outline (not a plain circle) is what actually reads as
 * "verified seal" rather than just "blue dot" — three 14×14 rounded
 * squares layered 30° apart give 12 evenly-spaced points, the same
 * overlapping-square construction real verified badges use.
 */
function VerifiedBadge() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" className="shrink-0" aria-label="Verified business account">
      <g fill="#55ACEE">
        <rect x="3" y="3" width="14" height="14" rx="4" />
        <rect x="3" y="3" width="14" height="14" rx="4" transform="rotate(30 10 10)" />
        <rect x="3" y="3" width="14" height="14" rx="4" transform="rotate(60 10 10)" />
      </g>
      <path d="M6.2 10.3 8.7 12.8 13.8 7.5" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface ChatPanelProps {
  brand: BrandConfig;
  messages: ChatMessage[];
  isTyping: boolean;
  streamingText: string;
  disabled: boolean;
  onSend: (text: string) => void;
  onPlayScenario: (scenario: Scenario) => void;
}

export function ChatPanel({ brand, messages, isTyping, streamingText, disabled, onSend, onPlayScenario }: ChatPanelProps) {
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
          {brand.logoMark}
        </div>
        {/* This is the customer's view of a WhatsApp Business thread —
            they're messaging the BRAND's account, so the header identifies
            the business, not the agent handling this particular chat. */}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1">
            <p className="truncate text-[14.5px] font-medium leading-tight text-[#111b21]">{brand.name}</p>
            <VerifiedBadge />
          </div>
          <p className="truncate text-[12px] leading-tight text-[#667781]">{isTyping ? 'typing…' : 'Business account'}</p>
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
                  disabled={disabled || isTyping}
                  onClick={() => {
                    setScenarioOpen(false);
                    onPlayScenario(s);
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
