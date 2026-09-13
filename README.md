# Enterprise RAG Copilot with Multi-Agent Decision Intelligence for Call Reports

> **A layout-aware, hybrid-retrieval RAG platform for enterprise call reports featuring an 11-agent Decision Intelligence Layer, SQL-enforced ACL security, two-stage citation verification, and reachability-gated graceful degradation.**  
> *Architected and developed by [Varad Patil](https://github.com/VaradPatil5005)*

[![CI & Integration Tests](https://img.shields.io/badge/tests-57%2F57%20passing-emerald.svg)]()
[![Architecture](https://img.shields.io/badge/architecture-11--Agent%20Decision%20Intelligence-blue.svg)]()
[![Retrieval Engine](https://img.shields.io/badge/retrieval-Hybrid%20BM25%20%2B%20HNSW%20%2B%20RRF%20%2B%20Cross--Encoder-orange.svg)]()
[![Knowledge Graph](https://img.shields.io/badge/graph-GraphRAG%20Cross--Document%20Traversal-purple.svg)]()
[![Citation Guardrail](https://img.shields.io/badge/citations-Two--Stage%20Verified%20(Existence%20%2B%20Support)-green.svg)]()
[![Security](https://img.shields.io/badge/security-Pre--Retrieval%20SQL%20ACL%20Filtering-red.svg)]()
[![License](https://img.shields.io/badge/license-MIT-lightgrey.svg)]()

---

## Table of Contents
1. [Abstract](#abstract)
2. [Detailed Architecture](#detailed-architecture)
   - [2.1 High-Level Request-Time Architecture](#21-high-level-request-time-architecture)
   - [2.2 Ingestion Pipeline & Layout-Aware Contextual Chunking](#22-ingestion-pipeline--layout-aware-contextual-chunking)
   - [2.3 Multi-Agent Decision Intelligence Layer (11 Autonomous Agents)](#23-multi-agent-decision-intelligence-layer-11-autonomous-agents)
   - [2.4 Hybrid Retrieval & Reciprocal Rank Fusion (RRF)](#24-hybrid-retrieval--reciprocal-rank-fusion-rrf)
   - [2.5 Zero-Trust Security & Pre-Generation SQL ACL Filtering](#25-zero-trust-security--pre-generation-sql-acl-filtering)
   - [2.6 Two-Stage Citation Validation & Hallucination Guardrail](#26-two-stage-citation-validation--hallucination-guardrail)
   - [2.7 Reachability-Gated Provider Abstraction & Resilient Fallbacks](#27-reachability-gated-provider-abstraction--resilient-fallbacks)
3. [Research References](#research-references)
4. [Overview](#overview)
5. [Key Features](#key-features)
6. [How It Is Different From Any Other Things](#how-it-is-different-from-any-other-things)
7. [How It Works (Operational Guide)](#how-it-works-operational-guide)
8. [Future Scope](#future-scope)
9. [Getting Started & Local Verification](#getting-started--local-verification)
10. [Author & Social Profiles](#author--social-profiles)

---

## Abstract

Enterprise call reports are complex, semi-structured documents dense with contractual terms, pricing commitments, executive approvals, and compliance flags. When financial analysts, loan officers, or audit teams query these archives, traditional generative search and naive Retrieval-Augmented Generation (RAG) pipelines introduce catastrophic failure modes: subtle hallucinated metrics, unverified citations, temporal contradictions between conflicting reports, and unauthorized data leakage across user privilege tiers.

**Enterprise RAG Copilot** solves these challenges through a production-grade, mathematically verified architecture augmented by an **11-Agent Decision Intelligence Layer**. Rather than treating retrieval and generation as a brittle two-step process, the platform executes a stratified workflow across four operational layers:

1. **Routing & Query Expansion:** An autonomous Query Router classifies questions into five distinct topological shapes (*Lookup*, *Comparison*, *Trend*, *Multi-Hop*, *Graph Relationship*) and executes contextual alias/temporal expansion.
2. **Hybrid & Graph Retrieval:** Dense vector retrieval (`hnswlib`, cosine similarity) is fused with lexical sparse search (SQLite FTS5 BM25) via Reciprocal Rank Fusion (RRF), cross-encoder neural reranking, parent-child context expansion, and GraphRAG entity-relationship network traversal.
3. **Structured Synthesis & Reasoning:** Grounded LLM generation enforces structured JSON schemas, temporal contradiction resolution (detecting negation flips across document timelines), and Bounded Agentic Retrieval that autonomously detects coverage gaps and executes up to three iterative retrieval passes.
4. **Verification, Security & Observability:** Strict retrieval-time SQL ACL predicates exclude unauthorized documents before context reaches the model; every citation undergoes independent two-stage validation (existence check + semantic token/embedding support check); and an observability dashboard tracks stage-by-stage latencies, token costs, and abstention metrics.

The entire architecture is reachability-gated, providing seamless, deterministic local fallbacks when cloud AI endpoints are unreachable, ensuring 100% pipeline durability.

---

## Detailed Architecture

### 2.1 High-Level Request-Time Architecture

```
                                      Browser Client
                     (Next.js 14 + Tailwind CSS + Perplexity-Style Workspace)
                                             │
                                   Bearer JWT Authentication
                                             │
                                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               FASTAPI BACKEND APPS/API                                 │
│                                                                                        │
│  /chat            Multi-Agent Pipeline ──► Agentic Retrieval ──► Citation Validation   │
│  /search          Hybrid BM25 + Vector HNSW ──► RRF ──► Cross-Encoder Reranker        │
│  /graph/query     GraphRAG Knowledge Graph Traversal ──► ACL Filtering ──► Citations   │
│  /documents       Upload ──► Layout Extraction ──► OCR ──► Ingestion Pipeline          │
│  /observability   Latency Breakdowns ──► Cost Tracking ──► Failure Logs ──► Metrics    │
│  /evaluation      Policy-Block Benchmarks ──► 317-Query Gold Set ──► Precision/Recall  │
└────────────────────────────────────────────────────────────────────────────────────────┘
          │                 │                │                 │                │
          ▼                 ▼                ▼                 ▼                ▼
    SQLite Database    HNSWlib Index     SQLite FTS5     Local FileStore    NetworkX Graph
   - Metadata & Auth  - Dense Vectors  - BM25 Lexical    - Raw PDF Files   - Entity Nodes
   - Ingested Chunks  - Blue/Green     - Trigger-Synced  - Layout Sidecars - Relationship
   - Audit & Traces     Versioned        to Chunks       - Derived JSONs     Edges
```

---

### 2.2 Ingestion Pipeline & Layout-Aware Contextual Chunking

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────────────┐
│ PDF Upload  │────►│  Validation  │────►│ Layout & OCR │────►│ Multimodal Routing   │
│ Raw Report  │     │ Anti-Malware │     │ PDFPlumber   │     │ Low-Confidence Pages │
└─────────────┘     └──────────────┘     └──────────────┘     └──────────────────────┘
                                                                         │
┌────────────────────────────────────────────────────────────────────────┘
│
▼
┌─────────────────────────┐     ┌────────────────────────┐     ┌─────────────────────┐
│ Small-to-Big Chunking   │────►│ Content-Hash Caching   │────►│ Graph Extraction    │
│ 350-500 Token Passages  │     │ Skip Unchanged Passages│     │ Entities & Links    │
│ Document/Section Header │     │ Zero Redundant Embeds  │     │ Knowledge Network   │
└─────────────────────────┘     └────────────────────────┘     └─────────────────────┘
                                                                         │
                                        ┌────────────────────────────────┘
                                        ▼
                         ┌──────────────────────────────┐
                         │ Dual Ingestion Indexing      │
                         │ - Dense Vectors ──► hnswlib  │
                         │ - Sparse Lexical ──► FTS5    │
                         └──────────────────────────────┘
```

1. **Layout-Aware Parsing:** Ingests complex financial PDFs while preserving structural hierarchy, headers, footers, callout boxes, and tabular boundaries.
2. **Context-Prefixed Passages:** Each chunk is 350–500 tokens, prefixed with its complete hierarchical context path (`[Doc: Commercial Lending Report | Section: Risk Assessment | Page: 14]`).
3. **Table & Figure Isolation:** Financial tables and balance sheets are extracted as self-contained tabular chunks rather than split across token boundaries, bypassing semantic fuzziness with exact column filtering.
4. **Content-Hash Caching:** Every passage is keyed by a SHA-256 hash. Re-indexing identical documents takes O(1) time, skipping redundant vector embeddings.

---

### 2.3 Multi-Agent Decision Intelligence Layer (11 Autonomous Agents)

Rather than executing a single, monolithic, fragile prompt, the platform orchestrates **11 specialized autonomous agents** divided across four operational tiers:

```
                            ┌────────────────────────┐
                            │  Incoming User Query   │
                            └────────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     [1. Query Router Agent]                         [2. Query Rewrite Agent]
     Classifies topological shape                    Expands acronyms, aliases &
     (Lookup/Comparison/Trend/Graph)                 temporal anchors (Q3 vs 2024)
                 │                                               │
                 └───────────────────────┬───────────────────────┘
                                         ▼
                      ┌────────────────────────────────────┐
                      │ [3. Bounded Agentic Retrieval]     │
                      │ 1-3 Iterative passes filling gaps  │
                      └────────────────────────────────────┘
                                  │                │
            ┌─────────────────────┘                └─────────────────────┐
            ▼                                                            ▼
 [4. GraphRAG Traversal Agent]                               [5. Multimodal Vision Agent]
 Navigates cross-document entity                             Analyzes charts, diagrams &
 relationships (Borrower ──► Lender)                         scanned tables via vision model
            │                                                            │
            └─────────────────────┬──────────────────────────────────────┘
                                  ▼
                      ┌────────────────────────────────────┐
                      │ [6. Temporal & Contradiction Agent]│
                      │ Resolves timeline orderings &      │
                      │ detects cross-report negation flips│
                      └────────────────────────────────────┘
                                  │
                                  ▼
                      ┌────────────────────────────────────┐
                      │ [7. Structured Generation Copilot] │
                      │ Multi-turn conversation, few-shot  │
                      │ grounding, forced JSON schema      │
                      └────────────────────────────────────┘
                                  │
                                  ▼
                      ┌────────────────────────────────────┐
                      │ [8. Citation Validation Guardrail] │
                      │ Existence check + Semantic overlap │
                      │ Strips unbacked claims             │
                      └────────────────────────────────────┘
                                  │
                 ┌────────────────┴────────────────┐
                 ▼                                 ▼
    [9. PII Guardrail Agent]           [10. Self-Learning Agent]
    Redacts SSNs, card numbers,        Adjusts chunk utility weights
    and personal identifiers           based on user feedback
                                                   │
                                                   ▼
                                       [11. Lexicon Miner Agent]
                                       Extracts enterprise jargon &
                                       acronyms from new reports
```

#### Detailed Breakdown of the 11 Specialized Agents:
1. **Query Router Agent (`app/routing/query_router.py`):** Heuristic-first classifier that analyzes syntax and intent to categorize queries into 5 topologies (*Lookup*, *Comparison*, *Trend*, *Multi-Hop*, *Graph Relationship*). Automatically routes multi-entity questions to GraphRAG.
2. **Query Rewrite Agent (`app/retrieval/query_rewriter.py`):** Expands domain acronyms, resolves company aliases (e.g. 'Amex' -> 'American Express'), and replaces relative temporal expressions ('last quarter' -> 'Q3 2024').
3. **Bounded Agentic Retrieval Agent (`app/retrieval/agentic_retrieval.py`):** Analyzes the retrieved context for information gaps. If crucial data is missing, executes up to 3 bounded retrieval cycles with reformulated sub-queries—avoiding infinite loops while maximizing recall.
4. **GraphRAG Traversal Agent (`app/services/graph_service.py`):** Navigates a NetworkX knowledge graph constructed from entity-relationship pairs extracted during ingestion, unlocking insights that span multiple distinct PDF reports.
5. **Multimodal Vision Agent (`app/services/vision.py`):** Dispatched exclusively for low-confidence or scanned pages containing financial diagrams, balance sheets, and bar charts.
6. **Temporal & Contradiction Agent (`app/services/contradiction.py`):** Inspects timestamps across multiple call reports on the same client. Detects approval status flips (e.g. 'Loan Pending' in May -> 'Loan Approved' in June) and warns the user of contradictions.
7. **Structured Generation Copilot Agent (`app/services/generation.py`):** Generates grounded, cited answers formatted strictly in structured JSON (findings, citations, confidence, abstention), with automatic repair on schema validation failure.
8. **Citation Validation Guardrail Agent (`app/services/citation_validator.py`):** The primary integrity gatekeeper. Validates that every citation exists in the retrieved set and is semantically supported by the source text.
9. **PII Guardrail Agent (`app/services/pii.py`):** Regex- and NER-based scanner that redacts Social Security numbers, bank account details, and phone numbers before context reaches the LLM or user.
10. **Self-Learning Agent (`app/learning/feedback_loop.py`):** Continuously tracks user interactions (upvotes, downvotes, copied text, citation clicks) to re-weight chunk relevance scores over time.
11. **Lexicon Miner Agent (`app/learning/lexicon_miner.py`):** Scans newly uploaded call reports to discover enterprise acronyms and industry shorthand, keeping the query rewrite dictionary up-to-date.

---

### 2.4 Hybrid Retrieval & Reciprocal Rank Fusion (RRF)

Dense vector search alone struggles with exact alphanumeric identifiers (e.g., loan IDs, contract numbers, account codes), while pure BM25 lexical search misses conceptual semantic matches. Aethor OS unifies both:

1. **Dense Vector Search:** Fast cosine similarity over embeddings using `hnswlib` with fine-tuned parameters (M=8, efConstruction=800, efSearch=500).
2. **Lexical Sparse Search:** SQLite FTS5 index computing BM25 relevance scores over sanitized text tokens.
3. **Reciprocal Rank Fusion (RRF):** Fuses the ranked lists from both engines without requiring fragile score normalization:
   ```
   RRF_Score(d) = Σ [ 1 / (60 + rank_dense(d)) ] + Σ [ 1 / (60 + rank_sparse(d)) ]
   ```
4. **Cross-Encoder Neural Reranker:** Top K candidates are passed through a cross-encoder model that scores query-document pairs jointly, producing precise final rankings.
5. **Parent-Child Window Expansion:** When a small chunk (350 tokens) ranks high, the retrieval engine pulls in the adjacent sibling and parent chunks (up to 1,200 tokens) to ensure the LLM receives complete context.

---

### 2.5 Zero-Trust Security & Pre-Generation SQL ACL Filtering

In enterprise settings, post-generation redaction ('filtering after generation') is a fatal security flaw because unauthorized data has already leaked into the LLM's attention context and prompt memory.

Aethor OS implements **Pre-Retrieval SQL ACL Enforcement**:
- Every document version is tagged with access control lists (Allowed Roles, Allowed Departments, Clearance Level).
- When a user submits a query, their verified JWT claims are translated directly into a **parameterized SQL WHERE clause**.
- Unauthorized documents are mathematically excluded at the database index level before vector calculation or context construction.

---

### 2.6 Two-Stage Citation Validation & Hallucination Guardrail

Unlike standard RAG systems that display LLM-generated citations at face value, Aethor OS subjects every citation to a rigorous **Two-Stage Verification Gate**:

```
Model Generates Answer with Citation [Chunk-XYZ, Page 12]
                          │
                          ▼
             [Stage 1: Existence Check]
       Does Chunk-XYZ exist in the retrieved evidence set?
             ├── NO ──► Strip citation immediately & flag as unverified
             └── YES
                  │
                  ▼
             [Stage 2: Semantic Support Check]
       Does the chunk's text semantically entail the claim?
       - Token Overlap (Jaccard / N-gram) >= Threshold
       - Embedding Cosine Similarity >= 0.72
             ├── NO ──► Strip citation & log hallucination warning
             └── YES ──► Approve citation chip & link to PDF page
```

- **Principled Abstention:** When evidence is insufficient or conflicting, the copilot explicitly abstains with a structured reason code (`INSUFFICIENT_EVIDENCE`), refusing to fabricate information.

---

### 2.7 Reachability-Gated Provider Abstraction & Resilient Fallbacks

To ensure enterprise reliability, all AI dependencies sit behind a reachability-tested interface that selects the active provider dynamically:

```
Gemini API ────► Groq API ────► Local Ollama ────► Deterministic Heuristic Engine
(Primary)        (Fallback 1)   (Fallback 2)       (Zero-Network Fallback)
```

- If an API key is missing or internet access is severed, the system gracefully degrades to local models or the built-in deterministic heuristic fallback.
- The API schema, SSE event streams, and frontend contracts **never change** regardless of which provider is active.
- `/system/health` continuously reports active modes, latencies, and fallback statuses.

---

## Research References

Aethor OS synthesizes foundational paradigms and empirical breakthroughs from the following academic and industrial research literature:

1. **Lewis, P., Perez, E., Piktus, A., et al. (2020).**  
   *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks.* Advances in Neural Information Processing Systems (NeurIPS 2020).  
   *(Foundational framing for combining parametric memory with non-parametric retrieval).*  

2. **Cormack, G. V., Clarke, C. L., & Büttcher, S. (2009).**  
   *Reciprocal Rank Fusion Outperforms Condorcet and Individual Rank Learning Methods.* Proceedings of the 32nd International ACM SIGIR Conference on Research and Development in Information Retrieval, 758–759.  
   *(Mathematical basis for our hybrid BM25 and vector search fusion).*  

3. **Nogueira, R., & Cho, K. (2019).**  
   *Passage Re-ranking with BERT.* arXiv:1901.04085.  
   *(Theoretical grounding for our two-stage cross-encoder neural reranking pipeline).*  

4. **Edge, D., Trinh, H., Cheng, N., et al. (2024).**  
   *From Local to Global: A Graph RAG Approach to Query-Focused Summarization.* Microsoft Research Technical Report.  
   *(Architecture for entity-relationship knowledge graph construction and multi-hop graph traversal).*  

5. **Robertson, S., & Zaragoza, H. (2009).**  
   *The Probabilistic Relevance Framework: BM25 and Beyond.* Foundations and Trends in Information Retrieval, 3(4), 333–389.  
   *(Implementation standards for SQLite FTS5 lexical term weighting).*  

6. **Malkov, Y. A., & Yashunin, D. A. (2018).**  
   *Efficient and Robust Approximate Nearest Neighbor Search Using Hierarchical Navigable Small World Graphs.* IEEE Transactions on Pattern Analysis and Machine Intelligence, 42(4), 824–836.  
   *(Basis for the hnswlib dense vector index configuration).*  

7. **Es, S., James, J., Espinosa-Anke, L., & Schockaert, S. (2023).**  
   *RAGAS: Automated Evaluation of Retrieval Augmented Generation.* arXiv:2309.15217.  
   *(Metric formulations for faithfulness, answer relevancy, and context precision).*  

---

## Overview

### The Problem
Enterprise call reports document millions of dollars in credit decisions, interest rate concessions, covenant exceptions, and legal risks. When analysts search these archives:
- Keyword searches fail due to enterprise shorthand and varying terminology.
- Naive vector search misses exact numbers, table data, and client IDs.
- Standard LLM answers hallucinate facts and cite incorrect page numbers.
- Sensitive cross-departmental reports are accidentally exposed.

### The Solution
Enterprise RAG Copilot provides a hardened, audit-ready platform where **every answer is provably grounded, every citation is verified before display, and unauthorized data is blocked at the database boundary**.

| Dimension | Implementation in Enterprise RAG Copilot |
|---|---|
| **Retrieval Strategy** | Hybrid BM25 + HNSW Cosine + RRF + Cross-Encoder Reranker |
| **Context Expansion** | Small-to-Big Parent-Child + Table Chunk Isolation |
| **Cross-Doc Reasoning** | GraphRAG Entity-Relationship Knowledge Graph |
| **Integrity Verification** | 2-Stage Citation Validator (Existence + Semantic Support) |
| **Access Control** | SQL-Level Parameterized Predicate Enforcement |
| **Resilience** | Automatic Cloud -> Local -> Deterministic Fallback |
| **Evaluation Baseline** | 317-Query Stratified Gold Set + 8-Category Adversarial Testing |

---

## Key Features

- **Multi-Agent Decision Intelligence:** 11 specialized autonomous agents coordinate routing, extraction, retrieval, vision, and verification.
- **Hybrid Multi-Vector Retrieval:** Fuses lexical exact-matching (FTS5 BM25) with semantic embeddings (`hnswlib`), reranked by a neural cross-encoder.
- **Two-Stage Citation Verification:** Prevents fabricated citations by verifying chunk existence and semantic token/embedding overlap.
- **Principled Abstention Engine:** Explicitly returns structured abstentions when evidence is absent, avoiding risky guesses.
- **Temporal Contradiction Detection:** Resolves conflicting statements across chronological reports, detecting status and negation flips.
- **Bounded Agentic Multi-Pass Retrieval:** Automatically triggers 1–3 focused gap-filling searches when initial retrieval is incomplete.
- **Zero-Trust SQL ACL Isolation:** Excludes unauthorized documents at the query execution level using authenticated JWT claims.
- **GraphRAG Entity Explorer:** Explores connections across clients, parent corporations, guarantors, and lending officers.
- **Comprehensive Observability:** Tracks latency breakdowns (retrieval vs. rerank vs. generation), per-query token costs, and failure logs.
- **Adversarial & PII Hardening:** Passes rigorous prompt-injection testing across 8 attack vectors with automated PII redaction.
- **Perplexity-Style Modern UI:** Sleek Next.js frontend with live Server-Sent Events (SSE) token streaming, clickable citation chips, and sidecar document viewer.

---

## How It Is Different From Any Other Things

| Capability | Naive Tutorial RAG (LangChain / LlamaIndex) | Proprietary Cloud Search (AWS Kendra / Azure Search) | **Enterprise RAG Copilot** |
|---|:---:|:---:|:---:|
| **Citation Integrity** | ❌ None (Hallucinated citations pass freely) | ⚠️ Basic document-level links only | ✅ **Two-Stage Verification (Existence + Semantic Support)** |
| **Agentic Intelligence** | ❌ Single prompt or infinite loop | ❌ Fixed ranking heuristics | ✅ **11 Specialized Agents with Bounded Gap-Filling (1-3 passes)** |
| **Security & ACLs** | ❌ Post-generation filtering (Prompt Leaks) | ⚠️ Complex proprietary IAM sync | ✅ **Pre-Retrieval Parameterized SQL Predicates** |
| **Temporal Reasoning** | ❌ Completely blind to dates & negation flips | ❌ Relies on raw timestamp filtering | ✅ **Automated negation flip & chronological contradiction engine** |
| **Cross-Doc Graph** | ❌ Vector proximity only | ❌ Extra graph database licenses required | ✅ **Built-in GraphRAG Entity-Relationship Knowledge Network** |
| **Offline Resilience** | ❌ Hard crash if API key fails | ❌ Cloud-dependent lock-in | ✅ **Automatic Reachability-Gated Local Fallback Engine** |
| **Evaluation Suite** | ❌ Ad-hoc manual prompts | ❌ Black-box vendor metrics | ✅ **317-Query Stratified Gold Set + 8 Adversarial Suites** |

---

## How It Works (Operational Guide)

### 1. Ingestion Phase
1. Navigate to the **Documents** page and upload a call report PDF.
2. The ingestion pipeline validates file integrity, extracts text, tables, and images using layout-aware parsers, and extracts entity relationships.
3. Content is split into 350–500 token passages prefixed with hierarchical metadata and indexed simultaneously in SQLite FTS5 (BM25) and `hnswlib` (Vector).

### 2. Query & Agentic Routing Phase
1. A user enters a query: *'Compare the collateral terms for Titan Industries between May and August 2024.'*
2. The **Query Router Agent** classifies the shape as `COMPARISON` + `TEMPORAL`.
3. The **Query Rewrite Agent** expands synonyms and anchors temporal references to exact date boundaries.

### 3. Retrieval & Reranking Phase
1. The system executes hybrid retrieval with SQL ACL filters applied.
2. BM25 and vector candidate sets are combined using **Reciprocal Rank Fusion (k=60)**.
3. The neural cross-encoder scores and reranks candidates, while the **Bounded Agentic Retrieval Agent** verifies whether both May and August reports were captured; if one is missing, it dispatches an immediate second retrieval pass.

### 4. Generation & Verification Phase
1. The **Temporal & Contradiction Agent** checks for changed terms or negation flips.
2. The **Structured Generation Copilot** streams the structured JSON response over Server-Sent Events (SSE).
3. The **Citation Validator Guardrail** verifies every citation against the source chunks, stripping invalid citations.
4. The client renders the streaming answer with interactive citation badges linking directly to page coordinates in the source PDF.

---

## Future Scope

1. **Enterprise Identity Provider Integration:** Native SAML 2.0 and OIDC connectors for Microsoft Entra ID (Azure AD) and Okta with automatic group claim mapping.
2. **Distributed Vector Database Migration:** Optional storage adapters for Qdrant, Milvus, and pgvector for massive horizontal scalability (>10 million documents).
3. **Domain-Specific Fine-Tuning:** LoRA-based parameter-efficient fine-tuning on specialized financial and legal taxonomies for superior cross-encoder reranking.
4. **Multi-Analyst Collaborative Canvas:** Shared research workspaces allowing multiple credit analysts to annotate, cross-examine, and export verified call report briefs into Word/PDF.

---

## Getting Started & Local Verification

### Prerequisites
- Python 3.10+
- Node.js 18+
- npm 9+

### 1. Backend Setup
```bash
# Navigate to API directory
cd apps/api

# Create and activate virtual environment
python -m venv venv
# On Windows: venv\\Scripts\\activate
# On Linux/macOS: source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
pip install -r requirements-dev.txt

# Configure environment variables (optional: add Gemini or Groq keys, or run offline)
cp .env.example .env

# Launch FastAPI backend
uvicorn app.main:app --reload --port 8000
```
- **Interactive Swagger Docs:** `http://localhost:8000/docs`
- **System Health & Active Provider:** `http://localhost:8000/system/health`

### 2. Frontend Setup
```bash
# Navigate to web directory
cd apps/web

# Install dependencies
npm install

# Launch Next.js development server
npm run dev
```
Open your browser at `http://localhost:3000`.

### 3. Running the Automated Test Suite
The platform includes 57 comprehensive tests verifying all pipeline stages:
```bash
cd apps/api
pytest -v
```
Test suite coverage includes:
- `test_retrieval.py` — Hybrid BM25, HNSW, RRF, and parent-child expansion.
- `test_copilot.py` — Multi-turn conversation and structured JSON streaming.
- `test_phase6_acl.py` — Strict SQL-level ACL isolation.
- `test_phase6_adversarial.py` — 8 prompt-injection attack suites.
- `test_phase6_graph.py` — Knowledge graph entity traversal.
- `test_phase6_pii.py` — Automated PII detection and redaction.
- `test_decision_eval.py` — Policy block accuracy and citation precision.

---

## Author & Social Profiles

Architected and developed with engineering rigor by **Varad Patil**:

- **GitHub:** [@VaradPatil5005](https://github.com/VaradPatil5005)
- **LinkedIn:** [Varad Patil](https://www.linkedin.com/in/varad-patil-98a851338)
- **Twitter / X:** [@VaradPatil____](https://x.com/VaradPatil____)
- **Instagram:** [@varadpatil___](https://www.instagram.com/varadpatil___)

---

### License
This project is open-source and licensed under the [MIT License](LICENSE).
