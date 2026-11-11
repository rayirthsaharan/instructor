# Instructor - HTTP API (M1-a)

Implemented in `src/app/api/**` (thin routes) and `src/lib/http/*` (logic). All responses are JSON unless noted, with `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Errors are `{ "error": { "code", "message" } }`.

## Session
An anonymous device session lives in a signed cookie (`<uuid>.<HMAC>`, httpOnly, SameSite=Lax, one year): `instructor_session` in development, `__Host-instructor_session` in production (Secure, Path=/, no Domain). The cookie is issued on the first API call, but the session row is stored only on the first write (an upload), so cookieless reads leave nothing behind. Non-GET requests whose `Sec-Fetch-Site` is not `same-origin`/`none`, or whose `Origin` host differs from `Host`, get `403 forbidden`. Every document and guide belongs to one session; another session gets `404` (never `403`) for any id that is not its own. Ids must be UUIDs, otherwise `404`. Signing uses `SESSION_SECRET` (mandatory in production; a fixed insecure value in dev/test).

## Endpoints
| Method and path | Result |
|---|---|
| `POST /api/documents` (multipart, field `files`) | `201 { documentId }` |
| `GET /api/documents/:id` | `DocumentStatus` (below) |
| `POST /api/documents/:id/retry` | `202 DocumentStatus` (status `queued`); `409 conflict` unless the document failed |
| `DELETE /api/documents/:id` | `200 { deleted: true }` (extra: lets the UI remove a failed or rejected upload that has no guide) |
| `GET /api/documents/:id/pages/:index/image` | the page image, `image/png` (PDF pages) or `image/webp` (photos); `Cache-Control: private, no-cache`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cross-Origin-Resource-Policy: same-origin` |
| `GET /api/documents/:id/original[?index=n]` | the original file exactly as uploaded, `Content-Disposition: attachment` (`manual.pdf`, or `photo-n.ext`; `index` picks a photo of a photo set, default 0) |
| `GET /api/guides` | array of `LibraryItem`, newest upload first |
| `GET /api/guides/:id` | `{ id, documentId, guide, progress, pageCount }` (`guide` is a `ValidatedGuide`, schema in `src/lib/guide/schema.ts`) |
| `PUT /api/guides/:id/progress` | saved `Progress` |
| `DELETE /api/guides/:id` | `200 { deleted: true }`; removes the guide, its document and files. Analyses and page images shared with another document are kept until the last user is deleted |

### Upload (`POST /api/documents`)
One PDF, or 1..60 JPEG/PNG/WebP photos in page order. Checked by magic bytes (name and declared type are ignored), total size (40 MB), page count (60), encrypted or corrupt PDF, unreadable or oversized (> 60 Mpx) images. The PDF is opened in a child process to count pages. Rate limits (DB-backed fixed windows, `src/lib/limits.ts`): 10 per hour per session, 30 per hour per IP, 600 per hour globally; retries count too. The IP limit applies only when `TRUST_PROXY_HOPS` > 0 (then the Nth `X-Forwarded-For` entry from the right is the client); with the default 0 forwarding headers are ignored, and the per-session and global limits apply. At most 2 uploads are read and probed at once per web process; beyond that: `503 rate_limited` with `Retry-After`. A per-session quota of `FREE_GUIDES_PER_MONTH` documents per 30 days (unset = unlimited) gives `403 quota_exceeded`. JSON bodies are capped at 256 KB (`413 too_large`).

