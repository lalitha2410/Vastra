import type { BrandConfig } from '../config/brand';
import { buildSystemInstruction } from './systemPrompt';

/**
 * The ONLY module in the app that knows which LLM vendor(s) are behind the
 * agent. `useReturnAgent.ts` (state), `tools.ts` (executors) and
 * `policy.ts` (eligibility rules) never import from here directly except
 * for the exports below — swapping vendors, or adding another one, means
 * rewriting this one file, not touching the hook, the tools, or the UI.
 *
 * Three providers, tried automatically in a fixed fallback order — see
 * PROVIDER_ORDER and streamChatCompletion — all OpenAI-compatible
 * chat-completions APIs sharing one request/parsing path
 * (streamOpenAiCompletionOnce). Any provider with no API key configured is
 * skipped entirely (see getConfiguredProviders); this only exists so a
 * recruiter's live demo session doesn't die the moment one free-tier daily
 * cap is hit. Fallback triggers on BOTH a rate-limit/quota response AND a
 * network-level failure (fetch() itself throwing — CORS, DNS, connection
 * refused) — see isRetryableProviderError — since either symptom means
 * "this vendor isn't answering right now, try the next one." Anything else
 * (bad request, auth failure, a genuine bug) surfaces immediately instead
 * of being silently retried on a different vendor, so a real bug doesn't
 * masquerade as flakiness.
 *
 * - Groq (`openai/gpt-oss-20b`) — tried first. The fastest of the three
 *   (LPU inference) and the most extensively validated against this app's
 *   system prompt.
 *
 * - OpenRouter (`openai/gpt-oss-20b:free`) — tried second. The original
 *   provider. Picked originally because it's one of the few OpenRouter
 *   free-tier models whose `supported_parameters` list includes
 *   `tools`/`tool_choice` (most free models don't support function calling
 *   at all). The paid, no-`:free` variant is faster but is NOT used — see
 *   README "Design decisions": it's served by a different upstream provider
 *   and a 4-trial probe found it dropped mid-tool-chain 3 times out of 4.
 *   Reliable tool chaining outranks speed here.
 *
 * - Mistral (`mistral-small-latest`) — tried last. Mistral's docs list
 *   function calling as supported across its current general-purpose
 *   lineup (Large/Medium/Small), so Small was picked specifically because
 *   it's the cheapest/fastest model in that confirmed-supported set — this
 *   fallback tier only needs "answers reliably", not frontier reasoning.
 *
 * Two providers were tried and dropped, not just left unconfigured:
 *
 * - Cerebras (`gpt-oss-120b`) — its free tier turned out to be a
 *   time-limited $5 trial, not a renewing daily allowance; once spent, every
 *   request 402s permanently. A dead tier that's silently checked (and
 *   silently eats a fallback attempt) on every request is worse than no
 *   tier at all, so it was removed rather than left configured-but-broken.
 *
 * - Gemini (`gemini-flash-latest`) — the AQ-prefixed API key format this
 *   project's key uses hits a known Google platform issue that reports
 *   `limit: 0` regardless of actual quota, making it permanently
 *   unusable — same reasoning as Cerebras: remove it rather than pay a
 *   startup check and a fallback slot for a provider that can never answer.
 *
 * - SambaNova Cloud was also evaluated (`Meta-Llama-3.3-70B-Instruct`,
 *   meant to fill the slot originally planned for GitHub Models, retired
 *   2026-07-30) and rejected for an architectural reason, not a model or
 *   quota one: its REST API sends no `Access-Control-Allow-Origin` header
 *   at all, so every request from this app — a client-side-only SPA with no
 *   backend to proxy through — fails the CORS preflight before it even
 *   reaches SambaNova; confirmed live, not a guess (a direct
 *   browser-context `fetch()` to their `/chat/completions` throws
 *   `TypeError: Failed to fetch` with a CORS error logged to the console).
 *   No API key or model choice fixes a missing CORS header, so it was left
 *   out rather than added as a slot that can never actually serve a
 *   request. (A backend-fronted project can still use SambaNova fine — the
 *   CORS preflight only blocks a direct browser-to-SambaNova request, not a
 *   server-to-server one.)
 */

type LlmProviderName = 'groq' | 'openrouter' | 'mistral';

/** Fixed fallback order — not user-configurable (there's no more
 * VITE_LLM_PROVIDER switch; every configured provider is tried
 * automatically, in this order, per request). */
const PROVIDER_ORDER: LlmProviderName[] = ['groq', 'openrouter', 'mistral'];

