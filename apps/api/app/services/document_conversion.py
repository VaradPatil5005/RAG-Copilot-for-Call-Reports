"""Upload format detection + Word -> PDF conversion.

The whole ingestion pipeline (layout extraction, OCR fallback, figure
crops, page-level citations, the in-browser PDF viewer, disaster
recovery) is built around a PDF. Rather than fork every one of those
paths, a Word upload is converted to a PDF *once*, at upload time, and
from then on is indistinguishable from a native PDF upload. The original
Word bytes are kept next to it in the raw zone (`source.docx` /
`source.doc`) so nothing the user uploaded is ever lost.

Formats:
  - .pdf  -- accepted as-is (magic bytes `%PDF-`).
  - .docx -- parsed here with the standard library only (zipfile +
             ElementTree) and rendered to PDF with PyMuPDF's Story API.
             No new dependency, no external process.
  - .doc  -- legacy binary Word (OLE2). There is no safe pure-Python
             parser, so it is converted by a headless LibreOffice
             (`soffice`) when one is installed; otherwise it is rejected
             with an actionable message ("save as .docx").

Anything else -- including a file whose extension and content disagree,
e.g. an .exe renamed to .pdf -- is rejected. Detection is by content
(magic bytes + container structure), never by extension or the
client-supplied Content-Type alone.

Hostile-input hardening for .docx (an attacker controls every byte):
  - zip bomb: caps on entry count, total uncompressed size, per-entry
    compression ratio, all checked from the central directory *before*
    anything is decompressed;
  - XML entity attacks (billion laughs / XXE): any DOCTYPE or ENTITY
    declaration is refused outright -- legitimate OOXML never has one;
  - macro-enabled documents renamed to .docx (vbaProject.bin) are
    refused;
  - rendering is capped at validation.MAX_PAGES pages.
"""
from __future__ import annotations

import html
import io
import re
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

from app.services import validation

PDF_MAGIC = b"%PDF-"
ZIP_MAGIC = b"PK\x03\x04"
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

ALLOWED_EXTENSIONS = {".pdf": "pdf", ".docx": "docx", ".doc": "doc"}

# zip-bomb guards (checked on the central directory, before decompression)
MAX_ZIP_ENTRIES = 2000
MAX_TOTAL_UNCOMPRESSED = 200 * 1024 * 1024
MAX_DOCUMENT_XML_BYTES = 60 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200

LIBREOFFICE_TIMEOUT_SECONDS = 120

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{W_NS}}}"


class ConversionError(Exception):
    """Raised with a user-facing message when a file can't be accepted."""

    def __init__(self, reason: str, message: str):
        super().__init__(message)
        self.reason = reason
        self.message = message


@dataclass
class PreparedUpload:
    kind: str                 # "pdf" | "docx" | "doc"
    pdf_bytes: bytes          # what the pipeline ingests
    original_bytes: bytes     # exactly what the user uploaded
    original_extension: str   # ".pdf" | ".docx" | ".doc"


def extension_of(filename: str) -> str:
    return Path(filename or "").suffix.lower()


def detect_kind(data: bytes) -> str | None:
    """Content-based detection. Returns "pdf" | "docx" | "doc" | None."""
    if data.startswith(PDF_MAGIC):
        return "pdf"
    if data.startswith(OLE_MAGIC):
        return "doc"
    if data.startswith(ZIP_MAGIC):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = set(zf.namelist())
        except zipfile.BadZipFile:
            return None
        if "word/document.xml" in names and "[Content_Types].xml" in names:
            return "docx"
    return None


def prepare_upload(filename: str, data: bytes) -> PreparedUpload:
    """Validates an upload and returns the PDF bytes to ingest.

    Raises ConversionError with a user-facing message on any rejection."""
    ext = extension_of(filename)
    if ext not in ALLOWED_EXTENSIONS:
        raise ConversionError(
            "unsupported_type",
            "File cannot be accepted. Only PDF and Word documents (.pdf, .docx, .doc) are allowed.",
        )
    size = validation.check_size(data)
    if not size.ok:
        raise ConversionError(size.reason or "invalid_size", size.detail or "Invalid file size.")

    kind = detect_kind(data)
    expected = ALLOWED_EXTENSIONS[ext]
    if kind != expected:
        raise ConversionError(
            "content_mismatch",
            f"File cannot be accepted. Its contents are not a valid {ext} document.",
        )

    if kind == "pdf":
        return PreparedUpload("pdf", data, data, ext)
    if kind == "docx":
        return PreparedUpload("docx", docx_to_pdf(data), data, ext)
    return PreparedUpload("doc", doc_to_pdf(data), data, ext)


