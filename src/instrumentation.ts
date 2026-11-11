// Runs once when the Next.js server starts. Reports a missing PDF renderer immediately instead of at the first upload.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  try {
    const { assertRendererAvailable } = await import('@/lib/render/pdf');
    assertRendererAvailable();
  } catch (e) {
    console.error(`Startup check failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
