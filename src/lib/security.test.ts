import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, hashPassword, verifyPassword } from "./security";

const originalKey = process.env.APP_ENCRYPTION_KEY;

describe("security helpers", () => {
  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  afterAll(() => {
    if (originalKey) process.env.APP_ENCRYPTION_KEY = originalKey;
    else delete process.env.APP_ENCRYPTION_KEY;
  });

  it("meng-hash password hanya dengan bcrypt dan memverifikasinya", async () => {
    const hash = await hashPassword("Snapore-test-123!");
    expect(hash).toMatch(/^\$2b\$12\$/);
    expect(hash).not.toContain("Snapore-test-123!");
    await expect(verifyPassword("Snapore-test-123!", hash)).resolves.toBe(true);
    await expect(verifyPassword("password-salah", hash)).resolves.toBe(false);
    await expect(verifyPassword("Snapore-test-123!", "scrypt:c2FsdA==:aGFzaA==")).resolves.toBe(false);
    await expect(hashPassword("a".repeat(73))).rejects.toThrow("Password maksimal 72 byte");
    await expect(verifyPassword("a".repeat(73), hash)).resolves.toBe(false);
  });

  it("mengenkripsi API key dengan authenticated encryption", () => {
    const encrypted = encryptSecret("xnd_development_secret_key");
    expect(encrypted).not.toContain("xnd_development_secret_key");
    expect(decryptSecret(encrypted)).toBe("xnd_development_secret_key");
  });
});
