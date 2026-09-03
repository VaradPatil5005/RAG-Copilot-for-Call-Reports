import { getAuthHeaders } from "./auth";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

export type DocumentStatus =
  | "queued"
  | "validating"
  | "extracting"
  | "multimodal_extraction"
  | "normalizing"
  | "chunking"
  | "embedding"
  | "indexing"
  | "graph_extraction"
  | "completed"
  | "failed"
  | "dead_lettered"
  | "quarantined"
  | "duplicate";

export interface DocumentVersion {
  document_id: string;
  version: number;
  sha256: string;
  status: DocumentStatus;
  stage: string;
  error: string | null;
  size_bytes: number | null;
  page_count: number | null;
  table_count: number;
  figure_count: number;
  heading_count: number;
  ocr_pages: number;
  ocr_confidence: number | null;
  parser: string | null;
  parser_version: string | null;
  duplicate_of: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentSummary {
  document_id: string;
  tenant_id: string;
  filename: string;
  customer_name: string | null;
  account_owner: string | null;
  meeting_date: string | null;
  classification: string | null;
  current_version: number;
  created_at: string;
  latest: DocumentVersion | null;
}

export interface ProcessingEvent {
  stage: string;
  status: string;
  message: string | null;
  created_at: string;
  version: number;
}

export interface DocumentDetail extends DocumentSummary {
  versions: DocumentVersion[];
  events: ProcessingEvent[];
}

export interface ElementItem {
  element_id: string;
  page_number: number;
  element_type: "heading" | "paragraph" | "table" | "figure" | "page_header" | "page_footer";
  heading_level: number | null;
  section_path: string[];
  text: string | null;
  markdown: string | null;
  bbox: number[] | null;
  confidence: number | null;
  table_json: { headers: string[]; rows: string[][]; row_count: number; col_count: number } | null;
  figure_path: string | null;
  ocr: boolean;
  include_in_search: boolean;
}

export interface DocumentStats {
  total: number;
  completed: number;
  processing: number;
  failed: number;
  quarantined: number;
  duplicate: number;
  total_pages: number;
  total_tables: number;
  total_figures: number;
}

export interface UploadResultItem {
  filename: string;
  document_id?: string;
  version?: number;
  status: string;
  message?: string;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function listDocuments(params?: {
  status?: string;
  customer?: string;
  owner?: string;
  classification?: string;
  q?: string;
}): Promise<DocumentSummary[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set("status", params.status);
  if (params?.customer) qs.set("customer", params.customer);
  if (params?.owner) qs.set("owner", params.owner);
  if (params?.classification) qs.set("classification", params.classification);
  if (params?.q) qs.set("q", params.q);
  const res = await fetch(`${API_BASE}/documents?${qs.toString()}`, {
    cache: "no-store",
    headers: await getAuthHeaders(),
  });
  const data = await jsonOrThrow<{ documents: DocumentSummary[] }>(res);
  return data.documents;
}

export interface SystemHealth {
  status: string;
  phase: string;
  services: Record<string, string>;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const res = await fetch(`${API_BASE}/system/health`, { cache: "no-store" });
  return jsonOrThrow<SystemHealth>(res);
}

export async function getDocumentStats(): Promise<DocumentStats> {
  const res = await fetch(`${API_BASE}/documents/stats`, { cache: "no-store", headers: await getAuthHeaders() });
  return jsonOrThrow<DocumentStats>(res);
}

export async function getDocument(documentId: string): Promise<DocumentDetail> {
  const res = await fetch(`${API_BASE}/documents/${documentId}`, { cache: "no-store", headers: await getAuthHeaders() });
  return jsonOrThrow<DocumentDetail>(res);
}

export async function getElements(
  documentId: string,
  elementType?: string
): Promise<ElementItem[]> {
  const qs = new URLSearchParams();
  if (elementType) qs.set("element_type", elementType);
  const res = await fetch(`${API_BASE}/documents/${documentId}/elements?${qs.toString()}`, {
    cache: "no-store",
    headers: await getAuthHeaders(),
  });
  const data = await jsonOrThrow<{ elements: ElementItem[] }>(res);
  return data.elements;
}

export function figureUrl(documentId: string, figurePath: string): string {
  return `${API_BASE}/documents/${documentId}/figures/${figurePath}`;
}

export async function uploadDocuments(
  files: File[],
  metadata: { customer_name?: string; account_owner?: string; meeting_date?: string; classification?: string }
): Promise<UploadResultItem[]> {
  const form = new FormData();
  for (const f of files) form.append("files", f);
  if (metadata.customer_name) form.append("customer_name", metadata.customer_name);
  if (metadata.account_owner) form.append("account_owner", metadata.account_owner);
  if (metadata.meeting_date) form.append("meeting_date", metadata.meeting_date);
  form.append("classification", metadata.classification || "internal");

  const res = await fetch(`${API_BASE}/documents/upload`, {
    method: "POST",
    body: form,
    headers: await getAuthHeaders(),
  });
  const data = await jsonOrThrow<{ results: UploadResultItem[] }>(res);
  return data.results;
}

export async function reprocessDocument(documentId: string, force = false): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${documentId}/reprocess?force=${force}`, {
    method: "POST",
    headers: await getAuthHeaders(),
  });
  await jsonOrThrow(res);
}

export async function updateDocumentMetadata(
  documentId: string,
  updates: Partial<{
    customer_name: string;
    account_owner: string;
    meeting_date: string;
    classification: string;
  }>
): Promise<void> {
  const res = await fetch(`${API_BASE}/documents/${documentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(updates),
  });
  await jsonOrThrow(res);
}

