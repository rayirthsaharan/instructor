export const MAX_ANSWER_CHARS = 4000;

// Control characters except tab and line feed, format characters (zero-width, text direction, joiners), line and paragraph
// separators, and lone surrogates. Emoji joiners go too: plain text only.
const UNSAFE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\p{Cf}\u2028\u2029]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/gu;

/** Removes control, text-direction and format characters and normalises line breaks. No trimming, no length limit. */
export function cleanChunk(raw: string): string {
  return raw.replace(/\r\n?/g, '\n').replace(UNSAFE, (c) => (c === '\n' || c === '\t' ? c : ''));
}

/** Plain text only: unsafe characters removed (line breaks and tabs kept), trimmed and bounded. */
export function cleanAnswerText(raw: string, max = MAX_ANSWER_CHARS): string {
  return cleanChunk(raw).trim().slice(0, max);
}

const LINK_RE = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"'`]+|[^\s@<>"'`]+@[^\s@<>"'`]+\.\p{L}{2,}|(?<![\p{L}\p{N}@.-])(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?::\d+)?(?:\/[^\s<>"'`]*)?/giu;

const flat = (s: string) => s.normalize('NFKC').replace(/[\p{Cf}\p{Mn}]/gu, '').toLowerCase();

/** Web and email addresses in `text` that appear in none of the evidence pieces (compared without case, scheme-sensitive). */
export function findIntroducedLinks(evidence: readonly string[], text: string): string[] {
  const hay = evidence.map(flat).join('\n');
  const out: string[] = [];
  for (const m of flat(text).matchAll(LINK_RE)) {
    const link = m[0].replace(/[.,;:!?)\]}'"]+$/, '');
    if (link && !hay.includes(link) && !out.includes(link)) out.push(link);
  }
  return out;
}
