import { z } from "zod";
import type { Permission } from "../permissions";

/**
 * Registry setelan aplikasi.
 *
 * Aturan:
 * - Nilai bisnis yang dapat berubah setelah deployment TIDAK boleh hardcode di
 *   komponen UI/service. Semua lewat registry ini (tersimpan di tabel Setting).
 * - Kredensial integrasi TIDAK ada di sini; lihat SECRET_SETTING_DEFS dan tabel
 *   SecretSetting (terenkripsi AES-256-GCM).
 * - Invariant keamanan/skema (mis. constraint transaksi) tidak dibuat dapat
 *   diedit di sini.
 */

export type SettingInputType =
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "money"
  | "boolean"
  | "select"
  | "time"
  | "numberList";

export type SettingDefinition<T = unknown> = {
  key: string;
  group: string;
  label: string;
  description: string;
  input: SettingInputType;
  schema: z.ZodType<T>;
  default: T;
  options?: readonly { value: string; label: string }[];
  /** Izin minimum untuk melihat nilai (default settings.view). */
  viewPermission?: Permission;
  /** Izin minimum untuk mengubah (default settings.manage). */
  managePermission?: Permission;
};

function define<T>(def: SettingDefinition<T>): SettingDefinition<T> {
  return def;
}

const numberListSchema = z
  .union([z.array(z.number().int()), z.string()])
  .transform((value) =>
    typeof value === "string"
      ? value
          .split(/[,\s]+/)
          .filter((part) => part.length > 0)
          .map((part) => Number(part))
      : value,
  )
  .pipe(z.array(z.number().int().min(0).max(3650)).max(24));

