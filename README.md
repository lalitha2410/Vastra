# Returns Agent — WhatsApp Sales Demo

A sales-demo web app for showing enterprise prospects what an AI returns agent
looks like when it's wired into WhatsApp on one side and their operations
tooling on the other. Built to be walked through live on a call.

## What this demonstrates, and for whom

**Audience:** ops / CX leaders at a D2C brand (fashion, pharmacy, or similar)
evaluating whether an AI agent can safely handle returns conversations without
turning into a support liability.

**The pitch in one screen:** a customer messages about a return on WhatsApp
(left). Every step of that conversation — order lookup, eligibility check,
exchange vs. refund, pickup slot — shows up immediately as a structured ticket
moving through a status pipeline on the ops console (right). A chat window
alone only proves an LLM can hold a conversation. The split screen proves it
lands in the systems an ops team actually watches.

Two things a buyer should walk away believing:

1. The agent can carry a real, branchy conversation (size exchange offered
   before refund, final-sale and window checks enforced, COD vs. prepaid
   refund routing) without the founder having to trust the model's judgement
   on policy.
2. Every one of those steps is a discrete, inspectable event in their
   operational system — not a black box.

## Setup

```bash
npm install
cp .env.example .env   # then add your OpenRouter API key
npm run dev
```

Get a free key at [OpenRouter](https://openrouter.ai/keys) and set:

```
VITE_OPENROUTER_API_KEY=your_key_here
```

If the key is missing, the app shows a clear in-UI message instead of
crashing (see `src/components/ApiKeyNotice.tsx`). No backend, no database —
everything runs client-side with state held in React, calling OpenRouter's
`/chat/completions` API directly from the browser.

**Which model, and why:** the agent runs on `openai/gpt-oss-20b:free` via
OpenRouter. This isn't a stylistic pick — most of OpenRouter's free-tier
models do **not** support function/tool calling at all, and this whole demo
is worthless without real tool calling (that's the entire "tools decide,
the model converses" pitch). `gpt-oss-20b` is one of the few free models
whose `supported_parameters` include `tools`/`tool_choice`, and it's an
OpenAI-released open-weight model (Apache 2.0) so behaviour is
well-documented.

**We tested the paid variant (`openai/gpt-oss-20b`, no `:free` suffix) and
deliberately did not switch to it.** It's the same weights but a
meaningfully different result: a controlled 5-trial head-to-head (identical
prompt, tools, `reasoning: {effort:'low'}`) showed paid averaging ~1.2s per
call vs. free's ~6.8s with two 12-14s queuing spikes — a real latency win.
But OpenRouter routes the two variants to different upstream providers
(free → Darkbloom, paid → DeepInfra), and a follow-up 4-trial probe of the
same opening turn found the paid/DeepInfra path dropped mid-tool-chain 3
times out of 4 — the model would narrate "let me check the sizes, one
moment…" without actually calling `getAvailableSizes`, leaving the
conversation stalled until the customer said something else. The free
variant chained correctly in every run across two full test passes. Faster
isn't better if it's less reliable at the one thing this demo has to prove
— reliable tool chaining is the entire pitch, more important than shaving
a few seconds. If OpenRouter's paid routing improves later, or you want to
re-test, the model string is one line in `src/lib/llmProvider.ts` — nothing
else in the app needs to change (see "Design decisions" below).

### Live demo controls

- **Play scenario** (top of the chat panel) — three scripted openers so the
  conversation can run without typing on a call: size issue → exchange,
  outside the return window, and a final-sale item.
- **Brand switcher** (top bar) — swaps the whole app between two brand
  configs (a fashion brand and a pharmacy) to show this is a platform, not a
  one-off build.
- **Reset demo** — clears the conversation and ticket history and starts a
  fresh chat session.

## What's real vs. mocked

**Real:**
- OpenRouter (`openai/gpt-oss-20b:free`) function calling drives the entire
  conversation — order lookup, eligibility checks, size lookup, pickup
  slots, and ticket creation are actual tool calls the model makes, not
  scripted branching. Responses stream token-by-token, and the ops panel
  shows which tool is executing in real time as the model works.
- The policy engine (`src/lib/policy.ts`) — return-window and final-sale
  logic runs as plain, unit-testable functions against the order data.
- App state — the ticket list, its status pipeline, and the dashboard stats
  are all derived from the same React state the conversation mutates. Nothing
  on the right panel is hand-wired to a specific chat message.

**Mocked:**
- WhatsApp Business API — the chat UI is a WhatsApp-style thread, not a real
  WhatsApp Business Cloud API integration.
- Logistics/courier dispatch — pickup slots are static offers; there's no
  courier partner API.
- Payments — refunds are never actually issued; "refund destination" is
  informational text only.
- Inventory — `getAvailableSizes` reads from the seed catalog, not a live
  inventory system.
- Ticket status progression after creation (Approved → Pickup Scheduled → In
  Transit → Refunded) is time-compressed (~12 seconds total) so the pipeline
  visibly completes during a live call, instead of the days it would
  realistically take.

## Design decisions

**Why policy sits in code, not the prompt.** `checkReturnEligibility` and the
underlying rules in `src/lib/policy.ts` are deterministic TypeScript
functions — not instructions in the system prompt that the model "follows."
The model calls the tool and reports whatever it returns; it never decides
eligibility itself. A brand cannot ship a returns flow where a language model
is improvising refund policy — a return window or final-sale rule has to be
something a QA engineer can unit-test independently of any prompt, and that a
policy change doesn't require touching the LLM prompt at all.

**Why the split screen.** The chat panel proves the agent can converse. The
ops panel proves the conversation is actually operational data: a ticket with
an ID, a status, a customer, and a pipeline that moves. That's the difference
between "cool chatbot demo" and "this replaces part of my support queue." The
two panels are never collapsed to one column for exactly this reason — a
single chat window can't make that case.

**Why brand config is externalised.** `src/config/brand.ts` holds identity
(name, colors, agent name, tone, catalog, return window) for two verticals —
fashion (Vastra) and pharmacy (WellNest) — entirely separate from the
conversation and dashboard logic. Swapping the dropdown re-skins colors,
copy, catalog, and agent tone instantly, which is the fastest way to show a
prospect in a different vertical "this isn't a one-off build for one brand."

**Why the LLM vendor is isolated in one file.** `src/lib/llmProvider.ts` is
the only module that knows an LLM vendor exists at all — it exposes
`hasApiKey`, `startAgentChat`, and `sendAgentMessage`, and everything else
(the tools, the policy engine, `useReturnAgent.ts`, every component) talks
to those three functions, never to a vendor SDK or HTTP client directly.
This app has already swapped providers once during development (Gemini →
OpenRouter, after a quota issue on the Gemini side), and the migration
touched exactly one file plus the env var name — the tool declarations,
the conversation flow, and the ops dashboard wiring were all untouched.
That's the point of the boundary: a vendor's pricing, quota, or API
changes should never be a multi-file refactor.

**Why chat formatting is sanitized in code, not just prompted.** The system
prompt asks the model to use WhatsApp's `*single-asterisk*` bold instead of
markdown's `**double-asterisk**` (the chat bubbles render plain text, no
markdown parser). A small model doesn't follow formatting instructions with
100% consistency — it complies most of the time and occasionally slips back
into `**bold**`. Rather than accept that inconsistency or keep tuning the
prompt, `sanitizeWhatsAppText()` in `src/lib/formatText.ts` collapses any
`**bold**` down to `*bold*` before it reaches the screen, in both the
finished bubble and the live-streaming one. Same principle as the policy
engine: the model converses, code enforces — anything that has to be
*correct*, not just *likely*, belongs in a plain function, not a prompt
instruction.

## Stack

Vite + React + TypeScript + Tailwind CSS v4, OpenRouter's OpenAI-compatible
REST API (`openai/gpt-oss-20b:free`, streamed via plain `fetch` — no SDK),
no backend, no state management library — plain React state in
`src/hooks/useReturnAgent.ts`.

## Project structure

```
src/
  config/brand.ts        # brand identity + catalog per vertical
  data/orders.ts          # ~20 seeded Vastra (fashion) orders
  data/pharmacyOrders.ts  # ~10 seeded WellNest (pharmacy) orders
  data/scenarios.ts       # scripted "Play scenario" openers
  lib/policy.ts           # deterministic eligibility rules
  lib/tools.ts            # pure tool implementations (lookupOrder, etc.)
  lib/llmProvider.ts      # the ONLY file that knows the LLM vendor; streaming OpenRouter client + function-calling loop
  lib/systemPrompt.ts     # conversational script (not policy)
  lib/formatText.ts       # sanitizes model output to WhatsApp formatting (code enforces, not the prompt)
  hooks/useReturnAgent.ts # central state: chat, tickets, brand, stats, live tool activity
  components/             # ChatPanel (left) + OpsDashboard (right)
```
