"""Decision-intelligence-layer additions (net-new, additive only).

See docs/decisions/ and docs/decision-intelligence-copilot.md (Phase D)
for the framing. Nothing in this package replaces or is called from
inside any existing Phase 1-6 module's core logic -- it is consumed
additively (see app/routers/copilot.py's `query_router` import) so that
removing this package entirely would leave every existing behavior and
test intact.
"""
