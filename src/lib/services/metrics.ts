import { z } from "zod";
import { prisma, type Tx } from "../db";
import { NotFoundError, ValidationError, type AnyActor } from "../permissions";
import { recordAudit } from "../audit";
import { routerosClient, RouterOsError, type RouterOsInterfaceTraffic } from "../integrations/routeros/client";
import { readRouterApiPassword } from "./routers";

/**
 * Polling & retensi telemetri router.
 *
 * - `pollRouter` membaca `/interface/print` + `/ppp/active/print` (READ-ONLY)
 *   `PppoeSession` dari hasil polling terakhir (cache untuk UI).
 * - Agregasi deret waktu memakai `date_bin` (Postgres 14+) via
 *   `prisma.$queryRaw`, sehingga pengelompokan dilakukan server-side dan
 *   tidak membawa semua titik data ke aplikasi.
 *
 * Permission (diputuskan route handler):
 * - `pollRouter` / `pruneMetrics`      → jobs.run (job terjadwal) atau routers.view
 * - `metricSeries` / `latestMetrics`   → routers.view / network.view
 */

const MILLIS = 1000;

export const metricSeriesSchema = z.object({
  routerId: z.string().min(1, "routerId wajib diisi"),
  interfaceName: z.string().trim().min(1, "interfaceName wajib diisi"),
  from: z.coerce.date(),
  to: z.coerce.date(),
  granularitySec: z.number().int().min(60, "Granularitas minimal 60 detik").max(86_400, "Granularitas maksimal 1 hari").default(300),
});
export type MetricSeriesInput = z.input<typeof metricSeriesSchema>;

export type MetricPoint = {
  t: Date;
  rxbps: number;
  txbps: number;
};

export type LatestMetrics = {
  routerId: string;
  capturedAt: Date | null;
  activeSessions: number | null;
  cpuLoadPct: number | null;
  freeMemoryPct: number | null;
  uptimeSec: number | null;
  interfaces: {
    interfaceName: string;
    wanLinkId: string | null;
    capturedAt: Date;
    rxBytes: string | null;
    txBytes: string | null;
    rxRateBps: string | null;
    txRateBps: string | null;
    linkUp: boolean | null;
    latencyMs: number | null;
    packetLossPct: number | null;
  }[];
};

export type PollResult = {
  routerId: string;
  capturedAt: Date;
  interfaces: number;
  sessions: number;
  stale: boolean;
  error: string | null;
};

function toBps(bytes: bigint | number | null, windowSec: number): number {
  if (bytes === null) return 0;
  const bits = BigInt(bytes) * 8n;
  return Number((bits * 1_000_000_000n) / BigInt(windowSec * MILLIS)) / 1_000_000_000;
}

async function findRouterOrThrow(id: string, client: Tx | typeof prisma) {
  const router = await client.router.findUnique({ where: { id } });
  if (!router) throw new NotFoundError(`Router dengan id "${id}" tidak ditemukan`);
  return router;
}

/**
 * Ambil telemetri dari router dan simpan ke DB.
 *
 * Stale detection: bila selisih waktu antara metrik yang baru saja disimpan
 * dengan `lastCheckedAt` melebihi `routerPollIntervalSec` (dari setting
 * `monitoring.routerPollIntervalSec` atau `Router.pollIntervalSec`), poll
 * ditandai `stale` — sinyal bahwa router tidak terjangkau tepat waktu.
 *
 * READ-ONLY terhadap router: tidak ada perintah yang mengubah konfigurasi.
 */
