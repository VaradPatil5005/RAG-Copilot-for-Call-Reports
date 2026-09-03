"""Decision-intelligence-layer additions, Phase C (net-new, additive only).

`instrumentation.py` is the write side, called additively from
`routers/copilot.py`'s existing `_chat_stream` (see that file's
Phase C comments) inside try/except blocks that can never raise into the
existing chat flow. `dashboard.py` is the read side, exposed by the new
`routers/observability.py` router. Nothing in this package is imported
by, or changes the behavior of, any existing Phase 1-6 module.
"""
