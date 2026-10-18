import { prisma, type Tx } from "../../src/lib/db";
import type { Actor } from "../../src/lib/permissions";


/**
 * Helper pengujian untuk modul jaringan.
 *
 * Strategi isolasi: tiap test menjalankan operasinya di dalam transaksi
 * yang dilempar balik (rollback) — tidak ada data yang tertinggal di DB
 * bersama. Untuk operasi yang mengembalikan hasil, `runAndRollback`
 * mengembalikan hasilnya sementara seluruh tulisan dibatalkan.
 *
 * Catatan: `prisma.$transaction` dengan rollback harus dipanggil tanpa
 * `interactive` karena Prisma 6 membatalkan transaksi saat `fn` melempar.
 */

export const TEST_ACTOR: Actor = {
  kind: "user",
  userId: "test-user-id",
  label: "Penguji Otomatis",
  role: "OWNER",
};

export const SYSTEM_ACTOR = { kind: "system" as const, label: "test-job" };

/** ID user pengujian — harus ada di tabel User agar FK AuditLog terpenuhi. */
export const TEST_USER_ID = "test-user-id";

/**
 * Pastikan user pengujian ada (dibuat di luar transaksi rollback karena
 * banyak test memakai actorId ini di dalam transaksi).
 */
export async function ensureTestUser(): Promise<void> {
  await prisma.user.upsert({
    where: { id: TEST_USER_ID },
    create: {
      id: TEST_USER_ID,
      name: "Penguji Otomatis",
      email: "test-net@example.invalid",
      role: "OWNER",
      isActive: true,
      passwordHash: "dummy-hash",
    },

    update: {},
  });
}

/**
 * Versi rollback yang benar-benar melempar setelah menjalankan fn, sehingga
 * transaksi dibatalkan tetapi pemanggil tetap menerima hasilnya.
 */
export async function withRollback<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {

  let captured: { value: T } | null = null as { value: T } | null;

  let capturedError: unknown = null;
  await prisma.$transaction(async (tx) => {
    try {
      captured = { value: await fn(tx) };
    } catch (error) {
      capturedError = error;
    }
    // Rollback: lempar error sentinel yang selalu membatalkan transaksi.
    throw new RollbackSignal();
  }).catch((error) => {
    if (!(error instanceof RollbackSignal)) {
      throw error;
    }
  });
  if (capturedError) throw capturedError;
  if (!captured) throw new Error("withRollback tidak menangkap hasil");
  return captured.value;
}

class RollbackSignal extends Error {
  constructor() {
    super("rollback");
    this.name = "RollbackSignal";
  }
}

/** Bersihkan semua sisa data modul jaringan (untuk afterAll). */
export async function cleanupNetworkData(): Promise<void> {
  await prisma.interfaceMetric.deleteMany({});
  await prisma.routerMetric.deleteMany({});
  await prisma.pppoeSecret.deleteMany({});
  await prisma.pppoeSession.deleteMany({});
  await prisma.incident.deleteMany({});
  await prisma.alertRule.deleteMany({});
  await prisma.wanLink.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.router.deleteMany({});
  await prisma.auditLog.deleteMany({ where: { actorLabel: { in: [TEST_ACTOR.label, SYSTEM_ACTOR.label] } } });
}

/** `now()` tetap berada di dalam satu milidetik — untuk pengujian. */
export function now(): Date {
  return new Date();
}

/** Tanggal `secondsAgo` detik yang lalu. */
export function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1000);
}
