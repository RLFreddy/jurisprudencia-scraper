// lib/http — transport: axios client with cookie jar + WAF cookies,
// backoff retries and error descriptions. The only layer that knows axios.

import axios from "axios";
import type { AxiosInstance } from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import {
  COOKIE_OVERRIDE,
  INICIO_URL,
  RETRIES,
  RETRY_BASE_DELAY_MS,
} from "../config";
import { StepFailure } from "../types";
import { dumpBody, record } from "./errorLog";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Seeds the browser's WAF cookies (COOKIE_OVERRIDE from .env) into the jar;
// without them the WAF may reject the session. The server assigns
// JSESSIONID, so it's skipped.
function seedWafCookies(jar: CookieJar): void {
  if (!COOKIE_OVERRIDE) return;
  let n = 0;
  for (const part of COOKIE_OVERRIDE.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === "JSESSIONID") continue;
    jar.setCookieSync(`${name}=${part.slice(eq + 1).trim()}`, INICIO_URL);
    n++;
  }
  if (n > 0) console.log(`WAF cookies seeded: ${n}`);
}

// HTTP client with cookie jar (portal session) + WAF cookies.
export function createClient(): AxiosInstance {
  const jar = new CookieJar();
  seedWafCookies(jar);
  return wrapper(axios.create({ jar, withCredentials: true } as any));
}

// Structured error detail: status, headers and response body.
export interface ErrorInfo {
  step?: string;
  status?: number | string;
  statusText?: string;
  body: string;
  contentType?: string;
  setCookie: string[];
  server?: string;
  reason?: string;
}

export function errorInfo(err: unknown): ErrorInfo {
  if (axios.isAxiosError(err) && err.response) {
    const { status, statusText, data, headers } = err.response;
    return {
      status,
      statusText,
      body: typeof data === "string" ? data : "",
      contentType: String(headers["content-type"] ?? ""),
      setCookie: (headers["set-cookie"] as string[] | undefined) ?? [],
      server: String(headers["server"] ?? ""),
    };
  }
  if (err instanceof StepFailure) {
    return { step: err.step, body: err.body, reason: err.reason, setCookie: [] };
  }
  return { body: "", setCookie: [] };
}

// Retries with exponential backoff on 429/5xx/network errors. Every failed
// attempt is only logged to errors/events.jsonl (warn) with the body dumped
// to errors/ — the console stays clean (one line per page in run.ts).
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  retries = RETRIES,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const start = Date.now();
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const info = errorInfo(err);
      const dump = dumpBody(info.body, label, info.contentType);
      record({
        level: "warn",
        event: "retry",
        step: label,
        attempt,
        status: info.status,
        statusText: info.statusText,
        duration_ms: Date.now() - start,
        set_cookie: info.setCookie.length,
        set_cookie_values: info.setCookie.map((c) => c.slice(0, 80)),
        content_type: info.contentType,
        server: info.server,
        dump,
      });
      if (attempt > retries) break;
      const retryAfter = axios.isAxiosError(lastErr) && lastErr.response
        ? Number(lastErr.response.headers["retry-after"])
        : NaN;
      const delay = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// Human-readable error message: status + first chars of the body.
export function errMessage(err: unknown): string {
  if (axios.isAxiosError(err) && err.response) {
    const { status, data } = err.response;
    const body = String(data).slice(0, 120).replace(/\s+/g, " ");
    return `HTTP ${status}: ${body || "(empty body)"}`;
  }
  return (err as Error).message;
}