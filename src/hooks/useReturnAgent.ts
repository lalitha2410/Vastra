import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrandConfig } from '../config/brand';
import { getBrandById, vastraBrand } from '../config/brand';
import type { ChatMessage, ReturnTicket, TicketStatus } from '../types';
import {
  hasApiKey,
  sendAgentMessage,
  startAgentChat,
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

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Human-readable ops-console labels for each tool, shown live as the agent
// calls them — this is what turns the ~10-25s the model spends thinking
// into a visible systems walkthrough instead of dead air.
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  lookupOrder: 'Looking up order…',
  checkReturnEligibility: 'Checking return eligibility…',
  getAvailableSizes: 'Fetching available sizes…',
  getPickupSlots: 'Fetching pickup slots…',
  createReturnTicket: 'Creating return ticket…',
};

const THINKING_LABEL = 'Reading customer message…';

function greetingFor(brand: BrandConfig): string {
  if (brand.id === 'vastra') {
    return `Hi! I'm ${brand.agentName} from ${brand.name} 👋 I can help with a return or exchange on a recent order — what's going on?`;
  }
  return `Hello, I'm ${brand.agentName} from ${brand.name}. I can help with a return or exchange on a recent order. How can I help you today?`;
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

export function useReturnAgent() {
  const [brand, setBrandState] = useState<BrandConfig>(vastraBrand);
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: uid(), role: 'agent', text: greetingFor(vastraBrand), timestamp: Date.now() },
  ]);
  const [tickets, setTickets] = useState<ReturnTicket[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');

  const brandRef = useRef(brand);
  const chatRef = useRef<ChatSession | null>(null);
  const ticketSeqRef = useRef(0);
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const apiKeyMissing = !hasApiKey();

  useEffect(() => {
    brandRef.current = brand;
  }, [brand]);

  if (!chatRef.current && !apiKeyMissing) {
    chatRef.current = startAgentChat(brand);
  }

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

  const buildExecutors = useCallback(
    (currentBrand: BrandConfig): ToolExecutorMap => ({
      lookupOrder: (args) => lookupOrder(currentBrand.catalog, String(args.orderIdOrPhone ?? '')),
      checkReturnEligibility: (args) =>
        checkReturnEligibilityTool(currentBrand.catalog, String(args.orderId ?? ''), String(args.itemId ?? '')),
      getAvailableSizes: (args) =>
        getAvailableSizesTool(currentBrand.catalog, String(args.orderId ?? ''), String(args.itemId ?? '')),
      getPickupSlots: () => getPickupSlotsTool(),
      createReturnTicket: (args) => {
        ticketSeqRef.current += 1;
        const input = args as unknown as CreateReturnTicketInput;
        const result = createReturnTicketTool(currentBrand.catalog, input, ticketSeqRef.current);
        if (result.found && result.ticket) {
          setTickets((prev) => [result.ticket as ReturnTicket, ...prev]);
          scheduleProgression(result.ticket.ticketId);
          return { success: true, ticket: result.ticket };
        }
        ticketSeqRef.current -= 1;
        return { success: false, error: result.error };
      },
    }),
    [scheduleProgression],
  );

  const clearAllTimeouts = useCallback(() => {
    timeoutsRef.current.forEach((h) => clearTimeout(h));
    timeoutsRef.current = [];
  }, []);

  const resetConversation = useCallback(
    (nextBrand: BrandConfig) => {
      clearAllTimeouts();
      ticketSeqRef.current = 0;
      setTickets([]);
      setMessages([{ id: uid(), role: 'agent', text: greetingFor(nextBrand), timestamp: Date.now() }]);
      setToolActivity(null);
      setStreamingText('');
      setIsTyping(false);
      if (!apiKeyMissing) {
        chatRef.current = startAgentChat(nextBrand);
      }
    },
    [apiKeyMissing, clearAllTimeouts],
  );

  const setBrand = useCallback(
    (id: string) => {
      const next = getBrandById(id);
      setBrandState(next);
      resetConversation(next);
    },
    [resetConversation],
  );

  const reset = useCallback(() => {
    resetConversation(brandRef.current);
  }, [resetConversation]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || apiKeyMissing || !chatRef.current) return;

      setMessages((prev) => [...prev, { id: uid(), role: 'user', text: trimmed, timestamp: Date.now() }]);
      setIsTyping(true);
      setToolActivity(THINKING_LABEL);
      setStreamingText('');
      try {
        const executors = buildExecutors(brandRef.current);
        const reply = await sendAgentMessage(
          chatRef.current,
          trimmed,
          executors,
          (name) => {
            setToolActivity(TOOL_ACTIVITY_LABELS[name] ?? name);
          },
          (textSoFar) => {
            setStreamingText(textSoFar);
          },
        );
        setMessages((prev) => [...prev, { id: uid(), role: 'agent', text: reply, timestamp: Date.now() }]);
      } catch (err) {
        console.error('OpenRouter request failed', err);
        const raw = err instanceof Error ? err.message : String(err);
        const lower = raw.toLowerCase();
        const isQuota = raw.includes('429') || lower.includes('quota') || lower.includes('rate limit');
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'agent',
            text: isQuota
              ? "Sorry, the assistant's API rate limit has been hit right now, so I can't respond. (Check the OpenRouter key's rate limits/credits.)"
              : "Sorry, I'm having trouble reaching the assistant right now. Please try again in a moment.",
            timestamp: Date.now(),
          },
        ]);
      } finally {
        setIsTyping(false);
        setToolActivity(null);
        setStreamingText('');
      }
    },
    [apiKeyMissing, buildExecutors],
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

  return {
    brand,
    setBrand,
    messages,
    tickets,
    isTyping,
    toolActivity,
    streamingText,
    apiKeyMissing,
    stats,
    sendMessage,
    reset,
  };
}
