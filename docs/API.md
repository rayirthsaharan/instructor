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
| `PATCH /api/guides/:id/progress` | merged `Progress` (the app's write path) |
| `PUT /api/guides/:id/progress` | saved `Progress` (whole-record replace; tooling and test seeding only) |
| `GET /api/guides/:id/messages` | `{ messages: Message[] }`, oldest first, newest 100 (see "Assistant") |
| `POST /api/guides/:id/messages` | `200 text/event-stream` (see "Assistant") |
| `DELETE /api/guides/:id/messages` | `200 { cleared: true }` |
| `GET /api/guides/:id/suggestions?stepId=` | `{ suggestions: string[] }` (3 questions) |
| `POST /api/guides/:id/steps/:stepId/simplify` | `{ text, cached, fellBack }` |
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
  retryCount: number,   // times the user called POST /retry for this document (persisted). The UI's "still not working" copy uses this (>= 2), not `attempts`
  error: { code, message }|null, title: string|null }
```
- `rejected` = "not a manual" (`error.code = "not_a_manual"`, message is the reason). No guide exists.
- `failed` error codes: `analysis_unavailable` (provider failed after 3 attempts), `invalid_analysis` (the result did not pass validation, so no guide was made), `corrupt_file`, `encrypted_pdf`, `too_many_pages`, `render_failed`, `pipeline_failed` (job ran out of attempts, for example the worker died). Messages are user-safe; internals are only logged.
- Progress is persisted by the worker at each stage (ingest 5%, render 5-40% per page, analyse 40-70%, verify 75%, publish 90%). A deduped re-upload skips analyse and verify.

### LibraryItem
```
{ id: string|null, documentId, title: string|null, stepCount, estimatedMinutes: number|null,
  progress: { currentStepId: string|null, currentStepTitle: string|null, completedCount, percent: 0..100 },  // title of the current step, null if none
  status, updatedAt: epoch ms, thumbnailPage: 0 }
