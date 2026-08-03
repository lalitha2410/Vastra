import type { BrandConfig } from '../config/brand';
import { buildSystemInstruction } from './systemPrompt';

/**
 * The ONLY module in the app that knows which LLM vendor is behind the
 * agent. `useReturnAgent.ts` (state), `tools.ts` (executors) and
 * `policy.ts` (eligibility rules) never import from here directly except
 * for the exports below — swapping vendors again later means rewriting
 * this one file, not touching the hook, the tools, or the UI.
 *
 * Currently: OpenRouter's OpenAI-compatible /chat/completions endpoint,
 * streaming, model `openai/gpt-oss-20b:free`. Picked because it's one of
 * the few OpenRouter free-tier models whose `supported_parameters` list
 * includes `tools`/`tool_choice` (most free models don't support function
 * calling at all).
 *
 * The paid `openai/gpt-oss-20b` (no `:free` suffix) is meaningfully faster
 * (~1.2s vs ~6.8s mean per call, no 12-14s queuing spikes — see README) but
 * is NOT the default: it's served by a different upstream provider
 * (DeepInfra vs. the free tier's Darkbloom), and a 4-trial probe of the
 * exact same opening turn found it dropped mid-tool-chain 3 times out of
 * 4 — narrating "let me check the sizes, one moment…" without actually
 * calling getAvailableSizes, leaving the conversation stalled until the
 * customer says something. The free variant chained correctly in every
 * run across two full test passes. Speed regressed reliability here, and
 * reliable tool chaining is the entire pitch — see README "Design
 * decisions" before switching this.
 */

export const OPENROUTER_MODEL = 'openai/gpt-oss-20b:free';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

export function getApiKey(): string | undefined {
  return import.meta.env.VITE_OPENROUTER_API_KEY;
}

export function hasApiKey(): boolean {
  const key = getApiKey();
  return Boolean(key && key.trim().length > 0);
}

// --- OpenAI-style tool declarations (OpenRouter's chat completions API is
// OpenAI-compatible, so tools are described the same way regardless of
// which underlying model answers). ---

interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
}

interface ToolDeclaration {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
}

const toolDeclarations: ToolDeclaration[] = [
  {
    type: 'function',
    function: {
      name: 'lookupOrder',
      description:
        "Look up an order by its order ID, or by a phone number to list that customer's recent orders.",
      parameters: {
        type: 'object',
        properties: {
          orderIdOrPhone: {
            type: 'string',
            description: 'The order ID (e.g. "VS1004") or a phone number the customer gave.',
          },
        },
        required: ['orderIdOrPhone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'checkReturnEligibility',
      description:
        'Deterministically check whether a specific item on an order is eligible for return/exchange (return window + final-sale rules). Always call this before discussing eligibility.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order ID, e.g. "VS1004".' },
          itemId: { type: 'string', description: 'The item ID within that order, e.g. "VS1004-1".' },
        },
        required: ['orderId', 'itemId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getAvailableSizes',
      description: 'Get the sizes currently in stock for an item, used to offer an exchange for size issues.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order ID.' },
          itemId: { type: 'string', description: 'The item ID within that order.' },
        },
        required: ['orderId', 'itemId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'getPickupSlots',
      description: 'Get the 3 available pickup slots over the next few days for scheduling a return pickup.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'createReturnTicket',
      description:
        'Create the return ticket once eligibility is confirmed, a reason and resolution are chosen, and a pickup slot is picked. Drives the ops dashboard.',
      parameters: {
        type: 'object',
        properties: {
          orderId: { type: 'string', description: 'The order ID.' },
          itemId: { type: 'string', description: 'The item ID within that order.' },
          reason: {
            type: 'string',
            enum: ['size', 'quality', 'not_as_described', 'changed_mind'],
            description: 'Why the customer wants to return/exchange this item.',
          },
          resolution: {
            type: 'string',
            enum: ['exchange', 'refund'],
            description: "exchange for a size swap, refund otherwise.",
          },
          slotId: { type: 'string', description: 'The chosen pickup slot ID, e.g. "slot-1".' },
          exchangeSize: {
            type: 'string',
            description: 'The new size chosen, only when resolution is "exchange".',
          },
        },
        required: ['orderId', 'itemId', 'reason', 'resolution', 'slotId'],
      },
    },
  },
];

