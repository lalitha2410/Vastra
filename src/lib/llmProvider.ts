import type { BrandConfig } from '../config/brand';
import { buildSystemInstruction } from './systemPrompt';

/**
 * The ONLY module in the app that knows which LLM vendor(s) are behind the
 * agent. `useReturnAgent.ts` (state), `tools.ts` (executors) and
 * `policy.ts` (eligibility rules) never import from here directly except
 * for the exports below — swapping vendors, or adding another one, means
 * rewriting this one file, not touching the hook, the tools, or the UI.
 *
 * Three providers, all OpenAI-compatible chat-completions APIs, tried
 * automatically in a fixed fallback order on a rate-limit/quota error —
 * see PROVIDER_ORDER and streamChatCompletion. Any provider with no API
 * key configured is skipped entirely (see getConfiguredProviders); this
 * only exists so a recruiter's live demo session doesn't die the moment
 * one free-tier daily cap is hit:
 *
 * - Groq (`openai/gpt-oss-20b`) — tried first. The fastest of the three
 *   (LPU inference) and the most extensively validated against this app's
 *   system prompt.
 *
 * - Cerebras (`gpt-oss-120b`) — tried second. Same gpt-oss family as the
 *   other two (OpenAI's own open-weight models), just the larger 120b
 *   variant — Cerebras's smaller/preview-tier models weren't confirmed to
 *   support tool calling in their docs, and tool calling here is
 *   non-negotiable, so this was the one model in their production catalog
 *   both documented as supporting it (with worked tool-calling examples)
 *   and not flagged for near-term deprecation.
 *
 * - OpenRouter (`openai/gpt-oss-20b:free`) — tried last. The original
 *   provider, kept as the final fallback. Picked originally because it's
 *   one of the few OpenRouter free-tier models whose `supported_parameters`
 *   list includes `tools`/`tool_choice` (most free models don't support
 *   function calling at all). The paid, no-`:free` variant is faster but is
 *   NOT used — see README "Design decisions": it's served by a different
 *   upstream provider and a 4-trial probe found it dropped mid-tool-chain 3
 *   times out of 4. Reliable tool chaining outranks speed here.
 */

type LlmProviderName = 'groq' | 'cerebras' | 'openrouter';

/** Fixed fallback order — not user-configurable (there's no more
 * VITE_LLM_PROVIDER switch; every configured provider is tried
 * automatically, in this order, per request). */
const PROVIDER_ORDER: LlmProviderName[] = ['groq', 'cerebras', 'openrouter'];

interface ProviderSpec {
  name: LlmProviderName;
  url: string;
  model: string;
  apiKey: string | undefined;
  headers: Record<string, string>;
  /** Same idea on all three providers — trade reasoning depth for latency,
   * since this agent only needs to pick the right tool and phrase a short
   * reply — but they spell it differently: OpenRouter wants a nested
   * `reasoning` object; Groq and Cerebras (both following OpenAI's own
   * gpt-oss param naming directly) want a flat `reasoning_effort` string. */
  reasoningParam: Record<string, unknown>;
}

