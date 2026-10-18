import { z } from "zod";
import { prisma, withSerializableTx, type Tx } from "../db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type AnyActor,
  assertPermission,
  assertUserActor,
} from "../permissions";
import { recordAudit } from "../audit";
import {
  addMinor,
  minorToNumber,
  percentOfMinor,
  toMinor,
  type Minor,
} from "../money";
import { runtimeSettings, type RuntimeSettings } from "../settings/service";
import { allocateDocumentNumber } from "./numbering";
import {
  zonedBillingDate,
  zonedParts,
  zonedPeriodKey,
  addDaysZoned,
} from "../datetime";
import type {
  Customer,
  Invoice,
  InvoiceLine,
  InvoiceStatus,
  Subscription,
} from "@prisma/client";

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type InvoiceLineView = {
  id: string;
  kind: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  amountMinor: number;
  sortOrder: number;
};

export type InvoiceView = {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerCode: string;
  planId: string | null;
  subscriptionId: string | null;
  status: string;
  source: string;
  issueDate: Date;
  dueDate: Date;
  periodStart: Date;
  periodEnd: Date;
  billingPeriodKey: string | null;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  notes: string | null;
  lines: InvoiceLineView[];
  createdAt: Date;
};

type InvoiceRow = Invoice & {
  lines: InvoiceLine[];
  customer: { name: string; code: string };
};

function lineToView(line: InvoiceLine): InvoiceLineView {
  return {
    id: line.id,
    kind: line.kind,
    description: line.description,
    quantity: line.quantity,
    unitPriceMinor: minorToNumber(line.unitPriceMinor),
    amountMinor: minorToNumber(line.amountMinor),
    sortOrder: line.sortOrder,
  };
}

