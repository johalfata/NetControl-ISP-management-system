import { z } from "zod";
import { prisma, type Tx } from "../db";
import {
  NotFoundError,
  ValidationError,
  type Actor,
  type AnyActor,
} from "../permissions";
import { recordAudit } from "../audit";
import { routerosClient, RouterOsError } from "../integrations/routeros/client";
import { readRouterApiPassword } from "./routers";
import type { Prisma, PppoeSession, Router } from "@prisma/client";

/**
 * Sesi & rahasia PPPoE.
 *
 * PEMISAHAN READ / CONTROL (diputuskan route handler, bukan di sini):
 *
 * - READ-ONLY (monitoring) — izin `routers.view`:
 *     `listActiveSessions`, `sessionOverview`, `reconcileSessions`
 * - CONTROL (mengubah jaringan) — izin `routers.control`:
 *     `disconnectSession`, `setPppoeState`
 *
 * Sumber data: `PppoeSession` adalah cache hasil polling terakhir
 * (lihat `metrics.pollRouter`), sehingga UI monitoring tidak melakukan
 * panggilan live ke router untuk setiap render.
 */

export const listActiveSessionsSchema = z.object({
  routerId: z.string().min(1).optional(),
  search: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export type ListActiveSessionsInput = z.input<typeof listActiveSessionsSchema>;

export const reconcileSessionsSchema = z.object({
  routerId: z.string().min(1, "routerId wajib diisi"),
});
export type ReconcileSessionsInput = z.infer<typeof reconcileSessionsSchema>;

export const disconnectSessionSchema = z.object({
  routerId: z.string().min(1, "routerId wajib diisi"),
  sessionId: z.string().optional(),
  username: z.string().trim().min(1, "username wajib diisi").optional(),
  reason: z.string().trim().min(1, "Alasan pemutusan wajib diisi").max(200, "Alasan maksimal 200 karakter"),
}).refine((v) => v.sessionId !== undefined || v.username !== undefined, {
  message: "sessionId atau username harus diisi",
});
export type DisconnectSessionInput = z.infer<typeof disconnectSessionSchema>;

export const setPppoeStateSchema = z.object({
  customerId: z.string().min(1, "customerId wajib diisi"),
  enabled: z.boolean(),
  reason: z.string().trim().max(200, "Alasan maksimal 200 karakter").optional(),
});
export type SetPppoeStateInput = z.infer<typeof setPppoeStateSchema>;

export type SessionView = {
  id: string;
  routerId: string;
  routerCode: string;
  routerName: string;
  sessionKey: string;
  username: string;
  service: string | null;
  callerId: string | null;
  address: string | null;
  uptimeSec: number | null;
  bytesIn: string;
  bytesOut: string;
  isActive: boolean;
  capturedAt: Date;
  /** Pelanggan yang cocok berdasarkan `pppoeUsername` (bisa null). */
  customerId: string | null;
  customerCode: string | null;
  customerName: string | null;
};

export type SessionOverview = {
  routerId: string;
  routerCode: string;
  routerName: string;
  activeSessions: number;
  totalSessions: number;
  matchedCustomers: number;
  lastCapturedAt: Date | null;
};

export type ReconcileResult = {
  routerId: string;
  routerCode: string;
  online: number;
  offline: number;
  unmatched: string[];
};

type SessionWithRouter = PppoeSession & { router: Router };

function toView(row: SessionWithRouter): Omit<SessionView, "customerId" | "customerCode" | "customerName"> {
  return {
    id: row.id,
    routerId: row.routerId,
    routerCode: row.router.code,
    routerName: row.router.name,
    sessionKey: row.sessionKey,
    username: row.username,
    service: row.service,
    callerId: row.callerId,
    address: row.address,
    uptimeSec: row.uptimeSec,
    bytesIn: row.bytesIn.toString(),
    bytesOut: row.bytesOut.toString(),
    isActive: row.isActive,
    capturedAt: row.capturedAt,
  };
}

async function findRouterOrThrow(id: string, client: Tx | typeof prisma): Promise<Router> {
  const router = await client.router.findUnique({ where: { id } });
  if (!router) throw new NotFoundError(`Router dengan id "${id}" tidak ditemukan`);
  return router;
}

/**
 * Daftar sesi PPPoE dari cache polling terakhir (tidak memanggil router).
 * READ-ONLY. Permission yang disarankan: `routers.view`.
 */
export async function listActiveSessions(
  _actor: AnyActor,
  input: ListActiveSessionsInput = {},
  client: Tx | typeof prisma = prisma,
): Promise<SessionView[]> {
  const parsed = listActiveSessionsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input sesi tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { routerId, search, isActive, limit } = parsed.data;

  const where: Prisma.PppoeSessionWhereInput = {};
  if (routerId) where.routerId = routerId;
  if (typeof isActive === "boolean") where.isActive = isActive;
  if (search) {
    where.OR = [
      { username: { contains: search, mode: "insensitive" } },
      { callerId: { contains: search, mode: "insensitive" } },
      { address: { contains: search, mode: "insensitive" } },
    ];
  }

  const rows = await client.pppoeSession.findMany({
    where,
    include: { router: true },
    orderBy: [{ isActive: "desc" }, { username: "asc" }],
    take: limit,
  });

  const usernames = rows.map((r) => r.username);
  const customers = await client.customer.findMany({
    where: { pppoeUsername: { in: usernames } },
    select: { id: true, code: true, name: true, pppoeUsername: true },
  });
  const customerByUsername = new Map(customers.map((c) => [c.pppoeUsername as string, c]));

  return rows.map((row) => {
    const customer = customerByUsername.get(row.username);
    return { ...toView(row), customerId: customer?.id ?? null, customerCode: customer?.code ?? null, customerName: customer?.name ?? null };
  });
}

/**
 * Ringkasan jumlah sesi per router dari cache polling.
 * READ-ONLY. Permission yang disarankan: `routers.view`.
 */
export async function sessionOverview(
  _actor: AnyActor,
  input: { routerId: string },
  client: Tx | typeof prisma = prisma,
): Promise<SessionOverview> {
  const parsed = reconcileSessionsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input overview tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { routerId } = parsed.data;
  const router = await findRouterOrThrow(routerId, client);

  const [active, total, last] = await Promise.all([
    client.pppoeSession.count({ where: { routerId, isActive: true } }),
    client.pppoeSession.count({ where: { routerId } }),
    client.pppoeSession.findFirst({
      where: { routerId },
      orderBy: { capturedAt: "desc" },
      select: { capturedAt: true },
    }),
  ]);

  const matched = await client.customer.count({
    where: { routerId, pppoeUsername: { not: null } },
  });

  return {
    routerId,
    routerCode: router.code,
    routerName: router.name,
    activeSessions: active,
    totalSessions: total,
    matchedCustomers: matched,
    lastCapturedAt: last?.capturedAt ?? null,
  };
}

/**
 * Cocokkan sesi PPPoE aktif (dari cache polling) dengan pelanggan via
 * `Customer.pppoeUsername`, dan tandai pelanggan online/offline.
 *
 * Status online/offline pelanggan disimpulkan dari keberadaan sesi aktif —
 * tidak ada kolom tersendiri di schema, sehingga hasil dikembalikan ke
 * pemanggil (UI/job) untuk dipakai. READ-ONLY; tidak mengubah konfigurasi
 * router. Permission yang disarankan: `routers.view`.
 */
export async function reconcileSessions(
  actor: AnyActor,
  input: ReconcileSessionsInput,
  client: Tx | typeof prisma = prisma,
): Promise<ReconcileResult & { customers: Array<{ id: string; code: string; name: string; pppoeUsername: string; online: boolean }> }> {
  const parsed = reconcileSessionsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input rekonsiliasi tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { routerId } = parsed.data;
  const router = await findRouterOrThrow(routerId, client);

  const [activeSessions, customers] = await Promise.all([
    client.pppoeSession.findMany({
      where: { routerId, isActive: true },
      select: { username: true },
    }),
    client.customer.findMany({
      where: { pppoeUsername: { not: null } },
      select: { id: true, code: true, name: true, pppoeUsername: true },
    }),
  ]);

  const activeUsernames = new Set(activeSessions.map((s) => s.username));
  const customersWithState = customers.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    pppoeUsername: c.pppoeUsername as string,
    online: activeUsernames.has(c.pppoeUsername as string),
  }));
  const online = customersWithState.filter((c) => c.online);
  const unmatched = activeSessions
    .map((s) => s.username)
    .filter((username) => !customers.some((c) => c.pppoeUsername === username));

  await recordAudit(
    actor,
    {
      action: "router.session.reconcile",
      entityType: "Router",
      entityId: routerId,
      metadata: {
        code: router.code,
        activeSessions: activeSessions.length,
        online: online.length,
        offline: customersWithState.length - online.length,
        unmatched,
      },
    },
    client,
  );

  return {
    routerId,
    routerCode: router.code,
    online: online.length,
    offline: customersWithState.length - online.length,
    unmatched,
    customers: customersWithState,
  };
}

