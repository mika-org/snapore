import type { KioskStep } from "@/domain/session";

export type KioskRecoveryCandidate<T> = {
  sessionId: string;
  savedAt: string;
  state: T;
};

export function newestKioskRecoveryCandidate<T>(candidates: Array<KioskRecoveryCandidate<T> | null | undefined>) {
  return candidates
    .filter((candidate): candidate is KioskRecoveryCandidate<T> => Boolean(candidate))
    .sort((left, right) => {
      const leftTime = Date.parse(left.savedAt);
      const rightTime = Date.parse(right.savedAt);
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })[0] ?? null;
}

export function resolveKioskRecovery(input: {
  step: KioskStep;
  photoCount: number;
  requiredPhotoCount: number;
  hasComposite: boolean;
  hasSubmittedJob: boolean;
  retakeIndex: number | null;
  retakesUsed: number;
  retakeCompletedAfterSnapshot: boolean;
}) {
  let step = input.step;
  let retakeIndex = input.retakeIndex;
  let retakesUsed = input.retakesUsed;

  if (step === "CAPTURE" && (input.retakeCompletedAfterSnapshot || (retakeIndex === null && input.photoCount >= input.requiredPhotoCount))) {
    step = "REVIEW";
    if (input.retakeCompletedAfterSnapshot) retakesUsed += 1;
    retakeIndex = null;
  }
  if (["REVIEW", "CHECKOUT", "PRINTING"].includes(step) && input.photoCount < input.requiredPhotoCount) step = "CAPTURE";
  if ((step === "CHECKOUT" || step === "PRINTING") && !input.hasComposite) step = "REVIEW";
  if (step === "PRINTING") step = input.hasSubmittedJob ? "DONE" : "CHECKOUT";

  return { step, retakeIndex, retakesUsed };
}
