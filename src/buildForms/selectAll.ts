// buildForms/selectAll — payload of the "Select All" click (AJAX).
// Serializes the form, forces the clicked checkbox to on and appends the
// click's 8 RichFaces parameters.

import * as cheerio from "cheerio";
import { collectFormFields, encodePairs, logPayload } from "./common";

// Value of a key:value pair inside the onclick, e.g.
// 'org.richfaces.ajax.component': 'formBuscador:j_idt419'.
function jsValue(js: string, key: string): string | null {
  const re = new RegExp(`['"]?${key}['"]?\\s*:\\s*['"]([^'"]+)`);
  return js.match(re)?.[1] ?? null;
}

export function buildSelectAllForm(xml: string): string | null {
  const $ = cheerio.load(xml);
  const form = $('form[id="formBuscador"]');
  if (!form.length) return null;

  // The clicked checkbox: the first "Select All", identified by its sibling
  // tooltip (div display:none) that mentions "paginación actual" — the
  // portal's own Spanish text, kept verbatim for the match.
  const selectAll = form
    .find('input[type="checkbox"]')
    .filter((_, el) =>
      $(el)
        .next('div[style*="none"]')
        .text()
        .replace(/\s+/g, " ")
        .includes("paginación actual"),
    )
    .first();
  if (!selectAll.length) return null;
  const id = selectAll.attr("name")!;
  const onclick = selectAll.attr("onclick") ?? "";

  const pairs = collectFormFields($, form, {
    force: (el) => el[0] === selectAll[0],
  });

  // The click's 8 RichFaces AJAX parameters.
  const behavior = jsValue(onclick, "javax.faces.behavior.event") ?? "click";
  const component = jsValue(onclick, "org.richfaces.ajax.component") ?? id;
  pairs.push(
    ["javax.faces.source", id],
    ["javax.faces.partial.event", "click"],
    ["javax.faces.partial.execute", `${id} @component`],
    ["javax.faces.partial.render", "@component"],
    ["javax.faces.behavior.event", behavior],
    ["org.richfaces.ajax.component", component],
    ["AJAX:EVENTS_COUNT", "1"],
    ["javax.faces.partial.ajax", "true"],
  );

  logPayload("buildSelectAllForm", pairs);
  return encodePairs(pairs);
}