interface ProviderSpec {
  name: LlmProviderName;
  url: string;
  model: string;
  apiKey: string | undefined;
  headers: Record<string, string>;
  /** Same idea on every provider here — trade reasoning depth for latency,
   * since this agent only needs to pick the right tool and phrase a short
   * reply — but not all of them spell it the same way: OpenRouter wants a
   * nested `reasoning` object; Groq (following OpenAI's own gpt-oss param
   * naming directly) wants a flat `reasoning_effort` string; Mistral's
   * model here has no equivalent knob, so this is just empty for it. */
  reasoningParam: Record<string, unknown>;
}

function buildProviderSpec(name: LlmProviderName): ProviderSpec {
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
  if (name === 'mistral') {
    const key = import.meta.env.VITE_MISTRAL_API_KEY;
    return {
      name,
      url: 'https://api.mistral.ai/v1/chat/completions',
      model: 'mistral-small-latest',
      apiKey: key,
      headers: {
        Authorization: `Bearer ${key ?? ''}`,
        'Content-Type': 'application/json',
      },
      reasoningParam: {},
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
  openrouter: {
    name: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/keys',
    envVarName: 'VITE_OPENROUTER_API_KEY',
  },
  mistral: {
    name: 'Mistral',
    keyUrl: 'https://console.mistral.ai/api-keys',
    envVarName: 'VITE_MISTRAL_API_KEY',
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

// --- OpenAI-style tool declarations. Every provider's chat completions API
// is OpenAI-compatible, so tools are described the same way regardless of
// which one answers. ---

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
            description:
              '"exchange" for a size swap OR a straight replacement unit (same item, no size involved — for a faulty device/accessory with no size variants); "refund" otherwise.',
          },
          slotId: { type: 'string', description: 'The chosen pickup slot ID, e.g. "slot-1".' },
          exchangeSize: {
            type: 'string',
            description: 'The new size chosen, only when resolution is "exchange" AND the item has size variants. Omit for a straight replacement (no size variants).',
          },
          itemCondition: {
            type: 'string',
            enum: ['sealed', 'opened'],
            description:
              'Only ask for and pass this when checkReturnEligibility flagged the item as sealedOnly AND reason is "changed_mind" — whether the customer says it\'s still sealed/unopened or already opened. Omit in every other case.',
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
  {
    type: 'function',
    function: {
      name: 'lookupReturnTicket',
      description:
        "Look up the status of an EXISTING return ticket (refund/exchange status, pickup slot, refund amount, settlement timing) — for follow-up questions like 'where's my refund', 'when is my pickup', or 'what happened to my return'. Omit ticketId to list every ticket for the order if the customer didn't give a specific ID (e.g. they just asked 'where's my refund' with no ID) — if they have more than one, present the list and ask which. Never call before the order/phone has already been identified this conversation.",
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'The ticket ID, e.g. "RET-1001", if the customer gave one. Omit to list all tickets for the order.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rescheduleReturnPickup',
      description:
        "Change the pickup slot on an EXISTING return ticket. Two-step: call with ONLY ticketId first to see the available slots (this will refuse if the pickup already happened or the ticket is cancelled/complete) — present them and wait for the customer's choice. Call again with ticketId AND newSlotId only once they've actually picked one; never guess a slot they haven't stated. If they ask for the slot already booked, this will say so rather than silently rebooking it.",
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'The ticket ID, e.g. "RET-1001".' },
          newSlotId: { type: 'string', description: 'The new slot ID the customer chose, e.g. "slot-2". Omit to just see the available options.' },
        },
        required: ['ticketId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelReturnTicket',
      description:
        "Cancel an EXISTING return ticket. Only possible before the pickup has actually happened — refuses with a reason if the courier already collected the item, if the return is already complete (refunded/exchanged), or if it's already cancelled. Relay whatever this tool says plainly, including any refusal reason.",
      parameters: {
        type: 'object',
        properties: {
          ticketId: { type: 'string', description: 'The ticket ID to cancel, e.g. "RET-1001".' },
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
  /** Which provider actually answered — surfaced so a caller-side guardrail
   * (see sendAgentMessage's `guardrail` param) can log which provider it
   * had to correct, not just that a correction happened. */
  servedBy: LlmProviderName;
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
 * next `user` message is usually enough — EXCEPT when the current turn's
 * own tool-call chain is long enough (3+ round trips — a real scripted
 * scenario hit this) that it alone exceeds RECENT_MESSAGE_WINDOW, in
 * which case there's no `user` message left to walk forward to at all,
 * and the forward search runs off the end into an EMPTY slice. Every
 * OpenAI-compatible provider tolerates that (a slightly bare request, but
 * not a broken one); Gemini's API rejects a `contents: []` request
 * outright (400 "contents is not specified"), which is exactly what
 * exposed this. Falling back to walking BACKWARD from the naive cutoff in
 * that case always lands on the start of the current, still-in-progress
 * user turn — longer than the usual budget, but never empty.
 *
 * The summary is deliberately opaque here — this module has no idea what
 * "order ID" or "reason" mean, and shouldn't (see the file-level comment).
 * It's just a caller-supplied string slotted in as an extra system
 * message; the returns-domain logic that builds it lives entirely in
 * useReturnAgent.ts.
 */
function buildRequestMessages(fullHistory: ChatCompletionMessage[], contextSummary?: string): ChatCompletionMessage[] {
  const [systemMsg, ...rest] = fullHistory;
  const naiveCutoff = Math.max(0, rest.length - RECENT_MESSAGE_WINDOW);
  let cutoff = naiveCutoff;
  while (cutoff < rest.length && rest[cutoff].role !== 'user') cutoff += 1;
  if (cutoff >= rest.length) {
    cutoff = naiveCutoff;
    while (cutoff > 0 && rest[cutoff].role !== 'user') cutoff -= 1;
  }
  const recent = rest.slice(cutoff);

  if (!contextSummary) return [systemMsg, ...recent];
  const summaryMsg: ChatCompletionMessage = {
    role: 'system',
    content: `Context established earlier in this conversation (do not re-ask for these): ${contextSummary}`,
  };
  return [systemMsg, summaryMsg, ...recent];
}

/** Matches the same rate-limit/quota wording useReturnAgent.ts's own
 * isQuotaError check looks for. One of two conditions that trigger
 * automatic provider fallback — see isRetryableProviderError, which also
 * covers network-level failures. */
function isRateLimitOrQuotaError(message: string): boolean {
  const lower = message.toLowerCase();
  return message.includes('429') || lower.includes('quota') || lower.includes('rate limit');
}

/** The ONLY two failure classes that trigger automatic provider fallback
 * (see streamChatCompletion): an explicit rate-limit/quota response, or a
 * network-level failure where fetch() never got a response at all (CORS
 * block, DNS failure, connection refused, offline) — browsers reject
 * fetch()'s own promise with a TypeError for that case specifically,
 * distinct from the plain Error this module throws itself for a real HTTP
 * error status or a malformed response. Anything else (bad request, auth
 * failure, a genuine bug in the request body) surfaces immediately instead
 * of being silently retried on a different vendor, so a real bug doesn't
 * masquerade as "it just worked eventually." */
function isRetryableProviderError(err: unknown): boolean {
  if (err instanceof TypeError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return isRateLimitOrQuotaError(message);
}

/**
 * Output sanity check — seen live: a reply that reached the customer as
 * "????????????????????????????? Yes? |? |? |? |? R? #????????????
 * 0??? No? ..." with a raw JSON fragment (`?"}`) trailing off the end.
 * That's not a model being unhelpful, it's the wire format leaking
 * through or the generation itself collapsing — a decoding fault (a
 * multi-byte character split across an SSE chunk boundary) or a
 * corrupted/truncated stream a provider served without ever returning a
 * non-2xx status to catch it upstream. None of the existing checks catch
 * this: the HTTP response was 200, the SSE parsed as valid JSON, and the
 * text is non-empty, so nothing else in this file has a reason to
 * distrust it. This is deliberately generic pattern-matching, not an
 * attempt to fully validate prose — three independent, cheap signals,
 * any one of which is enough on its own:
 *  - raw JSON syntax (a brace) — the formatting rules already forbid
 *    markdown/code in a customer-facing reply, so a `{` or `}` has no
 *    legitimate reason to be there at all.
 *  - degenerate repetition — real text uses dozens of distinct
 *    characters; a collapse like the one above uses almost none.
 *  - mostly non-alphabetic — real prose, even list-heavy replies with
 *    prices and dates, is still majority letters once you exclude
 *    whitespace.
 * Skipped entirely below a length floor so a short, legitimately
 * numeral/emoji-heavy reply (a bare "1️⃣ 2️⃣ 3️⃣") never gets misjudged —
 * the reported failure was long, degenerate output, not a short one.
 */
function looksLikeGarbageOutput(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 25) return false;

  if (/[{}]/.test(trimmed)) return true;

  const nonWhitespace = trimmed.replace(/\s/g, '');
  const uniqueChars = new Set(nonWhitespace).size;
  if (uniqueChars <= 5) return true;

  const letters = (trimmed.match(/\p{L}/gu) ?? []).length;
  if (nonWhitespace.length > 0 && letters / nonWhitespace.length < 0.3) return true;

  return false;
}

/**
 * Logs every response header whose name mentions a rate limit — deliberately
 * a pattern match, not a fixed list of header names, because providers
 * don't agree on either the names or the shape: Groq splits requests vs.
 * tokens into separate `x-ratelimit-*-requests` / `-tokens` headers,
 * OpenRouter uses a single unprefixed `x-ratelimit-limit` /
 * `-remaining` / `-reset` triplet, Cerebras and Mistral have their own
 * variants again, and Gemini doesn't send rate-limit headers at all — its
 * retry timing lives in the JSON error body's `RetryInfo` detail instead
 * (see the 429 body itself, already logged alongside this). Logging
 * whatever headers actually came back, rather than reading three
 * hardcoded names, means this never silently misses a provider's real
 * reset time because it used a name this file didn't anticipate.
 */
function logRateLimitHeaders(providerName: string, res: Response): void {
  const entries = Array.from(res.headers.entries()).filter(([key]) => /rate.?limit/i.test(key));
  if (entries.length === 0) {
    console.warn(
      `[llmProvider] ${providerName} 429 — no rate-limit headers on this response (this provider likely reports limits in the response body instead; see the error logged alongside this).`,
    );
    return;
  }
  console.warn(`[llmProvider] ${providerName} 429 rate-limit headers:`, Object.fromEntries(entries));
}

/** Index into getConfiguredProviders() to try first. Starts at 0 (highest-
 * priority configured provider) and only ever moves forward: these are
 * daily caps, so once a provider rate-limits there's no point re-trying it
 * on the very next request for the rest of the session — this just
 * remembers "skip straight to the one that's still working." Resets on
 * page reload, which is fine since the caps themselves reset daily. */
let stickyProviderIndex = 0;

/**
 * Streams one chat completion from one specific OpenAI-compatible provider,
 * invoking `onTextDelta` with the accumulated visible text as tokens arrive
 * (never with reasoning tokens — those are dropped so the model's internal
 * chain-of-thought never leaks into the chat). Tool-call argument
 * fragments are accumulated by index per OpenAI's streaming tool-call
 * format and returned whole at the end, since a tool can only be executed
 * once its full arguments are known. The SSE format itself is identical
 * across every provider here (all OpenAI-compatible), so only request
 * construction is provider-specific.
 *
 * `forcedToolName`, when given, requires that specific function instead of
 * leaving tool use to the model's judgment (`tool_choice: 'auto'` normally)
 * — used for exactly one thing: sendAgentMessage's guardrail retry, when a
 * prior reply presented what looks like a slots/sizes/items list without
 * actually calling the tool that data should have come from. Never set on
 * a first attempt, only a one-shot corrective retry.
 */
async function streamOpenAiCompletionOnce(
  spec: ProviderSpec,
  messages: ChatCompletionMessage[],
  onTextDelta?: (textSoFar: string) => void,
  forcedToolName?: string,
): Promise<StreamResult> {
  const res = await fetch(spec.url, {
    method: 'POST',
    headers: spec.headers,
    body: JSON.stringify({
      model: spec.model,
      messages,
      tools: toolDeclarations,
      tool_choice: forcedToolName ? { type: 'function', function: { name: forcedToolName } } : 'auto',
      stream: true,
      ...spec.reasoningParam,
    }),
  });

  if (!res.ok || !res.body) {
    if (res.status === 429) logRateLimitHeaders(spec.name, res);
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

  return { content, toolCalls, servedBy: spec.name };
}

/**
 * Tries each configured provider in fallback order, starting from
 * `stickyProviderIndex`, advancing to the next on either a rate-limit/quota
 * error OR a network-level failure — including the "empty completion"
 * symptom of a rate limit, checked here so it participates in fallback too
 * (see the comment below) — see isRetryableProviderError. Any other error
 * type surfaces immediately without trying further providers. Logs every
 * attempt to the console (success, retryable failure, or immediate
 * failure), so fallback behavior is visible while testing. Only once every
 * configured provider has failed does this throw — and that final error
 * still carries "rate limit" wording, so the hook's existing isQuotaError
 * check renders the same friendly message it always has.
 */
async function streamChatCompletion(
  messages: ChatCompletionMessage[],
  onTextDelta?: (textSoFar: string) => void,
  forcedToolName?: string,
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
      const result = await streamOpenAiCompletionOnce(spec, messages, onTextDelta, forcedToolName);

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

      // Same idea, opposite symptom: a completion that's non-empty but
      // looks corrupted rather than truncated. Must never reach the
      // customer — see looksLikeGarbageOutput's own doc for what this
      // catches and why. The message deliberately contains "rate limit"
      // (a plausible real cause, and it's what got this reported in the
      // first place) so it trips the same retryable classifier below and
      // falls through to the next provider, exactly like the empty-
      // completion case above.
      if (result.toolCalls.length === 0 && looksLikeGarbageOutput(result.content)) {
        throw new Error(`${spec.name} returned garbage/corrupted output (rate limit or a malformed stream likely mangled the generation)`);
      }

      stickyProviderIndex = i;
      console.log(`[llmProvider] request served by ${spec.name}${i > 0 ? ' (fallback)' : ''}`);
      return result;
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (!isRetryableProviderError(err)) {
        console.error(`[llmProvider] ${spec.name} failed with a non-retryable error — not falling back:`, message);
        throw err;
      }
      const next = providers[i + 1];
      const reason = err instanceof TypeError ? 'unreachable (network error)' : 'rate-limited/quota exceeded';
      console.warn(
        `[llmProvider] ${spec.name} ${reason}${next ? `, falling back to ${next.name}…` : ' — no more providers configured.'}`,
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
 *
 * `guardrail`, if given, is checked once — only against this customer
 * message's very first assistant reply, before anything else has had a
 * chance to happen — and only when that reply has NO tool calls at all.
 * It exists for one specific failure mode, seen live on a weaker fallback
 * provider: instead of calling getPickupSlots/getAvailableSizes/lookupOrder
 * to fetch real options, the model sometimes just writes a plausible-
 * looking numbered list from nothing (confirmed via the tool-call log —
 * zero calls that turn — while the text read exactly like real tool
 * output, invented dates included). `guardrail` receives that reply's
 * text and returns the tool name that should have produced it, or
 * undefined if the text doesn't look like a fabricated options list (a
 * legitimate reply — including answering an unrelated digression instead
 * of the pending question — always returns undefined and is left alone).
 * If it returns a name, this reply is discarded (never shown to the
 * customer, never added to `chat.messages`) and retried exactly once with
 * that one tool forced via `tool_choice` for that single request only —
 * `tool_choice` stays `'auto'` everywhere else, on every other round, on
 * every other provider, so this never costs the model its ability to
 * field a genuine digression. While the guardrail is armed, streamed text
 * is buffered instead of forwarded live, so a discarded attempt is never
 * even flashed on screen before the corrected reply replaces it — the one
 * UX cost is that this specific reply appears all at once instead of
 * streaming token-by-token. Every trigger is logged with which provider
 * needed correcting, so a pattern by provider is visible over time.
 */
export async function sendAgentMessage(
  chat: ChatSession,
  message: string,
  executors: ToolExecutorMap,
  onToolCall?: (name: string, args: Record<string, unknown>, result: unknown) => void,
  onTextDelta?: (textSoFar: string) => void,
  contextSummary?: string,
  guardrail?: (content: string) => string | undefined,
): Promise<string> {
  chat.messages.push({ role: 'user', content: message });

  let guard = 0;
  let forcedToolName: string | undefined;
  let guardrailRetried = false;
  let guardrailArmed = Boolean(guardrail);
  while (guard < 6) {
    guard += 1;
    const requestMessages = buildRequestMessages(chat.messages, contextSummary);

    let buffered = '';
    const deltaSink = guardrailArmed
      ? (textSoFar: string) => {
          buffered = textSoFar;
        }
      : onTextDelta;

    const { content, toolCalls, servedBy } = await streamChatCompletion(requestMessages, deltaSink, forcedToolName);
    forcedToolName = undefined; // one-shot — only ever applies to the single request it was set for

    if (guardrailArmed && toolCalls.length === 0 && !guardrailRetried) {
      const requiredTool = guardrail!(content);
      if (requiredTool) {
        guardrailRetried = true;
        console.warn(
          `[llmProvider] guardrail: ${servedBy} presented what looks like an options list without calling ${requiredTool} this turn — discarding and forcing a retry`,
          { content },
        );
        forcedToolName = requiredTool;
        continue;
      }
    }

    if (guardrailArmed) {
      onTextDelta?.(buffered || content);
      guardrailArmed = false; // this customer message's guarded window is over either way — text-only or tool-backed, later rounds in this same exchange stream live as normal
    }

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
