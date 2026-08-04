import type { KioskStep } from "@/domain/session";

const VOICE_BASE_URL = "/voice/id-ID-gadis";

export type KioskVoiceCue =
  | KioskStep
  | "COUNTDOWN_3"
  | "COUNTDOWN_2"
  | "COUNTDOWN_1"
  | "SMILE"
  | "PHOTO_SUCCESS"
  | "RETAKE_SUCCESS"
  | "CAPTURE_COMPLETE"
  | "VOICE_ENABLED"
  | "RESET_CODE";

function asset(name: string) {
  return `${VOICE_BASE_URL}/${name}.mp3`;
}

export function kioskStepVoiceAsset(step: KioskStep, layoutCount: number) {
  if (step === "CAPTURE") return asset(`capture-${layoutCount}`);
  return asset(step.toLowerCase());
}

export function kioskVoiceAsset(cue: KioskVoiceCue) {
  const files: Exclude<KioskVoiceCue, KioskStep>[] = [
    "COUNTDOWN_3",
    "COUNTDOWN_2",
    "COUNTDOWN_1",
    "SMILE",
    "PHOTO_SUCCESS",
    "RETAKE_SUCCESS",
    "CAPTURE_COMPLETE",
    "VOICE_ENABLED",
    "RESET_CODE",
  ];
  if (!files.includes(cue as Exclude<KioskVoiceCue, KioskStep>)) {
    throw new Error(`Cue tahap ${cue} memerlukan kioskStepVoiceAsset`);
  }
  return asset(cue.toLowerCase().replaceAll("_", "-"));
}

export function retakeVoiceAsset(photoNumber: number) {
  const normalized = Math.min(8, Math.max(1, Math.trunc(photoNumber)));
  return asset(`retake-${normalized}`);
}
