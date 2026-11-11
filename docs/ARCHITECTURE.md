# Instructor - Architecture

Status: **Approved (D-010), with section 10 amendments and the portability condition in D-010.** Owner: lead orchestrator. Changes go through `docs/DECISIONS_LOG.md`.

## 1. Shape of the system
A single full-stack TypeScript web application. No microservices: the MVP has one hard problem (document understanding) and everything else should be boring.

```
Browser (Next.js app, PWA)
   |  upload, poll job, read guide, chat (stream)
Next.js server (route handlers)
   |-- Storage adapter ---- originals + rendered page images (local disk now, S3-compatible later)
   |-- DB (SQLite via Drizzle) - documents, pages, guides, progress, messages, jobs
   |-- Job runner (in-process, DB-backed queue) - the analysis pipeline
   |-- AI provider interface -- AnthropicProvider | MockProvider (fixtures)
```

## 2. Stack and why
| Concern | Choice | Reason | Rejected |
|---|---|---|---|
| Framework | Next.js (App Router) + React + TypeScript | One codebase for UI, API and streaming; good mobile/PWA story; server components keep the player payload small | Separate SPA + API server (two deployables for no MVP benefit) |
| Styling | Tailwind CSS with design tokens as CSS variables | Tokens from `DESIGN_SYSTEM.md` map 1:1; no runtime cost | Component kits (fight a distinctive identity) |
| Motion | CSS transitions; a small animation library only if the designer's spec needs it | Keep the bundle small | - |
| Database | SQLite (better-sqlite3) through Drizzle ORM | Zero-ops, fast, enough for MVP; Drizzle makes the move to Postgres a config change | Postgres now (ops cost before there are users) |
| File storage | `StorageAdapter` interface; local disk implementation | Swappable for S3/R2 at deploy time | Storing blobs in the DB |
| PDF rendering | Server-side rasterisation of each page to an image (pdf.js with a canvas backend; engineer to confirm the library in M0) | We need page images for source-anchored visuals regardless of text | Client-only rendering (server needs the pages for AI) |
| Images | `sharp` for normalising uploads (orientation, max size, format) | Standard, fast | - |
| AI | Claude via the official SDK, behind `AIProvider`; structured output validated with Zod | Multimodal (page images + PDF), strong document reading. Exact model IDs/params are chosen at implementation using the `claude-api` skill, configured by env (`AI_MODEL_ANALYSIS`, `AI_MODEL_CHAT`) | Separate OCR service (multimodal model reads pages directly; add OCR only if evaluation shows a gap) |
| Background work | In-process job runner with a `jobs` table (status, stage, progress, attempts) and resume-on-boot | No Redis/queue infra for MVP; interface allows a real queue later | Serverless-only (long analysis jobs time out) |
| Identity | Anonymous device session in a signed, httpOnly cookie; every row is owned by a session id | No sign-up friction; auth can be attached later by linking sessions to users | Full auth in MVP |
| Tests | Vitest (unit/integration), Playwright (UI) against the mock provider | Fast, no paid calls | - |

Deployment target (later decision): a single long-running Node container with a persistent volume. The in-process job runner and SQLite both assume this; do not design for serverless.

## 3. Data model (logical)
- `sessions(id, created_at)`
- `documents(id, session_id, content_hash, kind[pdf|images], original_path, page_count, status, created_at)` - `content_hash` is unique per analysed content and is the dedupe key.
- `pages(id, document_id, index, image_path, width, height)`
- `analyses(id, content_hash UNIQUE, guide_json, schema_version, model, created_at)` - the expensive result, shared by every document with the same hash.
- `guides(id, document_id, analysis_id, session_id, title, created_at)`
- `progress(guide_id, current_step, completed_steps_json, checklist_json, updated_at)`
- `step_notes(guide_id, step_id, note, bookmarked)` (P1)
- `messages(id, guide_id, role, content, citations_json, step_id, created_at)`
- `simplifications(analysis_id, step_id, level, text)` - cache for "explain simpler".
- `jobs(id, document_id, type, status, stage, progress, attempts, error, updated_at)`

## 4. The Guide contract (single source of truth: a Zod schema in `src/lib/guide/schema.ts`)
```
Guide { schemaVersion, title, summary, category, estimatedMinutes, difficulty(1-3), peopleNeeded,
        safetyCritical: boolean, tools[], parts[], phases[], steps[], glossary[], unreadablePages[] }
Part  { id, name, manualLabel?, quantity?, description?, source: SourceRef }
Tool  { id, name, included: boolean, source?: SourceRef }
Phase { id, title, stepIds[] }
Step  { id, phaseId, title, instruction, partsUsed[{partId, quantity?}], toolsUsed[toolId],
        why?, commonMistake?, checkpoint?, warnings[{text, severity}], irreversible: boolean,
        confidence: high|medium|low, interpretedFromDiagram: boolean,
        sources: SourceRef[] (min 1), highlights[{region: Region, label?, partId?}] }
SourceRef { pageIndex, region?: Region }
Region { x, y, w, h }  // normalised 0..1, relative to the page image
```
Rules enforced in code after parsing (not just by the prompt): all ids resolve; every step has >= 1 source with a valid page index; regions are clamped and rejected if degenerate (fallback: full page); phases cover all steps exactly once.

