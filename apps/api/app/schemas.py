from __future__ import annotations

from typing import Any

from pydantic import BaseModel


class DocumentVersionOut(BaseModel):
    document_id: str
    version: int
    sha256: str
    status: str
    stage: str
    error: str | None = None
    size_bytes: int | None = None
    page_count: int | None = None
    table_count: int = 0
    figure_count: int = 0
    heading_count: int = 0
    ocr_pages: int = 0
    ocr_confidence: float | None = None
    parser: str | None = None
    parser_version: str | None = None
    duplicate_of: str | None = None
    created_at: str
    updated_at: str


class DocumentOut(BaseModel):
    document_id: str
    tenant_id: str
    filename: str
    customer_name: str | None = None
    account_owner: str | None = None
    meeting_date: str | None = None
    classification: str | None = None
    current_version: int
    created_at: str
    latest: DocumentVersionOut | None = None


class ProcessingEventOut(BaseModel):
    stage: str
    status: str
    message: str | None = None
    created_at: str


class ElementOut(BaseModel):
    element_id: str
    page_number: int
    element_type: str
    heading_level: int | None = None
    section_path: list[str] = []
    text: str | None = None
    markdown: str | None = None
    bbox: list[float] | None = None
    confidence: float | None = None
    table_json: dict[str, Any] | None = None
    figure_path: str | None = None
    ocr: bool = False
    include_in_search: bool = True


class UploadResultItem(BaseModel):
    filename: str
    document_id: str | None = None
    version: int | None = None
    status: str
    message: str | None = None


class DocumentStats(BaseModel):
    total: int
    completed: int
    processing: int
    failed: int
    quarantined: int
    duplicate: int
    total_pages: int
    total_tables: int
    total_figures: int
