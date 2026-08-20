import "dotenv/config";

const num = (v: string | undefined, def: number) => (v === undefined ? def : Number(v));

export const PAGES = num(process.env.PAGES, 0); // 0 = auto-detect total pages via pagination
export const USER_AGENT = process.env.USER_AGENT ?? "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
export const VERBOSE = process.env.VERBOSE === "1"; // verbose logs (payloads) on/off
export const RETRIES = num(process.env.RETRIES, 4); // max retries (429/5xx/network). 0 = no retry
export const RETRY_BASE_DELAY_MS = num(process.env.RETRY_BASE_DELAY_MS, 1000); // backoff: delay * 2^(attempt-1)
export const REQUEST_DELAY_MS = num(process.env.REQUEST_DELAY_MS, 1500); // pause between pages (anti rate-limit)
export const ZIP_TIMEOUT_MS = num(process.env.ZIP_TIMEOUT_MS, 45_000); // ZIP POST timeout
export const RATE_LIMIT_COOLDOWN_MS = num(process.env.RATE_LIMIT_COOLDOWN_MS, 60_000); // initial wait after 429 (scales x2)
export const MAX_COOLDOWN_CYCLES = num(process.env.MAX_COOLDOWN_CYCLES, 3); // max cooldown cycles before failing the page
export const DB_PATH = process.env.DB_PATH ?? "scraper.db"; // SQLite state (WAL)
export const OUTPUT_DIR = process.env.OUTPUT_DIR ?? "files"; // output: files/page-N/
export const COOKIE_OVERRIDE = process.env.COOKIE_OVERRIDE ?? ""; // browser cookies for the WAF: __uzm*, uzmxj, etc.
export const ERROR_LOG_PATH = process.env.ERROR_LOG_PATH ?? "errors/events.jsonl"; // event log (JSON lines, append)
export const ERROR_DIR = process.env.ERROR_DIR ?? "errors/dumps"; // dumps of each failed response body
export const ZIP_FAILURES_BEFORE_RENEW = num(process.env.ZIP_FAILURES_BEFORE_RENEW, 2); // consecutive failures before renewing the session
export const MAX_ATTEMPTS = num(process.env.MAX_ATTEMPTS, 5); // max attempts per page before abandoning it
export const PAGES_PER_SESSION = num(process.env.PAGES_PER_SESSION, 8); // proactive rotation: renew before the WAF kills the session
export const ZIP_RETRIES = num(process.env.ZIP_RETRIES, 2); // ZIP POST retries (less pressure on the WAF)
export const DOWNLOAD_PDFS = process.env.DOWNLOAD_PDFS !== "0"; // 0 = metadata.csv only; 1 = metadata + ZIP + PDFs

// Portal pages (site constants, not configurable).
export const INICIO_URL =
  "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/inicio.xhtml";
export const RESULTADO_URL =
  "https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml";