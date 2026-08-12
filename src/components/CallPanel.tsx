import { useEffect, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import type { CallStatus, TranscriptEntry } from '../types';
import { getScenarios, type Scenario } from '../data/scenarios';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { MicButton } from './MicButton';

interface CallPanelProps {
  brand: BrandConfig;
  messages: TranscriptEntry[];
  streamingText: string;
  callActive: boolean;
  callSeconds: number;
  callStatus: CallStatus;
  voiceLabel: string;
  ttsSupported: boolean;
  apiKeyMissing: boolean;
  onSend: (text: string) => void;
  onPlayScenario: (scenario: Scenario) => void;
  onStartCall: () => void;
  onEndCall: () => void;
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function PhoneOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M21.7 19.3 2.7 2.3a1 1 0 0 0-1.4 1.4l2.13 2.13c-.28.5-.31 1.1-.06 1.65a17.5 17.5 0 0 0 3.7 5.2 17.5 17.5 0 0 0 5.2 3.7c.55.25 1.15.22 1.65-.06l2.13 2.13a1 1 0 0 0 1.4-1.4zm-3.4-2.44-1.3-1.3a1.6 1.6 0 0 0-1.7-.36 12.3 12.3 0 0 1-2.06-.98L11 12.9a12.3 12.3 0 0 1-.98-2.06 1.6 1.6 0 0 0-.36-1.7l-1.3-1.3-1.42-1.42c1.02-.5 2.16-.42 2.98.4l2.02 2.02a1.6 1.6 0 0 1 .36 1.7 1 1 0 0 0 .23 1.05l2.58 2.58a1 1 0 0 0 1.05.23 1.6 1.6 0 0 1 1.7.36l2.02 2.02a2.3 2.3 0 0 1 .4 2.98z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
      <path d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.24.2 2.45.57 3.57a1 1 0 0 1-.25 1.02z" />
    </svg>
  );
}

