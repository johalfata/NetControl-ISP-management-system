import { z } from "zod";
import { prisma, type Tx } from "../db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type Actor,
  assertPermission,
} from "../permissions";
import { recordAudit } from "../audit";
import { minorToNumber, toMinor } from "../money";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const createPlanSchema = z.object({
  code: z
    .string()
    .min(1, "Kode paket wajib diisi")
    .max(32, "Kode paket maksimal 32 karakter"),
  name: z
    .string()
    .min(1, "Nama paket wajib diisi")
    .max(100, "Nama paket maksimal 100 karakter"),
  description: z.string().max(500).nullish(),
  priceMinor: z
    .number()
    .int("Harga harus bilangan bulat")
    .min(0, "Harga tidak boleh negatif"),
  downloadKbps: z
    .number()
    .int()
    .min(1, "Kecepatan download minimal 1 Kbps"),
  uploadKbps: z
    .number()
    .int()
    .min(1, "Kecepatan upload minimal 1 Kbps"),
  billingPeriodDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(30),
  sortOrder: z.number().int().default(0),
  notes: z.string().max(500).nullish(),
});
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const updatePlanSchema = z.object({
  name: z
    .string()
    .min(1, "Nama paket wajib diisi")
    .max(100)
    .optional(),
  description: z.string().max(500).nullish(),
  priceMinor: z
    .number()
    .int("Harga harus bilangan bulat")
    .min(0, "Harga tidak boleh negatif")
    .optional(),
  downloadKbps: z
    .number()
    .int()
    .min(1, "Kecepatan download minimal 1 Kbps")
    .optional(),
  uploadKbps: z
    .number()
    .int()
    .min(1, "Kecepatan upload minimal 1 Kbps")
    .optional(),
  billingPeriodDays: z.number().int().min(1).max(365).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  notes: z.string().max(500).nullish(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export type PlanView = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMinor: number;
  downloadKbps: number;
  uploadKbps: number;
  billingPeriodDays: number;
  isActive: boolean;
  isArchived: boolean;
  sortOrder: number;
  notes: string | null;
  customerCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type PlanRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMinor: bigint;
  downloadKbps: number;
  uploadKbps: number;
  billingPeriodDays: number;
  isActive: boolean;
  isArchived: boolean;
  sortOrder: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { customers: number };
};

function toView(row: PlanRow): PlanView {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceMinor: minorToNumber(row.priceMinor),
    downloadKbps: row.downloadKbps,
    uploadKbps: row.uploadKbps,
    billingPeriodDays: row.billingPeriodDays,
    isActive: row.isActive,
    isArchived: row.isArchived,
    sortOrder: row.sortOrder,
    notes: row.notes,
    customerCount: row._count?.customers ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export type PlanFilters = {
  isActive?: boolean;
  includeArchived?: boolean;
  search?: string;
};

export async function listPlans(
  filters: PlanFilters = {},
  client: Tx | typeof prisma = prisma,
): Promise<PlanView[]> {
  const where: Record<string, unknown> = {};
  if (filters.isActive !== undefined) where.isActive = filters.isActive;
  if (!filters.includeArchived) where.isArchived = false;
  if (filters.search) {
    where.OR = [
      { code: { contains: filters.search, mode: "insensitive" } },
      { name: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const rows = await client.servicePlan.findMany({
    where,
    include: { _count: { select: { customers: true } } },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return rows.map(toView);
}

export async function getPlan(
  id: string,
  client: Tx | typeof prisma = prisma,
): Promise<PlanView> {
  const row = await client.servicePlan.findUnique({
    where: { id },
    include: { _count: { select: { customers: true } } },
  });
  if (!row) throw new NotFoundError(`Paket dengan id "${id}" tidak ditemukan`);
  return toView(row);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Buat paket baru + catat harga awal di ServicePlanPrice.
 * Permission: plans.manage
 */
export async function createPlan(
  actor: Actor,
  input: CreatePlanInput,
  client?: Tx,
): Promise<PlanView> {
  assertPermission(actor, "plans.manage");
  const data = createPlanSchema.parse(input);

  const db = client ?? prisma;

  const existing = await db.servicePlan.findUnique({
    where: { code: data.code },
    select: { id: true },
  });
  if (existing) {
    throw new ConflictError(`Kode paket "${data.code}" sudah digunakan`);
  }

  const plan = await db.servicePlan.create({
    data: {
      code: data.code,
      name: data.name,
      description: data.description ?? null,
      priceMinor: toMinor(data.priceMinor),
      downloadKbps: data.downloadKbps,
      uploadKbps: data.uploadKbps,
      billingPeriodDays: data.billingPeriodDays,
      sortOrder: data.sortOrder,
      notes: data.notes ?? null,
      priceHistory: {
        create: {
          priceMinor: toMinor(data.priceMinor),
          effectiveFrom: new Date(),
          createdById: actor.userId,
          note: "Harga awal",
        },
      },
    },
    include: { _count: { select: { customers: true } } },
  });

  await recordAudit(
    actor,
    {
      action: "plan.create",
      entityType: "ServicePlan",
      entityId: plan.id,
      metadata: { code: plan.code, name: plan.name, priceMinor: data.priceMinor },
    },
    db,
  );

  return toView(plan);
}

/**
 * Update paket. Ketika harga berubah, simpan riwayat harga baru.
 * Permission: plans.manage
 */
export async function updatePlan(
  actor: Actor,
  id: string,
  input: UpdatePlanInput,
  client?: Tx,
): Promise<PlanView> {
  assertPermission(actor, "plans.manage");
  const data = updatePlanSchema.parse(input);

  const db = client ?? prisma;

  const existing = await db.servicePlan.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError(`Paket dengan id "${id}" tidak ditemukan`);
  if (existing.isArchived) {
    throw new ValidationError("Tidak dapat mengubah paket yang sudah diarsipkan");
  }

  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.description !== undefined) updateData.description = data.description ?? null;
  if (data.downloadKbps !== undefined) updateData.downloadKbps = data.downloadKbps;
  if (data.uploadKbps !== undefined) updateData.uploadKbps = data.uploadKbps;
  if (data.billingPeriodDays !== undefined) updateData.billingPeriodDays = data.billingPeriodDays;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
  if (data.notes !== undefined) updateData.notes = data.notes ?? null;

  // Price change: record history
  if (data.priceMinor !== undefined) {
    const newPrice = toMinor(data.priceMinor);
    if (newPrice !== existing.priceMinor) {
      updateData.priceMinor = newPrice;
      await db.servicePlanPrice.create({
        data: {
          planId: id,
          priceMinor: newPrice,
          effectiveFrom: new Date(),
          createdById: actor.userId,
        },
      });
    }
  }

  const plan = await db.servicePlan.update({
    where: { id },
    data: updateData,
    include: { _count: { select: { customers: true } } },
  });

  await recordAudit(
    actor,
    {
      action: "plan.update",
      entityType: "ServicePlan",
      entityId: plan.id,
      metadata: data,
    },
    db,
  );

  return toView(plan);
}

/**
 * Arsipkan paket. Ditolak jika masih ada pelanggan aktif.
 * Permission: plans.manage
 */
export async function archivePlan(
  actor: Actor,
  id: string,
  client?: Tx,
): Promise<PlanView> {
  assertPermission(actor, "plans.manage");

  const db = client ?? prisma;

  const existing = await db.servicePlan.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          customers: { where: { status: { not: "ARCHIVED" } } },
        },
      },
    },
  });
  if (!existing) throw new NotFoundError(`Paket dengan id "${id}" tidak ditemukan`);
  if (existing.isArchived) {
    throw new ValidationError("Paket sudah diarsipkan");
  }

  const activeCustomers = existing._count.customers;
  if (activeCustomers > 0) {
    throw new ConflictError(
      `Tidak dapat mengarsipkan paket: masih ada ${activeCustomers} pelanggan aktif`,
    );
  }

  const plan = await db.servicePlan.update({
    where: { id },
    data: { isArchived: true, isActive: false },
    include: { _count: { select: { customers: true } } },
  });

  await recordAudit(
    actor,
    {
      action: "plan.archive",
      entityType: "ServicePlan",
      entityId: plan.id,
      metadata: { code: plan.code },
    },
    db,
  );

  return toView(plan);
}
