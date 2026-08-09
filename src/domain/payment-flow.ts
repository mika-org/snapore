export function paymentAllowsSessionStart(status: string | null | undefined) {
  return status === "PAID" || status === "NOT_REQUIRED";
}

export function paymentRequiresBypass(status: string | null | undefined, bypassAvailable: boolean | undefined) {
  return status === "BYPASS_REQUIRED" && bypassAvailable === true;
}
