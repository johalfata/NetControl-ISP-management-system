import type { Prisma } from "@prisma/client";
import { ConflictError } from "../permissions";

/**
 * Penomoran dokumen (invoice, pembayaran, kode pelanggan).
 *
 * Urutan dijamin unik lewat operasi atomik `INSERT ... ON CONFLICT DO UPDATE`
 * pada tabel Counter. Aman untuk permintaan bersamaan tanpa lock eksplisit,
 * dan dipanggil di dalam transaksi yang sama dengan pembuatan dokumennya.
 */

export type ResetPeriod = "NEVER" | "YEARLY" | "MONTHLY" | "DAILY";

export function periodKeyFor(period: ResetPeriod, at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, "0");
  const day = String(at.getUTCDate()).padStart(2, "0");
  switch (period) {
    case "DAILY":
      return `${year}${month}${day}`;
    case "MONTHLY":
      return `${year}${month}`;
    case "YEARLY":
      return `${year}`;
    default:
      return "all";
  }
}

/**
 * Naikkan counter secara atomik dan kembalikan nilainya.
 * `scope` sebaiknya berisi jenis dokumen + periode agar terpisah.
 */
export async function nextSequence(
  tx: Prisma.TransactionClient,
  scope: string,
  periodKey: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ lastValue: number }[]>`
    INSERT INTO "Counter" ("id", "scope", "periodKey", "lastValue", "updatedAt")
    VALUES (gen_random_uuid()::text, ${scope}, ${periodKey}, 1, NOW())
    ON CONFLICT ("scope", "periodKey")
    DO UPDATE SET "lastValue" = "Counter"."lastValue" + 1, "updatedAt" = NOW()
    RETURNING "lastValue"
  `;
  const value = rows[0]?.lastValue;
  if (typeof value !== "number") {
    throw new ConflictError("Gagal mengambil nomor urut dokumen");
  }
  return value;
}

export type NumberFormatTokens = {
  prefix: string;
  periodStart: Date;
  sequence: number;
};

/**
 * Render format nomor dokumen dari token. Didukung:
 *   {prefix} {YYYY} {YY} {MM} {DD} {SEQ:n}
 */
export function renderDocumentNumber(format: string, tokens: NumberFormatTokens): string {
  const year = tokens.periodStart.getUTCFullYear();
  const rendered = format
    .replace(/\{prefix\}/g, tokens.prefix)
    .replace(/\{YYYY\}/g, String(year))
    .replace(/\{YY\}/g, String(year).slice(-2))
    .replace(/\{MM\}/g, String(tokens.periodStart.getUTCMonth() + 1).padStart(2, "0"))
    .replace(/\{DD\}/g, String(tokens.periodStart.getUTCDate()).padStart(2, "0"))
    .replace(/\{SEQ:(\d+)\}/g, (_match, digits: string) => {
      const width = Math.min(Math.max(Number(digits), 1), 12);
      return String(tokens.sequence).padStart(width, "0");
    });
  if (!/\d/.test(rendered)) {
    throw new ConflictError(`Format nomor dokumen tidak menghasilkan nomor: ${format}`);
  }
  return rendered;
}

export type DocumentNumberConfig = {
  format: string;
  prefix: string;
  resetPeriod: ResetPeriod;
  scope: string;
};

export async function allocateDocumentNumber(
  tx: Prisma.TransactionClient,
  config: DocumentNumberConfig,
  at: Date,
): Promise<string> {
  const periodKey = periodKeyFor(config.resetPeriod, at);
  const sequence = await nextSequence(tx, config.scope, periodKey);
  return renderDocumentNumber(config.format, {
    prefix: config.prefix,
    periodStart: at,
    sequence,
  });
}