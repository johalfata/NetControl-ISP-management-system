import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? [{ emit: "event", level: "error" }]
        : [{ emit: "event", level: "error" }, { emit: "event", level: "warn" }],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type Tx = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

/**
 * Jalankan fungsi dalam transaksi dengan tingkat isolasi Serializable.
 * Dipakai untuk operasi keuangan/penomoran yang tidak boleh balapan.
 * `retry` menangani serialization failure dari PostgreSQL (40001 / P2034).
 */
export async function withSerializableTx<T>(
  fn: (tx: Tx) => Promise<T>,
  retries = 5,
): Promise<T> {
  let attempt = 0;
  // backoff deterministik: 20, 40, 60, 80, 100 ms
  for (;;) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: "Serializable",
        timeout: 20_000,
        maxWait: 10_000,
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
      const isSerializationFailure = code === "P2034" || code === "40001";
      attempt += 1;
      if (!isSerializationFailure || attempt > retries) throw error;
      await new Promise((r) => setTimeout(r, 20 * attempt));
    }
  }
}

export async function executeInTx<T>(
  client: Tx | typeof prisma,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if ("$transaction" in client && typeof (client as { $transaction: unknown }).$transaction === "function") {
    return withSerializableTx(fn);
  }
  return fn(client as Tx);
}