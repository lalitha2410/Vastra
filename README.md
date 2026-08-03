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
cp .env.example .env   # then add an API key for whichever provider you're using
npm run dev
```

**Two interchangeable providers**, switched with one env var:

```
VITE_LLM_PROVIDER=groq          # or "openrouter" — defaults to groq if unset
VITE_GROQ_API_KEY=your_key_here
VITE_OPENROUTER_API_KEY=your_key_here
```

You only need a key for whichever provider is active — the app reads
`VITE_LLM_PROVIDER` and only calls that one. Both keys can sit in `.env`
at once (harmless) so switching providers is just changing one line and
restarting `npm run dev`, no re-entering keys.

- **Groq** (default): free key at [console.groq.com/keys](https://console.groq.com/keys).
- **OpenRouter**: free key at [openrouter.ai/keys](https://openrouter.ai/keys).

If the active provider's key is missing, the app shows a clear in-UI
message instead of crashing (see `src/components/ApiKeyNotice.tsx`). No
backend, no database — everything runs client-side with state held in
React, calling the provider's `/chat/completions` API directly from the
browser.

**Which model, and why:** both providers run the exact same model —
`openai/gpt-oss-20b` — deliberately, not by coincidence. Tool calling is
non-negotiable (most free-tier models on either provider don't support it
at all), and having already validated this specific model's tool-chaining
behavior extensively against our system prompt (see below), keeping the
weights identical when adding a second provider means the only variable
that changes is the hosting infrastructure — not the model's judgement.

- **Groq** (`openai/gpt-oss-20b`, no backend suffix) — added after
  OpenRouter's free tier hit its 50-request/day account-level cap
  mid-testing (a hard wall, not a per-minute throttle — it doesn't clear
  until the daily reset or a credit top-up). Groq's LPU inference is also
  substantially faster, which incidentally helps the separate latency
  work already done (see "Design decisions").
- **OpenRouter** (`openai/gpt-oss-20b:free`) — the original provider. Its
  free-tier daily cap is real (see above) but the model is well-validated
  there specifically: two full multi-scenario test passes with zero
  broken tool chains.

**We tested OpenRouter's paid variant (`openai/gpt-oss-20b`, no `:free`
suffix) and deliberately did not switch to it.** Same weights, meaningfully
different result: a controlled 5-trial head-to-head (identical prompt,
tools, `reasoning: {effort:'low'}`) showed paid averaging ~1.2s per call
vs. free's ~6.8s with two 12-14s queuing spikes — a real latency win. But
OpenRouter routes the two variants to different upstream providers (free →
Darkbloom, paid → DeepInfra), and a follow-up 4-trial probe of the same
opening turn found the paid/DeepInfra path dropped mid-tool-chain 3 times
out of 4 — the model would narrate "let me check the sizes, one moment…"
without actually calling `getAvailableSizes`, leaving the conversation
stalled until the customer said something else. Faster isn't better if
it's less reliable at the one thing this demo has to prove. The general
lesson carries to Groq too: a provider or infra switch is a *behavior*
change, not just a speed change, even at identical model weights — worth
a few test conversations before trusting a new provider in a live demo,
which is exactly what we did before relying on Groq (see below).

To add a third provider or change either model string, everything is in
`src/lib/llmProvider.ts` — nothing else in the app needs to change (see
"Design decisions" below).

## Deploying to Vercel

No backend and no client-side routing, so Vercel's zero-config Vite preset
is sufficient — no `vercel.json` needed. Build command `npm run build`
(`tsc -b && vite build`), output directory `dist`, both auto-detected.

1. Push this repo to GitHub (see below).
2. [vercel.com/new](https://vercel.com/new) → import the repo.
3. **Add the env vars before the first build**: Project Settings →
   Environment Variables → `VITE_LLM_PROVIDER` (`groq` or `openrouter`)
   and the matching `VITE_GROQ_API_KEY` or `VITE_OPENROUTER_API_KEY`,
   checked for Production/Preview/Development. Vite inlines `VITE_*` vars
   at *build* time, so a missing key means the deployed build falls back
   to the in-app "API key missing" screen, not a crash — but it has to be
   set before you build, not after.
4. Deploy. Every push to the connected branch redeploys automatically.

The key ends up in the client-side JS bundle by design (no backend to hide
it behind) — fine for a demo you control access to, but set a spend cap on
the key (Settings → Keys, on either provider) if the URL will be shared
beyond a live call.

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
- Function calling (Groq or OpenRouter, both running `openai/gpt-oss-20b`
  — see Setup) drives the entire conversation — order lookup, eligibility
  checks, size lookup, pickup slots, and ticket creation are actual tool
  calls the model makes, not scripted branching. Responses stream
  token-by-token, and the ops panel shows which tool is executing in real
  time as the model works.
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
This app has swapped or added a provider twice during development (Gemini
→ OpenRouter after a quota issue, then OpenRouter + Groq as a second,
switchable provider after OpenRouter's free tier hit its daily cap
mid-testing) and both times the change touched exactly this file plus env
var names — the tool declarations, the conversation flow, and the ops
dashboard wiring were untouched both times. That's the point of the
boundary: a vendor's pricing, quota, or API changes should never be a
multi-file refactor, and needing a *second* provider on short notice
(testing tonight, quota exhausted) is exactly the scenario this boundary
was built for.

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

Vite + React + TypeScript + Tailwind CSS v4, Groq or OpenRouter's
OpenAI-compatible REST APIs (`openai/gpt-oss-20b`, streamed via plain
`fetch` — no SDK), no backend, no state management library — plain React
state in `src/hooks/useReturnAgent.ts`.

## Project structure

```
src/
  config/brand.ts        # brand identity + catalog per vertical
  data/orders.ts          # ~20 seeded Vastra (fashion) orders
  data/pharmacyOrders.ts  # ~10 seeded WellNest (pharmacy) orders
  data/scenarios.ts       # scripted "Play scenario" openers
  lib/policy.ts           # deterministic eligibility rules
  lib/tools.ts            # pure tool implementations (lookupOrder, etc.)
  lib/llmProvider.ts      # the ONLY file that knows the LLM vendor(s); streaming Groq/OpenRouter client + function-calling loop
  lib/systemPrompt.ts     # conversational script (not policy)
  lib/formatText.ts       # sanitizes model output to WhatsApp formatting (code enforces, not the prompt)
  hooks/useReturnAgent.ts # central state: chat, tickets, brand, stats, live tool activity
  components/             # ChatPanel (left) + OpsDashboard (right)
```
