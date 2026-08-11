export const BYPASS_PAYMENT_PROVIDER = "BYPASS_AUTHORIZATION";

export type SessionKind = "TESTING" | "PRODUCTION";

type SessionClassificationInput = {
  paymentProvider?: string | null;
  paymentMetadata?: unknown;
  sessionMetadata?: unknown;
};

function objectValue(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function meaningfulReason(value: unknown) {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  return reason && reason !== "-" ? reason : null;
}

export function classifySession(input: SessionClassificationInput): { kind: SessionKind; reason: string | null } {
  if (input.paymentProvider === BYPASS_PAYMENT_PROVIDER) {
    return { kind: "TESTING", reason: meaningfulReason(objectValue(input.paymentMetadata, "reason")) ?? "Bypass pembayaran kiosk" };
  }

  const explicitKind = objectValue(input.sessionMetadata, "sessionKind");
  if (explicitKind === "TESTING") {
    return { kind: "TESTING", reason: meaningfulReason(objectValue(input.sessionMetadata, "testingReason")) ?? "Sesi ditandai sebagai testing" };
  }

  const paymentEnvironment = objectValue(input.paymentMetadata, "environment");
  if (paymentEnvironment === "TEST") return { kind: "TESTING", reason: "Pembayaran Xendit TEST" };

  return { kind: "PRODUCTION", reason: null };
}

export function isTestingSession(input: SessionClassificationInput) {
  return classifySession(input).kind === "TESTING";
}
