import { z } from "zod";
import { prisma, type Tx } from "../db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type Actor,
} from "../permissions";
import { recordAudit } from "../audit";
import type { AlertRule, IncidentType, Prisma, Severity } from "@prisma/client";

/**
 * Aturan alert (AlertRule). Sebuah rule aktif dievaluasi terhadap metrik
 * terbaru oleh `incidents.evaluateAlerts`; bila ambang terlampaui, incident
 * dibuat (dengan cooldown per rule+target).
 *
 * Permission (diputuskan route handler, bukan di sini):
 * - `listAlertRules`                    → network.view
 * - create/update/delete/toggle        → network.manage
 */

export const COMPARATORS = [">", ">=", "<", "<=", "=="] as const;
export type Comparator = (typeof COMPARATORS)[number];

const INCIDENT_TYPES: readonly IncidentType[] = [
  "DEVICE_DOWN",
  "WAN_DOWN",
  "HIGH_LATENCY",
  "HIGH_UTILIZATION",
  "OPTICAL_DEGRADED",
  "OTHER",
];

const SEVERITIES: readonly Severity[] = ["INFO", "WARNING", "CRITICAL"];

export const comparatorSchema = z.enum(COMPARATORS);
const alertRuleFieldsSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, "Kode aturan minimal 2 karakter")
    .max(60, "Kode aturan maksimal 60 karakter")
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "Kode aturan hanya boleh alfanumerik, titik, strip, garis bawah"),
  name: z.string().trim().min(1, "Nama aturan wajib diisi").max(120, "Nama aturan maksimal 120 karakter"),
  type: z.enum(INCIDENT_TYPES as unknown as [IncidentType, ...IncidentType[]]),
  targetType: z.string().trim().max(60).optional(),
  targetId: z.string().trim().max(60).optional(),
  comparator: comparatorSchema.default(">="),
  threshold: z.number().min(0, "Ambang batas tidak boleh negatif").max(1_000_000),
  severity: z.enum(SEVERITIES as unknown as [Severity, ...Severity[]]).default("WARNING"),
  cooldownMin: z.number().int().min(0, "Jeda minimal 0 menit").max(1440, "Jeda maksimal 1 hari").default(30),
  enabled: z.boolean().default(true),
  notes: z.string().trim().max(500, "Catatan maksimal 500 karakter").optional(),
});

export const createAlertRuleSchema = alertRuleFieldsSchema.refine(
  (v) => (v.targetType === undefined) === (v.targetId === undefined),
  {
    message: "targetType dan targetId harus diisi bersamaan (atau keduanya kosong)",
    path: ["targetId"],
  },
);
export type CreateAlertRuleInput = z.input<typeof createAlertRuleSchema>;

export const updateAlertRuleSchema = alertRuleFieldsSchema.partial();
export type UpdateAlertRuleInput = z.input<typeof updateAlertRuleSchema>;

export type AlertRuleView = AlertRule;

function parseCreate(input: CreateAlertRuleInput) {
  const parsed = createAlertRuleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input aturan alert tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}

