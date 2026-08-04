import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import { getBrandById, vastraBrand } from '../config/brand';
import type { CallStatus, Channel, ChatMessage, ReturnTicket, TicketStatus, TranscriptEntry } from '../types';
import {
  getActiveProvider,
  hasApiKey,
  sendAgentMessage,
  type ChatSession,
  type ToolExecutorMap,
} from '../lib/llmProvider';
import {
  createReturnTicketTool,
  getAvailableSizesTool,
  getPickupSlotsTool,
  lookupOrder,
  checkReturnEligibilityTool,
  type CreateReturnTicketInput,
} from '../lib/tools';
import { buildSystemInstruction } from '../lib/systemPrompt';
import { buildVoiceSystemInstruction } from '../lib/voiceSystemPrompt';
import { useSpeechSynthesis } from './useSpeechSynthesis';

/**
 * ONE agent layer, TWO channels. Everything in the "shared" section below —
 * tickets, the ticket ID sequence, and (most importantly) buildExecutors —
 * is used by both the WhatsApp chat flow and the voice call flow. There is
 * exactly one createReturnTicket implementation, closing over the same
 * `tickets` state and the same duplicate-booking guard (see tools.ts),
 * regardless of which channel's LLM turn called it. That's what makes
 * "switch channel mid-demo, tickets persist" true structurally, not just
 * true by coincidence: there's only one ops backend to persist.
 *
 * What's genuinely separate per channel: each has its own conversation
 * transcript, its own ChatSession (so its own system prompt — see
 * lib/systemPrompt.ts vs lib/voiceSystemPrompt.ts), and its own
 * typing/tool-activity/streaming UI state, because a WhatsApp exchange and
 * a phone call are two independent conversations with the model, not one
 * conversation rendered two ways. Switching the `channel` view is a pure
 * UI toggle — it never touches either conversation's state.
 */

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Human-readable ops-console labels for each tool, shown live as the agent
// calls them — this is what turns the ~10-25s the model spends thinking
// into a visible systems walkthrough instead of dead air. Shared by both
// channels' activity banners.
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  lookupOrder: 'Looking up order…',
  checkReturnEligibility: 'Checking return eligibility…',
  getAvailableSizes: 'Fetching available sizes…',
  getPickupSlots: 'Fetching pickup slots…',
  createReturnTicket: 'Creating return ticket…',
};

const CHAT_THINKING_LABEL = 'Reading customer message…';
const VOICE_THINKING_LABEL = 'Listening to customer…';

function chatGreetingFor(brand: BrandConfig): string {
  if (brand.id === 'vastra') {
    return `Hi! I'm ${brand.agentName} from ${brand.name} 👋 I can help with a return or exchange on a recent order — what's going on?`;
  }
  return `Hello, I'm ${brand.agentName} from ${brand.name}. I can help with a return or exchange on a recent order. How can I help you today?`;
}

function callGreetingFor(brand: BrandConfig): string {
  return `Hi, this is ${brand.agentName} from ${brand.name}. I can help with a return or exchange on a recent order — what's going on?`;
}

function newSession(systemInstruction: string): ChatSession {
  return { messages: [{ role: 'system', content: systemInstruction }] };
}

// Compressed, demo-friendly timeline so the ops dashboard visibly finishes
// its pipeline during a live call instead of sitting at "Pickup Scheduled".
const PROGRESSION: { status: TicketStatus; delayMs: number }[] = [
  { status: 'Approved', delayMs: 1200 },
  { status: 'Pickup Scheduled', delayMs: 2600 },
  { status: 'In Transit', delayMs: 7000 },
  { status: 'Refunded', delayMs: 12000 },
];

export interface Stats {
  returnsToday: number;
  exchangeCount: number;
  refundCount: number;
  valueRetained: number;
}

function isQuotaError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return raw.includes('429') || lower.includes('quota') || lower.includes('rate limit');
}

