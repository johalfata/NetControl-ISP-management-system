import { prisma, type Tx } from "./db";
import { redact } from "./crypto";
import { Prisma, type ActorType } from "@prisma/client";
import type { AnyActor } from "./permissions";

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: unknown;
  ip?: string | null;
  /** Untuk aksi yang dilakukan proses otomatis atas nama sesuatu. */
  actorOverride?: { type: ActorType; id?: string | null; label: string };
};

const ACTOR_TYPE_BY_KIND: Record<AnyActor["kind"], ActorType> = {
  user: "USER",
  portal: "PORTAL",
  system: "SYSTEM",
  webhook: "WEBHOOK",
};

function actorFields(actor: AnyActor): {
  actorType: ActorType;
  actorId: string | null;
  actorLabel: string;
} {
  switch (actor.kind) {
    case "user":
      return { actorType: "USER", actorId: actor.userId, actorLabel: actor.label };
    case "portal":
      return { actorType: "PORTAL", actorId: actor.portalUserId, actorLabel: actor.label };
    default:
      return { actorType: ACTOR_TYPE_BY_KIND[actor.kind], actorId: null, actorLabel: actor.label };
  }
}

/**
 * Catat audit log. Metadata selalu diredaksi agar token/password tidak pernah
 * tersimpan. Kegagalan penulisan audit tidak boleh menggagalkan operasi bisnis,
 * tetapi dicatat ke stderr.
 */
export async function recordAudit(
  actor: AnyActor,
  input: AuditInput,
  client: Tx | typeof prisma = prisma,
): Promise<void> {
  const base = actorFields(actor);
  const fields = input.actorOverride
    ? {
        actorType: input.actorOverride.type,
        actorId: input.actorOverride.id ?? null,
        actorLabel: input.actorOverride.label,
      }
    : base;

  try {
    await client.auditLog.create({
      data: {
        actorType: fields.actorType,
        actorId: fields.actorId,
        actorLabel: fields.actorLabel,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: (input.metadata === undefined
          ? undefined
          : (redact(input.metadata) as never)),
        ip: input.ip ?? null,
      },
    });
  } catch (error) {
    console.error("[audit] gagal menulis audit log:", error);
  }
}

/** Versi batch untuk operasi massal (bulk action, import). */
export async function recordAuditBatch(
  actor: AnyActor,
  inputs: AuditInput[],
  client: Tx | typeof prisma = prisma,
): Promise<void> {
  if (inputs.length === 0) return;
  const base = actorFields(actor);
  try {
    await client.auditLog.createMany({
      data: inputs.map((input) => ({
        actorType: base.actorType,
        actorId: base.actorId,
        actorLabel: base.actorLabel,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: (input.metadata === undefined ? Prisma.DbNull : (redact(input.metadata) as Prisma.InputJsonValue)),

        ip: input.ip ?? null,
      })),
    });
  } catch (error) {
    console.error("[audit] gagal menulis audit log batch:", error);
  }
}