// --- Phase 3: hybrid retrieval -------------------------------------------

export interface SearchFilters {
  customer?: string;
  date_from?: string;
  date_to?: string;
  document_id?: string;
}

export interface SearchResultItem {
  chunk_id: string;
  document_id: string;
  version: number | null;
  chunk_type: "passage" | "table" | "figure";
  customer_name: string | null;
  account_owner: string | null;
  meeting_date: string | null;
  section_path: string[];
  page_number: number | null;
  snippet: string;
  table_json: { headers: string[]; rows: string[][]; row_count: number } | null;
  bm25_score: number | null;
  vector_score: number | null;
  rrf_score: number | null;
  rerank_score: number | null;
  is_expansion: boolean;
}

export interface RetrievalTrace {
  bm25_candidates: number;
  vector_candidates: number;
  fused_candidates: number;
  reranked_candidates: number;
  diversified_candidates: number;
  final_count: number;
  embedding_provider: string;
  reranker_provider: string;
  final_chunk_ids?: string[];
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
  trace: RetrievalTrace;
}

export async function search(
  query: string,
  opts?: { topK?: number; filters?: SearchFilters }
): Promise<SearchResponse> {
  const res = await fetch(`${API_BASE}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({
      query,
      top_k: opts?.topK ?? 10,
      filters: opts?.filters ?? null,
    }),
  });
  return jsonOrThrow<SearchResponse>(res);
}

// --- Phase 4: Copilot chat -------------------------------------------------

export type CopilotStage =
  | "understanding_query"
  | "retrieving_evidence"
  | "reasoning"
  | "generating"
  | "validating";

export type ChatConfidence = "high" | "medium" | "low";

export interface ChatCitation {
  document_id: string;
  page: number | null;
  chunk_id: string;
}

export interface ChatAnswer {
  answer: string;
  key_findings: string[];
  citations: ChatCitation[];
  confidence: ChatConfidence;
  abstained: boolean;
  abstention_reason: string | null;
}

export interface ChatEvidenceItem {
  chunk_id: string;
  document_id: string;
  page_number: number | null;
  section_path: string[];
  snippet: string;
}

export interface CitationValidationSummary {
  total: number;
  valid: number;
  stripped: number;
  existence_check_failed: number;
  support_check_failed: number;
}

export interface ChatFinalEvent {
  type: "final";
  trace_id: string;
  conversation_id: string | null;
  intent: string;
  answer: ChatAnswer;
  evidence: ChatEvidenceItem[];
  citation_validation: CitationValidationSummary;
  model_name: string;
  provider_is_fallback: boolean;
  json_retry_used: boolean;
  latency_ms: number;
}

export type ChatStreamEvent =
  | { type: "status"; stage: CopilotStage; detail?: Record<string, unknown> }
  | { type: "token"; text: string }
  | ChatFinalEvent
  | { type: "error"; message: string };

/** Streams a Copilot chat exchange over SSE, invoking `onEvent` for every
 * parsed event as it arrives. Resolves with the final event once the
 * stream completes (or throws if none arrived / the request failed). */
export async function streamChat(
  query: string,
  opts: {
    conversationId?: string | null;
    filters?: SearchFilters;
    onEvent?: (event: ChatStreamEvent) => void;
    signal?: AbortSignal;
  } = {}
): Promise<ChatFinalEvent> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({
      query,
      conversation_id: opts.conversationId ?? null,
      filters: opts.filters ?? null,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Chat request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalEvent: ChatFinalEvent | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const payload = trimmed.slice("data: ".length);
      try {
        const event = JSON.parse(payload) as ChatStreamEvent;
        opts.onEvent?.(event);
        if (event.type === "final") finalEvent = event;
        if (event.type === "error") throw new Error(event.message);
      } catch (err) {
        if (err instanceof Error && payload.includes('"type": "error"')) throw err;
        // Ignore unparseable keep-alive fragments; real events are valid JSON.
      }
    }
  }

  if (!finalEvent) throw new Error("Chat stream ended without a final answer.");
  return finalEvent;
}

export interface ChatTrace {
  trace_id: string;
  conversation_id: string | null;
  query: string;
  intent: string | null;
  answer_json: ChatAnswer;
  citation_validation: CitationValidationSummary;
  model_name: string | null;
  confidence: string | null;
  abstained: number;
  latency_ms: number;
  created_at: string;
}

export async function listChatTraces(conversationId?: string): Promise<ChatTrace[]> {
  const qs = new URLSearchParams();
  if (conversationId) qs.set("conversation_id", conversationId);
  const res = await fetch(`${API_BASE}/chat/traces?${qs.toString()}`, { cache: "no-store" });
  const data = await jsonOrThrow<{ traces: ChatTrace[] }>(res);
  return data.traces;
}

// --- Phase 6.1: GraphRAG --------------------------------------------------

export interface GraphNode {
  node_id: string;
  entity_type: string;
  canonical_name: string;
  aliases: string[];
}

export interface GraphEdge {
  edge_id: string;
  subject_node_id: string;
  predicate: string;
  object_node_id: string;
  confidence: number;
  extractor: string;
}

export interface GraphCitation {
  document_id: string;
  version: number;
  page: number | null;
  chunk_id: string;
}

export interface GraphQueryResponse {
  mode: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  citations: Record<string, GraphCitation>;
  node_count: number;
  edge_count: number;
}

export async function queryGraph(params: {
  question?: string;
  predicate?: string;
  node_id?: string;
  max_hops?: number;
}): Promise<GraphQueryResponse> {
  const res = await fetch(`${API_BASE}/graph/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<GraphQueryResponse>(res);
}

// --- Phase 6.6: Admin panel ------------------------------------------------
// Note: /system/* and /evaluation/* are intentionally unauthenticated on the
// backend (an internal/operator surface, not an end-user data path -- see
// routers/system.py and routers/evaluation.py's module docstrings), so
// these calls don't attach a bearer token.

export interface AdminOverview {
  health: {
    status: string;
    services: Record<string, string>;
  };
  index_versions: { name: string; is_active: boolean; vector_count: number | null; updated_at: string | null }[];
  ingestion_queue_depth_live: number | null;
  ingestion_queue_depth_persisted: number;
  security: {
    zero_evidence_responses_last_24h: number;
    zero_evidence_responses_caveat: string;
    tenant_access_summary_7d: { tenant_id: string; n_queries: number; n_identities: number }[];
    document_access_summary: { tenant_id: string; classification: string; n_documents: number }[];
  };
  chat_metrics: Record<string, unknown>;
  cost_usage: {
    window_days: number;
    n_queries_total: number;
    by_model: Record<string, { n_calls: number; total_tokens: number; estimated_cost_usd: number | null; cost_basis: string | null }>;
    query_volume_by_day: Record<string, number>;
    query_volume_by_tenant: Record<string, number>;
  };
  latest_evaluation_run: { run_id: string; kind: string; n_queries: number; created_at: string } | null;
}

export async function getAdminOverview(): Promise<AdminOverview> {
  const res = await fetch(`${API_BASE}/system/admin/overview`, { cache: "no-store" });
  return jsonOrThrow<AdminOverview>(res);
}

export interface AuditLogEntry {
  id: number;
  trace_id: string | null;
  endpoint: string;
  identity_sub: string | null;
  tenant_id: string;
  principals: string[] | null;
  acl_filter_summary: string;
  query: string | null;
  evidence_chunk_ids: string[];
  evidence_count: number;
  created_at: string;
}

export async function getAuditLog(params?: { endpoint?: string; tenant_id?: string; limit?: number }): Promise<AuditLogEntry[]> {
  const qs = new URLSearchParams();
  if (params?.endpoint) qs.set("endpoint", params.endpoint);
  if (params?.tenant_id) qs.set("tenant_id", params.tenant_id);
  qs.set("limit", String(params?.limit ?? 50));
  const res = await fetch(`${API_BASE}/system/audit?${qs.toString()}`, { cache: "no-store" });
  const data = await jsonOrThrow<{ entries: AuditLogEntry[] }>(res);
  return data.entries;
}

export interface EvaluationReport {
  available: boolean;
  run_id?: string;
  created_at?: string;
  n_queries?: number;
  overall?: {
    hit_rate: number;
    hit_rate_95ci: [number, number];
    mrr: number;
    abstention_accuracy: number;
    mean_semantic_relevancy: number;
    mean_faithfulness: number;
    latency_ms: Record<string, number>;
  };
  by_category?: Record<string, { n: number; hit_rate: number; hit_rate_95ci: [number, number]; mrr: number }>;
  n_failure_cases?: number;
  message?: string;
}

export async function getLatestEvaluation(): Promise<EvaluationReport> {
  const res = await fetch(`${API_BASE}/evaluation/latest`, { cache: "no-store" });
  return jsonOrThrow<EvaluationReport>(res);
}

export interface RetrievalEvalReport {
  n_queries: number;
  hit_rate_at_k: number;
  mrr_at_k: number;
  by_category: Record<string, { n: number; hit_rate: number; mrr: number }>;
  embedding_provider_is_fallback: boolean;
  reranker_provider_is_fallback: boolean;
  results: Record<string, unknown>[];
  caveat: string;
}

/** POST /evaluation/run -- fast, retrieval-only Hit Rate@k / MRR@k over the
 * seed 10-query gold set. Good for a quick sanity check between full runs. */
export async function runRetrievalEval(params?: { top_k?: number; tenant_id?: string }): Promise<RetrievalEvalReport> {
  const res = await fetch(`${API_BASE}/evaluation/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ top_k: params?.top_k ?? 10, tenant_id: params?.tenant_id ?? "tenant-a" }),
  });
  return jsonOrThrow<RetrievalEvalReport>(res);
}

/** POST /evaluation/run-full -- the real benchmark: retrieval + generation +
 * citation validation + every metric, persisted so /evaluation/latest (and
 * the Admin panel) picks it up afterwards. Slow -- one real generation call
 * per query -- so this is left to an explicit button, never auto-triggered. */
export async function runFullEvaluation(params?: {
  top_k?: number;
  tenant_id?: string;
  use_v2_gold_set?: boolean;
  n_customers?: number;
  seed?: number;
}): Promise<EvaluationReport> {
  const res = await fetch(`${API_BASE}/evaluation/run-full`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      top_k: params?.top_k ?? 10,
      tenant_id: params?.tenant_id ?? "tenant-a",
      use_v2_gold_set: params?.use_v2_gold_set ?? false,
      n_customers: params?.n_customers ?? 24,
      seed: params?.seed ?? 42,
    }),
  });
  return jsonOrThrow<EvaluationReport>(res);
}

// --------------------------------------------------------------------------
// feature/decision-intelligence-layer, Phase B (additive) -- Decision
// Intelligence dashboard: policy-block accuracy (net-new metric) plus a
// read-only summary that surfaces citation precision / faithfulness /
// abstention accuracy / unsupported-claim rate from the existing
// evaluation harness's persisted /evaluation/run-full report alongside it.
// --------------------------------------------------------------------------

export interface PolicyGoldCase {
  case_id: string;
  question: string;
  principals: string[];
  target_customer: string;
  expected_blocked: boolean;
}

export async function getPolicyGoldSet(): Promise<{ n_cases: number; cases: PolicyGoldCase[] }> {
  const res = await fetch(`${API_BASE}/decision-eval/policy-gold-set`, { cache: "no-store" });
  return jsonOrThrow(res);
}

export interface PolicyCaseResult {
  case_id: string;
  question: string;
  principals: string[];
  target_customer: string;
  expected_blocked: boolean;
  actual_blocked: boolean;
  correct: boolean;
}

export interface PolicyBlockReport {
  available?: boolean;
  message?: string;
  run_id?: string;
  created_at?: string;
  n_cases: number;
  policy_block_accuracy: number;
  false_allow_count: number;
  false_allow_cases: string[];
  false_block_count: number;
  false_block_cases: string[];
  results: PolicyCaseResult[];
  caveat: string;
}

/** POST /decision-eval/run-policy-block -- runs the net-new policy-block-
 * accuracy metric against the real ACL-enforced retrieval path and
 * persists the report. */
export async function runPolicyBlockEval(params?: { tenant_id?: string; top_k?: number }): Promise<PolicyBlockReport> {
  const res = await fetch(`${API_BASE}/decision-eval/run-policy-block`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tenant_id: params?.tenant_id ?? "tenant-a", top_k: params?.top_k ?? 10 }),
  });
  return jsonOrThrow(res);
}

export async function getLatestPolicyBlockEval(): Promise<PolicyBlockReport> {
  const res = await fetch(`${API_BASE}/decision-eval/latest-policy-block`, { cache: "no-store" });
  return jsonOrThrow(res);
}

export interface DecisionEvalSummary {
  quality_available: boolean;
  quality: {
    run_id: string;
    created_at: string;
    n_queries: number;
    citation_precision: number | null;
    mean_faithfulness: number | null;
    unsupported_claim_rate: number | null;
    abstention_accuracy: number | null;
  } | null;
  policy_available: boolean;
  policy: {
    run_id: string;
    created_at: string;
    n_cases: number;
    policy_block_accuracy: number;
    false_allow_count: number;
    false_block_count: number;
  } | null;
  caveat: string;
}

export async function getDecisionEvalSummary(): Promise<DecisionEvalSummary> {
  const res = await fetch(`${API_BASE}/decision-eval/summary`, { cache: "no-store" });
  return jsonOrThrow(res);
}

// --------------------------------------------------------------------------
// feature/decision-intelligence-layer, Phase C (additive) -- Observability
// dashboard: retrieval-stage latency breakdown, per-query cost, and a
// failure/error log are all genuinely new; the fallback-provider rate /
// JSON-retry rate / abstention rate / latency percentiles inside
// `chat_metrics` below are the EXISTING `/system/metrics` payload, only
// being displayed again here, not recomputed.
// --------------------------------------------------------------------------

export interface StageLatencyBreakdown {
  n_rows: number;
  by_stage: Record<string, { n: number; p50: number; p95: number; p99: number; mean_ms: number }>;
  message?: string;
}

export interface CostPerQueryEntry {
  trace_id: string;
  query_preview: string;
  model_name: string;
  total_tokens: number;
  estimated_cost_usd: number | null;
  cost_basis: string;
  tenant_id: string | null;
  created_at: string;
}

export interface FailureLogEntry {
  id: number;
  trace_id: string | null;
  conversation_id: string | null;
  tenant_id: string | null;
  stage: string;
  query: string | null;
  error_message: string;
  created_at: string;
}

export interface ObservabilityDashboard {
  chat_metrics: Record<string, unknown>;
  stage_latency: StageLatencyBreakdown;
  cost_per_query: { n_queries: number; queries: CostPerQueryEntry[] };
  failures: { n_failures: number; failures: FailureLogEntry[] };
}

export async function getObservabilityDashboard(): Promise<ObservabilityDashboard> {
  const res = await fetch(`${API_BASE}/observability/dashboard`, { cache: "no-store" });
  return jsonOrThrow(res);
}
