import type { BrandConfig } from '../config/brand';
import { buildSystemInstruction } from './systemPrompt';

/**
 * The ONLY module in the app that knows which LLM vendor is behind the
 * agent. `useReturnAgent.ts` (state), `tools.ts` (executors) and
 * `policy.ts` (eligibility rules) never import from here directly except
 * for the exports below — swapping vendors, or adding a second one, means
 * rewriting this one file, not touching the hook, the tools, or the UI.
 *
 * Two providers, both OpenAI-compatible chat-completions APIs, switched
 * via VITE_LLM_PROVIDER=groq|openrouter (default groq):
 *
 * - Groq (`openai/gpt-oss-20b`) — added as a second provider after
 *   OpenRouter's free tier hit its 50-request/day account-level cap
 *   mid-testing. Deliberately the SAME model weights already validated
 *   on OpenRouter (see below), just on Groq's hosting, to keep the one
 *   variable that matters — tool-chaining reliability — as controlled as
 *   possible when switching infrastructure. Groq's LPU inference is also
 *   materially faster, which happens to help the latency problem too.
 *
 * - OpenRouter (`openai/gpt-oss-20b:free`) — the original provider.
 *   Picked because it's one of the few OpenRouter free-tier models whose
 *   `supported_parameters` list includes `tools`/`tool_choice` (most free
 *   models don't support function calling at all). The paid, no-`:free`
 *   variant is faster but is NOT used — see README "Design decisions":
 *   it's served by a different upstream provider and a 4-trial probe
 *   found it dropped mid-tool-chain 3 times out of 4. Reliable tool
 *   chaining outranks speed here.
 */

type LlmProviderName = 'groq' | 'openrouter';

interface ProviderSpec {
  url: string;
  model: string;
  apiKey: string | undefined;
  headers: Record<string, string>;
  /** Same idea on both providers — trade reasoning depth for latency,
   * since this agent only needs to pick the right tool and phrase a short
   * reply — but the two APIs spell it differently: OpenRouter wants a
   * nested `reasoning` object, Groq (following OpenAI's own gpt-oss param
   * naming directly) wants a flat `reasoning_effort` string. */
  reasoningParam: Record<string, unknown>;
}

function getProviderName(): LlmProviderName {
  const raw = (import.meta.env.VITE_LLM_PROVIDER ?? '').trim().toLowerCase();
  return raw === 'openrouter' ? 'openrouter' : 'groq';
}

function getProviderSpec(): ProviderSpec {
  const provider = getProviderName();
  if (provider === 'openrouter') {
    const key = import.meta.env.VITE_OPENROUTER_API_KEY;
    return {
      url: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'openai/gpt-oss-20b:free',
      apiKey: key,
      headers: {
        Authorization: `Bearer ${key ?? ''}`,
        'Content-Type': 'application/json',
        'X-Title': 'Returns Agent WhatsApp Demo',
      },
      reasoningParam: { reasoning: { effort: 'low' } },
    };
  }
  const key = import.meta.env.VITE_GROQ_API_KEY;
  return {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-20b',
    apiKey: key,
    headers: {
      Authorization: `Bearer ${key ?? ''}`,
      'Content-Type': 'application/json',
    },
    reasoningParam: { reasoning_effort: 'low' },
  };
}

export function getApiKey(): string | undefined {
  return getProviderSpec().apiKey;
}

export function hasApiKey(): boolean {
  const key = getApiKey();
  return Boolean(key && key.trim().length > 0);
}

/** Display-only info about whichever provider is active, so the UI (missing-key
 * screen, chat placeholder, error text) never hardcodes a vendor name — it asks
 * this module, same as everything else that needs to know which vendor is live. */
export interface ProviderDisplayInfo {
  name: string;
  keyUrl: string;
  envVarName: string;
}

const PROVIDER_DISPLAY: Record<LlmProviderName, ProviderDisplayInfo> = {
  groq: {
    name: 'Groq',
    keyUrl: 'https://console.groq.com/keys',
    envVarName: 'VITE_GROQ_API_KEY',
  },
  openrouter: {
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    envVarName: 'VITE_OPENROUTER_API_KEY',
  },
};

export function getActiveProvider(): ProviderDisplayInfo {
  return PROVIDER_DISPLAY[getProviderName()];
}

// --- OpenAI-style tool declarations (both providers' chat completions
// APIs are OpenAI-compatible, so tools are described the same way
// regardless of which one answers). ---

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

interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

/**
 * Stateless REST APIs need the caller to resend the whole transcript each
 * turn (unlike Gemini's stateful ChatSession, from before this app's
 * first provider migration) — this is just that transcript, held for the
 * lifetime of one conversation.
 */
export interface ChatSession {
  messages: ChatCompletionMessage[];
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
 * The SSE format itself is identical across both providers (both are
 * OpenAI-compatible), so only request construction is provider-specific.
 */
async function streamChatCompletion(
  messages: ChatCompletionMessage[],
  onTextDelta?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const spec = getProviderSpec();
  const res = await fetch(spec.url, {
    method: 'POST',
    headers: spec.headers,
    body: JSON.stringify({
      model: spec.model,
      messages,
      tools: toolDeclarations,
      tool_choice: 'auto',
      stream: true,
      ...spec.reasoningParam,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`${getProviderName()} request failed: ${res.status} ${res.statusText} ${body}`);
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
