import { NextRequest } from "next/server";
import { buildClient, ClientConfig } from "@/lib/agents";
import { log } from "@/lib/logger";

export const runtime    = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const body      = await req.json();
  const question  = body.question  as string;
  const context   = body.context   as string;
  const apiKey    = body.apiKey    as string | undefined;
  const authToken = body.authToken as string | undefined;
  const baseURL   = body.baseURL   as string | undefined;
  const model     = body.model     as string | undefined;

  const cfg: ClientConfig = {
    apiKey:    apiKey    || process.env.API_KEY   || undefined,
    authToken: authToken || undefined,
    baseURL:   baseURL   || process.env.LLM_URL   || undefined,
    model:     model     || process.env.LLM_MODEL || undefined,
  };

  if (!cfg.apiKey && !cfg.authToken) {
    return new Response(JSON.stringify({ error: "Authentication required." }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  log.info("Follow-up question received", { questionLen: question.length });

  let client;
  try { client = buildClient(cfg); }
  catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const stream = await client.chat.completions.create({
    model: cfg.model ?? "gpt-4o",
    max_completion_tokens: 1500,
    stream: true,
    messages: [
      {
        role: "system",
        content: `You are a senior academic reviewer who has just completed a full peer review of a
research paper. Answer the user's follow-up question using only the evaluation context provided.
Be concise, specific, and helpful. Use markdown for formatting where helpful.`,
      },
      { role: "user", content: `Evaluation context:\n${context}\n\nQuestion: ${question}` },
    ],
  });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? "";
        if (text) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
        }
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
      log.info("Follow-up answered");
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" },
  });
}
