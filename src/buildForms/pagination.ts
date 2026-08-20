// buildForms/pagination — payload of the DataScroller click (AJAX).
// Only ONE parameter changes: formBuscador:data1:page = N; the rest travel
// with the stale DOM value and the server ignores them.

import * as cheerio from "cheerio";
import { collectFormFields, encodePairs, logPayload } from "./common";

export function buildPaginationForm(
  xml: string,
  page: number,
  vs?: string,
): string | null {
  const $ = cheerio.load(xml);
  const form = $('form[id="formBuscador"]');
  if (!form.length) return null;

  // Form fields in document order.
  const pairs = collectFormFields($, form);

  // If the session already rotated, replace the form's ViewState.
  if (vs) {
    const i = pairs.findIndex(([n]) => n === "javax.faces.ViewState");
    if (i >= 0) pairs[i] = ["javax.faces.ViewState", vs];
    else pairs.unshift(["javax.faces.ViewState", vs]);
  }

  // DataScroller AJAX params, in the browser's exact order.
  pairs.push(
    ["javax.faces.source", "formBuscador:data1"],
    ["javax.faces.partial.event", "rich:datascroller:onscroll"],
    ["javax.faces.partial.execute", "formBuscador:data1 @component"],
    ["javax.faces.partial.render", "@component"],
    ["formBuscador:data1:page", String(page)],
    ["org.richfaces.ajax.component", "formBuscador:data1"],
    ["formBuscador:data1", "formBuscador:data1"],
    ["AJAX:EVENTS_COUNT", "1"],
    ["javax.faces.partial.ajax", "true"],
  );

  logPayload(`buildPaginationForm → page ${page}`, pairs);
  return encodePairs(pairs);
}

// totalPages — the InputNumberSpinner's maxValue, tolerating the server's
// two formats: single quotes (AJAX) and pretty-printed double quotes (GET).
export function totalPages(xml: string): number {
  const m = xml.match(
    /InputNumberSpinner\s*\(\s*['"]formBuscador:spinner['"][\s\S]*?maxValue:\s*(\d+)/,
  );
  return m ? Number(m[1]) : 0;
}