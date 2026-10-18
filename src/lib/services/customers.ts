import { z } from "zod";
import Papa from "papaparse";
import { prisma, executeInTx, type Tx } from "../db";
import {
  ConflictError,
  NotFoundError,
  type AnyActor,
  assertPermission,
} from "../permissions";
import { recordAudit } from "../audit";
import { minorToNumber } from "../money";
import { runtimeSettings } from "../settings/service";
import { allocateDocumentNumber } from "./numbering";
import type { Customer, ServicePlan, Subscription } from "@prisma/client";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const createCustomerSchema = z.object({
  name: z
    .string()
    .min(1, "Nama pelanggan wajib diisi")
    .max(120, "Nama pelanggan maksimal 120 karakter"),
  email: z.string().email("Format email tidak valid").max(160).nullish(),
  phone: z.string().max(40, "Nomor telepon maksimal 40 karakter").nullish(),
  address: z.string().max(400, "Alamat maksimal 400 karakter").nullish(),
  city: z.string().max(100, "Kota maksimal 100 karakter").nullish(),
  district: z.string().max(100, "Kecamatan maksimal 100 karakter").nullish(),
  postalCode: z.string().max(20, "Kode pos maksimal 20 karakter").nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  notes: z.string().max(500, "Catatan maksimal 500 karakter").nullish(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ARCHIVED"]).default("ACTIVE").optional(),
  installationDate: z.coerce.date().nullish(),
  pppoeUsername: z.string().max(100, "Username PPPoE maksimal 100 karakter").nullish(),
  routerId: z.string().nullish(),
  onuNodeId: z.string().nullish(),
  odpNodeId: z.string().nullish(),
  planId: z.string().nullish(),
  billingDay: z.number().int().min(1).max(31).nullish(),
  dueDaysAfterIssue: z.number().int().min(0).max(90).nullish(),
  autoSuspend: z.boolean().default(true).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = createCustomerSchema.partial();
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type SubscriptionView = {
  id: string;
  planId: string;
  planName: string;
  priceMinor: number;
  downloadKbps: number;
  uploadKbps: number;
  status: string;
  changeType: string;
  startedAt: Date;
  endedAt: Date | null;
};

export type CustomerView = {
  id: string;
  code: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  district: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  notes: string | null;
  status: string;
  installationDate: Date | null;
  archivedAt: Date | null;
  pppoeUsername: string | null;
  routerId: string | null;
  routerName: string | null;
  onuNodeId: string | null;
  onuNodeName: string | null;
  odpNodeId: string | null;
  odpNodeName: string | null;
  planId: string | null;
  planName: string | null;
  planPriceMinor: number | null;
  planStartedAt: Date | null;
  billingDay: number | null;
  dueDaysAfterIssue: number | null;
  autoSuspend: boolean;
  createdAt: Date;
  updatedAt: Date;
  activeSubscription: SubscriptionView | null;
};

type CustomerRow = Customer & {
  router?: { name: string } | null;
  onuNode?: { name: string } | null;
  odpNode?: { name: string } | null;
  plan?: { name: string; priceMinor: bigint } | null;
  subscriptions?: (Subscription & { plan: { name: string } })[];
};

function toCustomerView(row: CustomerRow): CustomerView {
  const activeSub = row.subscriptions?.find((s) => s.status === "ACTIVE") ?? null;
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    district: row.district,
    postalCode: row.postalCode,
    latitude: row.latitude,
    longitude: row.longitude,
    notes: row.notes,
    status: row.status,
    installationDate: row.installationDate,
    archivedAt: row.archivedAt,
    pppoeUsername: row.pppoeUsername,
    routerId: row.routerId,
    routerName: row.router?.name ?? null,
    onuNodeId: row.onuNodeId,
    onuNodeName: row.onuNode?.name ?? null,
    odpNodeId: row.odpNodeId,
    odpNodeName: row.odpNode?.name ?? null,
    planId: row.planId,
    planName: row.plan?.name ?? null,
    planPriceMinor: row.plan ? minorToNumber(row.plan.priceMinor) : null,
    planStartedAt: row.planStartedAt,
    billingDay: row.billingDay,
    dueDaysAfterIssue: row.dueDaysAfterIssue,
    autoSuspend: row.autoSuspend,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    activeSubscription: activeSub
      ? {
          id: activeSub.id,
          planId: activeSub.planId,
          planName: activeSub.plan.name,
          priceMinor: minorToNumber(activeSub.priceMinor),
          downloadKbps: activeSub.downloadKbps,
          uploadKbps: activeSub.uploadKbps,
          status: activeSub.status,
          changeType: activeSub.changeType,
          startedAt: activeSub.startedAt,
          endedAt: activeSub.endedAt,
        }
      : null,
  };
}

const customerInclude = {
  router: { select: { name: true } },
  onuNode: { select: { name: true } },
  odpNode: { select: { name: true } },
  plan: { select: { name: true, priceMinor: true } },
  subscriptions: {
    where: { status: "ACTIVE" },
    include: { plan: { select: { name: true } } },
    orderBy: { startedAt: "desc" as const },
    take: 1,
  },
} as const;

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

export async function createCustomer(
  actor: AnyActor,
  rawInput: CreateCustomerInput,
  client: Tx | typeof prisma = prisma,
): Promise<CustomerView> {
  assertPermission(actor, "customers.manage");
  const input = createCustomerSchema.parse(rawInput);

  if (input.pppoeUsername && input.pppoeUsername.trim() !== "") {
    const existing = await client.customer.findUnique({
      where: { pppoeUsername: input.pppoeUsername },
    });
    if (existing) {
      throw new ConflictError("Username PPPoE sudah digunakan oleh pelanggan lain");
    }
  }

  const settings = await runtimeSettings(client);
  const now = new Date();

  return await executeInTx(client, async (tx) => {
    const code = await allocateDocumentNumber(
      tx,
      {
        format: settings.customerCodeFormat,
        prefix: settings.customerCodePrefix,
        resetPeriod: settings.customerCodeResetPeriod,
        scope: "CUSTOMER",
      },
      now,
    );

    let plan: ServicePlan | null = null;
    if (input.planId) {
      plan = await tx.servicePlan.findUnique({ where: { id: input.planId } });
      if (!plan) throw new NotFoundError("Paket layanan tidak ditemukan");
    }

    const customer = await tx.customer.create({
      data: {
        code,
        name: input.name,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        district: input.district ?? null,
        postalCode: input.postalCode ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        notes: input.notes ?? null,
        status: input.status ?? "ACTIVE",
        installationDate: input.installationDate ?? null,
        pppoeUsername: input.pppoeUsername ?? null,
        routerId: input.routerId ?? null,
        onuNodeId: input.onuNodeId ?? null,
        odpNodeId: input.odpNodeId ?? null,
        planId: input.planId ?? null,
        planStartedAt: plan ? now : null,
        billingDay: input.billingDay ?? settings.defaultBillingDay,
        dueDaysAfterIssue: input.dueDaysAfterIssue ?? settings.dueDaysAfterIssue,
        autoSuspend: input.autoSuspend ?? true,
        createdById: actor.kind === "user" ? actor.userId : null,
      },
      include: customerInclude,
    });

    if (plan) {
      await tx.subscription.create({
        data: {
          customerId: customer.id,
          planId: plan.id,
          priceMinor: plan.priceMinor,
          downloadKbps: plan.downloadKbps,
          uploadKbps: plan.uploadKbps,
          status: "ACTIVE",
          changeType: "NEW",
          changeMode: "IMMEDIATE",
          startedAt: now,
          createdById: actor.kind === "user" ? actor.userId : null,
        },
      });
    }

    await recordAudit(
      actor,
      {
        action: "customer.create",
        entityType: "Customer",
        entityId: customer.id,
        metadata: { code, name: customer.name, planId: input.planId },
      },
      tx,
    );

    const fullCustomer = await tx.customer.findUnique({
      where: { id: customer.id },
      include: customerInclude,
    });

    return toCustomerView(fullCustomer!);
  });
}

export async function updateCustomer(
  actor: AnyActor,
  customerId: string,
  rawInput: UpdateCustomerInput,
  client: Tx | typeof prisma = prisma,
): Promise<CustomerView> {
  assertPermission(actor, "customers.manage");
  const input = updateCustomerSchema.parse(rawInput);

  const existingCustomer = await client.customer.findUnique({
    where: { id: customerId },
    include: { subscriptions: { where: { status: "ACTIVE" } } },
  });
  if (!existingCustomer) throw new NotFoundError("Pelanggan tidak ditemukan");

  if (
    input.pppoeUsername &&
    input.pppoeUsername.trim() !== "" &&
    input.pppoeUsername !== existingCustomer.pppoeUsername
  ) {
    const conflict = await client.customer.findUnique({
      where: { pppoeUsername: input.pppoeUsername },
    });
    if (conflict) {
      throw new ConflictError("Username PPPoE sudah digunakan oleh pelanggan lain");
    }
  }

  const now = new Date();

  return await executeInTx(client, async (tx) => {
    let newPlan: ServicePlan | null = null;
    const planChanged = input.planId !== undefined && input.planId !== existingCustomer.planId;

    if (planChanged && input.planId) {
      newPlan = await tx.servicePlan.findUnique({ where: { id: input.planId } });
      if (!newPlan) throw new NotFoundError("Paket layanan baru tidak ditemukan");
    }

    if (planChanged) {
      await tx.subscription.updateMany({
        where: { customerId, status: "ACTIVE" },
        data: { status: "ENDED", endedAt: now },
      });

      if (newPlan) {
        await tx.subscription.create({
          data: {
            customerId,
            planId: newPlan.id,
            priceMinor: newPlan.priceMinor,
            downloadKbps: newPlan.downloadKbps,
            uploadKbps: newPlan.uploadKbps,
            status: "ACTIVE",
            changeType: "PLAN_CHANGE",
            changeMode: "IMMEDIATE",
            startedAt: now,
            createdById: actor.kind === "user" ? actor.userId : null,
          },
        });
      }
    }

    const updated = await tx.customer.update({
      where: { id: customerId },
      data: {
        name: input.name,
        email: input.email,
        phone: input.phone,
        address: input.address,
        city: input.city,
        district: input.district,
        postalCode: input.postalCode,
        latitude: input.latitude,
        longitude: input.longitude,
        notes: input.notes,
        status: input.status,
        installationDate: input.installationDate,
        pppoeUsername: input.pppoeUsername,
        routerId: input.routerId,
        onuNodeId: input.onuNodeId,
        odpNodeId: input.odpNodeId,
        planId: input.planId,
        planStartedAt: planChanged ? (newPlan ? now : null) : undefined,
        billingDay: input.billingDay,
        dueDaysAfterIssue: input.dueDaysAfterIssue,
        autoSuspend: input.autoSuspend,
      },
      include: customerInclude,
    });

    await recordAudit(
      actor,
      {
        action: "customer.update",
        entityType: "Customer",
        entityId: customerId,
        metadata: { input, planChanged },
      },
      tx,
    );

    return toCustomerView(updated);
  });
}

export async function archiveCustomer(
  actor: AnyActor,
  customerId: string,
  client: Tx | typeof prisma = prisma,
): Promise<CustomerView> {
  assertPermission(actor, "customers.archive");
  const now = new Date();

  return await executeInTx(client, async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundError("Pelanggan tidak ditemukan");

    await tx.subscription.updateMany({
      where: { customerId, status: "ACTIVE" },
      data: { status: "ENDED", endedAt: now },
    });

    const archived = await tx.customer.update({
      where: { id: customerId },
      data: {
        status: "ARCHIVED",
        archivedAt: now,
      },
      include: customerInclude,
    });

    await recordAudit(
      actor,
      {
        action: "customer.archive",
        entityType: "Customer",
        entityId: customerId,
      },
      tx,
    );

    return toCustomerView(archived);
  });
}

export async function getCustomer(
  actor: AnyActor,
  customerId: string,
  client: Tx | typeof prisma = prisma,
): Promise<CustomerView> {
  assertPermission(actor, "customers.view");
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    include: customerInclude,
  });
  if (!customer) throw new NotFoundError("Pelanggan tidak ditemukan");
  return toCustomerView(customer);
}

