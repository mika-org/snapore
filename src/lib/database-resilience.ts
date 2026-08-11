const TRANSIENT_DATABASE_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
  "P2024",
  "53300",
  "57P01",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

const TRANSIENT_DATABASE_MESSAGE = /sockettimeout|connection (?:closed|terminated)|connection.*(?:timed out|timeout)|database.*(?:not reachable|unavailable)|too many connections|econnrefused|econnreset|etimedout/i;

function nestedErrorValues(value: Record<string, unknown>) {
  const values = [value.cause, value.meta];
  if (value.meta && typeof value.meta === "object") {
    values.push((value.meta as Record<string, unknown>).driverAdapterError);
  }
  return values;
}

export function isTransientDatabaseError(error: unknown) {
  const pending: unknown[] = [error];
  const seen = new Set<object>();

  while (pending.length > 0) {
    const value = pending.shift();
    if (typeof value === "string") {
      if (TRANSIENT_DATABASE_MESSAGE.test(value)) return true;
      continue;
    }
    if (!value || typeof value !== "object" || seen.has(value)) continue;

    seen.add(value);
    const record = value as Record<string, unknown>;
    if (typeof record.code === "string" && TRANSIENT_DATABASE_CODES.has(record.code.toUpperCase())) return true;

    const description = [record.name, record.message]
      .filter((entry): entry is string => typeof entry === "string")
      .join(" ");
    if (TRANSIENT_DATABASE_MESSAGE.test(description)) return true;
    pending.push(...nestedErrorValues(record));
  }

  return false;
}

type DatabaseRetryOptions = {
  retries?: number;
  delayMs?: number;
  onRetry?: (error: unknown, retryNumber: number) => void;
};

export async function withTransientDatabaseRetry<T>(
  operation: () => Promise<T>,
  { retries = 1, delayMs = 250, onRetry }: DatabaseRetryOptions = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries || !isTransientDatabaseError(error)) throw error;

      const retryNumber = attempt + 1;
      onRetry?.(error, retryNumber);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * retryNumber));
      }
    }
  }
}
