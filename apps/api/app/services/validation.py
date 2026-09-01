"""Pre-processing validation — mirrors the blueprint's ingestion validation gate.

Malware scanning is stubbed (no AV engine available locally) but the
interface and audit-log shape match what a real scanner integration would
produce, so wiring Microsoft Defender / an AV connector later is additive.
"""
from __future__ import annotations

from dataclasses import dataclass

MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024  # 100 MB
MAX_PAGES = 1000


@dataclass
class ValidationResult:
    ok: bool
    reason: str | None = None
    detail: str | None = None


def check_signature(data: bytes) -> ValidationResult:
    if not data.startswith(b"%PDF-"):
        return ValidationResult(False, "invalid_signature", "File does not begin with a %PDF- header.")
    return ValidationResult(True)


def check_size(data: bytes) -> ValidationResult:
    if len(data) == 0:
        return ValidationResult(False, "empty_file", "Uploaded file is empty.")
    if len(data) > MAX_FILE_SIZE_BYTES:
        return ValidationResult(
            False,
            "file_too_large",
            f"{len(data)} bytes exceeds the {MAX_FILE_SIZE_BYTES} byte limit.",
        )
    return ValidationResult(True)


def check_page_count(page_count: int) -> ValidationResult:
    if page_count == 0:
        return ValidationResult(False, "no_pages", "Document contains no pages.")
    if page_count > MAX_PAGES:
        return ValidationResult(
            False,
            "too_many_pages",
            f"{page_count} pages exceeds the {MAX_PAGES} page limit.",
        )
    return ValidationResult(True)


def malware_scan_stub(data: bytes) -> ValidationResult:
    """Simulated scan — always clean locally. Real scan happens before this
    substitution is retired (see docs/decisions/0001)."""
    return ValidationResult(True, detail="clean (simulated — no AV engine in local dev)")
