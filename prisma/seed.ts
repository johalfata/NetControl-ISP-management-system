import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { defaultSettings } from "../src/lib/settings/registry";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_OWNER_EMAIL;
  const password = process.env.SEED_OWNER_PASSWORD;
  const name = process.env.SEED_OWNER_NAME;

  if (!email || !password || !name) {
    console.error(
      "SEED_OWNER_EMAIL, SEED_OWNER_PASSWORD, dan SEED_OWNER_NAME harus diisi.",
    );
    process.exit(1);
  }

  // ── Owner user ──────────────────────────────────────────────────────────
  const passwordHash = await hashPassword(password);
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name,
      passwordHash,
      role: "OWNER",
      isActive: true,
      mustChangePassword: false,
    },
  });
  console.log(`✔ Owner user: ${email}`);

  // ── Default settings ────────────────────────────────────────────────────
  const defaults = defaultSettings();
  for (const [key, value] of Object.entries(defaults)) {
    const category = key.split(".")[0] ?? "general";
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value: value as never, category },
    });
  }
  console.log(`✔ Settings: ${Object.keys(defaults).length} rows`);

  // ── Notification templates ──────────────────────────────────────────────
  const templates: {
    code: string;
    name: string;
    bodyTemplate: string;
    description: string;
  }[] = [
    {
      code: "due_reminder",
      name: "Pengingat Jatuh Tempo",
      bodyTemplate:
        "Yth. {{customer_name}}, tagihan Anda #{{invoice_number}} sebesar Rp{{total}} akan jatuh tempo pada {{due_date}}. Mohon segera lakukan pembayaran. Terima kasih.",
      description: "Dikirim beberapa hari sebelum jatuh tempo",
    },
    {
      code: "overdue_notice",
      name: "Pemberitahuan Tunggakan",
      bodyTemplate:
        "Yth. {{customer_name}}, tagihan Anda #{{invoice_number}} sebesar Rp{{total}} telah melewati jatuh tempo ({{due_date}}). Mohon segera lakukan pembayaran untuk menghindari pemutusan layanan.",
      description: "Dikirim setelah melewati jatuh tempo",
    },
    {
      code: "payment_confirmation",
      name: "Konfirmasi Pembayaran",
      bodyTemplate:
        "Yth. {{customer_name}}, pembayaran Anda sebesar Rp{{amount}} telah kami terima. Nomor pembayaran: {{payment_number}}. Terima kasih.",
      description: "Dikirim setelah pembayaran dikonfirmasi",
    },
    {
      code: "suspension_warning",
      name: "Peringatan Pemutusan",
      bodyTemplate:
        "Yth. {{customer_name}}, layanan internet Anda akan diputus sementara karena tunggakan yang belum dibayar. Mohon segera lakukan pembayaran untuk menghindari pemutusan.",
      description:
        "Dikirim sebelum layanan diputus karena tunggakan",
    },
    {
      code: "service_notice",
      name: "Pemberitahuan Layanan",
      bodyTemplate:
        "Yth. {{customer_name}}, {{message}}. Terima kasih atas pengertian Anda.",
      description: "Pemberitahuan umum terkait layanan (gangguan, pemeliharaan, dsb.)",
    },
    {
      code: "welcome",
      name: "Selamat Datang",
      bodyTemplate:
        "Selamat datang di {{company_name}}, {{customer_name}}! Layanan internet Anda telah aktif dengan paket {{plan_name}}. Hubungi kami di {{support_phone}} jika ada pertanyaan.",
      description: "Dikirim saat pelanggan baru pertama kali terdaftar",
    },
  ];

  for (const t of templates) {
    await prisma.notificationTemplate.upsert({
      where: { code: t.code },
      update: {},
      create: {
        code: t.code,
        channel: "WHATSAPP",
        name: t.name,
        bodyTemplate: t.bodyTemplate,
        isActive: true,
        description: t.description,
      },
    });
  }
  console.log(`✔ Notification templates: ${templates.length}`);

  // ── Expense categories ──────────────────────────────────────────────────
  const expenseCategories: { code: string; name: string }[] = [
    { code: "bandwidth_starlink", name: "Bandwidth Starlink" },
    { code: "bandwidth_dedicated", name: "Bandwidth Dedicated" },
    { code: "electricity", name: "Listrik" },
    { code: "equipment", name: "Peralatan" },
    { code: "maintenance", name: "Pemeliharaan" },
    { code: "salary", name: "Gaji" },
    { code: "office", name: "Kantor" },
    { code: "other", name: "Lainnya" },
  ];

  for (const c of expenseCategories) {
    await prisma.expenseCategory.upsert({
      where: { code: c.code },
      update: {},
      create: { code: c.code, name: c.name, isActive: true },
    });
  }
  console.log(`✔ Expense categories: ${expenseCategories.length}`);

  // ── Payment methods ─────────────────────────────────────────────────────
  const paymentMethods: {
    code: string;
    name: string;
    type: "CASH" | "TRANSFER" | "EWALLET" | "OTHER";
    sortOrder: number;
  }[] = [
    { code: "cash", name: "Tunai", type: "CASH", sortOrder: 0 },
    { code: "bank_transfer", name: "Transfer Bank", type: "TRANSFER", sortOrder: 1 },
    { code: "ewallet_dana", name: "DANA", type: "EWALLET", sortOrder: 2 },
    { code: "ewallet_gopay", name: "GoPay", type: "EWALLET", sortOrder: 3 },
  ];

  for (const m of paymentMethods) {
    await prisma.paymentMethod.upsert({
      where: { code: m.code },
      update: {},
      create: {
        code: m.code,
        name: m.name,
        type: m.type,
        isActive: true,
        sortOrder: m.sortOrder,
      },
    });
  }
  console.log(`✔ Payment methods: ${paymentMethods.length}`);

  // ── Ticket categories ───────────────────────────────────────────────────
  const ticketCategories: { code: string; name: string }[] = [
    { code: "gangguan_jaringan", name: "Gangguan Jaringan" },
    { code: "kualitas_layanan", name: "Kualitas Layanan" },
    { code: "tagihan", name: "Tagihan" },
    { code: "pemasangan", name: "Pemasangan" },
    { code: "pemutusan", name: "Pemutusan" },
    { code: "lainnya", name: "Lainnya" },
  ];

  for (const t of ticketCategories) {
    await prisma.ticketCategory.upsert({
      where: { code: t.code },
      update: {},
      create: { code: t.code, name: t.name, isActive: true },
    });
  }
  console.log(`✔ Ticket categories: ${ticketCategories.length}`);

  console.log("\nSeed selesai.");
}

main()
  .catch((error) => {
    console.error("Seed gagal:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
