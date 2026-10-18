import { z } from "zod";
import { prisma, type Tx } from "../db";
import { openSecret, sealSecret, secretFingerprint } from "../crypto";
import {
  ConfigurationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  type Actor,
} from "../permissions";
import { recordAudit } from "../audit";
import type { DeviceStatus, Router } from "@prisma/client";

/**
 * CRUD router MikroTik + ringkasan kesehatan.
 *
 * PENYIMPANAN KREDENSIAL: password API disimpan terenkripsi (AES-256-GCM)
 * langsung pada baris Router di kolom `secretCiphertext` / `secretIv` /
 * `secretAuthTag`, beserta `secretFingerprint` non-rahasia. Schema memang
 * menyediakan kolom tersebut, sehingga tidak perlu memakai tabel
 * SecretSetting (yang dipakai untuk integrasi global seperti Fonnte) —
 * kredensial ini terikat 1:1 ke router dan ikut terhapus saat router dihapus.
 *
 * Permission (diputuskan route handler, bukan di sini):
 * - `listRouters` / `getRouter` / `routerHealth`          → routers.view
 * - `createRouter` / `updateRouter` / `deleteRouter` /
 *   `toggleRouterMonitoring` / `setRouterApiPassword`      → routers.manage
 */

export const createRouterSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Kode router minimal 2 karakter")
    .max(40, "Kode router maksimal 40 karakter")
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Kode router hanya boleh alfanumerik, titik, strip, garis bawah"),
  name: z.string().trim().min(1, "Nama router wajib diisi").max(120, "Nama router maksimal 120 karakter"),
  host: z
    .string()
    .trim()
    .min(1, "Host router wajib diisi")
    .max(200, "Host router maksimal 200 karakter"),
  apiPort: z.number().int().min(1, "Port minimal 1").max(65535, "Port maksimal 65535").default(8728),
  username: z.string().trim().min(1, "Username API wajib diisi").max(120, "Username API maksimal 120 karakter"),
  apiPassword: z.string().min(1, "Password API wajib diisi").max(256, "Password API maksimal 256 karakter"),
  useTls: z.boolean().default(false),
  isMonitoringEnabled: z.boolean().default(true),
  pollIntervalSec: z
    .number()
    .int()
    .min(15, "Interval polling minimal 15 detik")
    .max(3600, "Interval polling maksimal 3600 detik")
    .default(60),
  note: z.string().trim().max(500, "Catatan maksimal 500 karakter").optional(),
});
export type CreateRouterInput = z.infer<typeof createRouterSchema>;

export const updateRouterSchema = createRouterSchema
  .partial()
  .extend({
    // Password opsional saat update: tidak diisi = tidak diubah.
    apiPassword: z.string().min(1).max(256).optional(),
  });
export type UpdateRouterInput = z.infer<typeof updateRouterSchema>;

