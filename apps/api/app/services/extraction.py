"""Layout-aware extraction — local substitute for Azure AI Document Intelligence
Layout (see docs/decisions/0001-local-dev-substitutions.md).

Pipeline per page:
  1. Try native text layer (PyMuPDF) with font-size heuristics for headings.
  2. If a page has (almost) no extractable text, treat it as scanned and
     fall back to Tesseract OCR on a rasterized image of the page.
  3. Tables are extracted with pdfplumber (row/column structure).
  4. Embedded images are extracted as figures, each additionally OCR'd for
     any in-image text (chart axis labels, etc).

Output is the canonical, vendor-independent element schema described in the
blueprint — same shape Azure AI Document Intelligence output would be mapped
into, so swapping the extractor later doesn't change anything downstream.
"""
from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pymupdf as fitz  # PyMuPDF (modern import name)
import pdfplumber
import pytesseract
from PIL import Image

PARSER_NAME = "pymupdf-layout+tesseract-ocr"
try:
    _PYMUPDF_VERSION = fitz.version[0]
except Exception:
    _PYMUPDF_VERSION = "unknown"
PARSER_VERSION = f"pymupdf-{_PYMUPDF_VERSION}"

OCR_TEXT_THRESHOLD = 20  # chars; below this a page is treated as scanned
HEADING_RATIO_L1 = 1.50
HEADING_RATIO_L2 = 1.25
HEADING_RATIO_L3 = 1.08


@dataclass
class ExtractionStats:
    page_count: int = 0
    table_count: int = 0
    figure_count: int = 0
    heading_count: int = 0
    ocr_pages: int = 0
    ocr_confidences: list[float] = field(default_factory=list)

    @property
    def ocr_confidence(self) -> float | None:
        if not self.ocr_confidences:
            return None
        return sum(self.ocr_confidences) / len(self.ocr_confidences)


def _norm_bbox(rect: fitz.Rect, page_rect: fitz.Rect) -> list[float]:
    w, h = page_rect.width or 1, page_rect.height or 1
    return [
        round(max(0.0, rect.x0) / w, 4),
        round(max(0.0, rect.y0) / h, 4),
        round(min(w, rect.x1) / w, 4),
        round(min(h, rect.y1) / h, 4),
    ]


def _rows_to_markdown(rows: list[list[str | None]]) -> str:
    if not rows:
        return ""
    cleaned = [[(c or "").strip().replace("\n", " ") for c in r] for r in rows]
    header, *body = cleaned
    out = ["| " + " | ".join(header) + " |", "| " + " | ".join(["---"] * len(header)) + " |"]
    for r in body:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)


def _median_font_size(doc: fitz.Document) -> float:
    """Character-weighted mode of body font size — robust to a handful of
    large title spans skewing a simple unique-value median on short docs."""
    from collections import Counter

    weighted: Counter[float] = Counter()
    for page in doc:
        for block in page.get_text("dict").get("blocks", []):
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if text.strip():
                        weighted[round(span["size"], 1)] += len(text)
    if not weighted:
        return 10.0
    return weighted.most_common(1)[0][0]


HEADING_MAX_CHARS = 100


def _heading_level(size: float, body_size: float, text: str) -> int | None:
    if len(text) > HEADING_MAX_CHARS or "\n" in text.strip():
        return None
    ratio = size / body_size if body_size else 1
    if ratio >= HEADING_RATIO_L1:
        return 1
    if ratio >= HEADING_RATIO_L2:
        return 2
    if ratio >= HEADING_RATIO_L3:
        return 3
    return None


def _ocr_page(page: fitz.Page) -> tuple[str, float]:
    pix = page.get_pixmap(matrix=fitz.Matrix(2.2, 2.2))
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    words = []
    confs = []
    for i, word in enumerate(data["text"]):
        if word.strip():
            words.append(word)
            try:
                c = float(data["conf"][i])
                if c >= 0:
                    confs.append(c)
            except (ValueError, TypeError):
                pass
    text = " ".join(words)
    mean_conf = (sum(confs) / len(confs) / 100.0) if confs else 0.5
    return text, mean_conf


