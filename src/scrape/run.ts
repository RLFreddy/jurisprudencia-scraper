// scrape/run — the full crawl with resume and session renewal.
// Orchestrates sessions and pages; each piece lives in its own module.

import type { AxiosInstance } from "axios";
import {
  MAX_ATTEMPTS,
  MAX_COOLDOWN_CYCLES,
  PAGES,
  PAGES_PER_SESSION,
  RATE_LIMIT_COOLDOWN_MS,
  REQUEST_DELAY_MS,
  ZIP_FAILURES_BEFORE_RENEW,
} from "../config";
import { errorInfo, errMessage } from "../lib/http";
import { dumpBody, record } from "../lib/errorLog";
import { info } from "../lib/log";
import { downloadPage } from "./page";
import { openSession } from "./session";
import { markDone, markFailed, nextPendingPage, pageState, summary } from "../state";
import type { SearchResult } from "../types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mb = (bytes: number) => (bytes / 1048576).toFixed(2);

const sessionOk = (s: SearchResult): boolean => s.totalPages > 0;
const sessionRotated = (cookies: string[]): boolean =>
  cookies.some((c) => c.startsWith("JSESSIONID"));

// Shared crawl state, mutated by runPage and run.
interface RunState {
  session: SearchResult;
  totalPages: number;
  consecutiveFailures: number;
}

// Opens the session and detects WAF decoy responses (200 with totalPages 0):
// retries with cooldown until MAX_COOLDOWN_CYCLES before giving up.
async function openSessionGuarded(client: AxiosInstance): Promise<SearchResult> {
  for (let cycle = 1; ; cycle++) {
    const session = await openSession(client);
    if (sessionOk(session)) return session;
    record({ level: "warn", event: "decoy_session", cycle });
    if (cycle > MAX_COOLDOWN_CYCLES) {
      throw new Error("decoy session: WAF soft-block, could not open a real session");
    }
    info(
      `[?] decoy session (${cycle}/${MAX_COOLDOWN_CYCLES}) — cooling ${Math.round(RATE_LIMIT_COOLDOWN_MS / 1000)}s...`,
    );
    await sleep(RATE_LIMIT_COOLDOWN_MS);
  }
}

// Renews the session: cooldown first (cools down the WAF block), then a
// fresh search. Returns the previous session if renewal fails or gives decoy.
async function renewSession(
  client: AxiosInstance,
  current: SearchResult,
  page: number,
  totalPages: number,
): Promise<SearchResult> {
  if (RATE_LIMIT_COOLDOWN_MS > 0) {
    info(
      `[${page}/${totalPages}] cooling ${Math.round(RATE_LIMIT_COOLDOWN_MS / 1000)}s before renewal...`,
    );
    await sleep(RATE_LIMIT_COOLDOWN_MS);
  }
  try {
    const fresh = await openSession(client);
    if (!sessionOk(fresh)) throw new Error("decoy session");
    return fresh;
  } catch (renewErr) {
    record({ level: "error", event: "renewal_failed", page, reason: errMessage(renewErr) });
    info(`[${page}/${totalPages}] renewal failed — keeping current session`);
    return current;
  }
}

// Attempts a page (up to MAX_ATTEMPTS): download → success or failure, plus
// possible session renewal. Returns the outcome and the one-line log note.
async function runPage(
  client: AxiosInstance,
  st: RunState,
  page: number,
): Promise<{ ok: boolean; note: string }> {
  let successNote = "";
  const fails: string[] = [];

  while (pageState(page).attempts < MAX_ATTEMPTS && !successNote) {
    try {
      const { resolutions, zip, viewState } = await downloadPage(
        client,
        st.session.pageDom,
        page,
        st.session.viewState,
      );
      st.session.viewState = viewState;
      markDone(page);
      st.consecutiveFailures = 0;
      successNote = zip
        ? `✓ ${resolutions.length} res · ${mb(zip.length)} MB`
        : `✓ ${resolutions.length} res`;
    } catch (err) {
      const detail = errorInfo(err);
      const dump = dumpBody(detail.body, `${detail.step ?? "page"} p${page}`, detail.contentType);
      record({
        level: "error",
        event: "page_failed",
        page,
        step: detail.step,
        status: detail.status,
        statusText: detail.statusText,
        attempts: pageState(page).attempts + 1,
        set_cookie: detail.setCookie.length,
        set_cookie_values: detail.setCookie.map((c) => c.slice(0, 80)),
        content_type: detail.contentType,
        server: detail.server,
        reason: detail.reason,
        dump,
      });
      markFailed(page);
      fails.push(detail.step ?? errMessage(err));
      st.consecutiveFailures++;

      // Death signal: the server rotated JSESSIONID → the session is gone.
      // Renew now (with cooldown) instead of retrying on a dead session.
      if (sessionRotated(detail.setCookie) || st.consecutiveFailures >= ZIP_FAILURES_BEFORE_RENEW) {
        st.consecutiveFailures = 0;
        const fresh = await renewSession(client, st.session, page, st.totalPages);
        st.session = fresh;
        st.totalPages = fresh.totalPages;
      }
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const head = fails.length ? `✗ ${[...new Set(fails)].join(", ")} → ` : "";
  return { ok: Boolean(successNote), note: successNote ? `${head}${successNote}` : `${head}abandoned` };
}

export async function run(client: AxiosInstance): Promise<void> {
  const initial = await openSessionGuarded(client);
  const st: RunState = {
    session: initial,
    totalPages: initial.totalPages,
    consecutiveFailures: 0,
  };

  let page = nextPendingPage();
  const lastPage = PAGES > 0 ? Math.min(st.totalPages, page + PAGES - 1) : st.totalPages;
  let ok = 0;
  let pagesInSession = 0;

  info(
    `\nTotal pages: ${st.totalPages}${PAGES > 0 ? ` (running pages ${page}-${lastPage})` : ""}`,
  );

  while (page <= lastPage) {
    const state = pageState(page);
    if (state.status === "done") {
      info(`[${page}/${st.totalPages}] ✓ resume`);
      page++;
      continue;
    }
    if (state.attempts >= MAX_ATTEMPTS) {
      info(`[${page}/${st.totalPages}] ✗ abandoned (${MAX_ATTEMPTS} attempts)`);
      page++;
      continue;
    }

    // Proactive rotation: renew before the WAF evicts the session.
    if (PAGES_PER_SESSION > 0 && pagesInSession >= PAGES_PER_SESSION) {
      pagesInSession = 0;
      const fresh = await renewSession(client, st.session, page, st.totalPages);
      if (fresh !== st.session) {
        st.session = fresh;
        st.totalPages = fresh.totalPages;
        info(`[${page}/${st.totalPages}] rotating session (${PAGES_PER_SESSION} pages)`);
      }
    }

    const result = await runPage(client, st, page);
    if (result.ok) {
      ok++;
      pagesInSession++;
    }
    info(`[${page}/${st.totalPages}] ${result.note}`);
    page++;
  }

  const stats = summary();
  const failed = stats.find((s) => s.status === "failed")?.n ?? 0;
  const done = stats.find((s) => s.status === "done")?.n ?? 0;
  info(`\nDone: ${ok} pages this run — ${done} done, ${failed} failed (see errors/events.jsonl)`);
}