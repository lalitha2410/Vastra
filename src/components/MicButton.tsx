import type { CallStatus } from '../types';

interface MicButtonProps {
  status: CallStatus | 'listening';
  disabled: boolean;
  accent: string;
  onClick: () => void;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
      <path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z" />
      <path d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.93V20H9a1 1 0 1 0 0 2h6a1 1 0 1 0 0-2h-2v-2.07A7 7 0 0 0 19 11z" />
    </svg>
  );
}

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="typing-dot h-2 w-2 rounded-full bg-white"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

function SpeakingWaves() {
  return (
    <div className="flex items-end gap-[3px]" style={{ height: 26 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="wave-bar w-[3px] rounded-full bg-white" style={{ animationDelay: `${i * 0.11}s` }} />
      ))}
    </div>
  );
}

/**
 * The single interaction point for voice input. Visual state is driven
 * entirely by `status` — callers compose it from SpeechRecognition's
 * isListening plus the agent hook's callStatus (thinking/speaking), see
 * CallPanel.tsx, so this component stays a dumb state->visual mapping.
 */
export function MicButton({ status, disabled, accent, onClick }: MicButtonProps) {
  const isListening = status === 'listening';
  const isThinking = status === 'thinking';
  const isSpeaking = status === 'speaking';

  const label =
    status === 'listening'
      ? 'Listening…'
      : status === 'thinking'
        ? 'Thinking…'
        : status === 'speaking'
          ? 'Speaking…'
          : 'Tap to speak';

  return (
    <div className="flex flex-col items-center gap-2.5">
      <div className="relative flex h-[92px] w-[92px] items-center justify-center">
        {isListening && (
          <>
            <span className="mic-pulse-ring" style={{ borderColor: accent, animationDelay: '0s' }} />
            <span className="mic-pulse-ring" style={{ borderColor: accent, animationDelay: '0.6s' }} />
          </>
        )}
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className="relative z-10 flex h-[76px] w-[76px] items-center justify-center rounded-full text-white shadow-md transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          style={{
            backgroundColor: isListening ? '#B4231F' : accent,
          }}
        >
          {isThinking ? <ThinkingDots /> : isSpeaking ? <SpeakingWaves /> : <MicIcon />}
        </button>
      </div>
      <p className="text-[12px] font-medium text-[#4b5563]">{label}</p>
    </div>
  );
}
