/** Playwright wipes test-results/ on every run, so screenshots go to a stable, gitignored directory. */
export const shotDir = (milestone: string) => `artifacts/screenshots/${milestone}`;
