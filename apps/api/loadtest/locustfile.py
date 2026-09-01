"""Load/soak test (Phase 6.5) against `/search` and `/chat`, per the
blueprint's own SLO targets:

    search p95 latency        < 500 ms
    full answer p95 latency   < 5-8 s
    availability               >= 99.5%

Run against a running API instance (`uvicorn app.main:app`) that already
has the sample corpus ingested (see `tests/conftest.py`'s `ingested`
fixture for how to build one, or POST a few documents through
`/documents/upload` first) and a valid dev auth token (Phase 6.3 --
`/auth/dev-token` -- required, since `/search` and `/chat` now reject
unauthenticated requests).

Usage:
    cd apps/api
    export LOCUST_API_BASE=http://localhost:8000
    export LOCUST_BEARER_TOKEN="$(curl -s -X POST $LOCUST_API_BASE/auth/dev-token \\
        -H 'Content-Type: application/json' \\
        -d '{"sub":"loadtest","tenant_id":"tenant-a","principals":["tenant:tenant-a"]}' \\
        | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')"
    locust -f loadtest/locustfile.py --headless -u 20 -r 5 -t 3m --host "$LOCUST_API_BASE"

This has never been run in this project (no networked environment
available to this build pass -- see the accompanying ADR) -- the script
is written and ready, not executed. Running it and recording the actual
p50/p95/p99 numbers against the SLO table above is the remaining step,
tracked as an explicit Phase 6.5 gap, not silently skipped.
"""
from __future__ import annotations

import os
import random

from locust import HttpUser, between, task

BEARER_TOKEN = os.environ.get("LOCUST_BEARER_TOKEN", "")

SEARCH_QUERIES = [
    "What risks were raised for Contoso?",
    "What actions were assigned after the meeting?",
    "Which competitors were mentioned?",
    "What was the Q2 pipeline value discussed?",
    "Has the customer approved the proposal?",
]

CHAT_QUERIES = [
    "What risks were raised for Contoso?",
    "Summarize the open actions and who owns them.",
    "What is the current approval status?",
    "What competitors were mentioned and by which customers?",
]


def _auth_headers() -> dict[str, str]:
    if not BEARER_TOKEN:
        raise RuntimeError(
            "LOCUST_BEARER_TOKEN is not set -- /search and /chat require a valid bearer token "
            "as of Phase 6.3. See this file's module docstring for how to mint one."
        )
    return {"Authorization": f"Bearer {BEARER_TOKEN}", "Content-Type": "application/json"}


class SearchUser(HttpUser):
    """Weighted 3:1 against ChatUser -- search is the cheap, high-volume
    path in a real deployment; full generation calls are rarer and much
    more expensive, matching the blueprint's own traffic-shape assumption."""

    weight = 3
    wait_time = between(0.5, 2.0)

    @task
    def search(self):
        query = random.choice(SEARCH_QUERIES)
        with self.client.post(
            "/search",
            json={"query": query, "top_k": 10},
            headers=_auth_headers(),
            name="/search",
            catch_response=True,
        ) as resp:
            if resp.status_code != 200:
                resp.failure(f"status={resp.status_code}: {resp.text[:200]}")


class ChatUser(HttpUser):
    weight = 1
    wait_time = between(2.0, 6.0)

    @task
    def chat(self):
        query = random.choice(CHAT_QUERIES)
        with self.client.post(
            "/chat",
            json={"query": query},
            headers=_auth_headers(),
            name="/chat",
            catch_response=True,
            stream=True,
        ) as resp:
            if resp.status_code != 200:
                resp.failure(f"status={resp.status_code}: {resp.text[:200]}")
                return
            # /chat is an SSE stream -- consume it fully so the reported
            # request latency reflects the full answer (matching the
            # blueprint's "full answer p95" SLO, not just time-to-first-byte).
            for _ in resp.iter_lines():
                pass
