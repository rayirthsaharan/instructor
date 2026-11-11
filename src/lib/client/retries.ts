// The API does not report how many times a job has failed, so retries are counted on this device.
// Best effort: used only to choose the "repeated failure" copy (USER_FLOWS 10.3).
const key = (id: string) => `instructor:retries:${id}`;

export function getRetryCount(id: string): number {
  try {
    return Number(window.localStorage.getItem(key(id))) || 0;
  } catch {
    return 0;
  }
}

export function bumpRetryCount(id: string): void {
  try {
    window.localStorage.setItem(key(id), String(getRetryCount(id) + 1));
  } catch {
    /* storage unavailable: copy simply stays at the first-failure wording */
  }
}
