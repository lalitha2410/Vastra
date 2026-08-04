import { useCallback, useEffect, useRef, useState } from 'react';

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export type MicPermission = 'unknown' | 'granted' | 'denied';

interface UseSpeechRecognitionOptions {
  lang?: string;
  onFinalResult: (text: string) => void;
  onInterimResult?: (text: string) => void;
}

interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  permission: MicPermission;
  error: string | null;
  start: () => void;
  stop: () => void;
}

/**
 * Wraps SpeechRecognition (Chrome/Edge only — see README) as one-shot
 * capture: start() begins listening, the browser auto-stops on a silence
 * gap, the final transcript fires onFinalResult, done. A fresh
 * SpeechRecognition instance is created per start() rather than reused —
 * Chrome's implementation is unreliable about firing a second `result`
 * after `stop()`/`onend` on the same instance, so a new one each turn
 * avoids that class of bug entirely.
 */
export function useSpeechRecognition({
  lang = 'en-IN',
  onFinalResult,
  onInterimResult,
}: UseSpeechRecognitionOptions): UseSpeechRecognitionReturn {
  const Ctor = getRecognitionCtor();
  const [isListening, setIsListening] = useState(false);
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTextRef = useRef('');

  const onFinalResultRef = useRef(onFinalResult);
  const onInterimResultRef = useRef(onInterimResult);
  useEffect(() => {
    onFinalResultRef.current = onFinalResult;
    onInterimResultRef.current = onInterimResult;
  }, [onFinalResult, onInterimResult]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (!Ctor) return;
    setError(null);
    finalTextRef.current = '';

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event) => {
      setPermission('granted');
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) {
          finalTextRef.current += transcript;
        } else {
          interim += transcript;
        }
      }
      onInterimResultRef.current?.((finalTextRef.current + ' ' + interim).trim());
    };

    recognition.onerror = (event) => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        setPermission('denied');
        setError('Microphone access was denied.');
      } else if (event.error === 'no-speech') {
        setError("Didn't catch that — try again.");
      } else if (event.error === 'aborted') {
        // user-initiated stop() — not an error worth surfacing
      } else {
        setError(`Speech recognition error: ${event.error}`);
      }
    };

    recognition.onend = () => {
      setIsListening(false);
      const finalText = finalTextRef.current.trim();
      if (finalText) {
        onFinalResultRef.current(finalText);
      }
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setIsListening(false);
    }
  }, [Ctor, lang]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  return { isSupported: Ctor !== null, isListening, permission, error, start, stop };
}
