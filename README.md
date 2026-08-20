# Scraper Jurisprudencia PJ

[![by](https://img.shields.io/badge/by-RLFreddy-gray?logo=github)](https://github.com/RLFreddy)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-18%2B-green?logo=node.js)](https://nodejs.org)

WAF-resilient scraper for Peru's judiciary jurisprudence portal
(`jurisprudencia.pj.gob.pe`). Crawls all result pages (~21,000 — the total is
detected live and varies), extracts structured resolution metadata and
downloads the PDFs — **with plain HTTP requests only** (axios + cheerio, zero
browser automation).

---

## Why it's hard

The portal is a **JSF 2 + RichFaces 4** application behind a **ShieldSquare
WAF** that actively fights non-browser clients:

- Every request must carry the server-side **ViewState** token, or the server
  answers `ViewExpiredException` (500). Pagination is inherently sequential.
- The WAF serves **decoy responses** (HTTP 200 with `totalPages: 0`) and
  evicts sessions after ~11 ZIP downloads. A dead session is detected by the
  rotated `JSESSIONID` cookie.
- The 302 redirect after login points to **http** on a blocked port — the
  client must force https.
- The resolutions travel as **triple-escaped JSON** embedded in `onclick`
  attributes, with a different escaping format between full pages and AJAX
  responses.

The scraper replicates the exact browser flow (session → paginate → select all
→ ZIP) request by request, and coexists with the WAF through exponential
backoff, session rotation, decoy detection and SQLite resume.

## Stack

| Technology | Role |
|---|---|
| **TypeScript** | Strict typing, compiled with `tsc` |
| **Axios** + `axios-cookiejar-support` | HTTP requests with automatic cookie jar |
| **Cheerio** | HTML/XML parsing |
| **tough-cookie** | Cookie jar |
| **adm-zip** | PDF extraction from each page's ZIP |
| **better-sqlite3** | Resume state (which pages are done/failed) |

## Installation

```bash
git clone <repo-url>
cd <repo>
cp .env.example .env
pnpm install
```

Requires **Node 18+**.

## Usage

```bash
pnpm dev
```

| Flag (.env or env) | Default | What it does |
|---|---|---|
| `PAGES` | `0` | `0` = all pages; `N` = N pages from the resume point |
| `DOWNLOAD_PDFS` | `1` | `1` = metadata + ZIP + PDFs; `0` = `metadata.csv` only (fast and light on the WAF) |
| `RETRIES` | `4` | Retries per request (exponential backoff 1s, 2s, 4s, 8s) |
| `ZIP_RETRIES` | `2` | Retries of the ZIP POST |
| `REQUEST_DELAY_MS` | `2500` | Pause between pages (anti rate-limit) |
| `RATE_LIMIT_COOLDOWN_MS` | `60000` | Pause before renewing the session (hot WAF) |
| `MAX_COOLDOWN_CYCLES` | `3` | Max cooldown cycles before giving up |
| `MAX_ATTEMPTS` | `5` | Attempts per page before abandoning it |
| `ZIP_FAILURES_BEFORE_RENEW` | `2` | Consecutive failures that trigger session renewal |
| `PAGES_PER_SESSION` | `8` | Proactive session rotation (the WAF evicts ~11 ZIPs) |
| `DB_PATH` | `scraper.db` | Resume state (SQLite) |
| `OUTPUT_DIR` | `files` | Output: `files/page-N/` |
| `ERROR_LOG_PATH` / `ERROR_DIR` | `errors/events.jsonl` / `errors/dumps` | JSON events (append) and per-day dumps of failed responses |

### Examples

```bash
pnpm dev                               # all pages (~21,000) with PDFs
DOWNLOAD_PDFS=0 pnpm dev               # metadata only for all pages
DOWNLOAD_PDFS=0 PAGES=100 pnpm dev     # metadata for 100 pages (fast)
PAGES=5 pnpm dev                       # 5 pages with PDFs
```

## Output

```
files/
├── page-1/
│   ├── metadata.csv               ← 10 resolutions (recurso, expediente,
│   │                                 pretension, tipo, fecha, sala, normaDI,
│   │                                 sumilla, palabrasClave, uuid, urlDescarga)
│   ├── Resolucion_12_20260814102923000360794.pdf   ← loose PDFs (if
│   ├── Resolucion_3_20260814180456000669553.pdf      DOWNLOAD_PDFS=1)
│   └── ... (10 PDFs)
├── page-2/
│   └── ...
└── page-N/
```

Each ZIP carries 10 PDFs with descriptive names. Per-page flow:
`metadata.csv` first (survives failures) → ZIP → extract PDFs → **verify all
10 came out** → delete the ZIP. A failed extraction retries the page.

Failures are tracked separately, organized by day:

```
errors/
├── events.jsonl              ← one JSON event per line (retries, decoys, failures)
└── dumps/
    └── 2026-08-19/           ← raw body of each failed response
        ├── 213000-paginate-p17.html
        └── 213045-zip-p17.xml
```

## Architecture

```
src/
├── index.ts              # bootstrap: createClient() → run()
├── config.ts             # all configuration (env)
├── types.ts              # domain types + StepFailure (typed error)
├── state.ts              # SQLite: page done/failed/attempts, resume
├── lib/
│   ├── http.ts           # axios client + cookie jar, withRetry with backoff
│   │                     #   and Retry-After support, structured errorInfo
│   ├── log.ts            # console log (info/debug)
│   ├── errorLog.ts       # errors/events.jsonl (JSON lines) + dumps in errors/dumps/
│   └── output.ts         # the only filesystem layer: writeMetadata, extractPdfs
├── buildForms/
│   ├── common.ts         # collectFormFields($, form, {skip, force}) — DRY
│   ├── pagination.ts     # AJAX pagination payload (RichFaces DataScroller)
│   ├── selectAll.ts      # "select all" payload (before the ZIP)
│   └── zip.ts            # payload of the POST that generates the ZIP
└── scrape/
    ├── session.ts        # JSF cycle: GET inicio → POST buscar → GET resultado
    ├── page.ts           # downloadPage: paginate/extract → CSV → ZIP → PDFs
    └── run.ts            # orchestration: sessions, resume, rotation, cooldown
```

## Resilience design (the WAF is the bottleneck)

The portal is protected by a WAF (ShieldSquare) that evicts sessions and
returns *decoy* responses (HTTP 200 with `totalPages: 0`). The scraper
coexists with it:

- **Exponential backoff** on every request (`RETRY_BASE_DELAY_MS * 2^(attempt-1)`,
  honors `Retry-After` if the site ever responds 429 with that header).
- **Session death signal**: 500 with `Set-Cookie: JSESSIONID` → renew right
  away (with cooldown), without retrying on a dead session.
- **Proactive rotation**: renew every `PAGES_PER_SESSION` pages before the WAF
  evicts (~11 ZIPs per session observed).
- **Decoy detection**: session with `totalPages: 0` → cooldown + retry up to
  `MAX_COOLDOWN_CYCLES`.
- **Resume**: every page is marked done/failed in SQLite. An interruption
  resumes exactly where it left off; abandoned pages (5 attempts) are skipped.
- **Clean log**: one line per page (`[N/total] ✓ 10 res · 2.56 MB`); all
  failure detail goes to `errors/events.jsonl` (JSON, append) + a body dump per
  day in `errors/dumps/<day>/<time>-<step>.<ext>`.

```text
$ pnpm dev
Total pages: 21432

[22/21432] ✓ 10 res · 2.56 MB
[23/21432] ✓ 10 res · 2.50 MB
[24/21432] ✗ zip p24 → ✓ 10 res · 2.48 MB
[25/21432] ✓ 10 res · 2.61 MB
...
Done: 21 pages this run — 42 done, 0 failed (see errors/events.jsonl)
```

Pagination is **inherently sequential** (JSF ViewState): page N+1 needs the
token from page N, and parallelizing would only multiply the pressure on the
WAF. That's why the scraper is single-threaded with a steady rhythm.

## How it works

The portal is **JSF 2 + RichFaces 4** and everything revolves around a
**ViewState** token that every POST must return. The scraper replicates the
browser cycle with plain HTTP requests:

1. **Session** (3 requests, every 8 pages): GET `inicio.xhtml` → POST "Buscar"
   (replicating the button's `mojarra.jsfcljs`) → 302 → GET `resultado.xhtml`,
   which already carries **page 1** and the reusable ViewState.
2. **Pagination** (1 request per page): DataScroller AJAX POST
   (`formBuscador:data1:page=N`) → XML `<partial-response>` with the 10
   resolutions → `metadata.csv`.
3. **PDFs** (optional, 2 extra requests): "select all" AJAX POST + ZIP POST
   returning `descarga.zip` with all 10 PDFs (~2.5 MB) → extract, verify,
   delete the ZIP.
4. **Close**: every page is marked `done` (or `failed`) in SQLite — the resume.

Page 1 of each session skips pagination (it comes with the session), and
without PDFs the scraper makes ~3× fewer requests.

> **Full reverse-engineering detail** (exact payloads of every step, flow
> with/without ZIP, requests per page) → [`docs/REVERSE-ENGINEERING.md`](docs/REVERSE-ENGINEERING.md)

## Features

| Feature | Status |
|---|---|
| Plain HTTP requests only (no browser automation) | ✅ |
| Crawl the full pagination (~21,000 pages, total detected live) | ✅ |
| Structured metadata extraction (CSV, 11 columns) | ✅ |
| PDF download (individual, real filenames) | ✅ |
| Backoff on rate-limit/429 | ✅ |
| Continue across persistent failures (resume + skip) | ✅ |
| Failure tracking for manual retry | ✅ (events.jsonl + dumps) |
| Documented (this README + `.env.example`) | ✅ |

## What I'd change

Honest self-review, as any good engineer should do:

- **Residential proxy pool**: the biggest remaining bottleneck is the source
  IP. A pool with automatic rotation would let the crawl run multi-threaded
  (with per-IP session state) and go ~10× faster. The single-threaded design
  was the right call for a single IP.
- **Golden-file tests**: the payload builders are pure functions — they should
  be locked with fixture-based unit tests so portal layout changes are caught
  in CI instead of in production.
- **Async transport**: swapping axios for `undici` would buy HTTP/2 pooling and
  lower memory; not done to keep the diff minimal.
- **Schema versioning** for `scraper.db`, so future state changes migrate
  safely instead of forcing a full re-crawl.

## Notes

- The site may require a **VPN to Peru** from international connections.
- The scraper is **idempotent**: it resumes from SQLite and never re-downloads
  done pages.
- Plain HTTP requests only (axios + cheerio), no browser automation.

---

Built by [RLFreddy](https://github.com/RLFreddy)