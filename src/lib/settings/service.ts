import { prisma, type Tx } from "../db";
import { ValidationError, PermissionError, type Actor, type AnyActor, assertPermission } from "../permissions";
import { defaultSettings, SETTING_BY_KEY, type SettingKey } from "./registry";

/**
 * Pembacaan/penulisan setelan dari database dengan cache proses.
 *
 * Cache di-invalidasi eksplisit oleh `saveSettings`/`resetSetting`, dan juga
 * memiliki TTL pendek sebagai jaring pengaman bila ada proses lain (worker)
 * yang mengubah nilai.
 */

const TTL_MS = 15_000;

type CacheEntry = { value: unknown; expiresAt: number };

const cache = new Map<string, CacheEntry>();

function remember(key: string, value: unknown): void {
  cache.set(key, { value, expiresAt: Date.now() + TTL_MS });
}

export function invalidateSettingCache(key?: string): void {
  if (key) cache.delete(key);
  else cache.clear();
}

type SettingRow = { key: string; value: unknown };

/** Ambil sebuah setelan; fallback ke default registry dengan validasi. */
export async function getSetting<K extends SettingKey>(
  key: K,
  client: Tx | typeof prisma = prisma,
): Promise<unknown> {
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const def = SETTING_BY_KEY[key];
  if (!def) throw new Error(`Setelan tidak dikenal: ${key}`);

  const row = await client.setting.findUnique({ where: { key }, select: { value: true } });
  const raw = row ? row.value : def.default;
  const parsed = def.schema.safeParse(raw);
  if (!parsed.success) {
    // Nilai tidak valid (mis. diedit langsung di DB): pakai default yang valid.
    const fallback = def.schema.parse(def.default);
    remember(key, fallback);
    return fallback;
  }
  remember(key, parsed.data);
  return parsed.data;
}

/** Ambil beberapa setelan sekaligus. */
export async function getSettings<K extends SettingKey>(
  keys: readonly K[],
  client: Tx | typeof prisma = prisma,
): Promise<Record<K, unknown>> {
  const rows = await client.setting.findMany({
    where: { key: { in: keys as unknown as string[] } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r: SettingRow) => [r.key, r.value]));
  const out = {} as Record<K, unknown>;
  for (const key of keys) {
    const def = SETTING_BY_KEY[key];
    if (!def) throw new Error(`Setelan tidak dikenal: ${key}`);
    const raw = byKey.has(key) ? byKey.get(key) : def.default;
    const parsed = def.schema.safeParse(raw);
    out[key] = parsed.success ? parsed.data : def.schema.parse(def.default);
    remember(key, out[key]);
  }
  return out;
}

/** Ambil semua setelan yang terdefinisi (menggabungkan default + nilai DB). */
export async function getAllSettings(
  client: Tx | typeof prisma = prisma,
): Promise<Record<string, unknown>> {
  const rows = await client.setting.findMany({ select: { key: true, value: true } });
  const byKey = new Map(rows.map((r: SettingRow) => [r.key, r.value]));
  const merged: Record<string, unknown> = { ...defaultSettings() };
  for (const [key, def] of Object.entries(SETTING_BY_KEY)) {
    const candidate = byKey.has(key) ? byKey.get(key) : def.default;
    const parsed = def.schema.safeParse(candidate);
    merged[key] = parsed.success ? parsed.data : def.schema.parse(def.default);
  }
  return merged;
}

