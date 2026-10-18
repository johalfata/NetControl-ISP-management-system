import { z } from "zod";
import { prisma, type Tx } from "../db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type Actor,
} from "../permissions";
import { recordAudit } from "../audit";
import type { Prisma, WanLink, WanType } from "@prisma/client";

/**
 * Manajemen link WAN (STARLINK / DEDICATED / OTHER) dan ringkasan
 * utilisasinya. `monthlyCostMinor` hanya disimpan di sini — perhitungan
 * laporan biaya operasional adalah domain service `finance`, bukan modul ini.
 *
 * Permission (diputuskan route handler, bukan di sini):
 * - `listWanLinks` / `wanUtilization`    → network.view
 * - `createWanLink`/`updateWanLink`/`deleteWanLink` → network.manage
 */

const WAN_TYPES: readonly WanType[] = ["STARLINK", "DEDICATED", "OTHER"];

export const createWanLinkSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Kode link WAN minimal 2 karakter")
    .max(40, "Kode link WAN maksimal 40 karakter")
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Kode link WAN hanya boleh alfanumerik, titik, strip, garis bawah"),
  name: z.string().trim().min(1, "Nama link WAN wajib diisi").max(120, "Nama link WAN maksimal 120 karakter"),
  type: z.enum(WAN_TYPES as unknown as [WanType, ...WanType[]]).default("OTHER"),
  routerId: z.string().min(1).optional(),
  interfaceName: z.string().trim().min(1).max(100).optional(),
  capacityDownKbps: z.number().int().min(0).max(10_000_000).optional(),
  capacityUpKbps: z.number().int().min(0).max(10_000_000).optional(),
  ipAddress: z.string().trim().max(64).optional(),
  provider: z.string().trim().max(120).optional(),
  latencyTargetHost: z.string().trim().max(200).optional(),
  monitorEnabled: z.boolean().default(true),
  note: z.string().trim().max(500, "Catatan maksimal 500 karakter").optional(),
});
export type CreateWanLinkInput = z.infer<typeof createWanLinkSchema>;

export const updateWanLinkSchema = createWanLinkSchema.partial();
export type UpdateWanLinkInput = z.infer<typeof updateWanLinkSchema>;

