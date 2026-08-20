// buildForms/common — shared helpers for the payload builders.

import type { Cheerio, CheerioAPI } from "cheerio";
import { debug } from "../lib/log";

// Manual URL-encoding: AJAX requests encode spaces as %20
// (URLSearchParams would use +, and the golden wouldn't match).
export function encodePairs(pairs: Array<[string, string]>): string {
  return pairs
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");
}

// Pairs of a mojarra.jsfcljs map (quotes are escaped as \').
export function jsfcljsPairs(map: string): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  const unescaped = map.replace(/\\'/g, "'");
  const pairRe = /'([^']+)'\s*:\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(unescaped))) pairs.push([m[1], m[2]]);
  return pairs;
}

// Payload banner in the log (only with VERBOSE=1).
export function logPayload(name: string, pairs: Array<[string, string]>): void {
  const sep = "=".repeat(50);
  debug(`\n${sep}\n  ${name}\n${sep}`);
  for (const [key, value] of pairs) debug(`  ${key} = ${value}`);
}

// Options for the form serializer.
export interface CollectOptions {
  skip?: (el: Cheerio<any>) => boolean; // exclude an element
  force?: (el: Cheerio<any>) => boolean; // checkbox forced to "on"
}

// Serializes the form fields in document order: each input/select's "name"
// with its effective value (checkbox/radio only when checked).
export function collectFormFields(
  $: CheerioAPI,
  form: Cheerio<any>,
  opts: CollectOptions = {},
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  form.find("input, select").each((_, el) => {
    const input = $(el);
    const name = input.attr("name");
    if (!name || input.is("[disabled]") || opts.skip?.(input)) return;

    const type = (input.attr("type") ?? "text").toLowerCase();
    if (type === "image" || type === "submit" || type === "button") return;

    if (type === "checkbox" || type === "radio") {
      if (opts.force?.(input) || input.is("[checked]")) pairs.push([name, "on"]);
      return;
    }
    if (input.is("select")) {
      pairs.push([
        name,
        input.find("option[selected]").first().attr("value") ?? "",
      ]);
      return;
    }
    pairs.push([name, input.attr("value") ?? ""]);
  });
  return pairs;
}