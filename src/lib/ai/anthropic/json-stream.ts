/**
 * Incrementally extracts the string value of one top-level key (default "answer") from streamed JSON text, so the
 * answer can be shown while the rest of the structured output (grounded, citations) is still being written.
 * Handles escapes split across chunks. If the key never appears as the first string field, nothing is emitted and
 * the caller falls back to the parsed final value.
 */
export class JsonStringFieldStreamer {
  private buffer = '';
  private state: 'seek' | 'in' | 'done' = 'seek';
  private escape = '';
  private pendingHigh: string | null = null;

  constructor(private readonly key = 'answer') {}

  push(chunk: string): string {
    let out = '';
    if (this.state === 'done') return out;
    let text = chunk;
    if (this.state === 'seek') {
      this.buffer += chunk;
      const m = new RegExp(`"${this.key}"\\s*:\\s*"`).exec(this.buffer);
      if (!m) return '';
      text = this.buffer.slice(m.index + m[0].length);
      this.buffer = '';
      this.state = 'in';
    }
    for (const ch of text) {
      if (this.escape) {
        this.escape += ch;
        const done = this.finishEscape();
        if (done !== null) out += done;
        continue;
      }
      if (ch === '\\') {
        this.escape = '\\';
        continue;
      }
      if (ch === '"') {
        this.state = 'done';
        break;
      }
      out += ch;
    }
    return out;
  }

  /** Returns decoded text when the escape sequence is complete, otherwise null. */
  private finishEscape(): string | null {
    const e = this.escape;
    if (e.length === 2 && e[1] !== 'u') {
      this.escape = '';
      const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };
      return map[e[1]!] ?? '';
    }
    if (e.length === 6) {
      this.escape = '';
      const code = parseInt(e.slice(2), 16);
      if (Number.isNaN(code)) return '';
      const c = String.fromCharCode(code);
      if (code >= 0xd800 && code <= 0xdbff) {
        this.pendingHigh = c;
        return '';
      }
      if (this.pendingHigh && code >= 0xdc00 && code <= 0xdfff) {
        const pair = this.pendingHigh + c;
        this.pendingHigh = null;
        return pair;
      }
      this.pendingHigh = null;
      return c;
    }
    return null;
  }
}
