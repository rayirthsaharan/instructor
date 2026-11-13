# Proposal: connecting a real model (needs user approval - D-010)

Status: **approved by the user with changes (D-025): $10 hard cap, Claude Haiku 5.5 only, team-chosen free test manuals.** Sections below are the original proposal; where they differ, D-025 wins. Owner: lead orchestrator. Date: 2026-11-13.

Everything built so far runs on a mock. This proposal covers the first paid step: a bounded accuracy test, and what real usage would cost afterwards. Nothing here runs until the user approves and supplies an Anthropic API key.

## 1. What the test answers
1. **Can a model read real manuals well enough?** Parts, quantities, step order, warnings - measured against a hand-checked answer key, through the validators that already exist (`validateGuide` with page text).
2. **Can it point at the right diagram?** For each step, does the chosen panel/region contain the diagram a person would pick. This is the "diagram-location accuracy test" and the biggest technical unknown in the product.
3. **Which model is good enough?** Same manuals, three models, so the cost/quality choice is made on evidence.

## 2. Test design
- **Manuals:** 3 real manuals of about 12 pages each, of different kinds (one wordless picture-only assembly manual, one text-heavy appliance setup, one mixed). The user supplies them, or approves ones we pick that are free to use for testing. Plus the Lumen fixture as a control.
- **Answer key:** for each manual, a hand-made list of parts with quantities, the step order, every warning, and the correct diagram panel for each step (QA prepares it; the senior engineer reviews).
- **Runs:** each manual x 3 models x up to 3 prompt variants x 2 repeats (to see run-to-run variation) = at most 54 analyses, each followed by one verification pass.
- **Measured:** parts found / missed / invented; quantity errors; step order errors; warnings preserved verbatim; share of steps whose region contains the right diagram; share of answers the validators downgrade or reject; tokens and cost per manual; time per manual.
- **Pass bar proposed:** zero invented parts or measurements reaching a validated guide; every warning preserved; right diagram region for at least 90% of steps (the rest must fall back to the whole page, never to a wrong panel).
- **Owner:** senior engineer (Opus) designs and runs it; software engineer builds the provider adapter behind the existing `AIProvider` interface and guards; QA builds the answer keys.

## 3. Prices used (Anthropic API list prices, per million tokens)
| Model | Input | Output |
|---|---|---|
| Claude Opus 5.5 (`claude-opus-5-5`) | $4.00 | $20.00 |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2.00 | $10.00 |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 | $0.50 |

Cached input is billed at a fraction of the input price (Sonnet 5.5: $0.10). Batch processing is half price but not interactive, so it is not used for the live flow.

## 4. Estimated cost of the test
Assumptions (estimates, to be replaced by measured numbers in the first minutes of the test using token counting): about 3,000 input tokens per page image; a 12-page manual is about 40,000 input tokens per call including the prompt; analysis plus verification is about 80,000 input and 30,000 output tokens per manual, including the model's reasoning.

| Model | Cost per 12-page manual | 18 runs |
|---|---|---|
| Opus 5.5 | about $0.92 | about $17 |
| Sonnet 5.5 | about $0.46 | about $8 |
| Haiku 5.5 | about $0.02 | under $1 |

**Expected total: about $25. Requested hard cap: $50** (covers image-token estimates being off by up to 2x and a few assistant test questions). The test stops and reports if spend reaches the cap. A per-run cost log is kept.

## 5. What real usage would cost afterwards (estimates, per 20-page manual)
| Analysis model | Per manual analysed (once per unique manual) |
|---|---|
| Opus 5.5 | about $1.30 |
| Sonnet 5.5 | about $0.65 |
| Haiku 5.5 | about $0.03 |

Assistant questions with the guide cached: about 1 to 1.5 cents each on Sonnet 5.5, about a tenth of a cent on Haiku 5.5.

Against the proposed $2.99 single-guide price, analysis on any of the three models leaves margin; identical manuals are analysed once (PDF dedupe), so popular products cost nothing after the first upload.

## 6. Decisions needed from the user
1. Approve the test with a **$50 cap**, and supply an API key through the environment's secret settings (never pasted into chat or committed).
2. Supply 3 test manuals, or approve us choosing ones that are free to use for testing.
3. Model policy for production, to be confirmed after the test results: recommended starting point is Opus 5.5 for analysis only if the cheaper models miss the pass bar; otherwise the cheapest model that passes. The assistant uses the cheapest model that keeps the guards' rejection rate low.

## 7. What is already in place for a safe connection
- The provider sits behind `AIProvider`; the real adapter receives only the assembled prompt, with document and user text confined to data positions (D-020).
- Every analysis result must pass `validateGuide` before it is stored; quotes are checked against page text; answers are held until their numbers are verified against cited steps.
- `AI_PROVIDER=mock` remains the default; tests never call the paid API.