export function CallPanel({
  brand,
  messages,
  streamingText,
  callActive,
  callSeconds,
  callStatus,
  voiceLabel,
  ttsSupported,
  apiKeyMissing,
  onSend,
  onPlayScenario,
  onStartCall,
  onEndCall,
}: CallPanelProps) {
  const [draft, setDraft] = useState('');
  const [liveCaption, setLiveCaption] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const speechRec = useSpeechRecognition({
    lang: 'en-IN',
    onInterimResult: setLiveCaption,
    onFinalResult: (text) => {
      setLiveCaption('');
      submit(text);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streamingText, liveCaption]);

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || apiKeyMissing || !callActive) return;
    onSend(trimmed);
    setDraft('');
  }

  const scenarios = getScenarios(brand.id);
  const busy = callStatus !== 'idle';
  const micDisabled = !speechRec.isSupported || apiKeyMissing || !callActive || busy;

  function handleMicClick() {
    if (speechRec.isListening) {
      speechRec.stop();
    } else {
      setLiveCaption('');
      speechRec.start();
    }
  }

  const displayStatus: CallStatus | 'listening' = speechRec.isListening ? 'listening' : callStatus;

  const statusText = !callActive
    ? 'Not connected'
    : displayStatus === 'listening'
      ? 'Listening…'
      : displayStatus === 'thinking'
        ? `${brand.agentName} is thinking…`
        : displayStatus === 'speaking'
          ? `${brand.agentName} is speaking…`
          : 'Connected · your turn';

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#1c1410] text-[#f5efe9]">
      {/* Call header */}
      <div className="flex flex-col items-center gap-1.5 border-b border-white/10 px-4 pb-4 pt-6">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-full text-xl font-semibold text-white shadow-lg"
          style={{ backgroundColor: brand.colors.primary }}
        >
          {brand.agentName.charAt(0)}
        </div>
        <p className="text-[15px] font-semibold">
          {brand.agentName} · {brand.name} Returns Line
        </p>
        <p className="text-[12px] text-white/60">{brand.supportNumber}</p>
        <p className="mt-1 text-[13px] font-medium" style={{ color: callActive ? '#8FE3A5' : 'rgba(255,255,255,0.5)' }}>
          {callActive ? `Connected · ${formatDuration(callSeconds)}` : 'Not connected'}
        </p>
        <p className="text-[11px] text-white/40">{statusText}</p>
      </div>

      {!callActive ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-[13px] text-white/60">
            Tap below to place a call to {brand.name}'s returns line. {brand.agentName} will answer and greet you.
          </p>
          <button
            type="button"
            onClick={onStartCall}
            disabled={apiKeyMissing}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-[#3BA55D] text-white shadow-lg transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Start call"
          >
            <PhoneIcon />
          </button>
          <p className="text-[11px] text-white/40">Start Call</p>
          {!ttsSupported && (
            <p className="mt-2 max-w-xs text-[11px] text-amber-300">
              This browser doesn't support speech synthesis — replies will still appear as text.
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Live captions, not chat bubbles */}
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="flex min-h-full flex-col justify-end gap-3">
              {messages.map((m) => (
                <div key={m.id} data-role={m.role} className={m.role === 'user' ? 'text-right' : 'text-left'}>
                  <p
                    className="text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: m.role === 'user' ? '#E8B98A' : 'rgba(255,255,255,0.45)' }}
                  >
                    {m.role === 'user' ? 'You' : brand.agentName}
                  </p>
                  <p className="text-[15px] leading-snug text-[#f5efe9]">{m.text}</p>
                </div>
              ))}
              {callStatus === 'thinking' && streamingText && (
                <div className="text-left">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-white/45">{brand.agentName}</p>
                  <p className="text-[15px] leading-snug text-[#f5efe9]">
                    {streamingText}
                    <span className="stream-cursor ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] bg-[#f5efe9]" />
                  </p>
                </div>
              )}
              {liveCaption && (
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[#E8B98A]">You</p>
                  <p className="text-[15px] italic leading-snug text-white/70">{liveCaption}</p>
                </div>
              )}
            </div>
          </div>

          {/* Mic + controls */}
          <div className="flex flex-col items-center gap-3 border-t border-white/10 px-4 py-4">
            {!speechRec.isSupported && (
              <p className="max-w-xs text-center text-[11px] text-amber-300">
                Speech recognition isn't supported in this browser (Chrome or Edge required). Use the text box below
                to talk to {brand.agentName} instead.
              </p>
            )}
            {speechRec.permission === 'denied' && (
              <p className="max-w-xs text-center text-[11px] text-amber-300">
                Microphone access was denied. Allow it in your browser's site settings, or keep using the text box
                below.
              </p>
            )}
            {speechRec.error && speechRec.permission !== 'denied' && (
              <p className="max-w-xs text-center text-[11px] text-white/50">{speechRec.error}</p>
            )}

            {speechRec.isSupported && (
              <MicButton status={displayStatus} disabled={micDisabled} accent={brand.colors.primary} onClick={handleMicClick} />
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit(draft);
              }}
              className="flex w-full items-center gap-2"
            >
              <input
                type="text"
                value={draft}
                disabled={busy || apiKeyMissing}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Or type what you'd say…"
                className="flex-1 rounded-full border border-white/15 bg-white/10 px-3.5 py-2 text-sm text-white outline-none placeholder:text-white/40 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={busy || apiKeyMissing || !draft.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white disabled:opacity-40"
                style={{ backgroundColor: brand.colors.primary }}
                aria-label="Send"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                  <path d="M2.01 21 23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </form>

            <div className="flex flex-wrap justify-center gap-1.5 pt-1">
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={busy || apiKeyMissing}
                  onClick={() => onPlayScenario(s)}
                  className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-white/80 hover:bg-white/10 disabled:opacity-40"
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-3 pt-1">
              <p className="text-[10px] text-white/35">Voice: {voiceLabel}</p>
              <button
                type="button"
                onClick={onEndCall}
                className="flex items-center gap-1.5 rounded-full bg-[#B4231F] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-[#981D19]"
              >
                <PhoneOffIcon />
                End call
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