export function useReturnAgent() {
  const [brand, setBrandState] = useState<BrandConfig>(vastraBrand);
  const [channel, setChannel] = useState<Channel>('whatsapp');

  const brandRef = useRef(brand);
  useEffect(() => {
    brandRef.current = brand;
  }, [brand]);

  const apiKeyMissing = !hasApiKey();

  // ---------------------------------------------------------------------
  // SHARED: one ticket backend, one tool-executor layer, used by both
  // channels' sendAgentMessage calls.
  // ---------------------------------------------------------------------
  const [tickets, setTickets] = useState<ReturnTicket[]>([]);
  const ticketSeqRef = useRef(0);
  const ticketsRef = useRef<ReturnTicket[]>([]);
  useEffect(() => {
    ticketsRef.current = tickets;
  }, [tickets]);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const updateTicketStatus = useCallback((ticketId: string, status: TicketStatus) => {
    setTickets((prev) => prev.map((t) => (t.ticketId === ticketId ? { ...t, status } : t)));
  }, []);

  const scheduleProgression = useCallback(
    (ticketId: string) => {
      for (const step of PROGRESSION) {
        const handle = setTimeout(() => updateTicketStatus(ticketId, step.status), step.delayMs);
        timeoutsRef.current.push(handle);
      }
    },
    [updateTicketStatus],
  );

  const clearAllTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((h) => clearTimeout(h));
    timeoutsRef.current = [];
  }, []);

  // Executors run inside an async tool-call loop (see sendAgentMessage), so
  // they need the *current* ticket list at call time for the duplicate-
  // booking guard, not whatever was in scope when this closure was built —
  // a plain `tickets` dependency would also mean a new executor map (and a
  // new sendAgentMessage identity) on every ticket update mid-conversation.
  const buildExecutors = useCallback(
    (currentBrand: BrandConfig): ToolExecutorMap => ({
      lookupOrder: (args) => lookupOrder(currentBrand.catalog, String(args.orderIdOrPhone ?? '')),
      checkReturnEligibility: (args) =>
        checkReturnEligibilityTool(currentBrand.catalog, String(args.orderId ?? ''), String(args.itemId ?? '')),
      getAvailableSizes: (args) =>
        getAvailableSizesTool(currentBrand.catalog, String(args.orderId ?? ''), String(args.itemId ?? '')),
      getPickupSlots: () => getPickupSlotsTool(),
      createReturnTicket: (args) => {
        const input = args as unknown as CreateReturnTicketInput;
        const result = createReturnTicketTool(
          currentBrand.catalog,
          input,
          ticketSeqRef.current + 1,
          ticketsRef.current,
        );
        if (result.alreadyBooked) {
          return { success: false, alreadyBooked: true, ticket: result.ticket, error: result.error };
        }
        if (result.found && result.ticket) {
          ticketSeqRef.current += 1;
          setTickets((prev) => [result.ticket as ReturnTicket, ...prev]);
          scheduleProgression(result.ticket.ticketId);
          return { success: true, ticket: result.ticket };
        }
        return { success: false, error: result.error };
      },
    }),
    [scheduleProgression],
  );

  const stats: Stats = useMemo(() => {
    const today = new Date();
    const isToday = (ms: number) => {
      const d = new Date(ms);
      return (
        d.getFullYear() === today.getFullYear() &&
        d.getMonth() === today.getMonth() &&
        d.getDate() === today.getDate()
      );
    };
    const returnsToday = tickets.filter((t) => isToday(t.createdAt)).length;
    const exchangeCount = tickets.filter((t) => t.resolution === 'exchange').length;
    const refundCount = tickets.filter((t) => t.resolution === 'refund').length;
    const valueRetained = tickets
      .filter((t) => t.resolution === 'exchange')
      .reduce((sum, t) => sum + t.itemPrice, 0);
    return { returnsToday, exchangeCount, refundCount, valueRetained };
  }, [tickets]);

  // ---------------------------------------------------------------------
  // WhatsApp channel — own transcript, own session, own system prompt.
  // ---------------------------------------------------------------------
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { id: uid(), role: 'agent', text: chatGreetingFor(vastraBrand), timestamp: Date.now() },
  ]);
  const [chatIsTyping, setChatIsTyping] = useState(false);
  const [chatToolActivity, setChatToolActivity] = useState<string | null>(null);
  const [chatStreamingText, setChatStreamingText] = useState('');
  const chatSessionRef = useRef<ChatSession | null>(null);

  if (!chatSessionRef.current && !apiKeyMissing) {
    chatSessionRef.current = newSession(buildSystemInstruction(brand));
  }

  const sendChatMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || apiKeyMissing || !chatSessionRef.current) return;

      setChatMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed, timestamp: Date.now() }]);
      setChatIsTyping(true);
      setChatToolActivity(CHAT_THINKING_LABEL);
      setChatStreamingText('');
      try {
        const executors = buildExecutors(brandRef.current);
        const reply = await sendAgentMessage(
          chatSessionRef.current,
          trimmed,
          executors,
          (name) => setChatToolActivity(TOOL_ACTIVITY_LABELS[name] ?? name),
          (textSoFar) => setChatStreamingText(textSoFar),
        );
        setChatMessages((prev) => [...prev, { id: uid(), role: 'agent', text: reply, timestamp: Date.now() }]);
      } catch (err) {
        const providerName = getActiveProvider().name;
        console.error(`${providerName} request failed`, err);
        const raw = err instanceof Error ? err.message : String(err);
        const errorText = isQuotaError(raw)
          ? "This demo is briefly rate-limited — it clears in about a minute. Hit Reset and try again shortly."
          : "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment.";
        setChatMessages((prev) => [...prev, { id: uid(), role: 'agent', text: errorText, timestamp: Date.now() }]);
      } finally {
        setChatIsTyping(false);
        setChatToolActivity(null);
        setChatStreamingText('');
      }
    },
    [apiKeyMissing, buildExecutors],
  );

  // ---------------------------------------------------------------------
  // Voice channel — own transcript, own session, own system prompt, plus
  // call lifecycle (start/end/duration) and speech synthesis.
  // ---------------------------------------------------------------------
  const [callMessages, setCallMessages] = useState<TranscriptEntry[]>([]);
  const [callActive, setCallActive] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [isProcessingVoice, setIsProcessingVoice] = useState(false);
  const [voiceToolActivity, setVoiceToolActivity] = useState<string | null>(null);
  const [voiceStreamingText, setVoiceStreamingText] = useState('');
  const voiceSessionRef = useRef<ChatSession | null>(null);
  const callStartRef = useRef<number | null>(null);

  const tts = useSpeechSynthesis(brand.voice);

  useEffect(() => {
    if (!callActive) return;
    const id = setInterval(() => {
      if (callStartRef.current) {
        setCallSeconds(Math.floor((Date.now() - callStartRef.current) / 1000));
      }
    }, 1000);
    return () => clearInterval(id);
  }, [callActive]);

  const speakAgentLine = useCallback(
    (text: string) => {
      if (!callActive) return;
      tts.speak(text);
    },
    [callActive, tts],
  );

  const startCall = useCallback(() => {
    callStartRef.current = Date.now();
    setCallSeconds(0);
    setCallActive(true);
    setVoiceToolActivity(null);
    setVoiceStreamingText('');
    setIsProcessingVoice(false);
    if (!apiKeyMissing) {
      voiceSessionRef.current = newSession(buildVoiceSystemInstruction(brandRef.current));
    }
    const greetingText = callGreetingFor(brandRef.current);
    setCallMessages([{ id: uid(), role: 'agent', text: greetingText, timestamp: Date.now() }]);
    tts.speak(greetingText);
  }, [apiKeyMissing, tts]);

  const endCall = useCallback(() => {
    tts.cancel();
    callStartRef.current = null;
    setCallActive(false);
  }, [tts]);

  const sendVoiceMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || apiKeyMissing || !voiceSessionRef.current || !callActive) return;

      setCallMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed, timestamp: Date.now() }]);
      setIsProcessingVoice(true);
      setVoiceToolActivity(VOICE_THINKING_LABEL);
      setVoiceStreamingText('');
      try {
        const executors = buildExecutors(brandRef.current);
        const reply = await sendAgentMessage(
          voiceSessionRef.current,
          trimmed,
          executors,
          (name) => setVoiceToolActivity(TOOL_ACTIVITY_LABELS[name] ?? name),
          (textSoFar) => setVoiceStreamingText(textSoFar),
        );
        setCallMessages((prev) => [...prev, { id: uid(), role: 'agent', text: reply, timestamp: Date.now() }]);
        speakAgentLine(reply);
      } catch (err) {
        const providerName = getActiveProvider().name;
        console.error(`${providerName} request failed`, err);
        const raw = err instanceof Error ? err.message : String(err);
        const errorText = isQuotaError(raw)
          ? "This demo is briefly rate-limited — it clears in about a minute. Try again shortly."
          : "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment.";
        setCallMessages((prev) => [...prev, { id: uid(), role: 'agent', text: errorText, timestamp: Date.now() }]);
        speakAgentLine(errorText);
      } finally {
        setIsProcessingVoice(false);
        setVoiceToolActivity(null);
        setVoiceStreamingText('');
      }
    },
    [apiKeyMissing, buildExecutors, callActive, speakAgentLine],
  );

  const callStatus: CallStatus = tts.isSpeaking ? 'speaking' : isProcessingVoice ? 'thinking' : 'idle';

  // ---------------------------------------------------------------------
  // Cross-channel: reset and brand switch. Both are full resets (clear
  // tickets, both transcripts, both sessions) — switching the `channel`
  // view is the ONLY operation that touches neither.
  // ---------------------------------------------------------------------
  const resetAllFor = useCallback(
    (nextBrand: BrandConfig) => {
      clearAllTimeouts();
      ticketSeqRef.current = 0;
      setTickets([]);

      setChatMessages([{ id: uid(), role: 'agent', text: chatGreetingFor(nextBrand), timestamp: Date.now() }]);
      setChatToolActivity(null);
      setChatStreamingText('');
      setChatIsTyping(false);
      chatSessionRef.current = apiKeyMissing ? null : newSession(buildSystemInstruction(nextBrand));

      tts.cancel();
      callStartRef.current = null;
      setCallActive(false);
      setCallSeconds(0);
      setCallMessages([]);
      setVoiceToolActivity(null);
      setVoiceStreamingText('');
      setIsProcessingVoice(false);
      voiceSessionRef.current = null;
    },
    [apiKeyMissing, clearAllTimeouts, tts],
  );

  const setBrand = useCallback(
    (id: string) => {
      const next = getBrandById(id);
      setBrandState(next);
      resetAllFor(next);
    },
    [resetAllFor],
  );

  const reset = useCallback(() => {
    resetAllFor(brandRef.current);
  }, [resetAllFor]);

  return {
    brand,
    setBrand,
    channel,
    setChannel,
    tickets,
    stats,
    apiKeyMissing,
    reset,
    chat: {
      messages: chatMessages,
      isTyping: chatIsTyping,
      toolActivity: chatToolActivity,
      streamingText: chatStreamingText,
      sendMessage: sendChatMessage,
    },
    voice: {
      messages: callMessages,
      callActive,
      callSeconds,
      callStatus,
      toolActivity: voiceToolActivity,
      streamingText: voiceStreamingText,
      voiceLabel: tts.voiceLabel,
      ttsSupported: tts.isSupported,
      sendMessage: sendVoiceMessage,
      startCall,
      endCall,
    },
  };
}
