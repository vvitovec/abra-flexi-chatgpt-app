import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config.js";

function b64(input: Buffer): string {
  return input.toString("base64");
}

function fromB64(input: string): Buffer {
  return Buffer.from(input, "base64");
}

export function randomId(size = 24): string {
  return randomBytes(size).toString("hex");
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${b64(salt)}$${b64(derived)}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [, saltRaw, hashRaw] = storedHash.split("$");
  if (!saltRaw || !hashRaw) {
    return false;
  }
  const salt = fromB64(saltRaw);
  const expected = fromB64(hashRaw);
  const derived = scryptSync(password, salt, expected.length);
  return timingSafeEqual(expected, derived);
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function encryptJson(config: AppConfig, payload: Record<string, unknown>) {
  const primary = config.encryptionKeys[0];
  const iv = randomBytes(12);
  const key = createHash("sha256").update(primary.key).digest();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    keyVersion: primary.version,
    ciphertext: b64(encrypted),
    iv: b64(iv),
    tag: b64(tag)
  };
}

export function decryptJson<T>(config: AppConfig, encrypted: {
  keyVersion: string;
  ciphertext: string;
  iv: string;
  tag: string;
}): T {
  const keyConfig = config.encryptionKeys.find((item) => item.version === encrypted.keyVersion);
  if (!keyConfig) {
    throw new Error(`Missing encryption key version '${encrypted.keyVersion}'.`);
  }
  const key = createHash("sha256").update(keyConfig.key).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, fromB64(encrypted.iv));
  decipher.setAuthTag(fromB64(encrypted.tag));
  const raw = Buffer.concat([
    decipher.update(fromB64(encrypted.ciphertext)),
    decipher.final()
  ]).toString("utf8");
  return JSON.parse(raw) as T;
}