export async function pollRouter(
  actor: AnyActor,
  routerId: string,
  opts: { pollIntervalSec?: number } = {},
  client: Tx | typeof prisma = prisma,
): Promise<PollResult> {
  const router = await findRouterOrThrow(routerId, client);
  if (!router.isActive) {
    return {
      routerId,
      capturedAt: new Date(),
      interfaces: 0,
      sessions: 0,
      stale: false,
      error: "Monitoring router dinonaktifkan",
    };
  }

  const password = readRouterApiPassword(router);
  const capturedAt = new Date();
  let interfaceRows: RouterOsInterfaceTraffic[] = [];
  let activeSessions = 0;
  let error: string | null = null;

  try {
    const ros = routerosClient({
      host: router.host,
      port: router.apiPort,
      username: router.username,
      password,
      useTls: router.useTls,
    });
    try {
      const [traffic, active] = await Promise.all([
        ros.interfaceTraffic(),
        ros.pppoeActive(),
      ]);
      interfaceRows = traffic;
      activeSessions = active.length;
      await syncSessions(routerId, active, client, capturedAt);
    } finally {
      await ros.close();
    }
  } catch (err) {
    error = err instanceof RouterOsError ? `[${err.code}] ${err.message}` : err instanceof Error ? err.message : String(err);
  }

  const wanLinks = await client.wanLink.findMany({
    where: { routerId, interfaceName: { not: null } },
    select: { id: true, interfaceName: true, capacityDownKbps: true },
  });
  const wanByInterface = new Map(wanLinks.map((w) => [w.interfaceName as string, w.id]));

  await Promise.all(
    interfaceRows.map((row) =>
      client.interfaceMetric.upsert({
        where: {
          routerId_interfaceName_capturedAt: {
            routerId,
            interfaceName: row.name,
            capturedAt,
          },
        },
        create: {
          routerId,
          wanLinkId: wanByInterface.get(row.name) ?? null,
          interfaceName: row.name,
          capturedAt,
          rxBytes: row.rxBytes,
          txBytes: row.txBytes,
          rxRateBps: row.rxRateBps,
          txRateBps: row.txRateBps,
          linkUp: row.linkUp,
        },
        update: {
          wanLinkId: wanByInterface.get(row.name) ?? null,
          rxBytes: row.rxBytes,
          txBytes: row.txBytes,
          rxRateBps: row.rxRateBps,
          txRateBps: row.txRateBps,
          linkUp: row.linkUp,
        },
      }),
    ),
  );

  await client.routerMetric.create({
    data: {
      routerId,
      capturedAt,
      activeSessions,
      uptimeSec: null,
      rxBytes: interfaceRows.reduce((sum, r) => sum + r.rxBytes, 0n),
      txBytes: interfaceRows.reduce((sum, r) => sum + r.txBytes, 0n),
    },
  });

  const intervalSec = opts.pollIntervalSec ?? router.pollIntervalSec;
  const stale = error === null && router.lastCheckedAt !== null
    ? capturedAt.getTime() - router.lastCheckedAt.getTime() > (intervalSec + 30) * MILLIS
    : false;

  await client.router.update({
    where: { id: routerId },
    data: {
      lastCheckedAt: capturedAt,
      lastStatus: error === null ? "UP" : "DOWN",
      lastError: error,
      identity: router.identity,
    },
  });

  await recordAudit(
    actor,
    {
      action: "router.poll",
      entityType: "Router",
      entityId: routerId,
      metadata: {
        code: router.code,
        interfaces: interfaceRows.length,
        sessions: activeSessions,
        stale,
        error,
      },
    },
    client,
  );

  return {
    routerId,
    capturedAt,
    interfaces: interfaceRows.length,
    sessions: activeSessions,
    stale,
    error,
  };
}

/** Sinkronkan tabel `PppoeSession` (cache hasil polling terakhir). */
async function syncSessions(
  routerId: string,
  active: { name: string; service: string; callerId: string | null; address: string | null; uptimeSec: number; rxBytes: bigint; txBytes: bigint }[],
  client: Tx | typeof prisma,
  capturedAt: Date,
): Promise<void> {
  const keys = active.map((a) => a.name);
  await client.pppoeSession.updateMany({
    where: { routerId, isActive: true, sessionKey: { notIn: keys } },
    data: { isActive: false },
  });
  await Promise.all(
    active.map((row) =>
      client.pppoeSession.upsert({
        where: { routerId_sessionKey: { routerId, sessionKey: row.name } },
        create: {
          routerId,
          sessionKey: row.name,
          username: row.name,
          service: row.service,
          callerId: row.callerId,
          address: row.address,
          uptimeSec: row.uptimeSec,
          bytesIn: row.rxBytes,
          bytesOut: row.txBytes,
          isActive: true,
          capturedAt,
        },
        update: {
          service: row.service,
          callerId: row.callerId,
          address: row.address,
          uptimeSec: row.uptimeSec,
          bytesIn: row.rxBytes,
          bytesOut: row.txBytes,
          isActive: true,
          capturedAt,
        },
      }),
    ),
  );
}

/**
 * Hapus metrik yang lebih lama dari `metricsRetentionDays` (setelan
 * `monitoring.metricsRetentionDays`, default 90 hari).
 */