/** Peta setelan yang banyak dipakai UI (sudah divalidasi tipenya). */
export type RuntimeSettings = {
  companyName: string;
  companyLegalName: string;
  companyAddress: string;
  companyPhone: string;
  companyWhatsapp: string;
  companyEmail: string;
  companyWebsite: string;
  companyTaxId: string;
  companySupportHours: string;
  companyLogoUrl: string;
  invoiceTitle: string;
  invoiceFooterNote: string;
  paymentInstructions: string;
  currency: string;
  numberLocale: string;
  timezone: string;
  dateFormat: string;
  invoiceNumberFormat: string;
  invoiceNumberPrefix: string;
  invoiceNumberResetPeriod: "NEVER" | "YEARLY" | "MONTHLY" | "DAILY";
  paymentNumberFormat: string;
  paymentNumberPrefix: string;
  paymentNumberResetPeriod: "NEVER" | "YEARLY" | "MONTHLY" | "DAILY";
  dueDaysAfterIssue: number;
  graceDays: number;
  defaultBillingDay: number;
  invoiceLeadDays: number;
  prorateOnChange: boolean;
  taxEnabled: boolean;
  taxLabel: string;
  taxPercent: number;
  taxInclusive: boolean;
  lateFeeEnabled: boolean;
  lateFeeType: "FLAT" | "PERCENT";
  lateFeeAmountMinor: number;
  lateFeePercent: number;
  autoSuspendOverdue: boolean;
  autoResumeOnPayment: boolean;
  customerCodeFormat: string;
  customerCodePrefix: string;
  customerCodeResetPeriod: "NEVER" | "YEARLY" | "MONTHLY";
  notifyEnabled: boolean;
  notifyDefaultCountryCode: string;
  notifyReminderDaysBeforeDue: number[];
  notifyOverdueReminderDays: number[];
  notifyMaxAttempts: number;
  notifyRetryBackoffMinutes: number;
  notifyRateLimitPerMinute: number;
  notifyConsentRequired: boolean;
  notifyOptOutKeywords: string;
  routerPollIntervalSec: number;
  metricsRetentionDays: number;
  staleThresholdSec: number;
  utilizationWarnPercent: number;
  utilizationCritPercent: number;
  latencyWarnMs: number;
  latencyCritMs: number;
  incidentCooldownMinutes: number;
  autoCreateTickets: boolean;
  latencyTargetHost: string;
  sessionTtlMinutes: number;
  portalSessionTtlMinutes: number;
  loginMaxAttempts: number;
  lockoutMinutes: number;
  passwordMinLength: number;
  auditRetentionDays: number;
  fonnteBaseUrl: string;
  fonnteTimeoutMs: number;
  webhookEnabled: boolean;
  webhookToleranceSec: number;
  webhookAllowedHosts: string;
  dashboardDefaultPeriodDays: number;
  dashboardRevenueMetric: "COLLECTED" | "ISSUED";
};

const RUNTIME_MAP: Record<keyof RuntimeSettings, SettingKey> = {
  companyName: "company.name",
  companyLegalName: "company.legalName",
  companyAddress: "company.address",
  companyPhone: "company.phone",
  companyWhatsapp: "company.whatsapp",
  companyEmail: "company.email",
  companyWebsite: "company.website",
  companyTaxId: "company.taxId",
  companySupportHours: "company.supportHours",
  companyLogoUrl: "company.logoUrl",
  invoiceTitle: "invoice.title",
  invoiceFooterNote: "invoice.footerNote",
  paymentInstructions: "invoice.paymentInstructions",
  currency: "locale.currency",
  numberLocale: "locale.numberLocale",
  timezone: "locale.timezone",
  dateFormat: "locale.dateFormat",
  invoiceNumberFormat: "billing.invoiceNumberFormat",
  invoiceNumberPrefix: "billing.invoiceNumberPrefix",
  invoiceNumberResetPeriod: "billing.invoiceNumberResetPeriod",
  paymentNumberFormat: "billing.paymentNumberFormat",
  paymentNumberPrefix: "billing.paymentNumberPrefix",
  paymentNumberResetPeriod: "billing.paymentNumberResetPeriod",
  dueDaysAfterIssue: "billing.dueDaysAfterIssue",
  graceDays: "billing.graceDays",
  defaultBillingDay: "billing.defaultBillingDay",
  invoiceLeadDays: "billing.invoiceLeadDays",
  prorateOnChange: "billing.prorateOnChange",
  taxEnabled: "billing.taxEnabled",
  taxLabel: "billing.taxLabel",
  taxPercent: "billing.taxPercent",
  taxInclusive: "billing.taxInclusive",
  lateFeeEnabled: "billing.lateFeeEnabled",
  lateFeeType: "billing.lateFeeType",
  lateFeeAmountMinor: "billing.lateFeeAmountMinor",
  lateFeePercent: "billing.lateFeePercent",
  autoSuspendOverdue: "billing.autoSuspendOverdue",
  autoResumeOnPayment: "billing.autoResumeOnPayment",
  customerCodeFormat: "billing.customerCodeFormat",
  customerCodePrefix: "billing.customerCodePrefix",
  customerCodeResetPeriod: "billing.customerCodeResetPeriod",
  notifyEnabled: "notify.enabled",
  notifyDefaultCountryCode: "notify.defaultCountryCode",
  notifyReminderDaysBeforeDue: "notify.reminderDaysBeforeDue",
  notifyOverdueReminderDays: "notify.overdueReminderDays",
  notifyMaxAttempts: "notify.maxAttempts",
  notifyRetryBackoffMinutes: "notify.retryBackoffMinutes",
  notifyRateLimitPerMinute: "notify.rateLimitPerMinute",
  notifyConsentRequired: "notify.consentRequired",
  notifyOptOutKeywords: "notify.optOutKeywords",
  routerPollIntervalSec: "monitoring.routerPollIntervalSec",
  metricsRetentionDays: "monitoring.metricsRetentionDays",
  staleThresholdSec: "monitoring.staleThresholdSec",
  utilizationWarnPercent: "monitoring.utilizationWarnPercent",
  utilizationCritPercent: "monitoring.utilizationCritPercent",
  latencyWarnMs: "monitoring.latencyWarnMs",
  latencyCritMs: "monitoring.latencyCritMs",
  incidentCooldownMinutes: "monitoring.incidentCooldownMinutes",
  autoCreateTickets: "monitoring.autoCreateTickets",
  latencyTargetHost: "monitoring.latencyTargetHost",
  sessionTtlMinutes: "security.sessionTtlMinutes",
  portalSessionTtlMinutes: "security.portalSessionTtlMinutes",
  loginMaxAttempts: "security.loginMaxAttempts",
  lockoutMinutes: "security.lockoutMinutes",
  passwordMinLength: "security.passwordMinLength",
  auditRetentionDays: "security.auditRetentionDays",
  fonnteBaseUrl: "integrations.fonnte.baseUrl",
  fonnteTimeoutMs: "integrations.fonnte.timeoutMs",
  webhookEnabled: "integrations.webhook.enabled",
  webhookToleranceSec: "integrations.webhook.toleranceSec",
  webhookAllowedHosts: "integrations.webhook.allowedHosts",
  dashboardDefaultPeriodDays: "dashboard.defaultPeriodDays",
  dashboardRevenueMetric: "dashboard.revenueMetric",
};

