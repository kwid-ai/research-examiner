"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  ChangeEvent,
} from "react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface AgentResult {
  agent: string;
  aspect: string;
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

interface FinalResult {
  overall_score: number;
  verdict: string;
  score_rationale: string;
  top_strengths: string[];
  critical_weaknesses: string[];
  priority_recommendations: string[];
  publishability: string;
  sub_scores: Record<string, number>;
}

type AgentStatus = "waiting" | "running" | "done" | "error" | "skipped";

interface AgentState {
  id: string;
  label: string;
  status: AgentStatus;
  result?: AgentResult;
  skipReason?: string;
}

type Msg =
  | { id: string; type: "assistant"; text: string }
  | { id: string; type: "user"; text: string }
  | { id: string; type: "status"; text: string; done?: boolean }
  | { id: string; type: "agents"; agents: AgentState[] }
  | { id: string; type: "final"; result: FinalResult };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2);
}

function scoreColor(s: number) {
  if (s >= 8) return { ring: "#059669", bg: "bg-emerald-50", text: "text-emerald-700", badge: "bg-emerald-100 text-emerald-800" };
  if (s >= 6) return { ring: "#d97706", bg: "bg-amber-50",   text: "text-amber-700",   badge: "bg-amber-100 text-amber-800" };
  if (s >= 4) return { ring: "#ea580c", bg: "bg-orange-50",  text: "text-orange-700",  badge: "bg-orange-100 text-orange-800" };
  return       { ring: "#dc2626", bg: "bg-red-50",    text: "text-red-700",    badge: "bg-red-100 text-red-800" };
}

function verdictColor(v: string) {
  const l = v.toLowerCase();
  if (l.includes("accept") && !l.includes("correct")) return "bg-emerald-100 text-emerald-800";
  if (l.includes("minor") || l.includes("correct"))   return "bg-amber-100 text-amber-800";
  if (l.includes("major"))                             return "bg-orange-100 text-orange-800";
  return "bg-red-100 text-red-800";
}

// Parses SSE text; returns array of parsed JSON objects
function parseSSE(raw: string): unknown[] {
  return raw
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
    .map((l) => {
      try { return JSON.parse(l.slice(6)); } catch { return null; }
    })
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <span className="dot-pulse inline-flex items-center gap-1">
      <span /><span /><span />
    </span>
  );
}

function ScoreRing({ score }: { score: number }) {
  const r          = 52;
  const circ       = 2 * Math.PI * r;
  const offset     = circ - (score / 10) * circ;
  const { ring }   = scoreColor(score);

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="128" height="128" className="-rotate-90">
        <circle cx="64" cy="64" r={r} stroke="#e2e8f0" strokeWidth="10" fill="none" />
        <circle
          cx="64" cy="64" r={r}
          stroke={ring} strokeWidth="10" fill="none"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          className="score-ring-circle"
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold text-slate-900">{score}</span>
        <span className="text-xs text-slate-400 font-medium">/ 10</span>
      </div>
    </div>
  );
}

