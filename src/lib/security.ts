import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { compare, hash } from "bcrypt";

const BCRYPT_SALT_ROUNDS = 12;
const BCRYPT_MAX_PASSWORD_BYTES = 72;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

export function hashPassword(password: string) {
  if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_PASSWORD_BYTES) {
    return Promise.reject(new RangeError("Password maksimal 72 byte agar dapat diproses bcrypt dengan aman."));
  }
  return hash(password, BCRYPT_SALT_ROUNDS);
}

export async function verifyPassword(password: string, encoded: string | null) {
  if (!encoded) return false;
  if (Buffer.byteLength(password, "utf8") > BCRYPT_MAX_PASSWORD_BYTES) return false;
  if (!BCRYPT_HASH_PATTERN.test(encoded)) return false;
  return compare(password, encoded).catch(() => false);
}

function encryptionKey() {
  const value = process.env.APP_ENCRYPTION_KEY;
  if (!value) throw new Error("APP_ENCRYPTION_KEY belum dikonfigurasi.");
  const decoded = Buffer.from(value, "base64");
  return decoded.length === 32 ? decoded : createHash("sha256").update(value).digest();
}

export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

export function decryptSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Format secret tidak valid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

export function maskSecret(lastFour: string | null | undefined) {
  return lastFour ? `••••••••${lastFour}` : null;
}

export function signValue(value: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET belum dikonfigurasi.");
  return createHmac("sha256", secret).update(value).digest("base64url");
}