/** Semua setelan runtime dalam satu query, siap dipakai service & UI. */
export async function runtimeSettings(
  client: Tx | typeof prisma = prisma,
): Promise<RuntimeSettings> {
  const keys = Object.values(RUNTIME_MAP);
  const values = await getSettings(keys as SettingKey[], client);
  const out = {} as Record<string, unknown>;
  for (const [prop, key] of Object.entries(RUNTIME_MAP)) {
    out[prop] = values[key as SettingKey];
  }
  return out as RuntimeSettings;
}

export type SettingChange = { key: SettingKey; value: unknown };

export type SettingChangeResult = {
  key: string;
  oldValue: unknown;
  newValue: unknown;
};

/**
 * Simpan perubahan setelan dalam satu transaksi, dengan validasi schema,
 * pencatatan riwayat, dan audit log.
 */
export async function saveSettings(
  actor: AnyActor,
  changes: SettingChange[],
  client?: Tx,
): Promise<SettingChangeResult[]> {
  assertPermission(actor, "settings.manage");
  if (changes.length === 0) return [];

  const validated = changes.map((change) => {
    const def = SETTING_BY_KEY[change.key];
    if (!def) throw new ValidationError(`Setelan tidak dikenal: ${change.key}`);
    const parsed = def.schema.safeParse(change.value);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join(".") || "nilai"}: ${i.message}`)
        .join("; ");
      throw new ValidationError(`Nilai tidak valid untuk ${def.label} (${detail})`);
    }
    return { key: change.key, def, value: parsed.data as unknown };
  });

  const run = async (tx: Tx) => {
    const results: SettingChangeResult[] = [];
    for (const { key, def, value } of validated) {
      const previous = await tx.setting.findUnique({ where: { key }, select: { value: true } });
      const previousValue = previous ? previous.value : def.default;
      await tx.setting.upsert({
        where: { key },
        create: {
          key,
          value: value as never,
          category: def.group,
          updatedById: actor.kind === "user" ? actor.userId : null,
        },
        update: {
          value: value as never,
          category: def.group,
          updatedById: actor.kind === "user" ? actor.userId : null,
        },
      });
      await tx.settingHistory.create({
        data: {
          key,
          oldValue: previousValue as never,
          newValue: value as never,
          isSecretKey: false,
          changedById: actor.kind === "user" ? actor.userId : null,
        },
      });
      if (actor.kind === "user") {
        await tx.auditLog.create({
          data: {
            actorType: "USER",
            actorId: actor.userId,
            actorLabel: actor.label,
            action: "settings.update",
            entityType: "Setting",
            entityId: key,
            metadata: { oldValue: previousValue, newValue: value } as never,
          },
        });
      }
      results.push({ key, oldValue: previousValue, newValue: value });
      invalidateSettingCache(key);
    }
    return results;
  };

  if (client) return run(client);

  const results = await prisma.$transaction(run, { timeout: 20_000 });
  return results;
}

/** Kembalikan satu setelan ke nilai default. */
export async function resetSetting(actor: Actor, key: SettingKey): Promise<void> {
  assertPermission(actor, "settings.manage");
  const def = SETTING_BY_KEY[key];
  if (!def) throw new ValidationError(`Setelan tidak dikenal: ${key}`);
  await saveSettings(actor, [{ key, value: def.default }]);
}

export { PermissionError };