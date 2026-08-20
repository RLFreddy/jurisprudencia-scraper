// scrape/page — one results page of the crawl.
// Paginate (R1) → selectAll → ZIP. The base DOM is always page 1's: the
// selectAll re-renders the download panel and its response carries the fresh
// ViewState, which the ZIP payload merges in.

import type { AxiosInstance } from "axios";
import { DOWNLOAD_PDFS, OUTPUT_DIR, RESULTADO_URL, USER_AGENT, ZIP_RETRIES, ZIP_TIMEOUT_MS } from "../config";
import { withRetry } from "../lib/http";
import { extractPdfs, writeMetadata } from "../lib/output";
import { buildPaginationForm } from "../buildForms/pagination";
import { buildSelectAllForm } from "../buildForms/selectAll";
import { buildZipForm } from "../buildForms/zip";
import { extractViewState } from "../extract/viewState";
import { extractResolutions } from "../extract/resolutions";
import { StepFailure, type Resolution } from "../types";

// STEP 2 headers, in order of use: AJAX for paginate/selectAll,
// full submit (no faces-request) for the ZIP.
const AJAX_HEADERS = {
  "user-agent": USER_AGENT,
  "faces-request": "partial/ajax",
  "x-requested-with": "XMLHttpRequest",
  "content-type": "application/x-www-form-urlencoded",
};
const ZIP_HEADERS = {
  "user-agent": USER_AGENT,
  "content-type": "application/x-www-form-urlencoded",
};

export interface PaginatedPage {
  resolutions: Resolution[];
  viewState: string;
}

// DataScroller AJAX POST: the response (R1) carries the page's 10 resolutions
// and the server-rotated ViewState. 0 resolutions = unparseable response
// (WAF/error page) → StepFailure with the body for the dump.
export async function paginate(
  client: AxiosInstance,
  pageDom: string,
  page: number,
  vs: string,
): Promise<PaginatedPage> {
  const r1 = await withRetry(
    () =>
      client.post(RESULTADO_URL, buildPaginationForm(pageDom, page, vs)!, {
        headers: AJAX_HEADERS,
      }),
    `paginate p${page}`,
  );
  const resolutions = extractResolutions(r1.data);
  if (!resolutions.length) {
    throw new StepFailure(
      "paginate",
      "0 resolutions (suspicious response)",
      r1.data,
      "0_resolutions",
    );
  }
  return {
    resolutions,
    viewState: extractViewState(r1.data) ?? vs,
  };
}

// "Select all" → full "Download" submit → the page's ZIP.
// Non-ZIP response (WAF/JSF HTML) = dead session → StepFailure with body.
export async function downloadZip(
  client: AxiosInstance,
  pageDom: string,
  page: number,
): Promise<Buffer> {
  const zipFormPage = await withRetry(
    () =>
      client.post(RESULTADO_URL, buildSelectAllForm(pageDom)!, {
        headers: AJAX_HEADERS,
      }),
    `selectAll p${page}`,
  );
  const res = await withRetry(
    () =>
      client.post(RESULTADO_URL, buildZipForm(pageDom, zipFormPage.data)!, {
        headers: ZIP_HEADERS,
        responseType: "arraybuffer",
        timeout: ZIP_TIMEOUT_MS,
      }),
    `zip p${page}`,
    ZIP_RETRIES,
  );
  const ct = String(res.headers["content-type"] ?? "");
  if (!ct.includes("zip")) {
    const html = Buffer.from(res.data ?? "").toString("utf8");
    throw new StepFailure("zip", `no-ZIP response (${ct})`, html, "no_zip");
  }
  return Buffer.from(res.data);
}

// Downloads a full page: metadata.csv first (survives failures) and, per
// DOWNLOAD_PDFS, the ZIP extracted into individual PDFs.
export async function downloadPage(
  client: AxiosInstance,
  pageDom: string,
  page: number,
  viewState: string,
): Promise<{ resolutions: Resolution[]; zip: Buffer | null; viewState: string }> {
  let resolutions: Resolution[];
  let nextViewState = viewState;
  if (page === 1) {
    resolutions = extractResolutions(pageDom);
  } else {
    const r = await paginate(client, pageDom, page, viewState);
    resolutions = r.resolutions;
    nextViewState = r.viewState;
  }
  const dir = `${OUTPUT_DIR}/page-${page}`;
  writeMetadata(dir, resolutions);
  if (!DOWNLOAD_PDFS) return { resolutions, zip: null, viewState: nextViewState };
  const zip = await downloadZip(client, pageDom, page);
  extractPdfs(dir, zip, resolutions.length);
  return { resolutions, zip, viewState: nextViewState };
}