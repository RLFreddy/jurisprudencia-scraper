// buildForms/zip — payload of the "Download" button (ZIP, full submit).
// Merges the full page with the partial-response updates (the browser's DOM
// at click time) and appends the trigger's jsfcljs map.

import * as cheerio from "cheerio";
import { collectFormFields, encodePairs, jsfcljsPairs, logPayload } from "./common";

// <update id="..."><![CDATA[content]]></update> blocks of a RichFaces
// partial-response: the regions the browser re-renders.
function parseUpdates(ajaxXml: string): Array<{ id: string; html: string }> {
  const updates: Array<{ id: string; html: string }> = [];
  const re = /<update\s+id="([^"]*)"\s*>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/update\s*>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ajaxXml))) updates.push({ id: m[1], html: m[2] });
  return updates;
}

export function buildZipForm(
  fullPageXml: string,
  ajaxXml: string,
): string | null {
  const $ = cheerio.load(fullPageXml);
  const form = $('form[id="formBuscador"]');
  if (!form.length) return null;

  // 1. Apply the partial-response updates to the full page.
  for (const update of parseUpdates(ajaxXml)) {
    const target = $(`[id="${update.id}"]`);
    if (!target.length) continue;
    if (update.id === "javax.faces.ViewState") {
      target.attr("value", update.html);
    } else {
      target.replaceWith(update.html);
    }
  }

  // 2. The ZIP trigger: the first anchor whose img src matches zip_file*.
  const trigger = form.find('a:has(img[src*="zip_file.png"])').first();
  if (!trigger.length) return null;

  // The trigger's tooltip only appears on hover and the browser never sends it.
  const tooltipBox = trigger
    .next('div[style*="none"]')
    .find('input[type="checkbox"]')
    .first();

  const pairs = collectFormFields($, form, {
    skip: (el) => el[0] === tooltipBox[0],
  });

  // 3. The trigger's jsfcljs map, appended in map order.
  const onclick = trigger.attr("onclick") ?? "";
  const map = onclick.match(/mojarra\.jsfcljs\([^,]*,\s*\{([^}]*)\}/);
  if (map) pairs.push(...jsfcljsPairs(map[1]));

  logPayload("buildZipForm", pairs);
  return encodePairs(pairs);
}