export type CustomerFilters = {
  search?: string;
  status?: string;
  planId?: string;
  routerId?: string;
};

export type Pagination = {
  page?: number;
  pageSize?: number;
  limit?: number;
};

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listCustomers(
  actor: AnyActor,
  filters: CustomerFilters = {},
  pagination: Pagination = {},
  client: Tx | typeof prisma = prisma,
): Promise<PaginatedResult<CustomerView>> {
  assertPermission(actor, "customers.view");
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? pagination.limit ?? 20));

  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.planId) where.planId = filters.planId;
  if (filters.routerId) where.routerId = filters.routerId;
  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: "insensitive" } },
      { code: { contains: filters.search, mode: "insensitive" } },
      { email: { contains: filters.search, mode: "insensitive" } },
      { phone: { contains: filters.search, mode: "insensitive" } },
      { pppoeUsername: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    client.customer.count({ where }),
    client.customer.findMany({
      where,
      include: customerInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map(toCustomerView),
    total,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// CSV Import & Export
// ---------------------------------------------------------------------------

export async function exportCustomers(
  actor: AnyActor,
  filters: CustomerFilters = {},
  client: Tx | typeof prisma = prisma,
): Promise<string> {
  assertPermission(actor, "customers.export");

  const where: Record<string, unknown> = {};
  if (filters.status) where.status = filters.status;
  if (filters.planId) where.planId = filters.planId;
  if (filters.routerId) where.routerId = filters.routerId;

  const rows = await client.customer.findMany({
    where,
    include: { plan: { select: { code: true } } },
    orderBy: { createdAt: "desc" },
  });

  const exportData = rows.map((r: Customer & { plan?: { code: string } | null }) => ({
    code: r.code,
    name: r.name,
    email: r.email ?? "",
    phone: r.phone ?? "",
    address: r.address ?? "",
    city: r.city ?? "",
    district: r.district ?? "",
    postalCode: r.postalCode ?? "",
    status: r.status,
    pppoeUsername: r.pppoeUsername ?? "",
    planCode: r.plan?.code ?? "",
    billingDay: r.billingDay ?? "",
  }));

  return Papa.unparse(exportData);
}

export type ImportSummary = {
  total: number;
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
};

export async function importCustomers(
  actor: AnyActor,
  csvString: string,
  client: Tx | typeof prisma = prisma,
): Promise<ImportSummary> {
  assertPermission(actor, "customers.import");
  assertPermission(actor, "customers.manage");

  const parsed = Papa.parse<Record<string, string>>(csvString, {
    header: true,
    skipEmptyLines: true,
  });

  const summary: ImportSummary = {
    total: parsed.data.length,
    created: 0,
    updated: 0,
    errors: [],
  };

  const settings = await runtimeSettings(client);

  for (let i = 0; i < parsed.data.length; i++) {
    const rowNumber = i + 2;
    const row = parsed.data[i]!;
    const name = row.name?.trim();
    if (!name) {
      summary.errors.push({ row: rowNumber, message: "Nama pelanggan wajib diisi" });
      continue;
    }

    const code = row.code?.trim();
    const email = row.email?.trim() || null;
    const phone = row.phone?.trim() || null;
    const address = row.address?.trim() || null;
    const city = row.city?.trim() || null;
    const district = row.district?.trim() || null;
    const postalCode = row.postalCode?.trim() || null;
    const pppoeUsername = row.pppoeUsername?.trim() || null;
    const planCode = row.planCode?.trim() || null;
    const billingDayNum = row.billingDay ? parseInt(row.billingDay, 10) : null;

    try {
      await executeInTx(client, async (tx) => {
        let planId: string | null = null;
        if (planCode) {
          const plan = await tx.servicePlan.findUnique({ where: { code: planCode } });
          if (plan) planId = plan.id;
        }

        if (pppoeUsername) {
          const existingPppoe = await tx.customer.findUnique({
            where: { pppoeUsername },
          });
          if (existingPppoe && (!code || existingPppoe.code !== code)) {
            throw new ConflictError(`Username PPPoE '${pppoeUsername}' sudah digunakan`);
          }
        }

        if (code) {
          const existingByCode = await tx.customer.findUnique({ where: { code } });
          if (existingByCode) {
            await tx.customer.update({
              where: { id: existingByCode.id },
              data: {
                name,
                email,
                phone,
                address,
                city,
                district,
                postalCode,
                pppoeUsername,
                planId: planId !== undefined ? planId : existingByCode.planId,
                billingDay: billingDayNum && !isNaN(billingDayNum) ? billingDayNum : existingByCode.billingDay,
              },
            });
            summary.updated += 1;
            return;
          }
        }

        const assignedCode =
          code ||
          (await allocateDocumentNumber(
            tx,
            {
              format: settings.customerCodeFormat,
              prefix: settings.customerCodePrefix,
              resetPeriod: settings.customerCodeResetPeriod,
              scope: "CUSTOMER",
            },
            new Date(),
          ));

        const newCustomer = await tx.customer.create({
          data: {
            code: assignedCode,
            name,
            email,
            phone,
            address,
            city,
            district,
            postalCode,
            pppoeUsername,
            planId,
            billingDay: billingDayNum && !isNaN(billingDayNum) ? billingDayNum : settings.defaultBillingDay,
            dueDaysAfterIssue: settings.dueDaysAfterIssue,
            createdById: actor.kind === "user" ? actor.userId : null,
          },
        });

        if (planId) {
          const plan = await tx.servicePlan.findUnique({ where: { id: planId } });
          if (plan) {
            await tx.subscription.create({
              data: {
                customerId: newCustomer.id,
                planId: plan.id,
                priceMinor: plan.priceMinor,
                downloadKbps: plan.downloadKbps,
                uploadKbps: plan.uploadKbps,
                status: "ACTIVE",
                changeType: "NEW",
                startedAt: new Date(),
                createdById: actor.kind === "user" ? actor.userId : null,
              },
            });
          }
        }

        summary.created += 1;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gagal mengimpor baris";
      summary.errors.push({ row: rowNumber, message: msg });
    }
  }

  return summary;
}
