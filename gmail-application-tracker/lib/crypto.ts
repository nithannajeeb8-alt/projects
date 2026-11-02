import crypto from "node:crypto";

function key() {
  const value = process.env.DATA_ENCRYPTION_KEY;
  if (!value) throw new Error("DATA_ENCRYPTION_KEY is required");
  const output = Buffer.from(value, "base64");
  if (output.length !== 32) throw new Error("DATA_ENCRYPTION_KEY must decode to 32 bytes");
  return output;
}
export function encrypt(value: Buffer | string) {
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(value), cipher.final()]); const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, body]).toString("base64url");
}
export function decrypt(value: string) {
  const packed = Buffer.from(value, "base64url"); const iv = packed.subarray(0, 12); const tag = packed.subarray(12, 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]);
}
