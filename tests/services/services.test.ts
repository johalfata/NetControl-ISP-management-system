import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../../src/lib/db";
import { ensureTestUser, TEST_ACTOR, withRollback } from "../network/helpers";
import { createCustomer, getCustomer, listCustomers, importCustomers, exportCustomers } from "../../src/lib/services/customers";
import { recordPayment, voidPayment, getCustomerBalance } from "../../src/lib/services/payments";
import { createExpense, getFinancialSummary, getRevenueByMonth, getCollectionByMethod } from "../../src/lib/services/finance";

describe("Services: Customers, Payments, Finance", () => {
  beforeAll(async () => {
    await ensureTestUser();
  });

  it("should create and manage customers", async () => {
    await withRollback(async (tx) => {
      // Create plan first
      const plan = await tx.servicePlan.create({
        data: {
          code: "PLAN-10M",
          name: "Paket 10 Mbps",
          priceMinor: 150_000n,
          downloadKbps: 10000,
          uploadKbps: 10000,
        },
      });

      const customer = await createCustomer(
        TEST_ACTOR,
        {
          name: "Budi Santoso",
          email: "budi@example.com",
          phone: "081234567890",
          planId: plan.id,
          pppoeUsername: "budi_pppoe",
        },
        tx,
      );

      expect(customer).toBeDefined();
      expect(customer.name).toBe("Budi Santoso");
      expect(customer.code).toBeDefined();
      expect(customer.planId).toBe(plan.id);

      const fetched = await getCustomer(TEST_ACTOR, customer.id, tx);
      expect(fetched.name).toBe("Budi Santoso");
      expect(fetched.activeSubscription).toBeDefined();

      const listed = await listCustomers(TEST_ACTOR, { search: "Budi" }, {}, tx);
      expect(listed.total).toBe(1);
      expect(listed.data[0]?.id).toBe(customer.id);

      const csv = await exportCustomers(TEST_ACTOR, {}, tx);
      expect(csv).toContain("Budi Santoso");

      const summary = await importCustomers(
        TEST_ACTOR,
        `code,name,email,phone,pppoeUsername,planCode\n,Siti Aminah,siti@example.com,081987654321,siti_pppoe,PLAN-10M`,
        tx,
      );
      expect(summary.created).toBe(1);
      expect(summary.errors.length).toBe(0);
    });
  });

  it("should record payments and allocate via FIFO", async () => {
    await withRollback(async (tx) => {
      const plan = await tx.servicePlan.create({
        data: {
          code: "PLAN-20M",
          name: "Paket 20 Mbps",
          priceMinor: 200_000n,
          downloadKbps: 20000,
          uploadKbps: 20000,
        },
      });

      const customer = await createCustomer(
        TEST_ACTOR,
        {
          name: "Dewi Lestari",
          planId: plan.id,
        },
        tx,
      );

      // Create an invoice manually
      const invoice = await tx.invoice.create({
        data: {
          number: "INV-2026-001",
          customerId: customer.id,
          planId: plan.id,
          status: "ISSUED",
          source: "MANUAL",
          issueDate: new Date(),
          dueDate: new Date(Date.now() + 7 * 86400000),
          periodStart: new Date(),
          periodEnd: new Date(Date.now() + 30 * 86400000),
          subtotalMinor: 200_000n,
          totalMinor: 200_000n,
        },
      });

      const paymentMethod = await tx.paymentMethod.create({
        data: {
          code: "test_cash",
          name: "Tunai Test",
          type: "CASH",
        },
      });

      const payment = await recordPayment(
        TEST_ACTOR,
        {
          customerId: customer.id,
          methodId: paymentMethod.id,
          amountMinor: 200_000,
        },
        tx,
      );

      expect(payment).toBeDefined();
      expect(payment.amountMinor).toBe(200_000);
      expect(payment.allocations.length).toBe(1);
      expect(payment.allocations[0]?.invoiceId).toBe(invoice.id);

      const updatedInvoice = await tx.invoice.findUnique({ where: { id: invoice.id } });
      expect(updatedInvoice?.status).toBe("PAID");
      expect(updatedInvoice?.paidMinor).toBe(200_000n);

      const balance = await getCustomerBalance(TEST_ACTOR, customer.id, tx);
      expect(balance.balance).toBe(0);

      const voided = await voidPayment(TEST_ACTOR, payment.id, "Salah input", tx);
      expect(voided.status).toBe("VOID");

      const revertedInvoice = await tx.invoice.findUnique({ where: { id: invoice.id } });
      expect(revertedInvoice?.status).toBe("ISSUED");
      expect(revertedInvoice?.paidMinor).toBe(0n);
    });
  });

  it("should record expenses and compute financial summary", async () => {
    await withRollback(async (tx) => {
      const category = await tx.expenseCategory.create({
        data: {
          code: "test_bandwidth",
          name: "Bandwidth Test",
        },
      });

      const expense = await createExpense(
        TEST_ACTOR,
        {
          categoryId: category.id,
          amountMinor: 1_500_000,
          description: "Pembayaran Transit IP",
        },
        tx,
      );

      expect(expense).toBeDefined();
      expect(expense.amountMinor).toBe(1_500_000);

      const summary = await getFinancialSummary(TEST_ACTOR, {}, tx);
      expect(summary.expensesMinor).toBe(1_500_000);

      const revenueByMonth = await getRevenueByMonth(TEST_ACTOR, 3, tx);
      expect(revenueByMonth.length).toBe(3);

      const collectionByMethod = await getCollectionByMethod(TEST_ACTOR, {}, tx);
      expect(Array.isArray(collectionByMethod)).toBe(true);
    });
  });
});
