import { hasNonLatinLetters, isStepReference } from '../guide/quantity';
import { containsQuantity } from '../guide/validate';

/** A word that looks like a web or email address is held back too: addresses are verified only at the end. */
const LOOKS_LIKE_LINK = /@|:\/\/|^www\.|[\p{L}\p{N}]\.\p{L}{2,}/u;

/**
 * Releases streamed text only up to the first word that carries a number or quantity, and only whole words.
 * Quantities can be checked against the manual only once the answer is complete (citations arrive last), so
 * an unverified measurement is never shown, even for a moment. With `holdAll` (manuals that are not in English, where
 * spelled-out numbers cannot be recognised) nothing is released while streaming.
 */
export class QuantityHoldback {
  private buf = '';
  private sent = 0;

  /**
   * `holdAll`: release nothing while streaming. `opts.stepCount`: "step N" with N a real step is not a quantity.
   * `opts.english`: a word in a non-Latin script (which cannot be checked) is held too.
   */
  constructor(private readonly holdAll = false, private readonly opts: { stepCount?: number; english?: boolean } = {}) {}

  private risky(prev: string | undefined, word: string): boolean {
    if (this.opts.stepCount !== undefined && isStepReference(prev, word, this.opts.stepCount)) return false;
    return containsQuantity(word) || (prev !== undefined && containsQuantity(`${prev} ${word}`) && !containsQuantity(prev)) || LOOKS_LIKE_LINK.test(word) || (this.opts.english === true && hasNonLatinLetters(word));
  }

  /** Appends text and returns the part that is safe to show now. */
  push(delta: string): string {
    this.buf += delta;
    if (this.holdAll) return '';
    const lastSpace = Math.max(this.buf.lastIndexOf(' '), this.buf.lastIndexOf('\n'), this.buf.lastIndexOf('\t'));
    const limit = lastSpace + 1;
    if (limit <= this.sent) return '';
    let end = limit;
    const word = /\S+\s+/g;
    let prev: string | undefined;
    for (let m = word.exec(this.buf); m !== null && m.index < limit; m = word.exec(this.buf)) {
      if (m.index >= this.sent && this.risky(prev, m[0])) {
        end = m.index;
        break;
      }
      prev = m[0].trim();
    }
    if (end <= this.sent) return '';
    const out = this.buf.slice(this.sent, end);
    this.sent = end;
    return out;
  }

  get emitted(): string {
    return this.buf.slice(0, this.sent);
  }
}
