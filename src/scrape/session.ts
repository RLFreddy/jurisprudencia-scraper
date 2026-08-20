// scrape/session — STEP 1: opens the session (GET inicio → POST Buscar) with
// result page 1, the total page count and the initial ViewState.

import type { AxiosInstance } from "axios";
import { INICIO_URL, USER_AGENT } from "../config";
import { withRetry } from "../lib/http";
import { buildSearchForm } from "../buildForms/search";
import { totalPages } from "../buildForms/pagination";
import { extractPageViewState } from "../extract/viewState";
import type { SearchResult } from "../types";

// STEP 1 headers, in order of use.
const GET_HEADERS = { "user-agent": USER_AGENT };
const POST_HEADERS = {
  "user-agent": USER_AGENT,
  "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
};

export async function openSession(client: AxiosInstance): Promise<SearchResult> {
  // 1. GET inicio → page with the formBuscador form.
  const initialPage = await client.get(INICIO_URL, { headers: GET_HEADERS });

  // 2. POST Buscar → 302 → GET resultado.xhtml (http→https forced: port 80
  //    is blocked). The jar accumulates ViewState + JSESSIONID.
  const searchResultPage = await withRetry(
    () =>
      client.post(INICIO_URL, buildSearchForm(initialPage.data), {
        headers: POST_HEADERS,
        beforeRedirect: (options) => {
          if (options.protocol === "http:") {
            options.protocol = "https:";
            options.port = 443;
          }
        },
      }),
    "search",
  );

  return {
    pageDom: searchResultPage.data,
    totalPages: totalPages(searchResultPage.data),
    viewState: extractPageViewState(searchResultPage.data) ?? "",
  };
}