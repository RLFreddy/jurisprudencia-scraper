// state — persistent crawl state (SQLite, resume): every page with its
// status (done/failed/pending) and attempt counter.

import fs from "node:fs";
import path from "node:path";
import Sqlite from "better-sqlite3";
import { DB_PATH, MAX_ATTEMPTS } from "./config";

// Better-sqlite3 refuses to open a DB whose directory doesn't exist —
// create it first (e.g. data/ on the host, /app/data is pre-created in Docker).
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Sqlite(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec(`CREATE TABLE IF NOT EXISTS pages(
  page INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0
)`);

export const markDone = (page: number) =>
  db
    .prepare(
      "INSERT INTO pages(page,status,attempts) VALUES(?, 'done', 0) ON CONFLICT(page) DO UPDATE SET status='done'",
    )
    .run(page);

export const markFailed = (page: number) =>
  db
    .prepare(
      "INSERT INTO pages(page,status,attempts) VALUES(?, 'failed', 1) ON CONFLICT(page) DO UPDATE SET status='failed', attempts=attempts+1",
    )
    .run(page);

export interface PageState {
  status: string;
  attempts: number;
}

// A page's state in a single query (status + attempts).
export const pageState = (page: number): PageState =>
  (db.prepare("SELECT status, attempts FROM pages WHERE page=?").get(page) as
    | PageState
    | undefined) ?? { status: "pending", attempts: 0 };

// The first unfinished page — the resume point. Abandoned pages (attempts
// exhausted) are skipped; if no pending page is recorded, continue after the
// last existing page.
export const nextPendingPage = (): number => {
  const firstPending = db
    .prepare(
      "SELECT page FROM pages WHERE status != 'done' AND attempts < ? ORDER BY page LIMIT 1",
    )
    .get(MAX_ATTEMPTS) as { page: number } | undefined;
  if (firstPending) return firstPending.page;
  const max = db
    .prepare("SELECT COALESCE(MAX(page), 0) AS m FROM pages")
    .get() as { m: number };
  return max.m + 1;
};

// Counts by status for the final report.
export const summary = () =>
  db
    .prepare("SELECT status, COUNT(*) AS n FROM pages GROUP BY status")
    .all() as { status: string; n: number }[];