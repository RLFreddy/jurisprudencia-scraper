# Reverse Engineering — PJ Jurisprudence Portal

How the portal works under the hood and what the scraper replicates, request
by request. Every step shows the exact payload and what the server returns.

---

## Portal technologies

| Technology | Role |
|---|---|
| **Java Server Faces (JSF) 2.x** | MVC framework |
| **RichFaces 4.x** | AJAX components (DataScroller) |
| **Mojarra** | Oracle's JSF implementation |
| **JBoss/Glassfish** | Application server |

All behavior is standard framework behavior — no application-level obfuscation
or anti-bot (the real anti-bot is a ShieldSquare WAF at the edge, see
"Resilience design" in the main README).

## The centerpiece: the ViewState

JSF keeps view state server-side with an opaque token in a
`<input type="hidden">` of every form. **Every POST must return it**, or the
server answers `ViewExpiredException` (500):

```
-8014842261326758199:5097596337755344635
```

That's the standard server-side state-saving format in JSF 2 (two numbers
separated by `:`: view id + security token). Key discovery: **pagination does
NOT change the ViewState** — every page uses the same token.

---

## Full flow (with PDFs, `DOWNLOAD_PDFS=1`)

### 1. GET /inicio.xhtml — fetches the form

- **Response**: HTML with `formBuscador` → the search fields, the hidden
  ViewState 1 (`javax.faces.ViewState`) and the "Buscar" button, an
  `<input type="image">` with `onclick="mojarra.jsfcljs(...)"`.
- The button's `jsfcljs` map carries the submit's extra parameters:

```
'formBuscador:j_idt31':'formBuscador:j_idt31',
'forward':'buscar',
'busqueda':'especializada',
'formBuscador:j_idt34':'21',
'formBuscador:j_idt35':'DESC',
'formBuscador:j_idt36':'Principal',
'formBuscador:j_idt37':'1'
```

`mojarra.jsfcljs()` is Mojarra's standard submit-with-extra-parameters
function — the scraper replicates its map manually.

### 2. POST /inicio.xhtml (Buscar) — the form is submitted

- **Payload**: form fields in document order + the trigger's jsfcljs map,
  `application/x-www-form-urlencoded`.
- **Response**: **302** with `Location: http://.../resultado.xhtml`.

### 3. GET /resultado.xhtml — the redirect brings page 1 loaded

- The 302 points to **http** (port 80 is blocked externally). The scraper
  forces **https** while following the redirect (`beforeRedirect` in axios).
- **Response** (page 1 arrives here):
  - 10 resolutions: each row has a "Ver" anchor
    (`formBuscador:repeat:N:j_idt491`) whose `onclick` embeds a **JSON** with
    the resolution's 11 fields (recurso, expediente, pretension, tipo, fecha,
    sala, norma, sumilla, palabras clave, uuid, download url).
  - **ViewState 2** (pretty-printed `<input>`) — reused for the whole session.
  - `formBuscador:spinner` (InputNumberSpinner) with `maxValue` = **total
    pages** (detected live, ~21,000).

### 4. AJAX POST paginate — pages 2 onward (1 request)

- **Headers**: `faces-request: partial/ajax` + `x-requested-with: XMLHttpRequest`.
- **Payload**: form fields (in document order, with the ViewState) + the
  RichFaces DataScroller parameters:

```
javax.faces.source=formBuscador:data1
javax.faces.partial.event=rich:datascroller:onscroll
javax.faces.partial.execute=formBuscador:data1 @component
javax.faces.partial.render=@component
formBuscador:data1:page=N
org.richfaces.ajax.component=formBuscador:data1
formBuscador:data1=formBuscador:data1
AJAX:EVENTS_COUNT=1
javax.faces.partial.ajax=true
formBuscador:spinner=N-1
formBuscador:spinner2=N-1
```

- **Response**: XML `<partial-response>` with an `<update>` whose CDATA carries
  the table HTML with the 10 resolutions → the embedded JSON is extracted from
  each row → `metadata.csv`. The response's ViewState is kept if it rotates.
- **Suspicious-page signal**: 0 extracted resolutions = WAF response or error
  → treated as a failure (body dumped to `data/errors/dumps/`).

### 5. AJAX POST selectAll — marks the 10 rows (1 request)

