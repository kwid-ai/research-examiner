/**
 * Eleven specialist evaluation agents + a final scoring (Chief Editor) agent.
 * Each agent returns a standardised AgentResult.
 *
 * Auth priority (first wins):
 *   1. cfg.apiKey / cfg.authToken / cfg.baseURL  (passed per-request from the UI)
 *   2. API_KEY / LLM_URL  (env vars)
 *
 * Uses the OpenAI-compatible SDK against /v1/chat/completions.
 * One of apiKey or authToken MUST be present.
 */

import OpenAI from "openai";
import { trunc } from "./document-processor";
import { log } from "./logger";

const FULL  = 90_000;
const SEC   = 40_000;
const SHORT = 20_000;

// ─────────────────────────────────────────────────────────────────────────────
// Publication detector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the document appears to already be a published work,
 * in which case publishability evaluation is not meaningful.
 * Checks the first 6 000 characters for the strongest signals.
 */
export function isAlreadyPublished(text: string): boolean {
  const head = text.slice(0, 6_000);
  return (
    /\bdoi\s*:\s*10\.\d{4,}/i.test(head)           ||  // DOI label
    /https?:\/\/doi\.org\/10\.\d/i.test(head)       ||  // DOI URL
    /\bissn\s*:?\s*\d{4}-\d{3}[\dxX]/i.test(head)  ||  // ISSN
    /\bvolume\s+\d+\b.*\bissue\s+\d+\b/i.test(head)||  // Volume … Issue
    /\bvol\.\s*\d+\b.*\bno\.\s*\d+\b/i.test(head)  ||  // Vol. X, No. Y
    /published (online|in|by)\b/i.test(head)        ||  // publication markers
    /©\s*\d{4}\b/.test(head)                        ||  // © year
    /\bcopyright\s+\d{4}\b/i.test(head)             ||  // Copyright year
    /\bpp?\.\s*\d+[-–]\d+/i.test(head)                  // pp. / p. page range
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared types
// ─────────────────────────────────────────────────────────────────────────────

export interface ClientConfig {
  apiKey?: string;
  authToken?: string;
  baseURL?: string;
  model?: string;
}

export interface AgentResult {
  agent: string;
  aspect: string;
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendations: string[];
}

export interface FinalResult {
  overall_score: number;
  verdict: string;
  score_rationale: string;
  top_strengths: string[];
  critical_weaknesses: string[];
  priority_recommendations: string[];
  publishability: string;
  sub_scores: Record<string, number>;
}

const JSON_SCHEMA = `
Return ONLY a single JSON object – no markdown fences, no extra prose.
Schema:
{
  "agent": "<agent name>",
  "aspect": "<aspect evaluated>",
  "score": <integer 0-10>,
  "summary": "<one concise paragraph>",
  "strengths": ["...", "..."],
  "weaknesses": ["...", "..."],
  "recommendations": ["...", "..."]
}`;

// ─────────────────────────────────────────────────────────────────────────────
// Client factory
// ─────────────────────────────────────────────────────────────────────────────

export function buildClient(cfg: ClientConfig = {}): OpenAI {
  const apiKey    = cfg.apiKey    || process.env.API_KEY;
  const authToken = cfg.authToken;
  const rawURL    = cfg.baseURL   || process.env.LLM_URL;

  if (!apiKey && !authToken) {
    throw new Error(
      "Authentication required: set API_KEY " +
      "(via environment variable or the in-app settings)."
    );
  }

  // Strip trailing /chat/completions — the SDK appends its own path.
  const baseURL = rawURL?.replace(/\/chat\/completions\/?$/, "");

  log.debug("OpenAI-compat client created", {
    keySource: apiKey ? "apiKey" : "authToken",
    baseURL:   baseURL ?? "(default)",
  });

  return new OpenAI({
    apiKey:  apiKey ?? authToken!,
    baseURL: baseURL,
    defaultHeaders: {
      "api-key": apiKey ?? authToken!,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Core Claude caller
// ─────────────────────────────────────────────────────────────────────────────

async function callClaude(
  systemPrompt: string,
  userMessage: string,
  cfg: ClientConfig,
  agentName: string
): Promise<string> {
  const client = buildClient(cfg);
  log.info(`Agent starting`, { agent: agentName, inputChars: userMessage.length });
  const t0 = Date.now();

  const resp = await client.chat.completions.create({
    model: cfg.model ?? process.env.LLM_MODEL ?? "gpt-4o",
    max_completion_tokens: 2500,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userMessage },
    ],
  });

  const elapsed = Date.now() - t0;
  log.info(`Agent complete`, { agent: agentName, ms: elapsed });
  return resp.choices[0].message.content ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON parser
// ─────────────────────────────────────────────────────────────────────────────

function parseJSON(
  raw: string,
  fallbackAgent: string,
  fallbackAspect: string
): AgentResult {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]) as AgentResult;
    } catch (e) {
      log.warn("JSON parse failed, using fallback", { agent: fallbackAgent, error: String(e) });
    }
  }
  return {
    agent: fallbackAgent,
    aspect: fallbackAspect,
    score: 0,
    summary: `Parse error – raw response: ${raw.slice(0, 300)}`,
    strengths: [],
    weaknesses: ["Could not parse agent response as JSON."],
    recommendations: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent implementations
// ─────────────────────────────────────────────────────────────────────────────

export async function evalToneLanguage(
  fullText: string,
  _sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const system = `You are an expert academic editor and linguist with 20+ years reviewing scholarly manuscripts.
Evaluate TONE & LANGUAGE: academic register, grammar, punctuation, run-on sentences,
clarity, conciseness, consistency of terminology, paragraph cohesion, and transition quality.
${JSON_SCHEMA}`;
  const raw = await callClaude(system, `Evaluate the tone and language:\n\n${trunc(fullText, FULL)}`, cfg, "Tone & Language");
  const r = parseJSON(raw, "Tone & Language Agent", "Tone and Language");
  r.agent = "Tone & Language Agent"; r.aspect = "Tone and Language";
  return r;
}

export async function evalLiteratureReview(
  fullText: string,
  sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const litSec = sections.literature_review ?? sections.introduction ?? fullText;
  const refSec = sections.references ?? "";
  const system = `You are a veteran academic librarian and subject-matter expert.
Critically evaluate the LITERATURE REVIEW: factual accuracy of citations, whether cited works
actually say what the author claims, coverage breadth, recency (last 5-10 years),
logical gap identification, and self-citation bias.
${JSON_SCHEMA}`;
  const raw = await callClaude(
    system,
    `=== LITERATURE REVIEW ===\n${trunc(litSec, SEC)}\n\n=== REFERENCES ===\n${trunc(refSec, SEC)}`,
    cfg, "Literature Review"
  );
  const r = parseJSON(raw, "Literature Review Agent", "Literature Review");
  r.agent = "Literature Review Agent"; r.aspect = "Literature Review";
  return r;
}

export async function evalMethodology(
  fullText: string,
  sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const methSec  = sections.methodology  ?? fullText;
  const introSec = sections.introduction ?? "";
  const system = `You are a seasoned research methodologist with expertise in quantitative,
qualitative, and mixed-methods research.
Evaluate METHODOLOGY: appropriateness of design, whether RQs/hypotheses are stated and answered,
sampling, data collection validity/reliability, analysis rigour, replicability, ethics, limitations.
${JSON_SCHEMA}`;
  const raw = await callClaude(
    system,
    `=== INTRODUCTION / RQs ===\n${trunc(introSec, SHORT)}\n\n=== METHODOLOGY ===\n${trunc(methSec, SEC)}`,
    cfg, "Methodology"
  );
  const r = parseJSON(raw, "Methodology Agent", "Methodology");
  r.agent = "Methodology Agent"; r.aspect = "Methodology";
  return r;
}

export async function evalAimsCoverage(
  fullText: string,
  sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const introSec = sections.introduction ?? fullText.slice(0, 30_000);
  const concSec  = sections.conclusion   ?? fullText.slice(-15_000);
  const system = `You are a meticulous academic reviewer specialising in research coherence.
Evaluate AIMS & COVERAGE: are objectives clearly stated? Are all objectives addressed in the body?
Does the conclusion confirm achievement of all objectives? Were any promised objectives undelivered?
Is the scope appropriate?
${JSON_SCHEMA}`;
  const raw = await callClaude(
    system,
    `=== INTRODUCTION (aims/objectives) ===\n${trunc(introSec, SEC)}\n\n=== CONCLUSION ===\n${trunc(concSec, SEC)}`,
    cfg, "Aims & Coverage"
  );
  const r = parseJSON(raw, "Aims & Coverage Agent", "Aims and Coverage");
  r.agent = "Aims & Coverage Agent"; r.aspect = "Aims and Coverage";
  return r;
}

export async function evalClaims(
  fullText: string,
  sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const resultsSec = (sections.results ?? "") + "\n\n" + (sections.discussion ?? "");
  const system = `You are a critical-thinking expert and fact-checker for academic publications.
Identify BASELESS, UNSUPPORTED, or POTENTIALLY FALSE CLAIMS: sweeping generalisations without evidence,
conclusions over-reaching data, cherry-picked data, causal claims from correlational data,
misinterpreted p-values, and lack of appropriate hedging.
${JSON_SCHEMA}`;
  const raw = await callClaude(
    system,
    `=== RESULTS / DISCUSSION ===\n${trunc(resultsSec, SEC)}\n\n=== FULL TEXT (context) ===\n${trunc(fullText, 30_000)}`,
    cfg, "Claims & Evidence"
  );
  const r = parseJSON(raw, "Claims Validation Agent", "Claims and Evidence");
  r.agent = "Claims Validation Agent"; r.aspect = "Claims and Evidence";
  return r;
}

export async function evalNovelty(
  fullText: string,
  _sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const system = `You are a distinguished professor evaluating intellectual contribution.
Assess NOVELTY & CONTRIBUTION: new concepts, models, or methods; theoretical extension;
identified gap filling; significance relative to the field; clarity of contribution articulation.
${JSON_SCHEMA}`;
  const raw = await callClaude(system, `Evaluate novelty and original contribution:\n\n${trunc(fullText, FULL)}`, cfg, "Novelty");
  const r = parseJSON(raw, "Novelty & Contribution Agent", "Novelty and Contribution");
  r.agent = "Novelty & Contribution Agent"; r.aspect = "Novelty and Contribution";
  return r;
}

export async function evalTablesFigures(
  fullText: string,
  _sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const system = `You are an academic journal copy-editor and data visualisation specialist.
Evaluate TABLES & FIGURES: sequential numbering, descriptive captions, text cross-references,
consistency between table/figure data and prose, unnecessary duplication, axis labels, units,
and completeness of statistical tables.
${JSON_SCHEMA}`;
  const raw = await callClaude(system, `Evaluate tables and figures:\n\n${trunc(fullText, FULL)}`, cfg, "Tables & Figures");
  const r = parseJSON(raw, "Tables & Figures Agent", "Tables and Figures");
  r.agent = "Tables & Figures Agent"; r.aspect = "Tables and Figures";
  return r;
}

export async function evalRedundancy(
  fullText: string,
  _sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const system = `You are a senior editor specialising in manuscript conciseness.
Identify REDUNDANT or UNNECESSARY INFORMATION: repeated ideas across sections, abstract duplicating
introduction verbatim, conclusion merely restating results, padding, verbose standard procedures,
and figures that duplicate text.
${JSON_SCHEMA}`;
  const raw = await callClaude(system, `Identify redundant content:\n\n${trunc(fullText, FULL)}`, cfg, "Redundancy");
  const r = parseJSON(raw, "Redundancy Agent", "Redundancy and Conciseness");
  r.agent = "Redundancy Agent"; r.aspect = "Redundancy and Conciseness";
  return r;
}

export async function evalCitations(
  fullText: string,
  sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const refSec = sections.references ?? fullText.slice(-20_000);
  const system = `You are a reference librarian and citation-style expert.
Audit CITATIONS & BIBLIOGRAPHY: style consistency (APA/MLA/Harvard/Vancouver), in-text vs reference
list alignment, completeness of entries (author, year, title, source, DOI/URL), broken citations,
primary vs secondary source balance, recency, and proper web citation with access dates.
${JSON_SCHEMA}`;
  const raw = await callClaude(
    system,
    `=== REFERENCES ===\n${trunc(refSec, SEC)}\n\n=== FULL TEXT (in-text citations) ===\n${trunc(fullText, 30_000)}`,
    cfg, "Citations"
  );
  const r = parseJSON(raw, "Citations & Bibliography Agent", "Citations and Bibliography");
  r.agent = "Citations & Bibliography Agent"; r.aspect = "Citations and Bibliography";
  return r;
}

export async function evalPublishability(
  fullText: string,
  _sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const system = `You are a journal editor-in-chief with 25 years across multiple high-impact journals.
Assess PUBLISHABILITY: overall scientific rigour, significance, structural adherence, suitability
for peer review. Recommend three specific named journals ranked by fit. State whether the paper
requires major revision, minor revision, or is near ready.
${JSON_SCHEMA}`;
  const raw = await callClaude(system, `Assess publishability and recommend journals:\n\n${trunc(fullText, FULL)}`, cfg, "Publishability");
  const r = parseJSON(raw, "Publishability Agent", "Publishability and Journal Fit");
  r.agent = "Publishability Agent"; r.aspect = "Publishability and Journal Fit";
  return r;
}

export async function evalSOTA(
  fullText: string,
  sections: Record<string, string>,
  cfg: ClientConfig = {}
): Promise<AgentResult> {
  const litSec = sections.literature_review ?? sections.introduction ?? fullText.slice(0, 40_000);
  const system = `You are a domain expert current with cutting-edge literature.
Compare this research to the STATE OF THE ART: how it positions against recent advances,
engagement with latest developments, whether methods are current best practice or outdated,
baselines/comparisons to leading approaches, gaps in contemporary literature awareness.
${JSON_SCHEMA}`;
  const raw = await callClaude(
    system,
    `=== LITERATURE / INTRODUCTION ===\n${trunc(litSec, SEC)}\n\n=== FULL PAPER ===\n${trunc(fullText, 30_000)}`,
    cfg, "SOTA"
  );
  const r = parseJSON(raw, "SOTA Comparison Agent", "State-of-the-Art Comparison");
  r.agent = "SOTA Comparison Agent"; r.aspect = "State-of-the-Art Comparison";
  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent registry
// ─────────────────────────────────────────────────────────────────────────────

export type AgentFn = (
  fullText: string,
  sections: Record<string, string>,
  cfg?: ClientConfig
) => Promise<AgentResult>;

export const AGENTS: Array<{ id: string; label: string; fn: AgentFn }> = [
  { id: "tone_language",     label: "Tone & Language",           fn: evalToneLanguage },
  { id: "literature_review", label: "Literature Review",         fn: evalLiteratureReview },
  { id: "methodology",       label: "Methodology",               fn: evalMethodology },
  { id: "aims_coverage",     label: "Aims & Coverage",           fn: evalAimsCoverage },
  { id: "claims",            label: "Claims & Evidence",         fn: evalClaims },
  { id: "novelty",           label: "Novelty & Contribution",    fn: evalNovelty },
  { id: "tables_figures",    label: "Tables & Figures",          fn: evalTablesFigures },
  { id: "redundancy",        label: "Redundancy",                fn: evalRedundancy },
  { id: "citations",         label: "Citations & Bibliography",  fn: evalCitations },
  { id: "publishability",    label: "Publishability",            fn: evalPublishability },
  { id: "sota",              label: "State-of-the-Art",          fn: evalSOTA },
];

// ─────────────────────────────────────────────────────────────────────────────
// Chief Editor — final scoring agent
// ─────────────────────────────────────────────────────────────────────────────

export async function computeFinalScore(
  agentResults: Record<string, AgentResult>,
  meta: { filename: string; wordCount: number },
  cfg: ClientConfig = {}
): Promise<FinalResult> {
  const subScoresSummary = Object.entries(agentResults)
    .map(([, r]) => `- ${r.aspect} [${r.score}/10]: ${r.summary}`)
    .join("\n");

  const fullReports = JSON.stringify(
    Object.fromEntries(
      Object.entries(agentResults).map(([id, r]) => [
        id,
        { score: r.score, summary: r.summary, strengths: r.strengths, weaknesses: r.weaknesses, recommendations: r.recommendations },
      ])
    ),
    null, 2
  );

  const system = `You are the Chief Editor and Lead Examiner of a prestigious academic journal.
You have received evaluation reports from 11 specialist reviewers for a single research paper.
Synthesise all findings into a FINAL OVERALL ASSESSMENT.

Return ONLY a JSON object – no markdown fences, no extra prose.
Schema:
{
  "overall_score": <integer 0-10>,
  "verdict": "<Reject | Major Revision | Minor Revision | Accept with Corrections | Accept>",
  "score_rationale": "<3-5 paragraph explanation referencing specific reviewer findings>",
  "top_strengths": ["...", "..."],
  "critical_weaknesses": ["...", "..."],
  "priority_recommendations": ["1. ...", "2. ...", "3. ...", "4. ...", "5. ..."],
  "publishability": "<named journal recommendations and tier reasoning>",
  "sub_scores": { "<aspect>": <score>, ... }
}`;

  const user = `Document: ${meta.filename} (${meta.wordCount.toLocaleString()} words)\n\n=== SUB-EVALUATIONS SUMMARY ===\n${subScoresSummary}\n\n=== FULL REVIEWER REPORTS ===\n${fullReports}`;

  log.info("Chief Editor agent starting", { filename: meta.filename });
  const raw = await callClaude(system, user, cfg, "Chief Editor");

  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]) as FinalResult; }
    catch (e) { log.error("Chief Editor JSON parse failed", { error: String(e) }); }
  }

  return {
    overall_score: 5, verdict: "Unable to parse",
    score_rationale: raw, top_strengths: [], critical_weaknesses: [],
    priority_recommendations: [], publishability: "", sub_scores: {},
  };
}
