import crypto from "node:crypto";

const algorithm = "aes-256-gcm";

function secretKey() {
  const secret = process.env.APP_SECRET || "dev-only-secret-change-before-production";
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plainText) {
  if (!plainText) return "";

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, secretKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(String(plainText), "utf8"),
    cipher.final()
  ]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    tag.toString("base64"),
    encrypted.toString("base64")
  ].join(":");
}

export function decryptSecret(value) {
  if (!value) return "";

  const [ivRaw, tagRaw, encryptedRaw] = String(value).split(":");
  const decipher = crypto.createDecipheriv(
    algorithm,
    secretKey(),
    Buffer.from(ivRaw, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64")),
    decipher.final()
  ]).toString("utf8");
}
