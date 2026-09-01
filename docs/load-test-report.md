# Load/Soak Test Report — Phase 6.5

**Status: NOT YET RUN.** This report is the template the load test
(`apps/api/loadtest/locustfile.py`) produces results for; it is checked
in now, unfilled, rather than filled with invented numbers, because no
networked environment was available to this build pass to actually start
a `uvicorn` server and run `locust` against it (this sandbox has no
outbound network access at all, which also means the API's own pinned
dependencies — `fastapi`, `hnswlib`, etc. — could not be installed here
either; see ADR 0007 for the full list of things this phase built but
could not execute).

Whoever runs this next: replace this file's contents with the actual
measured output and update the "Status" line above to "RUN on \<date\>".
Do not report a number in the table below that didn't come from an actual
locust run — an unfilled row is more honest than a guessed one.

## How to run it

```bash
cd apps/api
uvicorn app.main:app --host 0.0.0.0 --port 8000 &

# ingest at least the sample corpus first, e.g. via the ingested pytest
# fixture, or by POSTing a few PDFs to /documents/upload directly.

export LOCUST_API_BASE=http://localhost:8000
export LOCUST_BEARER_TOKEN="$(curl -s -X POST $LOCUST_API_BASE/auth/dev-token \
    -H 'Content-Type: application/json' \
    -d '{"sub":"loadtest","tenant_id":"tenant-a","principals":["tenant:tenant-a"]}' \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')"

locust -f loadtest/locustfile.py --headless -u 20 -r 5 -t 3m --host "$LOCUST_API_BASE" \
    --csv=docs/loadtest-run
```

Locust's own `--csv` output (`docs/loadtest-run_stats.csv`) has the exact
p50/p95/p99 per endpoint; transcribe the `/search` and `/chat` rows into
the table below along with the run's concurrency (`-u`), duration (`-t`),
and error rate.

## Results

| Metric | Target (blueprint Section 8) | Measured | Meets target? |
|---|---|---|---|
| Search p95 latency | < 500 ms | _not yet measured_ | — |
| Full answer p95 latency | < 5–8 s | _not yet measured_ | — |
| Search error rate | < 0.5% | _not yet measured_ | — |
| Availability during run | ≥ 99.5% | _not yet measured_ | — |

**Run parameters:** concurrency = _n/a_, duration = _n/a_, corpus size = _n/a_.

## Notes for whoever runs this

- `/chat`'s SSE stream is consumed to completion in the load test script
  so "full answer p95" reflects the whole streamed answer, not
  time-to-first-byte — don't compare it directly to a p95 measured on
  time-to-first-byte elsewhere.
- Run against whichever generation provider (`GEMINI_API_KEY` /
  `GROQ_API_KEY` / Ollama / the deterministic extractive fallback) will
  actually be used in the target deployment — the extractive fallback is
  materially faster than a real hosted LLM call, so a p95 measured
  against it is not representative of a production-configured deployment.
  Report `generation_provider_is_fallback` (see `/system/health`)
  alongside the numbers above.
- If the SLO isn't met, the blueprint's own guidance applies before
  assuming infrastructure is the bottleneck: check whether the p95 is
  retrieval-side (search) or generation-side (chat minus search) first.
