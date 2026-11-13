# Real-model accuracy test plan (Claude Haiku 5.5, $10 cap)

Owner: senior engineer. Date: 2026-11-13. Status: designed; harness runs on the mock; no paid call has been made.
Binding limits (D-025): **hard cap $10 total**, **`claude-haiku-5-5` only**, test manuals chosen by us from ones that are free to use for testing. Background and original design: `docs/REAL_MODEL_PROPOSAL.md` (where they differ, D-025 and this plan win).

## 1. Questions the test answers
1. Can Haiku 5.5 read real manuals well enough: parts and quantities, step order, warnings verbatim, no invented numbers?
2. Can it pick the right diagram for each step, given panels detected in code (ARCHITECTURE section 10 item 3)?
3. Do code-detected panels beat model-drawn regions? (`no-panels` control variant.)

## 2. Test manuals
Downloaded only into the gitignored `data/accuracy/manuals/<id>/manual.pdf`, never into the repo. All three are CC BY-SA, which allows copying and use for any purpose (including commercial testing) with attribution; we do not redistribute them. Answer keys quote warnings verbatim, so each key carries the licence and attribution (`source` field).

| Id | Kind | Title | Direct URL | Host | Licence, where stated | Pages |
|---|---|---|---|---|---|---|
| `cyclone-x-axis` | Picture-led assembly | BQ Cyclone: 2 Montaje del Eje X | https://raw.githubusercontent.com/CarlosGS/Cyclone-PCB-Factory/master/AssemblyInstructions/Cyclone_QSG_2_Montaje_del_Eje_X.pdf | `raw.githubusercontent.com` | CC BY-SA 4.0, in `AssemblyInstructions/README.md` of github.com/CarlosGS/Cyclone-PCB-Factory ("Original instructions by bq"); the repo's root README says CC BY-SA 3.0 | 14 (13 + blank back cover) |
| `anavi-thermometer` | Text-heavy device setup | ANAVI Thermometer User's Manual | https://raw.githubusercontent.com/AnaviTechnology/anavi-docs/master/anavi-thermometer/anavi-thermometer.md | `raw.githubusercontent.com` | CC BY-SA 4.0, line 14 of the manual itself and README.md of github.com/AnaviTechnology/anavi-docs | about 12 when rendered (4,689 words) |
| `cyclone-electronics` | Mixed | BQ Cyclone: 4 Montaje de la Electronica | https://raw.githubusercontent.com/CarlosGS/Cyclone-PCB-Factory/master/AssemblyInstructions/Cyclone_QSG_4_Montaje_de_la_Electronica.pdf | `raw.githubusercontent.com` | as `cyclone-x-axis` | 12 (11 + blank back cover) |
| `lumen` | Control | Lumen bookcase fixture | `fixtures/lumen-bookcase.pdf` (bundled) | none | project-owned | 6 |

Why they fit:
- **cyclone-x-axis**: an exploded-view assembly guide, one step per page, with part callouts (A, B, C), quantity badges (x1, x2) and printed hardware specs (M3 x 10, LM8UU, 8 mm x 150 mm). It has 22-117 words per page and its captions are in Spanish, so for an English-speaking user it behaves like a picture-only manual: the diagram carries the meaning. It also tests whether the specs survive (hardware sizes are exactly what the model must not invent).
- **anavi-thermometer**: an English device setup guide with an electrostatic warning, requirements, Wi-Fi configuration, factory reset, firmware flashing and Home Assistant setup. It is mostly prose and has few figures. **Caveat:** the manual is published only as Markdown, so we render it once to an A4 PDF with a pinned converter (`pandoc` + a fixed CSS, or Chromium print once the browser suite is free) and record the PDF hash in the key. The layout is ours, so this manual tests text extraction, ordering and warnings, not diagram location.
- **cyclone-electronics**: wiring, soldering, a cable-length table (Y 20, X 30, Z 60 cm), heat-shrink sizes, and a safety pointer at the end. It mixes diagrams with denser text, at 56-122 words per page.

