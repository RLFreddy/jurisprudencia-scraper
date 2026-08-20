// buildForms/search — payload of the "Search" button (full form submit).
// Serializes the formBuscador fields in document order and appends the
// trigger's jsfcljs map. Pages are well-formed XHTML: regex is fine.

import { jsfcljsPairs, logPayload } from "./common";

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) attrs[m[1]] = m[2];
  return attrs;
}

// The formBuscador region (the full page when the form is missing).
function findFormRegion(xml: string): string {
  const start = xml.search(/<form\b[^>]*id="formBuscador"[^>]*>/);
  const end = start >= 0 ? xml.indexOf("</form>", start) : -1;
  return start >= 0 && end > start ? xml.slice(start, end) : xml;
}

// The Search button is the input image whose src matches btn-buscar*.
function findSearchTrigger(form: string): string | null {
  const imgRe = /<input\b[^>]*type="image"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(form))) {
    const a = parseAttrs(m[0]);
    if (a.src?.includes("btn-buscar") && a.name) return a.name;
  }
  return null;
}

export function buildSearchForm(xml: string): string {
  const form = findFormRegion(xml);
  const pairs: Array<[string, string]> = [];

  // 1. form fields in document order
  const fieldRe =
    /<input\b[^>]*>|<select\b[\s\S]*?<\/select>|<textarea\b[\s\S]*?<\/textarea>/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(form))) {
    const tag = m[0];
    const attrs = parseAttrs(tag);
    if (!attrs.name || "disabled" in attrs) continue;

    if (tag.startsWith("<select")) {
      const options = tag.match(/<option\b[^>]*>/g) ?? [];
      let value = "";
      for (const opt of options) {
        const a = parseAttrs(opt);
        if ("selected" in a) {
          value = a.value ?? "";
          break;
        }
      }
      pairs.push([attrs.name, value]);
      continue;
    }

    if (tag.startsWith("<textarea")) {
      const text = tag
        .replace(/^<textarea\b[\s\S]*?>/, "")
        .replace(/<\/textarea>.*$/, "");
      pairs.push([attrs.name, text]);
      continue;
    }

    const type = (attrs.type ?? "text").toLowerCase();
    if (type === "checkbox" || type === "radio") {
      if ("checked" in attrs) pairs.push([attrs.name, attrs.value ?? "on"]);
      continue;
    }
    if (type === "image" || type === "submit" || type === "button") continue;
    // Watermarks: when the field is empty, the value falls back to the title.
    pairs.push([attrs.name, attrs.value || attrs.title || ""]);
  }

  // 2. Search trigger's jsfcljs map, appended in map order
  const trigger = findSearchTrigger(form);
  if (trigger) {
    const callRe = /mojarra\.jsfcljs\([^,]*,\s*\{([^}]*)\}/g;
    let call: RegExpExecArray | null;
    while ((call = callRe.exec(form))) {
      if (!call[1].replace(/\\'/g, "'").startsWith(`'${trigger}'`)) continue;
      pairs.push(...jsfcljsPairs(call[1]));
    }
  }

  logPayload("buildSearchForm", pairs);
  // Full submit: the browser encodes spaces as + (URLSearchParams).
  return new URLSearchParams(pairs).toString();
}