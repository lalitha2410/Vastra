import { useCallback, useEffect, useRef, useState } from 'react';
import type { VoiceSettings } from '../config/brand';
import { selectAgentVoice } from '../lib/selectVoice';
import { sanitizeSpeechText } from '../lib/sanitizeSpeechText';

interface UseSpeechSynthesisReturn {
  isSupported: boolean;
  isSpeaking: boolean;
  voiceLabel: string;
  speak: (text: string, onEnd?: () => void) => void;
  cancel: () => void;
}

/**
 * Wraps window.speechSynthesis. Voice lists load asynchronously in Chrome
 * (getVoices() returns [] until the 'voiceschanged' event fires, sometimes
 * after a real network/OS round trip) — this hook re-runs selection
 * whenever that event fires, so voiceLabel starts as a placeholder and
 * updates once, not a broken permanent empty string.
 */
export function useSpeechSynthesis(settings: VoiceSettings): UseSpeechSynthesisReturn {
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceLabel, setVoiceLabel] = useState('Loading voices…');
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (!isSupported) {
      setVoiceLabel('Speech synthesis not supported in this browser');
      return;
    }

    function refreshVoices() {
      const voices = window.speechSynthesis.getVoices();
      const selection = selectAgentVoice(voices, settings);
      voiceRef.current = selection.voice;
      setVoiceLabel(selection.label);
    }

    refreshVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoices);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
    // settings is a static brand constant — identity is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSupported]);

  const cancel = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [isSupported]);

  const speak = useCallback(
    (text: string, onEnd?: () => void) => {
      if (!isSupported) {
        onEnd?.();
        return;
      }
      const clean = sanitizeSpeechText(text);
      if (!clean) {
        onEnd?.();
        return;
      }

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      if (voiceRef.current) {
        utterance.voice = voiceRef.current;
        utterance.lang = voiceRef.current.lang;
      }
      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;

      utterance.onstart = () => setIsSpeaking(true);
      utterance.onend = () => {
        setIsSpeaking(false);
        onEnd?.();
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
        onEnd?.();
      };

      window.speechSynthesis.speak(utterance);
    },
    [isSupported, settings.rate, settings.pitch],
  );

  useEffect(() => cancel, [cancel]);

  return { isSupported, isSpeaking, voiceLabel, speak, cancel };
}
