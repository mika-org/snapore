export type PaperLevel = "OK" | "LOW" | "EMPTY";

export function getPaperLevel(remaining: number, lowThreshold: number): PaperLevel {
  if (remaining <= 0) return "EMPTY";
  if (remaining <= Math.max(1, lowThreshold)) return "LOW";
  return "OK";
}

export function remainingPaperAfterPrint(currentSheets: number, copies: number) {
  return Math.max(0, Math.floor(currentSheets) - Math.max(1, Math.floor(copies)));
}
