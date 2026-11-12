import { containsQuantity } from '../guide/validate';

/**
 * Releases streamed text only up to the first word that carries a number or quantity, and only whole words.
 * Quantities can be checked against the manual only once the answer is complete (citations arrive last), so
 * an unverified measurement is never shown, even for a moment. `rest()` returns what was held back.
 */
export class QuantityHoldback {
  private buf = '';
  private sent = 0;

  /** Appends text and returns the part that is safe to show now. */
  push(delta: string): string {
    this.buf += delta;
    const lastSpace = Math.max(this.buf.lastIndexOf(' '), this.buf.lastIndexOf('\n'), this.buf.lastIndexOf('\t'));
    const limit = lastSpace + 1;
    if (limit <= this.sent) return '';
    let end = limit;
    const word = /\S+\s+/g;
    word.lastIndex = this.sent;
    for (let m = word.exec(this.buf); m !== null && m.index < limit; m = word.exec(this.buf)) {
      if (containsQuantity(m[0])) {
        end = m.index;
        break;
      }
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
