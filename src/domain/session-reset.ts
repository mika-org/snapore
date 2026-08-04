export const SESSION_RESET_CODE_TTL_MINUTES = 10;

const terminalStatuses = new Set(["COMPLETED", "CANCELLED", "EXPIRED"]);

export function isSessionResettable(input: { status: string; hasGallery: boolean; printJobCount: number }) {
  return !terminalStatuses.has(input.status) && !input.hasGallery && input.printJobCount === 0;
}

export function isSixDigitResetCode(value: string) {
  return /^\d{6}$/.test(value);
}