async function connectToRouter(router: Router) {
  return routerosClient({
    host: router.host,
    port: router.apiPort,
    username: router.username,
    password: readRouterApiPassword(router),
    useTls: router.useTls,
  });
}

/**
 * Putuskan sesi PPPoE aktif dari router. Operasi KONTROL: mengubah keadaan
 * jaringan pelanggan secara langsung. Permission yang disarankan:
 * `routers.control`. Tidak boleh dipanggil dari alur read-only.
 */
export async function disconnectSession(
  actor: Actor,
  input: DisconnectSessionInput,
  client?: Tx,
): Promise<{ routerId: string; target: string }> {
  const parsed = disconnectSessionSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input pemutusan tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { routerId, sessionId, username, reason } = parsed.data;
  const target = username ?? sessionId ?? "";
  if (!target) throw new ValidationError("sessionId atau username harus diisi");

  const router = await findRouterOrThrow(routerId, prisma);

  let disconnected = false;
  let error: string | null = null;
  try {
    const ros = await connectToRouter(router);
    try {
      await ros.disconnectPppoeSession(target);
      disconnected = true;
    } finally {
      await ros.close();
    }
  } catch (err) {
    error = err instanceof RouterOsError ? `[${err.code}] ${err.message}` : err instanceof Error ? err.message : String(err);
  }

  // Catat sesi sebagai tidak aktif di cache bila router mengonfirmasi.
  if (disconnected) {
    await prisma.pppoeSession.updateMany({
      where: { routerId, OR: [{ sessionKey: target }, { username: target }], isActive: true },
      data: { isActive: false },
    });
  }

  await recordAudit(
    actor,
    {
      action: "router.session.disconnect",
      entityType: "PppoeSession",
      entityId: sessionId ?? target,
      metadata: {
        routerId,
        routerCode: router.code,
        username: target,
        reason,
        success: disconnected,
        error,
      },
    },
    client ?? prisma,
  );

  if (!disconnected) {
    throw new RouterOsError(
      "COMMAND_FAILED",
      `Gagal memutuskan sesi PPPoE "${target}" di router "${router.code}": ${error ?? "tidak diketahui"}`,
    );
  }
  return { routerId, target };
}

