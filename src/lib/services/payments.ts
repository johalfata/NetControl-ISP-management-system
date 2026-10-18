import { z } from "zod";
import { prisma, executeInTx, type Tx } from "../db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AnyActor,
  assertPermission,
} from "../permissions";
import { recordAudit } from "../audit";
import { minorToNumber, toMinor, minMinor } from "../money";
import { runtimeSettings } from "../settings/service";
import { allocateDocumentNumber } from "./numbering";
import type { Payment, PaymentAllocation } from "@prisma/client";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const createPaymentSchema = z.object({
  customerId: z.string().min(1, "Pelanggan wajib diisi"),
  methodId: z.string().nullish(),
  amountMinor: z
    .number()
    .int("Jumlah pembayaran harus bilangan bulat")
    .min(1, "Jumlah pembayaran minimal 1"),
  paidAt: z.coerce.date().default(() => new Date()).optional(),
  reference: z.string().max(100, "Referensi maksimal 100 karakter").nullish(),
  proofUrl: z.string().max(500, "URL bukti bayar maksimal 500 karakter").nullish(),
  notes: z.string().max(500, "Catatan maksimal 500 karakter").nullish(),
  idempotencyKey: z.string().max(100).nullish(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type PaymentAllocationView = {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountMinor: number;
};

export type PaymentView = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  methodId: string | null;
  methodName: string | null;
  amountMinor: number;
  status: string;
  paidAt: Date;
  reference: string | null;
  proofUrl: string | null;
  notes: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
  receivedById: string | null;
  allocations: PaymentAllocationView[];
  createdAt: Date;
};

type PaymentRow = Payment & {
  customer: { name: string; code: string };
  method?: { name: string } | null;
  allocations: (PaymentAllocation & { invoice: { number: string } })[];
};

function toPaymentView(row: PaymentRow): PaymentView {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerCode: row.customer.code,
    methodId: row.methodId,
    methodName: row.method?.name ?? null,
    amountMinor: minorToNumber(row.amountMinor),
    status: row.status,
    paidAt: row.paidAt,
    reference: row.reference,
    proofUrl: row.proofUrl,
    notes: row.notes,
    voidedAt: row.voidedAt,
    voidReason: row.voidReason,
    receivedById: row.receivedById,
    allocations: row.allocations.map((a) => ({
      id: a.id,
      invoiceId: a.invoiceId,
      invoiceNumber: a.invoice.number,
      amountMinor: minorToNumber(a.amountMinor),
    })),
    createdAt: row.createdAt,
  };
}

const paymentInclude = {
  customer: { select: { name: true, code: true } },
  method: { select: { name: true } },
  allocations: {
    include: { invoice: { select: { number: true } } },
  },
} as const;

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export async function recordPayment(
  actor: AnyActor,
  rawInput: CreatePaymentInput,
  client: Tx | typeof prisma = prisma,
): Promise<PaymentView> {
  assertPermission(actor, "payments.manage");
  const input = createPaymentSchema.parse(rawInput);

  if (input.idempotencyKey) {
    const existing = await client.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: paymentInclude,
    });
    if (existing) return toPaymentView(existing);
  }

  const settings = await runtimeSettings(client);
  const payAmount = toMinor(input.amountMinor);
  const paidAtDate = input.paidAt ?? new Date();

  return await executeInTx(client, async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new NotFoundError("Pelanggan tidak ditemukan");

    if (input.methodId) {
      const method = await tx.paymentMethod.findUnique({
        where: { id: input.methodId },
      });
      if (!method) throw new NotFoundError("Metode pembayaran tidak ditemukan");
    }

    const paymentNumber = await allocateDocumentNumber(
      tx,
      {
        format: settings.paymentNumberFormat,
        prefix: settings.paymentNumberPrefix,
        resetPeriod: settings.paymentNumberResetPeriod,
        scope: "PAYMENT",
      },
      paidAtDate,
    );

    const payment = await tx.payment.create({
      data: {
        number: paymentNumber,
        customerId: input.customerId,
        methodId: input.methodId ?? null,
        amountMinor: payAmount,
        status: "POSTED",
        paidAt: paidAtDate,
        reference: input.reference ?? null,
        proofUrl: input.proofUrl ?? null,
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        receivedById: actor.kind === "user" ? actor.userId : null,
      },
    });

    const unpaidInvoices = await tx.invoice.findMany({
      where: {
        customerId: input.customerId,
        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
      },
      orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }],
    });

    let remaining = payAmount;

    for (const inv of unpaidInvoices) {
      if (remaining <= 0n) break;
      const balance = inv.totalMinor - inv.paidMinor;
      if (balance <= 0n) continue;

      const allocate = minMinor(remaining, balance);
      const newPaid = inv.paidMinor + allocate;
      const newStatus = newPaid >= inv.totalMinor ? "PAID" : "PARTIALLY_PAID";

      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: inv.id,
          amountMinor: allocate,
        },
      });

      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          paidMinor: newPaid,
          status: newStatus,
        },
      });

      remaining -= allocate;
    }

    if (settings.autoResumeOnPayment && customer.status === "SUSPENDED") {
      const remainingOverdue = await tx.invoice.count({
        where: {
          customerId: input.customerId,
          status: { in: ["ISSUED", "PARTIALLY_PAID"] },
          dueDate: { lt: new Date() },
        },
      });
      if (remainingOverdue === 0) {
        await tx.customer.update({
          where: { id: input.customerId },
          data: { status: "ACTIVE" },
        });
      }
    }

    await recordAudit(
      actor,
      {
        action: "payment.create",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { number: paymentNumber, amountMinor: input.amountMinor },
      },
      tx,
    );

    const fullPayment = await tx.payment.findUnique({
      where: { id: payment.id },
      include: paymentInclude,
    });

    return toPaymentView(fullPayment!);
  });
}