def _detect_headers_footers(text_elements: list[dict[str, Any]], page_count: int) -> None:
    """Mark repeated top/bottom strings across pages as page_header/page_footer."""
    if page_count < 3:
        return
    from collections import Counter

    top_counter: Counter[str] = Counter()
    bottom_counter: Counter[str] = Counter()
    for el in text_elements:
        bbox = el["bbox"]
        norm = el["text"].strip()
        if not norm or len(norm) > 120:
            continue
        if bbox[1] < 0.07:
            top_counter[norm] += 1
        if bbox[3] > 0.93:
            bottom_counter[norm] += 1
    threshold = max(2, int(page_count * 0.5))
    repeated_top = {t for t, c in top_counter.items() if c >= threshold}
    repeated_bottom = {t for t, c in bottom_counter.items() if c >= threshold}
    for el in text_elements:
        norm = el["text"].strip()
        if norm in repeated_top:
            el["element_type"] = "page_header"
            el["include_in_search"] = False
        elif norm in repeated_bottom:
            el["element_type"] = "page_footer"
            el["include_in_search"] = False


def extract(
    pdf_path: str,
    document_id: str,
    version: int,
    figures_dir: Path,
) -> tuple[list[dict[str, Any]], ExtractionStats]:
    stats = ExtractionStats()
    elements: list[dict[str, Any]] = []
    section_stack: list[dict[str, Any]] = []

    doc = fitz.open(pdf_path)
    stats.page_count = doc.page_count
    body_size = _median_font_size(doc)

    try:
        plumber_doc = pdfplumber.open(pdf_path)
    except Exception:
        plumber_doc = None

    text_elements: list[dict[str, Any]] = []
    seq = 0

    for page_index in range(doc.page_count):
        page = doc[page_index]
        page_number = page_index + 1
        page_rect = page.rect
        raw_text = page.get_text("text")

        if len(raw_text.strip()) < OCR_TEXT_THRESHOLD:
            # Scanned / image-only page -> OCR fallback
            ocr_text, confidence = _ocr_page(page)
            stats.ocr_pages += 1
            stats.ocr_confidences.append(confidence)
            if ocr_text.strip():
                seq += 1
                el = {
                    "element_id": f"{document_id}:p{page_number}:e{seq}",
                    "document_id": document_id,
                    "version": version,
                    "page_number": page_number,
                    "element_type": "paragraph",
                    "heading_level": None,
                    "text": ocr_text.strip(),
                    "markdown": ocr_text.strip(),
                    "bbox": [0.0, 0.0, 1.0, 1.0],
                    "confidence": round(confidence, 3),
                    "table_json": None,
                    "figure_path": None,
                    "ocr": True,
                    "include_in_search": True,
                    "source_parser": "tesseract-ocr",
                }
                text_elements.append(el)
        else:
            for block in page.get_text("dict").get("blocks", []):
                if block.get("type") != 0:
                    continue
                lines_out = []
                max_size = 0.0
                for line in block.get("lines", []):
                    line_text = "".join(s.get("text", "") for s in line.get("spans", []))
                    if line_text.strip():
                        lines_out.append(line_text)
                    for span in line.get("spans", []):
                        max_size = max(max_size, span.get("size", 0))
                block_text = "\n".join(lines_out).strip()
                if not block_text:
                    continue
                level = _heading_level(max_size, body_size, block_text)
                bbox = _norm_bbox(fitz.Rect(block["bbox"]), page_rect)
                seq += 1
                el = {
                    "element_id": f"{document_id}:p{page_number}:e{seq}",
                    "document_id": document_id,
                    "version": version,
                    "page_number": page_number,
                    "element_type": "heading" if level else "paragraph",
                    "heading_level": level,
                    "text": block_text,
                    "markdown": block_text,
                    "bbox": bbox,
                    "confidence": 0.98,
                    "table_json": None,
                    "figure_path": None,
                    "ocr": False,
                    "include_in_search": True,
                    "source_parser": PARSER_NAME,
                }
                text_elements.append(el)

        # Tables (pdfplumber)
        if plumber_doc is not None:
            try:
                pl_page = plumber_doc.pages[page_index]
                tables = pl_page.find_tables()
            except Exception:
                tables = []
            for t_idx, table in enumerate(tables, start=1):
                try:
                    rows = table.extract()
                except Exception:
                    continue
                if not rows or not any(any(c for c in r) for r in rows):
                    continue
                headers = rows[0] if rows else []
                bbox = _norm_bbox(
                    fitz.Rect(*table.bbox), page_rect
                ) if hasattr(table, "bbox") else [0, 0, 1, 1]
                table_id = f"{document_id}:p{page_number}:t{t_idx}"
                stats.table_count += 1
                text_elements.append(
                    {
                        "element_id": table_id,
                        "document_id": document_id,
                        "version": version,
                        "page_number": page_number,
                        "element_type": "table",
                        "heading_level": None,
                        "text": " | ".join(h or "" for h in headers),
                        "markdown": _rows_to_markdown(rows),
                        "bbox": bbox,
                        "confidence": 0.9,
                        "table_json": {
                            "table_id": table_id,
                            "headers": headers,
                            "rows": rows[1:],
                            "row_count": max(0, len(rows) - 1),
                            "col_count": len(headers),
                        },
                        "figure_path": None,
                        "ocr": False,
                        "include_in_search": True,
                        "source_parser": "pdfplumber",
                    }
                )

        # Figures (embedded images)
        seen_xrefs: set[int] = set()
        for img_idx, img in enumerate(page.get_images(full=True), start=1):
            xref = img[0]
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)
            try:
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                ext = base_image.get("ext", "png")
                if len(image_bytes) < 2000:
                    continue  # skip tiny icons/decorative artifacts
                figure_id = f"{document_id}:p{page_number}:f{img_idx}"
                fig_path = figures_dir / f"f{page_number}_{img_idx}.{ext}"
                fig_path.write_bytes(image_bytes)
                rects = page.get_image_rects(xref)
                bbox = _norm_bbox(rects[0], page_rect) if rects else [0, 0, 1, 1]
                ocr_caption = ""
                try:
                    pil_img = Image.open(io.BytesIO(image_bytes))
                    ocr_caption = pytesseract.image_to_string(pil_img).strip()[:400]
                except Exception:
                    pass
                stats.figure_count += 1
                text_elements.append(
                    {
                        "element_id": figure_id,
                        "document_id": document_id,
                        "version": version,
                        "page_number": page_number,
                        "element_type": "figure",
                        "heading_level": None,
                        "text": ocr_caption or f"Figure extracted from page {page_number}",
                        "markdown": ocr_caption,
                        "bbox": bbox,
                        "confidence": 0.85,
                        "table_json": None,
                        "figure_path": f"f{page_number}_{img_idx}.{ext}",
                        "ocr": bool(ocr_caption),
                        "include_in_search": True,
                        "source_parser": "pymupdf-image-extract",
                    }
                )
            except Exception:
                continue

    if plumber_doc is not None:
        plumber_doc.close()

    _detect_headers_footers(text_elements, stats.page_count)

    # Build section hierarchy in reading order (page, then position on page)
    text_elements.sort(key=lambda e: (e["page_number"], e["bbox"][1]))
    for el in text_elements:
        if el["element_type"] == "heading" and el["heading_level"]:
            level = el["heading_level"]
            while section_stack and section_stack[-1]["level"] >= level:
                section_stack.pop()
            section_stack.append({"level": level, "title": el["text"][:120]})
            stats.heading_count += 1
        el["section_path"] = [s["title"] for s in section_stack]
        elements.append(el)

    doc.close()
    return elements, stats
