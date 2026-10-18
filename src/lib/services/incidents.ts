import { z } from "zod";
import { prisma, type Tx } from "../db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type Actor,
  type AnyActor,
} from "../permissions";
import { recordAudit } from "../audit";
import { matchesComparator, type Comparator } from "./alerts";
import type { Incident, IncidentType, Severity } from "@prisma/client";
import { Prisma } from "@prisma/client";

/**
 * Insiden jaringan + evaluasi aturan alert.
 *
 * DEDUPE ADA DUA LAPIS:
 * 1. `openIncident` menerima `dedupeKey` unik. Bila kunci tersebut sudah
 *    dipakai (unik di tabel Incident), incident tidak dibuat ulang —
 *    upsert mengembalikan record lama. Kunci ini juga dipakai
 *    `evaluateAlerts` agar satu rule+target hanya punya satu incident terbuka.
 * 2. `evaluateAlerts` memeriksa `cooldownMin`: incident untuk rule+target
 *    yang sama tidak dibuat bila masih dalam jeda waktu sejak incident
 *    terakhir, meskipun kunci dedupe sudah dihapus.
 *
 * Tiket helpdesk TIDAK dibuat otomatis di sini — modul helpdesk yang
 * mengurusnya (lihat setting `monitoring.autoCreateTickets`).
 *
 * Permission (diputuskan route handler):
 * - `listIncidents` / `getIncident`              → network.view
 * - `acknowledgeIncident` / `resolveIncident`    → network.manage
 * - `openIncident` / `evaluateAlerts`            → jobs.run (sistem) atau network.manage
 */

const MILLIS = 1000;

const INCIDENT_TYPES: readonly IncidentType[] = [
  "DEVICE_DOWN",
  "WAN_DOWN",
  "HIGH_LATENCY",
  "HIGH_UTILIZATION",
  "OPTICAL_DEGRADED",
  "OTHER",
];

const SEVERITIES: readonly Severity[] = ["INFO", "WARNING", "CRITICAL"];

export const listIncidentsSchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
  type: z.enum(INCIDENT_TYPES as unknown as [IncidentType, ...IncidentType[]]).optional(),
  severity: z.enum(SEVERITIES as unknown as [Severity, ...Severity[]]).optional(),
  subjectType: z.string().trim().min(1).optional(),
  subjectId: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
export type ListIncidentsInput = z.input<typeof listIncidentsSchema>;

