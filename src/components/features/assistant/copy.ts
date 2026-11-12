// Exact copy of the assistant sheet (USER_FLOWS 7, DS 7.13, 7.16). One place so tests and screens agree.

export const COPY = {
  title: 'Ask about this step',
  empty: 'Stuck on this step? Ask in your own words.',
  footnote: 'Answers come only from your manual.',
  instructorNote: "Instructor's explanation - not the manual's wording.",
  notInManualLabel: 'NOT IN YOUR MANUAL',
  openManual: 'Open the original manual',
  /** `note` on an answer = Instructor could not point to a place in the manual. */
  caution: "Instructor couldn't point to where the manual says this. Check it against the original manual.",
  failed: "That didn't go through.",
  stopped: 'You stopped this answer.',
  tryAgain: 'Try again',
  askAgain: 'Ask again',
  offline: "You're offline. Questions need a connection.",
  historyFailed: "Couldn't load your earlier questions.",
  limitReached: "You've reached the question limit for this guide.",
  rateLimited: "You're asking quickly. Wait a little, then try again.",
  unavailable: "The assistant isn't available right now. Try again in a little while.",
  busy: 'Still answering your last question. Wait for it to finish, then try again.',
  clear: 'Clear conversation',
  clearTitle: 'Clear this conversation?',
  clearMessage: 'Your questions and the answers for this guide will be removed.',
  clearConfirm: 'Clear',
  clearFailed: "Couldn't clear the conversation. Try again.",
  placeholder: 'Ask a question',
  stop: 'Stop',
  send: 'Send',
  stepSimple: {
    label: 'SIMPLER WORDING',
    note: 'Same step, simpler words. Numbers and part names are unchanged.',
    error: "Couldn't get a simpler version.",
    fellBack: 'This step is already as simple as we can safely make it.',
  },
} as const;

export type ErrorKind = 'inline' | 'info' | 'limit';

/** How a failed turn is shown. Server messages are never shown: the copy is fixed and says what to do next. */
export function errorView(code: string): { kind: ErrorKind; text: string } {
  switch (code) {
    case 'rate_limited':
      return { kind: 'info', text: COPY.rateLimited };
    case 'busy':
      return { kind: 'info', text: COPY.busy };
    case 'message_limit':
    case 'limit_reached':
      return { kind: 'limit', text: COPY.limitReached };
    case 'ai_unavailable':
      return { kind: 'inline', text: COPY.unavailable };
    case 'stopped':
      return { kind: 'inline', text: COPY.stopped };
    default:
      return { kind: 'inline', text: COPY.failed };
  }
}