# --------------------------------------------------------------------------
# .docx
# --------------------------------------------------------------------------


def _check_zip_safety(zf: zipfile.ZipFile) -> None:
    infos = zf.infolist()
    if len(infos) > MAX_ZIP_ENTRIES:
        raise ConversionError("zip_bomb", "File cannot be accepted. The Word document structure is invalid.")
    total = 0
    for info in infos:
        total += info.file_size
        if info.compress_size > 0 and info.file_size > 1024 * 1024:
            if info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                raise ConversionError("zip_bomb", "File cannot be accepted. The Word document is malformed.")
        name = info.filename.lower()
        if name.endswith("vbaproject.bin") or name.endswith("vbadata.xml"):
            raise ConversionError(
                "macro_document",
                "File cannot be accepted. Macro-enabled Word documents are not allowed.",
            )
    if total > MAX_TOTAL_UNCOMPRESSED:
        raise ConversionError("zip_bomb", "File cannot be accepted. The Word document is too large when expanded.")


_DTD_RE = re.compile(rb"<!\s*(DOCTYPE|ENTITY)", re.IGNORECASE)


def _safe_parse_xml(raw: bytes) -> ET.Element:
    # Any NUL byte means a UTF-16/32 encoding, where a byte-level DOCTYPE
    # scan could be evaded -- Word always writes UTF-8, so refuse the rest.
    # With UTF-8 guaranteed, "no DOCTYPE/ENTITY" means no DTD at all, which
    # rules out XXE and entity-expansion attacks before expat ever runs.
    if b"\x00" in raw or raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        raise ConversionError("xml_encoding", "File cannot be accepted. The Word document uses an unsupported encoding.")
    if _DTD_RE.search(raw):
        raise ConversionError("xml_entities", "File cannot be accepted. The Word document contains forbidden XML.")
    try:
        return ET.fromstring(raw)
    except ET.ParseError as exc:
        raise ConversionError("malformed_docx", "File cannot be accepted. The Word document is corrupted.") from exc


def _read_member(zf: zipfile.ZipFile, name: str, limit: int) -> bytes | None:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return None
    if info.file_size > limit:
        raise ConversionError("zip_bomb", "File cannot be accepted. The Word document is too large when expanded.")
    with zf.open(info) as fh:
        raw = fh.read(limit + 1)
    if len(raw) > limit:
        raise ConversionError("zip_bomb", "File cannot be accepted. The Word document is too large when expanded.")
    return raw


def _style_names(zf: zipfile.ZipFile) -> dict[str, str]:
    """styleId -> lower-cased style name ("heading 1", "title", ...).
    Style IDs are localized/customizable; names are the stable part."""
    raw = _read_member(zf, "word/styles.xml", 20 * 1024 * 1024)
    if not raw:
        return {}
    root = _safe_parse_xml(raw)
    out: dict[str, str] = {}
    for st in root.iter(f"{W}style"):
        sid = st.get(f"{W}styleId")
        name_el = st.find(f"{W}name")
        if sid and name_el is not None and name_el.get(f"{W}val"):
            out[sid] = name_el.get(f"{W}val", "").lower()
    return out


def _on(el: ET.Element | None) -> bool:
    """OOXML toggle property (<w:b/>, <w:b w:val="0"/> ...)."""
    if el is None:
        return False
    return el.get(f"{W}val", "true").lower() not in ("0", "false", "off", "none")


