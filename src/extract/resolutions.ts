// resolutions — a page's 10 resolutions, from the JSON embedded in the
// "View" button onclick (anchor formBuscador:repeat:N:j_idt491).

import type { Resolution } from "../types";

// Embedded JSON keys → CSV columns (the portal's Spanish field names).
const FIELD_MAP: Record<string, keyof Resolution> = {
  recurso: "recurso",
  nroexp: "nroExpediente",
  pretensiones: "pretension",
  tipoResolucion: "tipoResolucion",
  fechaResolucion: "fechaResolucion",
  sala: "sala",
  normaDI: "normaDI",
  sumilla: "sumilla",
  palabras: "palabrasClave",
  uuid: "uuid",
};

// Unescapes one layer of JS string (\" → ", \\u002D → -); what's left are
// standard JSON escapes that JSON.parse resolves.
function unescapeJs(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (m, esc: string) =>
    esc[0] === "u" ? String.fromCharCode(parseInt(esc.slice(1), 16)) : esc,
  );
}

// The JSON travels with three escape layers: HTML entities (&quot;), JS
// strings (\" → ") and JSON escapes with double backslash (\\u002D → -).
// AJAX responses (R1) additionally escape double quotes (\&quot;); it's
// normalized to the full-page format before parsing.
export function extractResolutions(xml: string): Resolution[] {
  const rows: Resolution[] = [];
  const rowRe =
    /<a\b([^>]*id="formBuscador:repeat:\d+:j_idt491"[^>]*)>[\s\S]*?href="([^"]*ServletDescarga\?uuid=[^"]+)"/g;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(xml))) {
    const onclick = m[1].replace(/\\&quot;/g, "&quot;");
    const params = onclick.match(
      /&quot;parameters&quot;:\{(.*?)\} ,&quot;incId&quot;/,
    );
    if (!params) continue;
    const obj = JSON.parse(
      `{${unescapeJs(params[1].replace(/&quot;/g, '"'))}}`,
    ) as Record<string, string>;

    const row = {} as Resolution;
    for (const [key, value] of Object.entries(FIELD_MAP)) {
      row[value] = obj[key] ?? "";
    }
    row.urlDescarga = m[2];
    rows.push(row);
  }
  return rows;
}