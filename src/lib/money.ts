/**
 * Aritmetika uang. Semua nominal aplikasi adalah bilangan bulat (BigInt) dalam
 * satuan minor mata uang (IDR: rupiah penuh). Float dilarang untuk nilai uang.
 */

export type Minor = bigint;

export function toMinor(value: bigint | number | string): Minor {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nilai uang bukan angka terbatas");
    if (!Number.isInteger(value)) {
      throw new Error(`Nilai uang harus bilangan bulat minor, diterima: ${value}`);
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`Format uang tidak valid: ${value}`);
  }
  return BigInt(trimmed);
}

export function addMinor(...values: Minor[]): Minor {
  return values.reduce<Minor>((acc, v) => acc + v, 0n);
}

export function subMinor(a: Minor, b: Minor): Minor {
  return a - b;
}

/** amount * quantity tanpa overflow float. */
export function multiplyMinor(amount: Minor, quantity: number): Minor {
  if (!Number.isInteger(quantity)) throw new Error("Kuantitas harus bilangan bulat");
  return amount * BigInt(quantity);
}

/**
 * Persentase dari nominal dengan pembulatan half-up (bukan banker's rounding),
 * deterministik dan tidak memakai float untuk hasil akhir.
 */
export function percentOfMinor(amount: Minor, percent: number): Minor {
  const scaled = BigInt(Math.round(percent * 10_000)); // 4 desimal presisi
  const numerator = amount * scaled;
  const denominator = 1_000_000n;
  const negative = numerator < 0n;
  const abs = negative ? -numerator : numerator;
  let q = abs / denominator;
  const r = abs % denominator;
  if (r * 2n >= denominator) q += 1n;
  return negative ? -q : q;
}

export function sumMinor(values: Minor[]): Minor {
  return values.reduce<Minor>((acc, v) => acc + v, 0n);
}

export function maxMinor(a: Minor, b: Minor): Minor {
  return a > b ? a : b;
}

export function minMinor(a: Minor, b: Minor): Minor {
  return a < b ? a : b;
}

/** Konversi minor -> string desimal untuk ditampilkan (tanpa simbol). */
export function minorToDecimalString(amount: Minor, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const factor = 10n ** BigInt(decimals);
  const whole = abs / factor;
  const fraction = (abs % factor).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Ubah minor menjadi number untuk konsumsi chart (aman untuk <= 2^53). */
export function minorToNumber(amount: Minor): number {
  if (amount > 9_007_199_254_740_991n || amount < -9_007_199_254_740_991n) {
    throw new Error("Nominal melebihi rentang aman Number; gunakan representasi string");
  }
  return Number(amount);
}

export function serializeMinor(amount: Minor): string {
  return amount.toString();
}