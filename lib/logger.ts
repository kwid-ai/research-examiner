/**
 * Minimal structured server-side logger.
 * All output goes to stdout/stderr — visible in `npm run dev`,
 * Vercel function logs, and Render service logs.
 */

type Meta = Record<string, unknown>;

function ts(): string {
  return new Date().toISOString();
}

function fmt(level: string, msg: string, meta?: Meta): string {
  const base = `[${level}] ${ts()} — ${msg}`;
  return meta && Object.keys(meta).length > 0
    ? `${base} ${JSON.stringify(meta)}`
    : base;
}

export const log = {
  info(msg: string, meta?: Meta)  { console.log(fmt("INFO ", msg, meta)); },
  warn(msg: string, meta?: Meta)  { console.warn(fmt("WARN ", msg, meta)); },
  error(msg: string, meta?: Meta) { console.error(fmt("ERROR", msg, meta)); },
  debug(msg: string, meta?: Meta) {
    if (process.env.LOG_LEVEL === "debug") {
      console.debug(fmt("DEBUG", msg, meta));
    }
  },
};