export const SETTING_DEFINITIONS = [
  // ---------------------------------------------------------------- identitas
  define({
    key: "company.name",
    group: "identity",
    label: "Nama ISP",
    description: "Nama merek yang ditampilkan pada aplikasi, invoice, dan notifikasi.",
    input: "text",
    schema: z.string().min(1).max(120),
    default: "ISP Saya",
  }),
  define({
    key: "company.legalName",
    group: "identity",
    label: "Nama badan usaha",
    description: "Nama legal untuk dokumen dan invoice.",
    input: "text",
    schema: z.string().max(160),
    default: "",
  }),
  define({
    key: "company.address",
    group: "identity",
    label: "Alamat",
    description: "Alamat kantor/operasional.",
    input: "textarea",
    schema: z.string().max(400),
    default: "",
  }),
  define({
    key: "company.phone",
    group: "identity",
    label: "Telepon",
    description: "Nomor telepon resmi.",
    input: "text",
    schema: z.string().max(40),
    default: "",
  }),
  define({
    key: "company.whatsapp",
    group: "identity",
    label: "WhatsApp dukungan",
    description: "Nomor WhatsApp layanan pelanggan.",
    input: "text",
    schema: z.string().max(40),
    default: "",
  }),
  define({
    key: "company.email",
    group: "identity",
    label: "Email",
    description: "Email resmi layanan pelanggan.",
    input: "text",
    schema: z.string().max(160),
    default: "",
  }),
  define({
    key: "company.website",
    group: "identity",
    label: "Situs web",
    description: "Alamat situs web perusahaan.",
    input: "text",
    schema: z.string().max(160),
    default: "",
  }),
  define({
    key: "company.taxId",
    group: "identity",
    label: "NPWP",
    description: "Nomor pokok wajib pajak untuk invoice.",
    input: "text",
    schema: z.string().max(60),
    default: "",
  }),
  define({
    key: "company.supportHours",
    group: "identity",
    label: "Jam dukungan",
    description: "Jam operasional layanan pelanggan.",
    input: "text",
    schema: z.string().max(120),
    default: "08.00 - 20.00 WIB",
  }),
  define({
    key: "company.logoUrl",
    group: "identity",
    label: "URL logo",
    description: "Logo aplikasi (URL http/https). Kosongkan untuk memakai teks.",
    input: "text",
    schema: z.union([z.literal(""), z.string().url().max(500)]),
    default: "",
  }),

  // ------------------------------------------------------------------- invoice
  define({
    key: "invoice.title",
    group: "invoice",
    label: "Judul invoice",
    description: "Judul yang tercetak pada invoice.",
    input: "text",
    schema: z.string().min(1).max(80),
    default: "INVOICE",
  }),
  define({
    key: "invoice.footerNote",
    group: "invoice",
    label: "Catatan kaki invoice",
    description: "Teks penutup pada invoice dan kuitansi.",
    input: "textarea",
    schema: z.string().max(400),
    default: "Terima kasih atas pembayaran Anda.",
  }),
  define({
    key: "invoice.paymentInstructions",
    group: "invoice",
    label: "Instruksi pembayaran",
    description: "Ditampilkan pada invoice dan portal pelanggan.",
    input: "textarea",
    schema: z.string().max(1000),
    default: "",
  }),

  // ------------------------------------------------------------------- locale
  define({
    key: "locale.currency",
    group: "locale",
    label: "Kode mata uang",
    description: "Kode ISO 4217. Mengubah ini mengubah simbol dan jumlah desimal tampilan.",
    input: "select",
    schema: z.enum(["IDR", "USD", "EUR", "MYR", "SGD"]),
    options: [
      { value: "IDR", label: "IDR — Rupiah (tanpa desimal)" },
      { value: "USD", label: "USD — Dolar AS" },
      { value: "EUR", label: "EUR — Euro" },
      { value: "MYR", label: "MYR — Ringgit" },
      { value: "SGD", label: "SGD — Dolar Singapura" },
    ],
    default: "IDR",
  }),
  define({
    key: "locale.numberLocale",
    group: "locale",
    label: "Format angka",
    description: "Locale untuk pemformatan angka dan tanggal (Intl).",
    input: "select",
    schema: z.enum(["id-ID", "en-US", "en-GB"]),
    options: [
      { value: "id-ID", label: "Indonesia (1.234.567,89)" },
      { value: "en-US", label: "Inggris AS (1,234,567.89)" },
      { value: "en-GB", label: "Inggris UK (1,234,567.89)" },
    ],
    default: "id-ID",
  }),
  define({
    key: "locale.timezone",
    group: "locale",
    label: "Zona waktu",
    description: "Semua waktu disimpan UTC dan ditampilkan pada zona ini.",
    input: "select",
    schema: z.enum([
      "Asia/Jakarta",
      "Asia/Makassar",
      "Asia/Jayapura",
      "Asia/Singapore",
      "UTC",
    ]),
    options: [
      { value: "Asia/Jakarta", label: "WIB (Asia/Jakarta)" },
      { value: "Asia/Makassar", label: "WITA (Asia/Makassar)" },
      { value: "Asia/Jayapura", label: "WIT (Asia/Jayapura)" },
      { value: "Asia/Singapore", label: "SGT (Asia/Singapore)" },
      { value: "UTC", label: "UTC" },
    ],
    default: "Asia/Jakarta",
  }),
  define({
    key: "locale.dateFormat",
    group: "locale",
    label: "Format tanggal",
    description: "Pola tampilan tanggal.",
    input: "select",
    schema: z.enum(["dd/MM/yyyy", "dd-MM-yyyy", "yyyy-MM-dd", "d MMM yyyy"]),
    options: [
      { value: "dd/MM/yyyy", label: "31/12/2026" },
      { value: "dd-MM-yyyy", label: "31-12-2026" },
      { value: "yyyy-MM-dd", label: "2026-12-31" },
      { value: "d MMM yyyy", label: "31 Des 2026" },
    ],
    default: "dd/MM/yyyy",
  }),

  // ------------------------------------------------------------------ billing
  define({
    key: "billing.invoiceNumberFormat",
    group: "billing",
    label: "Format nomor invoice",
    description:
      "Token: {prefix}, {YYYY}, {YY}, {MM}, {SEQ:n} (n = jumlah digit). Contoh: {prefix}/{YYYY}{MM}/{SEQ:5}",
    input: "text",
    schema: z
      .string()
      .min(1)
      .max(80)
      .refine((v) => v.includes("{SEQ"), "Format harus memuat token {SEQ:n}"),
    default: "{prefix}/{YYYY}{MM}/{SEQ:5}",
  }),
  define({
    key: "billing.invoiceNumberPrefix",
    group: "billing",
    label: "Awalan nomor invoice",
    description: "Nilai untuk token {prefix}.",
    input: "text",
    schema: z.string().min(1).max(16),
    default: "INV",
  }),
  define({
    key: "billing.invoiceNumberResetPeriod",
    group: "billing",
    label: "Reset urutan invoice",
    description: "Kapan nomor urut invoice kembali ke 1.",
    input: "select",
    schema: z.enum(["NEVER", "YEARLY", "MONTHLY", "DAILY"]),
    options: [
      { value: "MONTHLY", label: "Bulanan" },
      { value: "YEARLY", label: "Tahunan" },
      { value: "DAILY", label: "Harian" },
      { value: "NEVER", label: "Tidak pernah" },
    ],
    default: "MONTHLY",
  }),
  define({
    key: "billing.paymentNumberFormat",
    group: "billing",
    label: "Format nomor pembayaran",
    description: "Token sama seperti nomor invoice.",
    input: "text",
    schema: z.string().min(1).max(80).refine((v) => v.includes("{SEQ"), "Harus memuat {SEQ:n}"),
    default: "{prefix}/{YYYY}{MM}/{SEQ:5}",
  }),
  define({
    key: "billing.paymentNumberPrefix",
    group: "billing",
    label: "Awalan nomor pembayaran",
    description: "Nilai untuk token {prefix}.",
    input: "text",
    schema: z.string().min(1).max(16),
    default: "PAY",
  }),
  define({
    key: "billing.paymentNumberResetPeriod",
    group: "billing",
    label: "Reset urutan pembayaran",
    description: "Kapan nomor urut pembayaran kembali ke 1.",
    input: "select",
    schema: z.enum(["NEVER", "YEARLY", "MONTHLY", "DAILY"]),
    options: [
      { value: "MONTHLY", label: "Bulanan" },
      { value: "YEARLY", label: "Tahunan" },
      { value: "DAILY", label: "Harian" },
      { value: "NEVER", label: "Tidak pernah" },
    ],
    default: "MONTHLY",
  }),
  define({
    key: "billing.dueDaysAfterIssue",
    group: "billing",
    label: "Jatuh tempo (hari setelah terbit)",
    description: "Jarak hari dari tanggal terbit invoice ke jatuh tempo.",
    input: "integer",
    schema: z.number().int().min(0).max(120),
    default: 10,
  }),
  define({
    key: "billing.graceDays",
    group: "billing",
    label: "Masa tenggang (hari)",
    description: "Hari setelah jatuh tempo sebelum invoice dianggap menunggak berat.",
    input: "integer",
    schema: z.number().int().min(0).max(120),
    default: 3,
  }),
  define({
    key: "billing.defaultBillingDay",
    group: "billing",
    label: "Tanggal penagihan default",
    description: "Tanggal penagihan untuk pelanggan baru (1-28).",
    input: "integer",
    schema: z.number().int().min(1).max(28),
    default: 1,
  }),
  define({
    key: "billing.invoiceLeadDays",
    group: "billing",
    label: "Terbitkan invoice sebelum tanggal tagih (hari)",
    description: "Berapa hari sebelum tanggal tagih invoice dibuat otomatis.",
    input: "integer",
    schema: z.number().int().min(0).max(60),
    default: 5,
  }),
  define({
    key: "billing.prorateOnChange",
    group: "billing",
    label: "Prorata saat ganti paket",
    description: "Jika aktif, perubahan paket di tengah siklus dihitung prorata.",
    input: "boolean",
    schema: z.boolean(),
    default: false,
  }),
  define({
    key: "billing.taxEnabled",
    group: "billing",
    label: "Aktifkan pajak",
    description: "Tambahkan baris pajak pada invoice baru.",
    input: "boolean",
    schema: z.boolean(),
    default: false,
  }),
  define({
    key: "billing.taxLabel",
    group: "billing",
    label: "Label pajak",
    description: "Nama pajak pada invoice (mis. PPN).",
    input: "text",
    schema: z.string().max(40),
    default: "PPN",
  }),
  define({
    key: "billing.taxPercent",
    group: "billing",
    label: "Persentase pajak",
    description: "Tarif pajak dalam persen (mis. 11 untuk 11%).",
    input: "number",
    schema: z.number().min(0).max(100),
    default: 11,
  }),
  define({
    key: "billing.taxInclusive",
    group: "billing",
    label: "Harga sudah termasuk pajak",
    description: "Jika aktif, pajak dihitung sebagai bagian dari harga paket.",
    input: "boolean",
    schema: z.boolean(),
    default: false,
  }),
  define({
    key: "billing.lateFeeEnabled",
    group: "billing",
    label: "Aktifkan denda keterlambatan",
    description: "Tambahkan denda pada invoice yang lewat jatuh tempo.",
    input: "boolean",
    schema: z.boolean(),
    default: false,
  }),
  define({
    key: "billing.lateFeeType",
    group: "billing",
    label: "Jenis denda",
    description: "Nominal tetap atau persentase dari total invoice.",
    input: "select",
    schema: z.enum(["FLAT", "PERCENT"]),
    options: [
      { value: "FLAT", label: "Nominal tetap" },
      { value: "PERCENT", label: "Persentase" },
    ],
    default: "FLAT",
  }),
  define({
    key: "billing.lateFeeAmountMinor",
    group: "billing",
    label: "Nominal denda",
    description: "Dipakai bila jenis denda = nominal tetap (dalam satuan terkecil).",
    input: "money",
    schema: z.number().int().min(0),
    default: 0,
  }),
  define({
    key: "billing.lateFeePercent",
    group: "billing",
    label: "Persentase denda",
    description: "Dipakai bila jenis denda = persentase.",
    input: "number",
    schema: z.number().min(0).max(100),
    default: 0,
  }),
  define({
    key: "billing.autoSuspendOverdue",
    group: "billing",
    label: "Isolir otomatis saat menunggak",
    description:
      "Menandai langganan menunggak setelah melewati masa tenggang. Tindakan jaringan tetap memerlukan izin routers.control.",
    input: "boolean",
    schema: z.boolean(),
    default: false,
  }),
  define({
    key: "billing.autoResumeOnPayment",
    group: "billing",
    label: "Aktifkan kembali setelah pembayaran",
    description: "Batalkan status menungggak ketika tunggakan lunas.",
    input: "boolean",
    schema: z.boolean(),
    default: true,
  }),
  define({
    key: "billing.customerCodeFormat",
    group: "billing",
    label: "Format kode pelanggan",
    description: "Token: {prefix}, {YYYY}, {MM}, {SEQ:n}.",
    input: "text",
    schema: z.string().min(1).max(60).refine((v) => v.includes("{SEQ"), "Harus memuat {SEQ:n}"),
    default: "{prefix}-{SEQ:5}",
  }),
  define({
    key: "billing.customerCodePrefix",
    group: "billing",
    label: "Awalan kode pelanggan",
    description: "Nilai untuk token {prefix}.",
    input: "text",
    schema: z.string().min(1).max(12),
    default: "CUST",
  }),
  define({
    key: "billing.customerCodeResetPeriod",
    group: "billing",
    label: "Reset urutan kode pelanggan",
    description: "Kapan nomor urut kode pelanggan kembali ke 1.",
    input: "select",
    schema: z.enum(["NEVER", "YEARLY", "MONTHLY"]),
    options: [
      { value: "NEVER", label: "Tidak pernah" },
      { value: "YEARLY", label: "Tahunan" },
      { value: "MONTHLY", label: "Bulanan" },
    ],
    default: "NEVER",
  }),

  // -------------------------------------------------------------- notifikasi
  define({
    key: "notify.enabled",
    group: "notifications",
    label: "Aktifkan pengiriman notifikasi",
    description: "Sakelar utama untuk seluruh pengiriman WhatsApp.",
    input: "boolean",
    schema: z.boolean(),
    default: false,
  }),
  define({
    key: "notify.defaultCountryCode",
    group: "notifications",
    label: "Kode negara default",
    description: "Dipakai untuk menormalkan nomor telepon pelanggan.",
    input: "text",
    schema: z.string().regex(/^\d{1,4}$/, "Hanya angka"),
    default: "62",
  }),
  define({
    key: "notify.reminderDaysBeforeDue",
    group: "notifications",
    label: "Pengingat sebelum jatuh tempo (hari)",
    description: "Daftar hari sebelum jatuh tempo untuk mengirim pengingat.",
    input: "numberList",
    schema: numberListSchema,
    default: [3, 1],
  }),
  define({
    key: "notify.overdueReminderDays",
    group: "notifications",
    label: "Pengingat setelah jatuh tempo (hari)",
    description: "Daftar hari setelah jatuh tempo untuk mengirim peringatan.",
    input: "numberList",
    schema: numberListSchema,
    default: [1, 7, 14],
  }),
  define({
    key: "notify.maxAttempts",
    group: "notifications",
    label: "Percobaan kirim maksimum",
    description: "Jumlah percobaan sebelum notifikasi ditandai gagal.",
    input: "integer",
    schema: z.number().int().min(1).max(10),
    default: 3,
  }),
  define({
    key: "notify.retryBackoffMinutes",
    group: "notifications",
    label: "Jeda antar percobaan (menit)",
    description: "Backoff dasar; percobaan berikutnya dikalikan nomor percobaan.",
    input: "integer",
    schema: z.number().int().min(1).max(1440),
    default: 10,
  }),
  define({
    key: "notify.rateLimitPerMinute",
    group: "notifications",
    label: "Batas kirim per menit",
    description: "Batas laju pengiriman untuk mencegah ban provider.",
    input: "integer",
    schema: z.number().int().min(1).max(600),
    default: 30,
  }),
  define({
    key: "notify.consentRequired",
    group: "notifications",
    label: "Wajib persetujuan pelanggan",
    description: "Jika aktif, pelanggan tanpa persetujuan tidak akan dikirimi pesan.",
    input: "boolean",
    schema: z.boolean(),
    default: false,
  }),
  define({
    key: "notify.optOutKeywords",
    group: "notifications",
    label: "Kata kunci berhenti",
    description: "Daftar kata kunci (dipisah koma) yang menandai pelanggan berhenti berlangganan notifikasi.",
    input: "text",
    schema: z.string().max(200),
    default: "STOP,BERHENTI,UNSUBSCRIBE",
  }),

  // -------------------------------------------------------------- monitoring
  define({
    key: "monitoring.routerPollIntervalSec",
    group: "monitoring",
    label: "Interval polling router (detik)",
    description: "Dipakai bila router tidak memiliki interval khusus.",
    input: "integer",
    schema: z.number().int().min(15).max(3600),
    default: 60,
  }),
  define({
    key: "monitoring.metricsRetentionDays",
    group: "monitoring",
    label: "Retensi telemetri (hari)",
    description: "Data metrik lebih lama dari ini akan dihapus oleh job retensi.",
    input: "integer",
    schema: z.number().int().min(1).max(3650),
    default: 90,
  }),
  define({
    key: "monitoring.staleThresholdSec",
    group: "monitoring",
    label: "Ambang data basi (detik)",
    description: "Data yang lebih lama dari ini ditandai basi pada UI.",
    input: "integer",
    schema: z.number().int().min(30).max(86400),
    default: 300,
  }),
  define({
    key: "monitoring.utilizationWarnPercent",
    group: "monitoring",
    label: "Peringatan utilisasi (%)",
    description: "Ambang peringatan untuk utilisasi bandwidth WAN.",
    input: "number",
    schema: z.number().min(1).max(100),
    default: 80,
  }),
  define({
    key: "monitoring.utilizationCritPercent",
    group: "monitoring",
    label: "Kritis utilisasi (%)",
    description: "Ambang kritis untuk utilisasi bandwidth WAN.",
    input: "number",
    schema: z.number().min(1).max(100),
    default: 95,
  }),
  define({
    key: "monitoring.latencyWarnMs",
    group: "monitoring",
    label: "Peringatan latensi (ms)",
    description: "Ambang peringatan latensi link WAN.",
    input: "integer",
    schema: z.number().int().min(1).max(10000),
    default: 100,
  }),
  define({
    key: "monitoring.latencyCritMs",
    group: "monitoring",
    label: "Kritis latensi (ms)",
    description: "Ambang kritis latensi link WAN.",
    input: "integer",
    schema: z.number().int().min(1).max(60000),
    default: 250,
  }),
  define({
    key: "monitoring.incidentCooldownMinutes",
    group: "monitoring",
    label: "Jeda insiden (menit)",
    description: "Insiden sejenis tidak dibuat ulang sebelum jeda ini berlalu.",
    input: "integer",
    schema: z.number().int().min(0).max(1440),
    default: 30,
  }),
  define({
    key: "monitoring.autoCreateTickets",
    group: "monitoring",
    label: "Buat tiket otomatis dari insiden kritis",
    description: "Insiden kritis akan otomatis membuat tiket helpdesk.",
    input: "boolean",
    schema: z.boolean(),
    default: false,
  }),
  define({
    key: "monitoring.latencyTargetHost",
    group: "monitoring",
    label: "Host target ping default",
    description: "Host yang dipakai untuk pemeriksaan latensi bila WAN tidak menentukan sendiri.",
    input: "text",
    schema: z.string().max(200),
    default: "1.1.1.1",
  }),

  // ---------------------------------------------------------------- keamanan
  define({
    key: "security.sessionTtlMinutes",
    group: "security",
    label: "Umur sesi staf (menit)",
    description: "Sesi staf kedaluwarsa setelah periode ini.",
    input: "integer",
    schema: z.number().int().min(15).max(20160),
    default: 720,
  }),
  define({
    key: "security.portalSessionTtlMinutes",
    group: "security",
    label: "Umur sesi portal (menit)",
    description: "Sesi portal pelanggan kedaluwarsa setelah periode ini.",
    input: "integer",
    schema: z.number().int().min(15).max(20160),
    default: 1440,
  }),
  define({
    key: "security.loginMaxAttempts",
    group: "security",
    label: "Percobaan login maksimum",
    description: "Jumlah kegagalan sebelum akun dikunci sementara.",
    input: "integer",
    schema: z.number().int().min(3).max(20),
    default: 5,
  }),
  define({
    key: "security.lockoutMinutes",
    group: "security",
    label: "Durasi kunci akun (menit)",
    description: "Berapa lama akun terkunci setelah melewati batas percobaan.",
    input: "integer",
    schema: z.number().int().min(1).max(1440),
    default: 15,
  }),
  define({
    key: "security.passwordMinLength",
    group: "security",
    label: "Panjang minimum password",
    description: "Berlaku untuk pembuatan akun dan penggantian password.",
    input: "integer",
    schema: z.number().int().min(8).max(72),
    default: 10,
  }),
  define({
    key: "security.auditRetentionDays",
    group: "security",
    label: "Retensi audit log (hari)",
    description: "Audit log lebih lama dari ini dapat dihapus oleh job retensi.",
    input: "integer",
    schema: z.number().int().min(30).max(3650),
    default: 365,
  }),

  // -------------------------------------------------------------- integrasi
  define({
    key: "integrations.fonnte.baseUrl",
    group: "integrations",
    label: "URL dasar Fonnte",
    description: "Endpoint API provider WhatsApp. Divalidasi sebelum dipakai.",
    input: "text",
    schema: z.string().url().max(300),
    default: "https://api.fonnte.com",
  }),
  define({
    key: "integrations.fonnte.timeoutMs",
    group: "integrations",
    label: "Timeout provider (ms)",
    description: "Batas waktu permintaan ke provider notifikasi.",
    input: "integer",
    schema: z.number().int().min(1000).max(60000),
    default: 15000,
  }),
  define({
    key: "integrations.webhook.enabled",
    group: "integrations",
    label: "Aktifkan webhook n8n",
    description: "Menerima pemicu otomasi dari n8n.",
    input: "boolean",
    schema: z.boolean(),
    default: true,
  }),
  define({
    key: "integrations.webhook.toleranceSec",
    group: "integrations",
    label: "Toleransi timestamp webhook (detik)",
    description: "Selisih waktu maksimum untuk mencegah replay.",
    input: "integer",
    schema: z.number().int().min(30).max(3600),
    default: 300,
  }),
  define({
    key: "integrations.webhook.allowedHosts",
    group: "integrations",
    label: "Host integrasi yang diizinkan",
    description:
      "Daftar host (dipisah koma) yang boleh dihubungi server untuk integrasi keluar. Kosong = hanya host yang dikonfigurasi per integrasi.",
    input: "text",
    schema: z.string().max(1000),
    default: "",
  }),

  // --------------------------------------------------------------- dashboard
  define({
    key: "dashboard.defaultPeriodDays",
    group: "dashboard",
    label: "Periode default dashboard (hari)",
    description: "Rentang default untuk ringkasan dan grafik.",
    input: "integer",
    schema: z.number().int().min(1).max(365),
    default: 30,
  }),
  define({
    key: "dashboard.revenueMetric",
    group: "dashboard",
    label: "Metrik pendapatan utama",
    description: "Dasar angka pendapatan pada kartu ringkasan.",
    input: "select",
    schema: z.enum(["COLLECTED", "ISSUED"]),
    options: [
      { value: "COLLECTED", label: "Kas diterima (collection)" },
      { value: "ISSUED", label: "Invoice terbit (billing)" },
    ],
    default: "COLLECTED",
  }),
] as const satisfies readonly SettingDefinition<unknown>[];

