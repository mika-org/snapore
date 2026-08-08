export function paymentAllowsSessionStart(status: string | null | undefined) {
  return status === "PAID" || status === "NOT_REQUIRED";
}
