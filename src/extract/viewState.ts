// viewState — the JSF ViewState token: full page (HTML) or AJAX (RichFaces).

// Full page: the input is pretty-printed across lines → \s+.
export function extractPageViewState(xml: string): string | undefined {
  return xml.match(/id="javax\.faces\.ViewState"\s+value="([^"]+)"/)?.[1];
}

// AJAX partial-response: <update id="javax.faces.ViewState"><![CDATA[...]]>
// \s* tolerates both the compact and pretty-printed formats.
export function extractViewState(xml: string): string | undefined {
  return xml.match(
    /<update id="javax\.faces\.ViewState"\s*>\s*<!\[CDATA\[([^\]]+)\]\]><\/update\s*>/,
  )?.[1];
}