export async function pruneMetrics(
  retentionDays = 90,
  client: Tx | typeof prisma = prisma,
): Promise<{ interfaceMetrics: number; routerMetrics: number }> {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new ValidationError("Retensi metrik harus bilangan bulat positif");
  }
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * MILLIS);
  const [interfaceMetrics, routerMetrics] = await Promise.all([
    client.interfaceMetric.deleteMany({ where: { capturedAt: { lt: cutoff } } }),
    client.routerMetric.deleteMany({ where: { capturedAt: { lt: cutoff } } }),
  ]);
  return {
    interfaceMetrics: interfaceMetrics.count,
    routerMetrics: routerMetrics.count,
  };
}

type RawSeriesRow = {
  bucket: Date;
  rx_bytes: bigint | null;
  tx_bytes: bigint | null;
};

/**
 * Deret waktu teragregasi untuk chart bandwidth (bits per detik).
 *
 * Agregasi memakai `date_bin` Postgres 14+: titik data dikelompokkan ke
 * bucket lebar `granularitySec`, dan setiap bucket mengambil *naikannya*
 * (MAX − MIN) sebagai jumlah byte yang lewat, lalu dibagi lebar bucket.
 * Bucket kosong tidak dikembalikan (chart menampilkan celah).
 */
export async function metricSeries(
  input: MetricSeriesInput,
  client: Tx | typeof prisma = prisma,
): Promise<MetricPoint[]> {
  const parsed = metricSeriesSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input deret metrik tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { routerId, interfaceName, from, to, granularitySec } = parsed.data;
  if (from.getTime() > to.getTime()) {
    throw new ValidationError("`from` tidak boleh lebih besar dari `to`");
  }

  const rows = await client.$queryRaw<RawSeriesRow[]>`
    WITH bucketed AS (
      SELECT
        date_bin(${granularitySec * MILLIS}, "capturedAt", TIMESTAMPTZ 'epoch') AS bucket,
        MIN("rxBytes") AS first_rx,
        MAX("rxBytes") AS last_rx,
        MIN("txBytes") AS first_tx,
        MAX("txBytes") AS last_tx
      FROM "InterfaceMetric"
      WHERE "routerId" = ${routerId}
        AND "interfaceName" = ${interfaceName}
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

  return rows.map((row) => {
    // Hitung dari byte counter kumulatif; reset counter router dianggap nol.
    const windowSec = granularitySec;
    return {
      t: row.bucket,
      rxbps: toBps(row.rx_bytes, windowSec),
      txbps: toBps(row.tx_bytes, windowSec),
    };
  });
}

/** Metrik paling baru per interface untuk satu router (untuk dashboard). */
export async function latestMetrics(
  routerId: string,
  client: Tx | typeof prisma = prisma,
): Promise<LatestMetrics> {
  const router = await client.router.findUnique({ where: { id: routerId } });
  if (!router) throw new NotFoundError(`Router dengan id "${routerId}" tidak ditemukan`);

  const interfaceRows = await client.interfaceMetric.findMany({
    where: { routerId },
    orderBy: [{ interfaceName: "asc" }, { capturedAt: "desc" }],
    distinct: ["interfaceName"],
  });

  const latestRouterMetric = await client.routerMetric.findFirst({
    where: { routerId },
    orderBy: { capturedAt: "desc" },
  });

  return {
    routerId,
    capturedAt: latestRouterMetric?.capturedAt ?? null,
    activeSessions: latestRouterMetric?.activeSessions ?? null,
    cpuLoadPct: null,
    freeMemoryPct: null,
    uptimeSec: latestRouterMetric?.uptimeSec ?? null,
    interfaces: interfaceRows.map((row) => ({
      interfaceName: row.interfaceName,
      wanLinkId: row.wanLinkId,
      capturedAt: row.capturedAt,
      rxBytes: row.rxBytes === null ? null : row.rxBytes.toString(),
      txBytes: row.txBytes === null ? null : row.txBytes.toString(),
      rxRateBps: row.rxRateBps === null ? null : row.rxRateBps.toString(),
      txRateBps: row.txRateBps === null ? null : row.txRateBps.toString(),
      linkUp: row.linkUp,
      latencyMs: row.latencyMs,
      packetLossPct: row.packetLossPct,
    })),
  };
}
