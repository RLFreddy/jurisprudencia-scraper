// lib/errorLog — error tracking in two places:
// 1) errors/events.jsonl: one JSON event per line (append, never overwritten).
// 2) errors/dumps/<day>/<time>-<step>.xml: the raw body of each failed response.

import fs from "node:fs";
import { ERROR_DIR, ERROR_LOG_PATH } from "../config";

export interface ErrorEvent {
  level: "warn" | "error";
  event: string;
  page?: number;
  step?: string;
  status?: number | string;
  statusText?: string;
  attempt?: number;
  attempts?: number;
  cycle?: number;
  duration_ms?: number;
  set_cookie?: number;
  set_cookie_values?: string[];
  content_type?: string;
  server?: string;
  reason?: string;
  dump?: string | null;
}

const iso = () => new Date().toISOString();

// Appends one JSON line per event; logging must never break the crawl.
export function record(ev: ErrorEvent): void {
  try {
    fs.mkdirSync(ERROR_LOG_PATH.slice(0, ERROR_LOG_PATH.lastIndexOf("/")), {
      recursive: true,
    });
    fs.appendFileSync(ERROR_LOG_PATH, JSON.stringify({ ts: iso(), ...ev }) + "\n");
  } catch {
    // logging must never break the crawl
  }
}

// Saves the raw body under ERROR_DIR/<day>/<time>-<label>.<ext> (only if body).
// Extension by content-type: .html for WAF/JSF pages, .xml otherwise.
export function dumpBody(
  body: string,
  label: string,
  contentType = "",
): string | null {
  if (!body) return null;
  try {
    const day = iso().slice(0, 10);
    const dir = `${ERROR_DIR}/${day}`;
    fs.mkdirSync(dir, { recursive: true });
    const ext = contentType.includes("html") ? "html" : "xml";
    const file = `${dir}/${iso().slice(11, 19).replace(/:/g, "-")}-${label.replace(/\s+/g, "-")}.${ext}`;
    fs.writeFileSync(file, body);
    return file;
  } catch {
    return null;
  }
}