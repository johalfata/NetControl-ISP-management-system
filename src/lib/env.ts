import { z } from "zod";

/**
 * Validasi environment. TIDAK dijalankan saat import modul supaya proses
 * build tidak gagal ketika variabel belum tersedia. Panggil `getEnv()` pada
 * runtime (route handler, job, service).
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  APP_URL: z.string().url().default("http://localhost:4755"),
  ENCRYPTION_KEY: z.string().min(1, "ENCRYPTION_KEY wajib diisi (base64 32 byte)"),
  WEBHOOK_HMAC_SECRET: z.string().min(16, "WEBHOOK_HMAC_SECRET minimal 16 karakter"),
  JOB_RUNNER_TOKEN: z.string().min(16, "JOB_RUNNER_TOKEN minimal 16 karakter"),
  AUTH_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),
  METRICS_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  SEED_OWNER_EMAIL: z.string().email().optional(),
  SEED_OWNER_PASSWORD: z.string().min(8).optional(),
  SEED_OWNER_NAME: z.string().min(1).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cache: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cache) return cache;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Konfigurasi environment tidak valid:\n${issues}`);
  }
  cache = parsed.data;
  return cache;
}

/** Dipakai oleh pemeriksaan kesehatan; tidak melempar. */
export function checkEnv(): { ok: boolean; missing: string[] } {
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success) return { ok: true, missing: [] };
  return {
    ok: false,
    missing: parsed.error.issues.map((i) => i.path.join(".") || "(root)"),
  };
}