export type WanLinkView = {
  id: string;
  code: string;
  name: string;
  type: WanType;
  routerId: string | null;
  routerCode: string | null;
  interfaceName: string | null;
  capacityDownKbps: number | null;
  capacityUpKbps: number | null;
  ipAddress: string | null;
  provider: string | null;
  latencyTargetHost: string | null;
  monitorEnabled: boolean;
  isActive: boolean;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WanUtilizationPoint = {
  t: Date;
  rxbps: number;
  txbps: number;
  /** Persentase terhadap kapasitas download, bila kapasitas didefinisikan. */
  rxUtilizationPct: number | null;
  txUtilizationPct: number | null;
};

export type WanUtilizationSummary = {
  wanLinkId: string;
  code: string;
  name: string;
  capacityDownKbps: number | null;
  capacityUpKbps: number | null;
  from: Date;
  to: Date;
  points: WanUtilizationPoint[];
  /** Utilisasi rata-rata pada rentang waktu. */
  avgRxUtilizationPct: number | null;
  avgTxUtilizationPct: number | null;
  peakRxbps: number;
  peakTxbps: number;
};

const MILLIS = 1000;

function toView(row: WanLink & { router?: { code: string } | null }): WanLinkView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    routerId: row.routerId,
    routerCode: row.router?.code ?? null,
    interfaceName: row.interfaceName,
    capacityDownKbps: row.capacityDownKbps,
    capacityUpKbps: row.capacityUpKbps,
    ipAddress: row.ipAddress,
    provider: row.provider,
    latencyTargetHost: row.latencyTargetHost,
    monitorEnabled: row.monitorEnabled,
    isActive: row.isActive,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function findWanLinkOrThrow(id: string, client: Tx | typeof prisma): Promise<WanLink> {
  const link = await client.wanLink.findUnique({ where: { id } });
  if (!link) throw new NotFoundError(`Link WAN dengan id "${id}" tidak ditemukan`);
  return link;
}

export async function listWanLinks(
  client: Tx | typeof prisma = prisma,
): Promise<WanLinkView[]> {
  const rows = await client.wanLink.findMany({
    include: { router: { select: { code: true } } },
    orderBy: [{ code: "asc" }],
  });
  return rows.map(toView);
}

export async function getWanLink(
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<WanLinkView> {
  const row = await client.wanLink.findUnique({
    where: { id },
    include: { router: { select: { code: true } } },
  });
  if (!row) throw new NotFoundError(`Link WAN dengan id "${id}" tidak ditemukan`);
  return toView(row);
}

/**
 * Buat link WAN. `interfaceName` wajib diisi bila ingin dipakai
 * pencocokan metrik otomatis (lihat `metrics.pollRouter`).
 * Permission yang disarankan: `network.manage`.
 */
export async function createWanLink(
  actor: Actor,
  input: CreateWanLinkInput,
  client?: Tx,
): Promise<WanLinkView> {
  const parsed = createWanLinkSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input link WAN tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const data = parsed.data;

  if (data.routerId && data.interfaceName) {
    await assertInterfaceFree(data.routerId, data.interfaceName, prisma);
  }

  const run = async (tx: Tx): Promise<WanLinkView> => {
    const existing = await tx.wanLink.findUnique({ where: { code: data.code } });
    if (existing) throw new ConflictError(`Link WAN dengan kode "${data.code}" sudah ada`);

    if (data.routerId && data.interfaceName) {
      await assertInterfaceFree(data.routerId, data.interfaceName, tx);
    }

    const row = await tx.wanLink.create({
      data: {
        code: data.code,
        name: data.name,
        type: data.type,
        provider: data.provider,
        routerId: data.routerId,
        interfaceName: data.interfaceName,
        capacityDownKbps: data.capacityDownKbps,
        capacityUpKbps: data.capacityUpKbps,
        ipAddress: data.ipAddress,
        latencyTargetHost: data.latencyTargetHost,
        monitorEnabled: data.monitorEnabled,
        notes: data.note,
      },
      include: { router: { select: { code: true } } },
    });

    await recordAudit(
      actor,
      {
        action: "wan.create",
        entityType: "WanLink",
        entityId: row.id,
        metadata: {
          code: row.code,
          name: row.name,
          type: row.type,
          routerId: row.routerId,
          interfaceName: row.interfaceName,
          capacityDownKbps: row.capacityDownKbps,
          capacityUpKbps: row.capacityUpKbps,
          monitorEnabled: row.monitorEnabled,
        },
      },
      tx,
    );
    return toView(row);
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Perbarui link WAN. Bila `routerId`/`interfaceName` berubah, pastikan
 * kombinasi tersebut belum dipakai link WAN lain.
 * Permission yang disarankan: `network.manage`.
 */
export async function updateWanLink(
  actor: Actor,
  id: string,
  input: UpdateWanLinkInput,
  client?: Tx,
): Promise<WanLinkView> {
  const parsed = updateWanLinkSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input link WAN tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const data = parsed.data;

  const run = async (tx: Tx): Promise<WanLinkView> => {
    const current = await findWanLinkOrThrow(id, tx);

    const nextRouterId = data.routerId !== undefined ? data.routerId : current.routerId;
    const nextInterface = data.interfaceName !== undefined ? data.interfaceName : current.interfaceName;
    if (nextRouterId && nextInterface) {
      const taken = await tx.wanLink.findFirst({
        where: {
          routerId: nextRouterId,
          interfaceName: nextInterface,
          NOT: { id },
        },
        select: { id: true },
      });
      if (taken) {
        throw new ConflictError(
          `Interface "${nextInterface}" sudah dipakai link WAN lain pada router ini`,
        );
      }
    }

    if (data.code !== undefined && data.code !== current.code) {
      const conflict = await tx.wanLink.findUnique({ where: { code: data.code } });
      if (conflict) throw new ConflictError(`Link WAN dengan kode "${data.code}" sudah ada`);
    }

    const row = await tx.wanLink.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        type: data.type,
        provider: data.provider,
        routerId: data.routerId,
        interfaceName: data.interfaceName,
        capacityDownKbps: data.capacityDownKbps,
        capacityUpKbps: data.capacityUpKbps,
        ipAddress: data.ipAddress,
        latencyTargetHost: data.latencyTargetHost,
        monitorEnabled: data.monitorEnabled,
        notes: data.note,
      },
      include: { router: { select: { code: true } } },
    });

    await recordAudit(
      actor,
      {
        action: "wan.update",
        entityType: "WanLink",
        entityId: id,
        metadata: {
          code: row.code,
          name: row.name,
          type: row.type,
          routerId: row.routerId,
          interfaceName: row.interfaceName,
          capacityDownKbps: row.capacityDownKbps,
          capacityUpKbps: row.capacityUpKbps,
          monitorEnabled: row.monitorEnabled,
        },
      },
      tx,
    );
    return toView(row);
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Hapus link WAN. `InterfaceMetric.wanLinkId` di-set NULL otomatis
 * (onDelete: SetNull), jadi penghapusan tidak menghapus riwayat metrik.
 * Permission yang disarankan: `network.manage`.
 */
export async function deleteWanLink(
  actor: Actor,
  id: string,
  client?: Tx,
): Promise<{ id: string; code: string }> {
  const run = async (tx: Tx): Promise<{ id: string; code: string }> => {
    const link = await findWanLinkOrThrow(id, tx);
    await tx.wanLink.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: "wan.delete",
        entityType: "WanLink",
        entityId: id,
        metadata: { code: link.code, name: link.name },
      },
      tx,
    );
    return { id, code: link.code };
  };

  return client ? run(client) : prisma.$transaction(run);
}

async function assertInterfaceFree(
  routerId: string,
  interfaceName: string,
  client: Tx | typeof prisma,
): Promise<void> {
  const taken = await client.wanLink.findFirst({
    where: { routerId, interfaceName },
    select: { id: true },
  });
  if (taken) {
    throw new ConflictError(
      `Interface "${interfaceName}" sudah dipakai link WAN lain pada router ini`,
    );
  }
}

type RawUtilizationRow = {
  bucket: Date;
  rx_bytes: bigint | null;
  tx_bytes: bigint | null;
};

/**
 * Utilisasi link WAN dari `InterfaceMetric` yang terhubung via `wanLinkId`.
 *
 * Data mentek berupa byte counter kumulatif, maka tiap bucket dihitung
 * (MAX − MIN) dengan `date_bin` Postgres 14+, lalu diubah ke bit/detik dan
 * dibagi kapasitas link bila didefinisikan. READ-ONLY; permission: `network.view`.
 */
export async function wanUtilization(
  wanLinkId: string,
  opts: { from: Date; to: Date; granularitySec?: number },
  client: Tx | typeof prisma = prisma,
): Promise<WanUtilizationSummary> {
  const link = await findWanLinkOrThrow(wanLinkId, client);
  const from = opts.from;
  const to = opts.to;
  const granularitySec = opts.granularitySec ?? 300;

  if (from.getTime() > to.getTime()) {
    throw new ValidationError("`from` tidak boleh lebih besar dari `to`");
  }
  if (!Number.isInteger(granularitySec) || granularitySec < 60 || granularitySec > 86_400) {
    throw new ValidationError("Granularitas harus antara 60 detik dan 1 hari");
  }

  const rows = await client.$queryRaw<RawUtilizationRow[]>`
    WITH bucketed AS (
      SELECT
        date_bin(${granularitySec * MILLIS}, "capturedAt", TIMESTAMPTZ 'epoch') AS bucket,
        MIN("rxBytes") AS first_rx,
        MAX("rxBytes") AS last_rx,
        MIN("txBytes") AS first_tx,
        MAX("txBytes") AS last_tx
      FROM "InterfaceMetric"
      WHERE "wanLinkId" = ${wanLinkId}
        AND "capturedAt" >= ${from}
        AND "capturedAt" <= ${to}
      GROUP BY bucket
    )
    SELECT
      bucket,
      GREATEST(COALESCE(MAX("last_rx"), 0) - COALESCE(MIN("first_rx"), 0), 0) AS rx_bytes,
      GREATEST(COALESCE(MAX("last_tx"), 0) - COALESCE(MIN("first_tx"), 0), 0) AS tx_bytes
    FROM bucketed
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const points = rows.map((row) => {
    const rxbps = bps(row.rx_bytes, granularitySec);
    const txbps = bps(row.tx_bytes, granularitySec);
    return {
      t: row.bucket,
      rxbps,
      txbps,
      rxUtilizationPct: link.capacityDownKbps ? Math.min(100, (rxbps / 1000 / link.capacityDownKbps) * 100) : null,
      txUtilizationPct: link.capacityUpKbps ? Math.min(100, (txbps / 1000 / link.capacityUpKbps) * 100) : null,
    };
  });

  const avgRx = average(points.map((p) => p.rxUtilizationPct));
  const avgTx = average(points.map((p) => p.txUtilizationPct));

  return {
    wanLinkId,
    code: link.code,
    name: link.name,
    capacityDownKbps: link.capacityDownKbps,
    capacityUpKbps: link.capacityUpKbps,
    from,
    to,
    points,
    avgRxUtilizationPct: avgRx,
    avgTxUtilizationPct: avgTx,
    peakRxbps: points.reduce((max, p) => Math.max(max, p.rxbps), 0),
    peakTxbps: points.reduce((max, p) => Math.max(max, p.txbps), 0),
  };
}

function bps(bytes: bigint | null, windowSec: number): number {
  if (bytes === null) return 0;
  return Number((bytes * 8n * 1_000_000_000n) / BigInt(windowSec * MILLIS)) / 1_000_000_000;
}

function average(values: (number | null)[]): number | null {
  const defined = values.filter((v): v is number => v !== null);
  if (defined.length === 0) return null;
  return defined.reduce((sum, v) => sum + v, 0) / defined.length;
}

export type { Prisma };
