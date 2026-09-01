# 0005 — Generation model choice (Phase 4)

## Status
Accepted, implemented.

## Context
Phase 4 needs an LLM to turn `/retrieval`'s assembled evidence into a
grounded, cited, structured answer. There's no Azure OpenAI subscription
and no budget for a paid API. The original Phase 3-era assumption was
"use Ollama" as the only no-cost path; the revised Phase 4 prompt asked
for a researched comparison of genuinely free, no-card, no-expiry hosted
options too, since generation quality (structured JSON reliability,
citation-following, negation-awareness) matters much more here than it
did for Phase 3's small embedding model.

## Options compared

| Option | What it is | Free limits (verified against provider docs on the day this was written — these shift) | Tradeoff |
|---|---|---|---|
| **A — Ollama** | Local daemon, e.g. `llama3.2` / `phi3.5` | Unlimited, fully offline | Weakest instruction-following of the four on a modest laptop; needs the mandatory citation support-check to compensate; no internet dependency once pulled |
| **B — Gemini API (AI Studio)** | Hosted, `gemini-2.5-flash` | Roughly 10–15 RPM / a few hundred to ~1,500 req/day depending on model, check the AI Studio dashboard for current numbers | Native JSON mode, 1M context, best structured-output reliability of the four; free-tier prompts may be used for model training — fine for this project's fictional Contoso/Globex data, revisit before any real customer data |
| **C — Groq API** | Hosted open-weight (`llama-3.3-70b-versatile`) on custom LPU hardware | Roughly 30 RPM / ~1,000 req/day | Fastest of the four (helps the "generating" status not linger), OpenAI-compatible `json_object` mode, slightly behind Gemini on instruction-following in most comparisons |
| **D — OpenRouter** | Aggregator, 20+ free models behind one key | ~20 RPM / 50 req/day until $10 lifetime spend, then 1,000/day | Useful for comparing models, more setup friction for a single-model choice |

## Decision
**Gemini (Option B) as the primary provider, with Groq and Ollama wired in
as fallbacks behind the same `LLMProvider` interface**, selected in that
order by `services/generation.py`'s `get_default_provider()` when
`LLM_PROVIDER=auto` (the default):

1. `GeminiProvider` if `GEMINI_API_KEY` is set.
2. `GroqProvider` if `GROQ_API_KEY` is set.
3. `OllamaProvider` if a local daemon answers at `OLLAMA_BASE_URL`.
4. `ExtractiveFallbackProvider` — see below — if none of the above are
   reachable.

Reasoning specific to this project: the citation/JSON-reliability risk
flagged in the Phase 4 spec is best solved by a model with native
structured-output support, which Gemini has; its free-tier request budget
comfortably covers development, repeated runs against the section-9 query
list, and a live demo; and keeping Ollama wired in behind the same
interface costs almost nothing and is genuinely useful for a demo without
reliable internet.

All three hosted/local providers are implemented for real (real HTTP
calls, real request/response shapes) in `services/generation.py` — they
are not stubs waiting to be filled in later.

## The fourth provider this sandbox actually runs on
This specific sandbox's bash tool has a fixed network egress allowlist
(pypi/npm/github-adjacent domains only — see the system prompt's
`network_configuration`). It does not include
`generativelanguage.googleapis.com` (Gemini), `api.groq.com` (Groq), or
any path to a locally-running Ollama daemon (no way to install/run one
here at all). This was verified by attempting the pre-flight check in
`get_default_provider()` — all three raise before any request completes —
not assumed from the allowlist alone.

Given that, and given the project's own precedent in ADR 0004 (embeddings
degrade to a deterministic `HashingEmbeddingProvider` when `huggingface.co`
is unreachable, rather than the pipeline simply not working), Phase 4
follows the same pattern: `ExtractiveFallbackProvider` is a deterministic,
offline, zero-dependency generator that ranks evidence sentences by
query-term overlap and assembles an extractive, cited, structured answer
with no LLM call at all. It exists **only** so the full Phase 4 pipeline —
context assembly, structured JSON output, the mandatory citation
support-check, abstention, negation preservation, SSE streaming — could be
built and verified end-to-end in this sandbox. It is explicitly not a
production recommendation, and this is surfaced everywhere the fallback
matters:
- `/system/health`'s `generation_service` field
- every `chat_traces` row (`provider_is_fallback`)
- every `/chat` SSE `final` event (`provider_is_fallback`)
- this ADR

**On a machine with normal internet access and a `GEMINI_API_KEY` (or
`GROQ_API_KEY`, or a running Ollama daemon) set, `get_default_provider()`
uses the real hosted/local model automatically — no code change.**

### What the extractive fallback can and can't do
It genuinely satisfies several Phase 4 requirements by construction:
negation is preserved (it never paraphrases, so "did not approve" can't
get inverted into "approved" the way a generative rewrite could fail to),
citations are always real (it only cites chunks it actually pulled
sentences from), and it abstains correctly when no evidence overlaps the
query. Its real ceiling is on synthesis-heavy or multi-hop questions — it
can't compose a narrative across chunks the way an instruction-tuned model
can, only select and concatenate the most relevant sentences per chunk.
That's exactly why the citation support-check in `citation_validator.py`
is written to matter equally for every provider, not tuned around this
one's specific failure mode.

## API key handling
- Keys load from `apps/api/.env` via `app/config.py`'s minimal loader
  (never overrides a real environment variable already set).
- `.env` is now in `apps/api/.gitignore` (`.env.example` is the checked-in
  template) — this wasn't automatically covered by the ADR 0001
  convention and needed adding explicitly for Phase 4, since Ollama never
  needed a key.
- No key is ever hardcoded in `generation.py`.

## Consequences
- Any Phase 4 answer-quality assessment done *in this sandbox* reflects
  the extractive fallback, not Gemini/Groq/Ollama — same caveat as ADR
  0004's embedding numbers. Discard sandbox-run "answer quality" claims;
  they validate pipeline plumbing (retrieval → generation → validation →
  streaming → persistence), not model quality.
- The `LLMProvider` protocol and the citation validator are provider-
  agnostic by construction, so swapping to real Azure OpenAI GPT-4o Mini
  later is a new `AzureOpenAIProvider` class plus a `config.py` branch —
  no change to `routers/copilot.py`, `citation_validator.py`, or the
  frontend.

## Revisit when
This runs anywhere with standard internet access and a free-tier API key
(any normal dev laptop) — at that point Gemini answers for real and this
ADR's fallback path is dead code that stays as a safety net (a provider
outage should degrade, not crash the Copilot), same posture as ADR 0004.