export type ToolExecutor = (args: Record<string, unknown>) => unknown;
export type ToolExecutorMap = Record<string, ToolExecutor>;

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Stateless REST APIs need the caller to resend the whole transcript each
 * turn (unlike Gemini's stateful ChatSession) — this is just that
 * transcript, held for the lifetime of one conversation.
 */
export interface ChatSession {
  messages: OpenRouterMessage[];
}

export function startAgentChat(brand: BrandConfig): ChatSession {
  return { messages: [{ role: 'system', content: buildSystemInstruction(brand) }] };
}

interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
}

/**
 * Streams one chat completion, invoking `onTextDelta` with the
 * accumulated visible text as tokens arrive (never with reasoning tokens —
 * those are dropped so the model's internal chain-of-thought never leaks
 * into the chat). Tool-call argument fragments are accumulated by index
 * per OpenAI's streaming tool-call format and returned whole at the end,
 * since a tool can only be executed once its full arguments are known.
 *
 * `reasoning: { effort: 'low' }` trades reasoning depth for latency —
 * this agent only needs to pick the right tool and phrase a short reply,
 * not solve hard problems, so low effort is enough and meaningfully
 * faster (measured ~85% fewer reasoning tokens per call vs. default).
 */
async function streamChatCompletion(
  messages: OpenRouterMessage[],
  onTextDelta?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey() ?? ''}`,
      'Content-Type': 'application/json',
      'X-Title': 'Returns Agent WhatsApp Demo',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      tools: toolDeclarations,
      tool_choice: 'auto',
      reasoning: { effort: 'low' },
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`OpenRouter request failed: ${res.status} ${res.statusText} ${body}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCallsByIndex = new Map<number, { id: string; name: string; arguments: string }>();

  streamLoop: while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue; // skip SSE comments/keepalives
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') break streamLoop;

      let chunk: { choices?: { delta?: Record<string, unknown> }[] };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = chunk?.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === 'string' && delta.content.length > 0) {
        content += delta.content;
        onTextDelta?.(content);
      }

      const deltaToolCalls = delta.tool_calls as
        | { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        | undefined;
      if (Array.isArray(deltaToolCalls)) {
        for (const tc of deltaToolCalls) {
          const idx = tc.index ?? 0;
          const existing = toolCallsByIndex.get(idx) ?? { id: '', name: '', arguments: '' };
          if (tc.id) existing.id = tc.id;
          if (tc.function?.name) existing.name += tc.function.name;
          if (tc.function?.arguments) existing.arguments += tc.function.arguments;
          toolCallsByIndex.set(idx, existing);
        }
      }
    }
  }

  const toolCalls: ToolCall[] = Array.from(toolCallsByIndex.values())
    .filter((t) => t.name)
    .map((t) => ({ id: t.id, type: 'function' as const, function: { name: t.name, arguments: t.arguments } }));

  return { content, toolCalls };
}

/**
 * Sends a user message, running the function-calling loop until the model
 * returns plain text. `executors` maps tool name -> implementation; each
 * executor is expected to read/mutate app state (which drives the ops
 * dashboard) and return JSON-serializable data for the model to read back.
 * `onTextDelta` streams the final reply into the UI as it's generated.
 */
export async function sendAgentMessage(
  chat: ChatSession,
  message: string,
  executors: ToolExecutorMap,
  onToolCall?: (name: string, args: Record<string, unknown>, result: unknown) => void,
  onTextDelta?: (textSoFar: string) => void,
): Promise<string> {
  chat.messages.push({ role: 'user', content: message });

  let guard = 0;
  while (guard < 6) {
    guard += 1;
    const { content, toolCalls } = await streamChatCompletion(chat.messages, onTextDelta);

    if (toolCalls.length > 0) {
      chat.messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });

      for (const call of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }
        const executor = executors[call.function.name];
        const output = executor ? executor(args) : { error: 'Unknown tool' };
        onToolCall?.(call.function.name, args, output);
        chat.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(output),
        });
      }
      continue;
    }

    chat.messages.push({ role: 'assistant', content });
    return content;
  }

  return "Sorry, I'm having trouble completing that — could you try again?";
}
