# Returns Agent — Multi-Channel Sales Demo

A sales-demo web app for showing enterprise prospects what an AI returns agent
looks like when it's wired into their customer channels on one side and their
operations tooling on the other. One agent, two channels — WhatsApp and a
live voice call — switchable instantly, backed by the same policy engine,
tools, and ops console. Built to be walked through live on a call.

## What this demonstrates, and for whom

**Audience:** ops / CX leaders at a D2C brand (fashion, pharmacy, or similar)
evaluating whether an AI agent can safely handle returns conversations without
turning into a support liability — and, specifically, whether that holds up
across more than one channel without becoming two separate products to trust.

**The pitch in one screen:** a customer reaches out about a return — over
WhatsApp, or on a live call, switchable with one click in the top bar (left
panel). Every step of that conversation — order lookup, eligibility check,
exchange vs. refund, pickup slot — shows up immediately as a structured ticket
moving through a status pipeline on the ops console (right), regardless of
which channel it came from. A chat window alone only proves an LLM can hold a
conversation. The split screen proves it lands in the systems an ops team
actually watches — and the channel switch proves that isn't tied to one
integration.

Three things a buyer should walk away believing:

1. The agent can carry a real, branchy conversation (size exchange offered
   before refund, final-sale and window checks enforced, COD vs. prepaid
   refund routing) without the founder having to trust the model's judgement
   on policy — on a screen or on a phone call.
2. Every one of those steps is a discrete, inspectable event in their
   operational system — not a black box.
3. Adding a channel is not a rebuild. WhatsApp and voice share one policy
   engine, one tool layer, and one ops backend — a ticket created on a call
   shows up in the same table as one created over chat, because it's the
   same table.

## Setup

```bash
npm install
cp .env.example .env   # then add at least one provider's API key
npm run dev
```

**Three providers with automatic fallback**, not a manual switch — every
request tries them in this fixed order, falling through to the next one
on a rate-limit/quota error *or* a network-level failure (fetch() itself
unable to reach the provider):

```
VITE_GROQ_API_KEY=your_key_here
VITE_OPENROUTER_API_KEY=your_key_here
VITE_MISTRAL_API_KEY=your_key_here
```