export type RouterView = {
  id: string;
  code: string;
  name: string;
  host: string;
  apiPort: number;
  username: string;
  useTls: boolean;
  isMonitoringEnabled: boolean;
  pollIntervalSec: number;
  note: string | null;
  lastStatus: DeviceStatus;
  lastCheckedAt: Date | null;
  lastError: string | null;
  identity: string | null;
  version: string | null;
  uptimeSec: number | null;
  hasApiPassword: boolean;
  customerCount: number;
  activeSessionCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type RouterHealthSummary = {
  id: string;
  code: string;
  name: string;
  host: string;
  /** Status terakhir yang tersimpan di DB. */
  lastStatus: DeviceStatus;
  /** Status efektif setelah pemeriksaan data basi (stale). */
  effectiveStatus: DeviceStatus;
  isStale: boolean;
  lastCheckedAt: Date | null;
  lastError: string | null;
  identity: string | null;
  version: string | null;
  uptimeSec: number | null;
};

function toView(row: Router & { _count?: { customers: number; sessions: number } }): RouterView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    host: row.host,
    apiPort: row.apiPort,
    username: row.username,
    useTls: row.useTls,
    isMonitoringEnabled: row.isActive,
    pollIntervalSec: row.pollIntervalSec,
    note: row.notes,
    lastStatus: row.lastStatus,
    lastCheckedAt: row.lastCheckedAt,
    lastError: row.lastError,
    identity: row.identity,
    version: row.version,
    uptimeSec: row.uptimeSec,
    hasApiPassword: row.secretCiphertext !== null,
    customerCount: row._count?.customers ?? 0,
    activeSessionCount: row._count?.sessions ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findRouterOrThrow(id: string, client: Tx | typeof prisma): Promise<Router> {
  const router = await client.router.findUnique({ where: { id } });
  if (!router) throw new NotFoundError(`Router dengan id "${id}" tidak ditemukan`);
  return router;
}

export async function listRouters(
  client: Tx | typeof prisma = prisma,
): Promise<RouterView[]> {
  const rows = await client.router.findMany({
    include: { _count: { select: { customers: true, sessions: true } } },
    orderBy: [{ code: "asc" }],
  });
  return rows.map(toView);
}

export async function getRouter(
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<RouterView> {
  const row = await client.router.findUnique({
    where: { id },
    include: { _count: { select: { customers: true, sessions: true } } },
  });
  if (!row) throw new NotFoundError(`Router dengan id "${id}" tidak ditemukan`);
  return toView(row);
}

/**
 * Buat router baru beserta kredensial API terenkripsi.
 * Permission yang disarankan: `routers.manage`.
 */
export async function createRouter(
  actor: Actor,
  input: CreateRouterInput,
  client?: Tx,
): Promise<RouterView> {
  const parsed = createRouterSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input router tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const data = parsed.data;

  const run = async (tx: Tx): Promise<RouterView> => {
    const existing = await tx.router.findUnique({ where: { code: data.code } });
    if (existing) {
      throw new ConflictError(`Router dengan kode "${data.code}" sudah ada`);
    }

    const sealed = sealSecret(data.apiPassword);
    const row = await tx.router.create({
      data: {
        code: data.code,
        name: data.name,
        host: data.host,
        apiPort: data.apiPort,
        username: data.username,
        useTls: data.useTls,
        secretCiphertext: sealed.ciphertext,
        secretIv: sealed.iv,
        secretAuthTag: sealed.authTag,
        secretFingerprint: secretFingerprint(data.apiPassword),
        isActive: data.isMonitoringEnabled,
        pollIntervalSec: data.pollIntervalSec,
        notes: data.note,
      },
      include: { _count: { select: { customers: true, sessions: true } } },
    });

    await recordAudit(
      actor,
      {
        action: "router.create",
        entityType: "Router",
        entityId: row.id,
        // password tidak pernah disertakan; fingerprint cukup untuk pelacakan.
        metadata: {
          code: row.code,
          name: row.name,
          host: row.host,
          apiPort: row.apiPort,
          username: row.username,
          useTls: row.useTls,
          pollIntervalSec: row.pollIntervalSec,
          isActive: row.isActive,
        },
      },
      tx,
    );
    return toView(row);
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Perbarui router. `apiPassword` kosong/tidak diisi berarti password lama
 * dipertahankan. Permission yang disarankan: `routers.manage`.
 */
export async function updateRouter(
  actor: Actor,
  id: string,
  input: UpdateRouterInput,
  client?: Tx,
): Promise<RouterView> {
  const parsed = updateRouterSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input router tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const data = parsed.data;

  const run = async (tx: Tx): Promise<RouterView> => {
    const current = await findRouterOrThrow(id, tx);

    if (data.code !== undefined && data.code !== current.code) {
      const conflict = await tx.router.findUnique({ where: { code: data.code } });
      if (conflict) {
        throw new ConflictError(`Router dengan kode "${data.code}" sudah ada`);
      }
    }

    const sealed =
      data.apiPassword !== undefined && data.apiPassword.length > 0
        ? sealSecret(data.apiPassword)
        : null;

    const row = await tx.router.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        host: data.host,
        apiPort: data.apiPort,
        username: data.username,
        useTls: data.useTls,
        secretCiphertext: sealed ? sealed.ciphertext : undefined,
        secretIv: sealed ? sealed.iv : undefined,
        secretAuthTag: sealed ? sealed.authTag : undefined,
        secretFingerprint: sealed ? secretFingerprint(data.apiPassword as string) : undefined,
        isActive: data.isMonitoringEnabled,
        pollIntervalSec: data.pollIntervalSec,
        notes: data.note,
      },
      include: { _count: { select: { customers: true, sessions: true } } },
    });

    await recordAudit(
      actor,
      {
        action: "router.update",
        entityType: "Router",
        entityId: id,
        metadata: {
          code: row.code,
          name: row.name,
          host: row.host,
          apiPort: row.apiPort,
          username: row.username,
          useTls: row.useTls,
          pollIntervalSec: row.pollIntervalSec,
          isActive: row.isActive,
          passwordChanged: sealed !== null,
        },
      },
      tx,
    );
    return toView(row);
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Hapus router. Ditolak bila masih ada pelanggan atau langganan yang
 * merujuk router ini (relasi `Customer.routerId`). Permission: `routers.manage`.
 */
export async function deleteRouter(
  actor: Actor,
  id: string,
  client?: Tx,
): Promise<{ id: string; code: string }> {
  const run = async (tx: Tx): Promise<{ id: string; code: string }> => {
    const router = await findRouterOrThrow(id, tx);

    const [customerCount, sessionCount] = await Promise.all([
      tx.customer.count({ where: { routerId: id } }),
      tx.pppoeSession.count({ where: { routerId: id } }),
    ]);
    if (customerCount > 0) {
      throw new ConflictError(
        `Router "${router.code}" tidak dapat dihapus: masih terikat ke ${customerCount} pelanggan`,
      );
    }
    if (sessionCount > 0) {
      throw new ConflictError(
        `Router "${router.code}" tidak dapat dihapus: masih ada ${sessionCount} sesi PPPoE tercatat`,
      );
    }

    await tx.router.delete({ where: { id } });
    await recordAudit(
      actor,
      { action: "router.delete", entityType: "Router", entityId: id, metadata: { code: router.code, name: router.name } },
      tx,
    );
    return { id, code: router.code };
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Aktifkan/matikan monitoring (field `isActive` pada Router).
 * Permission yang disarankan: `routers.manage`.
 */
export async function toggleRouterMonitoring(
  actor: Actor,
  id: string,
  enabled: boolean,
  client?: Tx,
): Promise<RouterView> {
  const run = async (tx: Tx): Promise<RouterView> => {
    const current = await findRouterOrThrow(id, tx);
    const row = await tx.router.update({
      where: { id },
      data: { isActive: enabled },
      include: { _count: { select: { customers: true, sessions: true } } },
    });
    await recordAudit(
      actor,
      {
        action: "router.monitoring.toggle",
        entityType: "Router",
        entityId: id,
        metadata: { code: current.code, enabled },
      },
      tx,
    );
    return toView(row);
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Ganti password API router saja (tidak menyentuh field lain).
 * Permission yang disarankan: `routers.manage`.
 */
export async function setRouterApiPassword(
  actor: Actor,
  id: string,
  apiPassword: string,
  client?: Tx,
): Promise<void> {
  if (apiPassword.length === 0) {
    throw new ValidationError("Password API tidak boleh kosong");
  }
  const run = async (tx: Tx): Promise<void> => {
    const current = await findRouterOrThrow(id, tx);
    const sealed = sealSecret(apiPassword);
    await tx.router.update({
      where: { id },
      data: {
        secretCiphertext: sealed.ciphertext,
        secretIv: sealed.iv,
        secretAuthTag: sealed.authTag,
        secretFingerprint: secretFingerprint(apiPassword),
      },
    });
    await recordAudit(
      actor,
      {
        action: "router.credential.update",
        entityType: "Router",
        entityId: id,
        // Jangan sertakan password; fingerprint saja.
        metadata: { code: current.code, fingerprint: secretFingerprint(apiPassword) },
      },
      tx,
    );
  };

  if (client) await run(client);
  else await prisma.$transaction(run);
}

/**
 * Baca password API terenkripsi dari baris Router. Khusus server-side
 * (service polling / tes koneksi). Tidak pernah dikembalikan ke UI.
 */
export function readRouterApiPassword(router: Router): string {
  if (!router.secretCiphertext || !router.secretIv || !router.secretAuthTag) {
    throw new ConfigurationError(
      `Router "${router.code}" belum mempunyai kredensial API. Buka halaman router untuk mengisinya.`,
    );
  }
  try {
    return openSecret({
      ciphertext: router.secretCiphertext,
      iv: router.secretIv,
      authTag: router.secretAuthTag,
    });
  } catch (error) {
    throw new ConfigurationError(
      `Gagal mendekripsi kredensial router "${router.code}". ENCRYPTION_KEY mungkin berubah: ${
        error instanceof Error ? error.message : "tidak diketahui"
      }`,
    );
  }
}

/**
 * Ringkasan kesehatan satu router dengan deteksi data basi.
 *
 * Aturan stale: bila `lastCheckedAt` lebih tua dari `staleThresholdSec`
 * (setelan `monitoring.staleThresholdSec`, default 300 dtk), status efektif
 * dianggap `UNKNOWN` karena data sudah tidak dapat dipercaya.
 */
export async function routerHealth(
  id: string,
  opts: { staleThresholdSec?: number } = {},
  client: Tx | typeof prisma = prisma,
): Promise<RouterHealthSummary> {
  const router = await findRouterOrThrow(id, client);
  const thresholdSec = opts.staleThresholdSec ?? 300;

  const isStale = (() => {
    if (!router.lastCheckedAt) return true;
    return Date.now() - router.lastCheckedAt.getTime() > thresholdSec * 1000;
  })();

  return {
    id: router.id,
    code: router.code,
    name: router.name,
    host: router.host,
    lastStatus: router.lastStatus,
    effectiveStatus: isStale ? "UNKNOWN" : router.lastStatus,
    isStale,
    lastCheckedAt: router.lastCheckedAt,
    lastError: router.lastError,
    identity: router.identity,
    version: router.version,
    uptimeSec: router.uptimeSec,
  };
}