| code | HTTP | when |
|---|---|---|
| `empty` | 400 | no file, or a zero-byte file |
| `unsupported_type` | 415 | not PDF/JPEG/PNG/WebP, HEIC (convert on the device first), a PDF mixed with other files, more than one PDF, a non-multipart body |
| `too_large` | 413 | total over 40 MB (also refused early from `Content-Length`) |
| `too_many_pages` | 422 | PDF over 60 pages, or over 60 photos |
| `encrypted_pdf` | 422 | password protected PDF |
| `corrupt_file` | 400/422 | unreadable PDF or image, broken multipart |
| `rate_limited` | 429 / 503 | too many uploads from a session, IP or globally (429), or the server is busy (503); both carry `Retry-After` seconds. Not the monthly quota |
| `quota_exceeded` | 403 | the session used its `FREE_GUIDES_PER_MONTH` guides in the last 30 days (only when configured) |
| `render_failed` | 503 | the PDF renderer is missing or cannot start; never reported as a damaged file. Retry later |
| `forbidden` | 403 | cross-site request |

Other codes: `not_found` (404), `invalid_request` (400, bad progress JSON or ids not in the guide), `conflict` (409), `internal` (500, generic message).

### DocumentStatus
```
{ id, status: "queued"|"processing"|"ready"|"failed"|"rejected",
  stage: "ingest"|"render"|"analyse"|"verify"|"publish"|null,   // null while queued and once ready
  progress: 0..1, pageCount: number|null, pagesRendered: number,
  guideId: string|null, attempts: number,   // pipeline starts for the latest job (0 before the first, max 3)
  error: { code, message }|null, title: string|null }
```
- `rejected` = "not a manual" (`error.code = "not_a_manual"`, message is the reason). No guide exists.
- `failed` error codes: `analysis_unavailable` (provider failed after 3 attempts), `invalid_analysis` (the result did not pass validation, so no guide was made), `corrupt_file`, `encrypted_pdf`, `too_many_pages`, `render_failed`, `pipeline_failed` (job ran out of attempts, for example the worker died). Messages are user-safe; internals are only logged.
- Progress is persisted by the worker at each stage (ingest 5%, render 5-40% per page, analyse 40-70%, verify 75%, publish 90%). A deduped re-upload skips analyse and verify.

### LibraryItem
```
{ id: string|null, documentId, title: string|null, stepCount, estimatedMinutes: number|null,
  progress: { currentStepId: string|null, completedCount, percent: 0..100 },
  status, updatedAt: epoch ms, thumbnailPage: 0 }
```
**Deviation from the brief:** documents that have no guide yet (queued, processing, failed, rejected) have `id: null`, `title: null`, `stepCount: 0`; link them through `documentId` (`/d/[documentId]`). `estimatedMinutes` is `null` when the manual gives none. Thumbnail: `/api/documents/<documentId>/pages/0/image`.

### Progress
`PUT` body `{ currentStepId: string|null, completedStepIds: string[], checklist: Record<string, "unchecked"|"have"|"missing"> }`. `currentStepId` and every completed id must be a step of the guide; checklist keys must be part ids or tool ids of the guide. Duplicates in `completedStepIds` are dropped. Response and `GET /api/guides/:id` `progress`: the same three fields plus `updatedAt`. Unknown ids give `400 invalid_request` and nothing is saved.

## Mock analysis (AI_PROVIDER=mock, the default)
- The Lumen bookcase fixture (`fixtures/lumen-bookcase.pdf`, or the six `fixtures/lumen-bookcase/page-N.png` as a photo set, in order) returns the full fixture guide.
- `fixtures/not-a-manual.pdf` ends `rejected` (`not_a_manual`). `fixtures/mock-failure.pdf` ends `failed` (`analysis_unavailable`) after three attempts. `fixtures/encrypted.pdf` is refused at upload (`encrypted_pdf`).
- Any other upload gets a synthetic guide titled "Demo guide (mock analysis, N pages)" with one low-confidence step per page, "Demo step - mock analysis", pointing at its page. No parts, tools or measurements are invented.
- `MOCK_AI_DELAY_MS` (default 0) slows the mock so progress states are visible locally.
- Same content uploaded again by the same session reuses the stored analysis: zero provider calls. Mock results are never shared across sessions.

## Running locally
`npm run dev:all` starts the web server and the worker together (set `MOCK_AI_DELAY_MS=3000` to watch progress). Uploads only progress while the worker runs.