def _runs_html(container: ET.Element) -> str:
    parts: list[str] = []
    for node in container:
        tag = node.tag
        if tag == f"{W}r":
            rpr = node.find(f"{W}rPr")
            bold = _on(rpr.find(f"{W}b")) if rpr is not None else False
            italic = _on(rpr.find(f"{W}i")) if rpr is not None else False
            text: list[str] = []
            for child in node:
                if child.tag == f"{W}t":
                    text.append(html.escape(child.text or ""))
                elif child.tag == f"{W}tab":
                    text.append("&#160;&#160;&#160;&#160;")
                elif child.tag in (f"{W}br", f"{W}cr"):
                    text.append("<br/>")
                elif child.tag == f"{W}noBreakHyphen":
                    text.append("-")
            chunk = "".join(text)
            if not chunk:
                continue
            if bold:
                chunk = f"<b>{chunk}</b>"
            if italic:
                chunk = f"<i>{chunk}</i>"
            parts.append(chunk)
        elif tag in (f"{W}hyperlink", f"{W}smartTag", f"{W}ins", f"{W}fldSimple"):
            parts.append(_runs_html(node))
        elif tag == f"{W}sdt":
            content = node.find(f"{W}sdtContent")
            if content is not None:
                parts.append(_runs_html(content))
        # w:del (tracked deletions) is intentionally skipped
    return "".join(parts)


def _heading_level(p: ET.Element, styles: dict[str, str]) -> int | None:
    ppr = p.find(f"{W}pPr")
    if ppr is None:
        return None
    pstyle = ppr.find(f"{W}pStyle")
    if pstyle is not None:
        sid = pstyle.get(f"{W}val", "")
        name = styles.get(sid, sid.lower())
        if name == "title":
            return 1
        if name == "subtitle":
            return 2
        m = re.match(r"heading\s*([1-6])$", name) or re.match(r"heading([1-6])$", sid.lower())
        if m:
            return int(m.group(1))
    outline = ppr.find(f"{W}outlineLvl")
    if outline is not None:
        try:
            lvl = int(outline.get(f"{W}val", "9"))
        except ValueError:
            lvl = 9
        if 0 <= lvl <= 5:
            return lvl + 1
    return None


def _paragraph_html(p: ET.Element, styles: dict[str, str]) -> str:
    inner = _runs_html(p)
    level = _heading_level(p, styles)
    if level:
        return f"<h{level}>{inner}</h{level}>" if inner.strip() else ""
    ppr = p.find(f"{W}pPr")
    is_list = ppr is not None and ppr.find(f"{W}numPr") is not None
    if not inner.strip():
        return "<p>&#160;</p>"
    if is_list:
        return f"<p class='li'>&#8226;&#160;{inner}</p>"
    return f"<p>{inner}</p>"


def _table_html(tbl: ET.Element, styles: dict[str, str], depth: int) -> str:
    rows: list[str] = []
    for tr in tbl.findall(f"{W}tr"):
        cells: list[str] = []
        for tc in tr.findall(f"{W}tc"):
            span = 1
            tcpr = tc.find(f"{W}tcPr")
            if tcpr is not None:
                gs = tcpr.find(f"{W}gridSpan")
                if gs is not None:
                    try:
                        span = max(1, min(int(gs.get(f"{W}val", "1")), 50))
                    except ValueError:
                        span = 1
            content = _blocks_html(tc, styles, depth + 1)
            colspan = f" colspan='{span}'" if span > 1 else ""
            cells.append(f"<td{colspan}>{content}</td>")
        if cells:
            rows.append("<tr>" + "".join(cells) + "</tr>")
    if not rows:
        return ""
    return "<table>" + "".join(rows) + "</table>"


def _blocks_html(container: ET.Element, styles: dict[str, str], depth: int = 0) -> str:
    if depth > 8:  # pathological nesting
        return ""
    out: list[str] = []
    for node in container:
        if node.tag == f"{W}p":
            out.append(_paragraph_html(node, styles))
        elif node.tag == f"{W}tbl":
            out.append(_table_html(node, styles, depth))
        elif node.tag == f"{W}sdt":
            content = node.find(f"{W}sdtContent")
            if content is not None:
                out.append(_blocks_html(content, styles, depth + 1))
    return "".join(out)


