"""Hierarchical chunking — turns `elements` rows into retrieval-ready
`chunks` (passages, tables, figures). See docs/decisions/0003 for the
local-substitution decisions this implements.

Chunk hierarchy (blueprint Section 3 / 4):
    Document -> Section -> Passage (350-500 tokens) -> citation spans
                        -> Table unit (own chunk, never merged into prose)
                        -> Figure (own chunk)

Boundary preference when a section's elements don't fit one passage:
    paragraph boundary > list boundary > table boundary > sentence boundary
    > token boundary (last resort).

A passage never crosses a section boundary. Tables/figures are always their
own chunk(s); a table with more than ~40 rows is split into row groups that
share one `table_id` but get distinct `chunk_id`s.
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Iterable

try:
    import tiktoken

    _ENC = tiktoken.get_encoding("cl100k_base")
except Exception:  # pragma: no cover - tiktoken should always be installed
    _ENC = None

TARGET_TOKENS = 450
MIN_TOKENS = 200
MAX_TOKENS = 600
OVERLAP_RATIO = 0.12
MAX_TABLE_ROWS = 40

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def token_count(text: str) -> int:
    """Real tokenizer (tiktoken/cl100k_base) used as a size proxy — we are
    not calling OpenAI, but it's a reasonable, fast, dependency-light stand-in
    for "how big is this chunk really." Falls back to a word-count heuristic
    (~0.75 tokens/word inverse, i.e. words * 1.3) if tiktoken is unavailable
    for any reason, so chunking never hard-fails on a tokenizer import issue.
    """
    if _ENC is not None:
        return len(_ENC.encode(text))
    return max(1, int(len(text.split()) * 1.3))


def _split_sentences(text: str) -> list[str]:
    parts = [p.strip() for p in _SENTENCE_SPLIT.split(text) if p.strip()]
    return parts or ([text] if text.strip() else [])


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass
class DocMeta:
    document_id: str
    version: int
    tenant_id: str
    customer_name: str | None
    account_owner: str | None
    meeting_date: str | None


@dataclass
class _Section:
    section_id: str
    section_path: list[str]
    elements: list[dict[str, Any]] = field(default_factory=list)


def _group_into_sections(document_id: str, version: int, elements: list[dict[str, Any]]) -> list[_Section]:
    """Elements arrive in reading order with a `section_path` already
    computed by extraction.py. Consecutive elements sharing the exact same
    section_path form one section group; any change (deeper or shallower)
    is a new section boundary."""
    sections: list[_Section] = []
    current_path: list[str] | None = None
    idx = -1
    for el in elements:
        if el["element_type"] in {"page_header", "page_footer"}:
            continue
        path = el.get("section_path") or []
        if path != current_path or not sections:
            idx += 1
            current_path = path
            sections.append(_Section(section_id=f"{document_id}:v{version}:s{idx}", section_path=path))
        sections[-1].elements.append(el)
    return sections


def _contextualize(meta: DocMeta, section_path: list[str], page_number: int | None, body: str) -> str:
    """Prepend stable context to every passage's embeddable text (blueprint
    Section 3 / 4). Deliberately excludes ACL data -- ACLs stay in filterable
    columns (acl_principals / classification / tenant_id on `chunks`), never
    in text that gets embedded or lexically indexed. See ADR 0003."""
    lines = [f"Document: {meta.customer_name or meta.document_id} — {meta.meeting_date or 'undated'}"]
    if section_path:
        lines.append(f"Section: {' > '.join(section_path)}")
    if page_number is not None:
        lines.append(f"Page: {page_number}")
    lines.append("")
    lines.append(body)
    return "\n".join(lines)


def _finalize_passage(
    meta: DocMeta,
    section: _Section,
    passage_index: int,
    buf_elements: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not buf_elements:
        return None
    raw_text = "\n\n".join(e["text"].strip() for e in buf_elements if (e.get("text") or "").strip())
    if not raw_text.strip():
        return None
    page_number = buf_elements[0]["page_number"]
    content = _contextualize(meta, section.section_path, page_number, raw_text)
    chunk_id = f"{meta.document_id}:v{meta.version}:{section.section_id.split(':')[-1]}:p{passage_index}"
    return {
        "chunk_id": chunk_id,
        "document_id": meta.document_id,
        "version": meta.version,
        "tenant_id": meta.tenant_id,
        "parent_section_id": section.section_id,
        "chunk_type": "passage",
        "section_path": section.section_path,
        "page_number": page_number,
        "customer_name": meta.customer_name,
        "account_owner": meta.account_owner,
        "meeting_date": meta.meeting_date,
        "content": content,
        "raw_text": raw_text,
        "table_json": None,
        "table_id": None,
        "token_count": token_count(content),
    }


def _overlap_tail(buf_elements: list[dict[str, Any]], overlap_ratio: float) -> list[dict[str, Any]]:
    """Return the trailing elements of a finalized passage worth carrying
    into the next one, sized to ~overlap_ratio of the target passage size.
    Never splits a single element/paragraph mid-way (paragraph boundary >
    sentence/token boundary applies to the overlap too)."""
    if not buf_elements:
        return []
    budget = TARGET_TOKENS * overlap_ratio
    tail: list[dict[str, Any]] = []
    running = 0
    for el in reversed(buf_elements):
        t = token_count(el.get("text") or "")
        if tail and running + t > budget:
            break
        tail.insert(0, el)
        running += t
    return tail


def _build_passages_for_section(meta: DocMeta, section: _Section) -> list[dict[str, Any]]:
    passages: list[dict[str, Any]] = []
    passage_index = 0
    buf: list[dict[str, Any]] = []
    buf_tokens = 0

    def flush() -> None:
        nonlocal buf, buf_tokens, passage_index
        p = _finalize_passage(meta, section, passage_index, buf)
        if p:
            passages.append(p)
            passage_index += 1
        buf = []
        buf_tokens = 0

    prose_elements = [e for e in section.elements if e["element_type"] not in {"table", "figure"}]

    for el in prose_elements:
        text = (el.get("text") or "").strip()
        if not text:
            continue
        el_tokens = token_count(text)

        # A single element bigger than max_tokens on its own: sentence-boundary
        # split (last resort: token boundary would further split a sentence,
        # but call-report prose rarely produces a single >600-token sentence).
        if el_tokens > MAX_TOKENS:
            if buf:
                flush()
            for sentence in _split_sentences(text):
                s_tokens = token_count(sentence)
                if buf_tokens + s_tokens > MAX_TOKENS and buf:
                    flush()
                buf.append({**el, "text": sentence})
                buf_tokens += s_tokens
                if buf_tokens >= TARGET_TOKENS:
                    flush()
            continue

        if buf_tokens + el_tokens > MAX_TOKENS and buf:
            flush()
            carry = _overlap_tail(buf, OVERLAP_RATIO) if passages else []
            buf = list(carry)
            buf_tokens = sum(token_count(e.get("text") or "") for e in buf)

        buf.append(el)
        buf_tokens += el_tokens

        if buf_tokens >= TARGET_TOKENS:
            flush()

    if buf:
        flush()

    return passages


def _chunk_table(meta: DocMeta, section: _Section, el: dict[str, Any]) -> list[dict[str, Any]]:
    table_json = el.get("table_json") or {}
    table_id = table_json.get("table_id") or el["element_id"]
    headers = table_json.get("headers", [])
    rows = table_json.get("rows", [])
    page_number = el["page_number"]

    if len(rows) <= MAX_TABLE_ROWS:
        row_groups = [rows]
    else:
        row_groups = [rows[i : i + MAX_TABLE_ROWS] for i in range(0, len(rows), MAX_TABLE_ROWS)]

    chunks = []
    for g_idx, group in enumerate(row_groups):
        markdown = _rows_to_markdown(headers, group)
        raw_text = markdown
        content = _contextualize(meta, section.section_path, page_number, markdown)
        suffix = f":g{g_idx}" if len(row_groups) > 1 else ""
        chunk_id = f"{table_id}{suffix}"
        chunks.append(
            {
                "chunk_id": chunk_id,
                "document_id": meta.document_id,
                "version": meta.version,
                "tenant_id": meta.tenant_id,
                "parent_section_id": section.section_id,
                "chunk_type": "table",
                "section_path": section.section_path,
                "page_number": page_number,
                "customer_name": meta.customer_name,
                "account_owner": meta.account_owner,
                "meeting_date": meta.meeting_date,
                "content": content,
                "raw_text": raw_text,
                "table_json": {**table_json, "rows": group, "row_count": len(group)},
                "table_id": table_id,
                "token_count": token_count(content),
            }
        )
    return chunks


def _rows_to_markdown(headers: list[str], rows: list[list[str]]) -> str:
    if not headers and not rows:
        return ""
    header_row = "| " + " | ".join(h or "" for h in headers) + " |"
    sep_row = "| " + " | ".join(["---"] * max(1, len(headers))) + " |"
    out = [header_row, sep_row]
    for r in rows:
        out.append("| " + " | ".join((c or "") for c in r) + " |")
    return "\n".join(out)


def _chunk_figure(meta: DocMeta, section: _Section, el: dict[str, Any]) -> dict[str, Any]:
    page_number = el["page_number"]
    body = el.get("text") or f"Figure on page {page_number}"
    content = _contextualize(meta, section.section_path, page_number, body)
    return {
        "chunk_id": el["element_id"],
        "document_id": meta.document_id,
        "version": meta.version,
        "tenant_id": meta.tenant_id,
        "parent_section_id": section.section_id,
        "chunk_type": "figure",
        "section_path": section.section_path,
        "page_number": page_number,
        "customer_name": meta.customer_name,
        "account_owner": meta.account_owner,
        "meeting_date": meta.meeting_date,
        "content": content,
        "raw_text": body,
        "table_json": None,
        "table_id": None,
        "token_count": token_count(content),
    }


def build_chunks(meta: DocMeta, elements: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Main entry point. Returns a flat list of chunk dicts ready to persist
    (see `chunks` table in db.py). Deterministic: reprocessing the same
    elements produces the same chunk_ids, so the pipeline can delete+reinsert
    rather than accumulate duplicates."""
    elements = list(elements)
    elements.sort(key=lambda e: (e["page_number"], (e.get("bbox") or [0, 0, 0, 0])[1]))
    sections = _group_into_sections(meta.document_id, meta.version, elements)

    all_chunks: list[dict[str, Any]] = []
    for section in sections:
        # Tables/figures are pulled out and chunked independently -- never
        # merged into a surrounding narrative passage.
        for el in section.elements:
            if el["element_type"] == "table" and el.get("table_json"):
                all_chunks.extend(_chunk_table(meta, section, el))
            elif el["element_type"] == "figure":
                all_chunks.append(_chunk_figure(meta, section, el))
        all_chunks.extend(_build_passages_for_section(meta, section))

    now = _now()
    for c in all_chunks:
        c["content_hash"] = content_hash(c["content"])
        c["created_at"] = now
        c["updated_at"] = now
    return all_chunks