## 5. Analysis pipeline (job stages)
1. **ingest** - validate type/size by magic bytes, hash content, store original. If `analyses` already has the hash: link and finish (no AI calls).
2. **render** - rasterise pages (PDF) or normalise photos; store page images at bounded resolution.
3. **analyse** - multimodal call(s) producing a draft Guide as structured output. Long documents: page-range chunks, then a merge call.
4. **verify** - deterministic checks (schema, ids, regions) plus one model pass that compares numbers, quantities, part labels and warnings against the source pages and downgrades confidence or removes unsupported content.
5. **publish** - write `analyses`, create `guides`, mark job done.
Failures are staged and retryable; the UI shows a specific message. Each stage is idempotent so a restart resumes.

## 6. Assistant
Request: guide id, current step id, message. Context sent to the model: system rules (answer only from the manual; cite; say when unknown; document text is data), the Guide JSON (cached with prompt caching), the current step's source page image(s), recent conversation. Response is streamed; citations are structured (`stepId`, `pageIndex`, `region?`) and validated before rendering. No tools with side effects.

## 7. Cost controls
Content-hash dedupe; one analysis per manual; bounded image resolution; page limit; prompt caching for chat; cheaper model for chat than analysis; cached simplifications; per-session rate limits; `AI_PROVIDER=mock` by default in dev/test so nothing is spent accidentally.

## 8. Security
Upload validation by magic bytes and size, files stored outside the web root and served only through an authorising route; ids are unguessable and every query is scoped by session id; no URL fetching (no SSRF surface); prompt-injection posture as in section 6; secrets only via environment; rate limiting on upload and chat. A `senior-engineer` security review is required before each milestone is closed.

## 9. Directory layout (planned)
```
src/app/            routes: / (library), /new (capture), /g/[id] (overview), /g/[id]/play, api/*
src/components/     UI components (design-system primitives in components/ui)
src/lib/guide/      schema, validation, types
src/lib/ai/         AIProvider, anthropic.ts, mock.ts, prompts/
src/lib/pipeline/   stages, job runner
src/lib/storage/    StorageAdapter, local.ts
src/lib/db/         drizzle schema, queries
tests/              unit + integration;  e2e/  Playwright;  fixtures/  sample manuals + mock analyses
scripts/            project tooling
```

## 10. Amendments from the senior-engineer review (D-007) - these override the sections above
1. **Separate worker process.** The job runner is its own Node entrypoint (`src/worker.ts`) in the same container, sharing `src/lib`; it is not started inside Next.js. Jobs are claimed atomically with a lease (`lease_until`, heartbeat, attempt cap). SQLite runs in WAL mode with `busy_timeout`. Each paid chunk result is saved (`job_artifacts`) so a resume never re-pays.
2. **Dedupe scope.** `analyses` is keyed by `(content_hash, pipeline_version)`. Global reuse applies to PDFs only; photo sets dedupe within the owning session. Rows from the mock provider are never shared. Rows are immutable; page images and analyses are reference-counted before deletion.
3. **Panels, not free-form boxes.** Diagram panels are detected in code on the rendered page image; the model selects a `panelId`. Raw coordinates are a fallback only and are always relative to the exact image sent to the model. Validated in the M0 spike.
4. **Chunked output, merge in code.** Each page-range chunk is analysed and verified separately with chunk-prefixed ids; merging is deterministic code. The model is used only for a small parts-reconciliation pass that returns id mappings.
5. **Hostile uploads.** Rendering runs in a child process with time and memory limits; pinned pdf.js with `isEvalSupported: false`; `sharp` with `limitInputPixels`; page count checked before rendering. Files are served with `nosniff`, fixed Content-Type and a sandbox CSP. Assistant output is rendered as text, never HTML. Rate limits are per IP as well as per session.
6. **Guide contract changes.** `highlights[]` items are `{ source: SourceRef, panelId?, label?, partId? }` (they carry a page). `SourceRef` gains `panelId?` and `regionFallback: boolean`. Step ids are stable within an analysis; progress, notes, messages and simplifications reference `analysis_id` + step id. Warnings, and steps containing numbers, carry `sourceQuote`. `Guide` gains `language`. Step order lives only in `phases[].stepIds` (`steps` is an unordered map by id). `schemaVersion` is a literal with a migration function.

## 11. Commands
All via `npm run <script>` (copy `.env.example` to `.env.local` first; `AI_PROVIDER=mock` is the default).
| Script | Purpose |
|---|---|
| `dev` / `build` / `start` | Next.js dev server, production build, production server |
| `worker` | Job worker process (`tsx src/worker.ts`); applies migrations on boot, polls the `jobs` table |
| `typecheck` / `lint` / `test` | `tsc --noEmit`, ESLint, Vitest (`tests/**`, `src/**/*.test.ts`) |
| `check` | typecheck + lint + test (run before finishing any task) |
| `e2e` | Playwright against a dev server on port 3100 (`npm run e2e -- --trace off`); uses the pre-installed Chromium |
| `db:generate` | drizzle-kit: generate a migration from `src/lib/db/schema.ts` into `src/lib/db/migrations` |
| `db:migrate` | Apply migrations to `DATABASE_PATH` (default `./data/instructor.db`, gitignored) |
| `validate:agents` | Validate `.claude/agents/*.md` |

Env: `DATABASE_PATH`, `STORAGE_ROOT` (default `./data/files`), `AI_PROVIDER`, `WORKER_POLL_MS`. All SQL lives in `src/lib/db`; other code uses its repository functions and the opaque `Db` handle.