_CSS = """
body { font-family: sans-serif; font-size: 10.5pt; line-height: 1.35; }
h1 { font-size: 20pt; font-weight: bold; margin: 10pt 0 6pt 0; }
h2 { font-size: 16pt; font-weight: bold; margin: 9pt 0 5pt 0; }
h3 { font-size: 13.5pt; font-weight: bold; margin: 8pt 0 4pt 0; }
h4, h5, h6 { font-size: 11.5pt; font-weight: bold; margin: 6pt 0 3pt 0; }
p { margin: 0 0 5pt 0; }
p.li { margin-left: 14pt; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 8pt 0; }
td { border: 0.6pt solid #444; padding: 3pt; vertical-align: top; font-size: 9.5pt; }
td p { margin: 0; }
"""


def docx_to_html(data: bytes) -> str:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ConversionError("malformed_docx", "File cannot be accepted. The Word document is corrupted.") from exc
    with zf:
        _check_zip_safety(zf)
        raw = _read_member(zf, "word/document.xml", MAX_DOCUMENT_XML_BYTES)
        if raw is None:
            raise ConversionError("malformed_docx", "File cannot be accepted. The Word document is corrupted.")
        styles = _style_names(zf)
        root = _safe_parse_xml(raw)
    body = root.find(f"{W}body")
    if body is None:
        raise ConversionError("malformed_docx", "File cannot be accepted. The Word document is corrupted.")
    return _blocks_html(body, styles)


def _plain_text(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", fragment)).replace("\xa0", " ").strip()


def html_to_pdf(body_html: str) -> bytes:
    import pymupdf as fitz  # local import, same as pipeline.py

    story = fitz.Story(html=f"<body>{body_html}</body>", user_css=_CSS)
    buf = io.BytesIO()
    writer = fitz.DocumentWriter(buf)
    mediabox = fitz.paper_rect("a4")
    where = mediabox + (54, 54, -54, -54)  # 0.75in margins
    more = 1
    pages = 0
    while more:
        pages += 1
        if pages > validation.MAX_PAGES:
            writer.close()
            raise ConversionError(
                "too_many_pages",
                f"File cannot be accepted. The document exceeds the {validation.MAX_PAGES} page limit.",
            )
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()
    return buf.getvalue()


def docx_to_pdf(data: bytes) -> bytes:
    body_html = docx_to_html(data)
    if not _plain_text(body_html):
        raise ConversionError("empty_document", "File cannot be accepted. The Word document contains no text.")
    return html_to_pdf(body_html)


# --------------------------------------------------------------------------
# .doc (legacy binary) -- LibreOffice when available
# --------------------------------------------------------------------------


def _libreoffice_binary() -> str | None:
    for name in ("soffice", "libreoffice"):
        path = shutil.which(name)
        if path:
            return path
    return None


def libreoffice_available() -> bool:
    return _libreoffice_binary() is not None


def doc_to_pdf(data: bytes) -> bytes:
    binary = _libreoffice_binary()
    if binary is None:
        raise ConversionError(
            "doc_conversion_unavailable",
            "Legacy .doc files can't be converted on this server. Please open the file in Word and "
            "save it as .docx (or PDF), then upload it again.",
        )
    with tempfile.TemporaryDirectory(prefix="tathyx-doc-") as tmp:
        src = Path(tmp) / "input.doc"
        src.write_bytes(data)
        profile = Path(tmp) / "profile"
        try:
            subprocess.run(  # noqa: S603 -- fixed argv, no shell, input path is ours
                [
                    binary,
                    f"-env:UserInstallation=file:///{profile.as_posix().lstrip('/')}",
                    "--headless",
                    "--norestore",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    tmp,
                    str(src),
                ],
                check=True,
                timeout=LIBREOFFICE_TIMEOUT_SECONDS,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            raise ConversionError(
                "doc_conversion_failed", "File cannot be accepted. The .doc file could not be converted."
            ) from exc
        out = Path(tmp) / "input.pdf"
        if not out.exists():
            raise ConversionError(
                "doc_conversion_failed", "File cannot be accepted. The .doc file could not be converted."
            )
        pdf = out.read_bytes()
    if not pdf.startswith(PDF_MAGIC):
        raise ConversionError("doc_conversion_failed", "File cannot be accepted. The .doc file could not be converted.")
    return pdf