All three are optional — any provider with no key set is skipped
entirely, so one key is enough to run the app. Configuring more than one
is what makes fallback actually do something: if Groq's daily cap gets
hit mid-conversation (a real thing that happened repeatedly during
testing, and would just as easily kill a recruiter's live demo session),
the very next request automatically retries on OpenRouter, then Mistral,
instead of surfacing an error. Once a provider rate-limits, later requests
skip straight past it for the rest of the session (see
`stickyProviderIndex` in `llmProvider.ts`) rather than re-trying a
provider that's very likely still capped. Every attempt — success,
retryable failure, or immediate failure — is logged to the browser
console (`[llmProvider] request served by …`), so fallback is visible
while testing rather than invisible.

- **Groq** (tried 1st): free key at [console.groq.com/keys](https://console.groq.com/keys).
- **OpenRouter** (tried 2nd): free key at [openrouter.ai/keys](https://openrouter.ai/keys).
- **Mistral** (tried 3rd, last): free key at [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys).

If every configured provider's key is missing, the app shows a clear
in-UI message instead of crashing (see `src/components/ApiKeyNotice.tsx`).
No backend, no database — everything runs client-side with state held in
React, calling each provider's chat API directly from the browser.

**Which models, and why:** Groq and OpenRouter run the same OpenAI
open-weight `gpt-oss` family, deliberately, not by coincidence. Tool
calling is non-negotiable (most free-tier models don't support it at
all), and having already validated this model family's tool-chaining
behavior extensively against our system prompt (see below), keeping the
weights in the same family when adding a provider means the main variable
that changes is the hosting infrastructure — not the model's judgement.
Mistral needed its own model chosen from its own catalogue instead — and
was verified by actually running the full VS1002 return flow (order
lookup → item pick → eligibility → reason → resolution → slot pick →
ticket creation) forced as the sole provider, not just checked for "does
it respond."

- **Groq** (`openai/gpt-oss-20b`, no backend suffix) — tried 1st. Added
  after OpenRouter's free tier hit its 50-request/day account-level cap
  mid-testing (a hard wall, not a per-minute throttle — it doesn't clear
  until the daily reset or a credit top-up). Groq's LPU inference is also
  substantially faster, which incidentally helps the separate latency
  work already done (see "Design decisions").
- **OpenRouter** (`openai/gpt-oss-20b:free`) — tried 2nd, the original
  provider. Its free-tier daily cap is real (see above) but the model is
  well-validated there specifically: two full multi-scenario test passes
  with zero broken tool chains.
- **Mistral** (`mistral-small-latest`) — tried 3rd and last, added when
  Groq and OpenRouter both hit genuine *daily* exhaustion simultaneously
  during testing (confirmed by spaced-out probe requests still failing,
  ruling out a transient per-minute cap). Mistral's docs list function
  calling as supported across its whole current general-purpose lineup
  (Large/Medium/Small); Small was picked specifically because it's the
  cheapest/fastest model in that confirmed-supported set — this tier of
  the fallback chain only needs to answer reliably, not reason deeply.

**Two more providers were tried and dropped, not just left unconfigured.**
Cerebras (`gpt-oss-120b`) had a genuinely useful free tier for a while,
but that tier turned out to be a time-limited $5 trial rather than a
renewing daily allowance — once spent, every request 402s permanently, so
it was removed rather than left silently eating a fallback attempt on
every request. Gemini (`gemini-flash-latest`) was dropped because the
AQ-prefixed API key format this project's key uses hits a known Google
platform issue that reports `limit: 0` regardless of actual quota,
making it permanently unusable — same call as Cerebras: no point paying a
startup check and a fallback slot for a provider that can never answer.

**SambaNova Cloud was tried and dropped too — not a model problem, an
architectural one.** This slot was originally meant for GitHub Models,
but GitHub Models was fully retired (2026-07-30, per GitHub's own docs —
the playground, catalog, and inference API are gone for every customer)
before this code shipped. SambaNova Cloud (`Meta-Llama-3.3-70B-Instruct`,
picked because SambaNova's own function-calling docs say the smaller 8B
model "cannot reliably maintain a conversation alongside tool-calling
definitions") looked like a clean substitute on paper — but its REST API
sends no `Access-Control-Allow-Origin` header at all, so every request
from this app fails the CORS preflight before it ever reaches SambaNova
(confirmed live: a direct browser-context `fetch()` to their
`/chat/completions` throws `TypeError: Failed to fetch` with a CORS error
in the console). This app is client-side-only with no backend to proxy
through, so there's no fix short of adding one — no model choice changes
a missing CORS header, and no amount of the key being valid changes that
either. A backend-fronted project can still use SambaNova fine, since CORS
only blocks a direct browser-to-SambaNova request, not a server-to-server
one — dropped here rather than added as a slot that can never actually
serve a request.

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

To add another provider, reorder the fallback chain, or change a model
string, everything is in `src/lib/llmProvider.ts` — nothing else in the
app needs to change (see "Design decisions" below).

## Deploying to Vercel

No backend and no client-side routing, so Vercel's zero-config Vite preset
is sufficient — no `vercel.json` needed. Build command `npm run build`
(`tsc -b && vite build`), output directory `dist`, both auto-detected.

1. Push this repo to GitHub (see below).
2. [vercel.com/new](https://vercel.com/new) → import the repo.
3. **Add the env vars before the first build**: Project Settings →
   Environment Variables → any of `VITE_GROQ_API_KEY`,
   `VITE_OPENROUTER_API_KEY`, `VITE_MISTRAL_API_KEY`
   (all optional, at least one required), checked for
   Production/Preview/Development. Vite inlines `VITE_*` vars at *build*
   time, so having none set means the deployed build falls back to the
   in-app "API key missing" screen, not a crash — but keys have to be set
   before you build, not after.
4. Deploy. Every push to the connected branch redeploys automatically.

The key ends up in the client-side JS bundle by design (no backend to hide
it behind) — fine for a demo you control access to, but set a spend cap on
the key (Settings → Keys, on either provider) if the URL will be shared
beyond a live call.

### Live demo controls

- **Channel switcher** (top bar, next to the brand switcher) — WhatsApp ⇄
  Voice. Swaps the left panel between the chat UI and the call UI instantly.
  Neither channel's conversation resets when you switch, and any tickets
  already created stay in the ops console — that persistence is the point,
  see "Design decisions" below.
- **Play scenario** (top of the left panel, both channels) — three scripted
  openers so the conversation can run without typing or talking on a call:
  size issue → exchange, outside the return window, and a final-sale item.
  In voice mode this fills in what the customer "says" via the API, without
  needing an open mic.
- **Brand switcher** (top bar) — swaps the whole app between two brand
  configs (a fashion brand and a pharmacy) to show this is a platform, not a
  one-off build. Resets both channels (see below).
- **Reset** — clears both channels' conversations and the shared ticket
  history, ends any active call, and starts fresh.
- **▸ Advance (demo)** (ops console, per ticket row) — a clearly-labeled
  demo-only control, not product behavior: moves that one ticket one step
  forward in its status pipeline (see "What's real vs. mocked" below for
  why nothing does this automatically). Lets a presenter show the full
  pipeline completing in a live demo on their own timing.

### Voice channel specifics

- **Speech recognition and synthesis are browser APIs, not a service** — the
  Web Speech API (`SpeechRecognition` / `speechSynthesis`), reliably
  available in Chrome and Edge only. Firefox and Safari have partial or no
  support; the panel detects this and falls back to a text input ("Or type
  what you'd say…") that drives the exact same agent turn a spoken sentence
  would, so the demo still works, it just isn't spoken.
- **Microphone permission denial** is handled explicitly — a denied mic
  shows a clear message and the text fallback stays available; it doesn't
  break the call.
- **Voice selection** degrades in tiers (see `src/lib/selectVoice.ts`): a
  brand-preferred Indian-English voice if one is installed, then any
  Indian-English voice, then any English voice, then the browser default.
  Which voices exist is entirely OS/browser dependent, so this never assumes
  a specific voice is present.

## What's real vs. mocked

**Real:**
- Function calling (Groq, OpenRouter, or Mistral, with
  automatic fallback between them — see Setup) drives the
  entire conversation on **both channels** — order
  lookup, eligibility checks, size lookup, pickup slots, and ticket creation
  are actual tool calls the model makes, not scripted branching. Responses
  stream token-by-token, and the ops panel shows which tool is executing in
  real time as the model works.
- Speech recognition and synthesis (voice channel) — the browser's actual
  Web Speech API, not a mocked transcript. What you say is what gets
  transcribed and sent to the model; what the model says is actually spoken
  aloud, not just displayed.
- The policy engine (`src/lib/policy.ts`) — return-window and final-sale
  logic runs as plain, unit-testable functions against the order data,
  identical for both channels.
- The duplicate-booking guard (`src/lib/tools.ts`) — a real check against
  existing tickets, not a prompt instruction the model might forget.
- App state — the ticket list, its status pipeline, and the dashboard stats
  are all derived from the same React state both channels' conversations
  mutate. Nothing on the right panel is hand-wired to a specific message.

**Mocked:**
- WhatsApp Business API — the chat UI is a WhatsApp-style thread, not a real
  WhatsApp Business Cloud API integration.
- Telephony — the voice channel is browser speech APIs end-to-end; no real
  phone call, no PSTN, no Twilio/telephony provider. "Call duration" is a
  timer since you clicked Start Call, not a billed call leg.
- Logistics/courier dispatch — pickup slots are static offers; there's no
  courier partner API.
- Payments — refunds are never actually issued; "refund destination" is
  informational text only.
- Inventory — `getAvailableSizes` reads from the seed catalog, not a live
  inventory system.
- Ticket status progression after creation. A new ticket starts at
  "Pickup Scheduled" (eligibility and a pickup slot are both already
  real facts by then) and stays there — the app has no courier or bank
  integration to react to, so nothing auto-advances it through "In
  Transit" or the final step ("Refunded" / "Awaiting Bank Details" /
  "Exchanged", branching correctly by payment method and resolution —
  see `statusSequenceFor` in `src/types.ts`) on a fake timer claiming
  those events happened. To let a presenter show the full pipeline live,
  each ticket row has a dashed, clearly-labeled **"▸ Advance (demo)"**
  button (`src/components/TicketCard.tsx`) that moves it one real step at
  a time — a click is an explicit, attributable action, not the ticket
  claiming something happened on its own.

## Design decisions

**Why policy sits in code, not the prompt.** `checkReturnEligibility` and the
underlying rules in `src/lib/policy.ts` are deterministic TypeScript
functions — not instructions in the system prompt that the model "follows."
The model calls the tool and reports whatever it returns; it never decides
eligibility itself. A brand cannot ship a returns flow where a language model
is improvising refund policy — a return window or final-sale rule has to be
something a QA engineer can unit-test independently of any prompt, and that a
policy change doesn't require touching the LLM prompt at all.

**Why the split screen.** The left panel proves the agent can converse —
over WhatsApp or by voice. The ops panel proves the conversation is actually
operational data: a ticket with an ID, a status, a customer, and a pipeline
that moves, always visible regardless of which channel produced it. That's
the difference between "cool chatbot demo" and "this replaces part of my
support queue." The two panels are never collapsed to one column for exactly
this reason — a single chat or call window can't make that case, and neither
can two ops consoles that don't agree with each other.

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

**Why voice required zero changes to policy or the provider layer.**
`src/lib/policy.ts` and `src/lib/llmProvider.ts` are byte-for-byte identical
to the WhatsApp-only version of this app. Eligibility rules don't care how
the question arrived; the streaming fetch, the SSE parsing, the tool-calling
loop, and the model selection don't either. Adding a second channel meant
adding a second system prompt (`src/lib/voiceSystemPrompt.ts` — banning
markdown/emoji, requiring 1-2 sentence replies, and a rule about not
guessing at fragmentary speech that chat doesn't need) and a second
sanitizer (`src/lib/sanitizeSpeechText.ts`, stripping stray formatting
before it's read aloud, versus `formatText.ts` rendering it as bold for
chat) — new *content*, not new *plumbing*. The one real code change,
`tools.ts`'s duplicate-booking guard, is not a voice carve-out either: it
fixes a gap that voice testing surfaced (a call doesn't end when the
transaction does — the customer is still on the line, and a stray "thanks,
one more thing" can look like a second return request) but the fix applies
identically to both channels, because there's only one `createReturnTicket`
implementation for both to call.

**Why chat and voice share one hook instead of one each.**
`useReturnAgent.ts` holds ticket state, the ticket ID sequence, and
`buildExecutors` exactly once, in a "shared" section both channels' send
functions call into — see the comment at the top of the file. Each channel
gets its own transcript, its own `ChatSession` (so its own system prompt),
and its own typing/streaming UI state, because a WhatsApp exchange and a
phone call are genuinely two independent conversations with the model, not
one conversation shown two ways. But there is exactly one
`createReturnTicket` closure, closing over the same `tickets` state and the
same duplicate-booking guard regardless of which channel's turn called it.
That's what makes "switch channels mid-demo, tickets persist" true
structurally rather than by careful bookkeeping: there's only one ops
backend for either channel to write to. The channel switcher itself
(`channel` state in the hook, read by `App.tsx` to choose which panel to
render) touches neither channel's conversation — it's a pure view toggle.

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

Vite + React + TypeScript + Tailwind CSS v4, three LLM providers behind one
fallback chain (Groq/OpenRouter/Mistral's OpenAI-compatible REST APIs,
all streamed via plain `fetch` — no SDK, with automatic fallback on
rate-limit or network failure across providers), the browser's native Web
Speech API for the
voice channel (no telephony/speech vendor, no SDK there either), no
backend, no state management library — plain React state in
`src/hooks/useReturnAgent.ts`.

## Project structure

```
src/
  config/brand.ts          # brand identity + catalog + voice settings per vertical
  data/orders.ts           # ~20 seeded Vastra (fashion) orders
  data/pharmacyOrders.ts   # ~10 seeded WellNest (pharmacy) orders
  data/scenarios.ts        # scripted "Play scenario" openers, shared by both channels
  lib/policy.ts            # deterministic eligibility rules — unchanged by adding voice
  lib/tools.ts             # pure tool implementations, incl. the duplicate-booking guard, shared by both channels
  lib/llmProvider.ts       # the ONLY file that knows the LLM vendor(s); streaming client for 3 OpenAI-compatible providers, automatic rate-limit/network fallback + function-calling loop — unchanged by adding voice
  lib/systemPrompt.ts      # WhatsApp channel's conversational script (not policy)
  lib/voiceSystemPrompt.ts # voice channel's conversational script — different formatting/brevity rules, same flow
  lib/formatText.ts        # chat sanitizer: renders the model's *bold* as actual bold (code enforces, not the prompt)
  lib/sanitizeSpeechText.ts # voice sanitizer: strips stray markdown before it's read aloud
  lib/selectVoice.ts       # ranks installed browser voices against a brand's preference list
  hooks/useReturnAgent.ts  # central state: shared tickets/executors, per-channel chat + voice sub-state, brand, channel
  hooks/useSpeechRecognition.ts # wraps SpeechRecognition (Chrome/Edge only)
  hooks/useSpeechSynthesis.ts   # wraps speechSynthesis
  components/               # ChatPanel + CallPanel (left, channel-switched) + OpsDashboard (right, always visible)
```
