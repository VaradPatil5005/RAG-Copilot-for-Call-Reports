"""Enterprise RAG Copilot — API entrypoint.

Local-dev substitution map (no Azure subscription yet):
  - Azure Data Lake Storage Gen2  -> local filesystem (./data/raw, ./data/derived)
  - Event Grid + Service Bus      -> in-process async queue + worker pool (Phase 2, done)
  - Document Intelligence Layout  -> PyMuPDF/pdfplumber + Tesseract OCR extractor (Phase 2, done)
  - Azure Cosmos DB / Azure SQL   -> local SQLite metadata store (Phase 2, done)
  - Azure AI Search (hybrid)      -> SQLite FTS5 (BM25) + hnswlib (HNSW) + RRF (Phase 3, done)
  - Azure OpenAI embeddings       -> fastembed/ONNX (BAAI/bge-small-en-v1.5) (Phase 3, done)
  - Azure AI Search semantic rank -> fastembed TextCrossEncoder (Phase 3, done)
  - Azure OpenAI GPT-4o Mini      -> pluggable LLM client: Gemini/Groq/Ollama
                                     if reachable, deterministic extractive
                                     fallback otherwise (Phase 4, done)
  - GraphRAG store (custom)       -> relational graph_nodes/graph_edges tables
                                     in the same SQLite DB (Phase 6.1, done)
  - Azure Key Vault / Managed ID  -> .env for local dev only, never committed (Phase 6)

Every substitution is isolated behind an interface in services/ so swapping
in real Azure services later is a config + adapter change, not a rewrite.
See docs/decisions/0001-local-dev-substitutions.md.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import db
from app.routers import auth, copilot, documents, evaluation, graph, retrieval, system
from app.services.pipeline import IngestionQueue


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    app.state.ingestion_queue = IngestionQueue()
    app.state.ingestion_queue.start()
    yield
    await app.state.ingestion_queue.stop()
    # Release the SQLite handle on shutdown -- on Windows, leaving this
    # open (e.g. a `uvicorn --reload` process left running in another
    # terminal) blocks any other process, including a test run, from
    # deleting or replacing the `data/` directory. See db.close_connection.
    db.close_connection()


app = FastAPI(
    title="Enterprise RAG Copilot API",
    description="Layout-aware hybrid RAG backend for call report intelligence.",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:4500"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(system.router)
app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(retrieval.router)
app.include_router(copilot.router)
app.include_router(evaluation.router)
app.include_router(graph.router)


@app.get("/")
def root() -> dict:
    return {"service": "enterprise-rag-copilot-api", "status": "ok", "phase": "6.1-graphrag"}