- **Payload**: serialized form + the "Select All" checkbox **forced to `on`** +
  the click's 8 RichFaces parameters:

```
javax.faces.source=formBuscador:j_idt419
javax.faces.partial.event=click
javax.faces.partial.execute=formBuscador:j_idt419 @component
javax.faces.partial.render=@component
javax.faces.behavior.event=click
org.richfaces.ajax.component=formBuscador:j_idt419
AJAX:EVENTS_COUNT=1
javax.faces.partial.ajax=true
```

- **Response**: partial-response that re-renders the download panel, with a
  fresh ViewState.

### 6. POST ZIP — generates the ZIP (1 request, full submit)

- **Headers**: full submit (no `faces-request`), `responseType: arraybuffer`,
  45s timeout.
- **Payload**: the **merged** DOM — the full page with the selectAll
  partial-response updates applied (what the browser would see after the
  click) + the "Descargar" trigger's jsfcljs map (the first anchor with
  `img src=zip_file.png`).
- **Response**: `descarga.zip` with **all 10 PDFs together** (~2.5 MB). Each
  PDF's real name comes in `Content-Disposition`:

```
Content-Disposition: attachment;filename=Resolucion_12_20260619090939000756659.pdf
```

- Local post-processing: extract with `adm-zip`, **verify all 10** PDFs came
  out, delete the ZIP. An incomplete extraction retries the page.

---

## Metadata-only flow (`DOWNLOAD_PDFS=0`)

The same cycle **without the download steps** — selectAll, ZIP and extraction
are skipped:

1. **Session (3 requests, once per 8 pages)** — identical to the full flow:
   GET `inicio.xhtml` → POST (Buscar) → 302 → GET `resultado.xhtml`
   (page 1 + ViewState).
2. **AJAX POST paginate** (pages 2+, 1 request) — identical to the full flow:
   same payload and same XML response with the 10 resolutions → `metadata.csv`.
   Page 1 of each session skips this request (it came with the session).
3. **All download steps are skipped**: the page is marked `done` and it moves on.

### Requests per page

| Moment | Metadata only | With PDFs |
|---|---|---|
| Session (entry: steps 1-3) | 3 requests | 3 requests |
| Page 1 of each session | 0 | 2 (selectAll + ZIP) |
| Pages 2 onward | 1 (paginate) | 3 (paginate + selectAll + ZIP) |

Without PDFs the scraper makes **~3× fewer requests** and sessions last longer
(no ZIP POST, which heats up the WAF the most) — ideal for a fast sweep of the
~21,000 pages.

---

## Key discoveries

| Piece | Detail |
|---|---|
| ViewState | Opaque token `-8014842261326758199:5097596337755344635` in a `<input hidden>`; every POST requires it. Pagination does NOT change it (same token on every page). |
| Session cycle | GET `inicio.xhtml` (VS1) → POST search (`formBuscador:j_idt31`, `forward=buscar`, `busqueda=especializada`) → 302 → GET `resultado.xhtml` (VS2). Skipping a step = 500. |
| Redirect to HTTP | The 302 points to `http://` (port 80 blocked) → replaced with `https://` while following the redirect (`beforeRedirect`). |
| AJAX pagination | Partial POST: `javax.faces.source=formBuscador:data1`, `formBuscador:data1:page=N`, `formBuscador:spinner=N-1`, `formBuscador:spinner2=N-1`. Responds XML `<partial-response>` with CDATA HTML. |
| SelectAll | Before the ZIP: marks the 10 rows as selected. |
| ZIP | POST that generates `descarga.zip` with the 10 PDFs. The real name comes in `Content-Disposition` (`Resolucion_12_2026...pdf`). |
| Cookies | `JSESSIONID` with `Path=/jurisprudenciaweb` (request with the full URL). |

## Where each piece lives in the code

| Step | File |
|---|---|
| Session (GET/POST/redirect) | `src/scrape/session.ts` |
| Form payloads | `src/buildForms/` (search, pagination, selectAll, zip) + `common.ts` |
| Paginate + ZIP | `src/scrape/page.ts` |
| Extract resolutions / ViewState | `src/extract/` (resolutions, viewState) |
| Orchestration + resilience | `src/scrape/run.ts` |
| Transport / retries | `src/lib/http.ts` |