function toView(row: InvoiceRow): InvoiceView {
  return {
    id: row.id,
    number: row.number,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerCode: row.customer.code,
    planId: row.planId,
    subscriptionId: row.subscriptionId,
    status: row.status,
    source: row.source,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    billingPeriodKey: row.billingPeriodKey,
    subtotalMinor: minorToNumber(row.subtotalMinor),
    discountMinor: minorToNumber(row.discountMinor),
    taxMinor: minorToNumber(row.taxMinor),
    totalMinor: minorToNumber(row.totalMinor),
    paidMinor: minorToNumber(row.paidMinor),
    notes: row.notes,
    lines: row.lines.map(lineToView),
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Invoice include fragment
// ---------------------------------------------------------------------------

const invoiceInclude = {
  lines: { orderBy: { sortOrder: "asc" as const } },
  customer: { select: { name: true, code: true } },
} as const;

// ---------------------------------------------------------------------------
// Tax helpers
// ---------------------------------------------------------------------------

function computeTax(
  subtotal: Minor,
  settings: RuntimeSettings,
): { taxMinor: Minor; taxLabel: string } {
  if (!settings.taxEnabled || settings.taxPercent <= 0) {
    return { taxMinor: 0n, taxLabel: "" };
  }
  if (settings.taxInclusive) {
    // Inclusive: extract tax from subtotal.
    // subtotal = base + tax = base * (1 + rate).  tax = subtotal - subtotal / (1 + rate)
    const rateScaled = BigInt(Math.round(settings.taxPercent * 10_000));
    const divisor = 1_000_000n + rateScaled * 100n; // (1 + rate) * 1_000_000
    const baseScaled = subtotal * 1_000_000n;
    const base = baseScaled / divisor;
    const remainder = baseScaled % divisor;
    const roundedBase = remainder * 2n >= divisor ? base + 1n : base;
    return { taxMinor: subtotal - roundedBase, taxLabel: settings.taxLabel };
  }
  // Exclusive: add tax on top
  return {
    taxMinor: percentOfMinor(subtotal, settings.taxPercent),
    taxLabel: settings.taxLabel,
  };
}

// ---------------------------------------------------------------------------
// Generate invoices for period (billing run)
// ---------------------------------------------------------------------------

export type BillingRunOptions = {
  targetDate: Date;
  dryRun?: boolean;
};

export type BillingRunResult = {
  created: number;
  skipped: number;
  errors: { customerId: string; error: string }[];
};

/**
 * Billing run utama. Untuk setiap pelanggan ACTIVE dengan paket, buat invoice
 * untuk periode berdasarkan billingDay. Idempoten melalui unique constraint
 * (subscriptionId, billingPeriodKey).
 *
 * Permission: billing.manage
 */
export async function generateInvoicesForPeriod(
  actor: AnyActor,
  options: BillingRunOptions,
): Promise<BillingRunResult> {
  assertPermission(actor, "billing.manage");
  const settings = await runtimeSettings();
  const tz = settings.timezone;
  const targetDate = options.targetDate;
  const result: BillingRunResult = { created: 0, skipped: 0, errors: [] };

  // Fetch eligible customers
  const customers = await prisma.customer.findMany({
    where: {
      status: "ACTIVE",
      planId: { not: null },
    },
    include: {
      plan: true,
      subscriptions: {
        where: { status: "ACTIVE" },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
  });

  for (const customer of customers) {
    try {
      const subscription = customer.subscriptions[0];
      if (!subscription || !customer.plan) {
        result.skipped += 1;
        continue;
      }

      const billingDay = customer.billingDay ?? settings.defaultBillingDay;
      const periodStart = zonedBillingDate(tz, targetDate, billingDay);
      const periodEnd = zonedBillingDate(tz, targetDate, billingDay, 1);
      const billingPeriodKey = zonedPeriodKey(periodStart, tz);

      // Check if we should generate for this period: the period start
      // must be on or before target date (we bill at the start of the period)
      const targetParts = zonedParts(targetDate, tz);
      const periodParts = zonedParts(periodStart, tz);
      if (
        periodParts.year > targetParts.year ||
        (periodParts.year === targetParts.year && periodParts.month > targetParts.month) ||
        (periodParts.year === targetParts.year &&
          periodParts.month === targetParts.month &&
          periodParts.day > targetParts.day)
      ) {
        result.skipped += 1;
        continue;
      }

      if (options.dryRun) {
        // Check idempotency without creating
        const exists = await prisma.invoice.findUnique({
          where: {
            invoice_subscription_period: {
              subscriptionId: subscription.id,
              billingPeriodKey,
            },
          },
          select: { id: true },
        });
        if (exists) {
          result.skipped += 1;
        } else {
          result.created += 1;
        }
        continue;
      }

      // Create invoice in serializable tx
      await withSerializableTx(async (tx) => {
        // Double-check idempotency inside tx
        const exists = await tx.invoice.findUnique({
          where: {
            invoice_subscription_period: {
              subscriptionId: subscription.id,
              billingPeriodKey,
            },
          },
          select: { id: true },
        });
        if (exists) {
          result.skipped += 1;
          return;
        }

        await createAutoInvoice(
          tx,
          actor,
          customer as Customer & { plan: NonNullable<typeof customer.plan> },
          subscription,
          {
            periodStart,
            periodEnd,
            billingPeriodKey,
            issueDate: targetDate,
          },
          settings,
        );
        result.created += 1;
      });
    } catch (error) {
      result.errors.push({
        customerId: customer.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await recordAudit(actor, {
    action: "billing.run",
    entityType: "Invoice",
    metadata: {
      targetDate: targetDate.toISOString(),
      created: result.created,
      skipped: result.skipped,
      errors: result.errors.length,
      dryRun: options.dryRun ?? false,
    },
  });

  return result;
}

async function createAutoInvoice(
  tx: Tx,
  actor: AnyActor,
  customer: Customer & { plan: { id: string; name: string; priceMinor: bigint } },
  subscription: Subscription,
  period: {
    periodStart: Date;
    periodEnd: Date;
    billingPeriodKey: string;
    issueDate: Date;
  },
  settings: RuntimeSettings,
): Promise<void> {
  const priceMinor = subscription.priceMinor;
  const subtotal = priceMinor;
  const { taxMinor, taxLabel } = computeTax(subtotal, settings);

  const total = settings.taxInclusive ? subtotal : addMinor(subtotal, taxMinor);

  const dueDays = customer.dueDaysAfterIssue ?? settings.dueDaysAfterIssue;
  const dueDate = addDaysZoned(period.issueDate, settings.timezone, dueDays);

  const invoiceNumber = await allocateDocumentNumber(tx, {
    scope: "INVOICE",
    format: settings.invoiceNumberFormat,
    prefix: settings.invoiceNumberPrefix,
    resetPeriod: settings.invoiceNumberResetPeriod,
  }, period.issueDate);

  const idempotencyKey = `auto:${customer.id}:${period.billingPeriodKey}`;

  const lines: {
    kind: "SUBSCRIPTION" | "ADDON" | "PENALTY" | "ADJUSTMENT" | "OTHER";
    description: string;
    quantity: number;
    unitPriceMinor: bigint;
    amountMinor: bigint;
    sortOrder: number;
  }[] = [
    {
      kind: "SUBSCRIPTION",
      description: `Langganan ${customer.plan.name}`,
      quantity: 1,
      unitPriceMinor: priceMinor,
      amountMinor: priceMinor,
      sortOrder: 0,
    },
  ];

  if (taxMinor > 0n && !settings.taxInclusive) {
    lines.push({
      kind: "OTHER",
      description: taxLabel || "Pajak",
      quantity: 1,
      unitPriceMinor: taxMinor,
      amountMinor: taxMinor,
      sortOrder: 10,
    });
  }

  const actorId = actor.kind === "user" ? actor.userId : null;

  await tx.invoice.create({
    data: {
      number: invoiceNumber,
      customerId: customer.id,
      planId: customer.plan.id,
      subscriptionId: subscription.id,
      status: "ISSUED",
      source: "AUTO",
      issueDate: period.issueDate,
      dueDate,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      billingPeriodKey: period.billingPeriodKey,
      subtotalMinor: subtotal,
      discountMinor: 0n,
      taxMinor,
      totalMinor: total,
      paidMinor: 0n,
      idempotencyKey,
      createdById: actorId,
      lines: { create: lines },
    },
  });
}

// ---------------------------------------------------------------------------
// Manual invoice
// ---------------------------------------------------------------------------

export const manualInvoiceLineSchema = z.object({
  kind: z.enum(["SUBSCRIPTION", "ADDON", "PENALTY", "ADJUSTMENT", "OTHER"]),
  description: z.string().min(1, "Deskripsi baris wajib diisi"),
  quantity: z.number().int().min(1, "Kuantitas minimal 1").default(1),
  unitPriceMinor: z
    .number()
    .int("Harga satuan harus bilangan bulat")
    .min(0, "Harga satuan tidak boleh negatif"),
});

export const createManualInvoiceSchema = z.object({
  customerId: z.string().min(1, "ID pelanggan wajib diisi"),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  lines: z
    .array(manualInvoiceLineSchema)
    .min(1, "Minimal satu baris invoice"),
  notes: z.string().max(500).nullish(),
});
export type CreateManualInvoiceInput = z.infer<typeof createManualInvoiceSchema>;

/**
 * Buat invoice manual.
 * Permission: billing.manage
 */
export async function createManualInvoice(
  actor: AnyActor,
  input: CreateManualInvoiceInput,
): Promise<InvoiceView> {
  assertPermission(actor, "billing.manage");
  assertUserActor(actor);
  const data = createManualInvoiceSchema.parse(input);

  const customer = await prisma.customer.findUnique({
    where: { id: data.customerId },
    select: { id: true, name: true },
  });
  if (!customer) {
    throw new NotFoundError("Pelanggan tidak ditemukan");
  }

  if (data.dueDate < data.issueDate) {
    throw new ValidationError("Tanggal jatuh tempo tidak boleh sebelum tanggal terbit");
  }

  const settings = await runtimeSettings();

  const result = await withSerializableTx(async (tx) => {
    const invoiceNumber = await allocateDocumentNumber(tx, {
      scope: "INVOICE",
      format: settings.invoiceNumberFormat,
      prefix: settings.invoiceNumberPrefix,
      resetPeriod: settings.invoiceNumberResetPeriod,
    }, data.issueDate);

    const lineRecords = data.lines.map((line, i) => {
      const amount = toMinor(line.unitPriceMinor) * BigInt(line.quantity);
      return {
        kind: line.kind as "SUBSCRIPTION" | "ADDON" | "PENALTY" | "ADJUSTMENT" | "OTHER",
        description: line.description,
        quantity: line.quantity,
        unitPriceMinor: toMinor(line.unitPriceMinor),
        amountMinor: amount,
        sortOrder: i,
      };
    });

    const subtotal = lineRecords.reduce<bigint>((sum, l) => sum + l.amountMinor, 0n);
    const { taxMinor } = computeTax(subtotal, settings);
    const total = settings.taxInclusive ? subtotal : addMinor(subtotal, taxMinor);

    if (taxMinor > 0n && !settings.taxInclusive) {
      lineRecords.push({
        kind: "OTHER",
        description: settings.taxLabel || "Pajak",
        quantity: 1,
        unitPriceMinor: taxMinor,
        amountMinor: taxMinor,
        sortOrder: lineRecords.length,
      });
    }

    const invoice = await tx.invoice.create({
      data: {
        number: invoiceNumber,
        customerId: data.customerId,
        status: "ISSUED",
        source: "MANUAL",
        issueDate: data.issueDate,
        dueDate: data.dueDate,
        periodStart: data.issueDate,
        periodEnd: data.dueDate,
        subtotalMinor: subtotal,
        discountMinor: 0n,
        taxMinor,
        totalMinor: total,
        paidMinor: 0n,
        notes: data.notes ?? null,
        createdById: actor.userId,
        lines: { create: lineRecords },
      },
      include: invoiceInclude,
    });

    await recordAudit(
      actor,
      {
        action: "invoice.create_manual",
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: { number: invoice.number, totalMinor: minorToNumber(total) },
      },
      tx,
    );

    return invoice;
  });

  return toView(result);
}

// ---------------------------------------------------------------------------
// Void invoice
// ---------------------------------------------------------------------------

/**
 * Void invoice. Hanya bisa jika paidMinor == 0.
 * Permission: billing.void
 */
export async function voidInvoice(
  actor: AnyActor,
  invoiceId: string,
  reason: string,
): Promise<InvoiceView> {
  assertPermission(actor, "billing.void");
  assertUserActor(actor);

  if (!reason || reason.trim().length === 0) {
    throw new ValidationError("Alasan void wajib diisi");
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: invoiceInclude,
  });
  if (!invoice) throw new NotFoundError("Invoice tidak ditemukan");
  if (invoice.status === "VOID") {
    throw new ValidationError("Invoice sudah divoid");
  }
  if (invoice.paidMinor !== 0n) {
    throw new ConflictError(
      "Tidak dapat void invoice yang sudah memiliki pembayaran",
    );
  }

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: "VOID",
      voidedAt: new Date(),
      voidedById: actor.userId,
      voidReason: reason.trim(),
    },
    include: invoiceInclude,
  });

  await recordAudit(actor, {
    action: "invoice.void",
    entityType: "Invoice",
    entityId: invoiceId,
    metadata: { number: invoice.number, reason },
  });

  return toView(updated);
}

// ---------------------------------------------------------------------------
// Recalculate invoice status
// ---------------------------------------------------------------------------

/**
 * Hitung ulang paidMinor dari allocation dan set status.
 * Dipanggil di dalam transaksi setelah payment/void payment.
 */
export async function recalculateInvoiceStatus(
  tx: Tx,
  invoiceId: string,
): Promise<void> {
  const allocations = await tx.paymentAllocation.findMany({
    where: {
      invoiceId,
      payment: { status: "POSTED" },
    },
    select: { amountMinor: true },
  });

  const paidMinor = allocations.reduce<bigint>(
    (sum, a) => sum + a.amountMinor,
    0n,
  );

  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { totalMinor: true, status: true },
  });
  if (!invoice || invoice.status === "VOID") return;

  let newStatus: InvoiceStatus;
  if (paidMinor >= invoice.totalMinor) {
    newStatus = "PAID";
  } else if (paidMinor > 0n) {
    newStatus = "PARTIALLY_PAID";
  } else {
    newStatus = "ISSUED";
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { paidMinor, status: newStatus },
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getInvoice(invoiceId: string): Promise<InvoiceView> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: invoiceInclude,
  });
  if (!invoice) throw new NotFoundError("Invoice tidak ditemukan");
  return toView(invoice);
}

export type InvoiceFilters = {
  customerId?: string;
  status?: string;
  source?: string;
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

export async function listInvoices(
  filters: InvoiceFilters = {},
  pagination: Pagination = {},
): Promise<PaginatedResult<InvoiceView>> {
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? pagination.limit ?? 20));

  const where: Record<string, unknown> = {};
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.status) where.status = filters.status;
  if (filters.source) where.source = filters.source;
  if (filters.from || filters.to) {
    const dateFilter: Record<string, Date> = {};
    if (filters.from) dateFilter.gte = filters.from;
    if (filters.to) dateFilter.lte = filters.to;
    where.issueDate = dateFilter;
  }
  if (filters.search) {
    where.OR = [
      { number: { contains: filters.search, mode: "insensitive" } },
      { customer: { name: { contains: filters.search, mode: "insensitive" } } },
      { customer: { code: { contains: filters.search, mode: "insensitive" } } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      include: invoiceInclude,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return { data: rows.map(toView), total, page, pageSize };
}

// ---------------------------------------------------------------------------
// Customer statement
// ---------------------------------------------------------------------------

export type StatementEntry = {
  date: Date;
  type: "invoice" | "payment";
  number: string;
  description: string;
  amountMinor: number;
  balanceEffect: number; // positive = charge, negative = payment
  status: string;
};

export type CustomerStatement = {
  customerId: string;
  from: Date;
  to: Date;
  entries: StatementEntry[];
  totalCharged: number;
  totalPaid: number;
  balance: number;
};

export async function getCustomerStatement(
  customerId: string,
  dateRange: { from: Date; to: Date },
): Promise<CustomerStatement> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true },
  });
  if (!customer) throw new NotFoundError("Pelanggan tidak ditemukan");

  const [invoices, payments] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        customerId,
        status: { not: "VOID" },
        issueDate: { gte: dateRange.from, lte: dateRange.to },
      },
      orderBy: { issueDate: "asc" },
      select: {
        issueDate: true,
        number: true,
        totalMinor: true,
        status: true,
        source: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        customerId,
        status: "POSTED",
        paidAt: { gte: dateRange.from, lte: dateRange.to },
      },
      orderBy: { paidAt: "asc" },
      select: {
        paidAt: true,
        number: true,
        amountMinor: true,
        status: true,
      },
    }),
  ]);

  const entries: StatementEntry[] = [];

  let totalCharged = 0n;
  let totalPaid = 0n;

  for (const inv of invoices) {
    const amt = inv.totalMinor;
    totalCharged += amt;
    entries.push({
      date: inv.issueDate,
      type: "invoice",
      number: inv.number,
      description: `Invoice ${inv.number} (${inv.source})`,
      amountMinor: minorToNumber(amt),
      balanceEffect: minorToNumber(amt),
      status: inv.status,
    });
  }

  for (const pay of payments) {
    const amt = pay.amountMinor;
    totalPaid += amt;
    entries.push({
      date: pay.paidAt,
      type: "payment",
      number: pay.number,
      description: `Pembayaran ${pay.number}`,
      amountMinor: minorToNumber(amt),
      balanceEffect: -minorToNumber(amt),
      status: pay.status,
    });
  }

  entries.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    customerId,
    from: dateRange.from,
    to: dateRange.to,
    entries,
    totalCharged: minorToNumber(totalCharged),
    totalPaid: minorToNumber(totalPaid),
    balance: minorToNumber(totalCharged - totalPaid),
  };
}