function buildProviderSpec(name: LlmProviderName): ProviderSpec {
  if (name === 'cerebras') {
    const key = import.meta.env.VITE_CEREBRAS_API_KEY;
    return {
      name,
      url: 'https://api.cerebras.ai/v1/chat/completions',
      model: 'gpt-oss-120b',
      apiKey: key,
      headers: {
        Authorization: `Bearer ${key ?? ''}`,
        'Content-Type': 'application/json',
      },
      reasoningParam: { reasoning_effort: 'low' },
    };
  }
  if (name === 'openrouter') {
    const key = import.meta.env.VITE_OPENROUTER_API_KEY;
    return {
      name,
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
    name,
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

/** Providers with a configured, non-empty API key, in fallback order.
 * Empty means no provider is usable at all — see hasApiKey/ApiKeyNotice. */
function getConfiguredProviders(): ProviderSpec[] {
  return PROVIDER_ORDER.map(buildProviderSpec).filter((p) => Boolean(p.apiKey && p.apiKey.trim().length > 0));
}

export function hasApiKey(): boolean {
  return getConfiguredProviders().length > 0;
}

/** Display-only info about a provider, so the UI (missing-key screen, chat
 * placeholder) never hardcodes a vendor name — it asks this module, same
 * as everything else that needs to know which vendor is live. Only ever
 * rendered when hasApiKey() is false (no provider configured at all), so
 * this always points at the first provider in fallback order — asking for
 * a Groq key is the right default prompt in that state. */
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
  cerebras: {
    name: 'Cerebras',
    keyUrl: 'https://console.cerebras.ai',
    envVarName: 'VITE_CEREBRAS_API_KEY',
  },
  openrouter: {
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    envVarName: 'VITE_OPENROUTER_API_KEY',
  },
};

export function getActiveProvider(): ProviderDisplayInfo {
  return PROVIDER_DISPLAY[PROVIDER_ORDER[0]];
}

/**
 * Logs which providers are usable exactly once, at module load (so it's
 * always the first thing a fresh console shows, before any request is
 * made) — added specifically to debug "fallback isn't triggering in
 * production" reports, where the actual cause is almost always an env var
 * that never made it into the deploy's build environment (Vite inlines
 * `VITE_*` vars at *build* time — see README "Deploying to Vercel" — so a
 * key added to `.env` locally or to a Vercel project *after* the last
 * build simply isn't in the bundle, with no error to point at it). Never
 * logs a key's value, only whether one was found, so this is safe to
 * leave on in a public demo's console.
 */
function logProviderConfigAtStartup(): void {
  const lines = PROVIDER_ORDER.map((name) => {
    const spec = buildProviderSpec(name);
    const envVarName = PROVIDER_DISPLAY[name].envVarName;
    const found = Boolean(spec.apiKey && spec.apiKey.trim().length > 0);
    return `  ${found ? '✓' : '✗'} ${name} (${envVarName}): ${found ? 'configured' : 'MISSING — this provider will be skipped'}`;
  });
  const configured = getConfiguredProviders();
  console.log(
    `[llmProvider] startup provider check —\n${lines.join('\n')}\nFallback order for this session: ${
      configured.length > 0
        ? configured.map((p) => p.name).join(' -> ')
        : '(none — hasApiKey() is false, ApiKeyNotice will show)'
    }`,
  );
}
logProviderConfigAtStartup();

// --- OpenAI-style tool declarations (all three providers' chat completions
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
  {
    type: 'function',
    function: {
      name: 'sendBankDetailsLink',
      description:
        "Send a secure link for the customer to enter their bank details, for a COD refund ONLY (never for Prepaid or for an exchange — those need no bank details and this tool will refuse). Call this BEFORE ever telling the customer a link has been sent — never claim a link was sent without calling this first. Safe to call again if asked 'where is the link' later; it will not send a duplicate.",
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'The return ticket ID just created, e.g. "RET-1001".' },
        },
        required: ['ticketId'],
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
 * Stateless REST APIs need the caller to resend context each turn (unlike
 * Gemini's stateful ChatSession, from before this app's first provider
 * migration) — this is the complete local record of one conversation,
 * held for its lifetime. It is NOT what gets sent on the wire, though:
 * see buildRequestMessages, which sends a bounded recent-message window
 * plus a summary instead of resending this whole array every round trip.
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

/** How many non-system messages to send verbatim — enough to cover the
 * customer's most recent answer plus the immediately preceding tool round
 * trip, everything older is represented by the caller's summary instead. */
const RECENT_MESSAGE_WINDOW = 6;

/**
 * Builds what actually gets sent over the wire: the system prompt, an
 * optional one-line recap of facts established earlier in the
 * conversation, then only the most recent messages — not the full,
 * ever-growing `chat.messages` array. `chat.messages` itself is untouched
 * by this (still a complete local record); only the per-request payload
 * is bounded, which is what the token/rate-limit budget actually cares
 * about.
 *
 * The cutoff always lands on a `user` message boundary, never mid-way
 * through a tool-call/tool-response pair — slicing at an arbitrary index
 * could send an orphaned `tool` message with no matching preceding
 * `assistant` tool_calls, which every OpenAI-compatible API rejects.
 * Each turn's tool round trip is fully contained between one `user`
 * message and the next, so walking forward from the naive cutoff to the
 * next `user` message is always safe and never discards more than
 * necessary.
 *
 * The summary is deliberately opaque here — this module has no idea what
 * "order ID" or "reason" mean, and shouldn't (see the file-level comment).
 * It's just a caller-supplied string slotted in as an extra system
 * message; the returns-domain logic that builds it lives entirely in
 * useReturnAgent.ts.
 */
function buildRequestMessages(fullHistory: ChatCompletionMessage[], contextSummary?: string): ChatCompletionMessage[] {
  const [systemMsg, ...rest] = fullHistory;
  let cutoff = Math.max(0, rest.length - RECENT_MESSAGE_WINDOW);
  while (cutoff < rest.length && rest[cutoff].role !== 'user') cutoff += 1;
  const recent = rest.slice(cutoff);

  if (!contextSummary) return [systemMsg, ...recent];
  const summaryMsg: ChatCompletionMessage = {
    role: 'system',
    content: `Context established earlier in this conversation (do not re-ask for these): ${contextSummary}`,
  };
  return [systemMsg, summaryMsg, ...recent];
}

/** Matches the same rate-limit/quota wording useReturnAgent.ts's own
 * isQuotaError checks for — this is the ONLY error class that triggers
 * automatic provider fallback (see streamChatCompletion). Anything else
 * (bad request, auth failure, network error) surfaces immediately instead
 * of being silently retried on a different vendor, so a real bug doesn't
 * masquerade as "it just worked eventually." */
function isRateLimitOrQuotaError(message: string): boolean {
  const lower = message.toLowerCase();
  return message.includes('429') || lower.includes('quota') || lower.includes('rate limit');
}

/** Index into getConfiguredProviders() to try first. Starts at 0 (highest-
 * priority configured provider) and only ever moves forward: these are
 * daily caps, so once a provider rate-limits there's no point re-trying it
 * on the very next request for the rest of the session — this just
 * remembers "skip straight to the one that's still working." Resets on
 * page reload, which is fine since the caps themselves reset daily. */
let stickyProviderIndex = 0;

/**
 * Streams one chat completion from one specific provider, invoking
 * `onTextDelta` with the accumulated visible text as tokens arrive (never
 * with reasoning tokens — those are dropped so the model's internal
 * chain-of-thought never leaks into the chat). Tool-call argument
 * fragments are accumulated by index per OpenAI's streaming tool-call
 * format and returned whole at the end, since a tool can only be executed
 * once its full arguments are known. The SSE format itself is identical
 * across all three providers (all OpenAI-compatible), so only request
 * construction is provider-specific.
 */
async function streamChatCompletionOnce(
  spec: ProviderSpec,
  messages: ChatCompletionMessage[],
  onTextDelta?: (textSoFar: string) => void,
): Promise<StreamResult> {
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
    throw new Error(`${spec.name} request failed: ${res.status} ${res.statusText} ${body}`);
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
 * Tries each configured provider in fallback order, starting from
 * `stickyProviderIndex`, advancing to the next only on a rate-limit/quota
 * error — including the "empty completion" symptom of one, checked here so
 * it participates in fallback too (see the comment below). Any other error
 * type surfaces immediately without trying further providers. Logs which
 * provider served (or failed) each request to the console, so fallback
 * behavior is visible while testing. Only once every configured provider
 * has failed does this throw — and that final error still carries "rate
 * limit" wording, so the hook's existing isQuotaError check renders the
 * same friendly message it always has.
 */
async function streamChatCompletion(
  messages: ChatCompletionMessage[],
  onTextDelta?: (textSoFar: string) => void,
): Promise<StreamResult> {
  const providers = getConfiguredProviders();
  if (providers.length === 0) {
    throw new Error('No LLM provider configured — add at least one API key (see .env.example).');
  }
  if (stickyProviderIndex >= providers.length) stickyProviderIndex = providers.length - 1;

  let lastError: unknown;
  for (let i = stickyProviderIndex; i < providers.length; i += 1) {
    const spec = providers[i];
    try {
      const result = await streamChatCompletionOnce(spec, messages, onTextDelta);

      // A completion with no tool calls AND no text is not a valid reply —
      // seen in practice as a stream that returns 200 and a normal-looking
      // SSE sequence, but gets cut off mid-generation by a per-minute
      // token cap before any content token is emitted. Nothing upstream
      // throws for this (the HTTP request genuinely succeeded), so it's
      // treated as a rate-limit symptom and falls through to the next
      // provider exactly like an explicit 429 would.
      if (!result.content.trim() && result.toolCalls.length === 0) {
        throw new Error(`${spec.name} returned an empty completion (rate limit likely truncated the stream mid-generation)`);
      }

      stickyProviderIndex = i;
      console.log(`[llmProvider] request served by ${spec.name}${i > 0 ? ' (fallback)' : ''}`);
      return result;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!isRateLimitOrQuotaError(message)) throw err;
      const next = providers[i + 1];
      console.warn(
        `[llmProvider] ${spec.name} rate-limited/quota exceeded${next ? `, falling back to ${next.name}…` : ' — no more providers configured.'}`,
        message,
      );
      stickyProviderIndex = i + 1;
    }
  }

  const triedNames = providers.map((p) => p.name).join(', ');
  const lastMessage = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`All configured providers hit their rate limit or quota (tried: ${triedNames}). Last error: ${lastMessage}`);
}

/**
 * Sends a user message, running the function-calling loop until the model
 * returns plain text. `executors` maps tool name -> implementation; each
 * executor is expected to read/mutate app state (which drives the ops
 * dashboard) and return JSON-serializable data for the model to read back.
 * `onTextDelta` streams the final reply into the UI as it's generated.
 * `contextSummary`, if given, stands in for everything older than the
 * recent-message window sent on the wire — see buildRequestMessages.
 */
export async function sendAgentMessage(
  chat: ChatSession,
  message: string,
  executors: ToolExecutorMap,
  onToolCall?: (name: string, args: Record<string, unknown>, result: unknown) => void,
  onTextDelta?: (textSoFar: string) => void,
  contextSummary?: string,
): Promise<string> {
  chat.messages.push({ role: 'user', content: message });

  let guard = 0;
  while (guard < 6) {
    guard += 1;
    const requestMessages = buildRequestMessages(chat.messages, contextSummary);
    const { content, toolCalls } = await streamChatCompletion(requestMessages, onTextDelta);

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