export const openIncidentSchema = z.object({
  type: z.enum(INCIDENT_TYPES as unknown as [IncidentType, ...IncidentType[]]),
  severity: z.enum(SEVERITIES as unknown as [Severity, ...Severity[]]).default("WARNING"),
  subjectType: z.string().trim().min(1, "subjectType wajib diisi").max(60),
  subjectId: z.string().trim().max(60).optional(),
  title: z.string().trim().min(1, "Judul insiden wajib diisi").max(200, "Judul insiden maksimal 200 karakter"),
  description: z.string().trim().max(2000, "Deskripsi insiden maksimal 2000 karakter").optional(),
  dedupeKey: z.string().trim().min(1).max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type OpenIncidentInput = z.infer<typeof openIncidentSchema>;

export const resolveIncidentSchema = z.object({
  resolution: z
    .string()
    .trim()
    .min(1, "Resolusi wajib diisi")
    .max(2000, "Resolusi maksimal 2000 karakter"),
});
export type ResolveIncidentInput = z.infer<typeof resolveIncidentSchema>;

export const evaluateAlertsSchema = z.object({
  asOf: z.coerce.date().optional(),
});
export type EvaluateAlertsInput = z.infer<typeof evaluateAlertsSchema>;

export type IncidentView = Incident;

export type IncidentPage = {
  items: IncidentView[];
  total: number;
  page: number;
  pageSize: number;
};

export type AlertEvaluation = {
  ruleId: string;
  code: string;
  name: string;
  subjectType: string;
  subjectId: string | null;
  metric: number;
  threshold: number;
  comparator: Comparator;
  triggered: boolean;
  incidentId: string | null;
  /** Alasan tidak memicu: cooldown, belum ada insiden, atau di bawah ambang. */
  skippedReason: string | null;
};

export type EvaluateAlertsResult = {
  asOf: Date;
  evaluations: AlertEvaluation[];
  created: Incident[];
};

function parseList(input: ListIncidentsInput) {
  const parsed = listIncidentsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input daftar insiden tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}

/**
 * Daftar insiden dengan filter + paginasi. READ-ONLY.
 * Permission yang disarankan: `network.view`.
 */
export async function listIncidents(
  input: ListIncidentsInput = {},
  client: Tx | typeof prisma = prisma,
): Promise<IncidentPage> {
  const data = parseList(input);

  const where: Prisma.IncidentWhereInput = {};
  if (data.status) where.status = data.status;
  if (data.type) where.type = data.type;
  if (data.severity) where.severity = data.severity;
  if (data.subjectType) where.subjectType = data.subjectType;
  if (data.subjectId) where.subjectId = data.subjectId;
  if (data.from || data.to) {
    where.startedAt = {};
    if (data.from) where.startedAt.gte = data.from;
    if (data.to) where.startedAt.lte = data.to;
  }

  const [total, items] = await Promise.all([
    client.incident.count({ where }),
    client.incident.findMany({
      where,
      orderBy: [{ startedAt: "desc" }],
      skip: (data.page - 1) * data.pageSize,
      take: data.pageSize,
    }),
  ]);

  return { items, total, page: data.page, pageSize: data.pageSize };
}

export async function getIncident(
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<IncidentView> {
  const incident = await client.incident.findUnique({ where: { id } });
  if (!incident) throw new NotFoundError(`Insiden dengan id "${id}" tidak ditemukan`);
  return incident;
}

/**
 * Buka insiden baru. Bila `dedupeKey` diberikan dan sudah dipakai, insiden
 * lama dikembalikan apa adanya (tidak ada duplikat). Bila insiden lama sudah
 * RESOLVED, tetap dikembalikan — pemanggil boleh membuka kembali dengan
 * kunci yang berbeda. Permission: `network.manage` atau jobs.run (sistem).
 */
export async function openIncident(
  actor: AnyActor,
  input: OpenIncidentInput,
  client?: Tx,
): Promise<{ incident: IncidentView; created: boolean }> {
  const parsed = openIncidentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input insiden tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const data = parsed.data;
  const startedAt = new Date();

  const run = async (tx: Tx): Promise<{ incident: IncidentView; created: boolean }> => {
    // Dedupe: kunci unik di tabel Incident. Gunakan upsert agar tidak ada
    // race condition yang membuat dua insiden dengan kunci sama.
    if (data.dedupeKey) {
      const existing = await tx.incident.findUnique({ where: { dedupeKey: data.dedupeKey } });
      if (existing) {
        await recordAudit(
          actor,
          {
            action: "incident.dedupe",
            entityType: "Incident",
            entityId: existing.id,
            metadata: { dedupeKey: data.dedupeKey, existingStatus: existing.status },
          },
          tx,
        );
        return { incident: existing, created: false };
      }

      const incident = await tx.incident.create({
        data: {
          type: data.type,
          severity: data.severity,
          status: "OPEN",
          subjectType: data.subjectType,
          subjectId: data.subjectId,
          title: data.title,
          description: data.description,
          startedAt,
          dedupeKey: data.dedupeKey,
          metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
        },
      });
      await recordAudit(
        actor,
        {
          action: "incident.open",
          entityType: "Incident",
          entityId: incident.id,
          metadata: {
            type: data.type,
            severity: data.severity,
            subjectType: data.subjectType,
            subjectId: data.subjectId,
            title: data.title,
            dedupeKey: data.dedupeKey,
          },
        },
        tx,
      );
      return { incident, created: true };
    }


    const incident = await tx.incident.create({
      data: {
        type: data.type,
        severity: data.severity,
        status: "OPEN",
        subjectType: data.subjectType,
        subjectId: data.subjectId,
        title: data.title,
        description: data.description,
        startedAt,
        metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.DbNull,
      },
    });
    await recordAudit(
      actor,
      {
        action: "incident.open",
        entityType: "Incident",
        entityId: incident.id,
        metadata: {
          type: data.type,
          severity: data.severity,
          subjectType: data.subjectType,
          subjectId: data.subjectId,
          title: data.title,
        },
      },
      tx,
    );
    return { incident, created: true };
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Tandai insiden sebagai diperhatikan (ACKNOWLEDGED). Idempoten bila sudah
 * diperhatikan. Permission yang disarankan: `network.manage`.
 */
export async function acknowledgeIncident(
  actor: Actor,
  id: string,
  client?: Tx,
): Promise<IncidentView> {
  const run = async (tx: Tx): Promise<IncidentView> => {
    const current = await getIncident(id, tx);
    if (current.status === "RESOLVED") {
      throw new ConflictError("Insiden yang sudah selesai tidak dapat diperhatikan");
    }
    if (current.status === "ACKNOWLEDGED" && current.acknowledgedAt !== null) {
      return current;
    }
    const incident = await tx.incident.update({
      where: { id },
      data: {
        status: "ACKNOWLEDGED",
        acknowledgedAt: new Date(),
        acknowledgedById: actor.userId,
      },
    });
    await recordAudit(
      actor,
      {
        action: "incident.acknowledge",
        entityType: "Incident",
        entityId: id,
        metadata: { title: incident.title, type: incident.type, severity: incident.severity },
      },
      tx,
    );
    return incident;
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Selesaikan insiden (RESOLVED) dengan catatan resolusi. Idempoten.
 * Permission yang disarankan: `network.manage`.
 */
export async function resolveIncident(
  actor: Actor,
  id: string,
  input: ResolveIncidentInput,
  client?: Tx,
): Promise<IncidentView> {
  const parsed = resolveIncidentSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input resolusi tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const { resolution } = parsed.data;

  const run = async (tx: Tx): Promise<IncidentView> => {
    const current = await getIncident(id, tx);
    if (current.status === "RESOLVED") {
      return current;
    }
    const resolvedAt = new Date();
    const incident = await tx.incident.update({
      where: { id },
      data: {
        status: "RESOLVED",
        resolvedAt,
        dedupeKey: null,
        description: current.description

          ? `${current.description}\n\n[Resolusi] ${resolution}`
          : `[Resolusi] ${resolution}`,
        metadata: {
          ...((current.metadata ?? {}) as Record<string, unknown>),
          resolution,
          resolvedAt: resolvedAt.toISOString(),
        },
      },
    });
    await recordAudit(
      actor,
      {
        action: "incident.resolve",
        entityType: "Incident",
        entityId: id,
        metadata: {
          title: incident.title,
          type: incident.type,
          severity: incident.severity,
          resolution,
        },
      },
      tx,
    );
    return incident;
  };

  return client ? run(client) : prisma.$transaction(run);
}

type MetricSample = {
  subjectType: string;
  subjectId: string;
  metric: number;
  interfaceName?: string;
};

/**
 * Ambil metrik terbaru untuk evaluasi alert: utilisasi tiap interface WAN
 * (persen terhadap kapasitas link), latensi, dan status router.
 */
async function latestSamples(client: Tx | typeof prisma): Promise<MetricSample[]> {
  const samples: MetricSample[] = [];

  // Utilisasi & latensi per interface yang terhubung ke link WAN.
  const wanLinks = await client.wanLink.findMany({
    where: { isActive: true, monitorEnabled: true, interfaceName: { not: null } },
    include: { router: { select: { id: true, lastStatus: true } } },
  });

  for (const link of wanLinks) {
    if (!link.interfaceName) continue;
    const latest = await client.interfaceMetric.findFirst({
      where: { wanLinkId: link.id },
      orderBy: { capturedAt: "desc" },
    });
    if (!latest) continue;

    const capacityKbps = link.capacityDownKbps ?? 0;
    if (capacityKbps > 0 && latest.rxRateBps !== null) {
      samples.push({
        subjectType: "WanLink",
        subjectId: link.id,
        metric: Number(latest.rxRateBps) / 1000 / capacityKbps * 100,
      });
    }
    if (latest.latencyMs !== null) {
      samples.push({
        subjectType: "WanLink",
        subjectId: link.id,
        metric: latest.latencyMs,
      });
    }
  }

  // Status router: UP=1, DOWN=0 (untuk rule DEVICE_DOWN/WAN_DOWN).
  const routers = await client.router.findMany({ where: { isActive: true } });
  for (const router of routers) {
    samples.push({
      subjectType: "Router",
      subjectId: router.id,
      metric: router.lastStatus === "UP" ? 1 : 0,
    });
  }

  return samples;
}

/**
 * Jalankan semua `AlertRule` aktif terhadap metrik terbaru dan buat incident
 * bila ambang terlampaui, dengan memperhitungkan cooldown.
 *
 * Pemetaan rule → metrik: rule dengan `targetType` tertentu hanya dievaluasi
 * terhadap sampel dengan subjectType yang sama. Rule tanpa target
 * (`targetType` null) dievaluasi terhadap semua sampel subjectType yang
 * relevan; rule `DEVICE_DOWN`/`WAN_DOWN` memakai metrik status (0/1).
 *
 * Dedupe dua lapis (lihat header modul): kunci unik + cooldown.
 */
export async function evaluateAlerts(
  actor: AnyActor,
  input: EvaluateAlertsInput = {},
  client?: Tx,
): Promise<EvaluateAlertsResult> {
  const parsed = evaluateAlertsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input evaluasi alert tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const asOf = parsed.success ? (parsed.data.asOf ?? new Date()) : new Date();

  const run = async (tx: Tx): Promise<EvaluateAlertsResult> => {
    const [rules, samples] = await Promise.all([
      tx.alertRule.findMany({ where: { enabled: true } }),
      latestSamples(tx),
    ]);

    const evaluations: AlertEvaluation[] = [];
    const created: Incident[] = [];

    for (const rule of rules) {
      const matching = samples.filter((s) =>
        rule.targetType ? s.subjectType === rule.targetType && (!rule.targetId || s.subjectId === rule.targetId) : true,
      );
      if (matching.length === 0) {
        evaluations.push({
          ruleId: rule.id,
          code: rule.code,
          name: rule.name,
          subjectType: rule.targetType ?? "any",
          subjectId: rule.targetId,
          metric: 0,
          threshold: rule.threshold,
          comparator: rule.comparator as Comparator,
          triggered: false,
          incidentId: null,
          skippedReason: "tidak ada metrik untuk target ini",
        });
        continue;
      }

      for (const sample of matching) {
        const triggered = matchesComparator(rule.comparator as Comparator, sample.metric, rule.threshold);
        const dedupeKey = `alert:${rule.code}:${sample.subjectType}:${sample.subjectId}`;
        const evaluation: AlertEvaluation = {
          ruleId: rule.id,
          code: rule.code,
          name: rule.name,
          subjectType: sample.subjectType,
          subjectId: sample.subjectId,
          metric: sample.metric,
          threshold: rule.threshold,
          comparator: rule.comparator as Comparator,
          triggered,
          incidentId: null,
          skippedReason: null,
        };

        if (!triggered) {
          evaluation.skippedReason = `metrik ${sample.metric.toFixed(2)} tidak melebihi ambang ${rule.comparator} ${rule.threshold}`;
          evaluations.push(evaluation);
          continue;
        }

        // Cek incident terakhir untuk rule + target ini (semua status).
        const last = await tx.incident.findFirst({
          where: { dedupeKey },
          orderBy: { startedAt: "desc" },
        });
        const cooldownMs = rule.cooldownMin * 60 * MILLIS;
        if (last && asOf.getTime() - last.startedAt.getTime() < cooldownMs) {
          evaluation.skippedReason = `dalam masa jeda ${rule.cooldownMin} menit sejak insiden terakhir`;
          evaluation.incidentId = last.id;
          evaluations.push(evaluation);
          continue;
        }

        // Bila masih ada incident terbuka dengan kunci yang sama, jangan
        // buat duplikat (dedupeKey unik di schema).
        const existingOpen = last && last.status !== "RESOLVED" ? last : null;
        if (existingOpen) {
          evaluation.incidentId = existingOpen.id;
          evaluation.skippedReason = "insiden terbuka sudah ada untuk rule+target ini";
          evaluations.push(evaluation);
          continue;
        }

        const severity = rule.severity;
        const { incident, created: didCreate } = await openIncident(
          actor,
          {
            type: rule.type,
            severity,
            subjectType: sample.subjectType,
            subjectId: sample.subjectId,
            title: `${rule.name} — ${sample.subjectType} ${sample.interfaceName ?? sample.subjectId}`,
            description: `Aturan "${rule.code}" terpicu: metrik ${sample.metric.toFixed(2)} ${rule.comparator} ${rule.threshold}.`,
            dedupeKey,
            metadata: {
              ruleId: rule.id,
              ruleCode: rule.code,
              metric: sample.metric,
              threshold: rule.threshold,
              comparator: rule.comparator,
            },
          },
          tx,
        );
        evaluation.incidentId = incident.id;
        if (didCreate) created.push(incident);
        evaluations.push(evaluation);
      }
    }

    await recordAudit(
      actor,
      {
        action: "alert.evaluate",
        entityType: "AlertRule",
        metadata: {
          asOf: asOf.toISOString(),
          rulesEvaluated: rules.length,
          samples: samples.length,
          triggered: evaluations.filter((e) => e.triggered && e.skippedReason === null).length,
          incidentsCreated: created.length,
        },
      },
      tx,
    );

    return { asOf, evaluations, created };
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Tutup insiden yang sudah lama tidak diperbarui (melebihi
 * `olderThanDays`). Berguna untuk job terjadwal; opsional.
 */
export async function closeStaleIncidents(
  opts: { olderThanDays?: number } = {},
  client: Tx | typeof prisma = prisma,
): Promise<{ closed: number }> {
  const olderThanDays = opts.olderThanDays ?? 30;
  if (!Number.isInteger(olderThanDays) || olderThanDays <= 0) {
    throw new ValidationError("`olderThanDays` harus bilangan bulat positif");
  }
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * MILLIS);

  const openIncidents = await client.incident.findMany({
    where: { status: { in: ["OPEN", "ACKNOWLEDGED"] }, startedAt: { lt: cutoff } },
    select: { id: true },
  });
  if (openIncidents.length === 0) return { closed: 0 };

  const result = await client.incident.updateMany({
    where: { id: { in: openIncidents.map((i) => i.id) } },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });

  await recordAudit(
    { kind: "system", label: "retention-job" },
    {
      action: "incident.stale.close",
      entityType: "Incident",
      metadata: { olderThanDays, closed: result.count },
    },
    client,
  );
  return { closed: result.count };
}