export type SettingKey = (typeof SETTING_DEFINITIONS)[number]["key"];

export const SETTING_BY_KEY: Record<string, SettingDefinition<unknown>> =
  Object.fromEntries(SETTING_DEFINITIONS.map((d) => [d.key, d]));

export const SETTING_GROUPS: readonly { id: string; label: string; description: string }[] = [
  { id: "identity", label: "Identitas ISP", description: "Merek, kontak, dan informasi perusahaan." },
  { id: "locale", label: "Mata uang & waktu", description: "Currency, locale, zona waktu, format tanggal." },
  { id: "billing", label: "Penagihan", description: "Nomor dokumen, jatuh tempo, pajak, denda, isolir." },
  { id: "invoice", label: "Invoice & kuitansi", description: "Teks yang tercetak pada dokumen pelanggan." },
  { id: "notifications", label: "Notifikasi", description: "Jadwal pengingat, retry, dan kepatuhan." },
  { id: "monitoring", label: "Monitoring", description: "Polling, retensi telemetri, dan ambang peringatan." },
  { id: "security", label: "Keamanan", description: "Sesi, kunci akun, dan retensi audit." },
  { id: "integrations", label: "Integrasi", description: "Endpoint dan perilaku webhook." },
  { id: "dashboard", label: "Dashboard", description: "Periode dan definisi metrik dashboard." },
];

