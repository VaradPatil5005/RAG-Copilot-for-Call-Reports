"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Sparkles,
  ThumbsUp,
  MousePointerClick,
  BookOpen,
  Check,
  X,
  Loader2,
  RefreshCw,
  Award,
  Brain,
  ShieldCheck,
  FileCode2,
  Clock,
  Trash2,
  Plus,
  Play,
  CheckCircle2,
  AlertCircle,
  Zap,
  Tag,
  Building,
  User,
  Sliders,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { MetricCard } from "@/components/ui/metric-card";
import {
  getLearningStatus,
  getLearnedLexicon,
  updateLearnedLexiconStatus,
  getGoldenExemplars,
  getChunkUtilityScores,
  getMemories,
  createUserMemory,
  deleteUserMemory,
  createTenantMemory,
  deleteTenantMemory,
  getSkills,
  createSkill,
  updateSkillState,
  getCuratorStatus,
  runCuratorCycle,
  type LearningStatus,
  type LearnedLexiconItem,
  type GoldenExemplar,
  type ChunkUtilityScore,
  type UserMemoryItem,
  type TenantMemoryItem,
  type ProceduralSkillItem,
  type CuratorStatusResponse,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export default function LearningPage() {
  const [status, setStatus] = useState<LearningStatus | null>(null);
  const [lexicon, setLexicon] = useState<LearnedLexiconItem[]>([]);
  const [exemplars, setExemplars] = useState<GoldenExemplar[]>([]);
  const [utilityScores, setUtilityScores] = useState<ChunkUtilityScore[]>([]);
  const [userMemories, setUserMemories] = useState<UserMemoryItem[]>([]);
  const [tenantMemories, setTenantMemories] = useState<TenantMemoryItem[]>([]);
  const [skills, setSkills] = useState<ProceduralSkillItem[]>([]);
  const [curatorStatus, setCuratorStatus] = useState<CuratorStatusResponse | null>(null);

  const [activeTab, setActiveTab] = useState<"memories" | "skills" | "curator" | "lexicon" | "utility">("memories");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<number | string | null>(null);
  const [curatorRunning, setCuratorRunning] = useState(false);
  const [curatorResult, setCuratorResult] = useState<Record<string, unknown> | null>(null);

  // New Memory Form State
  const [showAddUserMem, setShowAddUserMem] = useState(false);
  const [userMemForm, setUserMemForm] = useState({
    category: "analyst_preference",
    key: "",
    content: "",
    source: "explicit",
    confidence: 1.0,
  });

  const [showAddTenantMem, setShowAddTenantMem] = useState(false);
  const [tenantMemForm, setTenantMemForm] = useState({
    category: "credit_policy",
    title: "",
    content: "",
  });

  // New Skill Form State
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [skillForm, setSkillForm] = useState({
    name: "",
    description: "",
    category: "covenant_audit",
    trigger_phrases: "",
    procedure_markdown: "",
    verification_rule: "",
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        statusRes,
        lexiconRes,
        exemplarsRes,
        utilityRes,
        memoriesRes,
        skillsRes,
        curatorRes,
      ] = await Promise.all([
        getLearningStatus().catch(() => null),
        getLearnedLexicon().catch(() => ({ items: [], count: 0 })),
        getGoldenExemplars().catch(() => ({ exemplars: [], count: 0 })),
        getChunkUtilityScores(25).catch(() => ({ scores: [] })),
        getMemories().catch(() => ({ user_memories: [], tenant_memories: [] })),
        getSkills().catch(() => ({ skills: [], count: 0 })),
        getCuratorStatus().catch(() => null),
      ]);

      if (statusRes) setStatus(statusRes);
      setLexicon(lexiconRes.items);
      setExemplars(exemplarsRes.exemplars);
      setUtilityScores(utilityRes.scores);
      setUserMemories(memoriesRes.user_memories);
      setTenantMemories(memoriesRes.tenant_memories);
      setSkills(skillsRes.skills);
      if (curatorRes) setCuratorStatus(curatorRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load learning system state");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Lexicon Handlers
  const handleLexiconStatusChange = async (termId: number, newStatus: "active" | "rejected") => {
    setUpdatingId(termId);
    try {
      await updateLearnedLexiconStatus(termId, newStatus);
      setLexicon((prev) =>
        prev.map((item) => (item.id === termId ? { ...item, status: newStatus } : item))
      );
    } catch (err) {
      console.error("Failed to update term status", err);
    } finally {
      setUpdatingId(null);
    }
  };

  // Memory Handlers
  const handleCreateUserMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userMemForm.key || !userMemForm.content) return;
    try {
      await createUserMemory(userMemForm);
      setShowAddUserMem(false);
      setUserMemForm({
        category: "analyst_preference",
        key: "",
        content: "",
        source: "explicit",
        confidence: 1.0,
      });
      const res = await getMemories();
      setUserMemories(res.user_memories);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save analyst memory");
    }
  };

  const handleDeleteUserMem = async (memoryId: string) => {
    try {
      await deleteUserMemory(memoryId);
      setUserMemories((prev) => prev.filter((m) => m.memory_id !== memoryId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete memory");
    }
  };

  const handleCreateTenantMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tenantMemForm.title || !tenantMemForm.content) return;
    try {
      await createTenantMemory(tenantMemForm);
      setShowAddTenantMem(false);
      setTenantMemForm({
        category: "credit_policy",
        title: "",
        content: "",
      });
      const res = await getMemories();
      setTenantMemories(res.tenant_memories);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save tenant credit policy");
    }
  };

  const handleDeleteTenantMem = async (memoryId: string) => {
    try {
      await deleteTenantMemory(memoryId);
      setTenantMemories((prev) => prev.filter((m) => m.memory_id !== memoryId));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete tenant policy");
    }
  };

  // Skills Handlers
  const handleCreateSkill = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!skillForm.name || !skillForm.procedure_markdown) return;
    try {
      const triggers = skillForm.trigger_phrases
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      await createSkill({
        name: skillForm.name.trim().toLowerCase().replace(/\s+/g, "-"),
        description: skillForm.description.trim(),
        category: skillForm.category,
        trigger_phrases: triggers,
        procedure_markdown: skillForm.procedure_markdown,
        verification_rule: skillForm.verification_rule || undefined,
      });
      setShowAddSkill(false);
      setSkillForm({
        name: "",
        description: "",
        category: "covenant_audit",
        trigger_phrases: "",
        procedure_markdown: "",
        verification_rule: "",
      });
      const res = await getSkills();
      setSkills(res.skills);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create procedural skill");
    }
  };

  const handleToggleSkillState = async (skillId: string, newState: "active" | "stale" | "archived") => {
    setUpdatingId(skillId);
    try {
      await updateSkillState(skillId, newState);
      setSkills((prev) =>
        prev.map((s) => (s.skill_id === skillId ? { ...s, state: newState } : s))
      );
    } catch (err) {
      console.error("Failed to update skill state", err);
    } finally {
      setUpdatingId(null);
    }
  };

  // Curator Handlers
  const handleTriggerCurator = async () => {
    setCuratorRunning(true);
    setCuratorResult(null);
    try {
      const res = await runCuratorCycle();
      setCuratorResult(res.actions_summary);
      const updatedCurator = await getCuratorStatus();
      setCuratorStatus(updatedCurator);
      const updatedSkills = await getSkills();
      setSkills(updatedSkills.skills);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Curator cycle failed");
    } finally {
      setCuratorRunning(false);
    }
  };

  const satisfactionRate =
    status && status.feedback.total > 0
      ? Math.round((status.feedback.positive / status.feedback.total) * 100)
      : null;

  return (
    <div className="pb-12">
      <PageHeader
        eyebrow="Continuous Adaptation & Institutional Memory"
        title="Self-Learning & Decision Intelligence Engine"
        description="Persistent analyst & firm memory, autonomous procedural financial skills synthesis, dynamic few-shot reinforcement, and background knowledge curation."
        actions={
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 rounded-lg border border-border-subtle bg-surface/80 px-3.5 py-2 text-[12px] font-medium text-text-muted transition hover:text-text hover:border-white/20 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Sync System State
          </button>
        }
      />

      <div className="px-8 space-y-8">
        {error && (
          <div className="rounded-lg border border-error/40 bg-error/10 p-4 text-[13px] text-error flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <MetricCard
            label="Human Satisfaction"
            value={satisfactionRate !== null ? `${satisfactionRate}%` : "—"}
            delta={`${status?.feedback.positive ?? 0} helpful · ${status?.feedback.negative ?? 0} issues`}
            deltaTone="positive"
            accent="evidence"
            icon={ThumbsUp}
          />
          <MetricCard
            label="Procedural Skills"
            value={skills.length.toString()}
            delta={`${skills.filter((s) => s.state === "active").length} active · ${skills.filter((s) => s.state === "stale").length} stale`}
            accent="primary"
            icon={FileCode2}
          />
          <MetricCard
            label="Persistent Memory"
            value={(userMemories.length + tenantMemories.length).toString()}
            delta={`${userMemories.length} analyst · ${tenantMemories.length} firm policy`}
            icon={Brain}
          />
          <MetricCard
            label="Discovered Jargon"
            value={status ? status.lexicon.total_terms.toString() : "—"}
            delta={`${status?.lexicon.active_terms ?? 0} active terms`}
            icon={BookOpen}
          />
          <MetricCard
            label="Curator Health"
            value={curatorStatus ? `${curatorStatus.total_runs ?? curatorStatus.total_cycles ?? 0} cycles` : "0 cycles"}
            delta={curatorStatus?.last_run || curatorStatus?.latest_run ? "Active lifecycle" : "Ready"}
            accent="evidence"
            icon={Clock}
          />
        </div>

        {/* Navigation Tabs */}
        <div className="border-b border-border-subtle">
          <div className="flex gap-6 overflow-x-auto">
            <button
              onClick={() => setActiveTab("memories")}
              className={cn(
                "pb-3 text-[13px] font-medium transition-colors border-b-2 flex items-center gap-2 shrink-0",
                activeTab === "memories"
                  ? "border-primary text-text font-semibold"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              <Brain className="h-4 w-4" />
              Persistent Memory ({userMemories.length + tenantMemories.length})
            </button>
            <button
              onClick={() => setActiveTab("skills")}
              className={cn(
                "pb-3 text-[13px] font-medium transition-colors border-b-2 flex items-center gap-2 shrink-0",
                activeTab === "skills"
                  ? "border-primary text-text font-semibold"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              <FileCode2 className="h-4 w-4" />
              Procedural Skills ({skills.length})
            </button>
            <button
              onClick={() => setActiveTab("curator")}
              className={cn(
                "pb-3 text-[13px] font-medium transition-colors border-b-2 flex items-center gap-2 shrink-0",
                activeTab === "curator"
                  ? "border-primary text-text font-semibold"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              <Clock className="h-4 w-4" />
              Knowledge Curator ({curatorStatus?.total_runs ?? curatorStatus?.total_cycles ?? 0})
            </button>
            <button
              onClick={() => setActiveTab("lexicon")}
              className={cn(
                "pb-3 text-[13px] font-medium transition-colors border-b-2 flex items-center gap-2 shrink-0",
                activeTab === "lexicon"
                  ? "border-primary text-text font-semibold"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              <BookOpen className="h-4 w-4" />
              Mined Lexicon ({lexicon.length})
            </button>
            <button
              onClick={() => setActiveTab("utility")}
              className={cn(
                "pb-3 text-[13px] font-medium transition-colors border-b-2 flex items-center gap-2 shrink-0",
                activeTab === "utility"
                  ? "border-primary text-text font-semibold"
                  : "border-transparent text-text-muted hover:text-text"
              )}
            >
              <Sliders className="h-4 w-4" />
              Utility & Exemplars ({utilityScores.length + exemplars.length})
            </button>
          </div>
        </div>

        {/* ================================================================= */}
        {/* TAB 1: PERSISTENT MEMORY (Multi-Tier)                             */}
        {/* ================================================================= */}
        {activeTab === "memories" && (
          <div className="space-y-8">
            {/* Top Overview Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-[16px] font-semibold text-text">
                  Multi-Tier Persistent Intelligence Memory
                </h2>
                <p className="text-[12.5px] text-text-muted mt-0.5">
                  Partitioned memory retains analyst reporting preferences and firm credit policies across user sessions, injected directly into prompt generation.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Column: Personal Analyst Preferences */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-evidence" />
                    <h3 className="text-[14px] font-semibold text-text">Analyst Preferences & Risk Tolerance</h3>
                  </div>
                  <button
                    onClick={() => setShowAddUserMem(!showAddUserMem)}
                    className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface px-2.5 py-1 text-[11.5px] text-text-muted hover:text-text transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Preference
                  </button>
                </div>

                {showAddUserMem && (
                  <form onSubmit={handleCreateUserMemory} className="rounded-xl border border-white/10 bg-surface/90 p-4 space-y-3 shadow-lg">
                    <h4 className="text-[12px] font-semibold text-text uppercase tracking-wider">New Analyst Memory</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-text-faint">Category</label>
                        <select
                          value={userMemForm.category}
                          onChange={(e) => setUserMemForm({ ...userMemForm, category: e.target.value })}
                          className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2 py-1.5 text-[12px] text-text"
                        >
                          <option value="analyst_preference">Analyst Preference</option>
                          <option value="risk_tolerance">Risk Tolerance</option>
                          <option value="sector_focus">Sector Focus</option>
                          <option value="reporting_style">Reporting Style</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-text-faint">Key / Identifier</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. leverage_headroom_alert"
                          value={userMemForm.key}
                          onChange={(e) => setUserMemForm({ ...userMemForm, key: e.target.value })}
                          className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2 py-1.5 text-[12px] text-text"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-text-faint">Memory Content / Rule</label>
                      <textarea
                        required
                        rows={2}
                        placeholder="e.g. Always highlight borrower covenants with less than 15% headroom in bold red callouts."
                        value={userMemForm.content}
                        onChange={(e) => setUserMemForm({ ...userMemForm, content: e.target.value })}
                        className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2 py-1.5 text-[12px] text-text"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddUserMem(false)}
                        className="rounded px-2.5 py-1 text-[11px] text-text-muted hover:text-text"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="rounded bg-primary/20 border border-primary/40 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/30 transition"
                      >
                        Save Memory
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2.5">
                  {userMemories.length === 0 ? (
                    <div className="rounded-xl border border-border-subtle bg-surface/40 p-6 text-center text-text-faint text-[12px]">
                      No analyst preferences recorded. Click &apos;Add Preference&apos; to seed your analyst reporting style.
                    </div>
                  ) : (
                    userMemories.map((m) => (
                      <div
                        key={m.memory_id}
                        className="rounded-xl border border-white/6 bg-surface/70 backdrop-blur-md p-3.5 space-y-2 hover:border-white/14 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-evidence/10 text-evidence border border-evidence/20 px-2 py-0.5 text-[10px] font-mono uppercase">
                              {m.category.replace("_", " ")}
                            </span>
                            <span className="font-mono text-[12px] font-semibold text-text">{m.key}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-text-faint font-mono">{m.source}</span>
                            <button
                              onClick={() => handleDeleteUserMem(m.memory_id)}
                              className="text-text-faint hover:text-error transition p-1"
                              title="Delete Memory"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[12.5px] text-text-muted leading-relaxed pl-1">{m.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Right Column: Institutional Tenant Policies */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Building className="h-4 w-4 text-primary" />
                    <h3 className="text-[14px] font-semibold text-text">Firm-Wide Credit Policies & Compliance</h3>
                  </div>
                  <button
                    onClick={() => setShowAddTenantMem(!showAddTenantMem)}
                    className="flex items-center gap-1 rounded-lg border border-border-subtle bg-surface px-2.5 py-1 text-[11.5px] text-text-muted hover:text-text transition"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Credit Policy
                  </button>
                </div>

                {showAddTenantMem && (
                  <form onSubmit={handleCreateTenantMemory} className="rounded-xl border border-white/10 bg-surface/90 p-4 space-y-3 shadow-lg">
                    <h4 className="text-[12px] font-semibold text-text uppercase tracking-wider">New Firm Credit Policy</h4>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[11px] text-text-faint">Category</label>
                        <select
                          value={tenantMemForm.category}
                          onChange={(e) => setTenantMemForm({ ...tenantMemForm, category: e.target.value })}
                          className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2 py-1.5 text-[12px] text-text"
                        >
                          <option value="credit_policy">Credit Policy</option>
                          <option value="accounting_standards">Accounting Standards</option>
                          <option value="covenant_guidelines">Covenant Guidelines</option>
                          <option value="compliance_mandate">Compliance Mandate</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[11px] text-text-faint">Policy Title</label>
                        <input
                          type="text"
                          required
                          placeholder="e.g. Senior Debt Ceiling"
                          value={tenantMemForm.title}
                          onChange={(e) => setTenantMemForm({ ...tenantMemForm, title: e.target.value })}
                          className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2 py-1.5 text-[12px] text-text"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-text-faint">Policy Mandate Content</label>
                      <textarea
                        required
                        rows={2}
                        placeholder="e.g. Senior Leverage (Debt/EBITDA) exceeding 4.0x requires immediate Credit Committee review."
                        value={tenantMemForm.content}
                        onChange={(e) => setTenantMemForm({ ...tenantMemForm, content: e.target.value })}
                        className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2 py-1.5 text-[12px] text-text"
                      />
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowAddTenantMem(false)}
                        className="rounded px-2.5 py-1 text-[11px] text-text-muted hover:text-text"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="rounded bg-primary/20 border border-primary/40 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/30 transition"
                      >
                        Save Policy
                      </button>
                    </div>
                  </form>
                )}

                <div className="space-y-2.5">
                  {tenantMemories.length === 0 ? (
                    <div className="rounded-xl border border-border-subtle bg-surface/40 p-6 text-center text-text-faint text-[12px]">
                      No firm credit policies defined. Click &apos;Add Credit Policy&apos; to institutionalize enterprise guidelines.
                    </div>
                  ) : (
                    tenantMemories.map((m) => (
                      <div
                        key={m.memory_id}
                        className="rounded-xl border border-white/6 bg-surface/70 backdrop-blur-md p-3.5 space-y-2 hover:border-white/14 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="rounded bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 text-[10px] font-mono uppercase">
                              {m.category.replace("_", " ")}
                            </span>
                            <span className="text-[13px] font-semibold text-text">{m.title}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-evidence/20 px-2 py-0.5 text-[9.5px] font-medium text-evidence">
                              {m.status}
                            </span>
                            <button
                              onClick={() => handleDeleteTenantMem(m.memory_id)}
                              className="text-text-faint hover:text-error transition p-1"
                              title="Delete Policy"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[12.5px] text-text-muted leading-relaxed pl-1">{m.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: PROCEDURAL FINANCIAL SKILLS                                */}
        {/* ================================================================= */}
        {activeTab === "skills" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-[16px] font-semibold text-text">
                  Procedural Financial Skills Engine
                </h2>
                <p className="text-[12.5px] text-text-muted mt-0.5">
                  Multi-step execution procedures matched to analyst queries via trigger phrases, with autonomous synthesis from high-performing query traces.
                </p>
              </div>
              <button
                onClick={() => setShowAddSkill(!showAddSkill)}
                className="flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3.5 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20 transition self-start sm:self-auto"
              >
                <Plus className="h-3.5 w-3.5" />
                Define New Financial Skill
              </button>
            </div>

            {showAddSkill && (
              <form onSubmit={handleCreateSkill} className="rounded-xl border border-white/12 bg-surface/95 p-5 space-y-4 shadow-xl">
                <h3 className="text-[13px] font-semibold text-text uppercase tracking-wider">New Procedural Financial Skill</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-[11px] text-text-faint">Skill Name (Slugified)</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. debt-service-coverage-audit"
                      value={skillForm.name}
                      onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })}
                      className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2.5 py-1.5 text-[12px] text-text"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-text-faint">Category</label>
                    <select
                      value={skillForm.category}
                      onChange={(e) => setSkillForm({ ...skillForm, category: e.target.value })}
                      className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2.5 py-1.5 text-[12px] text-text"
                    >
                      <option value="covenant_audit">Covenant Audit</option>
                      <option value="debt_analysis">Debt Analysis</option>
                      <option value="temporal_comparison">Temporal Comparison</option>
                      <option value="risk_synthesis">Risk Synthesis</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-text-faint">Trigger Phrases (comma-separated)</label>
                    <input
                      type="text"
                      placeholder="e.g. covenant check, dscr calculation, breach audit"
                      value={skillForm.trigger_phrases}
                      onChange={(e) => setSkillForm({ ...skillForm, trigger_phrases: e.target.value })}
                      className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2.5 py-1.5 text-[12px] text-text"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] text-text-faint">Description</label>
                  <input
                    type="text"
                    placeholder="Brief high-level summary of analytical goal"
                    value={skillForm.description}
                    onChange={(e) => setSkillForm({ ...skillForm, description: e.target.value })}
                    className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2.5 py-1.5 text-[12px] text-text"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-text-faint">Step-by-Step Procedure (Markdown numbered steps)</label>
                  <textarea
                    required
                    rows={4}
                    placeholder={"1. Locate financial summary tables in call report.\n2. Extract EBITDA and debt amounts.\n3. Compute ratio and headroom."}
                    value={skillForm.procedure_markdown}
                    onChange={(e) => setSkillForm({ ...skillForm, procedure_markdown: e.target.value })}
                    className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2.5 py-1.5 text-[12px] text-text font-mono"
                  />
                </div>

                <div>
                  <label className="text-[11px] text-text-faint">Verification Rule (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. Every ratio numerator must cite exact document chunk ID and page coordinates."
                    value={skillForm.verification_rule}
                    onChange={(e) => setSkillForm({ ...skillForm, verification_rule: e.target.value })}
                    className="w-full mt-1 rounded border border-border-subtle bg-elevated px-2.5 py-1.5 text-[12px] text-text"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddSkill(false)}
                    className="rounded px-3 py-1.5 text-[12px] text-text-muted hover:text-text"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded bg-primary px-4 py-1.5 text-[12px] font-semibold text-black hover:bg-primary/90 transition"
                  >
                    Register Procedural Skill
                  </button>
                </div>
              </form>
            )}

            <div className="grid grid-cols-1 gap-4">
              {skills.length === 0 ? (
                <div className="rounded-xl border border-border-subtle bg-surface/50 p-8 text-center text-text-faint text-[12.5px]">
                  No skills registered. Skills will automatically seed upon first query or can be added manually.
                </div>
              ) : (
                skills.map((skill) => {
                  const isActive = skill.state === "active";
                  const isStale = skill.state === "stale";
                  const isArchived = skill.state === "archived";

                  return (
                    <div
                      key={skill.skill_id}
                      className={cn(
                        "rounded-xl border bg-surface/70 backdrop-blur-md p-5 space-y-3 transition-all",
                        isActive ? "border-white/10 shadow-sm" : isStale ? "border-warning/30 bg-warning/5" : "border-white/5 opacity-60"
                      )}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <span className="font-display text-[15px] font-bold text-text">{skill.name}</span>
                          <span className="rounded bg-primary-dim/30 text-primary border border-primary-dim/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                            {skill.category.replace("_", " ")}
                          </span>
                          {skill.created_by === "autonomous_agent" && (
                            <span className="inline-flex items-center gap-1 rounded bg-evidence/20 text-evidence border border-evidence/30 px-2 py-0.5 text-[10px] font-medium">
                              <Zap className="h-3 w-3" />
                              Autonomously Synthesized
                            </span>
                          )}
                        </div>

                        {/* State Toggle & Usage */}
                        <div className="flex items-center gap-2.5">
                          <span className="text-[11.5px] font-mono text-text-muted">
                            Used {skill.use_count}×
                          </span>
                          <div className="flex rounded-lg border border-border-subtle overflow-hidden text-[11px] font-medium">
                            <button
                              onClick={() => handleToggleSkillState(skill.skill_id, "active")}
                              disabled={updatingId === skill.skill_id || isActive}
                              className={cn(
                                "px-2.5 py-1 transition",
                                isActive ? "bg-evidence text-black font-semibold" : "bg-elevated text-text-muted hover:text-text"
                              )}
                            >
                              Active
                            </button>
                            <button
                              onClick={() => handleToggleSkillState(skill.skill_id, "stale")}
                              disabled={updatingId === skill.skill_id || isStale}
                              className={cn(
                                "px-2.5 py-1 transition",
                                isStale ? "bg-warning text-black font-semibold" : "bg-elevated text-text-muted hover:text-text"
                              )}
                            >
                              Stale
                            </button>
                            <button
                              onClick={() => handleToggleSkillState(skill.skill_id, "archived")}
                              disabled={updatingId === skill.skill_id || isArchived}
                              className={cn(
                                "px-2.5 py-1 transition",
                                isArchived ? "bg-white/20 text-white font-semibold" : "bg-elevated text-text-muted hover:text-text"
                              )}
                            >
                              Archived
                            </button>
                          </div>
                        </div>
                      </div>

                      <p className="text-[12.5px] text-text-muted">{skill.description}</p>

                      {/* Trigger Phrases */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] text-text-faint flex items-center gap-1 mr-1">
                          <Tag className="h-3 w-3" /> Triggers:
                        </span>
                        {skill.trigger_phrases.map((phrase, idx) => (
                          <span
                            key={idx}
                            className="rounded bg-elevated/70 border border-white/6 px-2 py-0.5 text-[11px] font-mono text-text-muted"
                          >
                            &quot;{phrase}&quot;
                          </span>
                        ))}
                      </div>

                      {/* Procedure Execution Steps */}
                      <div className="rounded-lg border border-white/6 bg-black/40 p-3 text-[12px] font-mono text-text-muted leading-relaxed whitespace-pre-line">
                        {skill.procedure_markdown}
                      </div>

                      {skill.verification_rule && (
                        <div className="flex items-center gap-2 text-[11.5px] text-evidence bg-evidence-dim/20 border border-evidence/20 px-3 py-1.5 rounded-lg">
                          <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                          <span><strong>Verification:</strong> {skill.verification_rule}</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: AUTONOMOUS KNOWLEDGE CURATOR                               */}
        {/* ================================================================= */}
        {activeTab === "curator" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="font-display text-[16px] font-semibold text-text">
                  Autonomous Knowledge Lifecycle Curator
                </h2>
                <p className="text-[12.5px] text-text-muted mt-0.5">
                  Automated maintenance engine that ages inactive procedural skills (14-day stale, 30-day archive), consolidates duplicate domain terms, and prunes sub-optimal exemplars.
                </p>
              </div>
              <button
                onClick={handleTriggerCurator}
                disabled={curatorRunning}
                className="flex items-center gap-2 rounded-lg border border-evidence/40 bg-evidence/10 px-4 py-2 text-[12.5px] font-semibold text-evidence hover:bg-evidence/20 transition disabled:opacity-50 self-start sm:self-auto"
              >
                {curatorRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Run Curator Cycle Now
              </button>
            </div>

            {/* Latest Run Result Flash */}
            {curatorResult && (
              <div className="rounded-xl border border-evidence/40 bg-evidence/10 p-4 space-y-2">
                <div className="flex items-center gap-2 text-evidence font-semibold text-[13px]">
                  <CheckCircle2 className="h-4 w-4" />
                  Curator Cycle Completed Successfully
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
                  <div className="rounded bg-black/40 p-2 text-center">
                    <span className="text-[10px] text-text-faint uppercase block">Skills Aged Stale</span>
                    <span className="text-[15px] font-bold text-warning">{String(curatorResult.skills_aged_stale ?? 0)}</span>
                  </div>
                  <div className="rounded bg-black/40 p-2 text-center">
                    <span className="text-[10px] text-text-faint uppercase block">Skills Archived</span>
                    <span className="text-[15px] font-bold text-text-muted">{String(curatorResult.skills_archived ?? 0)}</span>
                  </div>
                  <div className="rounded bg-black/40 p-2 text-center">
                    <span className="text-[10px] text-text-faint uppercase block">Exemplars Pruned</span>
                    <span className="text-[15px] font-bold text-text">{String(curatorResult.exemplars_pruned ?? 0)}</span>
                  </div>
                  <div className="rounded bg-black/40 p-2 text-center">
                    <span className="text-[10px] text-text-faint uppercase block">Lexicon Merged</span>
                    <span className="text-[15px] font-bold text-evidence">{String(curatorResult.lexicon_duplicates_merged ?? 0)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Audit Logs Table */}
            <div className="space-y-3">
              <h3 className="text-[13.5px] font-semibold text-text">Curator Execution History & Audit Trail</h3>
              <div className="rounded-xl border border-border-subtle bg-surface/50 overflow-hidden">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="border-b border-border-subtle bg-elevated/40 text-[11px] font-medium uppercase tracking-wider text-text-faint">
                    <tr>
                      <th className="px-4 py-3">Run ID</th>
                      <th className="px-4 py-3">Trigger Mode</th>
                      <th className="px-4 py-3">Execution Duration</th>
                      <th className="px-4 py-3">Actions Executed</th>
                      <th className="px-4 py-3 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {(() => {
                      const logs = curatorStatus?.recent_runs || curatorStatus?.audit_logs || [];
                      if (logs.length === 0) {
                        return (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-text-faint text-[12px]">
                              No curator cycles recorded yet. Click &apos;Run Curator Cycle Now&apos; to trigger an on-demand audit.
                            </td>
                          </tr>
                        );
                      }
                      return logs.map((log) => (
                        <tr key={log.run_id} className="hover:bg-elevated/20 transition-colors">
                          <td className="px-4 py-3 font-mono text-[11.5px] text-text">{log.run_id}</td>
                          <td className="px-4 py-3">
                            <span className="rounded bg-elevated px-2 py-0.5 text-[11px] text-text-muted">
                              {log.triggered_by.replace("_", " ")}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-[11.5px] text-evidence">{log.duration_ms.toFixed(1)} ms</td>
                          <td className="px-4 py-3 font-mono text-[11.5px] text-text-muted max-w-xs truncate">
                            {JSON.stringify(log.actions_summary || (log as unknown as { actions: unknown }).actions)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[11.5px] text-text-faint">
                            {new Date(log.created_at).toLocaleString()}
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 4: MINED LEXICON                                              */}
        {/* ================================================================= */}
        {activeTab === "lexicon" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-display text-[15px] font-semibold text-text">
                  Self-Discovered Domain Lexicon
                </h2>
                <p className="text-[12px] text-text-muted">
                  Terms and acronyms automatically mined from call report documents to expand user queries during retrieval.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border-subtle bg-surface/50 overflow-hidden">
              <table className="w-full text-left text-[12.5px]">
                <thead className="border-b border-border-subtle bg-elevated/40 text-[11px] font-medium uppercase tracking-wider text-text-faint">
                  <tr>
                    <th className="px-4 py-3">Term / Acronym</th>
                    <th className="px-4 py-3">Expanded Definition</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Confidence</th>
                    <th className="px-4 py-3">Frequency</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {lexicon.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-text-faint text-[12px]">
                        No terms discovered yet. Upload a call report with acronym definitions to trigger autonomous discovery.
                      </td>
                    </tr>
                  ) : (
                    lexicon.map((item) => (
                      <tr key={item.id} className="hover:bg-elevated/20 transition-colors">
                        <td className="px-4 py-3 font-semibold uppercase text-text">{item.term}</td>
                        <td className="px-4 py-3 text-text-muted capitalize">{item.expansion}</td>
                        <td className="px-4 py-3">
                          <span className="rounded bg-elevated px-2 py-0.5 text-[11px] text-text-muted">
                            {item.category.replace("_", " ")}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[12px] text-evidence">
                          {Math.round(item.confidence * 100)}%
                        </td>
                        <td className="px-4 py-3 text-text-muted font-mono">{item.frequency}</td>
                        <td className="px-4 py-3">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[10px] font-medium",
                              item.status === "active"
                                ? "bg-evidence-dim/30 text-evidence"
                                : item.status === "rejected"
                                ? "bg-error/20 text-error"
                                : "bg-warning/20 text-warning"
                            )}
                          >
                            {item.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.status !== "active" && (
                              <button
                                onClick={() => handleLexiconStatusChange(item.id, "active")}
                                disabled={updatingId === item.id}
                                title="Approve term"
                                className="rounded p-1 text-text-faint hover:bg-evidence-dim/20 hover:text-evidence transition"
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {item.status !== "rejected" && (
                              <button
                                onClick={() => handleLexiconStatusChange(item.id, "rejected")}
                                disabled={updatingId === item.id}
                                title="Reject term"
                                className="rounded p-1 text-text-faint hover:bg-error/20 hover:text-error transition"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 5: ADAPTIVE UTILITY & FEW-SHOT EXEMPLARS                      */}
        {/* ================================================================= */}
        {activeTab === "utility" && (
          <div className="space-y-8">
            {/* Adaptive Utility */}
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-[15px] font-semibold text-text">
                  Adaptive Chunk Utility Multipliers
                </h2>
                <p className="text-[12px] text-text-muted">
                  Chunks that repeatedly produce verified, human-approved citations receive a positive multiplier (up to 1.30×). Chunks with stripped citations or negative feedback are penalized gracefully.
                </p>
              </div>

              <div className="rounded-xl border border-border-subtle bg-surface/50 overflow-hidden">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="border-b border-border-subtle bg-elevated/40 text-[11px] font-medium uppercase tracking-wider text-text-faint">
                    <tr>
                      <th className="px-4 py-3">Chunk ID</th>
                      <th className="px-4 py-3">Utility Multiplier</th>
                      <th className="px-4 py-3">Retrievals</th>
                      <th className="px-4 py-3">Valid Citations</th>
                      <th className="px-4 py-3">Validation Failures</th>
                      <th className="px-4 py-3">Human Feedback (+/-)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y border-border-subtle">
                    {utilityScores.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-text-faint text-[12px]">
                          No chunk utility scores recorded yet. Ask questions in the Copilot to initiate tracking.
                        </td>
                      </tr>
                    ) : (
                      utilityScores.map((score) => {
                        const isBoosted = score.utility_multiplier > 1.05;
                        const isDemoted = score.utility_multiplier < 0.95;
                        return (
                          <tr key={score.chunk_id} className="hover:bg-elevated/20 transition-colors">
                            <td className="px-4 py-3 font-mono text-[11.5px] text-text">{score.chunk_id}</td>
                            <td className="px-4 py-3">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 font-mono font-semibold px-2 py-0.5 rounded text-[11.5px]",
                                  isBoosted
                                    ? "bg-evidence-dim/30 text-evidence"
                                    : isDemoted
                                    ? "bg-error/20 text-error"
                                    : "text-text-muted"
                                )}
                              >
                                {score.utility_multiplier.toFixed(2)}×
                              </span>
                            </td>
                            <td className="px-4 py-3 font-mono text-text-muted">{score.retrieval_count}</td>
                            <td className="px-4 py-3 font-mono text-evidence">{score.citation_count}</td>
                            <td className="px-4 py-3 font-mono text-error">{score.citation_failed_count}</td>
                            <td className="px-4 py-3 font-mono text-text-muted">
                              +{score.human_positive_count} / -{score.human_negative_count}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Golden Exemplars */}
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-[15px] font-semibold text-text">
                  Dynamic Few-Shot Exemplar Memory
                </h2>
                <p className="text-[12px] text-text-muted">
                  High-confidence answers with verified citations and positive human feedback are retained as in-context reference examples for similar complex questions.
                </p>
              </div>

              <div className="space-y-3">
                {exemplars.length === 0 ? (
                  <div className="rounded-xl border border-border-subtle bg-surface/50 p-8 text-center text-text-faint text-[12px]">
                    No golden exemplars created yet. When the Copilot produces a high-confidence answer with positive feedback, it will automatically be promoted here.
                  </div>
                ) : (
                  exemplars.map((ex) => (
                    <div
                      key={ex.exemplar_id}
                      className="rounded-xl border border-border-subtle bg-surface/60 p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-primary-dim/30 text-primary border border-primary-dim/50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                            {ex.query_category}
                          </span>
                          <p className="text-[13px] font-semibold text-text">{ex.query}</p>
                        </div>
                        <span className="text-[11px] text-text-faint font-mono">
                          {ex.citation_count} citations · {ex.utility_score} utility
                        </span>
                      </div>
                      <p className="text-[12.5px] leading-relaxed text-text-muted bg-elevated/40 p-3 rounded-lg border border-border-subtle font-mono text-[11.5px]">
                        {JSON.stringify(ex.verified_answer_json, null, 2)}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
