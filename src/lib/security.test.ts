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

  it("meng-hash password dengan salt dan memverifikasinya", () => {
    const hash = hashPassword("Snapore-test-123!");
    expect(hash).not.toContain("Snapore-test-123!");
    expect(verifyPassword("Snapore-test-123!", hash)).toBe(true);
    expect(verifyPassword("password-salah", hash)).toBe(false);
  });

  it("mengenkripsi API key dengan authenticated encryption", () => {
    const encrypted = encryptSecret("xnd_development_secret_key");
    expect(encrypted).not.toContain("xnd_development_secret_key");
    expect(decryptSecret(encrypted)).toBe("xnd_development_secret_key");
  });
});
