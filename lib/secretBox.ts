import crypto from "crypto";

// Symmetric encryption for secrets we must store and later reuse (e.g. IMAP
// mailbox passwords). AES-256-GCM with a key derived from MAIL_ENC_KEY (or
// JWT_SECRET as a fallback so it works out of the box). Output format:
//   base64(iv) : base64(authTag) : base64(ciphertext)

function key(): Buffer {
  const secret = process.env.MAIL_ENC_KEY || process.env.JWT_SECRET || "";
  if (!secret) {
    throw new Error(
      "MAIL_ENC_KEY or JWT_SECRET must be set to store mailbox credentials"
    );
  }
  return crypto.createHash("sha256").update(secret).digest(); // 32 bytes
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64"),
    tag.toString("base64"),
    enc.toString("base64"),
  ].join(":");
}

export function decryptSecret(blob: string): string {
  const [ivB, tagB, dataB] = String(blob).split(":");
  if (!ivB || !tagB || !dataB) throw new Error("Malformed secret");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
