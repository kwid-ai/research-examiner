import { NextRequest } from "next/server";
import { processDocument } from "@/lib/document-processor";
import { AGENTS, computeFinalScore, isAlreadyPublished, AgentResult, ClientConfig } from "@/lib/agents";
import { log } from "@/lib/logger";

export const runtime     = "nodejs";
export const maxDuration = 120;

const enc = new TextEncoder();
function sseData(data: object): Uint8Array { return enc.encode(`data: ${JSON.stringify(data)}\n\n`); }
function sseHeartbeat(): Uint8Array { return enc.encode(`: heartbeat\n\n`); }

export async function POST(req: NextRequest) {
  const formData  = await req.formData();
  const file      = formData.get("file")      as File   | null;
  const apiKey    = formData.get("apiKey")    as string | null;
  const authToken = formData.get("authToken") as string | null;
  const baseURL   = formData.get("baseURL")   as string | null;
  const model     = formData.get("model")     as string | null;

  if (!file) {
    return new Response(JSON.stringify({ error: "No file provided." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const cfg: ClientConfig = {
    apiKey:    apiKey    || process.env.API_KEY    || undefined,
    authToken: authToken || undefined,
    baseURL:   baseURL   || process.env.LLM_URL    || undefined,
    model:     model     || process.env.LLM_MODEL  || undefined,
  };

  if (!cfg.apiKey && !cfg.authToken) {
    return new Response(
      JSON.stringify({ error: "Authentication required: provide API_KEY." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  log.info("Evaluation request received", {
    filename: file.name, sizeKB: Math.round(file.size / 1024),
    hasApiKey: !!cfg.apiKey, hasAuthToken: !!cfg.authToken, baseURL: cfg.baseURL ?? "(default)",
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => controller.enqueue(sseData(data));
      const heartbeatTimer = setInterval(() => {
        try { controller.enqueue(sseHeartbeat()); } catch { clearInterval(heartbeatTimer); }
      }, 20_000);

      try {
        send({ type: "status", message: "Parsing document...", phase: "parsing" });
        log.info("Parsing document", { filename: file.name });
        const t0     = Date.now();
        const buffer = Buffer.from(await file.arrayBuffer());
        const doc    = await processDocument(buffer, file.name);
        log.info("Document parsed", { filename: doc.filename, words: doc.wordCount, ms: Date.now() - t0 });
        send({ type: "document_parsed", filename: doc.filename, wordCount: doc.wordCount, sections: Object.keys(doc.sections) });

        const alreadyPublished = isAlreadyPublished(doc.fullText);
        const activeAgents = alreadyPublished
          ? AGENTS.filter(({ id }) => id !== "publishability")
          : AGENTS;

        if (alreadyPublished) {
          log.info("Paper appears already published — skipping publishability agent");
          send({ type: "agent_skipped", id: "publishability", label: "Publishability", reason: "Paper appears to be already published." });
        }

        send({ type: "status", message: `Launching ${activeAgents.length} evaluation agents...`, phase: "agents" });
        log.info("Launching agents", { count: activeAgents.length });

        const agentResults: Record<string, AgentResult> = {};
        let completed = 0;

        await Promise.all(activeAgents.map(async ({ id, label, fn }) => {
          send({ type: "agent_start", id, label });
          log.info("Agent started", { agent: id });
          try {
            const result = await fn(doc.fullText, doc.sections, cfg);
            agentResults[id] = result;
            completed++;
            log.info("Agent finished", { agent: id, score: result.score, completed, total: activeAgents.length });
            send({ type: "agent_complete", id, label, result, completed, total: activeAgents.length });
          } catch (err) {
            completed++;
            log.error("Agent failed", { agent: id, error: String(err) });
            const errResult: AgentResult = { agent: label, aspect: label, score: 0, summary: `Agent error: ${String(err)}`, strengths: [], weaknesses: [String(err)], recommendations: [] };
            agentResults[id] = errResult;
            send({ type: "agent_complete", id, label, result: errResult, completed, total: activeAgents.length });
          }
        }));

        send({ type: "status", message: "Chief Editor computing final assessment...", phase: "scoring" });
        log.info("Chief Editor agent starting");
        const finalResult = await computeFinalScore(agentResults, { filename: doc.filename, wordCount: doc.wordCount }, cfg);
        log.info("Evaluation complete", { filename: doc.filename, overall: finalResult.overall_score, verdict: finalResult.verdict, totalMs: Date.now() - t0 });
        send({ type: "final_result", result: finalResult });

      } catch (err) {
        log.error("Evaluation pipeline error", { error: String(err) });
        send({ type: "error", message: String(err) });
      } finally {
        clearInterval(heartbeatTimer);
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache, no-transform",
      "Connection":        "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
