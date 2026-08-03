import type { ChatMessage } from '../types';
import { sanitizeWhatsAppText } from '../lib/formatText';

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function ChatBubble({ message }: { message: ChatMessage }) {
  const isAgent = message.role === 'agent';

  return (
    <div
      data-role={message.role}
      className={`wa-bubble-in flex ${isAgent ? 'justify-end' : 'justify-start'} px-3`}
    >
      <div
        className={[
          'relative max-w-[78%] rounded-lg px-2.5 py-1.5 text-[14.5px] leading-[1.35] shadow-sm',
          isAgent ? 'bg-[#d9fdd3] text-[#111b21] rounded-tr-none' : 'bg-white text-[#111b21] rounded-tl-none',
        ].join(' ')}
      >
        <span
          aria-hidden
          className={[
            'absolute top-0 w-2.5 h-2.5',
            isAgent
              ? 'right-[-6px] bg-[#d9fdd3] [clip-path:polygon(0_0,0%_100%,100%_0)]'
              : 'left-[-6px] bg-white [clip-path:polygon(100%_0,0_0,100%_100%)]',
          ].join(' ')}
        />
        <p className="whitespace-pre-wrap break-words">{sanitizeWhatsAppText(message.text)}</p>
        <span className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-[#667781] select-none">
          {formatTime(message.timestamp)}
          {isAgent && (
            <svg viewBox="0 0 16 11" width="14" height="10" className="fill-[#53bdeb] shrink-0">
              <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-2.405-2.272a.463.463 0 0 0-.325-.126.472.472 0 0 0-.338.145l-.334.35a.5.5 0 0 0 .011.707l2.905 2.75a.6.6 0 0 0 .398.16.62.62 0 0 0 .49-.237l6.652-8.22a.499.499 0 0 0-.06-.646z" />
              <path d="M15.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-6.19 7.636-.788-.744-.749.928.98.927a.6.6 0 0 0 .398.16.62.62 0 0 0 .49-.237l6.652-8.22a.499.499 0 0 0-.06-.646z" />
            </svg>
          )}
        </span>
      </div>
    </div>
  );
}

/** Agent bubble for text still streaming in — same shell as ChatBubble but
 * no timestamp/read-receipt yet since the message isn't "sent" until it's
 * done generating. */
export function StreamingBubble({ text }: { text: string }) {
  return (
    <div data-role="agent" data-streaming="true" className="wa-bubble-in flex justify-end px-3">
      <div className="relative max-w-[78%] rounded-lg rounded-tr-none bg-[#d9fdd3] px-2.5 py-1.5 text-[14.5px] leading-[1.35] text-[#111b21] shadow-sm">
        <span
          aria-hidden
          className="absolute right-[-6px] top-0 h-2.5 w-2.5 bg-[#d9fdd3] [clip-path:polygon(0_0,0%_100%,100%_0)]"
        />
        <p className="whitespace-pre-wrap break-words">
          {sanitizeWhatsAppText(text)}
          <span className="stream-cursor ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-[#111b21]" />
        </p>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div data-typing="true" className="wa-bubble-in flex justify-end px-3">
      <div className="relative flex items-center gap-1 rounded-lg rounded-tr-none bg-[#d9fdd3] px-3 py-2.5 shadow-sm">
        <span
          aria-hidden
          className="absolute right-[-6px] top-0 h-2.5 w-2.5 bg-[#d9fdd3] [clip-path:polygon(0_0,0%_100%,100%_0)]"
        />
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="typing-dot h-1.5 w-1.5 rounded-full bg-[#8fa88a]"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>
    </div>
  );
}