Spares (verified the same way):
1. **BQ Cyclone: 3 Montaje del Eje Z**: https://raw.githubusercontent.com/CarlosGS/Cyclone-PCB-Factory/master/AssemblyInstructions/Cyclone_QSG_3_Montaje_del_Eje_Z.pdf, same host and licence, 14 pages.
2. **ANAVI Light Controller User's Manual**: `anavi-light-controller/` in github.com/AnaviTechnology/anavi-docs, same host and licence (CC BY-SA 4.0, repo README), Markdown, to be rendered like the thermometer manual.

Limits of the selection, stated plainly:
- **No truly wordless openly-licensed manual could be verified.** Cyclone X-axis is the closest. The candidates below may be better, but their hosts were refused by this session's network policy, so their licences and page counts were not verified and they are **not** selected:
  - mntre.com: MNT Pocket Reform DIY assembly manual.
  - commons.wikimedia.org / upload.wikimedia.org: Open Source Ecology Power Cube user manual, listed as CC BY-SA 3.0 in search results.
  - www.bfa.fcnym.unlp.edu.ar: DIY Book Scanner Archivist assembly manual.
  - buildbotics.com: Buildbotics quick start guide (GFDL per search results).
- Two of the three selected manuals are Spanish. That is realistic (the product promises the manual's language), but D-020 holds assistant answers for non-English manuals, so the assistant phase (section 3, phase 4) uses the English manual and Lumen only.
- Otto DIY (CC BY-SA 4.0 in the README, but a GPL badge and an MIT LICENSE file in the same repo) was rejected for conflicting licence statements.

If the user wants a true wordless manual or an English mixed manual, the orchestrator should ask for one of the refused hosts to be allowed. We swap a manual only before its key is built.

## 3. Phases and run matrix
Every paid step needs `ACCURACY_APPROVAL=D-025` and `ANTHROPIC_API_KEY` from the environment's secret settings. Every request goes through `guardedClient` (section 6).

| Phase | What | Calls | Cost |
|---|---|---|---|
| 0. Measure | `run.ts measure-tokens`: for each manual, `count_tokens` on each page alone and on all pages. Prompt overhead = (sum of singles - all) / (n - 1); then tokens per page. Writes `data/accuracy/tokens.json`. Then `run.ts plan` re-projects with the measured numbers. **No generation happens before this.** | about 50 `count_tokens` | free (documented as free of charge; still model-checked) |
| 1. Smoke | Lumen x `panels` x 1 repeat, to check plumbing, cost logging and validator behaviour on real output | 2-3 | about $0.01 |
| 2. Matrix | 3 manuals + Lumen x 3 variants x repeats (below) | 28 runs, each analysis (+ reconcile when chunked) + verification | expected **$0.89**, worst **$1.64** |
| 3. Fix-and-rerun (only if needed) | Prompt fixes in `src/lib/ai/prompts` (software engineer), then rerun only the failing cells | at most the phase 2 matrix again | at most $1.64 |
| 4. Assistant probe (optional) | 10 questions per manual (5 answerable, 5 not in the manual) on `anavi-thermometer` and Lumen, through `answerQuestion` and the existing guards | 20 | about $0.05 |

Variants (`scripts/accuracy/matrix.ts`; production prompts, effort `medium`, Haiku 5.5 throughout):

| Variant | Panels offered | Chunk size | Repeats | Purpose |
|---|---|---|---|---|
| `panels` | yes | 12 pages | 3 | The production design; pass/fail is decided on this one |
| `no-panels` | no (model gives coarse regions, flagged `regionFallback`) | 12 | 2 | Shows what code-detected panels buy |
| `panels-small-chunks` | yes | 6 | 2 | Whether more attention per page helps |

Total: 4 manuals x (3 + 2 + 2) = **28 runs**. Repeats show run-to-run variation; the bar must hold on **every** repeat.

**Projected spend:** expected $0.89, worst case $1.64 for phase 2. The assumptions are 3,000 tokens per page (worst case 5,000), about 20K output tokens per analysis call including adaptive thinking (worst 40K), about 10K per verification (worst 20K), and every request under 100K prompt tokens so the $0.10 / $0.50 tier applies. Phase 0 replaces the per-page figure. **All phases together, worst case: about $3.40, about a third of the cap.** If the measured projection for phases 1-2 exceeds **$5**, we cut repeats to 2 and drop `panels-small-chunks` before spending anything, and report.

## 4. Answer keys
Format: `scripts/accuracy/key-schema.ts` (Zod; `parseAnswerKey` also checks internal references). Example: `scripts/accuracy/keys/lumen.key.json`. One file per manual, `scripts/accuracy/keys/<id>.key.json`.
- `parts[]`: `key`, printed `label` (e.g. "A"), accepted `names` (manual language + English), `quantity` as printed, `pageIndex`.
- `steps[]`: the manual's step number `n`, `pageIndex`, `region` (the diagram a person would pick, normalised 0..1 on the page image rendered by `prepare` at 1600 px, i.e. the exact image the model sees), optional `altRegions`, `anchors` (short distinctive words, every group must match the model's step title + instruction; used only to map model steps to key steps, never to score regions), `partsUsed` with quantities, a `summary`.
- `warnings[]`: verbatim text as printed (line breaks collapsed), page, step.
- `source`: URL, licence, attribution. `builtBy`, `reviewedBy`.