export async function voidPayment(
  actor: AnyActor,
  paymentId: string,
  reason: string,
  client: Tx | typeof prisma = prisma,
): Promise<PaymentView> {
  assertPermission(actor, "payments.void");
  if (!reason || reason.trim() === "") {
    throw new ValidationError("Alasan pembatalan pembayaran wajib diisi");
  }

  return await executeInTx(client, async (tx) => {
    const payment = await tx.payment.findUnique({
      where: { id: paymentId },
      include: {
        allocations: {
          include: { invoice: true },
        },
        customer: { select: { name: true, code: true } },
        method: { select: { name: true } },
      },
    });

    if (!payment) throw new NotFoundError("Pembayaran tidak ditemukan");
    if (payment.status === "VOID") {
      throw new ConflictError("Pembayaran sudah dibatalkan sebelumnya");
    }

    for (const alloc of payment.allocations) {
      const inv = alloc.invoice;
      const newPaid = inv.paidMinor - alloc.amountMinor;
      const newStatus =
        newPaid <= 0n
          ? "ISSUED"
          : newPaid < inv.totalMinor
            ? "PARTIALLY_PAID"
            : "PAID";

      await tx.invoice.update({
        where: { id: inv.id },
        data: {
          paidMinor: newPaid < 0n ? 0n : newPaid,
          status: newStatus,
        },
      });
    }

    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: "VOID",
        voidedAt: new Date(),
        voidedById: actor.kind === "user" ? actor.userId : null,
        voidReason: reason,
      },
      include: paymentInclude,
    });

    await recordAudit(
      actor,
      {
        action: "payment.void",
        entityType: "Payment",
        entityId: paymentId,
        metadata: { reason },
      },
      tx,
    );

    return toPaymentView(updated);
  });
}

export async function getPayment(
  actor: AnyActor,
  paymentId: string,
  client: Tx | typeof prisma = prisma,
): Promise<PaymentView> {
  assertPermission(actor, "payments.view");
  const payment = await client.payment.findUnique({
    where: { id: paymentId },
    include: paymentInclude,
  });
  if (!payment) throw new NotFoundError("Pembayaran tidak ditemukan");
  return toPaymentView(payment);
}

export type PaymentFilters = {
  customerId?: string;
  methodId?: string;
  status?: string;
  from?: Date;
  to?: Date;
  search?: string;
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

export async function listPayments(
  actor: AnyActor,
  filters: PaymentFilters = {},
  pagination: Pagination = {},
  client: Tx | typeof prisma = prisma,
): Promise<PaginatedResult<PaymentView>> {
  assertPermission(actor, "payments.view");
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? pagination.limit ?? 20));

  const where: Record<string, unknown> = {};
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.methodId) where.methodId = filters.methodId;
  if (filters.status) where.status = filters.status;
  if (filters.from || filters.to) {
    const dateFilter: Record<string, Date> = {};
    if (filters.from) dateFilter.gte = filters.from;
    if (filters.to) dateFilter.lte = filters.to;
    where.paidAt = dateFilter;
  }
  if (filters.search) {
    where.OR = [
      { number: { contains: filters.search, mode: "insensitive" } },
      { reference: { contains: filters.search, mode: "insensitive" } },
      { customer: { name: { contains: filters.search, mode: "insensitive" } } },
      { customer: { code: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const [total, rows] = await Promise.all([
    client.payment.count({ where }),
    client.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: { paidAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map(toPaymentView),
    total,
    page,
    pageSize,
  };
}

export type CustomerBalance = {
  customerId: string;
  totalBilled: number;
  totalPaid: number;
  balance: number;
};

export async function getCustomerBalance(
  actor: AnyActor,
  customerId: string,
  client: Tx | typeof prisma = prisma,
): Promise<CustomerBalance> {
  assertPermission(actor, "payments.view");
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) throw new NotFoundError("Pelanggan tidak ditemukan");

  const [invoices, payments] = await Promise.all([
    client.invoice.findMany({
      where: { customerId, status: { not: "VOID" } },
      select: { totalMinor: true, paidMinor: true },
    }),
    client.payment.findMany({
      where: { customerId, status: "POSTED" },
      select: { amountMinor: true },
    }),
  ]);

  let totalBilled = 0n;
  let totalPaid = 0n;

  for (const inv of invoices) {
    totalBilled += inv.totalMinor;
  }
  for (const pay of payments) {
    totalPaid += pay.amountMinor;
  }

  const balance = totalBilled - totalPaid;

  return {
    customerId,
    totalBilled: minorToNumber(totalBilled),
    totalPaid: minorToNumber(totalPaid),
    balance: minorToNumber(balance),
  };
}