// ---------------------------------------------------------------------------
// Setelan rahasia (terenkripsi, tabel SecretSetting)
// ---------------------------------------------------------------------------

export type SecretSettingDefinition = {
  key: string;
  group: string;
  label: string;
  description: string;
  required: boolean;
  helpUrl?: string;
};

export const SECRET_SETTING_DEFINITIONS = [
  {
    key: "integrations.fonnte.token",
    group: "integrations",
    label: "Token Fonnte",
    description: "Token API untuk pengiriman WhatsApp. Disimpan terenkripsi.",
    required: false,
    helpUrl: "https://md.fonnte.com/",
  },
  {
    key: "integrations.fonnte.webhookToken",
    group: "integrations",
    label: "Token verifikasi webhook Fonnte",
    description: "Dipakai untuk memverifikasi callback status pengiriman dari Fonnte.",
    required: false,
  },
  {
    key: "integrations.routeros.defaultPassword",
    group: "integrations",
    label: "Password RouterOS default (opsional)",
    description:
      "Hanya untuk membantu pengisian awal; password router individual sebaiknya disimpan per router.",
    required: false,
  },
] as const satisfies readonly SecretSettingDefinition[];

export const SECRET_SETTING_BY_KEY: Record<string, SecretSettingDefinition> =
  Object.fromEntries(SECRET_SETTING_DEFINITIONS.map((d) => [d.key, d]));

export type SecretSettingKey = (typeof SECRET_SETTING_DEFINITIONS)[number]["key"];

/** Nilai default seluruh setelan (untuk seed dan fallback). */
export function defaultSettings(): Record<string, unknown> {
  return Object.fromEntries(SETTING_DEFINITIONS.map((d) => [d.key, d.default]));
}

export type SettingInputTypeMetadata = {
  key: string;
  group: string;
  label: string;
  description: string;
  input: SettingInputType;
  options?: readonly { value: string; label: string }[];
  default: unknown;
};

export function settingMetadata(): SettingInputTypeMetadata[] {
  return SETTING_DEFINITIONS.map((d) => ({
    key: d.key,
    group: d.group,
    label: d.label,
    description: d.description,
    input: d.input,
    options: d.options,
    default: d.default,
  }));
}