Who builds them: **QA builds** each key from the rendered pages in `data/accuracy/manuals/<id>/pages/` before phase 1. Regions are drawn as coordinates read off the rendered PNG; no model is used. The **senior engineer reviews** every entry against the page. Keys are frozen (their hash is recorded in the results) before any paid run, so they cannot be tuned to the output.

## 5. Metrics and pass bar
Computed per run by `scripts/accuracy/score.ts` on the guide **after** `validateGuide` (with page text), verification and re-validation, which is exactly what would reach a user.
- **Parts:** found (label match first, then name), missed, invented (model parts matching no key part), quantity errors, quantity missing.
- **Steps:** mapped, missed, extra (reported, not penalised: a split or merged step is not an invention), order errors = mapped steps minus the longest correctly ordered subsequence.
- **Warnings:** verbatim (the key text is inside a warning's `sourceQuote`, ignoring the "WARNING:" prefix and end punctuation), paraphrased only, missing.
- **Invented measurements:** quantities in step text, warnings, guidance and part names that appear on no page (`findIntroducedQuantities` against all page texts). Not measurable without page text, and then the run cannot pass.
- **Regions:** see 5.4. Also reported per run: validator issue counts by code, verification changes, cost from `usage`, wall time.

**Pass bar** (proposal section 2, made concrete), per run, and it must hold on every repeat of the `panels` variant for all three manuals and Lumen:
1. zero invented parts, zero quantity errors and zero invented measurements in the validated guide;
2. every key warning preserved verbatim;
3. right region on at least 90% of key steps, and **zero wrong regions** (every other step must be a safe outcome: coarse, approximate or whole page);
4. the run produced a validated guide (a rejected guide fails).
Step order errors and missed steps are reported and reviewed but are not part of the proposal's bar. A rejected guide is safe for users but fails the test.

### 5.4 Scoring "right diagram region"
Only the step's first source is scored, because that is what the player shows first. A right diagram listed second does not rescue a wrong first one. Its region is its own `region`, or the detected panel named by `panelId`. Coverage = area(chosen ∩ key) / area(key); size = area(chosen) / area(key).
- `correct`: right page, coverage >= 0.8, size <= 2.5.
- `coarse`: right page, coverage >= 0.8, size > 2.5 (shows too much; safe).
- `approximate`: `regionFallback: true` with a box that covers the key (UI shows "Approximate area"; safe).
- `fallback`: right page, no region (whole page shown and labelled; safe).
- `wrong`: wrong page, or coverage < 0.8 (including a flagged approximate box that misses). This is forbidden by the bar.
- `missed`: no model step maps to this key step.

Detector quality is reported separately from model choice: for each key step, the best detected panel's coverage and size. If no panel on the page is `correct`, the miss is the detector's, not the model's.

## 6. Budget guard and cost log
- **Per request** (`scripts/accuracy/budget.ts`, `guardedClient` wraps the SDK client injected into `AnthropicProvider`):
  1. Reject any model other than `claude-haiku-5-5`, before anything is sent.
  2. `count_tokens` on the exact request.
  3. Worst case = (count x 1.05 + 2,000 for the output schema) input + the full `max_tokens` output, priced by `priceUsage`.
  4. Refuse if spent + worst case > cap.
- **Per run:** projected worst case of the whole run, checked before it starts.
- **Per batch:** the matrix's worst-case projection is checked before the first call; paid runs refuse to start without phase 0 numbers.
- **Prices:** `HAIKU_5_5_RATES` in `src/lib/ai/anthropic/usage.ts`.
  - $0.10 input / $0.50 output per million tokens when the whole prompt (uncached + cache read + cache write) is at most 100K tokens; $0.50 / $2.50 above that.
  - Cache reads cost 0.1x the input rate and 5-minute cache writes 1.25x.
  - The tier is chosen per request.
- **Spend:** comes only from each response's `usage`, through the provider's `usageSink`. It is appended to `data/accuracy/cost-log.jsonl` (one line per call: run id, call type, tokens, cost) and re-read from disk before every check, so the cap holds across batches and restarts. `--cap` cannot exceed $10.
- A budget stop ends the batch, writes the results table and exits with code 2.

## 7. Diagram-location method: panel detection (to implement; not in the harness yet)
Module `src/lib/render/panels.ts` (software engineer), run in the render stage on each stored page image. Output feeds `AnalyseDocumentInput.panels` and is saved as `data/accuracy/manuals/<id>/panels.json` for the harness.

**Inputs:**
- The exact page PNG sent to the model (up to 1600 px on the long edge).
- Optional text boxes from the PDF text layer.

**Output:**
- `{ pageIndex, method: 'frames' | 'xycut' | 'none', panels: [{ panelId: 'p<page number>-<a..>', region }] }`, regions normalised to the image and ids in reading order. This matches the fixture convention: `p3-a` is the first panel on the third page.

**Steps:**
1. **Normalise.**
   - Decode with `sharp`, convert to greyscale and resize so the long edge is 800 px (scale factor kept).
   - If mean luminance < 0.45, invert (dark pages).
   - Apply a 3x3 median filter (scan noise).
   - Binarise with Otsu's threshold clamped to [140, 230]: ink = darker than threshold.
2. **Content box.** Bounding box of ink, ignoring connected components smaller than 0.02% of the page (specks). If the page has no content box: method `none`.
3. **Framed panels (pass A).**
   - Find horizontal and vertical line segments: runs of ink at least 25% of the content box's width or height, after a 1-D closing of 2% of the page to join dashed lines.
   - Line thickness must be <= 1% of the page.
   - Pair parallel lines into rectangles whose four sides each have >= 80% line coverage.
   - Keep rectangles that pass the size filter (step 5) and are not contained in a larger kept rectangle. Nested insets become part of their parent.
   - If at least 2 rectangles are kept and together they cover >= 35% of the content box, use them (method `frames`).
4. **Whitespace cut (pass B, recursive XY-cut).**
   - On the content box, compute the row and column ink profiles. Split at the widest blank gap that is at least 2.5% of the page height (horizontal cut) or 2.5% of the width (vertical cut). Recurse on each part to depth 4.
   - Leaves are blocks. A block that is mostly text (when text boxes exist: text area >= 60% of the block; otherwise ink density < 8% with line-like rows) and shorter than 6% of the page is a caption. Merge it into the nearest non-text block directly above or below within 3% of the page, in the same column. A step's caption belongs to its picture.
   - Running headers and footers (blocks within 7% of the top or bottom edge that are text) are dropped.
   - Method `xycut`.
5. **Size filter.**
   - A panel must be at least 8% of the page's short side in both dimensions, and between 2% and 85% of the page area. A panel over 85% means "this page is one diagram", so use the whole page.
   - At most 12 panels per page. If there are more, rerun pass B with gap thresholds x1.5, up to twice; then fall back.
6. **Finish.**
   - Pad each panel by 1% of the page on every side, clamp it to the page and round to 4 decimals.
   - Order by rows (tops within 2% are one row), then left to right.
   - Assign ids.

**Failure modes and fallback:**
- **Full-bleed photos, single-diagram pages, dense text pages:** zero or one panel, so method `none`. The model gets no panel list for that page. The step source is the whole page with `regionFallback: true`, or the model's coarse box, which the adapter marks `regionFallback: true` (resolveSourceRef).
- **Arrows or leader lines crossing whitespace:** XY-cut cannot split, so panels come out fewer and larger. This is the safe direction: it scores as `coarse`, never `wrong`.
- **Skewed scans (> 2 degrees, detected from line angles in pass A):** method `none`.
- **Multi-column text pages:** blocks are text, so nothing is offered. The steps are text, so the whole page is right anyway.
- **Panels split mid-figure by a white band inside the figure:** the size filter drops slivers. Accepted risk; measured by detector recall (5.4).

**Parameters** are module constants. The values above are starting points, to be tuned only on the Lumen pages and on spare manuals, never on the three scored manuals.

**What the model sees:**
- The unmodified page image, plus a text list of the page's panel ids with their normalised boxes and reading-order position (`src/lib/ai/prompts/analysis.ts` `panelsBlock`).
- It returns a `panelId` per step source. Unknown ids and pages without panels become `regionFallback: true` in code.
- Drawing labelled boxes onto the image sent to the model is a possible later variant (it changes the image the model sees). It is not in this matrix.

## 8. If Haiku 5.5 misses the bar
1. Stop after phase 2 (or after phase 3 if a prompt fix is cheap and obvious), within the $10 cap.
2. Report to the user: the results table, the per-criterion failures with examples (page, step, what the model said, what the manual says), whether misses come from the detector or the model, and the spend.
3. Explain the consequence in plain terms. Every guard still applies, so a miss means more steps shown as "Whole page shown" or "Double-check with the original", or rejected guides. It does not mean invented content reaching users.
4. **No other model is called without new approval from the user.** Any request for Sonnet or Opus runs goes to the user with its own cost estimate.

## 9. Harness (`scripts/accuracy/`)
| File | Role |
|---|---|
| `run.ts` | CLI: `plan`, `prepare`, `measure-tokens`, `run` (default provider: mock) |
| `harness.ts` | `runMatrix`: analyse, validate, verify, re-validate, score; writes `data/accuracy/runs/<batch>/results.json` and `results.md` after every run |
| `score.ts` | Metrics, region classification, pass bar |
| `budget.ts` | Cost log, `BudgetGuard`, `CostLogSink`, `guardedClient` (model lock + pre-call worst case) |
| `matrix.ts` | Variants, run matrix, cost projection |
| `manuals.ts` | Manual registry (URLs, hosts, licences), Lumen loader (pages, text, dashed panel frames), `prepare` via the production renderer |
| `key-schema.ts`, `keys/` | Answer-key format and keys |

Tests: `tests/accuracy-harness.test.ts` (mock provider and fake SDK client only; no network).

Mock limitation: the mock ignores panels and returns the Lumen fixture for every request, so a mock run checks plumbing and scoring, not accuracy.

## 10. Before the first paid call (checklist)
- [ ] User adds the API key to the environment's secret settings; `raw.githubusercontent.com` stays allowed; `api.anthropic.com` reachable.
- [ ] Software engineer: panel detector (section 7) plus a `panels` command in the harness that writes `panels.json`.
- [ ] Software engineer: render the ANAVI Markdown to PDF (pinned converter) and record its hash.
- [ ] Orchestrator or engineer: download the three PDFs into `data/accuracy/manuals/<id>/manual.pdf` and run `prepare`.
- [ ] QA: build the three keys; senior engineer reviews them.
- [ ] Phase 0, then `plan`, then phase 1 smoke, then phase 2.
