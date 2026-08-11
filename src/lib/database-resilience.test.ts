import { describe, expect, it, vi } from "vitest";
import { isTransientDatabaseError, withTransientDatabaseRetry } from "./database-resilience";

describe("database resilience", () => {
  it("mengenali timeout Prisma dan socket yang bersarang", () => {
    expect(isTransientDatabaseError({ code: "P1008", message: "Operation has timed out" })).toBe(true);
    expect(isTransientDatabaseError({
      meta: { driverAdapterError: { cause: { code: "ETIMEDOUT", message: "connect ETIMEDOUT" } } },
    })).toBe(true);
  });

  it("tidak menganggap error query permanen sebagai gangguan sementara", () => {
    expect(isTransientDatabaseError({ code: "P2022", message: "Column does not exist" })).toBe(false);
  });

  it("mengulang satu kali setelah gangguan sementara", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce({ code: "P1008", message: "Operation has timed out" })
      .mockResolvedValueOnce("ok");

    await expect(withTransientDatabaseRetry(operation, { retries: 1, delayMs: 0 })).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("langsung meneruskan error permanen tanpa retry", async () => {
    const error = { code: "P2022", message: "Column does not exist" };
    const operation = vi.fn().mockRejectedValue(error);

    await expect(withTransientDatabaseRetry(operation, { retries: 1, delayMs: 0 })).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