```
**Deviation from the brief:** documents that have no guide yet (queued, processing, failed, rejected) have `id: null`, `title: null`, `stepCount: 0`; link them through `documentId` (`/d/[documentId]`). `estimatedMinutes` is `null` when the manual gives none. Thumbnail: `/api/documents/<documentId>/pages/0/image`.

### Progress
**`PATCH` (what the app uses).** Body: operations, applied in one transaction to the progress currently stored, so writes from several tabs or devices commute (H-027):
`{ complete?: string[], uncomplete?: string[], currentStepId?: string|null, checklist?: Record<string, "unchecked"|"have"|"missing"> }`.
- `complete` / `uncomplete` are set operations on step ids (idempotent; existing order is kept, new completions are appended). A step may not be in both lists.
- `currentStepId` (when present) and each checklist key are last-writer-wins; checklist keys not sent are left as they are.
- Every id must belong to the guide (steps; part or tool ids for the checklist). Unknown ids, unknown fields, or a step in both lists give `400 invalid_request` and nothing is saved. `{}` is a no-op that returns the current progress.
- Response: the merged progress (`currentStepId`, `completedStepIds`, `checklist`, `updatedAt`). Clients adopt it, keeping only operations made since the request was sent.
- Client rule: never send the whole copy. The store also re-reads `GET /api/guides/:id` when the tab regains focus or becomes visible.

**`PUT`** replaces the whole record and is kept for tooling and test seeding; a stale client using it would erase another tab's work. Body `{ currentStepId: string|null, completedStepIds: string[], checklist: Record<string, "unchecked"|"have"|"missing"> }`. `currentStepId` and every completed id must be a step of the guide; checklist keys must be part ids or tool ids of the guide. Duplicates in `completedStepIds` are dropped. Response and `GET /api/guides/:id` `progress`: the same three fields plus `updatedAt`. Unknown ids give `400 invalid_request` and nothing is saved.

## Assistant (M3-a, hardened by M3-c; mock provider only)
Implemented in `src/lib/http/assistant.ts` and `src/lib/assistant/*`. All routes are session scoped like the rest (another session or a malformed id gets `404 not_found`); non-GET requests pass the origin check; bodies are capped (16 KB for questions, `413 too_large`).

**Message** = `{ id, role: "user"|"assistant", text, stepId: string|null, createdAt, citations: [{ stepId?, pageIndex, region?: {x,y,w,h} }], notInManual: boolean }`. `text` is plain text, never HTML: render it as text. **`note` was removed (D-020):** an answer that is not grounded, or is left with no valid citation, is replaced by the fixed not-in-manual text with `notInManual: true` and `citations: []`; model-written free text never reaches the UI without at least one valid citation. User messages have `citations: []`, `notInManual: false`. Old stored rows that still carry a `note` are read without it.

**`POST /messages`** body `{ stepId, text }` (`stepId` must be a step of the guide, `text` 1..1000 characters after trimming; otherwise `400 invalid_request`). Before the stream opens the usual JSON errors apply: `400`, `404`, `409 busy` (**one stream per session**: another answer from this session is still streaming, for any guide), `429 rate_limited` (per session, default 30 questions per 10 minutes, `ASSISTANT_MESSAGES_PER_10_MIN`; `Retry-After`), `503 rate_limited` (more than `ASSISTANT_MAX_STREAMS`, default 8, answers streaming in this process; `Retry-After`). The response is `200 text/event-stream` with events `delta` `{"text"}` (zero or more) and then exactly one of `done` `{"message": Message}` or `error` `{"error": {code, message}}` (`ai_unavailable` or `internal`). An answer that is not finished after 60 s (injectable in tests as `assistantLimits.answerTimeoutMs`), or whose raw text runs past twice the length cap, is stopped (the provider is aborted) and ends in `error` `ai_unavailable`; nothing is stored. **The client must replace the streamed text with `message.text` on `done`.** The question and the answer are stored together, only after the answer passed the guards; if the stream fails, is cancelled, or ends in `error`, nothing is stored, so the client can simply ask again.

Guards applied to every answer before `done` (issues are logged server-side, never shown): streamed deltas are cleaned of control, text-direction and other format characters (the same cleaning is applied to the final text, which is also bounded to 4000 characters); citations are checked with `validateCitations` (unknown step or page dropped, regions clamped, duplicates removed, at most 6 kept) and an answer left with none, or marked not grounded by the provider, becomes the fixed not-in-manual text. Evidence is the first 3 distinct cited steps (title, instruction, quotes, warnings, why/mistake/checkpoint, part quantities and the names, labels and descriptions of the parts the step uses), each field read on its own. Quantities are normalised (NFKC, zero-width and direction characters removed, look-alike mixed-script words) and matched as number+unit pairs and ranges: `10 Nm` is not `10 screws`, `4 to 10 mm` is not `4 mm` plus `10 mm`, `ten` equals `10`; unit words alone ("an inch", "a litre"), roman numerals (`XII`) and look-alike spellings count as quantities. Any web or email address in the answer must appear in a cited step. Anything unverified replaces the whole answer by the not-in-manual text with `notInManual: true`. Streaming never shows a word with a quantity or an address until the answer has been verified (text is held back from the first such word and released at the end if it passes). For a guide whose `language` is not English, number words cannot be recognised, so **nothing is streamed**: the single `delta` before `done` carries the verified text. Answers must not state page numbers in prose; pages are shown through citations.

Context given to the provider (`buildAssistantPrompt`, `src/lib/assistant/prompt.ts`): the system role holds fixed rules only; the guide JSON, current step, completed step ids, up to 10 recent messages (1000 characters each) and the question travel in the user role as delimited data blocks, JSON-escaped so they cannot close a block or forge another.

A real provider adapter receives only `AnswerQuestionInput.prompt` (never the structured guide, message or history fields); simplification likewise gets its own prompt (`buildSimplifyPrompt`).

**`GET /messages`** newest 100 messages, oldest first. Storage keeps the newest 200 per guide; older ones are deleted when new ones are saved. **`DELETE /messages`** clears the guide's conversation (also removed when the guide is deleted).

**`GET /suggestions?stepId=`** three short questions derived only from the step's own content (meaning, parts, why, warnings, checkpoint, mistake, next step, a parts-difference question), deterministic; `400` for a missing or unknown `stepId`.

**`POST /steps/:stepId/simplify`** (no body) returns `{ text, cached, fellBack }`. The simplification is cached per analysis and step in `simplifications` (level 1); it passes through `simplifyStepChecked`: the output is cleaned of control and direction characters, must be at most 1000 characters, and may not add a quantity (same rules as answers) or a web/email address. When any check rejects it, `fellBack: true` and `text` is the original instruction (not cached). Unknown step: `404`. Provider failure: `503 ai_unavailable`. Cache misses are limited to 60 per 10 minutes per session (`429 rate_limited`).

New error codes: `busy` (409), `ai_unavailable` (503).

**Mock answers** (`AI_PROVIDER=mock`): for the Lumen fixture the mock answers "What does this step mean?", "Which piece is this?", "Why am I doing this?", "Why does the manual warn about this?", "What mistake should I avoid?", "How do I know it is done right?", "What is next?", "Where is this shown in the manual?" and part-difference questions from the guide, and falls back to keyword matching across the guide; everything else gets the not-in-manual answer. Chunk delay: `MOCK_AI_DELAY_MS` spread over the chunks of an answer. Test triggers (only the mock reads them; put in the question text): `[[mock:fail]]` fails after 3 chunks, `[[mock:badcite]]` cites an unknown step and a bad page, `[[mock:invent]]` adds an invented measurement, `[[mock:html]]` answers with HTML-looking text, `[[mock:nocite]]` answers with no citation (now yields the fixed not-in-manual message, like `badcite`).

## Mock analysis (AI_PROVIDER=mock, the default)
- The Lumen bookcase fixture (`fixtures/lumen-bookcase.pdf`, or the six `fixtures/lumen-bookcase/page-N.png` as a photo set, in order) returns the full fixture guide.
- `fixtures/not-a-manual.pdf` ends `rejected` (`not_a_manual`). `fixtures/mock-failure.pdf` ends `failed` (`analysis_unavailable`) after three attempts. `fixtures/encrypted.pdf` is refused at upload (`encrypted_pdf`).
- Any other upload gets a synthetic guide titled "Demo guide (mock analysis, N pages)" with one low-confidence step per page, "Demo step - mock analysis", pointing at its page. No parts, tools or measurements are invented.
- `MOCK_AI_DELAY_MS` (default 0) slows the mock so progress states are visible locally.
- Same content uploaded again by the same session reuses the stored analysis: zero provider calls. Mock results are never shared across sessions.

## Running locally
`npm run dev:all` starts the web server and the worker together (set `MOCK_AI_DELAY_MS=3000` to watch progress). Uploads only progress while the worker runs.