function parseUpdate(input: UpdateAlertRuleInput) {
  const parsed = updateAlertRuleSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(
      `Input aturan alert tidak valid: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  return parsed.data;
}

export async function listAlertRules(
  opts: { enabledOnly?: boolean } = {},
  client: Tx | typeof prisma = prisma,
): Promise<AlertRuleView[]> {
  const where: Prisma.AlertRuleWhereInput = {};
  if (opts.enabledOnly) where.enabled = true;
  return client.alertRule.findMany({ orderBy: [{ code: "asc" }] });
}

export async function getAlertRule(
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<AlertRuleView> {
  const rule = await client.alertRule.findUnique({ where: { id } });
  if (!rule) throw new NotFoundError(`Aturan alert dengan id "${id}" tidak ditemukan`);
  return rule;
}

/**
 * Buat aturan alert. Comparator dibatasi `> >= < <= ==` dan ambang batas
 * minimal 0. Permission yang disarankan: `network.manage`.
 */
export async function createAlertRule(
  actor: Actor,
  input: CreateAlertRuleInput,
  client?: Tx,
): Promise<AlertRuleView> {
  const data = parseCreate(input);

  const run = async (tx: Tx): Promise<AlertRuleView> => {
    const existing = await tx.alertRule.findUnique({ where: { code: data.code } });
    if (existing) throw new ConflictError(`Aturan alert dengan kode "${data.code}" sudah ada`);

    const rule = await tx.alertRule.create({
      data: {
        code: data.code,
        name: data.name,
        type: data.type,
        targetType: data.targetType,
        targetId: data.targetId,
        comparator: data.comparator,
        threshold: data.threshold,
        severity: data.severity,
        cooldownMin: data.cooldownMin,
        enabled: data.enabled,
        notes: data.notes,
      },
    });
    await recordAudit(
      actor,
      {
        action: "alert.create",
        entityType: "AlertRule",
        entityId: rule.id,
        metadata: {
          code: rule.code,
          name: rule.name,
          type: rule.type,
          comparator: rule.comparator,
          threshold: rule.threshold,
          severity: rule.severity,
          cooldownMin: rule.cooldownMin,
          enabled: rule.enabled,
        },
      },
      tx,
    );
    return rule;
  };

  return client ? run(client) : prisma.$transaction(run);
}

/** Permission yang disarankan: `network.manage`. */
export async function updateAlertRule(
  actor: Actor,
  id: string,
  input: UpdateAlertRuleInput,
  client?: Tx,
): Promise<AlertRuleView> {
  const data = parseUpdate(input);

  const run = async (tx: Tx): Promise<AlertRuleView> => {
    const current = await getAlertRule(id, tx);

    if (data.code !== undefined && data.code !== current.code) {
      const conflict = await tx.alertRule.findUnique({ where: { code: data.code } });
      if (conflict) throw new ConflictError(`Aturan alert dengan kode "${data.code}" sudah ada`);
    }

    const rule = await tx.alertRule.update({
      where: { id },
      data: {
        code: data.code,
        name: data.name,
        type: data.type,
        targetType: data.targetType,
        targetId: data.targetId,
        comparator: data.comparator,
        threshold: data.threshold,
        severity: data.severity,
        cooldownMin: data.cooldownMin,
        enabled: data.enabled,
        notes: data.notes,
      },
    });
    await recordAudit(
      actor,
      {
        action: "alert.update",
        entityType: "AlertRule",
        entityId: id,
        metadata: {
          code: rule.code,
          name: rule.name,
          type: rule.type,
          comparator: rule.comparator,
          threshold: rule.threshold,
          severity: rule.severity,
          cooldownMin: rule.cooldownMin,
          enabled: rule.enabled,
        },
      },
      tx,
    );
    return rule;
  };

  return client ? run(client) : prisma.$transaction(run);
}

/** Permission yang disarankan: `network.manage`. */
export async function deleteAlertRule(
  actor: Actor,
  id: string,
  client?: Tx,
): Promise<{ id: string; code: string }> {
  const run = async (tx: Tx): Promise<{ id: string; code: string }> => {
    const rule = await getAlertRule(id, tx);
    await tx.alertRule.delete({ where: { id } });
    await recordAudit(
      actor,
      {
        action: "alert.delete",
        entityType: "AlertRule",
        entityId: id,
        metadata: { code: rule.code, name: rule.name },
      },
      tx,
    );
    return { id, code: rule.code };
  };

  return client ? run(client) : prisma.$transaction(run);
}

/** Aktifkan/nonaktifkan aturan tanpa mengubah ambang. Permission: `network.manage`. */
export async function toggleAlertRule(
  actor: Actor,
  id: string,
  enabled: boolean,
  client?: Tx,
): Promise<AlertRuleView> {
  const run = async (tx: Tx): Promise<AlertRuleView> => {
    const current = await getAlertRule(id, tx);
    const rule = await tx.alertRule.update({ where: { id }, data: { enabled } });
    await recordAudit(
      actor,
      {
        action: "alert.toggle",
        entityType: "AlertRule",
        entityId: id,
        metadata: { code: current.code, enabled },
      },
      tx,
    );
    return rule;
  };

  return client ? run(client) : prisma.$transaction(run);
}

/**
 * Evaluasi comparator dasar — dipakai `incidents.evaluateAlerts` dan
 * diekspor agar pengujian bisa memverifikasi semantiknya.
 */
export function matchesComparator(
  comparator: Comparator,
  value: number,
  threshold: number,
): boolean {
  switch (comparator) {
    case ">":
      return value > threshold;
    case ">=":
      return value >= threshold;
    case "<":
      return value < threshold;
    case "<=":
      return value <= threshold;
    case "==":
      return value === threshold;
  }
}
