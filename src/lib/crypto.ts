import crypto from "node:crypto";
import { getEnv } from "./env";

const ALGO = "aes-256-gcm";

function key(): Buffer {
  const raw = getEnv().ENCRYPTION_KEY;
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    throw new Error("ENCRYPTION_KEY bukan base64 yang valid");
  }
  if (buf.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY harus 32 byte setelah decode base64 (sekarang ${buf.length} byte)`,
    );
  }
  return buf;
}

export type SealedSecret = { ciphertext: string; iv: string; authTag: string };

/** Enkripsi kredensial integrasi (RouterOS, Fonnte, dsb). */
export function sealSecret(plaintext: string): SealedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function openSecret(sealed: SealedSecret): string {
  const decipher = crypto.createDecipheriv(
    ALGO,
    key(),
    Buffer.from(sealed.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(sealed.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(sealed.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Sidik jari non-rahasia untuk audit: 8 byte pertama SHA-256. */
export function secretFingerprint(plaintext: string): string {
  return crypto.createHash("sha256").update(plaintext).digest("hex").slice(0, 16);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** Perbandingan waktu-konstan untuk signature/token. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|private[_-]?key)/i;

/** Hapus nilai sensitif sebelum metadata ditulis ke audit log / log aplikasi. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[REDACTED_DEPTH]";
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY_PATTERN.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string") {
    // Redaksi pola token umum di dalam string bebas.
    return value
      .replace(/\b[A-Za-z0-9_-]{24,}\b/g, (m) =>
        /^(eyJ|sk-|ghp_|pk_)/.test(m) ? "[REDACTED]" : m,
      )
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  }
  return value;
}

/** Redaksi nomor telepon: sisakan 4 digit terakhir. */
export function redactPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `****${digits.slice(-4)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "[REDACTED]";
  const visible = local ? local.slice(0, 1) : "";

  return `${visible}***@${domain}`;
}