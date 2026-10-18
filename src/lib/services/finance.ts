import { z } from "zod";
import { prisma, executeInTx, type Tx } from "../db";
import {
  NotFoundError,
  type AnyActor,
  assertPermission,
} from "../permissions";
import { recordAudit } from "../audit";
import { minorToNumber, toMinor } from "../money";
import type { Expense } from "@prisma/client";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const createExpenseSchema = z.object({
  date: z.coerce.date().default(() => new Date()).optional(),
  categoryId: z.string().min(1, "Kategori pengeluaran wajib diisi"),
  amountMinor: z
    .number()
    .int("Jumlah pengeluaran harus bilangan bulat")
    .min(1, "Jumlah pengeluaran minimal 1"),
  description: z.string().min(1, "Deskripsi wajib diisi").max(300, "Deskripsi maksimal 300 karakter"),
  vendor: z.string().max(160, "Nama vendor maksimal 160 karakter").nullish(),
  reference: z.string().max(100, "Referensi maksimal 100 karakter").nullish(),
  methodId: z.string().nullish(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = createExpenseSchema.partial();
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export type ExpenseView = {
  id: string;
  date: Date;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  amountMinor: number;
  description: string;
  vendor: string | null;
  reference: string | null;
  methodId: string | null;
  methodName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ExpenseRow = Expense & {
  category: { code: string; name: string };
  method?: { name: string } | null;
};

function toExpenseView(row: ExpenseRow): ExpenseView {
  return {
    id: row.id,
    date: row.date,
    categoryId: row.categoryId,
    categoryCode: row.category.code,
    categoryName: row.category.name,
    amountMinor: minorToNumber(row.amountMinor),
    description: row.description,
    vendor: row.vendor,
    reference: row.reference,
    methodId: row.methodId,
    methodName: row.method?.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const expenseInclude = {
  category: { select: { code: true, name: true } },
  method: { select: { name: true } },
} as const;

// ---------------------------------------------------------------------------
// Expense CRUD
// ---------------------------------------------------------------------------

export async function createExpense(
  actor: AnyActor,
  rawInput: CreateExpenseInput,
  client: Tx | typeof prisma = prisma,
): Promise<ExpenseView> {
  assertPermission(actor, "finance.manage");
  const input = createExpenseSchema.parse(rawInput);
  const expenseDate = input.date ?? new Date();

  return await executeInTx(client, async (tx) => {
    const category = await tx.expenseCategory.findUnique({
      where: { id: input.categoryId },
    });
    if (!category) throw new NotFoundError("Kategori pengeluaran tidak ditemukan");

    if (input.methodId) {
      const method = await tx.paymentMethod.findUnique({
        where: { id: input.methodId },
      });
      if (!method) throw new NotFoundError("Metode pembayaran tidak ditemukan");
    }

    const expense = await tx.expense.create({
      data: {
        date: expenseDate,
        categoryId: input.categoryId,
        amountMinor: toMinor(input.amountMinor),
        description: input.description,
        vendor: input.vendor ?? null,
        reference: input.reference ?? null,
        methodId: input.methodId ?? null,
        createdById: actor.kind === "user" ? actor.userId : null,
      },
      include: expenseInclude,
    });

    await recordAudit(
      actor,
      {
        action: "expense.create",
        entityType: "Expense",
        entityId: expense.id,
        metadata: { amountMinor: input.amountMinor, categoryId: input.categoryId },
      },
      tx,
    );

    return toExpenseView(expense);
  });
}

export async function updateExpense(
  actor: AnyActor,
  expenseId: string,
  rawInput: UpdateExpenseInput,
  client: Tx | typeof prisma = prisma,
): Promise<ExpenseView> {
  assertPermission(actor, "finance.manage");
  const input = updateExpenseSchema.parse(rawInput);

  return await executeInTx(client, async (tx) => {
    const existing = await tx.expense.findUnique({ where: { id: expenseId } });
    if (!existing) throw new NotFoundError("Pengeluaran tidak ditemukan");

    if (input.categoryId) {
      const category = await tx.expenseCategory.findUnique({
        where: { id: input.categoryId },
      });
      if (!category) throw new NotFoundError("Kategori pengeluaran tidak ditemukan");
    }

    if (input.methodId) {
      const method = await tx.paymentMethod.findUnique({
        where: { id: input.methodId },
      });
      if (!method) throw new NotFoundError("Metode pembayaran tidak ditemukan");
    }

    const updated = await tx.expense.update({
      where: { id: expenseId },
      data: {
        date: input.date,
        categoryId: input.categoryId,
        amountMinor: input.amountMinor !== undefined ? toMinor(input.amountMinor) : undefined,
        description: input.description,
        vendor: input.vendor,
        reference: input.reference,
        methodId: input.methodId,
      },
      include: expenseInclude,
    });

    await recordAudit(
      actor,
      {
        action: "expense.update",
        entityType: "Expense",
        entityId: expenseId,
        metadata: input,
      },
      tx,
    );

    return toExpenseView(updated);
  });
}

export async function deleteExpense(
  actor: AnyActor,
  expenseId: string,
  client: Tx | typeof prisma = prisma,
): Promise<void> {
  assertPermission(actor, "finance.manage");

  await executeInTx(client, async (tx) => {
    const existing = await tx.expense.findUnique({ where: { id: expenseId } });
    if (!existing) throw new NotFoundError("Pengeluaran tidak ditemukan");

    await tx.expense.delete({ where: { id: expenseId } });

    await recordAudit(
      actor,
      {
        action: "expense.delete",
        entityType: "Expense",
        entityId: expenseId,
      },
      tx,
    );
  });
}

export type ExpenseFilters = {
  categoryId?: string;
  category?: string;
  methodId?: string;
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

export async function listExpenses(
  actor: AnyActor,
  filters: ExpenseFilters = {},
  pagination: Pagination = {},
  client: Tx | typeof prisma = prisma,
): Promise<PaginatedResult<ExpenseView>> {
  assertPermission(actor, "finance.view");
  const page = Math.max(1, pagination.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, pagination.pageSize ?? pagination.limit ?? 20));

  const where: Record<string, unknown> = {};
  const catId = filters.categoryId ?? filters.category;
  if (catId) where.categoryId = catId;
  if (filters.methodId) where.methodId = filters.methodId;
  if (filters.from || filters.to) {
    const dateFilter: Record<string, Date> = {};
    if (filters.from) dateFilter.gte = filters.from;
    if (filters.to) dateFilter.lte = filters.to;
    where.date = dateFilter;
  }
  if (filters.search) {
    where.OR = [
      { description: { contains: filters.search, mode: "insensitive" } },
      { vendor: { contains: filters.search, mode: "insensitive" } },
      { reference: { contains: filters.search, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    client.expense.count({ where }),
    client.expense.findMany({
      where,
      include: expenseInclude,
      orderBy: { date: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  return {
    data: rows.map(toExpenseView),
    total,
    page,
    pageSize,
  };
}

// ---------------------------------------------------------------------------
// Financial Summaries & Analytics
// ---------------------------------------------------------------------------

export type FinancialSummary = {
  revenueMinor: number;
  collectedMinor: number;
  outstandingMinor: number;
  expensesMinor: number;
  operatingResultMinor: number;
};

export type DateRange = {
  from?: Date;
  to?: Date;
};

export async function getFinancialSummary(
  actor: AnyActor,
  dateRange: DateRange = {},
  client: Tx | typeof prisma = prisma,
): Promise<FinancialSummary> {
  assertPermission(actor, "finance.view");

  const invoiceWhere: Record<string, unknown> = {
    status: { not: "VOID" },
  };
  if (dateRange.from || dateRange.to) {
    const df: Record<string, Date> = {};
    if (dateRange.from) df.gte = dateRange.from;
    if (dateRange.to) df.lte = dateRange.to;
    invoiceWhere.issueDate = df;
  }

  const paymentWhere: Record<string, unknown> = {
    status: "POSTED",
  };
  if (dateRange.from || dateRange.to) {
    const df: Record<string, Date> = {};
    if (dateRange.from) df.gte = dateRange.from;
    if (dateRange.to) df.lte = dateRange.to;
    paymentWhere.paidAt = df;
  }

  const expenseWhere: Record<string, unknown> = {};
  if (dateRange.from || dateRange.to) {
    const df: Record<string, Date> = {};
    if (dateRange.from) df.gte = dateRange.from;
    if (dateRange.to) df.lte = dateRange.to;
    expenseWhere.date = df;
  }

  const [invoices, payments, outstandingInvoices, expenses] = await Promise.all([
    client.invoice.findMany({
      where: invoiceWhere,
      select: { totalMinor: true },
    }),
    client.payment.findMany({
      where: paymentWhere,
      select: { amountMinor: true },
    }),
    client.invoice.findMany({
      where: {
        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
      },
      select: { totalMinor: true, paidMinor: true },
    }),
    client.expense.findMany({
      where: expenseWhere,
      select: { amountMinor: true },
    }),
  ]);

  let revenue = 0n;
  for (const inv of invoices) revenue += inv.totalMinor;

  let collected = 0n;
  for (const pay of payments) collected += pay.amountMinor;

  let outstanding = 0n;
  for (const inv of outstandingInvoices) {
    outstanding += inv.totalMinor - inv.paidMinor;
  }

  let totalExpenses = 0n;
  for (const exp of expenses) totalExpenses += exp.amountMinor;

  const operatingResult = collected - totalExpenses;

  return {
    revenueMinor: minorToNumber(revenue),
    collectedMinor: minorToNumber(collected),
    outstandingMinor: minorToNumber(outstanding),
    expensesMinor: minorToNumber(totalExpenses),
    operatingResultMinor: minorToNumber(operatingResult),
  };
}

export type MonthlyRevenue = {
  month: string; // YYYY-MM
  revenue: number;
  collected: number;
};

export async function getRevenueByMonth(
  actor: AnyActor,
  months = 12,
  client: Tx | typeof prisma = prisma,
): Promise<MonthlyRevenue[]> {
  assertPermission(actor, "finance.view");

  const now = new Date();
  const startDate = new Date(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1);

  const [invoices, payments] = await Promise.all([
    client.invoice.findMany({
      where: {
        status: { not: "VOID" },
        issueDate: { gte: startDate },
      },
      select: { issueDate: true, totalMinor: true },
    }),
    client.payment.findMany({
      where: {
        status: "POSTED",
        paidAt: { gte: startDate },
      },
      select: { paidAt: true, amountMinor: true },
    }),
  ]);

  const map = new Map<string, { revenue: bigint; collected: bigint }>();

  for (let i = 0; i < months; i++) {
    const d = new Date(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    map.set(key, { revenue: 0n, collected: 0n });
  }

  for (const inv of invoices) {
    const d = inv.issueDate;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const curr = map.get(key);
    if (curr) {
      curr.revenue += inv.totalMinor;
    }
  }

  for (const pay of payments) {
    const d = pay.paidAt;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const curr = map.get(key);
    if (curr) {
      curr.collected += pay.amountMinor;
    }
  }

  const result: MonthlyRevenue[] = [];
  for (const [month, vals] of map.entries()) {
    result.push({
      month,
      revenue: minorToNumber(vals.revenue),
      collected: minorToNumber(vals.collected),
    });
  }

  result.sort((a, b) => a.month.localeCompare(b.month));
  return result;
}

export type CollectionByMethod = {
  methodId: string | null;
  methodName: string;
  amount: number;
  count: number;
};

export async function getCollectionByMethod(
  actor: AnyActor,
  dateRange: DateRange = {},
  client: Tx | typeof prisma = prisma,
): Promise<CollectionByMethod[]> {
  assertPermission(actor, "finance.view");

  const where: Record<string, unknown> = {
    status: "POSTED",
  };
  if (dateRange.from || dateRange.to) {
    const df: Record<string, Date> = {};
    if (dateRange.from) df.gte = dateRange.from;
    if (dateRange.to) df.lte = dateRange.to;
    where.paidAt = df;
  }

  const payments = await client.payment.findMany({
    where,
    include: { method: { select: { name: true } } },
  });

  const summaryMap = new Map<string, { name: string; amount: bigint; count: number }>();

  for (const pay of payments) {
    const key = pay.methodId ?? "unspecified";
    const name = pay.method?.name ?? "Lainnya / Tunai";
    const curr = summaryMap.get(key) ?? { name, amount: 0n, count: 0 };
    curr.amount += pay.amountMinor;
    curr.count += 1;
    summaryMap.set(key, curr);
  }

  const result: CollectionByMethod[] = [];
  for (const [methodId, vals] of summaryMap.entries()) {
    result.push({
      methodId: methodId === "unspecified" ? null : methodId,
      methodName: vals.name,
      amount: minorToNumber(vals.amount),
      count: vals.count,
    });
  }

  result.sort((a, b) => b.amount - a.amount);
  return result;
}