function AgentRow({ a }: { a: AgentState }) {
  const [open, setOpen] = useState(false);
  const s = a.result?.score ?? 0;
  const c = scoreColor(s);

  const icon =
    a.status === "waiting" ? (
      <span className="w-4 h-4 rounded-full border-2 border-slate-300 inline-block" />
    ) : a.status === "running" ? (
      <svg className="w-4 h-4 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
    ) : a.status === "skipped" ? (
      <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 12H6m6-6l6 6-6 6" />
      </svg>
    ) : (
      <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );

  if (a.status === "skipped") {
    return (
      <div className="border border-slate-100 rounded-xl overflow-hidden">
        <div className="w-full flex items-center gap-3 px-4 py-3 opacity-50">
          <span className="shrink-0">{icon}</span>
          <span className="flex-1 text-sm font-medium text-slate-500 line-through">{a.label}</span>
          <span className="text-xs text-slate-400 italic">{a.skipReason ?? "Skipped"}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <button
        onClick={() => a.status === "done" && setOpen((o) => !o)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
          a.status === "done" ? "hover:bg-slate-50 cursor-pointer" : "cursor-default"
        }`}
      >
        <span className="shrink-0">{icon}</span>
        <span className="flex-1 text-sm font-medium text-slate-700">{a.label}</span>

        {a.status === "running" && (
          <span className="text-xs text-indigo-500 animate-pulse">Analysing…</span>
        )}
        {a.status === "done" && a.result && (
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.badge}`}>
            {s}/10
          </span>
        )}
        {a.status === "done" && (
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {open && a.result && (
        <div className={`px-4 pb-4 space-y-3 text-sm ${c.bg} border-t border-slate-100`}>
          <p className="text-slate-600 pt-3 leading-relaxed">{a.result.summary}</p>

          {a.result.strengths.length > 0 && (
            <div>
              <p className="font-semibold text-slate-700 mb-1">Strengths</p>
              <ul className="space-y-1">
                {a.result.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2 text-slate-600">
                    <span className="text-emerald-500 mt-0.5 shrink-0">✓</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.result.weaknesses.length > 0 && (
            <div>
              <p className="font-semibold text-slate-700 mb-1">Weaknesses</p>
              <ul className="space-y-1">
                {a.result.weaknesses.map((w, i) => (
                  <li key={i} className="flex gap-2 text-slate-600">
                    <span className="text-red-400 mt-0.5 shrink-0">✗</span>{w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.result.recommendations.length > 0 && (
            <div>
              <p className="font-semibold text-slate-700 mb-1">Recommendations</p>
              <ul className="space-y-1">
                {a.result.recommendations.map((r, i) => (
                  <li key={i} className="flex gap-2 text-slate-600">
                    <span className="text-indigo-400 mt-0.5 shrink-0">→</span>{r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AgentsPanel({ agents }: { agents: AgentState[] }) {
  const done  = agents.filter((a) => a.status === "done").length;
  const total = agents.length;
  const pct   = total > 0 ? (done / total) * 100 : 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-500 font-medium">
          Running evaluation agents
        </span>
        <span className="text-indigo-600 font-semibold">{done}/{total}</span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="space-y-1.5">
        {agents.map((a) => (
          <AgentRow key={a.id} a={a} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF report generator
// ─────────────────────────────────────────────────────────────────────────────

function scoreHex(s: number) {
  if (s >= 8) return "#059669";
  if (s >= 6) return "#d97706";
  if (s >= 4) return "#ea580c";
  return "#dc2626";
}

function verdictStyle(v: string): { bg: string; color: string } {
  const l = v.toLowerCase();
  if (l.includes("accept") && !l.includes("correct")) return { bg: "#d1fae5", color: "#065f46" };
  if (l.includes("minor") || l.includes("correct"))   return { bg: "#fef3c7", color: "#92400e" };
  if (l.includes("major"))                             return { bg: "#ffedd5", color: "#9a3412" };
  return { bg: "#fee2e2", color: "#991b1b" };
}

function buildReportHTML(result: FinalResult, filename: string): string {
  const vc       = verdictStyle(result.verdict);
  const sc       = scoreHex(result.overall_score);
  const subScores = Object.entries(result.sub_scores ?? {}).sort(([, a], [, b]) => b - a);
  const date     = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const bars = subScores.map(([aspect, score]) => {
    const hex = scoreHex(Number(score));
    const pct = (Number(score) / 10) * 100;
    return `<div class="bar-row">
      <span class="bar-label">${aspect}</span>
      <div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${hex}"></div></div>
      <span class="bar-score" style="color:${hex}">${score}/10</span>
    </div>`;
  }).join("");

  const strengths = result.top_strengths.map(s =>
    `<li><span style="color:#059669">✓</span> ${s}</li>`).join("");
  const weaknesses = result.critical_weaknesses.map(w =>
    `<li><span style="color:#dc2626">✗</span> ${w}</li>`).join("");
  const recs = result.priority_recommendations.map((r, i) =>
    `<div class="rec-item"><span class="rec-num">${i + 1}</span><span>${r.replace(/^\d+\.\s*/, "")}</span></div>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<title>Research Evaluation Report${filename ? " – " + filename : ""}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; max-width: 820px; margin: 0 auto; padding: 48px 40px; color: #1e293b; }
  h1 { font-size: 22px; font-weight: bold; }
  h2 { font-size: 15px; font-weight: bold; margin: 24px 0 8px; }
  p { font-size: 13px; line-height: 1.75; color: #475569; }
  .meta { font-size: 12px; color: #94a3b8; margin: 4px 0 28px; }
  .score-row { display: flex; align-items: center; gap: 24px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 20px; }
  .score-circle { width: 76px; height: 76px; border-radius: 50%; border: 6px solid ${sc}; color: ${sc}; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: bold; flex-shrink: 0; }
  .verdict-badge { display: inline-block; padding: 4px 14px; border-radius: 20px; font-size: 13px; font-weight: 600; background: ${vc.bg}; color: ${vc.color}; margin-top: 6px; }
  .box { border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
  .box-green { border-color: #a7f3d0; background: #f0fdf4; }
  .box-red   { border-color: #fecaca; background: #fef2f2; }
  .box-blue  { border-color: #c7d2fe; background: #eef2ff; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  ul { list-style: none; padding: 0; }
  li { font-size: 13px; color: #475569; margin-bottom: 6px; display: flex; gap: 8px; line-height: 1.5; }
  .bar-row { display: flex; align-items: center; gap: 12px; margin-bottom: 7px; }
  .bar-label { width: 190px; font-size: 12px; color: #64748b; flex-shrink: 0; }
  .bar-bg { flex: 1; height: 8px; background: #f1f5f9; border-radius: 4px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 4px; }
  .bar-score { font-size: 12px; font-weight: bold; width: 36px; text-align: right; flex-shrink: 0; }
  .rec-item { display: flex; gap: 10px; margin-bottom: 8px; align-items: flex-start; font-size: 13px; color: #475569; }
  .rec-num { width: 20px; height: 20px; border-radius: 50%; background: #e0e7ff; color: #4338ca; font-size: 11px; font-weight: bold; display: flex; align-items: center; justify-content: center; flex-shrink: 0; line-height: 1; }
  @media print { body { padding: 20px; } }
</style></head><body>
  <h1>Research Evaluation Report</h1>
  <p class="meta">Generated ${date}${filename ? " · " + filename : ""}</p>

  <div class="score-row">
    <div class="score-circle">${result.overall_score}</div>
    <div>
      <div style="font-size:20px;font-weight:bold;color:#1e293b">Final Assessment</div>
      <div class="verdict-badge">${result.verdict}</div>
    </div>
  </div>

  <div class="box">
    <h2 style="margin-top:0">Score Rationale</h2>
    <p>${result.score_rationale.replace(/\n/g, "<br>")}</p>
  </div>

  <div class="grid">
    <div class="box box-green">
      <h2 style="margin-top:0;color:#065f46">Top Strengths</h2>
      <ul>${strengths}</ul>
    </div>
    <div class="box box-red">
      <h2 style="margin-top:0;color:#991b1b">Critical Weaknesses</h2>
      <ul>${weaknesses}</ul>
    </div>
  </div>

  <div class="box">
    <h2 style="margin-top:0">Priority Recommendations</h2>
    ${recs}
  </div>

  ${result.publishability ? `<div class="box box-blue">
    <h2 style="margin-top:0;color:#3730a3">Journal Recommendation</h2>
    <p>${result.publishability}</p>
  </div>` : ""}

  ${subScores.length > 0 ? `<div class="box">
    <h2 style="margin-top:0">Per-Aspect Scores</h2>
    ${bars}
  </div>` : ""}
</body></html>`;
}

function FinalReport({ result, filename }: { result: FinalResult; filename?: string }) {
  const c        = scoreColor(result.overall_score);
  const vc       = verdictColor(result.verdict);

  // Sub-scores sorted descending
  const subScores = Object.entries(result.sub_scores ?? {}).sort(([, a], [, b]) => b - a);

  return (
    <div className="space-y-6">
      {/* Score + verdict banner */}
      <div className="flex flex-col sm:flex-row items-center gap-6 p-6 bg-white rounded-2xl border border-slate-100 shadow-sm">
        <ScoreRing score={result.overall_score} />
        <div className="text-center sm:text-left space-y-2 flex-1">
          <h2 className="text-2xl font-bold text-slate-900">Final Assessment</h2>
          <span className={`inline-block px-3 py-1 rounded-full text-sm font-semibold ${vc}`}>
            {result.verdict}
          </span>
        </div>
        <button
          onClick={() => {
            const html = buildReportHTML(result, filename ?? "");
            const blob = new Blob([html], { type: "text/html" });
            const url  = URL.createObjectURL(blob);
            const w    = window.open(url, "_blank");
            if (w) w.onload = () => { w.print(); URL.revokeObjectURL(url); };
          }}
          className="shrink-0 flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-8m0 8l-3-3m3 3l3-3M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1" />
          </svg>
          Download PDF
        </button>
      </div>

      {/* Score rationale */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-2">
        <h3 className="font-semibold text-slate-800">Score Rationale</h3>
        <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
          {result.score_rationale}
        </p>
      </div>

      {/* Strengths + Weaknesses */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-emerald-50 rounded-2xl border border-emerald-100 p-5 space-y-2">
          <h3 className="font-semibold text-emerald-800">Top Strengths</h3>
          <ul className="space-y-2">
            {result.top_strengths.map((s, i) => (
              <li key={i} className="flex gap-2 text-sm text-emerald-700">
                <span className="shrink-0 mt-0.5">✓</span>{s}
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-red-50 rounded-2xl border border-red-100 p-5 space-y-2">
          <h3 className="font-semibold text-red-800">Critical Weaknesses</h3>
          <ul className="space-y-2">
            {result.critical_weaknesses.map((w, i) => (
              <li key={i} className="flex gap-2 text-sm text-red-700">
                <span className="shrink-0 mt-0.5">✗</span>{w}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Priority recommendations */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-2">
        <h3 className="font-semibold text-slate-800">Priority Recommendations</h3>
        <ol className="space-y-2">
          {result.priority_recommendations.map((r, i) => (
            <li key={i} className="flex gap-3 text-sm text-slate-600">
              <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              {r.replace(/^\d+\.\s*/, "")}
            </li>
          ))}
        </ol>
      </div>

      {/* Publishability */}
      {result.publishability && (
        <div className="bg-indigo-50 rounded-2xl border border-indigo-100 p-5 space-y-2">
          <h3 className="font-semibold text-indigo-800">Journal Recommendation</h3>
          <p className="text-sm text-indigo-700 leading-relaxed">{result.publishability}</p>
        </div>
      )}

      {/* Sub-scores table */}
      {subScores.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-3">
          <h3 className="font-semibold text-slate-800">Per-Aspect Scores</h3>
          <div className="space-y-2">
            {subScores.map(([aspect, score]) => {
              const sc = scoreColor(Number(score));
              return (
                <div key={aspect} className="flex items-center gap-3">
                  <span className="w-44 text-xs text-slate-500 truncate shrink-0">{aspect}</span>
                  <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${(Number(score) / 10) * 100}%`, background: sc.ring }}
                    />
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${sc.badge}`}>
                    {score}/10
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadArea({
  onFile,
  disabled,
}: {
  onFile: (f: File) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handle(f: File) {
    const ok = f.name.toLowerCase().match(/\.(pdf|docx|doc)$/);
    if (!ok) {
      alert("Please upload a PDF or DOCX file.");
      return;
    }
    onFile(f);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const f = e.dataTransfer.files[0];
        if (f) handle(f);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-10 cursor-pointer transition-all
        ${disabled ? "opacity-50 cursor-not-allowed" : ""}
        ${dragging
          ? "border-indigo-400 bg-indigo-50"
          : "border-slate-200 bg-white hover:border-indigo-300 hover:bg-slate-50"
        }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,.doc"
        className="hidden"
        disabled={disabled}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const f = e.target.files?.[0];
          if (f) handle(f);
        }}
      />
      <div className="w-12 h-12 rounded-2xl bg-indigo-100 flex items-center justify-center">
        <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m.75 12l3 3m0 0l3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-slate-700">
          Drop your paper here or <span className="text-indigo-600">browse</span>
        </p>
        <p className="text-xs text-slate-400 mt-1">PDF or DOCX · up to 10 MB</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

const WELCOME: Msg = {
  id: "welcome",
  type: "assistant",
  text: "Hello! I'm your **AI Research Examiner** — a multi-agent peer review system backed by 11 specialist evaluators.\n\nUpload your research paper (PDF or DOCX) below and I'll critically analyse it across dimensions including methodology, literature review, novelty, claims validity, and more. You'll receive a detailed report with an overall score out of 10.",
};

const AGENT_LABELS = [
  { id: "tone_language",     label: "Tone & Language" },
  { id: "literature_review", label: "Literature Review" },
  { id: "methodology",       label: "Methodology" },
  { id: "aims_coverage",     label: "Aims & Coverage" },
  { id: "claims",            label: "Claims & Evidence" },
  { id: "novelty",           label: "Novelty & Contribution" },
  { id: "tables_figures",    label: "Tables & Figures" },
  { id: "redundancy",        label: "Redundancy" },
  { id: "citations",         label: "Citations & Bibliography" },
  { id: "publishability",    label: "Publishability" },
  { id: "sota",              label: "State-of-the-Art" },
];

export default function Home() {
  const [messages, setMessages]           = useState<Msg[]>([WELCOME]);
  const [apiKey, setApiKey]               = useState(process.env.NEXT_PUBLIC_API_KEY    ?? "");
  const [authToken, setAuthToken]         = useState("");
  const [baseURL, setBaseURL]             = useState(process.env.NEXT_PUBLIC_LLM_URL    ?? "");
  const [model, setModel]                 = useState(process.env.NEXT_PUBLIC_LLM_MODEL  ?? "");
  const [showKey, setShowKey]             = useState(false);
  const [showSettings, setShowSettings]   = useState(false);
  const [evaluating, setEvaluating]       = useState(false);
  const [evalDone, setEvalDone]           = useState(false);
  const [followUp, setFollowUp]           = useState("");
  const [followLoading, setFollowLoading] = useState(false);
  const [evalContext, setEvalContext]     = useState("");
  const [reportFilename, setReportFilename] = useState("");
  const [phase, setPhase]                 = useState("");
  const [elapsedSecs, setElapsedSecs]     = useState(0);

  const agentsMsgId  = useRef<string | null>(null);
  const agentsRef    = useRef<AgentState[]>(
    AGENT_LABELS.map(({ id, label }) => ({ id, label, status: "waiting" as const }))
  );
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);

  const bottomRef = useRef<HTMLDivElement>(null);
  const chatRef   = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const upsertMsg = useCallback((msg: Msg) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx === -1) return [...prev, msg];
      const next = [...prev];
      next[idx] = msg;
      return next;
    });
  }, []);

  async function handleEvaluate(file: File) {
    if (evaluating) return;

    agentsRef.current = AGENT_LABELS.map(({ id, label }) => ({
      id, label, status: "waiting" as const,
    }));
    const agMsgId = uid();
    agentsMsgId.current = agMsgId;
    setEvaluating(true);
    setPhase("parsing");
    setElapsedSecs(0);
    startTimeRef.current = Date.now();
    elapsedTimer.current = setInterval(() => {
      setElapsedSecs(Math.round((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    upsertMsg({ id: uid(), type: "user", text: `Evaluate: **${file.name}** (${(file.size / 1024).toFixed(1)} KB)` });

    const statusId = uid();
    upsertMsg({ id: statusId, type: "status", text: "Parsing document…" });

    const formData = new FormData();
    formData.append("file", file);
    if (apiKey)    formData.append("apiKey",    apiKey);
    if (authToken) formData.append("authToken", authToken);
    if (baseURL)   formData.append("baseURL",   baseURL);
    if (model)     formData.append("model",     model);

    try {
      const resp = await fetch("/api/evaluate", { method: "POST", body: formData });
      if (!resp.ok) {
        let detail = `Server error ${resp.status}`;
        try { const j = await resp.json(); detail = j.error ?? detail; } catch {}
        throw new Error(detail);
      }
      if (!resp.body) throw new Error("No response body");

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = parseSSE(buffer);
        // Keep only the part after the last complete event
        const lastSep = buffer.lastIndexOf("\n\n");
        if (lastSep !== -1) buffer = buffer.slice(lastSep + 2);

        for (const ev of events) {
          const e = ev as Record<string, unknown>;

          if (e.type === "status") {
            upsertMsg({ id: statusId, type: "status", text: e.message as string });
            if (e.phase) setPhase(e.phase as string);
          }

          if (e.type === "document_parsed") {
            setReportFilename(e.filename as string);
            upsertMsg({
              id: statusId, type: "status",
              text: `Document parsed — **${(e.filename as string)}** · ${(e.wordCount as number).toLocaleString()} words · Sections: ${(e.sections as string[]).join(", ")}`,
            });
            // Show agents panel
            upsertMsg({
              id: agMsgId,
              type: "agents",
              agents: [...agentsRef.current],
            });
          }

          if (e.type === "agent_skipped") {
            const idx = agentsRef.current.findIndex((a) => a.id === e.id);
            if (idx !== -1) {
              agentsRef.current[idx].status = "skipped";
              agentsRef.current[idx].skipReason = e.reason as string;
            }
            upsertMsg({ id: agMsgId, type: "agents", agents: [...agentsRef.current] });
          }

          if (e.type === "agent_start") {
            const idx = agentsRef.current.findIndex((a) => a.id === e.id);
            if (idx !== -1) agentsRef.current[idx].status = "running";
            upsertMsg({ id: agMsgId, type: "agents", agents: [...agentsRef.current] });
          }

          if (e.type === "agent_complete") {
            const idx = agentsRef.current.findIndex((a) => a.id === e.id);
            if (idx !== -1) {
              agentsRef.current[idx].status = "done";
              agentsRef.current[idx].result = e.result as AgentResult;
            }
            upsertMsg({ id: agMsgId, type: "agents", agents: [...agentsRef.current] });
          }

          if (e.type === "final_result") {
            const final = e.result as FinalResult;
            upsertMsg({ id: statusId, type: "status", text: "Evaluation complete", done: true });
            upsertMsg({ id: uid(), type: "final", result: final });
            upsertMsg({
              id: uid(), type: "assistant",
              text: `Evaluation complete. **Overall score: ${final.overall_score}/10** — ${final.verdict}.\n\nYou can ask me any follow-up questions about the review below.`,
            });

            // Build context string for follow-up chat
            setEvalContext(
              `Overall score: ${final.overall_score}/10 — ${final.verdict}\n` +
              `Rationale: ${final.score_rationale.slice(0, 800)}\n` +
              `Strengths: ${final.top_strengths.join("; ")}\n` +
              `Weaknesses: ${final.critical_weaknesses.join("; ")}\n` +
              `Recommendations: ${final.priority_recommendations.join("; ")}\n` +
              `Publishability: ${final.publishability}`
            );
            setEvalDone(true);
          }

          if (e.type === "error") {
            upsertMsg({ id: uid(), type: "assistant", text: `Error: ${e.message as string}` });
          }
        }
      }
    } catch (err) {
      upsertMsg({ id: uid(), type: "assistant", text: `Something went wrong: ${String(err)}` });
    } finally {
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
      setEvaluating(false);
      setPhase("");
    }
  }

  async function handleFollowUp() {
    if (!followUp.trim() || followLoading) return;
    const q = followUp.trim();
    setFollowUp("");
    setFollowLoading(true);

    upsertMsg({ id: uid(), type: "user", text: q });

    const replyId = uid();
    upsertMsg({ id: replyId, type: "assistant", text: "" });

    try {
      const resp = await fetch("/api/followup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, context: evalContext, apiKey, authToken, baseURL, model }),
      });
      if (!resp.body) throw new Error("No stream");

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let   buf     = "";
      let   full    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.text) {
              full += d.text;
              upsertMsg({ id: replyId, type: "assistant", text: full });
            }
          } catch {}
        }
      }
    } catch (err) {
      upsertMsg({ id: replyId, type: "assistant", text: `Error: ${String(err)}` });
    } finally {
      setFollowLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-slate-50">

      {/* ── Header ── */}
      <header className="shrink-0 bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3 shadow-sm z-10">
        <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shrink-0">
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-bold text-slate-900 leading-none">Research Examiner</h1>
          <p className="text-xs text-slate-400 mt-0.5">AI-powered peer review · 11 specialist agents</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Settings toggle */}
          <button
            onClick={() => setShowSettings((s) => !s)}
            title="API credentials & settings"
            className={`p-1.5 rounded-lg transition-colors ${showSettings ? "bg-indigo-100 text-indigo-600" : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* ── Settings panel ── */}
      {showSettings && (
        <div className="shrink-0 bg-slate-50 border-b border-slate-200 px-4 py-3 space-y-2 z-10">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Authentication — one of API Key or Auth Token is required
          </p>
          <div className="flex flex-wrap gap-3">
            {/* API Key */}
            <div className="flex items-center gap-2 flex-1 min-w-52">
              <label className="text-xs text-slate-500 w-20 shrink-0">API Key</label>
              <div className="relative flex-1">
                <input
                  type={showKey ? "text" : "password"}
                  placeholder="sk-ant-…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700 placeholder-slate-300"
                />
                <button onClick={() => setShowKey((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    {showKey
                      ? <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      : <><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></>
                    }
                  </svg>
                </button>
              </div>
            </div>
            {/* Auth Token */}
            <div className="flex items-center gap-2 flex-1 min-w-52">
              <label className="text-xs text-slate-500 w-20 shrink-0">Auth Token</label>
              <input
                type="password"
                placeholder="Bearer token alternative"
                value={authToken}
                onChange={(e) => setAuthToken(e.target.value)}
                className="flex-1 text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700 placeholder-slate-300"
              />
            </div>
            {/* Base URL */}
            <div className="flex items-center gap-2 flex-1 min-w-64">
              <label className="text-xs text-slate-500 w-20 shrink-0">Base URL</label>
              <input
                type="text"
                placeholder="https://api.anthropic.com (optional)"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                className="flex-1 text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700 placeholder-slate-300"
              />
            </div>
            {/* Model */}
            <div className="flex items-center gap-2 flex-1 min-w-48">
              <label className="text-xs text-slate-500 w-20 shrink-0">Model</label>
              <input
                type="text"
                placeholder="gpt-4o"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="flex-1 text-xs bg-white border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-300 text-slate-700 placeholder-slate-300"
              />
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Credentials are sent only to your own server and forwarded to the Anthropic API. They are never stored.
          </p>
        </div>
      )}

      {/* ── Phase status strip (visible only during evaluation) ── */}
      {evaluating && (
        <div className="shrink-0 bg-indigo-600 px-4 py-1.5 flex items-center gap-2.5">
          <svg className="w-3.5 h-3.5 animate-spin text-indigo-200 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
          </svg>
          <span className="text-xs text-indigo-100 font-medium">
            {phase === "parsing"  && "Parsing document…"}
            {phase === "agents"   && "Running evaluation agents…"}
            {phase === "scoring"  && "Chief Editor computing final score…"}
            {!phase               && "Processing…"}
          </span>
          <span className="ml-auto text-xs text-indigo-300 tabular-nums">{elapsedSecs}s</span>
        </div>
      )}

      {/* ── Chat area ── */}
      <div ref={chatRef} className="flex-1 overflow-y-auto px-4 py-6 space-y-5">
        <div className="max-w-3xl mx-auto space-y-5">
          {messages.map((msg) => {
            if (msg.type === "user") {
              return (
                <div key={msg.id} className="flex justify-end msg-enter">
                  <div className="max-w-lg bg-indigo-600 text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed shadow-sm">
                    <Markdown text={msg.text} />
                  </div>
                </div>
              );
            }

            if (msg.type === "assistant") {
              return (
                <div key={msg.id} className="flex gap-3 msg-enter">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 shrink-0 flex items-center justify-center mt-1">
                    <svg className="w-3.5 h-3.5 text-indigo-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                  </div>
                  <div className="max-w-2xl bg-white px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-slate-700 leading-relaxed border border-slate-100 shadow-sm">
                    {msg.text ? <Markdown text={msg.text} /> : <ThinkingDots />}
                  </div>
                </div>
              );
            }

            if (msg.type === "status") {
              return (
                <div key={msg.id} className="flex justify-center msg-enter">
                  <div className="flex items-center gap-2 bg-slate-100 text-slate-500 text-xs px-3 py-1.5 rounded-full">
                    {msg.done ? (
                      <svg className="w-3.5 h-3.5 text-emerald-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                      </svg>
                    )}
                    <Markdown text={msg.text} />
                  </div>
                </div>
              );
            }

            if (msg.type === "agents") {
              return (
                <div key={msg.id} className="flex gap-3 msg-enter">
                  <div className="w-7 h-7 rounded-full bg-indigo-100 shrink-0 mt-1 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-indigo-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                    </svg>
                  </div>
                  <div className="flex-1 max-w-2xl bg-white px-4 py-4 rounded-2xl rounded-tl-sm border border-slate-100 shadow-sm">
                    <AgentsPanel agents={msg.agents} />
                  </div>
                </div>
              );
            }

            if (msg.type === "final") {
              return (
                <div key={msg.id} className="msg-enter">
                  <FinalReport result={msg.result} filename={reportFilename} />
                </div>
              );
            }

            return null;
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* ── Input area ── */}
      <div className="shrink-0 border-t border-slate-100 bg-white px-4 py-4 shadow-[0_-1px_3px_rgba(0,0,0,0.05)]">
        <div className="max-w-3xl mx-auto">
          {!evalDone ? (
            <UploadArea onFile={handleEvaluate} disabled={evaluating} />
          ) : (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Ask a follow-up question about the review…"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleFollowUp()}
                className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
              <button
                onClick={handleFollowUp}
                disabled={followLoading || !followUp.trim()}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium"
              >
                {followLoading
                  ? <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                  : <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" /></svg>
                }
                Send
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal Markdown renderer (bold, italic, inline code only)
// ─────────────────────────────────────────────────────────────────────────────
function Markdown({ text }: { text: string }) {
  // Split by newlines, render each line
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <React.Fragment key={i}>
          <InlineMd text={line} />
          {i < lines.length - 1 && <br />}
        </React.Fragment>
      ))}
    </>
  );
}

function InlineMd({ text }: { text: string }) {
  // Handle **bold**, *italic*, `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**"))
          return <strong key={i} className="font-semibold">{p.slice(2, -2)}</strong>;
        if (p.startsWith("*") && p.endsWith("*"))
          return <em key={i}>{p.slice(1, -1)}</em>;
        if (p.startsWith("`") && p.endsWith("`"))
          return <code key={i} className="bg-slate-100 text-indigo-700 px-1 rounded text-xs font-mono">{p.slice(1, -1)}</code>;
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}