/**
 * Aktifkan/nonaktifkan rahasia PPPoE milik seorang pelanggan (isolir /
 * aktifkan kembali) pada router pelanggan tersebut. Operasi KONTROL.
 *
 * Router dipilih dari `Customer.routerId` (bukan dari input) agar pelanggan
 * tidak bisa diturunkan ke router lain secara tidak sengaja.
 * Permission yang disarankan: `routers.control`.
 */
export async function setPppoeState(
  actor: Actor,
  input: SetPppoeStateInput,
  client?: Tx,
): Promise<{ customerId: string; enabled: boolean }> {
  const parsed = setPppoeStateSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input status PPPoE tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { customerId, enabled, reason } = parsed.data;

  const run = async (tx: Tx): Promise<{ customerId: string; enabled: boolean }> => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      include: { router: true },
    });
    if (!customer) throw new NotFoundError(`Pelanggan dengan id "${customerId}" tidak ditemukan`);
    if (!customer.pppoeUsername) {
      throw new ValidationError(`Pelanggan "${customer.code}" tidak mempunyai username PPPoE`);
    }
    const router = customer.router;
    if (!router) {
      throw new ConfigurationRouterError(
        `Pelanggan "${customer.code}" tidak terikat ke router mana pun`,
      );
    }

    let applied = false;
    let error: string | null = null;
    try {
      const ros = await connectToRouter(router);
      try {
        if (enabled) {
          await ros.enablePppoeSecret(customer.pppoeUsername);
        } else {
          await ros.disablePppoeSecret(customer.pppoeUsername);
        }
        applied = true;
      } finally {
        await ros.close();
      }
    } catch (err) {
      error = err instanceof RouterOsError ? `[${err.code}] ${err.message}` : err instanceof Error ? err.message : String(err);
    }

    // Sinkronkan status rahasia lokal (cache dari router).
    await tx.pppoeSecret.upsert({
      where: { routerId_name: { routerId: router.id, name: customer.pppoeUsername } },
      create: {
        routerId: router.id,
        name: customer.pppoeUsername,
        disabled: !enabled,
        comment: reason ?? null,
        lastSyncedAt: new Date(),
      },
      update: { disabled: !enabled, comment: reason ?? null, lastSyncedAt: new Date() },
    });

    await recordAudit(
      actor,
      {
        action: enabled ? "pppoe.enable" : "pppoe.disable",
        entityType: "Customer",
        entityId: customerId,
        metadata: {
          customerId,
          customerCode: customer.code,
          pppoeUsername: customer.pppoeUsername,
          routerId: router.id,
          routerCode: router.code,
          reason: reason ?? null,
          success: applied,
          error,
        },
      },
      tx,
    );

    if (!applied) {
      throw new RouterOsError(
        "COMMAND_FAILED",
        `Gagal ${enabled ? "mengaktifkan" : "menonaktifkan"} rahasia PPPoE "${customer.pppoeUsername}" di router "${router.code}": ${error ?? "tidak diketahui"}`,
      );
    }
    return { customerId, enabled };
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Error spesifik: pelanggan tidak terikat ke router. Tetap memakai kelas
 * domain agar route handler bisa membedakan 404 / 409 / 500.
 */
class ConfigurationRouterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationRouterError";
  }
}

export { ConfigurationRouterError as RouterNotLinkedError };
