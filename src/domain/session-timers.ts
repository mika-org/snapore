export const PAYMENT_WINDOW_SECONDS = 5 * 60;
export const SESSION_WINDOW_SECONDS = 15 * 60;

export function renewSessionDeadline(nowMs: number, windowSeconds = SESSION_WINDOW_SECONDS) {
  return nowMs + Math.max(1, Math.floor(windowSeconds)) * 1000;
}

export function remainingSeconds(deadlineMs: number, nowMs = Date.now()) {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function formatSessionTimer(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}
